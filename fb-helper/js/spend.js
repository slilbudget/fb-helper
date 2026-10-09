// Spend of an ad account for a period, and how amounts are added up. Shared by the Ad accounts tab and the Businesses tab, so
// both read the same numbers the same way. No DOM, no chrome.*, no state: the caller hands in what the numbers were fetched
// at (test/spend.test.mjs runs this file in plain Node).

import { major, sameDay, shortDate } from "./format.js";
import { lifetimeSpend, insightRow } from "./pure.js";
import { usdEquivalent } from "./money-core.js";

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
//   sort     the plain sum across currencies: only a "something is known" flag for compareSpend (-1 = nothing known), never an order by itself
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
// ---------- grouping and ordering (one way for every tab) ----------
// WHICH BUSINESS AN ACCOUNT BELONGS TO — one rule, two readings, every tab:
//   owner    a.business.id, the business that owns the account. SPEND is grouped by it (groupByBusiness): an account's spend is counted exactly
//            once, in its owner's group, so the group subtotals add up to the total of the list.
//   member   the owner OR the business the account was read through (a._bmId: an account the person only sees as a client of one of their own
//            businesses; business-edge reads set it, accounts.js readBmAccounts). COUNTS, STATUS and the "ad accounts of this business" filter
//            use it (inBusiness / membersByBusiness), so a business that has only shared (client) accounts never says "No ad accounts"
//            and the jump "Ad accounts →" from the Businesses tab lists the same accounts its count did.
// A client account therefore shows in two places: counted in its user's business, spent in its owner's group.
const bizId = (v) => (v === undefined || v === null || v === "" ? null : String(v));
export const inBusiness = (a, id) => id !== null && id !== undefined && (bizId(a?.business?.id) === String(id) || bizId(a?._bmId) === String(id));
// Business id → { id, name, accounts } over the member rule, first-seen order. Accounts without any business are in no entry.
export function membersByBusiness(accounts) {
  const map = new Map();
  for (const a of accounts || []) {
    for (const [id, name] of [[bizId(a?.business?.id), a?.business?.name], [bizId(a?._bmId), a?._bmName]]) {
      if (id === null) continue;
      let m = map.get(id);
      if (!m) map.set(id, m = { id, name: String(name ?? ""), accounts: [] });
      else if (!m.name && name) m.name = String(name);
      if (!m.accounts.includes(a)) m.accounts.push(a);
    }
  }
  return map;
}
// Accounts by the business that owns them (a.business.id): [{ id, name, accounts }], in first-seen order. Accounts without a
// business form the group with id null. The Ad accounts tab draws these as its group headers; the Businesses tab builds its
// rows' SPEND from them (its counts use the member rule above), so a business shows the same subtotal on both tabs.
export function groupByBusiness(accounts) {
  const groups = new Map();
  for (const a of accounts || []) {
    const raw = a?.business?.id;
    const id = raw === undefined || raw === null || raw === "" ? null : String(raw);
    let g = groups.get(id);
    if (!g) groups.set(id, g = { id, name: id ? String(a.business.name ?? "") : "", accounts: [] });
    else if (id && !g.name && a.business.name) g.name = String(a.business.name);
    g.accounts.push(a);
  }
  return [...groups.values()];
}
// Order of two addUp / mergeUp results, the bigger spend first (a Array.sort comparator; r = the rates() table or null).
// Only what can honestly be compared is compared:
//   - nothing known (sort < 0) goes last;
//   - both convertible to USD (every currency has a rate, USD always does; a zero spend is 0) → by USD value;
//   - a positive spend before a zero one, whatever the currency (zero is zero everywhere);
//   - the same single currency on both sides → by amount;
//   - otherwise (different currencies, a rate missing) 0: 25 000 000 VND is not "more" than 100 USD, so the raw numbers are never set against
//     each other, and the caller's next key (the name) decides. With three or more rows that mix currencies this can be a non-transitive
//     order; Array.sort never throws on that, it just keeps a stable arbitrary one, and the order is right again as soon as rates arrive.
export function compareSpend(a, b, r) {
  const unknownA = a.sort < 0, unknownB = b.sort < 0;
  if (unknownA || unknownB) return unknownA - unknownB;
  const ua = usdEquivalent(a.totals, r), ub = usdEquivalent(b.totals, r);
  if (ua !== null && ub !== null) return ub - ua;
  const ca = Object.keys(a.totals), cb = Object.keys(b.totals);
  if (!ca.length || !cb.length) return !ca.length - !cb.length;
  return ca.length === 1 && cb.length === 1 && ca[0] === cb[0] ? b.totals[cb[0]] - a.totals[ca[0]] : 0;
}
