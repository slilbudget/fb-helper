// Spend of an ad account for a period, and how amounts are added up. Shared by the Ad accounts tab and the Businesses tab, so
// both read the same numbers the same way. No DOM, no chrome.*, no state: the caller hands in what the numbers were fetched
// at (test/spend.test.mjs runs this file in plain Node).

import { major, sameDay, shortDate, fmt } from "./format.js";
import { lifetimeSpend, insightRow } from "./pure.js";

// Spend periods. Meta's last_7d / last_30d end yesterday (today excluded). "all" = Meta's amount_spent, raised to 30 days + today if that is more.
// preset = Graph's date_preset; alias = the field alias its numbers come back under ("all" has neither).
export const PERIODS = [
  { key: "today", label: "period.today", preset: "today", alias: "p_today" },
  { key: "yesterday", label: "period.yesterday", preset: "yesterday", alias: "p_yesterday" },
  { key: "week", label: "period.week", preset: "last_7d", alias: "p_week" },
  { key: "month", label: "period.month", preset: "last_30d", alias: "p_month" },
  { key: "all", label: "period.all" },
];
export const isPeriod = (key) => PERIODS.some((p) => p.key === key);
const periodOf = (key) => PERIODS.find((p) => p.key === key) || PERIODS[0];

// Spend for the period → { spend, imp, clicks, from?, to? }, or null when unknown (field unavailable, or the cache is from an
// earlier day in that account's timezone); a missing row = no delivery = 0.
// FIELD 2026-09-27: Graph omits a nested insights key entirely when there is no delivery in the period (not `data: []`), so a
// missing key on a row fetched WITH the field is a real 0.
// fetchedAt: when the account list was fetched (state.fetchedAt).
export function statsOf(a, key, fetchedAt) {
  if (key === "all") {
    // Meta's total, but never below what the last 30 days + today showed when the list was fetched (see lifetimeSpend).
    return { spend: lifetimeSpend(major(a.amount_spent || 0, a.currency), a._floor), imp: null, clicks: null };
  }
  if (!fetchedAt || a._noInsights) return null;
  if (!sameDay(a.timezone_name, fetchedAt)) return null;
  return insightRow(a[periodOf(key).alias]);
}

// "Aug 29" / "Aug 23–Aug 29": the dates of the period, from the first account that has them. "" for All time.
export function periodRange(accounts, key, fetchedAt) {
  for (const a of accounts) {
    const s = statsOf(a, key, fetchedAt);
    if (s?.from) return s.from === s.to ? shortDate(s.from) : `${shortDate(s.from)}–${shortDate(s.to)}`;
  }
  return "";
}

// ---------- adding up ----------
// items = [{ spend: number | null, currency }]  (null = unknown for this period)
// → { totals: { USD: 12.4 }, unknown, sort }
//   totals   per currency; a zero adds no currency (the caller prints a zero of its own currency)
//   unknown  some item had no number
//   sort     the plain sum across currencies, only to order rows (accounts are ordered the same way); -1 when nothing is known
export function addUp(items) {
  const totals = {};
  let unknown = false, sum = null;
  for (const { spend, currency } of items) {
    if (spend === null || spend === undefined) { unknown = true; continue; }
    sum = (sum ?? 0) + spend;
    if (spend) totals[currency] = (totals[currency] || 0) + spend;
  }
  return { totals, unknown, sort: sum ?? -1 };
}
// Several addUp results as one (the total of a list of rows).
export function mergeUp(parts) {
  const totals = {};
  let unknown = false, sum = null;
  for (const p of parts) {
    for (const [cur, v] of Object.entries(p.totals)) totals[cur] = (totals[cur] || 0) + v;
    unknown ||= p.unknown;
    if (p.sort >= 0) sum = (sum ?? 0) + p.sort;
  }
  return { totals, unknown, sort: sum ?? -1 };
}
// "$12.40 + €5.00" ("" when every spend was zero).
export const totalsText = (totals) => Object.entries(totals).map(([cur, v]) => fmt(v, cur)).join(" + ");
