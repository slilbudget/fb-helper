// js/spend.js: what an ad account spent in a period, and how amounts are added up. Shared by the Ad accounts tab and the
// Businesses tab. Plain Node: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { PERIODS, isPeriod, statsOf, periodRange, addUp, mergeUp, totalsText } from "../fb-helper/js/spend.js";
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

test("mergeUp: the total of several sums; totalsText joins currencies with ' + '", () => {
  const a = addUp([{ spend: 10, currency: "USD" }]), b = addUp([{ spend: 4, currency: "EUR" }, { spend: null, currency: "EUR" }]), c = addUp([{ spend: 6, currency: "USD" }]);
  assert.deepEqual(mergeUp([a, b, c]), { totals: { USD: 16, EUR: 4 }, unknown: true, sort: 20 });
  assert.deepEqual(mergeUp([]), { totals: {}, unknown: false, sort: -1 });
  assert.equal(totalsText(mergeUp([a, b, c]).totals), "$16.00 + €4.00");
  assert.equal(totalsText({}), "");
});

import { groupByBusiness, sortKey } from "../fb-helper/js/spend.js";
test("groupByBusiness: by owner id, first-seen order, no-business group has id null", () => {
  const g = groupByBusiness([{ account_id: "1", business: { id: 9, name: "B" } }, { account_id: "2" }, { account_id: "3", business: { id: "9", name: "" } }, { account_id: "4", business: { id: "", name: "x" } }]);
  assert.deepEqual(g.map((x) => [x.id, x.name, x.accounts.map((a) => a.account_id)]), [["9", "B", ["1", "3"]], [null, "", ["2", "4"]]]);
});
test("sortKey: USD value with rates, plain sum without, -1 when unknown", () => {
  const r = { rates: { EUR: 0.5, VND: 25000 } };
  assert.equal(sortKey({ totals: { EUR: 10, VND: 250000 }, sort: 250010 }, r), 30);
  assert.equal(sortKey({ totals: { EUR: 10 }, sort: 10 }, null), 10);
  assert.equal(sortKey({ totals: {}, sort: -1 }, r), -1);
});
