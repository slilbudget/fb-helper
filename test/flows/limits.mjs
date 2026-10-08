// What the extension may send and when (graph.js): GET only, the usage header at 95 % starts the API pause, the soft hourly budget stops a
// runaway loop with a calm message, and Graph's text is cleaned of bidi / control characters before it reaches the screen or storage.
// Graph is a mock (fictional data).
import { GRAPH, TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, clickToast, accountsJson, adsFb, stored, ROW, done, tr, trx, ACC } from "../harness.mjs";

const RLO = String.fromCharCode(0x202e), LRI = String.fromCharCode(0x2066);   // built from code points: a literal bidi character in source would reorder the editor
const BIDI = new RegExp(`[${String.fromCharCode(0x202a)}-${String.fromCharCode(0x202e)}${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`);

// ---------- every request is a GET, from the browser's side ----------
async function methodFlow() {
  console.log("\n# limits: GET only");
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: accountsJson }) });
  const seen = [];
  b.ctx.on("request", (r) => { if (r.url().startsWith(GRAPH)) seen.push({ method: r.method(), post: r.postData(), path: new URL(r.url()).pathname }); });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("the list loads", await rowsAre(pop, ROW, 1));
  await pop.click(`${ROW} .lrow-title`); await pop.click(`${ROW}.open [data-ads]`);
  await until(pop, () => document.querySelector("#accountsList .lrow.open .ads")?.textContent.trim() !== "");
  await pop.click('[data-tab="token"]'); await pop.click("#checkToken");
  await until(pop, (s) => !document.querySelector("#tokenInfo").classList.contains("hidden") && !document.querySelector("#tokenInfo").textContent.includes(s), tr("check.checking"));
  ok("accounts, ads and the token check sent requests, every one a GET without a body", seen.length >= 6 && seen.every((r) => r.method === "GET" && !r.post), JSON.stringify(seen.filter((r) => r.method !== "GET" || r.post)));
  ok("…every path is made of word segments only (me, me/adaccounts, act_<digits>/ads, app, me/permissions)", seen.every((r) => /^\/v[\d.]+\/\w+(\/\w+)*$/.test(r.path)), seen.map((r) => r.path).join(" "));
  await done(b);
}

// ---------- the usage header at 95 % = the API pause ----------
async function usageFlow() {
  console.log("\n# limits: usage 95 % pauses");
  let usage = 80;
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ headers: { "x-app-usage": JSON.stringify({ call_count: usage, total_time: 10 }) }, body: accountsJson }) });
  await adsPage(b);
  let pop = await popup(b, "accounts");
  ok("80 %: the list loads, the pill shows the usage, no pause", (await rowsAre(pop, ROW, 1)) && has(await text(pop, "#usage"), "80%") && !trx("usage.pause").test(await text(pop, "#usage")), await text(pop, "#usage"));
  usage = 96;
  await pop.evaluate(() => chrome.storage.session.set({ locks: { slots: {} } }));
  await pop.click("#loadAccounts");
  ok("96 %: the answer is used, then the pause starts (30 min), shown on the pill", await until(pop, (src) => new RegExp(src).test(document.querySelector("#usage").textContent), trx("usage.pause", { n: 30 }).source), await text(pop, "#usage"));
  const cd = await stored(pop, "cooldownUntil");
  ok("…and persisted for the next popup", cd > Date.now() + 29 * 60000 && cd <= Date.now() + 30 * 60000, String(cd));
  const hits = b.hits.length;
  await pop.evaluate(() => chrome.storage.session.set({ locks: { slots: {} } }));
  const toast = await clickToast(pop, "#loadAccounts");
  ok("a refresh during the pause sends nothing and says how long", b.hits.length === hits && has(toast, tr("err.cooldown", { n: 30 })), `${b.hits.length - hits} ${toast}`);
  await done(b);
}

// ---------- names: bidi and control characters ----------
async function namesFlow() {
  console.log("\n# limits: names are cleaned");
  const acc = { account_id: "111", name: `Acc${RLO}fdp.exe\nsecond`, account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: "500", business: { id: "9001", name: `Biz${LRI}x` } };
  acc.currency = `US${RLO}D`; acc.timezone_name = `UT${RLO}C`;                  // printed as they came when Intl does not know them: cleaned like a name
  const b = await boot({ fb: adsFb(TOK), graph: (u) => (/\/ads$/.test(u.pathname) ? { body: { data: [{ id: "1", name: `Ad${RLO}one`, effective_status: "ACTIVE" }] } } : { body: { data: [acc] } }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("the list loads", await rowsAre(pop, ROW, 1));
  const shown = await pop.evaluate(() => document.querySelector("#accountsList").textContent);
  ok("account and business names show without bidi and control characters", has(shown, "Accfdp.exe second") && has(shown, "Bizx") && !BIDI.test(shown) && !shown.includes("\n"), JSON.stringify(shown.slice(0, 120)));
  await pop.click(`${ROW} .lrow-title`); await pop.click(`${ROW}.open [data-ads]`);
  await until(pop, () => /Ad.*one/.test(document.querySelector("#accountsList .lrow.open .ads")?.textContent || ""));
  ok("a currency or timezone with bidi characters is cleaned and still understood ($, not a broken code)", has(await text(pop, `${ROW} .lrow-value`), "$"), await text(pop, `${ROW} .lrow-value`));
  ok("an ad's name is cleaned too", has(await text(pop, `${ACC} .ad .ad-name`), "Adone") && !BIDI.test(await text(pop, `${ACC} .ad .ad-name`)));
  const saved = JSON.stringify([await stored(pop, "accounts"), await stored(pop, "ads")]);
  ok("…and so is what is kept in storage", !BIDI.test(saved) && !/\\u202e|\\u2066|\\n/i.test(saved), saved.slice(0, 200));
  await done(b);
}

// ---------- the CSP is enforced by the real browser ----------
async function cspFlow() {
  console.log("\n# limits: CSP");
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: accountsJson }) });
  const pop = await popup(b);
  // Try what a page of this extension must never be able to do; Chrome reports each refusal as a securitypolicyviolation.
  const r = await pop.evaluate(async () => {
    const seen = [];
    document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.effectiveDirective}:${e.blockedURI}`));
    const img = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res("loaded"); i.onerror = () => res("blocked"); i.src = src; });
    const out = {};
    out.evilImg = await img("https://evil.example.com/p.png");
    out.facebookImg = await img("https://www.facebook.com/p.png");
    out.cdnImg = await img("https://scontent.xx.fbcdn.net/v/t39/ok.png");
    out.fbsbxImg = await img("https://platform-lookaside.fbsbx.com/platform/profilepic/ok.png");
    out.evilFetch = await fetch("https://evil.example.com/x").then(() => "sent", () => "blocked");
    out.otherJsdelivr = await fetch("https://cdn.jsdelivr.net/npm/lodash/lodash.js").then(() => "sent", () => "blocked");
    const base = document.createElement("base"); base.href = "https://evil.example.com/"; document.head.append(base);
    await new Promise((res) => setTimeout(res, 100));
    out.baseHref = document.baseURI;
    out.violations = seen;
    return out;
  });
  ok("a picture from another host or from facebook.com is blocked by img-src", r.evilImg === "blocked" && r.facebookImg === "blocked", JSON.stringify(r));
  ok("…a picture from fbcdn.net loads (the mock answers it) and neither Meta picture host is refused by the CSP", r.cdnImg === "loaded" && !r.violations.some((v) => v.includes("fbcdn") || v.includes("fbsbx")), JSON.stringify(r));
  ok("…a request to another host, or to another file on an allowed one, is blocked by connect-src", r.evilFetch === "blocked" && r.otherJsdelivr === "blocked" && r.violations.some((v) => v.startsWith("connect-src:https://evil.example.com")) && r.violations.some((v) => v.startsWith("connect-src:https://cdn.jsdelivr.net/npm/lodash")), JSON.stringify(r.violations));
  ok("…a <base> cannot redirect relative URLs (base-uri 'none')", !r.baseHref.startsWith("https://evil.example.com") && r.violations.some((v) => v.startsWith("base-uri")), `${r.baseHref} ${JSON.stringify(r.violations)}`);
  await done(b, { allow: /violates the following Content Security Policy|violates the document's Content Security Policy/ });       // the refusals this flow provoked; any other console error still fails
}

export const flows = { limitsMethod: methodFlow, limitsUsage: usageFlow, limitsNames: namesFlow, limitsCsp: cspFlow };
