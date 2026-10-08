// Shared harness of the end-to-end tests: real Chromium + the unpacked extension, Facebook and Graph answered by route()
// mocks (fictional data, nothing leaves the machine). Flows live in test/flows/*.mjs (each exports `flows = { name: fn }`);
// test/e2e.mjs runs them all. Needs playwright-core (`npm i -g playwright-core`, or PLAYWRIGHT_CORE=/path/to/playwright-core)
// and a Chromium. EXT_DIR=<folder> tests another build of the extension (the store build).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const EXT = process.env.EXT_DIR ? path.resolve(process.env.EXT_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fb-helper");   // EXT_DIR: test the store build
const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of [process.env.PLAYWRIGHT_CORE, "playwright-core", "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright-core"].filter(Boolean)) {
    try { return require(p); } catch { /* next */ }
  }
  throw new Error("playwright-core not found: npm i -g playwright-core, or set PLAYWRIGHT_CORE");
}
const { chromium } = loadPlaywright();

// The Graph origin the extension may talk to is declared in its manifest (CSP connect-src). The mock listens on exactly
// that origin, so it follows the manifest and a request to any other host would not be answered.
export const GRAPH = new URL(JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"))
  .content_security_policy.extension_pages.match(/connect-src\s+([^\s;]+)/)[1]).origin;

export const TOK = "EAAB" + "x".repeat(70), TOK2 = "EAAB" + "y".repeat(70), TOK_H = "EAAH" + "h".repeat(70), TOK_W = "EAAW" + "w".repeat(70);
const stats = { total: 0, fails: 0 };
export const ok = (name, cond, detail = "") => {
  stats.total++; if (!cond) stats.fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `   -> ${detail}`}`);
};
export const has = (s, part) => String(s).includes(part);
// A flow that throws is one failure, not the end of the run.
export const crash = (e) => { console.error("CRASH", e); stats.fails++; };
// Prints the totals; returns the process exit code.
export function summary() {
  console.log(`\n${stats.total - stats.fails}/${stats.total} passed${stats.fails ? `, ${stats.fails} FAILED` : ""}`);
  return stats.fails ? 1 : 0;
}

// One browser context = one profile. fb(url) → html of a Facebook page; graph(url) → { status?, headers?, body }.
export async function boot({ user = "1001", fb, graph } = {}) {
  const page$ = { hits: [], fb: fb || (() => ""), graph: graph || (() => ({ body: { data: [] } })), user };
  const ctx = await chromium.launchPersistentContext("", { channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  if (user) await ctx.addCookies([["c_user", user], ["xs", "47%3Aabc%3A2"], ["datr", "d1"]]
    .map(([name, value]) => ({ name, value, domain: ".facebook.com", path: "/", secure: true })));
  // Registered first, so the Graph route below (matched first) wins for the Graph host.
  await ctx.route("https://*.facebook.com/**", (r) => r.fulfill({ contentType: "text/html", body: page$.fb(new URL(r.request().url())) }));
  await ctx.route(`${GRAPH}/**`, async (r) => {
    const u = new URL(r.request().url());
    page$.hits.push(u.pathname.replace(/^\/v[\d.]+\//, "/") + u.search);
    const out = page$.graph(u, page$.hits.length) || {};
    if (out.delay) await new Promise((res) => setTimeout(res, out.delay));
    const body = out.body ?? out;
    r.fulfill({ status: out.status || 200, contentType: "application/json",
      headers: { "access-control-allow-origin": "*", ...(out.headers || {}) }, body: JSON.stringify(body) });
  });
  const pg = await ctx.newPage(); await pg.goto("chrome://extensions");
  const id = await pg.evaluate(() => document.querySelector("extensions-manager").shadowRoot
    .querySelector("extensions-item-list").shadowRoot.querySelector("extensions-item").id);
  await pg.close();
  Object.assign(page$, { ctx, id, langSet: false, errs: [] });
  return page$;
}
export const adsPage = (b, url = "https://adsmanager.facebook.com/adsmanager/manage/campaigns") =>
  b.ctx.newPage().then(async (p) => { await p.goto(url); return p; });
export async function popup(b, tab) {
  const p = await b.ctx.newPage();
  p.on("pageerror", (e) => b.errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) b.errs.push(m.text()); });
  await p.goto(`chrome-extension://${b.id}/popup.html`);
  if (!b.langSet) { await p.evaluate(() => chrome.storage.local.set({ lang: "en" })); await p.reload(); b.langSet = true; }
  // The token field leaves "—" once the silent token read has finished (with a token or with the reason it has none).
  await p.waitForFunction(() => document.querySelector("#tokenBox").textContent.trim() !== "—", null, { timeout: 5000 }).catch(() => {});
  if (tab) await p.click(`[data-tab="${tab}"]`);
  return p;
}
export const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent.trim() ?? null, sel);
// Poll from Node, not with waitForFunction: page.evaluate awaits promises (chrome.storage.*) and survives reloads.
export const until = async (p, fn, arg, ms = 8000) => {   // generous: a loaded machine is slow, a real failure still fails
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await p.evaluate(fn, arg)) return true; } catch { /* page navigating */ }
    await p.waitForTimeout(100);
  }
  return false;
};
export const rowsAre = (p, sel, n) => until(p, ([s, k]) => document.querySelectorAll(s).length === k, [sel, n]);
// Frees every rate slot. The old shape ({ accountsAt, ads }) is on purpose: a locks value without `slots` reads as "nothing taken".
export const resetLocks = (p) => p.evaluate(() => chrome.storage.session.set({ locks: { accountsAt: 0, ads: {} } })).then(() => p.waitForTimeout(200));
// Click and wait for the toast it produces (cleared first, so an older toast cannot answer).
export async function clickToast(p, sel, ms = 8000) {
  await p.evaluate(() => { const t = document.querySelector("#toast"); t.textContent = ""; t.classList.remove("show"); });
  await p.click(sel);
  await until(p, () => document.querySelector("#toast").textContent.length > 0, null, ms);
  return text(p, "#toast");
}
export const captureClipboard = (p) => p.evaluate(() => { window.__clip = []; navigator.clipboard.writeText = async (s) => { window.__clip.push(s); }; });
export const clip = (p) => p.evaluate(() => window.__clip);
export const accountsJson = { data: [{ account_id: "111", name: "Acc A", account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: "500" }] };
export const isAds = (u) => /\/act_\d+\/ads$/.test(u.pathname);
export const adsFb = (tok) => (u) => u.hostname.startsWith("adsmanager") && tok ? `<script>window.__accessToken=${JSON.stringify(tok)}</script>ads` : "<p>feed</p>";

// ---------- shared steps ----------
export const boxWait = (p, re) => until(p, (src) => new RegExp(src).test(document.querySelector("#tokenBox").textContent.trim()), re.source);
export const GONE = /^(?!EAA|—)/;                                   // the field holds a reason, not a token
export const loadAccounts = async (p, n = 1) => { await p.click("#loadAccounts"); return rowsAre(p, ".acc", n); };
export async function openAds(p) {
  await p.click(".acc .acc-title"); await p.click(".acc.open [data-ads]");
  return until(p, () => { const a = document.querySelector(".acc.open .ads"); return !!a && a.textContent.trim() !== "" && !/Loading/.test(a.textContent); });
}
export const stored = (p, key) => p.evaluate((k) => chrome.storage.session.get(k).then((o) => o[k]), key);
