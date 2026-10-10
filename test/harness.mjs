// Shared harness of the end-to-end tests: real Chromium + the unpacked extension, Facebook and Graph answered by route()
// mocks (fictional data, nothing leaves the machine). Flows live in test/flows/*.mjs (each exports `flows = { name: fn }`);
// test/e2e.mjs runs them (`node test/e2e.mjs [flow…] [--shard i/n] [--jobs N]`). Needs playwright-core (devDependency of the
// root package.json: `npm ci`; or PLAYWRIGHT_CORE=/path/to/playwright-core) and a Chromium (`npx playwright-core install chromium`).
// EXT_DIR=<folder> tests another build of the extension (the store build).
//
// What a flow gets from here:
//   boot / popup / adsPage   a browser profile with the extension, a popup page, an FB tab
//   ok(name, cond, detail)   one check (throws when cond is a Promise: a forgotten `await` would pass every time)
//   done(b)                  the end of a flow's browser: asserts "no console errors", closes the context
//   tr / trx / trn           the extension's own strings (js/i18n.js + js/strings/*) in the language the test is in, so a reworded
//                            message does not break forty tests; the exact English wording is pinned by test/flows/golden.mjs only
//   until / waitFor / idle / settle / rowsAre   waiting for a condition (never a fixed sleep where a condition exists)
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const EXT = process.env.EXT_DIR ? path.resolve(process.env.EXT_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fb-helper");   // EXT_DIR: test the store build
const require = createRequire(import.meta.url);
// Lazy: listing flows (`e2e.mjs --list`) and the unit tests that import this file need no Playwright.
let pw = null;
function playwright() {
  if (pw) return pw;
  for (const p of [process.env.PLAYWRIGHT_CORE, "playwright-core", "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright-core"].filter(Boolean)) {
    try { return (pw = require(p)); } catch { /* next */ }
  }
  throw new Error("playwright-core not found: npm ci (root package.json), or npm i -g playwright-core, or set PLAYWRIGHT_CORE");
}

// The Graph origin the extension may talk to is declared in its manifest (CSP connect-src). The mock listens on exactly
// that origin, so it follows the manifest and a request to any other host would not be answered.
export const GRAPH = new URL(JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"))
  .content_security_policy.extension_pages.match(/connect-src\s+([^\s;]+)/)[1]).origin;

export const TOK = "EAAB" + "x".repeat(70), TOK2 = "EAAB" + "y".repeat(70), TOK_H = "EAAH" + "h".repeat(70), TOK_W = "EAAW" + "w".repeat(70);

// ---------- checks ----------
const stats = { total: 0, fails: 0 };
export const ok = (name, cond, detail = "") => {
  // A Promise is always truthy: `ok("x", p.locator(a).count())` would pass whatever the page says. Fail loudly instead.
  if (cond && typeof cond.then === "function") throw new TypeError(`ok("${name}"): the condition is a Promise (a missing await)`);
  stats.total++; if (!cond) stats.fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `   -> ${detail}`}`);
};
export const has = (s, part) => String(s).includes(part);
// Two measured lengths are the same to the pixel: layout is rounded, and a glyph from a fallback font (≈ ✕ ↗ are not in Golos Text) can move a line box by one.
export const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
// A flow that throws is one failure, not the end of the run.
export const crash = (e) => { console.error("CRASH", e); stats.fails++; };
export const counts = () => ({ ...stats });
// Prints the totals; returns the process exit code.
export function summary() {
  console.log(`\n${stats.total - stats.fails}/${stats.total} passed${stats.fails ? `, ${stats.fails} FAILED` : ""}`);
  return stats.fails ? 1 : 0;
}

// ---------- the extension's own strings ----------
// The same i18n.js and strings files the popup runs (from EXT, so the store build is checked against its own copy). The harness has its own
// instance of the module in Node: its language is switched with useLang() / trLang() below, not by the popup.
const i18n = await import(pathToFileURL(path.join(EXT, "js/i18n.js")).href);
for (const f of fs.readdirSync(path.join(EXT, "js/strings")).sort()) if (f.endsWith(".js")) await import(pathToFileURL(path.join(EXT, "js/strings", f)).href);
await i18n.setLang("en");
export const trLang = (l) => i18n.setLang(l);
export const getTrLang = () => i18n.getLang();
// tr("err.cooldown", { n: 5 }) → the string as the popup shows it in the test's language. A key that does not exist is a typo, not a string.
export function tr(key, vars) {
  if (!i18n.has(key)) throw new Error(`tr: no string "${key}" in "${i18n.getLang()}"`);
  return i18n.t(key, vars);
}
// The count word of n ("click" / "clicks", one / few / many in Russian) from a plural entry such as "ads.clk".
export const trn = (n, key) => i18n.tn(n, key);
// Line 2 context of a Businesses row as bms.js writes it: "2 active · 1 disabled" (a part that is zero is left out; the total is not written);
// a business whose accounts are neither (closed, unsettled): "3 ad accounts". plus = "+" when the list was cut: it goes after the first number
// ("10+ active · 9 disabled", "10+ disabled").
export function bmsContext({ total, active = 0, disabled = 0, plus = "" }) {
  if (!active && !disabled) return `${total}${plus} ${trn(plus ? 5 : total, "bms.accCount")}`;
  return [active ? `${active}${plus} ${trn(active, "bms.activeWord")}` : null, disabled ? `${disabled}${active ? "" : plus} ${trn(disabled, "bms.disabledWord")}` : null].filter(Boolean).join(" · ");
}
// A RegExp of a string, for a text that has a number in it that the test cannot know: trx("err.cooldown", { n: /9|10/ }). A variable given as a
// RegExp is put in as its pattern, any other value is matched literally, a variable left out matches anything.
// { exact: true } anchors it to the whole text.
export function trx(key, vars = {}, { exact = false } = {}) {
  const tpl = tr(key);
  const body = tpl.split(/\{(\w+)\}/).map((part, i) => {
    if (i % 2 === 0) return esc(part);
    const v = vars[part];
    return v === undefined ? ".+?" : v instanceof RegExp ? `(?:${v.source})` : esc(String(v));
  }).join("");
  return new RegExp(exact ? `^${body}$` : body);
}

// ---------- browsers ----------
// A small SVG picture whose colour follows its path (what the fbcdn.net mock answers).
const svg = (pathname) => ({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${[...pathname].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 360, 7)} 55% 55%)"/></svg>` });
const live = new Set();                                        // booted and not yet closed: a flow that throws must not leak its Chromium
// One browser context = one profile. fb(url) → html of a Facebook page; graph(url) → { status?, headers?, body }.
// Pictures (js/pictures.js) have two more handlers, and neither is a "hit": pics(url, n) answers the batch read GET /<version>/?ids=…&fields=… with
// { status?, headers?, body, delay? } (default: {}, no picture found; b.picHits lists the query strings), picture(url) answers the Graph picture
// redirect <Graph>/<version>/<id>/picture of a page without a URL with { redirect: "<picture URL>" } or { status } (default: 404, no picture;
// b.pictureHits lists the paths). So a test that counts b.hits counts the list reads only, as it always did. Playwright does not route the second leg
// of a redirect, so { redirect } answers with the picture itself and notes the target's path in b.images, as the fbcdn.net route would have.
export async function boot({ user = "1001", fb, graph, rates, pics, picture } = {}) {
  await trLang("en");
  const page$ = { hits: [], fb: fb || (() => ""), graph: graph || (() => ({ body: { data: [] } })), user, picHits: [], pictureHits: [], pics: pics || (() => ({})), picture: picture || (() => ({ status: 404 })) };
  const ctx = await playwright().chromium.launchPersistentContext("", { channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  if (user) await ctx.addCookies([["c_user", user], ["xs", "47%3Aabc%3A2"], ["datr", "d1"]]
    .map(([name, value]) => ({ name, value, domain: ".facebook.com", path: "/", secure: true })));
  // Registered first, so the Graph route below (matched first) wins for the Graph host.
  await ctx.route("https://*.facebook.com/**", (r) => r.fulfill({ contentType: "text/html", body: page$.fb(new URL(r.request().url())) }));
  await ctx.route(`${GRAPH}/**`, async (r) => {
    const u = new URL(r.request().url());
    if (/^\/v[\d.]+\/\d+\/picture$/.test(u.pathname)) {                     // an <img> of a page without a picture URL: the redirect to the picture, or none
      page$.pictureHits.push(u.pathname.replace(/^\/v[\d.]+\//, "/") + u.search);
      const pic = page$.picture(u, page$.pictureHits.length) || {};
      if (!pic.redirect) return r.fulfill({ status: pic.status || 404, body: "" });
      page$.images.push(new URL(pic.redirect).pathname);
      return r.fulfill(svg(new URL(pic.redirect).pathname));
    }
    if (/^\/v[\d.]+\/?$/.test(u.pathname) && u.searchParams.has("ids")) {      // the batch read of pictures
      page$.picHits.push(u.search);
      const out = page$.pics(u, page$.picHits.length) || {};
      if (out.delay) await new Promise((res) => setTimeout(res, out.delay));
      return r.fulfill({ status: out.status || 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...(out.headers || {}) }, body: JSON.stringify(out.body ?? out) });
    }
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
    r.fulfill(svg(u.pathname));
  });
  // Exchange rates (money.js): both origins are answered here, never by the network. rates(url, n) → { status?, body, delay? } | { abort: true }.
  // The default answers 503 for both, so a total of several currencies stays the per-currency sum ("$117.00 + €50.00") unless a test
  // brings rates (ratesOk below). b.rateHits lists every request: origin + path.
  page$.rateHits = [];
  page$.rates = rates || (() => ({ status: 503, body: {} }));
  for (const origin of ["https://cdn.jsdelivr.net", "https://latest.currency-api.pages.dev"]) {
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
  // Requests to Graph that have started and not ended (answered, aborted, failed): b.inflight === 0 means nothing is on its way.
  page$.inflight = 0;
  ctx.on("request", (r) => { if (r.url().startsWith(GRAPH)) page$.inflight++; });
  const ended = (r) => { if (r.url().startsWith(GRAPH)) page$.inflight = Math.max(0, page$.inflight - 1); };
  ctx.on("requestfinished", ended); ctx.on("requestfailed", ended);
  Object.assign(page$, { ctx, id, langSet: false, errs: [] });
  live.add(page$);
  return page$;
}
// The end of a flow's browser: the popups reported no error to the console (a page error, a rejected promise, a CSP refusal), then the context goes.
// allow = a RegExp of messages that this flow provokes on purpose (it says so, so everything else still counts).
export async function done(b, { allow } = {}) {
  const errs = allow ? b.errs.filter((m) => !allow.test(m)) : b.errs;
  try { ok("no console errors", errs.length === 0, errs.join(" | ")); }
  finally { live.delete(b); await b.ctx.close(); }
}
// The runner calls this after every flow: whatever a flow that threw left open is closed.
export async function closeAll() {
  for (const b of live) await b.ctx.close().catch(() => {});
  live.clear();
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
  await fontsReady(p);
  if (tab) await p.click(`[data-tab="${tab}"]`);
  return p;
}
// Switches the popup's language by its button and the test's strings with it. Resolves when the page has taken the language over.
export async function useLang(p, lang) {
  await p.click(`[data-lang="${lang}"]`);
  await trLang(lang);
  await p.waitForFunction((l) => document.documentElement.lang === l, lang);
  await fontsReady(p);
}

// ---------- waiting ----------
// Poll from Node, not with waitForFunction: page.evaluate awaits promises (chrome.storage.*) and survives reloads.
export const until = async (p, fn, arg, ms = 8000) => {   // generous: a loaded machine is slow, a real failure still fails
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await p.evaluate(fn, arg)) return true; } catch { /* page navigating */ }
    await p.waitForTimeout(100);
  }
  return false;
};
// The same for a condition that lives in Node (b.hits.length, a count of requests): waitFor(() => reads() >= 2).
export const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
export const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const rowsAre = (p, sel, n) => until(p, ([s, k]) => document.querySelectorAll(s).length === k, [sel, n]);
// Waits until the text of the element matches a RegExp (build it with trx() when it is made of the extension's own strings).
export const untilText = (p, sel, re, ms) => until(p, ([s, src, fl]) => new RegExp(src, fl).test(document.querySelector(s)?.textContent || ""), [sel, re.source, re.flags], ms);
// The button of a spend period ("today" | "yesterday" | "week" | "month" | "all") in the Ad accounts (#periodSeg) or the Businesses (#bmsPeriod) tab.
// trVar("acc.wait", "Refresh available in 42 s") → "42": the value of the one variable (default `n`) of a string, read back from the text that shows it.
export function trVar(key, text, name = "n") {
  const re = new RegExp(tr(key).split(/\{(\w+)\}/).map((part, i) => (i % 2 === 0 ? esc(part) : part === name ? "(.+?)" : ".+?")).join(""));
  return re.exec(text)?.[1] ?? null;
}
// The loading texts of an account's ads list: the list itself, and the numbers that follow it.
export const adsLoadingRe = () => new RegExp(`${trx("ads.loading").source}|${trx("ads.statsLoading").source}`);
// "just now" | "N min ago" | "N h ago", as the popup writes an age.
export const agoRe = () => new RegExp(`${esc(tr("ago.now"))}|${trx("ago.min", { n: /\d+/ }).source}|${trx("ago.h", { n: /\d+/ }).source}`);
export const PERIOD = (key, box = "#periodSeg") => `${box} .seg-btn:has-text("${tr(`period.${key}`)}")`;
// The list loader (js/list-loader.js) puts data-loading on the panel while a load runs and takes it off at the end: idle = no load is under way.
// (Before a load has started the panel is idle too: wait for rows or a state first when the load is yet to begin.)
// The automatic load a list tab starts when it is shown has run its course: the skeleton it drew first is gone and no load is under way (the panel's
// data-loading marker is off). What it decided (nothing, because of a pause or a missing token; or a request) is on screen and in b.hits by then.
export const autoDone = async (p, list) => {
  const r = await until(p, (sel) => !document.querySelector(`${sel} .lsk`) && !document.querySelector(sel).closest(".panel").dataset.loading, list);
  await settle(p);
  return r;
};
export const idle = (p, panel) => until(p, (sel) => !document.querySelector(sel).dataset.loading, panel);
// The page has handled what it was just told: two frames (a click handler, a ResizeObserver, a redraw) and a round trip to the extension's
// storage (every write the page made before is in). It proves nothing about a timer or a request; use it where only the page's own work
// is pending, e.g. after setViewportSize.
export const settle = (p) => p.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))))
  .then(() => p.evaluate(() => chrome.storage.session.get("locks"))).then(() => true);
// Money (js/money.js) takes a Web Lock ("fbh-fx") for every lookup of exchange rates, the fetches included. A lock requested now is granted only after any
// lookup that was started before it, so when it returns nothing is under way: "no request to the rate sources" can be read from b.rateHits at once.
export const ratesIdle = (p) => p.evaluate(() => navigator.locks.request("fbh-fx", () => true));
// The bundled font is loaded and the page has finished laying out with it. The popup's text is Golos Text (css/fonts.css); a machine
// without it would measure a fallback font and every width check would be about something else.
export const fontsReady = (p) => p.evaluate(() => document.fonts.ready.then(() => true)).catch(() => false);
export const golosLoaded = (p) => p.evaluate(() => [...document.fonts].some((f) => /Golos/.test(f.family) && f.status === "loaded"));
export const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent.trim() ?? null, sel);
// Frees every rate slot. The old shape ({ accountsAt, ads }) is on purpose: a locks value without `slots` reads as "nothing taken".
// Resolves when this page's own state has taken the change over (the storage event reaches it a moment after the write).
export const resetLocks = (p) => p.evaluate(() => chrome.storage.session.set({ locks: { accountsAt: 0, ads: {} } }))
  .then(() => until(p, async () => Object.keys((await import(chrome.runtime.getURL("js/state.js"))).state.locks.slots).length === 0));
// Click and wait for the toast it produces (cleared first, so an older toast cannot answer).
export async function clickToast(p, sel, ms = 8000) {
  await p.evaluate(() => { const t = document.querySelector("#toast"); t.textContent = ""; t.classList.remove("show"); });
  await p.click(sel);
  await until(p, () => document.querySelector("#toast").textContent.length > 0, null, ms);
  return text(p, "#toast");
}
export const toastOf = (p) => text(p, "#toast").then((s) => s ?? "");
export const captureClipboard = (p) => p.evaluate(() => { window.__clip = []; navigator.clipboard.writeText = async (s) => { window.__clip.push(s); }; });
// The clipboard refuses (permission, no focus): every writeText rejects. For the "could not copy" paths.
export const failClipboard = (p) => p.evaluate(() => { window.__clip = []; navigator.clipboard.writeText = async () => { throw new DOMException("denied", "NotAllowedError"); }; });
export const clip = (p) => p.evaluate(() => window.__clip);
// Line 2 of a list row (the first element matching rowSel) as it is DRAWN: its visible items in order, each with the "·" that rows.css puts before or after it
// (generated content is not in the DOM text): "1864109161555839 · 3 ad accounts", "1001 · Ads policy · Appeal+2 more". An item the line had no room for is left out.
export const lineTwo = (p, rowSel) => p.evaluate((sel) => {
  const sub = document.querySelector(`${sel} .lrow-sub`);
  const gen = (el, pseudo) => { const c = getComputedStyle(el, pseudo).content; return c === "none" || c === "normal" ? "" : c.replace(/^"|"$/g, ""); };
  return [...sub.querySelectorAll(".lrow-it")].filter((i) => !i.hidden).map((i) => [gen(i, "::before"), i.textContent.trim(), gen(i, "::after")].filter(Boolean).join(" ")).join(" ");
}, rowSel);
export const accountsJson = { data: [{ account_id: "111", name: "Acc A", account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: "500" }] };
export const isAds = (u) => /\/act_\d+\/ads$/.test(u.pathname);
export const adsFb = (tok) => (u) => u.hostname.startsWith("adsmanager") && tok ? `<script>window.__accessToken=${JSON.stringify(tok)}</script>ads` : "<p>feed</p>";

// ---------- shared steps ----------
export const boxWait = (p, re) => until(p, (src) => new RegExp(src).test(document.querySelector("#tokenBox").textContent.trim()), re.source);
export const GONE = /^(?!EAA|—)/;                                   // the field holds a reason, not a token
// The three list panels: every selector of a list is scoped to its panel, so a class two tabs share can never be matched in the wrong one.
export const ACC = "#accountsList", BMS = "#bmsList", PGS = "#pagesList";
export const ROW = `${ACC} .lrow`;                                  // a row of the Ad accounts tab (js/row.js)
export const ADS_OPEN = `${ROW}.open .ads`;                         // the ads section of the open account row
export const loadAccounts = async (p, n = 1) => { await p.click("#loadAccounts"); return rowsAre(p, ROW, n); };
export async function openAds(p) {
  await p.click(`${ROW} .lrow-title`); await p.click(`${ROW}.open [data-ads]`);
  return until(p, ([sel, src]) => { const a = document.querySelector(sel); return !!a && a.textContent.trim() !== "" && !new RegExp(src).test(a.textContent); }, [ADS_OPEN, adsLoadingRe().source]);
}
export const stored = (p, key) => p.evaluate((k) => chrome.storage.session.get(k).then((o) => o[k]), key);

// ---------- mock exchange rates (units per 1 USD) ----------
export const FX = { USD: 1, EUR: 0.8, GBP: 0.75, VND: 25000, UAH: 40, RUB: 90, PLN: 4 };
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
// The payload of both sources (one dataset, two mirrors), dated `when` (default: now, so a test never meets a stale table by accident).
export const fxBody = (r = FX, when = Date.now()) => ({ date: dayOf(when), usd: Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])) });
// The two sources' URLs, in the order the extension asks for them, and the rates handler for boot({ rates }): both answer with the table.
export const FX_PRIMARY = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";
export const FX_FALLBACK = "https://latest.currency-api.pages.dev/v1/currencies/usd.json";
export const ratesOk = () => ({ body: fxBody() });
