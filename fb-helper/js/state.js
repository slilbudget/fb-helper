// Shared state of the popup and what is kept for it in chrome.storage.session (gone when the browser closes).
// No DOM in here: when something has to be redrawn, an event goes out on the bus (bus.js) and the module that owns
// that part of the screen reacts. That keeps this file below graph.js and every tab in the dependency graph.

import { t } from "./i18n.js";
import { on, emit } from "./bus.js";
import { API_VERSION, getGraphUrl } from "./config.js";

// Core fields. A feature module adds its own with Object.assign(state, { … }) at the top of its file (cookies.js:
// cookies / ua / uaHint; accounts.js: accounts, ads, period, …), so a new tab never has to edit this file.
export const state = {
  token: null, tokenSource: null, apiVersion: API_VERSION, owner: null, cooldownUntil: 0, usage: null,
  // Tokens Graph reported as dead ([{ token, code }], newest last, at most 5): no request is sent with them again.
  // The ⟳ next to the token clears the current one's mark (the deliberate retry). Persisted in storage.session.
  dead: [],
  checked: null,                                     // last token↔c_user answer: { token, user, verdict, meId }
  // Rate locks survive popup reopen (storage.session), unlike the data cache. { slots: { [key]: untilMs } }, see claimSlot.
  locks: { slots: {} },
  // Generation: bumped on token change. Every request captures it;
  // a response from an older generation is dropped (Stale) and in-flight fetches are aborted.
  gen: 0, ctl: new AbortController(),
  skip: new Set(),                                   // optional fields Graph refused for this token (see readPaged); reset with the generation
  grabOp: 0,                                         // latest token grab wins; older ones are dropped
  // Why a list tab has nothing to show: { accounts: { perm, msg }, bms: …, pages: … } from the last load that failed (list-loader.js), cleared by the
  // next load that goes out and by a token change. perm = this token cannot read it at all (pure.js isPermError).
  listErr: {},
  tokenHint: null,                                   // the Token tab's reason for having no token ("Open Facebook in this profile"), shown by the list tabs too
};
export class Stale extends Error {}

// ---------- storage ----------
// Never rejects: resolves true when written, false when storage refused (quota, a closing page). Most callers do not wait for it, and a
// rejected promise nobody handles is only noise in the console; the data is still in memory, so the screen is right either way.
// Callers that must have it stored before going on (a list load) `await` it.
export const saveSession = (patch) => chrome.storage.session.set(patch).then(() => true, (e) => { console.warn("storage.session.set failed:", e?.message || e); return false; });

// Modules restore their part of the saved state through onLoad (keys to read from storage.session, then fn(session) —
// may be async) or registerCache (below, for lists that belong to the FB user). Both are collected here so that
// loadState stays ONE storage read, and a new tab adds its keys without editing this file.
const loaders = [];
export const onLoad = (keys, fn) => { loaders.push({ keys, fn }); };

export async function loadState() {
  // storage.session is wiped on extension update/reload, so a cache is always from this API_VERSION.
  const ses = await chrome.storage.session.get(["token", "tokenSource", "dead", "checked", "owner", "locks", ...loaders.flatMap((l) => l.keys)]);
  for (const l of loaders) await l.fn(ses);
  Object.assign(state, {
    token: ses.token || null, tokenSource: ses.tokenSource || null, dead: Array.isArray(ses.dead) ? ses.dead : [],
    checked: ses.checked?.token ? ses.checked : null, owner: ses.owner || null, locks: normLocks(ses.locks),
  });
}

// ---------- the FB user and the caches that belong to it ----------
// The logged-in FB user of this profile (c_user cookie), or null when logged out.
export async function fbUser() {
  try { return (await chrome.cookies.get({ url: getGraphUrl(), name: "c_user" }))?.value || null; }
  catch { return null; }
}

// Lists loaded for one FB user (accounts and their ads, later business managers, pages…): kept across popup reopen and
// token changes, dropped together when the FB user changes. A module registers what it caches:
//   keys    its storage.session keys (removed on a drop; read back by loadState)
//   reset   puts its part of `state` back to empty
//   load    optional, fn(session): restores its part of `state` from the keys, at popup start
//   has     optional, () => true while it holds data. checkOwner only compares the FB user while some cache has data;
//           a cache without `has` never asks for that check on its own.
// The FB user the lists belong to is state.owner / the "owner" key, shared by all of them: write it when you fill a cache.
const caches = [];
export function registerCache(keys, reset, { load, has } = {}) {
  const taken = new Set(cacheKeys());
  for (const k of keys) if (taken.has(k)) throw new Error(`cache key "${k}" is already registered`);
  caches.push({ keys, reset, has });
  if (load) onLoad(keys, load);
}
export const cacheKeys = () => ["owner", ...caches.flatMap((c) => c.keys)];
export function dropCache() {
  state.owner = null;
  for (const c of caches) c.reset();
  return chrome.storage.session.remove(cacheKeys());
}
// The cached lists are someone else's (other login, or logged out): drop them. true = dropped.
export async function checkOwner() {
  if (!caches.some((c) => c.has?.()) || state.owner === await fbUser()) return false;
  await dropCache();
  return true;
}

// ---------- rate slots ----------
// storage.session "locks" = { slots: { [key]: untilMs } }. Anything else (nothing stored, or an older shape such as
// { accountsAt, ads }) reads as "no slot taken", so writing { accountsAt: 0, ads: {} } still frees everything.
const normLocks = (raw) => ({ slots: { ...(raw?.slots || {}) } });
// Claim a rate slot atomically across every open page of this extension (popups in several windows):
// Web Locks are shared per origin, and the check re-reads storage inside the lock.
// key names what is limited: "accounts" = the account list, "ads:<id>" = one account's ads, later "bms", "pages", …
// ms = how long a granted slot blocks the next claim of the same key. Returns 0 if granted, else ms to wait.
// Claim BEFORE sending: a failed attempt counts like a good one.
export function claimSlot(key, ms) {
  return navigator.locks.request("fbh-rate", async () => {
    const { locks } = await chrome.storage.session.get("locks");
    const cur = normLocks(locks);
    const now = Date.now();
    for (const [k, until] of Object.entries(cur.slots)) if (until < now) delete cur.slots[k];
    const until = cur.slots[key] || 0;
    if (until > now) { state.locks = cur; return until - now; }
    cur.slots[key] = now + ms;
    await chrome.storage.session.set({ locks: cur });
    state.locks = cur;
    return 0;
  });
}
// Milliseconds until the slot is free again (0 = free), as of the last read of storage.session.
export const slotLeft = (key) => Math.max(0, (state.locks.slots[key] || 0) - Date.now());

// Token changed: cancel in-flight requests (their answers are dropped as Stale).
// The account cache stays; rate locks and the throttle pause are kept on purpose.
// Per-token sets of the modules (busy rows, refused reads) are reset by the "generation" event.
export function newGeneration() {
  state.gen++;
  state.ctl.abort();
  state.ctl = new AbortController();
  state.skip = new Set();
  state.listErr = {};                                  // the new token may read what the old one could not
  emit("generation");
}

// ---------- dead token ----------
// The token is dead (Graph said so earlier): every call refuses before the network, so a dead login is never hammered.
export const deadOf = (token) => (token ? state.dead.find((d) => d.token === token) : undefined);
export const isDead = () => !!deadOf(state.token);
export const deadCode = () => deadOf(state.token)?.code;
export function sessionError(code) {
  const err = new Error(t("err.session", { c: code }));
  err.session = true;
  return err;
}
export function markDead(token, code) {
  state.dead = [...state.dead.filter((d) => d.token !== token), { token, code }].slice(-5);
  saveSession({ dead: state.dead });
  emit("token-dead");
}
export function clearDead(token) {
  if (!deadOf(token)) return;
  state.dead = state.dead.filter((d) => d.token !== token);
  saveSession({ dead: state.dead });
}

// Another window of this extension took or freed rate slots, or found the token dead (or a new token replaced it): follow.
on("session", (ch) => {
  if (ch.locks) { state.locks = normLocks(ch.locks.newValue); emit("locks"); }
  if (ch.dead) { state.dead = Array.isArray(ch.dead.newValue) ? ch.dead.newValue : []; emit("token-dead"); }
});
