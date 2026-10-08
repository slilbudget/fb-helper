// What the extension may send and when (graph.js): GET only, the usage header at 95 % starts the API pause, the soft hourly budget stops a
// runaway loop with a calm message, and Graph's text is cleaned of bidi / control characters before it reaches the screen or storage.
// Graph is a mock (fictional data).
import { GRAPH, TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, clickToast, accountsJson, adsFb, stored, ROW } from "../harness.mjs";

const toastOf = (p) => p.evaluate(() => document.querySelector("#toast").textContent.trim());
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
  await until(pop, () => !document.querySelector("#tokenInfo").classList.contains("hidden") && !/Checking/.test(document.querySelector("#tokenInfo").textContent));
  ok("accounts, ads and the token check sent requests, every one a GET without a body", seen.length >= 6 && seen.every((r) => r.method === "GET" && !r.post), JSON.stringify(seen.filter((r) => r.method !== "GET" || r.post)));
  ok("…every path is made of word segments only (me, me/adaccounts, act_<digits>/ads, app, me/permissions)", seen.every((r) => /^\/v[\d.]+\/\w+(\/\w+)*$/.test(r.path)), seen.map((r) => r.path).join(" "));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- the usage header at 95 % = the API pause ----------
async function usageFlow() {
  console.log("\n# limits: usage 95 % pauses");
  let usage = 80;
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ headers: { "x-app-usage": JSON.stringify({ call_count: usage, total_time: 10 }) }, body: accountsJson }) });
  await adsPage(b);
  let pop = await popup(b, "accounts");
  ok("80 %: the list loads, the pill shows the usage, no pause", (await rowsAre(pop, ROW, 1)) && has(await text(pop, "#usage"), "80%") && !has(await text(pop, "#usage"), "Paused"), await text(pop, "#usage"));
  usage = 96;
  await pop.evaluate(() => chrome.storage.session.set({ locks: { slots: {} } }));
  await pop.click("#loadAccounts");
  ok("96 %: the answer is used, then the pause starts (30 min), shown on the pill", await until(pop, () => /Paused 30 min/.test(document.querySelector("#usage").textContent)), await text(pop, "#usage"));
  const cd = await stored(pop, "cooldownUntil");
  ok("…and persisted for the next popup", cd > Date.now() + 29 * 60000 && cd <= Date.now() + 30 * 60000, String(cd));
  const hits = b.hits.length;
  await pop.evaluate(() => chrome.storage.session.set({ locks: { slots: {} } }));
  const toast = await clickToast(pop, "#loadAccounts");
  ok("a refresh during the pause sends nothing and says how long", b.hits.length === hits && /hands off for another 30 min/.test(toast), `${b.hits.length - hits} ${toast}`);
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- names: bidi and control characters ----------
async function namesFlow() {
  console.log("\n# limits: names are cleaned");
  const acc = { account_id: "111", name: `Acc${RLO}fdp.exe\nsecond`, account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: "500", business: { id: "9001", name: `Biz${LRI}x` } };
  const b = await boot({ fb: adsFb(TOK), graph: (u) => (/\/ads$/.test(u.pathname) ? { body: { data: [{ id: "1", name: `Ad${RLO}one`, effective_status: "ACTIVE" }] } } : { body: { data: [acc] } }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("the list loads", await rowsAre(pop, ROW, 1));
  const shown = await pop.evaluate(() => document.querySelector("#accountsList").textContent);
  ok("account and business names show without bidi and control characters", has(shown, "Accfdp.exe second") && has(shown, "Bizx") && !BIDI.test(shown) && !shown.includes("\n"), JSON.stringify(shown.slice(0, 120)));
  await pop.click(`${ROW} .lrow-title`); await pop.click(`${ROW}.open [data-ads]`);
  await until(pop, () => /Ad.*one/.test(document.querySelector("#accountsList .lrow.open .ads")?.textContent || ""));
  ok("an ad's name is cleaned too", has(await text(pop, ".ad .ad-name"), "Adone") && !BIDI.test(await text(pop, ".ad .ad-name")));
  const saved = JSON.stringify([await stored(pop, "accounts"), await stored(pop, "ads")]);
  ok("…and so is what is kept in storage", !BIDI.test(saved) && !/\\u202e|\\u2066|\\n/i.test(saved), saved.slice(0, 200));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

export const flows = { limitsMethod: methodFlow, limitsUsage: usageFlow, limitsNames: namesFlow };
