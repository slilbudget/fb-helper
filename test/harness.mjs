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
export async function boot({ user = "1001", fb, graph, rates } = {}) {
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
  // Pictures of pages and businesses come from fbcdn.net: answered here with a small SVG (a path with "broken" in it gives a 404), so
  // no test touches the network. b.images lists every path asked for.
  page$.images = [];
  await ctx.route("https://*.fbcdn.net/**", (r) => {
    const u = new URL(r.request().url());
    page$.images.push(u.pathname);
    if (/broken/.test(u.pathname)) return r.fulfill({ status: 404, body: "" });
    const hue = [...u.pathname].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 360, 7);
    r.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${hue} 55% 55%)"/></svg>` });
  });
  // Exchange rates (money.js): both origins are answered here, never by the network. rates(url, n) → { status?, body, delay? } | { abort: true }.
  // The default answers 503 for both, so a total of several currencies stays the per-currency sum ("$117.00 + €50.00") unless a test
  // brings rates (ratesOk below). b.rateHits lists every request: origin + path.
  page$.rateHits = [];
  page$.rates = rates || (() => ({ status: 503, body: {} }));
  for (const origin of ["https://open.er-api.com", "https://cdn.jsdelivr.net"]) {
    await ctx.route(`${origin}/**`, async (r) => {
      const u = new URL(r.request().url());
      page$.rateHits.push(u.origin + u.pathname);
      const out = page$.rates(u, page$.rateHits.length) || {};
      if (out.delay) await new Promise((res) => setTimeout(res, out.delay));
      if (out.abort) return r.abort("failed");
      r.fulfill({ status: out.status || 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...(out.headers || {}) }, body: JSON.stringify(out.body ?? out) });
    });
  }
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

// ---------- mock exchange rates (units per 1 USD) ----------
export const FX = { USD: 1, EUR: 0.8, GBP: 0.75, VND: 25000, UAH: 40, RUB: 90, PLN: 4 };
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
// Both providers' payload shapes, dated `when` (default: now, so a test never meets a stale table by accident).
export const fxEr = (r = FX, when = Date.now()) => { const d = new Date(when); return { result: "success", provider: "https://www.exchangerate-api.com", base_code: "USD",
  time_last_update_unix: Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 2, 31) / 1000), time_last_update_utc: `${dayOf(when)} 00:02:31`, rates: r }; };
export const fxCdn = (r = FX, when = Date.now()) => ({ date: dayOf(when), usd: Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])) });
// A rates handler for boot({ rates }): the primary source answers with fxEr, the fallback with fxCdn.
export const ratesOk = (u) => ({ body: u.hostname === "open.er-api.com" ? fxEr() : fxCdn() });
