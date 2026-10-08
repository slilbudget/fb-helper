// Pure helpers: no DOM, no chrome.*. Split out of the popup modules so test/pure.test.mjs can run them in plain Node.

// ---------- text and ids from Graph ----------
// Everything Graph hands over is somebody else's text. A name can carry control characters (a newline would forge a line of the copied
// block, a tab breaks a column) and bidi controls: U+202A-202E (embeddings / overrides) and U+2066-2069 (isolates) reorder what comes after
// them, so a name ending in an override followed by "fdp.exe" would read as "exe.pdf". The controls are dropped, line breaks and tabs become
// spaces, the rest is cut to `max`.
// -> a string ("" when v is not one). Used for every name, label and message Graph sends that reaches the screen, storage or the clipboard.
export const cleanText = (v, max = 200) =>
  (typeof v === "string" ? v.replace(/[\u202A-\u202E\u2066-\u2069]/g, "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim().slice(0, max) : "");
// An id that may go into a path or a URL: 1–25 digits (an ad account id without "act_"). Anything else gives null.
export const digitsId = (v) => ((typeof v === "string" || typeof v === "number") && /^\d{1,25}$/.test(String(v)) ? String(v) : null);

// Graph says "this login / token is dead": code 190 (invalid / expired token; subcodes 458–467 say why — checkpoint,
// password changed, logged out…) or 102 (API session). Subcodes alone are not trusted: they only mean this under 190.
export function isSessionError(code) {
  const c = Number(code);
  return c === 190 || c === 102;
}
// The token cannot read this at all: (#10) permission, (#283) a permission the app lacks, (#200–299) the permission family, or a (#100) that is not
// about a field (a complaint that names a field is handled where the field is optional). One rule for every list tab: a calm "this token can't
// read the list", not a red toast with Graph's English. e = an Error from graph() (code, raw), or anything.
export function isPermError(e) {
  const code = Number(e?.code);
  if (code === 10 || code === 283 || (code >= 200 && code <= 299)) return true;
  return code === 100 && !/field/i.test(e?.raw || e?.message || "");
}
// An enum Graph sends that no string of ours covers ("PENDING_BILLING_INFO", a page task of the future) is shown as plain words, never as a raw
// constant: "Pending billing info". The known ones have translated words (ad.<status>, pages.task.<task>).
export const humanEnum = (s) => { const w = String(s ?? "").toLowerCase().replace(/_+/g, " ").trim(); return w ? w[0].toUpperCase() + w.slice(1) : ""; };
// "190/463" for messages.
export const sessionLabel = (code, subcode) => (subcode ? `${code}/${subcode}` : String(code));

// "v26.0" → 2600. 0 when it is not a version.
export const verNum = (v) => { const m = /^v(\d+)\.(\d+)$/.exec(v || ""); return m ? Number(m[1]) * 100 + Number(m[2]) : 0; };
// The newest version named anywhere in Graph's text. A warning may name the old version first
// ("v26.0 is deprecated, upgraded to v27.0"), so the first match is not enough.
// cap: ignore versions above it (verNum scale), so a stray "v999.0" in the text cannot hide the real "v27.0".
export function latestVersion(text, cap = Infinity) {
  let best = null;
  for (const [v] of String(text || "").matchAll(/\bv\d+\.\d+\b/g))
    if (verNum(v) <= cap && (!best || verNum(v) > verNum(best))) best = v;
  return best;
}

// ---------- spend ----------
// "All time" of an account. Meta's amount_spent lags behind (a new account can still say 0 while it spent today) and
// restarts when a spend cap is reset, so it can sit BELOW what the insights already show. The last 30 days (they end
// yesterday) plus today can never exceed the lifetime total, so the answer is the larger of the two.
// floor: today + the last 30 days as they were when the list was fetched (spendFloor); still a valid lower bound the
// next day, so the figure does not jump when the cached "today" goes stale. null/undefined = no insights were read.
export const spendFloor = (today, last30) => (Number(today) || 0) + (Number(last30) || 0);
export const lifetimeSpend = (amountSpent, floor) => Math.max(Number(amountSpent) || 0, Number(floor) || 0);

// One period of nested insights ({ data: [row] }, as a field alias returns it) -> numbers, for accounts and ads alike.
// Graph omits the key entirely when there was no delivery in the period (a real 0); a spend that is not a number
// is unknown (null). `spend` is in major units already.
export function insightRow(ins) {
  const r = ins?.data?.[0];
  if (!r) return { spend: 0, imp: 0, clicks: 0 };
  const spend = Number(r.spend);
  if (!Number.isFinite(spend)) return null;
  return { spend, imp: Number(r.impressions) || 0, clicks: Number(r.inline_link_clicks) || 0, from: r.date_start, to: r.date_stop };
}

// ---------- ads ----------
export const AD_PROBLEMS = ["DISAPPROVED", "WITH_ISSUES"];
// Problem ads first; the rest keep Graph's order (Array.sort is stable).
export const adRank = (status) => (AD_PROBLEMS.includes(status) ? 0 : 1);

const asText = (v) => cleanText(typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v), 2000);
const placeName = (s) => { const w = String(s).replace(/_/g, " "); return w.charAt(0).toUpperCase() + w.slice(1); };
// Why an ad is rejected, one line per reason. Sources (Meta docs, AdgroupReviewFeedback / AdgroupIssuesInfo):
//   ad_review_feedback.global              map<reason, description> — all placements
//   ad_review_feedback.placement_specific  { facebook: map, instagram: map, … } — one placement only
//   issues_info[]                          { error_summary, error_message } — the reason for WITH_ISSUES
//                                          (read only for problem ads: a healthy ad must not show red text)
export function reviewLines(ad) {
  const lines = [], seen = new Set();
  const add = (place, key, desc) => {
    const k = asText(key).trim(), d = asText(desc).trim();
    const body = d && d !== k ? (k ? `${k} — ${d}` : d) : k;
    if (!body) return;
    const line = place ? `${placeName(place)}: ${body}` : body;
    if (!seen.has(line)) { seen.add(line); lines.push(line); }
  };
  const walk = (place, v) => {
    if (Array.isArray(v)) for (const x of v) add(place, x, "");
    else if (v && typeof v === "object") for (const [k, d] of Object.entries(v)) add(place, k, d);
    else add(place, v, "");
  };
  const fb = ad?.ad_review_feedback;
  walk("", fb?.global);
  const ps = fb?.placement_specific;
  if (ps && typeof ps === "object" && !Array.isArray(ps)) for (const [place, v] of Object.entries(ps)) walk(place, v);
  if (AD_PROBLEMS.includes(ad?.effective_status))
    for (const i of Array.isArray(ad?.issues_info) ? ad.issues_info : []) add("", i?.error_summary, i?.error_message);
  return lines;
}

// ---------- token owner ----------
// Does the token belong to the logged-in FB user? meId = /me.id, cookieUser = c_user.
// "mismatch" only for first-party token prefixes: tokens of a custom app get an app-scoped /me.id that never
// equals c_user (EAAW), so for those the answer is "unknown", not "mismatch".
export function ownerVerdict(firstParty, meId, cookieUser) {
  if (!meId || !cookieUser) return "unknown";
  if (String(meId) === String(cookieUser)) return "ok";
  return firstParty ? "mismatch" : "unknown";
}

// The last paragraph of the token + cookies + UA block, always in English: whose profile, which BMs.
// id: the profile id, only when it is the real one (owner verified); a custom app's /me id is app-scoped.
// businesses: [{ id, name }], or null when the token could not read them; more: Graph has a next page.
// Names come from Graph and can hold anything: control characters (a newline would forge a paragraph) become spaces, bidi controls go (cleanText).
export function profileBlock({ name, id, businesses, more = false }) {
  const clean = (s) => cleanText(String(s ?? ""), 500);
  const who = clean(name);
  const profile = who && id ? `${who} (${id})` : who || clean(id) || "unknown";
  const list = Array.isArray(businesses) ? businesses.filter((b) => b?.id).map((b) => `${clean(b.name) || "no name"} (${clean(b.id)})`) : null;
  const bm = !list ? "not available" : !list.length ? "none" : list.join(", ") + (more ? ", …" : "");
  return `Profile: ${profile}\nBM: ${bm}`;
}

// A User-Agent as read from the page. The page's JS can return anything, so only a printable-ASCII string of a sane
// length passes: no control characters (a newline would forge extra paragraphs in the copied block), no markup-length blobs.
export const isUserAgent = (s) => typeof s === "string" && /^[\x20-\x7e]{8,512}$/.test(s);
