// js/spend.js: what an ad account spent in a period, and how amounts are added up. Shared by the Ad accounts tab and the
// Businesses tab. Plain Node: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { PERIODS, isPeriod, statsOf, periodRange, addUp, mergeUp } from "../fb-helper/js/spend.js";
import { setLang } from "../fb-helper/js/i18n.js";

await setLang("en");
const today = new Date().toISOString().slice(0, 10);
const row = (spend, extra = {}) => ({ data: [{ spend: String(spend), impressions: "10", inline_link_clicks: "2", date_start: today, date_stop: today, ...extra }] });
const acc = (over = {}) => ({ account_id: "1", currency: "USD", timezone_name: "UTC", amount_spent: "5000", p_today: row(12.5), p_week: row(80), ...over });

test("periods: the five of the Accounts tab, in order; only 'all' has no Graph preset", () => {
  assert.deepEqual(PERIODS.map((p) => p.key), ["today", "yesterday", "week", "month", "all"]);
  assert.deepEqual(PERIODS.filter((p) => !p.alias).map((p) => p.key), ["all"]);
  assert.deepEqual(PERIODS.filter((p) => p.alias).map((p) => p.preset), ["today", "yesterday", "last_7d", "last_30d"]);
  assert.ok(isPeriod("week") && !isPeriod("year") && !isPeriod(null));
});

test("statsOf: the period's insights of the account; a missing row is a real 0; unknown is null", () => {
  const now = Date.now();
  assert.equal(statsOf(acc(), "today", now).spend, 12.5);
  assert.equal(statsOf(acc(), "week", now).spend, 80);
  assert.deepEqual(statsOf(acc({ p_today: undefined }), "today", now), { spend: 0, imp: 0, clicks: 0 }, "Graph omits the key when nothing was delivered");
  assert.equal(statsOf(acc({ p_today: row("n/a") }), "today", now), null, "a spend that is not a number");
  assert.equal(statsOf(acc({ _noInsights: true }), "today", now), null, "the field was refused for this token");
  assert.equal(statsOf(acc(), "today", 0), null, "no list fetched yet");
  assert.equal(statsOf(acc(), "today", now - 3 * 86400000), null, "cached on an earlier day: not today's number");
});

test("statsOf 'all': Meta's amount_spent in major units, never below what today + 30 days already showed; needs no fetch time", () => {
  assert.equal(statsOf(acc(), "all", 0).spend, 50, "5000 minor units");
  assert.equal(statsOf(acc({ amount_spent: "100", _floor: 70 }), "all", 0).spend, 70, "Meta lags: the proven floor wins");
  assert.equal(statsOf(acc({ currency: "JPY", amount_spent: "5000" }), "all", 0).spend, 5000, "no minor units in yen");
  assert.equal(statsOf(acc({ amount_spent: undefined }), "all", 0).spend, 0);
});

test("periodRange: the dates of the first account that has them; none for All time", () => {
  assert.ok(periodRange([acc()], "today", Date.now()) !== "", "one day");
  assert.ok(!periodRange([acc()], "today", Date.now()).includes("–"), "one day is not a range");
  const wk = acc({ p_week: row(80, { date_start: "2026-10-01", date_stop: "2026-10-07" }) });
  assert.equal(periodRange([wk], "week", Date.now()), "Oct 1–Oct 7");
  assert.equal(periodRange([acc()], "all", 0), "");
  assert.equal(periodRange([], "today", Date.now()), "");
  assert.equal(periodRange([acc({ _noInsights: true }), wk], "week", Date.now()), "Oct 1–Oct 7", "an account without numbers is skipped");
});

test("addUp: per currency, zeros add no currency, unknown is flagged, sort is the plain sum (-1 when nothing is known)", () => {
  assert.deepEqual(addUp([{ spend: 10, currency: "USD" }, { spend: 5.5, currency: "USD" }, { spend: 20, currency: "EUR" }]),
    { totals: { USD: 15.5, EUR: 20 }, unknown: false, sort: 35.5 });
  assert.deepEqual(addUp([{ spend: 0, currency: "USD" }]), { totals: {}, unknown: false, sort: 0 }, "a zero spend is known and adds nothing");
  assert.deepEqual(addUp([{ spend: null, currency: "USD" }, { spend: 3, currency: "USD" }]), { totals: { USD: 3 }, unknown: true, sort: 3 });
  assert.deepEqual(addUp([{ spend: null, currency: "USD" }]), { totals: {}, unknown: true, sort: -1 });
  assert.deepEqual(addUp([]), { totals: {}, unknown: false, sort: -1 });
});

test("mergeUp: the total of several sums", () => {
  const a = addUp([{ spend: 10, currency: "USD" }]), b = addUp([{ spend: 4, currency: "EUR" }, { spend: null, currency: "EUR" }]), c = addUp([{ spend: 6, currency: "USD" }]);
  assert.deepEqual(mergeUp([a, b, c]), { totals: { USD: 16, EUR: 4 }, unknown: true, sort: 20 });
  assert.deepEqual(mergeUp([]), { totals: {}, unknown: false, sort: -1 });
});

import { groupByBusiness, compareSpend, inBusiness, membersByBusiness } from "../fb-helper/js/spend.js";
test("groupByBusiness: by owner id, first-seen order, no-business group has id null", () => {
  const g = groupByBusiness([{ account_id: "1", business: { id: 9, name: "B" } }, { account_id: "2" }, { account_id: "3", business: { id: "9", name: "" } }, { account_id: "4", business: { id: "", name: "x" } }]);
  assert.deepEqual(g.map((x) => [x.id, x.name, x.accounts.map((a) => a.account_id)]), [["9", "B", ["1", "3"]], [null, "", ["2", "4"]]]);
});

// ---------- the order of spends ----------
const up = (...items) => addUp(items.map(([currency, spend]) => ({ currency, spend })));
const sorted = (parts, r) => [...parts].sort((a, b) => compareSpend(a, b, r));
test("compareSpend with rates: by USD value, whatever the currency (250 000 dong are $10, not more than $50)", () => {
  const r = { rates: { EUR: 0.5, VND: 25000 } };
  const vnd = up(["VND", 250000]), usd = up(["USD", 50]), eur = up(["EUR", 10]), mixed = up(["EUR", 10], ["VND", 250000]);
  assert.deepEqual(sorted([vnd, usd, eur, mixed], r), [usd, mixed, eur, vnd], "50, 30, 20, 10");
  assert.equal(compareSpend(usd, usd, r), 0);
});
test("compareSpend without rates: nothing is set against nothing it cannot be compared with (C10)", () => {
  const vnd = up(["VND", 25000000]), usd = up(["USD", 100]), usd2 = up(["USD", 40]), zero = up(["USD", 0]), unknown = up(["USD", null]), eur = up(["EUR", 5]);
  assert.equal(compareSpend(vnd, usd, null), 0, "25 000 000 dong is not 'more' than 100 dollars: a tie, the name decides");
  assert.equal(compareSpend(usd, eur, null), 0);
  assert.ok(compareSpend(usd, usd2, null) < 0, "the same currency: by amount, bigger first");
  assert.ok(compareSpend(usd2, usd, null) > 0);
  assert.ok(compareSpend(vnd, zero, null) < 0 && compareSpend(zero, vnd, null) > 0, "a positive spend before a zero one in any currency");
  assert.equal(compareSpend(zero, up(["EUR", 0]), null), 0, "two zeros tie");
  assert.ok(compareSpend(zero, unknown, null) < 0 && compareSpend(unknown, zero, null) > 0, "nothing known goes last");
  assert.equal(compareSpend(unknown, up(["EUR", null]), null), 0);
  // a rate table that lacks a currency is as good as no table for that comparison
  const partial = { rates: { EUR: 0.5 } };
  assert.equal(compareSpend(vnd, usd, partial), 0, "VND has no rate: not compared by raw number");
  assert.ok(compareSpend(usd, eur, partial) < 0, "USD and EUR have: $100 vs $10");
  // three mixed rows still sort without throwing, and the result does not depend on the input order for comparable pairs
  const rows = [vnd, usd, usd2, eur, zero, unknown];
  const a = sorted(rows, null), b = sorted([...rows].reverse(), null);
  assert.ok(a.indexOf(usd) < a.indexOf(usd2) && b.indexOf(usd) < b.indexOf(usd2));
  assert.equal(a[a.length - 1], unknown); assert.equal(b[b.length - 1], unknown);
});
test("compareSpend: a USD-only sum converts without any table", () => {
  assert.ok(compareSpend(up(["USD", 9]), up(["USD", 3]), null) < 0);
  assert.ok(compareSpend(up(["USD", 9], ["USD", 2]), up(["USD", 3]), null) < 0, "11 vs 3");
});

// ---------- which business an account belongs to ----------
test("inBusiness: the owner (a.business.id) or the business it was read through (a._bmId), ids compared as strings", () => {
  const own = { account_id: "1", business: { id: 9, name: "Own" } }, shared = { account_id: "2", business: { id: "7", name: "Owner" }, _bmId: "9", _viaBm: true }, none = { account_id: "3" };
  assert.ok(inBusiness(own, "9") && inBusiness(own, 9), "owner, number or string");
  assert.ok(inBusiness(shared, "7") && inBusiness(shared, "9"), "a client account is a member of both the owner and the business that reads it");
  assert.ok(!inBusiness(shared, "8") && !inBusiness(none, "9"));
  for (const bad of [null, undefined, ""]) assert.ok(!inBusiness(shared, bad), String(bad));
  assert.ok(!inBusiness(none, null) && !inBusiness(none, undefined), "no id matches an account without a business");
  assert.ok(!inBusiness(null, "9"));
});
test("membersByBusiness: business id → its members (owner or read-through), names from either side, in first-seen order; spend grouping stays with the owner", () => {
  const a1 = { account_id: "1", business: { id: "9", name: "Nine" } };
  const a2 = { account_id: "2", business: { id: "7", name: "Seven" }, _bmId: "9", _bmName: "Nine too", _viaBm: true };
  const a3 = { account_id: "3", _bmId: "5", _bmName: "Five", _viaBm: true, business: { id: "5" } };
  const a4 = { account_id: "4" };
  const m = membersByBusiness([a1, a2, a3, a4]);
  assert.deepEqual([...m.keys()], ["9", "7", "5"]);
  assert.deepEqual(m.get("9").accounts, [a1, a2]);
  assert.equal(m.get("9").name, "Nine"); assert.equal(m.get("5").name, "Five", "an owner without a name is named by the read-through side"); assert.deepEqual(m.get("5").accounts, [a3], "owner = read-through: once");
  assert.deepEqual(m.get("7").accounts, [a2]);
  assert.ok(![...m.values()].some((x) => x.accounts.includes(a4)));
  assert.deepEqual(groupByBusiness([a1, a2, a3, a4]).map((g) => [g.id, g.accounts.length]), [["9", 1], ["7", 1], ["5", 1], [null, 1]], "groupByBusiness: the owner only");
  assert.equal(membersByBusiness(undefined).size, 0);
});
