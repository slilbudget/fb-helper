// The end-to-end harness and runner themselves (test/harness.mjs, test/e2e.mjs): a check refuses a Promise, a flow's browser ends by asserting a quiet console, the
// extension's own strings are what the tests read, and the shards of CI together run every flow exactly once. No browser: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, done, closeAll, counts, tr, trx, trn, trVar, trLang, near, esc, has, GRAPH } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const quietAsync = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

// ---------- checks ----------
test("ok(): a Promise (a forgotten await) is refused, not counted as a pass; a plain false is a failure; the totals follow", () => {
  const before = counts();
  assert.throws(() => quiet(() => ok("forgot to await", Promise.resolve(false))), /Promise/);
  assert.throws(() => quiet(() => ok("a thenable", { then() {} })), /Promise/);
  assert.deepEqual(counts(), before, "a refused check is neither a pass nor a failure: the flow stops (and the runner counts the crash)");
  quiet(() => { ok("a pass", 1 === 1); ok("a failure", 1 === 2, "why"); ok("a string is truthy", "text"); ok("zero is not", 0); });
  const after = counts();
  assert.deepEqual([after.total - before.total, after.fails - before.fails], [4, 2]);
});

test("done(): a quiet console passes and the browser closes; a console error fails the flow and the browser still closes; `allow` forgives only what it names", async () => {
  const mk = (errs) => { const b = { errs, ctx: { closed: false, close: async () => { b.ctx.closed = true; } } }; return b; };
  const t0 = counts();
  const quietB = mk([]); await quietAsync(() => done(quietB));
  assert.equal(quietB.ctx.closed, true); assert.deepEqual([counts().total - t0.total, counts().fails - t0.fails], [1, 0]);
  const noisy = mk(["Uncaught TypeError: x is not a function"]); await quietAsync(() => done(noisy));
  assert.equal(noisy.ctx.closed, true, "closed even though it failed"); assert.equal(counts().fails - t0.fails, 1);
  const provoked = mk(["Loading the image 'https://evil.test/p.png' violates the following Content Security Policy directive"]); await quietAsync(() => done(provoked, { allow: /violates the following Content Security Policy/ }));
  assert.equal(counts().fails - t0.fails, 1, "an error that the flow provoked on purpose is no failure");
  const both = mk(["Content Security Policy violated", "a real one"]); await quietAsync(() => done(both, { allow: /Content Security Policy/ }));
  assert.equal(counts().fails - t0.fails, 2, "…but a real one next to it still is");
  await closeAll();
});

// ---------- the extension's own strings ----------
test("tr / trn / trx / trVar: the strings are the extension's, in the language the test is in; a key that does not exist is an error, not a text", async () => {
  await trLang("en");
  assert.equal(tr("err.cooldown", { n: 5 }), "API limit hit — hands off for another 5 min");
  assert.equal(tr("tab.token"), "Token"); assert.equal(trn(1, "ads.clk"), "click"); assert.equal(trn(2, "ads.clk"), "clicks");
  assert.throws(() => tr("no.such.key"), /no string "no\.such\.key"/);
  const re = trx("err.cooldown", { n: /9|10/ });
  assert.ok(re.test("API limit hit — hands off for another 10 min") && !re.test("API limit hit — hands off for another 11 min"));
  assert.ok(trx("acc.found", {}).test("3 of 14 found") && !trx("acc.found", { n: 3 }, { exact: true }).test("x 3 of 14 found"), "an unnamed variable matches anything; exact anchors the whole text");
  assert.ok(trx("money.more", { n: 1 }).test("+1 more"), "regex characters of the string are literal ('+')");
  assert.equal(trVar("acc.wait", "Refresh available in 42 s"), "42"); assert.equal(trVar("acc.wait", "something else"), null);
  await trLang("ru");
  try {
    assert.equal(tr("tab.token"), "Токен"); assert.equal(trn(1, "ads.clk"), "клик"); assert.equal(trn(2, "ads.clk"), "клика"); assert.equal(trn(5, "ads.clk"), "кликов");
  } finally { await trLang("en"); }
});

test("small helpers: near() allows a pixel of rounding, esc() makes a literal of a pattern, has() is a substring test, the Graph origin comes from the manifest's CSP", () => {
  assert.ok(near(68, 68) && near(67, 68) && near(69, 68) && !near(70, 68) && near(10, 12, 2));
  assert.ok(new RegExp(esc("$1,000 (a+b)?")).test("cost $1,000 (a+b)? only")); assert.ok(has("abc", "b") && !has("abc", "d"));
  assert.match(GRAPH, /^https:\/\/graph\.[a-z.]+$/);
});

// ---------- the runner ----------
const runner = (...args) => spawnSync(process.execPath, [path.join(root, "test/e2e.mjs"), ...args], { cwd: root, encoding: "utf8", timeout: 60_000 });
const listed = (...args) => runner("--list", ...args).stdout.split("\n").filter(Boolean).map((l) => l.split("\t")[0]);

test("the runner lists every flow once; a shard is a balanced slice; the shards of any n together are every flow exactly once", () => {
  const all = listed();
  assert.ok(all.length > 60, `${all.length} flows`);
  assert.equal(new Set(all).size, all.length, "no flow twice");
  for (const n of [2, 4, 5]) {
    const slices = Array.from({ length: n }, (_, i) => listed("--shard", `${i + 1}/${n}`));
    assert.deepEqual(slices.flat().sort(), [...all].sort(), `${n} shards: every flow, once`);
    if (n > 1) assert.ok(slices.every((s) => s.length > 0), `${n} shards: none is empty`);
  }
  const weights = Object.fromEntries(runner("--list").stdout.split("\n").filter(Boolean).map((l) => l.split("\t")));
  const load = Array.from({ length: 4 }, (_, i) => listed("--shard", `${i + 1}/4`).reduce((n, f) => n + Number(weights[f]), 0));
  assert.ok(Math.max(...load) / Math.min(...load) < 1.1, `the four shards weigh about the same: ${load}`);
  assert.deepEqual(listed("--shard", "2/4"), listed("--shard=2/4"), "both spellings");
});

test("the runner: named flows (and a shard of them), and a bad command line is exit code 2 with a message, not a run", () => {
  assert.deepEqual(listed("tabs", "token"), ["tabs", "token"]);
  assert.equal(listed("tabs", "token", "bms", "pages", "--shard", "1/2").length + listed("tabs", "token", "bms", "pages", "--shard", "2/2").length, 4);
  for (const bad of [["--shard", "0/4"], ["--shard", "5/4"], ["--shard", "x"], ["--jobs", "0"], ["--jobs", "two"], ["no-such-flow"], ["--nope"]]) {
    const r = runner(...bad);
    assert.equal(r.status, 2, bad.join(" "));
    assert.match(r.stderr, /usage: node test\/e2e\.mjs/, bad.join(" "));
  }
  assert.equal(runner("--list", "--shard", "1/1").status, 0);
});
