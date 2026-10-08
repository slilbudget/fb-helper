// End-to-end: real Chromium + the unpacked extension, Facebook and Graph answered by route() mocks (fictional data,
// nothing leaves the machine). CI runs it too (workflow ci.yml: 4 shards, then the store build).
//
//   node test/e2e.mjs                       every flow, one after the other, in this process
//   node test/e2e.mjs session limitsUsage   only these flows
//   node test/e2e.mjs --shard 2/4           the 2nd of 4 balanced slices of the flows (CI matrix); the slices together are every flow, once each
//   node test/e2e.mjs --jobs 3              every flow, three at a time, each in its own child process (output is printed per flow when it ends)
//   node test/e2e.mjs --list                the flows that would run, with their weight (--shard and names apply)
//   EXT_DIR=chrome-web-store/release/unpacked node test/e2e.mjs tabs token bms pages     the store build
// Exit code: 0 all checks passed, 1 a check failed or a flow crashed, 2 a bad command line.
//
// The harness (boot, popup, until, mocks, tr()) is test/harness.mjs. The flows are every test/flows/*.mjs: each file exports
// `flows = { name: asyncFunction }`, so a new tab adds a file there and nothing here changes.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { counts, crash, summary, closeAll } from "./harness.mjs";

const base = new URL("./flows/", import.meta.url);
const flows = {};
for (const file of fs.readdirSync(fileURLToPath(base)).filter((f) => f.endsWith(".mjs")).sort()) {
  for (const [name, fn] of Object.entries((await import(new URL(file, base))).flows)) {
    if (flows[name]) throw new Error(`flow "${name}" is defined twice (${file})`);
    flows[name] = fn;
  }
}
// How much a flow costs, as far as the source tells: the number of characters of its function (more boots and more checks = longer). Only used to
// balance shards and the job queue, so a rough number that every machine computes the same way is what is needed.
const weight = (name) => flows[name].toString().length;

// ---------- the command line ----------
const args = process.argv.slice(2);
const opts = { jobs: 1, shard: null, list: false, names: [] };
const usage = (msg) => { console.error(`${msg}\nusage: node test/e2e.mjs [flow…] [--shard i/n] [--jobs N] [--list]\nflows: ${Object.keys(flows).join(", ")}`); process.exit(2); };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const val = (flag) => (a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : args[++i]);
  if (a === "--list") opts.list = true;
  else if (a === "--jobs" || a.startsWith("--jobs=")) { opts.jobs = Number(val("--jobs")); if (!Number.isInteger(opts.jobs) || opts.jobs < 1) usage("--jobs needs a whole number ≥ 1"); }
  else if (a === "--shard" || a.startsWith("--shard=")) {
    const m = /^(\d+)\/(\d+)$/.exec(val("--shard") || "");
    if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) usage("--shard needs i/n with 1 ≤ i ≤ n, e.g. 2/4");
    opts.shard = [Number(m[1]), Number(m[2])];
  } else if (a.startsWith("--")) usage(`unknown option ${a}`);
  else opts.names.push(a);
}
for (const n of opts.names) if (!flows[n]) usage(`no flow "${n}"`);
let selected = opts.names.length ? opts.names : Object.keys(flows);

// Balanced slices: heaviest flow first, each into the slice with the least weight so far (ties: the lower index). Every shard computes the
// same partition, so the slices are disjoint and together complete.
function partition(names, n) {
  const bins = Array.from({ length: n }, () => ({ load: 0, names: [] }));
  for (const name of [...names].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const bin = bins.reduce((best, x) => (x.load < best.load ? x : best));
    bin.names.push(name); bin.load += weight(name);
  }
  return bins.map((b) => b.names.sort((a, c) => names.indexOf(a) - names.indexOf(c)));
}
if (opts.shard) selected = partition(selected, opts.shard[1])[opts.shard[0] - 1];

if (opts.list) {
  for (const n of selected) console.log(`${n}\t${weight(n)}`);
  process.exit(0);
}
if (!selected.length) { console.log("no flows in this slice"); process.exit(0); }

// ---------- running ----------
const t0 = Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

// One process, flows one after the other. A flow that throws is one failure, and the flows after it still run (one crash must not hide the rest).
async function runHere(names) {
  const times = [];
  for (const name of names) {
    const t = Date.now();
    try { await flows[name](); } catch (e) { console.error(`(flow "${name}")`); crash(e); }
    finally { await closeAll(); }
    times.push([name, Date.now() - t]);
  }
  return times;
}

if (process.env.E2E_CHILD) {
  // A child of --jobs: runs its flows, then hands its totals to the parent on one marked line.
  await runHere(selected);
  console.log(`@@RESULT ${JSON.stringify(counts())}`);
  process.exit(0);
}

if (opts.jobs === 1) {
  const times = await runHere(selected);
  const code = summary();
  console.log(`${selected.length} flows in ${secs(Date.now() - t0)} (jobs 1${opts.shard ? `, shard ${opts.shard.join("/")}` : ""})`);
  if (selected.length > 1) console.log(`slowest: ${times.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, ms]) => `${n} ${secs(ms)}`).join(", ")}`);
  process.exit(code);
}

// --jobs N: a queue of flows (heaviest first), N child processes at a time, one flow per child. The output of a flow is printed as one block when
// it ends, so it never interleaves with another's; the totals come back on the child's @@RESULT line.
const queue = [...selected].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
const total = { total: 0, fails: 0 }, failedFlows = [], times = [];
async function worker() {
  while (queue.length) {
    const name = queue.shift(), t = Date.now();
    const { out, code } = await new Promise((resolve) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), name], { env: { ...process.env, E2E_CHILD: "1" }, stdio: ["ignore", "pipe", "pipe"] });
      let buf = "";
      child.stdout.on("data", (d) => { buf += d; });
      child.stderr.on("data", (d) => { buf += d; });
      child.on("close", (c) => resolve({ out: buf, code: c }));
    });
    const m = /^@@RESULT (.*)$/m.exec(out);
    const r = m ? JSON.parse(m[1]) : null;
    if (r) { total.total += r.total; total.fails += r.fails; } else { total.fails++; }          // no result line = the child died: one failure
    if (!r || r.fails || code) failedFlows.push(name);
    times.push([name, Date.now() - t]);
    console.log(`\n===== ${name} (${secs(Date.now() - t)}) =====${out.replace(/^@@RESULT .*\n?/m, "")}`);
    if (!r) console.log(`FAIL  flow "${name}" ended without a result (exit ${code})`);
  }
}
await Promise.all(Array.from({ length: Math.min(opts.jobs, queue.length) }, worker));
console.log(`\n${total.total - total.fails}/${total.total} passed${total.fails ? `, ${total.fails} FAILED` : ""}`);
console.log(`${selected.length} flows in ${secs(Date.now() - t0)} (jobs ${opts.jobs}${opts.shard ? `, shard ${opts.shard.join("/")}` : ""})`);
console.log(`slowest: ${times.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, ms]) => `${n} ${secs(ms)}`).join(", ")}`);
if (failedFlows.length) console.log(`failed flows: ${failedFlows.join(", ")}`);
process.exit(total.fails ? 1 : 0);
