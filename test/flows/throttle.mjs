// What a throttle answer and the usage header do to the whole popup: ONE throttle answer pauses every tab and every window for 30 minutes (Accounts,
// Businesses, Pages, an account's ads), a click during the pause sends nothing and does not use up the rate slot, the pause ends when another window says
// so; and the header pill: hidden below 50 %, amber from 50, red from 75, the worst number of the three usage headers, a pause at 95. Graph is a mock.
import { TOK, ok, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, accountsJson, isAds, adsFb, stored, ROW, idle, settle, autoDone, waitFor, tr, trx, done } from "../harness.mjs";

const pathOf = (u) => u.pathname.replace(/^\/v[\d.]+\//, "/");
const PAGE = { id: "100000000000001", name: "Page One", is_published: true, tasks: ["ADVERTISE"], promotion_eligible: true };
const BMS = { data: [{ id: "900", name: "Nova Media" }] };
const normal = (u) => {
  const p = pathOf(u);
  if (p === "/me/adaccounts") return { body: accountsJson };
  if (p === "/me/businesses") return { body: BMS };
  if (p === "/me/accounts") return { body: { data: [PAGE] } };
  if (isAds(u)) return { body: { data: [{ id: "a1", name: "Ad", effective_status: "ACTIVE" }] } };
  return { body: { data: [] } };
};
const limit = (code = 17) => ({ status: 400, body: { error: { code, message: `(#${code}) request limit reached` } } });
const slotsOf = (p) => p.evaluate(() => chrome.storage.session.get("locks").then((o) => Object.keys(o.locks?.slots || {})));
const pill = (p) => p.evaluate(() => { const u = document.querySelector("#usage"); return { text: u.textContent.trim(), cls: u.className.replace(/\bpill\b/, "").trim() }; });
const reads = (b, prefix) => b.hits.filter((h) => h.startsWith(prefix)).length;

async function throttleFlow() {
  console.log("\n# throttle: one throttle answer pauses every tab and every window");
  let throttle = false;
  const b = await boot({ fb: adsFb(TOK), graph: (u) => (throttle && pathOf(u) === "/me/adaccounts" ? limit(17) : normal(u)) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("the list loads while nothing is wrong, the pill is hidden", (await rowsAre(pop, ROW, 1)) && (await pill(pop)).cls.includes("hidden"), JSON.stringify(await pill(pop)));
  await pop.click(`${ROW} .lrow-title`); await pop.click(`${ROW}.open [data-ads]`);       // an account's ads: loaded once before the pause, refreshed during it below
  await until(pop, () => /Ad/.test(document.querySelector("#accountsList .lrow.open .ads")?.textContent || ""));

  // ---- the throttle answer ----
  throttle = true; await resetLocks(pop);
  const n0 = b.hits.length;
  const toast = await clickToast(pop, "#loadAccounts");
  ok("a refresh that Graph answers with a user-request-limit error: the toast says so, with the code, and that the extension stopped (no retry)", toast === tr("err.limit", { c: tr("err.code", { c: 17 }) }) && b.hits.slice(n0).filter((h) => h.startsWith("/me/adaccounts")).length === 1, `${toast} | ${b.hits.slice(n0)}`);
  await idle(pop, "#tab-accounts");
  const sentAfterLimit = b.hits.length;
  ok("the pill on every tab's header turns red: 'Paused 30 min'", await until(pop, (src) => new RegExp(src).test(document.querySelector("#usage").textContent), trx("usage.pause", { n: 30 }).source) && (await pill(pop)).cls === "bad", JSON.stringify(await pill(pop)));
  const cd = await stored(pop, "cooldownUntil");
  ok("…the pause is kept for the next popup and the other windows: 30 minutes from now", cd > Date.now() + 29 * 60000 && cd <= Date.now() + 30 * 60000, String(cd));

  // ---- another tab, another list, the ads of an account: nothing goes out and no slot is used up ----
  await resetLocks(pop);
  const refused = trx("err.cooldown", { n: /29|30/ });
  const t1 = await clickToast(pop, "#loadAccounts");
  ok("Accounts: a manual refresh during the pause says how long, sends nothing, and keeps the rate slot", refused.test(t1) && b.hits.length === sentAfterLimit && !(await slotsOf(pop)).includes("accounts"), `${t1} ${b.hits.length - sentAfterLimit} ${await slotsOf(pop)}`);
  await pop.click(`${ROW}.open .ads-refresh`);
  ok("an account's ads: the refresh icon is refused the same way, and its own 30 s slot is not used up", (await until(pop, (src) => new RegExp(src).test(document.querySelector("#toast").textContent), refused.source)) && b.hits.length === sentAfterLimit && !(await slotsOf(pop)).includes("ads:111"), `${b.hits.length - sentAfterLimit} ${await slotsOf(pop)}`);
  await pop.click('[data-tab="bms"]'); await autoDone(pop, "#bmsList");
  ok("Businesses: showing the tab does not start its automatic load, the list says 'Not loaded yet'", b.hits.length === sentAfterLimit && (await text(pop, "#bmsList .lempty-text")) === tr("list.idle"), `${b.hits.length - sentAfterLimit}`);
  const t2 = await clickToast(pop, "#loadBms");
  ok("…and its refresh button is refused with the same minutes, sending nothing, using no slot", refused.test(t2) && b.hits.length === sentAfterLimit && !(await slotsOf(pop)).includes("bms"), `${t2} ${await slotsOf(pop)}`);
  await pop.click('[data-tab="pages"]'); await autoDone(pop, "#pagesList");
  const t3 = await clickToast(pop, "#loadPages");
  ok("Pages: the same, tab and button", refused.test(t3) && b.hits.length === sentAfterLimit && !(await slotsOf(pop)).includes("pages") && (await text(pop, "#pagesList .lempty-text")) === tr("list.idle"), `${t3} ${b.hits.length - sentAfterLimit}`);

  // ---- another window of the extension ----
  const other = await popup(b, "accounts");
  await autoDone(other, "#accountsList");
  ok("a second popup window opened during the pause shows the pill at once and sends nothing (the list in it is the one already loaded)", trx("usage.pause", { n: /29|30/ }).test((await pill(other)).text) && b.hits.length === sentAfterLimit && (await rowsAre(other, ROW, 1)), JSON.stringify(await pill(other)));
  await other.close();

  // ---- the pause ends (another window cleared it): the same click goes out, the slot was never spent ----
  throttle = false;
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: 0 }));
  ok("the pill follows the end of the pause", await until(pop, () => document.querySelector("#usage").classList.contains("hidden")));
  await pop.click('[data-tab="accounts"]');
  await pop.click("#loadAccounts");
  ok("the very next click on Accounts loads again, with no 'refresh available in N s'", (await waitFor(() => b.hits.length > sentAfterLimit)) && (await idle(pop, "#tab-accounts")) && reads(b, "/me/adaccounts") === 3, String(b.hits.length - sentAfterLimit));
  await done(b);

  // ---- the other ways Meta says "slow down" ----
  const variants = [["HTTP 429 and no body", { status: 429, body: {} }, "HTTP 429"], ["code 613 (call-count limit)", limit(613), tr("err.code", { c: 613 })], ["code 80004 (the ad-account / business-use-case limit)", limit(80004), tr("err.code", { c: 80004 })]];
  for (const [name, answer, label] of variants) {
    const v = await boot({ fb: adsFb(TOK), graph: () => answer });
    await adsPage(v);
    const p = await popup(v, "accounts");
    await until(p, () => !!document.querySelector('#accountsList .lempty[data-state="error"]'));
    const said = await toastOf2(p);
    ok(`${name}: one request, the toast says the limit was hit, the pause starts`, v.hits.length === 1 && said === tr("err.limit", { c: label }) && (await stored(p, "cooldownUntil")) > Date.now() + 29 * 60000, `${v.hits.length} ${said}`);
    await done(v);
  }
}
const toastOf2 = (p) => p.evaluate(() => document.querySelector("#toast").textContent.trim());

// ---------- the usage pill ----------
async function pillFlow() {
  console.log("\n# usage pill: thresholds and the three headers");
  let headers = {};
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ headers, body: accountsJson }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await rowsAre(pop, ROW, 1); await idle(pop, "#tab-accounts");
  const h = (name, value) => ({ [name]: typeof value === "string" ? value : JSON.stringify(value) });
  const cases = [
    ["a quiet answer (no usage header): the pill stays hidden", {}, "hidden", ""],
    ["x-app-usage 12 %: hidden (below 50)", h("x-app-usage", { call_count: 12, total_time: 5, total_cputime: 3 }), "hidden", ""],
    ["49 %: still hidden", h("x-app-usage", { call_count: 49 }), "hidden", ""],
    ["50 %: amber 'API 50%'", h("x-app-usage", { call_count: 50 }), "warn", "API 50%"],
    ["74 %: amber", h("x-app-usage", { total_time: 74 }), "warn", "API 74%"],
    ["75 %: red 'API 75%' (no pause yet)", h("x-app-usage", { total_cputime: 75 }), "bad", "API 75%"],
    ["94 %: red, still no pause", h("x-app-usage", { call_count: 94 }), "bad", "API 94%"],
    ["the worst of the numbers in one header counts (call_count 30, total_time 62.4, total_cputime 10 → 62 %)", h("x-app-usage", { call_count: 30, total_time: 62.4, total_cputime: 10 }), "warn", "API 62%"],
    ["x-business-use-case-usage: a list per business, the worst of every bucket (20 / 55 / 41 → 55 %)", h("x-business-use-case-usage", { 1001: [{ call_count: 20, total_cputime: 55, total_time: 10, type: "ads_management", estimated_time_to_regain_access: 0 }, { call_count: 41 }] }), "warn", "API 55%"],
    ["x-ad-account-usage: acc_id_util_pct 80.5 → rounded, red", h("x-ad-account-usage", { acc_id_util_pct: 80.5 }), "bad", "API 81%"],
    ["all three headers together: the highest of all (x-app 40, business 30, ad account 71 → 71 %, amber: red starts at 75)", { ...h("x-app-usage", { call_count: 40 }), ...h("x-business-use-case-usage", { 1: [{ call_count: 30 }] }), ...h("x-ad-account-usage", { acc_id_util_pct: 71 }) }, "warn", "API 71%"],
    ["a header that is not JSON, and numbers that are not numbers, are ignored: the pill keeps what it had (71 %)", { "x-app-usage": "<html>", "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: "99", call_count: null }) }, "warn", "API 71%"],
    ["an answer without any usage header keeps the last number too", {}, "warn", "API 71%"],
  ];
  for (const [name, hdr, cls, label] of cases) {
    headers = hdr;
    await resetLocks(pop); await pop.click("#loadAccounts"); await settle(pop); await idle(pop, "#tab-accounts");
    const got = await pill(pop);
    ok(name, got.cls.split(/\s+/).includes(cls) && (cls === "hidden" || got.text === label), JSON.stringify(got));
  }
  // 95 % and above is a pause, whatever the header and however far above it (the figure is capped at 100)
  for (const [name, hdr, shown] of [["95 % is the pause (the next call would be throttled)", h("x-app-usage", { call_count: 95 }), tr("usage.pause", { n: 30 })], ["a figure above 100 counts as 100", h("x-ad-account-usage", { acc_id_util_pct: 140 }), tr("usage.pause", { n: 30 })]]) {
    headers = hdr;
    await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: 0, usage: 0 })); await resetLocks(pop);
    await until(pop, async () => (await import(chrome.runtime.getURL("js/state.js"))).state.cooldownUntil === 0);
    await pop.click("#loadAccounts"); await idle(pop, "#tab-accounts");
    ok(name, await until(pop, (s) => document.querySelector("#usage").textContent.trim() === s, shown) && (await pill(pop)).cls === "bad" && (await stored(pop, "cooldownUntil")) > Date.now() + 29 * 60000, JSON.stringify(await pill(pop)));
  }
  await done(b);
}

export const flows = { throttle: throttleFlow, usagePill: pillFlow };
