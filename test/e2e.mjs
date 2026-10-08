// End-to-end: real Chromium + the unpacked extension, Facebook and Graph answered by route() mocks (fictional data,
// nothing leaves the machine). CI runs it too (job e2e). Run: `node test/e2e.mjs`  (one flow: `node test/e2e.mjs session`,
// the store build: `EXT_DIR=chrome-web-store/release/unpacked node test/e2e.mjs`).
// The harness (boot, popup, until, mocks, totals) is test/harness.mjs. The flows are every test/flows/*.mjs: each file exports
// `flows = { name: asyncFunction }`, so a new tab adds a file there and nothing here changes.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { crash, summary } from "./harness.mjs";

const base = new URL("./flows/", import.meta.url);
const flows = {};
for (const file of fs.readdirSync(fileURLToPath(base)).filter((f) => f.endsWith(".mjs")).sort()) {
  for (const [name, fn] of Object.entries((await import(new URL(file, base))).flows)) {
    if (flows[name]) throw new Error(`flow "${name}" is defined twice (${file})`);
    flows[name] = fn;
  }
}

const only = process.argv[2];
if (only && !flows[only]) { console.error(`no flow "${only}"; flows: ${Object.keys(flows).join(", ")}`); process.exit(2); }
try {
  for (const [name, fn] of Object.entries(flows)) if (!only || only === name) await fn();
} catch (e) { crash(e); }
process.exit(summary());
