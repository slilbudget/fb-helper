// The Businesses tab's logic without any DOM or chrome.*: what a business row keeps from Graph, how the rows are built from the
// business list AND the Ad accounts list (groupByBusiness, the very grouping the Ad accounts tab uses, so a business shows the same
// accounts and the same subtotal on both tabs), the problems with their fixes, the spend line of a row, search and order.
// test/bms.test.mjs runs this file in plain Node; bms.js only draws it.
//
// The tab answers one question: what do I have, and how much does each business spend? Docs for the business edge are thin
// and nothing here is live-verified (.notes/index.md, "In progress"): every field except id and name is optional, an
// unknown value is never guessed.

import { LINKS, imageUrl } from "./links.js";
import { addUp, mergeUp, groupByBusiness, sortKey } from "./spend.js";
import { rowAmount } from "./money-core.js";
import { cleanText } from "./pure.js";

// One paged read of me/businesses (graph.js readPaged). A token that cannot read an extra field just loses that field.
// Only what the tab uses: the verification state (a failed one is a problem) and the logo.
export const BM_BASE = ["id", "name"];
export const BM_OPTIONAL = {
  verification_status: "verification_status",
  profile_picture_uri: "profile_picture_uri",        // the business logo: only the URL is kept, and only if imageUrl() accepts it
};
export const BM_LIMIT = 50;
export const BM_MAX_PAGES = 4;                    // 200 businesses; more = "not all"
export const BM_SLOT_MS = 60 * 1000;              // claimSlot("bms", …): one attempt per minute, failed ones count

// ---------- rows from Graph ----------
// "verification_status" → "_noVerificationStatus": set on a row read while Graph refused that field (the cached value is
// unknown, not "none").
export const markerOf = (key) => `_no${key.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`;

const text = (v, max = 200) => (typeof v === "string" ? cleanText(v, max) : undefined);   // names: control and bidi characters out
// Whitelist: only these keys leave Graph's answer (and go into storage.session). null = not a usable row (no numeric id).
// skip = the Set of optional keys Graph refused so far; readPaged calls this per row, so a row keeps the skip state of its
// own page.
export function slimBm(raw, skip = new Set()) {
  if (!raw || typeof raw !== "object" || !/^\d{1,25}$/.test(String(raw.id ?? ""))) return null;
  const row = {
    id: String(raw.id), name: text(raw.name) ?? "",
    verification_status: text(raw.verification_status, 60),
    profile_picture_uri: imageUrl(raw.profile_picture_uri) ?? undefined,
  };
  for (const key of Object.keys(BM_OPTIONAL)) {
    if (skip.has(key)) { delete row[key]; row[markerOf(key)] = true; }
    else if (row[key] === undefined) delete row[key];
  }
  return row;
}

// ---------- verification ----------
// Only a business verification that went wrong is a problem (a pending or missing one is not something to act on); every state
// Graph names is still told in the expanded row (the kv "Verification").
export const VERIFY_BAD = ["failed", "rejected", "revoked", "expired"];
// The states Meta documents for Business.verification_status; anything else is shown as Graph sent it.
export const VERIFY_KNOWN = ["verified", "not_verified", "pending", "pending_need_more_info", "pending_submission", "ineligible", ...VERIFY_BAD];
const verState = (b) => (b && !b._noVerificationStatus && typeof b.verification_status === "string" ? b.verification_status.trim().toLowerCase() : "");
// → the exact state ("verified", "pending", …) or null when it is not known (field refused or not sent)
export const verificationOf = (b) => verState(b) || null;
// → "failed" | "rejected" | "revoked" | "expired" | null
export function badVerification(b) {
  const s = verState(b);
  return VERIFY_BAD.includes(s) ? s : null;
}

// ---------- counts and state ----------
// From the Ad accounts list: account_status 1 = active, 2 = disabled ("disabled" is exactly the Ad accounts tab's "Disabled", so the
// number matches what that tab shows after the click); closed (101), pending closure (100) and the unsettled / review statuses count
// in the total only.
export function countAccounts(accounts) {
  const c = { total: 0, active: 0, disabled: 0 };
  for (const a of accounts) {
    c.total++;
    if (a.account_status === 1) c.active++;
    else if (a.account_status === 2) c.disabled++;
  }
  return c;
}
// "active": at least one active ad account. "noActive": it has ad accounts, none of them active. "none": the loaded list has no ad
// account of this business. null = no verdict: the Ad accounts list is not loaded, or it stopped at its page limit (then only
// "active" is still a fact: there may be more accounts than were read, so "none" and "noActive" could be false).
export function stateOf(counts, { loaded, truncated = false }) {
  if (!loaded) return null;
  if (counts.active) return "active";
  return truncated ? null : counts.total ? "noActive" : "none";
}

// ---------- the rows of the list ----------
// bms = the slimmed me/businesses rows; accounts = the Ad accounts list (each with business { id, name } or none);
// loaded = the accounts list has been read; stats(account) → { spend } | null for the selected period (null = unknown).
// One row per business, from groupByBusiness(accounts) joined with `bms`: every business of the profile (even one with no ad
// account) and every other business an account names (client accounts of a business the profile does not manage: named from the
// account, no logo, `known` false). Accounts that have no business belong to no row: this tab is about businesses, the Ad
// accounts tab has the rest.
// → [{ key, id, name, known, picture, accounts, counts, partial, state, verification, verificationState, spend, issues }]
//   partial = the accounts list is incomplete (counts are "at least")
export function buildRows({ bms = [], accounts = [], loaded = false, truncated = false, stats = () => null } = {}) {
  const byBiz = new Map(groupByBusiness(accounts).filter((g) => g.id !== null).map((g) => [g.id, g]));
  const ids = new Map();
  for (const b of bms) if (b && !ids.has(b.id)) ids.set(b.id, b);
  for (const id of byBiz.keys()) if (!ids.has(id)) ids.set(id, null);
  return [...ids].map(([id, bm]) => {
    const g = byBiz.get(id), list = g?.accounts ?? [];
    const counts = countAccounts(list);
    const row = {
      key: id, id, name: bm?.name || g?.name || "", known: !!bm, picture: bm?.profile_picture_uri,
      accounts: list, counts, partial: loaded && truncated, state: stateOf(counts, { loaded, truncated }),
      verification: badVerification(bm), verificationState: verificationOf(bm),
      spend: addUp(list.map((a) => ({ spend: stats(a)?.spend ?? null, currency: a.currency }))),
    };
    row.issues = issuesOf(row);
    return row;
  });
}

// ---------- problems and their fixes ----------
// Data, so a test can walk every one. label / tip / help = i18n keys; fix = where it is fixed: label / tip (i18n keys) and url(row) →
// https URL or null (a null drops the link). One fix per problem, always a page that links.js built; the extension changes nothing
// by opening it. Order = severity. line = the fix goes on line 2 of the collapsed row (only when it is the worst problem);
// "None active" has no fix there: the way in is the "Show ad accounts" button, the Business Settings link waits in the body.
export const PROBLEMS = [
  { id: "verification", tone: "bad", has: (r) => !!r.verification, label: "bms.st.unverified", tip: "bms.verTitle", help: "bms.help.verification", line: true,
    fix: { label: "bms.fix.verify", tip: "bms.fix.verifyTitle", url: (r) => LINKS.bmSecurity(r.id) } },
  { id: "noActive", tone: "bad", has: (r) => r.state === "noActive", label: "bms.st.noActive", tip: "bms.st.noActive.title", help: "bms.help.noActive", line: false,
    fix: { label: "bms.fix.accounts", tip: "bms.fix.accountsTitle", url: (r) => LINKS.bmAdAccounts(r.id) } },
  { id: "none", tone: "warn", has: (r) => r.state === "none", label: "bms.st.none", tip: "bms.st.none.title", help: "bms.help.none", line: true,
    fix: { label: "bms.fix.create", tip: "bms.fix.createTitle", url: (r) => LINKS.bmAdAccounts(r.id) } },
];
// [{ id, tone, label, tip, help, line, fix: { label, tip, url } | null }] for one row, worst first. The fixes are links into the settings
// of THAT business, so a business the profile does not manage (only named by a client account) has the problems but no fix.
export function issuesOf(row) {
  return PROBLEMS.filter((p) => p.has(row)).map((p) => {
    const url = row.known ? p.fix.url(row) : null;
    return { id: p.id, tone: p.tone, label: p.label, tip: p.tip, help: p.help, line: p.line, fix: url ? { label: p.fix.label, tip: p.fix.tip, url } : null };
  });
}

// ---------- the spend of a row ----------
// What the right-hand amount of a row says, for the selected period. Exact for one currency ("$100.00") and for two ("$100.00 + €50.00"),
// "≈ $1,770" from three on (rates needed; without them the first two and "+N"). A row never says "≈" for fewer than three currencies;
// the grand total is the one place that does (period.js fillTotal → totalLine).
//   kind  "unloaded" (the Ad accounts list is not read yet) · "none" (no ad account) · "unknown" (no number for this period) ·
//         "zero" (every spend was 0; cur = the currency) · "exact" · "approx"
//   text  the amount ("" for the kinds that print a dash)   title  tooltip text of the amount, every currency  full  every currency, exact
//   notAll  some of its accounts have no number for this period (the amount is a part of the truth)
export function spendOf(row, { loaded, rates = null } = {}) {
  if (!loaded) return { kind: "unloaded", text: "", title: "", full: "", notAll: false };
  const s = row.spend, line = rowAmount(s.totals, rates);
  if (line.main) {
    const extra = line.parts.length - 2;
    const text = !line.approx && extra > 0 ? `${line.parts[0].text} + ${line.parts[1].text} +${extra}` : line.main;   // no rates, 3+ currencies: never a line wider than the row
    return { kind: line.approx ? "approx" : "exact", text, title: line.approx ? line.title : extra > 0 ? line.full : "", full: line.full, notAll: s.unknown };
  }
  if (s.unknown) return { kind: "unknown", text: "", title: "", full: "", notAll: true };
  const cur = row.accounts[0]?.currency;
  return cur ? { kind: "zero", text: "", title: "", full: "", cur, notAll: false } : { kind: "none", text: "", title: "", full: "", notAll: false };
}

// ---------- the list ----------
// Search by name or id.
export const matchRow = (r, q) => {
  const s = String(q ?? "").trim().toLowerCase();
  return !s || `${r.name || ""} ${r.id || ""}`.toLowerCase().includes(s);
};
export const filterRows = (rows, q = "") => rows.filter((r) => matchRow(r, q));
// Most spend first by its USD equivalent when every currency has a rate (rates = money.js table), else by the plain sum (right whenever
// the compared amounts share a currency; spend.js sortKey); an unknown spend last; then more active ad accounts, then name, then id.
export function sortRows(rows, rates = null) {
  const key = new Map(rows.map((r) => [r, sortKey(r.spend, rates)]));
  return [...rows].sort((a, b) => key.get(b) - key.get(a) || b.counts.active - a.counts.active
    || String(a.name || "").localeCompare(String(b.name || "")) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
// The total over these rows: the same shape as spend.js addUp (the sum of the rows).
export const totalOf = (rows) => mergeUp(rows.map((r) => r.spend));

// ---------- errors ----------
// The token cannot read the business edge at all: (#10) permission, (#200–299) permission family, or (#100) that is not about
// a field (a field error names the field and is handled by readPaged; one that still gets here names a base field, which is
// a plain error). Shown as a calm note in the list, not a red toast. A session error (190/102) never gets here: graph.js
// turns it into the dead-session path.
export function isPermError(e) {
  const code = Number(e?.code);
  if (code === 10 || (code >= 200 && code <= 299)) return true;
  return code === 100 && !/field/i.test(e?.raw || e?.message || "");
}
