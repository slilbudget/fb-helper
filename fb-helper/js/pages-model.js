// The Pages tab without the screen: which fields are asked for, how a row is reduced, which pages come from where (the
// profile's own list and every business's owned / client pages), what a page's Instagram / ad-rights state is, the problems with their
// fixes, the chips, search and order. No DOM, no chrome.*; the only imports are links.js and pure.js (both pure):
// test/pages.test.mjs runs it in plain Node. pages.js draws it.
//
// The tab answers one question: is each page alive or dead for advertising, and can I use it? Dead = Meta does not allow promoting it,
// hidden = unpublished, no access = I have no Advertise task on it. Instagram is not a problem: its state is only told in the body.
//
// Never a Page access token. `me/accounts` hands one out per page by default; the `fields` list below is explicit and
// never names it, and slimPage keeps a whitelist of keys, so a token Graph sent anyway is gone before it reaches state,
// storage or the screen. The business edges are read with the same list (minus `tasks`) and the same whitelist.

import { LINKS, imageUrl } from "./links.js";
import { cleanText, isPermError } from "./pure.js";

// Fields asked for on top of id and name. Docs are thin and none of this is live-verified, so each one is optional:
// readPaged drops the one Graph complains about and asks the same page again. { key: expression }.
// The KEY is what Graph names in "nonexisting field (x)" and graph.js matches it as a substring of the whole complaint,
// first match in this order. So no key may be a substring of an earlier key's complaint; `business` is inside
// instagram_business_account, hence it stays LAST (a test checks every key against its own complaint).
export const OPTIONAL = {
  is_published: "is_published",
  tasks: "tasks",                                   // my tasks on the page: only me/accounts says them (a business edge has none per user)
  connected_page_backed_instagram_account: "connected_page_backed_instagram_account{id}",   // PBIA: "Use Facebook Page" chosen
  instagram_business_account: "instagram_business_account{id,username}",
  connected_instagram_account: "connected_instagram_account{id,username}",
  promotion_eligible: "promotion_eligible",
  promotion_ineligible_reason: "promotion_ineligible_reason",
  picture: "picture{url}",                          // the page's picture: only the URL is kept, and only if imageUrl() accepts it
  business: "business{id,name}",
};
export const BASE = ["id", "name"];
// The business edges: the same page node, without `tasks`. owned_pages = pages the business owns, client_pages = pages other
// businesses shared with it. Docs: GET is supported on both; which permission they need is not stated, so every business and
// every edge is best effort (an edge that errors is skipped, the rest stays).
export const BIZ_OPTIONAL = Object.fromEntries(Object.entries(OPTIONAL).filter(([k]) => k !== "tasks"));
export const BIZ_EDGES = ["owned_pages", "client_pages"];
// A complaint can name a field INSIDE one of the expressions above. Then the parents are dropped, not everything.
const NESTED = { username: ["instagram_business_account", "connected_instagram_account"], url: ["picture"] };
const IG_KEYS = ["connected_page_backed_instagram_account", "instagram_business_account", "connected_instagram_account"];

// ---------- errors ----------
// The token cannot read this edge at all: permission codes (10, 283, 200–299), or a 100 that names no field
// (readPaged has already dealt with every complaint that names one of our fields). One rule for every list tab (pure.js).
export const isPermissionError = isPermError;
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
// Keys a stored row may have: Graph's own names, nested objects cut to what is read from them, plus three of ours: `_skip` (the
// optional fields that were NOT asked for when this row's page arrived: "absent" must not be read as "none"), `_viaBm` (the id
// of the business through which a page that me/accounts did not list was found) and `_unsure` (set by finishPages: no verdict about the
// person's access to a page seen only through a business, because me/accounts was not read completely).
export const ROW_KEYS = ["id", "name", ...Object.keys(OPTIONAL), "_skip", "_viaBm", "_unsure"];
const bool = (v) => (typeof v === "boolean" ? v : undefined);
const text = (v, max = 200) => cleanText(v, max) || undefined;           // control and bidi characters out (pure.js cleanText)
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
    is_published: bool(r.is_published),
    tasks: Array.isArray(r.tasks) ? r.tasks.filter((s) => typeof s === "string").map((s) => s.slice(0, 40)).slice(0, 30) : undefined,
    connected_page_backed_instagram_account: node(r.connected_page_backed_instagram_account),
    instagram_business_account: ig(r.instagram_business_account), connected_instagram_account: ig(r.connected_instagram_account),
    promotion_eligible: bool(r.promotion_eligible), promotion_ineligible_reason: text(r.promotion_ineligible_reason, 300),
    picture: imageUrl(r.picture?.data?.url ?? r.picture?.url) ?? undefined,         // Graph wraps it: picture.data.url
    business: node(r.business, (b) => def({ name: text(b.name, 200) })),
    _skip: skip.length ? skip : undefined,
  });
}

// ---------- the businesses and their pages ----------
// (The list of businesses and the walk over their edges are biz-edges.js, shared with the Ad accounts tab.)
// A page found through a business: marked with that business. A business edge has no `tasks`, so the profile has no known access
// to such a page ("No access"). owned = the edge was owned_pages: the page belongs to that business, which fills the owner when the
// page did not say. null stays null (a row that is not a page).
export function viaBusiness(row, bm, owned = false) {
  if (!row) return null;
  const out = { ...row, _viaBm: bm.id };
  if (owned && !out.business) out.business = def({ id: bm.id, name: bm.name });
  return out;
}
// The whole answer: rows that are not pages dropped, one row per id; the FIRST row of an id wins. Pass me/accounts first (it carries
// the tasks), then the business edges (owned before client): a page me/accounts lists is never replaced by a business's view of it.
// "No access" for a page seen only through a business means "me/accounts does not list it, so I have no task on it". That is a verdict only
// when me/accounts was read completely and answered: when it stopped at its page limit the page may be in the part that was not read, and
// when it came back empty while the business edges had rows the token may simply not be able to read it (a field or permission it lacks).
// Then (verdict = false) such a row is marked `_unsure` and says nothing about access: no problem, no "Assign me", just "via a business".
export function finishPages(rows, { verdict = true } = {}) {
  const seen = new Set();
  const all = rows.filter((p) => p && !seen.has(p.id) && seen.add(p.id));
  return verdict ? all : all.map((p) => (p._viaBm ? { ...p, _unsure: true } : p));
}
// Is "not in me/accounts" a fact? mine = readPaged's { rows, truncated } of me/accounts, biz = what the business edges returned.
export const accessVerdict = (mine, biz) => !mine.truncated && !(mine.rows.length === 0 && biz.rows.length > 0);

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

// ---------- problems ----------
// key → tone of the word. Order = priority: the worst problem is the one the row says.
//   dead      Graph says the page cannot be promoted (promotion_eligible = false): Meta does not allow advertising it
//   hidden    is_published = false
//   noAccess  no ADVERTISE task for me, or seen only through a business (nobody assigned me to it) when me/accounts was read completely
//             (finishPages: otherwise `_unsure`, no verdict)
// Instagram is NOT a problem: a page with no account still runs ads (igOf tells it in the body).
export const PROBLEMS = { dead: "bad", hidden: "warn", noAccess: "warn" };
export const PRIORITY = Object.keys(PROBLEMS);
const TESTS = {
  dead: (p) => p.promotion_eligible === false,
  hidden: (p) => p.is_published === false,
  noAccess: (p) => (!!p._viaBm && !p._unsure) || adRightsOf(p) === "none",
};
// The chips: key → tone. "alive" = neither dead nor hidden (no access may overlap with it). One chip filters at a time.
export const CHIPS = { alive: "ok", dead: "bad", hidden: "warn", noAccess: "warn" };
const MATCH = { alive: (p) => !TESTS.dead(p) && !TESTS.hidden(p), ...TESTS };
export const problemsOf = (p) => PRIORITY.filter((k) => TESTS[k](p));
export function chipCounts(rows) {
  const counts = Object.fromEntries(Object.keys(CHIPS).map((k) => [k, 0]));
  for (const p of rows) for (const k of Object.keys(CHIPS)) if (MATCH[k](p)) counts[k]++;
  return counts;
}

// ---------- problems and their fixes ----------
// Where each problem is fixed. label / tip are i18n keys (strings/pages.js); url(page) → https URL or null (a null drops the link).
// One link per problem, always a page on facebook.com that links.js built. The extension changes nothing by opening it.
// "Assign me" goes to the Pages settings of the business through which the page was found (there I can be assigned), else of its
// owner, else to the page in Business Suite.
export const FIXES = {
  dead: { label: "pages.fix.appeal", tip: "pages.fix.appealTitle", url: () => LINKS.accountQuality() },
  hidden: { label: "pages.fix.publish", tip: "pages.fix.publishTitle", url: (p) => LINKS.pageSuite(p.id) },
  noAccess: { label: "pages.fix.assign", tip: "pages.fix.assignTitle", url: (p) => LINKS.bmPages(p._viaBm || p.business?.id) || LINKS.pageSuite(p.id) },
};
// The one thing to do about "Instagram: none" (told in the body, never a problem of the row): Ads Manager, where «Use Facebook Page» is chosen.
export const IG_FIX = { label: "pages.fix.ig", tip: "pages.igNoneTitle", url: () => LINKS.adsManagerHome() };
const TIPS = { dead: "pages.deadTitle", hidden: "pages.hiddenTitle" };
// The problems of a page, worst first: [{ key, tone, label (i18n key), tip (i18n key), rawTip (Graph's own words, if any), fix }].
// fix = { label, tip, url } or null. Nothing wrong = [].
export function issuesOf(p) {
  return problemsOf(p).map((key) => {
    const f = FIXES[key], url = f.url(p);
    return {
      key, tone: PROBLEMS[key], label: `pages.p.${key}`,
      tip: key === "noAccess" ? (p._viaBm ? "pages.noAccessViaTitle" : "pages.noAccessTitle") : TIPS[key],
      rawTip: key === "dead" ? p.promotion_ineligible_reason : undefined,        // Graph's reason is the tooltip (and the body's "Reason"), never a line of its own
      fix: url ? { label: f.label, tip: f.tip, url } : null,
    };
  });
}

// ---------- list ----------
// Search matches what the row shows: name, id, owner business.
// chip = a key of CHIPS or null.
export function filterPages(rows, { q = "", chip = null } = {}) {
  const needle = String(q).trim().toLowerCase();
  return rows.filter((p) => (!chip || MATCH[chip]?.(p))
    && (!needle || `${p.name} ${p.id} ${p.business?.name || ""}`.toLowerCase().includes(needle)));
}
// A readiness board: pages with nothing wrong first (by name, case and accents aside, numbers as numbers, then id), then the pages
// with problems by their worst problem (Dead, Hidden, No access), each group by name. A list that does not move between loads.
const byName = (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id);
export function sortPages(rows) {
  const rank = (p) => PRIORITY.findIndex((k) => TESTS[k](p));            // -1 = healthy
  return rows.map((p) => [p, rank(p)]).sort(([a, ra], [b, rb]) => ra - rb || byName(a, b)).map(([p]) => p);
}
