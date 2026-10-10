// Money for the screen: amounts (fmtMoney), conversion (toUsd, usdEquivalent), the lines of totals and rows (totalLine, rowAmount),
// and the exchange rates they need (rates). The pure half is money-core.js (plain Node, tested); this file only fetches and caches.
//
// The ONLY other network use of the extension besides the Graph reads (the manifest CSP lists both URLs in connect-src). One public
// dataset (fawazahmed0/exchange-api, CC0: no key, no attribution), two mirrors of the same file:
//   primary    GET https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json
//   fallback   GET https://latest.currency-api.pages.dev/v1/currencies/usd.json
// No parameters, no cookies, no referrer, nothing about the user or the accounts goes out: it is the same public file for everyone.
// Asked only when a caller asks (period.js and the tabs, when a total or an order with two or more currencies is on a tab that is
// on screen) and the cache is older than 24 h; after a failed attempt nothing is sent for 20 minutes. A new table that disagrees
// wildly with the one we hold (money-core.js plausibleRates) counts as a failed attempt: the held table stays. The table lives in chrome.storage.local ("fx"), a failed attempt in
// "fxFail". A Web Lock keeps two open popups from both asking. rates() never throws: no table is `null`.

import { FX_FAIL_BACKOFF_MS, normalizeRates, readCache, isFresh, isUsable, publicRates, plausibleRates } from "./money-core.js";
export { fmtMoney, toUsd, totalLine, rowAmount } from "./money-core.js";

const SOURCES = [
  { url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json" },
  { url: "https://latest.currency-api.pages.dev/v1/currencies/usd.json" },
];
const KEY = "fx", FAIL_KEY = "fxFail", LOCK = "fbh-fx";
const TIMEOUT_MS = 8000, MAX_BYTES = 1e6;

let mem = null;                                        // the newest table seen: { rates, date, source, fetchedAt }
let failUntil = 0;                                     // in-memory twin of the failure mark, so the 30 s redraws cost no storage read
let inflight = null;                                   // one lookup at a time in this popup

// The table as it is right now, without asking anybody (null: none yet / older than a week). A caller paints with this first.
export const cachedRates = () => (mem && isUsable(mem) ? publicRates(mem) : null);

// Reads the saved table from chrome.storage.local into memory. No network: popups call it at start, so the first paint of a total
// already knows the rates.
export async function loadCachedRates() {
  try {
    const c = readCache((await chrome.storage.local.get(KEY))[KEY]);
    if (c && (!mem || c.fetchedAt > mem.fetchedAt)) mem = c;
  } catch { /* no storage: nothing cached */ }
  return cachedRates();
}

// { rates: { EUR: 0.86, … } (units per 1 USD), date: "2026-10-08", source } or null. Safe to call on every redraw: a fresh table
// answers at once, a failed attempt is not repeated for 20 minutes, concurrent calls share one lookup.
export function rates() {
  if (!inflight) inflight = load().catch(() => cachedRates()).finally(() => { inflight = null; });
  return inflight;
}

async function load() {
  const now = Date.now();
  if (mem && isFresh(mem, now)) return publicRates(mem);
  if (failUntil > now) return cachedRates();
  const locks = globalThis.navigator?.locks;
  return locks?.request ? locks.request(LOCK, refresh) : refresh();
}

// Inside the lock: another popup may have fetched while this one waited, so storage is read again first.
async function refresh() {
  const now = Date.now();
  let failAt = 0;
  try {
    const o = await chrome.storage.local.get([KEY, FAIL_KEY]);
    const c = readCache(o[KEY]);
    if (c && (!mem || c.fetchedAt >= mem.fetchedAt)) mem = c;
    failAt = Number(o[FAIL_KEY]?.at) || 0;
  } catch { /* treat as nothing stored */ }
  if (mem && isFresh(mem, now)) return publicRates(mem);
  if (failAt && now - failAt >= 0 && now - failAt < FX_FAIL_BACKOFF_MS) { failUntil = failAt + FX_FAIL_BACKOFF_MS; return cachedRates(); }
  for (const src of SOURCES) {
    const got = await fetchOne(src);
    if (!got) continue;
    if (mem && isUsable(mem) && !plausibleRates(got.rates, mem.rates)) continue;   // not believed: the next source may agree with what we hold
    mem = { ...got, fetchedAt: Date.now() };
    failUntil = 0;
    try { await chrome.storage.local.set({ [KEY]: { fetchedAt: mem.fetchedAt, date: mem.date, base: "USD", rates: mem.rates, source: mem.source } }); await chrome.storage.local.remove(FAIL_KEY); } catch { /* kept in memory */ }
    return publicRates(mem);
  }
  failUntil = Date.now() + FX_FAIL_BACKOFF_MS;
  try { await chrome.storage.local.set({ [FAIL_KEY]: { at: Date.now() } }); } catch { /* */ }
  return cachedRates();                                // an older table (up to a week) still beats no conversion
}

async function fetchOne({ url }) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!res.ok || Number(res.headers?.get?.("content-length")) > MAX_BYTES) return null;
    const text = await res.text();
    if (text.length > MAX_BYTES) return null;
    return normalizeRates(JSON.parse(text), Date.now());
  } catch { return null; }                             // offline, blocked, timed out, not JSON
  finally { clearTimeout(timer); }
}
