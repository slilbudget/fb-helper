// js/accounts-model.js: what the Ad accounts tab asks of Graph, what a row keeps, which rows the search / chip / business filter leave, the chips and
// their order, "Active IDs", the groups and their order, the amount on line 1. Plain Node: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { BASE_FIELDS, OPTIONAL_FIELDS, PERIOD_INSIGHTS, AD_ALL, AD_ALL_INSIGHTS, AD_ALIASES, AD_STATUS, insightsOf, slimWith, word, CHIP_ORDER, chipRank,
  underBmFilter, visibleAccounts, chipCounts, chipsInOrder, isLive, liveIds, groupAccounts, valueOf } from "../fb-helper/js/accounts-model.js";
import { PERIODS } from "../fb-helper/js/spend.js";
import { accountState } from "../fb-helper/js/nextsteps.js";
import { setLang } from "../fb-helper/js/i18n.js";
import "../fb-helper/js/strings/actions.js";

await setLang("en");
const RLO = String.fromCharCode(0x202e), LRI = String.fromCharCode(0x2066);      // bidi controls, built from code points
const A = (id, name, status = 1, extra = {}) => ({ account_id: String(id), name, account_status: status, currency: "USD", ...extra });
const biz = (id, name) => ({ id, name });
const RATES = { rates: { USD: 1, EUR: 0.8, VND: 25000 }, date: "2026-10-08", source: "test" };

// ---------- what is asked ----------
test("the request: the base fields every account read needs, the optional ones in their own expressions, the four period aliases in one field", () => {
  for (const f of ["account_id", "account_status", "disable_reason", "currency", "timezone_name", "amount_spent", "balance", "business{id,name}"]) assert.ok(BASE_FIELDS.includes(f), `base has ${f}`);
  assert.ok(!BASE_FIELDS.some((f) => /access_token|funding_source|insights/.test(f)), "nothing optional or secret in the base");
  assert.deepEqual(Object.keys(OPTIONAL_FIELDS), ["funding_source_details", "adtrust_dsl", "adspaymentcycle", "adspixels", "insights"]);
  assert.equal(OPTIONAL_FIELDS.adspaymentcycle, "adspaymentcycle{threshold_amount}");
  assert.equal(OPTIONAL_FIELDS.insights, PERIOD_INSIGHTS, "all periods ride on one optional field: refused once, dropped once");
  const aliased = [...PERIOD_INSIGHTS.matchAll(/insights\.date_preset\((\w+)\)\.as\((\w+)\)\{spend,impressions,inline_link_clicks\}/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(aliased, [["today", "p_today"], ["yesterday", "p_yesterday"], ["last_7d", "p_week"], ["last_30d", "p_month"]], "one insights alias per period (not All time)");
  assert.deepEqual(PERIODS.filter((p) => p.alias).map((p) => [p.preset, p.alias]), aliased, "…the same table spend.js reads the answer with");
  assert.equal(insightsOf("today", "x"), "insights.date_preset(today).as(x){spend,impressions,inline_link_clicks}");
});

test("the per-ad request: All time is its own alias on date_preset=maximum, the rest of the aliases are the periods'", () => {
  assert.equal(AD_ALL, "p_all");
  assert.equal(AD_ALL_INSIGHTS, "insights.date_preset(maximum).as(p_all){spend,impressions,inline_link_clicks}");
  assert.deepEqual(AD_ALIASES, ["p_today", "p_yesterday", "p_week", "p_month", "p_all"]);
});

test("AD_STATUS: a tone for every status the ads read names; a problem is bad, a review is warn, a pause is quiet", () => {
  assert.equal(AD_STATUS.ACTIVE, "ok");
  assert.equal(AD_STATUS.DISAPPROVED, "bad"); assert.equal(AD_STATUS.WITH_ISSUES, "bad");
  for (const k of ["PENDING_REVIEW", "IN_PROCESS", "PREAPPROVED", "PENDING_BILLING_INFO"]) assert.equal(AD_STATUS[k], "warn", k);
  for (const k of ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "DELETED", "ARCHIVED"]) assert.equal(AD_STATUS[k], "", k);
});

// ---------- a row from Graph ----------
test("slimWith: every text from Graph is cleaned (bidi and control characters), nothing of the input is changed", () => {
  const raw = A(1, `Acc${RLO}fdp.exe\nsecond`, 1, { business: { id: "9", name: `Biz${LRI}x`, extra: "dropped" }, currency: `US${RLO}D`, timezone_name: `UT${RLO}C`, business_country_code: `U${RLO}S-and-a-long-tail`,
    adspixels: { data: [{ id: "7", name: `Pix${RLO}el`, secret: 1 }] }, funding_source_details: { display_string: `Visa${RLO} 4242`, id: "kept? no" } });
  const before = JSON.stringify(raw);
  const a = slimWith(new Set())(raw);
  assert.equal(a.name, "Accfdp.exe second");
  assert.deepEqual(a.business, { id: "9", name: "Bizx" }, "only id and name of the business");
  assert.equal(a.currency, "USD"); assert.equal(a.timezone_name, "UTC");
  assert.equal(a.business_country_code, "US-and-a", "cleaned and cut to 8");
  assert.deepEqual(a.adspixels, { data: [{ id: "7", name: "Pixel" }] });
  assert.deepEqual(a.funding_source_details, { display_string: "Visa 4242" }, "only the display string of the payment method");
  assert.equal(JSON.stringify(raw), before, "the answer itself is not mutated");
});

test("slimWith: a field Graph refused is marked (unknown, not 0 / none); the floor comes from today and the last 30 days", () => {
  const ins = (spend) => ({ data: [{ spend: String(spend) }] });
  const ok = slimWith(new Set())(A(1, "a", 1, { p_today: ins(3), p_month: ins(20) }));
  assert.equal(ok._noInsights, undefined); assert.equal(ok._noPixels, undefined);
  assert.equal(ok._floor, 23, "30 days + today is what is proven spent");
  const noIns = slimWith(new Set(["insights"]))(A(1, "a", 1, { p_today: ins(3), p_month: ins(20) }));
  assert.equal(noIns._noInsights, true); assert.equal(noIns._floor, undefined, "no insights read, nothing is proven");
  assert.equal(slimWith(new Set(["adspixels"]))(A(1, "a"))._noPixels, true);
  const bare = slimWith(new Set())({ account_id: "5" });
  assert.equal(bare.business, undefined); assert.equal(bare.funding_source_details, undefined); assert.equal(bare.adspixels, undefined);
  assert.equal(slimWith(new Set())(A(1, "a", 1, { business: "not an object" })).business, undefined);
});

// ---------- which rows ----------
const LIST = [
  A(1, "Tailspin US", 1, { business: biz("9001", "Tailspin Toys") }),
  A(2, "Tailspin CA", 2, { business: biz("9001", "Tailspin Toys"), disable_reason: 1 }),         // disabled: ads policy
  A(3, "Contoso EU", 3, { business: biz("9002", "Contoso Ads"), currency: "EUR" }),               // unpaid
  A(4, "Shared one", 1, { business: biz("9002", "Contoso Ads"), _viaBm: true, _bmId: "9001", _bmName: "Tailspin Toys" }),   // owned by Contoso, read through Tailspin, not assigned
  A(5, "Personal Alex", 1),
  A(6, "Old and closed", 101, { business: biz("9001", "Tailspin Toys") }),
  A(7, "Weird status", 999),
];
const names = (rows) => rows.map((a) => a.name);

test("visibleAccounts: the search finds a name, an id, a status word, a chip word or a business name, in any case, ignoring outer spaces", () => {
  assert.equal(visibleAccounts(LIST).length, 7, "no filter: everything, in list order");
  assert.deepEqual(names(visibleAccounts(LIST, { filter: "  tailSPIN " })), ["Tailspin US", "Tailspin CA", "Old and closed"], "a name, or the business that OWNS the account (the business an account is only read through is the business filter's, not the search's)");
  assert.deepEqual(names(visibleAccounts(LIST, { filter: "5" })), ["Personal Alex"], "an id");
  assert.deepEqual(names(visibleAccounts(LIST, { filter: "unpaid" })), ["Contoso EU"], "a status word");
  assert.deepEqual(names(visibleAccounts(LIST, { filter: "no access" })), ["Shared one"], "a read-through account says 'No access'");
  assert.deepEqual(names(visibleAccounts(LIST, { filter: "contoso" })), ["Contoso EU", "Shared one"], "the owner business, for an account read through another");
  assert.deepEqual(visibleAccounts(LIST, { filter: "zzz" }), []);
  assert.deepEqual(visibleAccounts(LIST, { filter: "" }), LIST); assert.deepEqual(visibleAccounts(LIST, { filter: "   " }), LIST, "spaces alone are no search");
});

test("visibleAccounts: a status chip keeps its status (not a word); the business filter keeps the members (owner or read-through); all three combine", () => {
  assert.deepEqual(names(visibleAccounts(LIST, { statusFilter: "2" })), ["Tailspin CA"]);
  assert.deepEqual(names(visibleAccounts(LIST, { statusFilter: "noaccess" })), ["Shared one"]);
  assert.deepEqual(names(visibleAccounts(LIST, { statusFilter: "no-such-chip" })), []);
  assert.deepEqual(names(visibleAccounts(LIST, { bmId: "9001" })), ["Tailspin US", "Tailspin CA", "Shared one", "Old and closed"], "owned by 9001 + the one read through 9001");
  assert.deepEqual(names(visibleAccounts(LIST, { bmId: "9002" })), ["Contoso EU", "Shared one"], "the owner's list has the shared one too");
  assert.deepEqual(visibleAccounts(LIST, { bmId: "777" }), [], "a business nobody belongs to");
  assert.deepEqual(names(visibleAccounts(LIST, { bmId: "9001", statusFilter: "active", filter: "tailspin" })), ["Tailspin US"]);
  assert.deepEqual(underBmFilter(LIST, null), LIST); assert.deepEqual(names(underBmFilter(LIST, "9002")), ["Contoso EU", "Shared one"]);
});

test("visibleAccounts: the state of an account comes from the caller's memo, once per call of stateOf", () => {
  let calls = 0;
  const stateOf = (a) => { calls++; return accountState(a); };
  visibleAccounts(LIST, { filter: "a" }, stateOf);
  assert.equal(calls, LIST.length, "one answer per account, not per word");
  assert.equal(word({ key: "status.3" }), "Unpaid"); assert.equal(word({ key: "status.other", vars: { n: 999 } }), "Status 999");
});

test("chips: one per status (not per reason), counted over the business filter only, in the order of the strip; an unknown status goes last", () => {
  const counts = chipCounts(LIST, null);
  assert.deepEqual([...counts.keys()], ["active", "2", "3", "noaccess", "101", "s999"], "first-seen order of the Map");
  assert.deepEqual(chipsInOrder(counts).map(({ chip, n }) => [chip.id, n]), [["active", 2], ["2", 1], ["3", 1], ["noaccess", 1], ["101", 1], ["s999", 1]]);
  assert.deepEqual(chipsInOrder(chipCounts(LIST, "9001")).map(({ chip, n }) => [chip.id, n]), [["active", 1], ["2", 1], ["noaccess", 1], ["101", 1]], "under a business filter only its accounts count");
  assert.equal(chipCounts([], null).size, 0);
  assert.deepEqual(CHIP_ORDER.map(chipRank), CHIP_ORDER.map((_, i) => i)); assert.equal(chipRank("s7"), CHIP_ORDER.length, "unknown ids sort after the known ones");
  // restricted = status Active with a disable reason: its own chip, not 'Active'
  assert.deepEqual(chipsInOrder(chipCounts([A(1, "r", 1, { disable_reason: 5 }), A(2, "ok", 1)], null)).map(({ chip }) => chip.id), ["active", "restricted"]);
});

test("Active IDs: the active accounts assigned to the person, in the order shown; one only read through a business is not theirs", () => {
  assert.equal(isLive(A(1, "a", 1)), true);
  assert.equal(isLive(A(1, "a", 1, { disable_reason: 5 })), true, "restricted is still ACTIVE");
  assert.equal(isLive(A(1, "a", 2)), false); assert.equal(isLive(A(1, "a", 1, { _viaBm: true })), false);
  assert.deepEqual(liveIds(LIST), ["1", "5"], "Shared one is ACTIVE but not assigned");
  assert.deepEqual(liveIds(visibleAccounts(LIST, { bmId: "9001" })), ["1"], "follows the filter");
  assert.deepEqual(liveIds([]), []);
});

// ---------- the groups ----------
const spendOf = (m) => new Map(m);
test("groupAccounts: biggest USD subtotal first with rates, personal last; inside a group active, then problem, then dead, each by spend", () => {
  const rows = [
    A(1, "Alpha active small", 1, { business: biz("1", "Alpha") }), A(2, "Alpha dead", 101, { business: biz("1", "Alpha") }), A(3, "Alpha problem", 3, { business: biz("1", "Alpha") }),
    A(4, "Alpha active big", 1, { business: biz("1", "Alpha") }),
    A(5, "Zeta VN", 1, { business: biz("2", "Zeta"), currency: "VND" }), A(6, "Mine", 1),
  ];
  const stats = spendOf([[rows[0], { spend: 10 }], [rows[1], { spend: 900 }], [rows[2], { spend: 50 }], [rows[3], { spend: 40 }], [rows[4], { spend: 50_000_000 }], [rows[5], { spend: 5000 }]]);
  const groups = groupAccounts(rows, stats, RATES, "en");
  assert.deepEqual(groups.map((g) => g.name), ["Zeta", "Alpha", ""], "Zeta = 2 000 USD, Alpha = 1 000 USD, the personal group (id null) is last whatever it spent");
  assert.equal(groups.at(-1).id, null);
  assert.deepEqual(names(groups[1].accounts), ["Alpha active big", "Alpha active small", "Alpha problem", "Alpha dead"], "active (by spend), then the problem, then the dead one although it spent the most");
  assert.deepEqual(groups[1].sum.totals, { USD: 1000 }, "the subtotal adds the group's accounts");
  assert.deepEqual(groups[0].sum.totals, { VND: 50_000_000 });
});

test("groupAccounts: without rates different currencies are never compared by their raw numbers: the name decides, the same currency is compared", () => {
  const rows = [A(1, "Zeta VN", 1, { business: biz("2", "Zeta"), currency: "VND" }), A(2, "A1", 1, { business: biz("1", "Alpha") }), A(3, "A2", 1, { business: biz("1", "Alpha") }),
    A(4, "Mixed", 1, { business: biz("3", "Mixed"), currency: "EUR" })];
  const stats = spendOf([[rows[0], { spend: 25_000_000 }], [rows[1], { spend: 100 }], [rows[2], { spend: 300 }], [rows[3], { spend: 5 }]]);
  const groups = groupAccounts(rows, stats, null, "en");
  assert.deepEqual(groups.map((g) => g.name), ["Alpha", "Mixed", "Zeta"], "VND 25 000 000 is not 'more' than 400 USD: by name");
  assert.deepEqual(names(groups[0].accounts), ["A2", "A1"], "inside Alpha the same currency is by amount ($300 before $100)");
});

test("groupAccounts: unknown spend goes after known; ties by name in the UI language; one personal group is a single group", () => {
  const rows = [A(1, "b", 1), A(2, "a", 1), A(3, "c", 1)];
  const stats = spendOf([[rows[0], null], [rows[1], { spend: 0 }], [rows[2], { spend: 0 }]]);
  const groups = groupAccounts(rows, stats, null, "en");
  assert.equal(groups.length, 1); assert.equal(groups[0].id, null);
  assert.deepEqual(names(groups[0].accounts), ["a", "c", "b"], "known zeros first (by name), the unknown one last");
  assert.deepEqual(groupAccounts([], new Map(), null, "en"), []);
  // names compare with the locale of the UI language
  const ru = [A(1, "Яблоко", 1), A(2, "Арбуз", 1)];
  assert.deepEqual(names(groupAccounts(ru, spendOf(ru.map((a) => [a, { spend: 0 }])), null, "ru")[0].accounts), ["Арбуз", "Яблоко"]);
});

// ---------- line 1 ----------
test("valueOf: the account's own currency, exact; unknown is a muted dash with the reason, zero is muted; a non-USD amount says its USD value in the tooltip", () => {
  assert.deepEqual(valueOf(A(1, "a"), null, null), { text: "—", muted: true, title: "No data for this period — refresh the list" });
  const zero = valueOf(A(1, "a"), { spend: 0 }, null); assert.equal(zero.text, "$0"); assert.equal(zero.muted, true); assert.equal(zero.title, null);
  const usd = valueOf(A(1, "a"), { spend: 12.4 }, RATES); assert.deepEqual(usd, { text: "$12.40", muted: false, title: null }, "a dollar amount has no second line");
  const eur = valueOf(A(1, "a", 1, { currency: "EUR" }), { spend: 680.4 }, RATES); assert.equal(eur.text, "€680.40"); assert.equal(eur.title, "≈ $850.50");
  assert.equal(valueOf(A(1, "a", 1, { currency: "EUR" }), { spend: 680.4 }, null).title, null, "no rates: no conversion is made up");
  const vnd = valueOf(A(1, "a", 1, { currency: "VND" }), { spend: 25_000_000 }, RATES);
  assert.match(vnd.text.replace(/\s/g, " "), /^VND 25M$/, "a million of an ISO-code currency is short");
  assert.equal(vnd.title.replace(/[^\S\n]/g, " "), "VND 25,000,000\n≈ $1,000", "its exact amount first, then the USD value");
});
