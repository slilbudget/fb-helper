// The Ad accounts tab's logic without any DOM or chrome.*: what is asked of Graph (the fields, the aliases of the spend periods), what a
// row keeps from Graph's answer, which rows a search / status chip / business filter leaves, the status chips and their order, "Active IDs",
// the groups by business with their order, and the amount on line 1 of a row. test/accounts.test.mjs runs this file in plain Node;
// accounts.js only draws it (and loads it). The state of one account (its word, fix, chip) is nextsteps.js accountState.

import { t } from "./i18n.js";
import { spendFloor, cleanText } from "./pure.js";
import { fmtMoney, toUsd } from "./money.js";
import { PERIODS, addUp, mergeUp, groupByBusiness, inBusiness, compareSpend } from "./spend.js";
import { accountState } from "./nextsteps.js";

// ---------- what is asked of Graph ----------
export const BASE_FIELDS = ["name", "account_id", "account_status", "disable_reason", "currency", "timezone_name",
  "amount_spent", "balance", "spend_cap", "created_time", "business{id,name}",
  "business_country_code"];
// All periods in one request via field aliases (live-checked 2026-09-27). Used by the accounts read and by the
// per-ad numbers, so switching the period never needs a request.
export const insightsOf = (preset, alias) => `insights.date_preset(${preset}).as(${alias}){spend,impressions,inline_link_clicks}`;
export const PERIOD_INSIGHTS = PERIODS.filter((p) => p.alias).map((p) => insightsOf(p.preset, p.alias)).join(",");
// Per ad only: "All time" = Graph's date_preset=maximum (Meta keeps at most 37 months; documented, replaced "lifetime" in v10).
// Accounts use their amount_spent field for it, which has no per-ad twin. Kept apart because it is the heaviest read.
export const AD_ALL = "p_all";
export const AD_ALL_INSIGHTS = insightsOf("maximum", AD_ALL);
export const AD_ALIASES = [...PERIODS.filter((p) => p.alias).map((p) => p.alias), AD_ALL];
// Extras that some tokens can't read. On a field error only the named one is dropped and the page retried.
// Today's spend rides on the same call (date_preset=today = each account's own timezone).
export const OPTIONAL_FIELDS = {
  funding_source_details: "funding_source_details",
  adtrust_dsl: "adtrust_dsl",
  adspaymentcycle: "adspaymentcycle{threshold_amount}",
  adspixels: "adspixels{id,name}",
  insights: PERIOD_INSIGHTS,
};
// Tone per Meta status code of an AD; the label is t("ad.<status>").
export const AD_STATUS = {
  ACTIVE: "ok", PAUSED: "", PENDING_REVIEW: "warn", IN_PROCESS: "warn", DISAPPROVED: "bad", WITH_ISSUES: "bad",
  CAMPAIGN_PAUSED: "", ADSET_PAUSED: "", PREAPPROVED: "warn", PENDING_BILLING_INFO: "warn", DELETED: "", ARCHIVED: "",
};

// ---------- a row from Graph ----------
// Mark rows fetched without an optional field (spend = unknown, not 0; pixels = unknown, not none)
// and keep only the display string of the funding source.
// _floor: what the insights already prove was spent (today + last 30 days), kept for the "All time" figure.
const spendOfRow = (x) => Number(x?.data?.[0]?.spend);
// Every text Graph sends is cleaned (pure.js cleanText: control and bidi characters): names go to the screen, to storage and into search.
// skip = the Set of optional keys Graph refused so far (readPaged calls this per row, so a row keeps the skip state of its own page).
export const slimWith = (skip) => (a) => ({ ...a, _noInsights: skip.has("insights") || undefined,
  name: cleanText(a.name), business_country_code: cleanText(a.business_country_code, 8) || undefined,
  currency: cleanText(a.currency, 8) || undefined, timezone_name: cleanText(a.timezone_name, 64) || undefined,   // both are printed raw when Intl does not know them
  business: a.business && typeof a.business === "object" ? { id: a.business.id, name: cleanText(a.business.name) } : undefined,
  _floor: skip.has("insights") ? undefined : spendFloor(spendOfRow(a.p_today), spendOfRow(a.p_month)),
  _noPixels: skip.has("adspixels") || undefined,
  adspixels: Array.isArray(a.adspixels?.data) ? { data: a.adspixels.data.map((p) => ({ id: p?.id, name: cleanText(p?.name) })) } : a.adspixels,
  funding_source_details: a.funding_source_details ? { display_string: cleanText(a.funding_source_details.display_string) } : undefined });

// ---------- which rows, which chips ----------
// What a status word says: { key, vars } → text.
export const word = (w) => t(w.key, w.vars);
// The status chips filter by status, not by reason: "Disabled 2", not one chip per reason.
export const CHIP_ORDER = ["active", "2", "3", "restricted", "noaccess", "7", "8", "9", "100", "101"];
export const chipRank = (id) => { const i = CHIP_ORDER.indexOf(id); return i < 0 ? CHIP_ORDER.length : i; };

// The accounts of the business the Businesses tab sent us to (spend.js: owner OR read-through business, the member rule its count used).
export const underBmFilter = (accounts, bmId) => (bmId ? accounts.filter((a) => inBusiness(a, bmId)) : accounts);
// Rows matching the search + status chip + business filter, in list order. The total, the count and "Active IDs" all follow it.
// view = { filter: the search text, statusFilter: a chip id | null, bmId: a business id | null }; stateOf(a) = accountState(a), memoised by the caller.
export function visibleAccounts(accounts, { filter = "", statusFilter = null, bmId = null } = {}, stateOf = accountState) {
  const q = filter.trim().toLowerCase();
  return underBmFilter(accounts, bmId).filter((a) => {
    const s = stateOf(a);
    if (statusFilter && s.chip.id !== statusFilter) return false;
    return !q || `${a.name} ${a.account_id} ${word(s.word)} ${word(s.chip)} ${a.business?.name || ""}`.toLowerCase().includes(q);
  });
}
// The chips count the rows the business filter leaves (not the search or the chip itself: the other chips must stay to switch to).
// → Map chip id → { chip, n } in order of first appearance; chipsInOrder() puts them in the order of the strip.
export function chipCounts(accounts, bmId, stateOf = accountState) {
  const counts = new Map();
  for (const a of underBmFilter(accounts, bmId)) { const c = stateOf(a).chip; const e = counts.get(c.id); if (e) e.n++; else counts.set(c.id, { chip: c, n: 1 }); }
  return counts;
}
export const chipsInOrder = (counts) => [...counts.values()].sort((x, y) => chipRank(x.chip.id) - chipRank(y.chip.id));
// "Active IDs" = the active accounts the person works with: assigned to them. An account only read through a business (_viaBm: "No access")
// is not one of them, whatever its status; it would put an id into the list that this person cannot use.
export const isLive = (a) => a.account_status === 1 && !a._viaBm;
export const liveIds = (rows) => rows.filter(isLive).map((a) => a.account_id);

// ---------- the groups ----------
// Groups by business, the biggest spender first (USD equivalent; without rates only comparable amounts are compared: spend.js compareSpend);
// inside a group active accounts by spend, then the ones with a problem, then the dead ones; the personal group (no business) last.
// stats = Map account → { spend, … } | null (the period's numbers); r = the rates ({ rates, … }) or null; lang = the UI language (names are
// compared with that locale). → [{ id, name, accounts, sum }], each with its accounts sorted and the sum of their spend (spend.js mergeUp).
const RANK = { active: 0, problem: 1, dead: 2 };
export function groupAccounts(rows, stats, r, lang, stateOf = accountState) {
  const part = new Map(rows.map((a) => [a, addUp([{ spend: stats.get(a)?.spend ?? null, currency: a.currency }])]));
  const byName = (x, y) => String(x || "").localeCompare(String(y || ""), lang);
  const groups = groupByBusiness(rows);
  for (const g of groups) {
    g.accounts.sort((a, b) => RANK[stateOf(a).group] - RANK[stateOf(b).group] || compareSpend(part.get(a), part.get(b), r) || byName(a.name, b.name));
    g.sum = mergeUp(g.accounts.map((a) => part.get(a)));
  }
  groups.sort((a, b) => (a.id === null) - (b.id === null) || compareSpend(a.sum, b.sum, r) || byName(a.name, b.name));   // the personal group (no business) is last
  return groups;
}

// ---------- the amount on line 1 ----------
// The account's own currency, exact; zero or unknown is muted. A non-USD amount says its USD value in the tooltip
// when the rates are known (never on screen: "≈" belongs to the grand total only). st = the period's stats of the account, or null (unknown).
export function valueOf(a, st, r) {
  if (!st) return { text: "—", muted: true, title: t("acc.noPeriod") };
  const usd = st.spend && (a.currency || "USD") !== "USD" ? toUsd(st.spend, a.currency, r) : null;
  // A million or more of an ISO-code currency is written short ("28,9 млн VND"); the exact amount is the tooltip's.
  const text = fmtMoney(st.spend, a.currency, { compact: true }), exact = fmtMoney(st.spend, a.currency);
  return { text, muted: !st.spend, title: [text !== exact ? exact : "", usd !== null ? `≈ ${fmtMoney(usd, "USD")}` : ""].filter(Boolean).join("\n") || null };
}
