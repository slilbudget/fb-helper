// Every request to Graph goes through here: API version handling, usage and throttle bookkeeping, dead-session
// detection, paged reads. No DOM: the "usage" event tells header.js to redraw the pill, markDead (state.js) tells
// token.js. The host itself is handed in by the entry (config.js).
//
// What can go out, and when: GET only (graph() sends no body and no other method), to a path made of word segments only (an id from
// Graph never gets to add "/", "?" or ".."), never while the token is dead, never during the API pause (30 min after a throttle answer, or
// once the usage header says 95 %) and never past the soft budget of 600 requests per hour (counted here, kept in storage.session so a
// reopened popup and a second window share it). The three "stop" cases answer with an error that has `local = true`: nothing was sent.

import { t } from "./i18n.js";
import { isSessionError, sessionLabel, verNum, latestVersion, cleanText } from "./pure.js";
import { getGraphUrl } from "./config.js";
import { state, Stale, saveSession, onLoad, deadOf, sessionError, markDead } from "./state.js";
import { on, emit } from "./bus.js";

const DEPRECATED_VERSION_CODE = 2635;
const COOLDOWN_MS = 30 * 60 * 1000;          // throttle → 30 min hands off, no retries
const TIMEOUT_MS = 20 * 1000;
const THROTTLE_CODES = new Set([4, 17, 32, 613]);
const USAGE_PAUSE_PCT = 95;                  // Meta's own usage figure this high: the next call would be throttled, so stop for the same 30 min
const BUDGET_PER_HOUR = 600, BUCKET_MS = 10 * 60 * 1000, WINDOW_MS = 60 * 60 * 1000;
const PATH_OK = /^\w+(\/\w+)*$/;             // "me", "me/adaccounts", "act_123/ads": nothing else may be asked for

// Switch to a newer API version named in Graph's text (upgrade warning, #2635, or our own storage).
// Only forward, and only a few majors ahead: a garbled message must not send us to v999.
export function adoptVersion(text, persist = true) {
  const cur = verNum(state.apiVersion);
  const v = latestVersion(text, cur + 500);           // the newest one named (within reach), not the first
  const n = verNum(v);
  if (!n || n <= cur) return false;
  state.apiVersion = v;
  if (persist) chrome.storage.local.set({ apiVersion: v }).catch(() => {});
  return true;
}
export function setUsage(headers) {
  let worst = null;
  for (const name of ["x-business-use-case-usage", "x-app-usage", "x-ad-account-usage"]) {
    const raw = headers?.get(name);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const buckets = Object.values(data).some(Array.isArray) ? Object.values(data).flat() : [data];
      for (const b of buckets) for (const [k, v] of Object.entries(b || {}))
        if (/(_pct|call_count|total_cputime|total_time)$/.test(k) && typeof v === "number")
          worst = Math.max(worst ?? 0, Math.min(v, 100));
    } catch { /* ignore */ }
  }
  if (worst !== null) { state.usage = worst; saveSession({ usage: worst }); }
  emit("usage");
  if (worst !== null && worst >= USAGE_PAUSE_PCT && state.cooldownUntil <= Date.now()) startCooldown();   // not yet throttled, but one more call would be
}
export function startCooldown() {
  state.cooldownUntil = Date.now() + COOLDOWN_MS;
  saveSession({ cooldownUntil: state.cooldownUntil });
  emit("usage");
}

// What storage.session and storage.local remember for Graph: the throttle pause and the last usage figure survive a
// popup reopen; a newer API version learned from Graph itself outlives the browser (storage.local).
onLoad(["cooldownUntil", "usage"], async (ses) => {
  try { const { apiVersion } = await chrome.storage.local.get("apiVersion"); adoptVersion(apiVersion, false); } catch { /* */ }
  Object.assign(state, { cooldownUntil: ses.cooldownUntil || 0, usage: ses.usage ?? null });
});
// Another window started the throttle pause: follow.
on("session", (ch) => {
  if (ch.cooldownUntil) { state.cooldownUntil = ch.cooldownUntil.newValue || 0; emit("usage"); }
});

// ---------- the soft hourly budget ----------
// state.budget = [[bucketStart, n], …]: requests per 10-minute bucket of the last hour (small enough to write on every request).
// Soft on purpose: two popup windows may both count one request, and the count is a guard against a runaway loop, not an accounting.
Object.assign(state, { budget: [] });
const liveBuckets = (now = Date.now()) => state.budget.filter(([at]) => now - at < WINDOW_MS);
// Milliseconds until the budget has room again (0 = room now).
export function budgetLeft(now = Date.now()) {
  const live = liveBuckets(now);
  if (live.reduce((n, [, c]) => n + c, 0) < BUDGET_PER_HOUR) return 0;
  return Math.max(1, live[0][0] + WINDOW_MS - now);                  // the oldest bucket leaving the hour frees room
}
function budgetTake(now = Date.now()) {
  const live = liveBuckets(now), at = now - (now % BUCKET_MS), last = live[live.length - 1];
  if (last && last[0] === at) last[1]++; else live.push([at, 1]);
  state.budget = live;
  saveSession({ budget: live });
}
onLoad(["budget"], (ses) => { state.budget = Array.isArray(ses.budget) ? ses.budget.filter((b) => Array.isArray(b) && Number.isFinite(b[0]) && Number.isFinite(b[1])) : []; });
on("session", (ch) => { if (ch.budget) state.budget = Array.isArray(ch.budget.newValue) ? ch.budget.newValue : []; });

// Why nothing may be sent right now, as the text to show: the API pause, or the hourly budget. null = nothing stops a request (a dead token
// is not in here: isDead() / sessionError say that). The list loaders ask BEFORE they take a rate slot, so a pause never burns a slot.
export function pauseNote() {
  const pause = state.cooldownUntil - Date.now();
  if (pause > 0) return t("err.cooldown", { n: Math.ceil(pause / 60000) });
  const left = budgetLeft();
  return left > 0 ? t("err.budget", { n: Math.ceil(left / 60000) }) : null;
}
// Nothing was sent: a refusal made before the network (no token, dead session, pause, budget, a path that is not allowed).
const local = (err) => Object.assign(err, { local: true });

// One GET. The token and generation are fixed when the call starts.
// retried: already re-sent once after #2635 moved us to a newer API version.
export async function graph(path, params = {}, retried = false) {
  const token = state.token, gen = state.gen, ctl = state.ctl;
  if (!token) throw local(new Error(t("err.noToken")));
  const dead = deadOf(token);
  if (dead) throw local(sessionError(dead.code));
  if (!PATH_OK.test(String(path))) throw local(new Error(t("err.path")));
  const pause = pauseNote();
  if (pause) throw local(Object.assign(new Error(pause), { pause: true }));
  budgetTake();
  const qs = new URLSearchParams(params).toString();
  const url = `${getGraphUrl()}${state.apiVersion}/${path}${qs ? `?${qs}` : ""}`;
  const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  let res;
  try {
    res = await fetchFromPopup(url, token, signal);
  } catch (e) {
    if (ctl.signal.aborted || gen !== state.gen) throw new Stale();
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new Error(t("err.timeout", { n: TIMEOUT_MS / 1000 }));
    throw new Error(t("err.net", { m: e.message }));
  }
  // The throttle pause applies even to a stale response: the limit is real either way.
  const e = res.body?.error;
  if (res.status === 429 || (e && (THROTTLE_CODES.has(e.code) || (e.code >= 80000 && e.code <= 80999)))) {
    startCooldown();
    throw new Error(t("err.limit", { c: e ? t("err.code", { c: e.code }) : "HTTP 429" }));
  }
  if (gen !== state.gen) throw new Stale();
  setUsage(res.headers);
  adoptVersion(res.headers?.get("x-ad-api-version-warning"));   // auto-upgraded: use the new one next time
  if (e?.code === DEPRECATED_VERSION_CODE) {
    if (!retried && adoptVersion(e.message)) return graph(path, params, true);
    throw new Error(t("err.version", { v: state.apiVersion }));
  }
  // Invalid / expired token, checkpoint, password changed: nothing will work until FB hands out a new token.
  if (e && isSessionError(e.code)) {
    const code = sessionLabel(e.code, e.error_subcode);
    markDead(token, code);
    throw sessionError(code);
  }
  if (e) {
    const err = new Error(cleanText(e.error_user_msg || e.message, 500) || t("err.graph"));        // Graph's words reach a toast: cleaned like a name
    err.code = e.code; err.subcode = e.error_subcode; err.raw = cleanText(e.message, 500);
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body || typeof res.body !== "object") throw new Error(t("err.empty"));
  return res.body;
}

// EAAB / EAAH are session-bound: the FB cookies must ride along (credentials: include; the extension's
// host permission makes them first-party here). No retry from inside the FB tab: Graph answers
// Access-Control-Allow-Origin: *, which forbids credentialed CORS from a page (checked 2026-09-28).
export async function fetchFromPopup(url, token, signal) {
  const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, credentials: "include", signal });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, headers: res.headers, body };
}

// Which optional field did Graph complain about? null = the error is not about an optional field.
// `optional` = { key: expression }; the error text is matched against the keys.
export function optionalFieldIn(e, optional, skip) {
  if (!(e.code === 100 || /field/i.test(e.raw || ""))) return null;
  return Object.keys(optional).find((k) => !skip.has(k) && (e.raw || e.message).includes(k)) || null;
}

// GET an edge page by page, with optional fields. On a field error only the named field is dropped and the SAME page is
// asked again, so a token that cannot read one extra field still gets the rest.
//   path      "me/adaccounts"
//   base      fields that are always asked for (array)
//   optional  { key: "field expression" }: the extras some tokens cannot read. The key must appear in Graph's complaint
//             (that is what the error is matched against), the expression is what goes into `fields`
//   skip      the Set of keys dropped so far (it is added to; the caller owns it), or a function returning that Set: pass
//             () => state.skip when the Set is replaced while the loop runs (a token change swaps it)
//   params    extra query parameters on every page (a filter, …)
//   map       applied to each row as its page arrives, so a row keeps the `skip` state of its own page
//   limit     page size, default 50; maxPages, default 10 (more pages left = truncated)
// → { rows, truncated }. Throws what graph() throws (Stale too); an answer without a data array is an error.
export async function readPaged(path, { base = [], optional = {}, skip = new Set(), params = {}, map = (x) => x, limit = 50, maxPages = 10 } = {}) {
  const skipSet = () => (typeof skip === "function" ? skip() : skip);
  const rows = [];
  let after = null, pages = 0;
  while (pages < maxPages) {
    let page;
    try {
      const fields = [...base, ...Object.entries(optional).filter(([k]) => !skipSet().has(k)).map(([, f]) => f)].join(",");
      page = await graph(path, { fields, limit: String(limit), ...params, ...(after ? { after } : {}) });
    } catch (e) {
      const k = e instanceof Stale ? null : optionalFieldIn(e, optional, skipSet());
      if (k) { skipSet().add(k); continue; }         // same page again without that field
      throw e;
    }
    if (!Array.isArray(page.data)) throw new Error(t("err.noData"));
    rows.push(...page.data.map(map));
    after = page.paging?.next ? page.paging.cursors?.after : null;
    pages++;
    if (!after) break;
  }
  return { rows, truncated: !!after };
}
