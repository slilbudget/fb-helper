// Every request to Graph goes through here: API version handling, usage and throttle bookkeeping, dead-session
// detection, paged reads. No DOM: the "usage" event tells header.js to redraw the pill, markDead (state.js) tells
// token.js. The host itself is handed in by the entry (config.js).

import { t } from "./i18n.js";
import { isSessionError, sessionLabel, verNum, latestVersion } from "./pure.js";
import { getGraphUrl } from "./config.js";
import { state, Stale, saveSession, onLoad, deadOf, sessionError, markDead } from "./state.js";
import { on, emit } from "./bus.js";

const DEPRECATED_VERSION_CODE = 2635;
const COOLDOWN_MS = 30 * 60 * 1000;          // throttle → 30 min hands off, no retries
const TIMEOUT_MS = 20 * 1000;
const THROTTLE_CODES = new Set([4, 17, 32, 613]);

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

// One GET. The token and generation are fixed when the call starts.
// retried: already re-sent once after #2635 moved us to a newer API version.
export async function graph(path, params = {}, retried = false) {
  const token = state.token, gen = state.gen, ctl = state.ctl;
  if (!token) throw new Error(t("err.noToken"));
  const dead = deadOf(token);
  if (dead) throw sessionError(dead.code);
  const left = state.cooldownUntil - Date.now();
  if (left > 0) throw new Error(t("err.cooldown", { n: Math.ceil(left / 60000) }));
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
    const err = new Error(e.error_user_msg || e.message || t("err.graph"));
    err.code = e.code; err.subcode = e.error_subcode; err.raw = e.message || "";
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
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, credentials: "include", signal });
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
