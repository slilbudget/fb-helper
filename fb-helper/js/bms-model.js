// The BM tab's logic without any DOM, chrome.* or i18n: what a row keeps from Graph, how verification and role read, how
// many ad accounts a BM has, search, chips, order. test/bms.test.mjs runs this file in plain Node; bms.js only draws it.
//
// Docs for the business edge are thin and nothing here is live-verified (.notes/index.md, "In progress"): every field
// except id and name is optional, an unknown value is shown as it came, a missing or refused one as "—", never guessed.

// One paged read of me/businesses (graph.js readPaged). A token that cannot read an extra field just loses that field.
export const BM_BASE = ["id", "name"];
export const BM_OPTIONAL = {
  verification_status: "verification_status",
  permitted_roles: "permitted_roles",             // only on this edge: the profile's own role(s) in each BM
  created_time: "created_time",
  primary_page: "primary_page{id,name}",
  two_factor_type: "two_factor_type",
};
export const BM_LIMIT = 50;
export const BM_MAX_PAGES = 4;                    // 200 BMs; more = "not all"
export const BM_SLOT_MS = 60 * 1000;              // claimSlot("bms", …): one attempt per minute, failed ones count

// ---------- rows ----------
// "verification_status" → "_noVerificationStatus": set on a row read while Graph refused that field (the cached value is
// unknown, not "none").
export const markerOf = (key) => `_no${key.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`;

const text = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);
// Whitelist: only these keys leave Graph's answer (and go into storage.session). null = not a usable row (no numeric id).
// skip = the Set of optional keys Graph refused so far; readPaged calls this per row, so a row keeps the skip state of its
// own page.
export function slimBm(raw, skip = new Set()) {
  if (!raw || typeof raw !== "object" || !/^\d{1,25}$/.test(String(raw.id ?? ""))) return null;
  const roles = Array.isArray(raw.permitted_roles) ? raw.permitted_roles.filter((r) => typeof r === "string").slice(0, 20) : undefined;
  const page = raw.primary_page && typeof raw.primary_page === "object" && /^\d{1,25}$/.test(String(raw.primary_page.id ?? ""))
    ? { id: String(raw.primary_page.id), name: text(raw.primary_page.name) } : undefined;
  const row = {
    id: String(raw.id), name: text(raw.name) ?? "",
    verification_status: text(raw.verification_status, 60), permitted_roles: roles,
    created_time: text(raw.created_time, 40), primary_page: page, two_factor_type: text(raw.two_factor_type, 60),
  };
  for (const key of Object.keys(BM_OPTIONAL)) {
    if (skip.has(key)) { delete row[key]; row[markerOf(key)] = true; }
    else if (row[key] === undefined) delete row[key];
  }
  return row;
}

// ---------- verification ----------
// Meta's business verification_status enum → tone of the pill. Anything else keeps its own text and no tone.
export const VERIFICATION = {
  verified: "ok",
  pending: "warn", pending_need_more_info: "warn", pending_submission: "warn",
  failed: "bad", rejected: "bad", revoked: "bad", expired: "bad",
  not_verified: "", ineligible: "",
};
// → { state: "known" | "other" | "refused" | "unknown", status, tone }. refused = Graph would not give the field for this
// token; unknown = it came back without it. Both read as "—" in the UI.
export function verificationOf(b) {
  if (b?._noVerificationStatus) return { state: "refused", status: "", tone: "" };
  const status = typeof b?.verification_status === "string" ? b.verification_status.trim().toLowerCase() : "";
  if (!status) return { state: "unknown", status: "", tone: "" };
  return status in VERIFICATION ? { state: "known", status, tone: VERIFICATION[status] } : { state: "other", status, tone: "" };
}
export const isVerified = (b) => verificationOf(b).status === "verified";
// "FINANCE_EDITOR" / "pending_need_more_info" → "Finance editor" / "Pending need more info": for values we have no string for.
export const humanize = (s) => { const x = String(s ?? "").replace(/_/g, " ").trim().toLowerCase(); return x.charAt(0).toUpperCase() + x.slice(1); };

// ---------- role ----------
// permitted_roles = the roles of the logged-in profile in that BM. ADMIN wins; otherwise EMPLOYEE; any other role keeps its
// name. → { state: "admin" | "employee" | "other" | "refused" | "unknown", name }. unknown shows nothing, refused shows "—".
export function roleOf(b) {
  if (b?._noPermittedRoles) return { state: "refused", name: "" };
  const roles = (Array.isArray(b?.permitted_roles) ? b.permitted_roles : []).filter((r) => typeof r === "string" && r.trim()).map((r) => r.trim().toUpperCase());
  if (!roles.length) return { state: "unknown", name: "" };
  if (roles.includes("ADMIN")) return { state: "admin", name: "ADMIN" };
  if (roles.includes("EMPLOYEE")) return { state: "employee", name: "EMPLOYEE" };
  return { state: "other", name: roles[0] };
}

// "2026-08-29T10:00:00+0000" → "2026-08-29" (null when it is not a date).
export const isoDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? "")); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

// ---------- ad accounts per BM ----------
// From the Accounts tab's list: each account carries business { id, name } (the owner), account_status 1 = active, 2 = disabled.
// "disabled" is exactly the Accounts tab's "Disabled" chip, so the number matches what that tab shows after the click;
// closed (101), pending closure (100) and the unsettled / review statuses count in the total only.
// → Map<bmId, { total, active, disabled }>. A BM without any account is not in the map.
export function adCounts(accounts) {
  const map = new Map();
  for (const a of Array.isArray(accounts) ? accounts : []) {
    const id = a?.business?.id;
    if (id === undefined || id === null || id === "") continue;
    const key = String(id);
    const c = map.get(key) || { total: 0, active: 0, disabled: 0 };
    c.total++;
    if (a.account_status === 1) c.active++;
    else if (a.account_status === 2) c.disabled++;
    map.set(key, c);
  }
  return map;
}

// ---------- the list ----------
// Search by name or id.
export const matchBm = (b, q) => {
  const s = String(q ?? "").trim().toLowerCase();
  return !s || `${b.name || ""} ${b.id}`.toLowerCase().includes(s);
};
// status = a raw verification status chip (null = all).
export const filterBms = (rows, { q = "", status = null } = {}) =>
  rows.filter((b) => (!status || verificationOf(b).status === status) && matchBm(b, q));
// Newest first (a freshly bought BM is the one you are about to set up), then by name, then id. No date = last.
export function sortBms(rows) {
  const time = (b) => { const d = isoDay(b.created_time); return d ? Date.parse(`${d}T00:00:00Z`) : -Infinity; };
  return [...rows].sort((a, b) => (time(b) === time(a) ? 0 : time(b) > time(a) ? 1 : -1)
    || String(a.name || "").localeCompare(String(b.name || "")) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
// Verification chips: [[status, n], …] in the order below. Only worth showing when the BMs differ, so fewer than two
// distinct statuses gives []. Rows without a status (refused or missing) are in no chip.
export function statusChips(rows) {
  const counts = new Map();
  for (const b of rows) { const s = verificationOf(b).status; if (s) counts.set(s, (counts.get(s) || 0) + 1); }
  if (counts.size < 2) return [];
  const order = Object.keys(VERIFICATION);
  const rank = (s) => (order.includes(s) ? order.indexOf(s) : order.length);
  return [...counts].sort((a, b) => rank(a[0]) - rank(b[0]) || (a[0] < b[0] ? -1 : 1));
}
// One id per line, in the order given.
export const idsOf = (rows) => rows.map((b) => b.id).join("\n");

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
