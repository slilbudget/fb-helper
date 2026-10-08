// The Pages tab without the screen: which fields are asked for, how a row is reduced, what a page's Instagram / publishing /
// ad-rights state is, the problem chips, search, the IDs to copy. No DOM, no chrome.*, no imports: test/pages.test.mjs runs it
// in plain Node. pages.js draws it.
//
// Never a Page access token. `me/accounts` hands one out per page by default; the `fields` list below is explicit and
// never names it, and slimPage keeps a whitelist of keys, so a token Graph sent anyway is gone before it reaches state,
// storage or the screen.

// Fields asked for on top of id and name. Docs are thin and none of this is live-verified, so each one is optional:
// readPaged drops the one Graph complains about and asks the same page again. { key: expression }.
// The KEY is what Graph names in "nonexisting field (x)" and graph.js matches it as a substring of the whole complaint,
// first match in this order. So no key may be a substring of an earlier key's complaint; `business` is inside
// instagram_business_account, hence it stays LAST (a test checks every key against its own complaint).
export const OPTIONAL = {
  category: "category",
  followers_count: "followers_count",
  fan_count: "fan_count",
  is_published: "is_published",
  verification_status: "verification_status",
  tasks: "tasks",
  connected_page_backed_instagram_account: "connected_page_backed_instagram_account{id}",   // PBIA: "Use Facebook Page" chosen
  instagram_business_account: "instagram_business_account{id,username}",
  connected_instagram_account: "connected_instagram_account{id,username}",
  promotion_eligible: "promotion_eligible",
  promotion_ineligible_reason: "promotion_ineligible_reason",
  business: "business{id,name}",
};
export const BASE = ["id", "name"];
// A complaint can name a field INSIDE one of the expressions above. Then the parents are dropped, not everything.
const NESTED = { username: ["instagram_business_account", "connected_instagram_account"] };
const IG_KEYS = ["connected_page_backed_instagram_account", "instagram_business_account", "connected_instagram_account"];

// ---------- errors ----------
// The token cannot read this edge at all: permission codes (10, 283, 200–299), or a 100 that names no field
// (readPaged has already dealt with every complaint that names one of our fields).
export function isPermissionError(e) {
  const c = Number(e?.code);
  if (c === 10 || c === 283 || (c >= 200 && c <= 299)) return true;
  return c === 100 && !/field/i.test(e.raw || e.message || "");
}
// What to give up after readPaged threw. [] = nothing left to give up: show the error.
// A token may answer the whole read with a permission error (or a 100 that names nothing) because ONE extra field needs a
// permission it lacks (`business`: business_management; the Instagram fields: instagram_basic) instead of just skipping it.
// So the fields most likely to need one go first, in tiers, and the rest of the data survives: business, then the Instagram
// trio, then everything left (id and name only: a token that fails even that cannot read pages, 4 requests at most).
// A row that lacks a field says so (_skip). Every pass adds at least one key to `skipped`, so the caller's loop ends.
export function keysToDrop(e, skipped) {
  const left = Object.keys(OPTIONAL).filter((k) => !skipped.has(k));
  if (!left.length) return [];
  const raw = e?.raw || e?.message || "";
  const nested = Object.entries(NESTED).filter(([f]) => new RegExp(`\\b${f}\\b`).test(raw)).flatMap(([, keys]) => keys).filter((k) => left.includes(k));
  if (nested.length) return nested;
  if (!(isPermissionError(e) || Number(e?.code) === 100)) return [];
  for (const tier of [["business"], IG_KEYS]) {
    const keys = tier.filter((k) => left.includes(k));
    if (keys.length) return keys;
  }
  return left;
}

// ---------- a row ----------
// Keys a stored row may have: Graph's own names, nested objects cut to what is read from them, plus `_skip` (the optional
// fields that were NOT asked for when this row's page arrived: "absent" must not be read as "none").
export const ROW_KEYS = ["id", "name", ...Object.keys(OPTIONAL), "_skip"];
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const bool = (v) => (typeof v === "boolean" ? v : undefined);
const text = (v, max = 200) => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
  return s ? s.slice(0, max) : undefined;
};
const idOf = (v) => ((typeof v === "string" || typeof v === "number") && /^\d{1,25}$/.test(String(v)) ? String(v) : undefined);
// { id, ...extra } or undefined when the node has no usable id.
const node = (v, extra = () => ({})) => { const id = idOf(v?.id); return id ? { id, ...extra(v) } : undefined; };
const def = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Graph row → the row that is kept; null for something that is not a page (no numeric id: it could be neither opened nor copied).
export function slimPage(raw, skipped = []) {
  const r = raw && typeof raw === "object" ? raw : {};
  const id = idOf(r.id);
  if (!id) return null;
  const ig = (v) => node(v, (x) => def({ username: text(x.username, 60)?.replace(/^@/, "") || undefined }));
  const skip = [...new Set(skipped)].filter((k) => k in OPTIONAL);
  return def({
    id, name: text(r.name) ?? "",
    category: text(r.category, 100), followers_count: num(r.followers_count), fan_count: num(r.fan_count),
    is_published: bool(r.is_published), verification_status: text(r.verification_status, 40),
    tasks: Array.isArray(r.tasks) ? r.tasks.filter((s) => typeof s === "string").map((s) => s.slice(0, 40)).slice(0, 30) : undefined,
    connected_page_backed_instagram_account: node(r.connected_page_backed_instagram_account),
    instagram_business_account: ig(r.instagram_business_account), connected_instagram_account: ig(r.connected_instagram_account),
    promotion_eligible: bool(r.promotion_eligible), promotion_ineligible_reason: text(r.promotion_ineligible_reason, 300),
    business: node(r.business, (b) => def({ name: text(b.name, 200) })),
    _skip: skip.length ? skip : undefined,
  });
}
// The whole answer: rows that are not pages dropped, one row per id (a page can come twice when a page boundary moves).
export function finishPages(rows) {
  const seen = new Set();
  return rows.filter((p) => p && !seen.has(p.id) && seen.add(p.id));
}

// ---------- what a row says ----------
const unread = (p, keys) => keys.some((k) => p._skip?.includes(k));
// Instagram, as media buying sees it. Only "none" is a verdict, and only when every field that could show an account was
// read: a real one (instagram_business_account / connected_instagram_account) or the page-backed one (PBIA).
//   real     an Instagram account is connected                      → { state, username }
//   pbia     "Use Facebook Page" was chosen once: Instagram placements run as the page
//   none     nothing connected and nothing unread → automated launches to Instagram placements fail
//   unknown  Graph refused some of those fields for this token: no verdict
export function igOf(p) {
  const real = [p.instagram_business_account, p.connected_instagram_account].find((x) => x?.id);
  if (real) return { state: "real", username: real.username || "" };
  if (p.connected_page_backed_instagram_account?.id) return { state: "pbia" };
  return { state: unread(p, IG_KEYS) ? "unknown" : "none" };
}
// Ad rights from `tasks`: ok / none (the list has no ADVERTISE) / unknown (no list, or an empty one: Graph says that for
// pages it does not describe, and a warning for every such page would be noise).
export function adRightsOf(p) {
  if (!Array.isArray(p.tasks) || !p.tasks.length) return "unknown";
  return p.tasks.includes("ADVERTISE") ? "ok" : "none";
}
export const isVerified = (p) => p.verification_status === "blue_verified" || p.verification_status === "gray_verified";
// Followers first, page likes when only those were read. null = neither is known.
export function audienceOf(p) {
  if (p.followers_count !== undefined) return { kind: "followers", n: p.followers_count };
  if (p.fan_count !== undefined) return { kind: "likes", n: p.fan_count };
  return null;
}

// ---------- problems: the chips ----------
// key → tone of the chip / pill. Order = order of the chips.
export const PROBLEMS = { noIg: "warn", unpublished: "warn", noAdv: "bad", noRights: "warn" };
const TESTS = {
  noIg: (p) => igOf(p).state === "none",
  unpublished: (p) => p.is_published === false,
  noAdv: (p) => p.promotion_eligible === false,
  noRights: (p) => adRightsOf(p) === "none",
};
export const problemsOf = (p) => Object.keys(PROBLEMS).filter((k) => TESTS[k](p));
export function problemCounts(rows) {
  const counts = Object.fromEntries(Object.keys(PROBLEMS).map((k) => [k, 0]));
  for (const p of rows) for (const k of problemsOf(p)) counts[k]++;
  return counts;
}

// ---------- list ----------
// Search matches what the row shows: name, id, category, owner BM. problem = a chip key or null.
export function filterPages(rows, { q = "", problem = null } = {}) {
  const needle = String(q).trim().toLowerCase();
  return rows.filter((p) => (!problem || TESTS[problem]?.(p))
    && (!needle || `${p.name} ${p.id} ${p.category || ""} ${p.business?.name || ""}`.toLowerCase().includes(needle)));
}
// By name (case and accents aside, numbers as numbers), then id: a list that does not move between loads.
export const sortPages = (rows) => [...rows].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id));
// "Copy IDs": one per line, in the order of the list on screen.
export const idsText = (rows) => rows.map((p) => p.id).join("\n");
// A page owned only through a BM may be missing from me/accounts, so a short list gets a one-line reminder.
export const SHORT_LIST = 10;
export const showBmHint = (total) => total < SHORT_LIST;
