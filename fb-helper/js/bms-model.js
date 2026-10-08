// The Businesses tab's logic without any DOM, chrome.* or i18n: what a business row keeps from Graph, how the rows are built
// from the business list AND the Ad accounts list (each account names its owner business, so spend, counts and the status of
// a business come from there), the problems with their fixes, search, order, the IDs to copy. The only import besides the
// spend helpers is links.js (pure). test/bms.test.mjs runs this file in plain Node; bms.js only draws it.
//
// The tab answers one question: what do I have, and how much does each business spend? Docs for the business edge are thin
// and nothing here is live-verified (.notes/index.md, "In progress"): every field except id and name is optional, an
// unknown value is never guessed.

import { LINKS, imageUrl } from "./links.js";
import { addUp, mergeUp } from "./spend.js";

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

const text = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);
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
// Only a business verification that went wrong is shown (a pending or missing one is not something to act on).
export const VERIFY_BAD = ["failed", "rejected", "revoked", "expired"];
// → "failed" | "rejected" | "revoked" | "expired" | null
export function badVerification(b) {
  if (!b || b._noVerificationStatus) return null;
  const s = typeof b.verification_status === "string" ? b.verification_status.trim().toLowerCase() : "";
  return VERIFY_BAD.includes(s) ? s : null;
}

// ---------- status of a business ----------
// From the Ad accounts list: account_status 1 = active, 2 = disabled ("disabled" is exactly the Accounts tab's "Disabled" chip, so
// the number matches what that tab shows after the click); closed (101), pending closure (100) and the unsettled / review
// statuses count in the total only.
export function countAccounts(accounts) {
  const c = { total: 0, active: 0, disabled: 0 };
  for (const a of accounts) {
    c.total++;
    if (a.account_status === 1) c.active++;
    else if (a.account_status === 2) c.disabled++;
  }
  return c;
}
// key → tone of the pill. active: at least one active ad account. noActive: it has ad accounts, none of them active.
// none: the loaded list has no ad account of this business.
export const STATUS = { active: "ok", noActive: "bad", none: "warn" };
// → { key, tone } or null: no verdict while the Ad accounts list is not loaded, and none when that list stopped at its page limit
// (the business may own more than was read).
export function statusOf(counts, { loaded, truncated = false }) {
  if (!loaded) return null;
  if (!counts.total) return truncated ? null : { key: "none", tone: STATUS.none };
  return counts.active ? { key: "active", tone: STATUS.active } : { key: "noActive", tone: STATUS.noActive };
}

// ---------- the rows of the list ----------
// bms = the slimmed me/businesses rows; accounts = the Ad accounts list (each with business { id, name } or none);
// loaded = the accounts list has been read; stats(account) → { spend } | null for the selected period (null = unknown).
// A row for every business in `bms`, and one for every other business an account names (client accounts of a business the profile
// does not manage; named from the account, no logo). Accounts that have no business belong to no row: this tab is about
// businesses, the Ad accounts tab has the rest.
// → [{ key, id, name, known, bm, picture, counts, status, verification, spend, accounts, issues }]
//   known = the business is in me/businesses: only those get problem lines with fixes (the links are to ITS settings).
export function buildRows({ bms = [], accounts = [], loaded = false, truncated = false, stats = () => null } = {}) {
  const groups = new Map();
  for (const b of bms) groups.set(b.id, { id: b.id, name: b.name || "", bm: b, accounts: [] });
  for (const a of accounts) {
    const raw = a?.business?.id;
    if (raw === undefined || raw === null || raw === "") continue;
    const id = String(raw);
    let g = groups.get(id);
    if (!g) groups.set(id, g = { id, name: text(a.business.name) || "", bm: null, accounts: [] });
    else if (!g.name && a.business.name) g.name = text(a.business.name);
    g.accounts.push(a);
  }
  return [...groups.values()].map(({ id, name, bm, accounts: list }) => {
    const counts = countAccounts(list);
    const row = {
      key: id, id, name, known: !!bm, bm: bm || null,
      picture: bm?.profile_picture_uri, counts, status: statusOf(counts, { loaded, truncated }),
      verification: badVerification(bm), accounts: list,
      spend: addUp(list.map((a) => ({ spend: stats(a)?.spend ?? null, currency: a.currency }))),
    };
    row.issues = issuesOf(row);
    return row;
  });
}

// ---------- problems and their fixes ----------
// Data, so a test can walk every one. label (i18n key; may depend on the row), tip (i18n key), fix = where it is fixed: label /
// tip (i18n keys) and url(row) → https URL or null (a null drops the link). One link per problem, always a page that links.js
// built; the extension changes nothing by opening it. Order = severity.
export const PROBLEMS = [
  { id: "verification", tone: "bad", has: (r) => !!r.verification, label: (r) => `bms.p.ver.${r.verification}`, tip: "bms.verTitle",
    fix: { label: "bms.fix.verify", tip: "bms.fix.verifyTitle", url: (r) => LINKS.bmSecurity(r.id) } },
  { id: "noActive", tone: "bad", has: (r) => r.status?.key === "noActive", label: () => "bms.st.noActive", tip: "bms.st.noActive.title",
    fix: { label: "bms.fix.accounts", tip: "bms.fix.accountsTitle", url: (r) => LINKS.bmAdAccounts(r.id) } },
  { id: "none", tone: "warn", has: (r) => r.status?.key === "none", label: () => "bms.st.none", tip: "bms.st.none.title",
    fix: { label: "bms.fix.create", tip: "bms.fix.createTitle", url: (r) => LINKS.bmAdAccounts(r.id) } },
];
// [{ id, tone, label, tip, fix: { label, tip, url } | null }] for one row. Only a business of the profile (known) has any.
export function issuesOf(row) {
  if (!row.known) return [];
  return PROBLEMS.filter((p) => p.has(row)).map((p) => {
    const url = p.fix.url(row);
    return { id: p.id, tone: p.tone, label: p.label(row), tip: p.tip, fix: url ? { label: p.fix.label, tip: p.fix.tip, url } : null };
  });
}

// ---------- the list ----------
// Search by name or id.
export const matchRow = (r, q) => {
  const s = String(q ?? "").trim().toLowerCase();
  return !s || `${r.name || ""} ${r.id || ""}`.toLowerCase().includes(s);
};
export const filterRows = (rows, q = "") => rows.filter((r) => matchRow(r, q));
// Most spend first (an unknown spend sorts last), then more active ad accounts, then name, then id.
export const sortRows = (rows) => [...rows].sort((a, b) => b.spend.sort - a.spend.sort || b.counts.active - a.counts.active
  || String(a.name || "").localeCompare(String(b.name || "")) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
// The total over these rows: the same shape as spend.js addUp (the sum of the rows).
export const totalOf = (rows) => mergeUp(rows.map((r) => r.spend));
// One id per line, in the order given.
export const idsOf = (rows) => rows.map((r) => r.id).join("\n");

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
