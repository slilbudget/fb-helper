// Money: how an amount is written, how currencies are converted and added into one line, and which rate tables are believable.
// The pure half of money.js (which fetches and caches the rates): no DOM, no chrome.*, no network, so test/money.test.mjs runs
// it in plain Node. The UI language comes from i18n.js (number format, the tooltip).
//
// Rules (design.md §5 + §8):
//   - Amounts of the account's own currency: the familiar currencies (SYMBOL_CURRENCIES) keep their symbol ($ € £ ₽ ₴ ₸ ₺ ₹ ¥ ₩
//     R$ zł where the UI language has one), every other currency is written with its ISO code ("1 234 567 VND"), so no ₫ / ₲ / ₡ is
//     ever a mystery. 1 000 and more has no decimals, so does zero ("0 $"), so do the currencies that have no useful cents.
//   - "≈" only where several currencies are added into one USD figure. totalLine = the grand total (two or more currencies);
//     rowAmount = one row / group / business (exact for one or two currencies, "≈" from three).
//   - A currency without a rate is never left out of an "≈" sum: the whole line then falls back to exact "a + b + c".

import { locale, t } from "./i18n.js";
import { shortDate } from "./format.js";
import "./strings/money.js";

// ---------- writing an amount ----------
export const SYMBOL_CURRENCIES = new Set(["USD", "EUR", "GBP", "RUB", "UAH", "KZT", "TRY", "INR", "JPY", "KRW", "BRL", "PLN"]);
// Meta's whole-unit currencies (format.js NO_OFFSET) except TWD (a few per dollar: cents still mean something).
export const ZERO_DECIMAL = new Set(["CLP", "COP", "CRC", "HUF", "IDR", "ISK", "JPY", "KRW", "PYG", "VND"]);

const fmts = new Map();                                // one Intl formatter per UI language / currency / digits: they are slow to build
function formatter(cur, digits) {
  const k = `${locale()}:${cur}:${digits}`;
  if (!fmts.has(k)) {
    try {
      fmts.set(k, new Intl.NumberFormat(locale(), { style: "currency", currency: cur, currencyDisplay: SYMBOL_CURRENCIES.has(cur) ? "symbol" : "code",
        minimumFractionDigits: digits, maximumFractionDigits: digits }));
    } catch { fmts.set(k, null); }                     // not a currency code at all
  }
  return fmts.get(k);
}
// fmtMoney(1727.3, "USD") → "1 727 $" (ru) / "$1,727" (en); fmtMoney(20, "EUR") → "20,00 €"; fmtMoney(1234567, "VND") → "1 234 567 VND";
// fmtMoney(0, "USD") → "0 $". null / "" / NaN → "—". `cur` missing = USD (the old fmt() did the same).
export function fmtMoney(amount, cur) {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  const c = String(cur || "USD").toUpperCase();
  const v = n === 0 ? 0 : n;                           // −0 prints as "0"
  const digits = ZERO_DECIMAL.has(c) || v === 0 || Math.abs(Math.round(v * 100) / 100) >= 1000 ? 0 : 2;
  const f = formatter(c, digits);
  return f ? f.format(v) : `${new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(v)} ${cur}`;
}

// ---------- rate tables ----------
// A table = { rates: { EUR: 0.86, VND: 26300, … }, date: "2026-10-08", source } where rates[X] = units of X per 1 USD.
export const SRC_ER = "exchangerate-api", SRC_CDN = "currency-api";
// The provider of SRC_ER asks for a visible credit: "Rates By Exchange Rate API" linking to its site (tooltip + a link on the line).
export const ATTRIBUTION = { text: "ExchangeRate-API", full: "Rates By Exchange Rate API", url: "https://www.exchangerate-api.com" };
export const FX_FRESH_MS = 24 * 3600e3;                // rates are asked for again after a day
export const FX_STALE_OK_MS = 7 * 24 * 3600e3;         // …but a table up to a week old still beats no conversion when the refresh fails
export const FX_FAIL_BACKOFF_MS = 10 * 60e3;           // after a failed attempt: nothing for 10 minutes
const CLOCK_SLACK_MS = 5 * 60e3;                       // a table "from the future" by more than this is not trusted (the clock moved)
const MIN_CODES = 5, MAX_KEYS = 2000, LOW = 1e-9, HIGH = 1e12;

// Only 3-letter codes with a finite number in [1e-9, 1e12] survive; anything else (strings, 0, negatives, NaN, nested objects,
// "__proto__") is dropped. USD is always exactly 1. null when too little is left to be a rate table.
export function cleanRates(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const keys = Object.keys(obj);
  if (keys.length > MAX_KEYS) return null;
  const out = {};
  for (const k of keys) {
    const v = obj[k];
    if (/^[A-Za-z]{3}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v >= LOW && v <= HIGH) out[k.toUpperCase()] = v;
  }
  out.USD = 1;
  return Object.keys(out).length - 1 >= MIN_CODES ? out : null;
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// The two payload shapes → { rates, date, source } | null. `now` = the day to use when the payload carries no usable date.
export function normalizeRates(payload, source, now = Date.now()) {
  if (!payload || typeof payload !== "object") return null;
  let rates, date = null;
  if (source === SRC_ER) {
    // { result: "success", base_code: "USD", time_last_update_unix: 1790000000, rates: { USD: 1, EUR: 0.86 } }
    if (payload.result !== undefined && payload.result !== "success") return null;
    if (payload.base_code !== undefined && String(payload.base_code).toUpperCase() !== "USD") return null;
    rates = cleanRates(payload.rates);
    const u = payload.time_last_update_unix;
    if (typeof u === "number" && Number.isFinite(u) && u > 1e9 && u < 1e11) date = isoDay(u * 1000);
    else if (typeof payload.time_last_update_utc === "string" && Number.isFinite(Date.parse(payload.time_last_update_utc))) date = isoDay(Date.parse(payload.time_last_update_utc));
  } else if (source === SRC_CDN) {
    // { date: "2026-10-08", usd: { eur: 0.86, vnd: 26300, … } } (lower-case codes)
    if (!payload.usd || typeof payload.usd !== "object" || Array.isArray(payload.usd)) return null;
    rates = cleanRates(Object.fromEntries(Object.entries(payload.usd).map(([k, v]) => [k.toUpperCase(), v])));
    if (typeof payload.date === "string" && DAY.test(payload.date)) date = payload.date;
  } else return null;
  if (!rates) return null;
  return { rates, date: date || isoDay(now), source };
}
// What chrome.storage.local holds ({ fetchedAt, date, base, rates, source }) → a checked table + fetchedAt, or null.
export function readCache(raw) {
  if (!raw || typeof raw !== "object" || raw.base !== "USD" || ![SRC_ER, SRC_CDN].includes(raw.source)) return null;
  if (typeof raw.fetchedAt !== "number" || !Number.isFinite(raw.fetchedAt) || typeof raw.date !== "string" || !DAY.test(raw.date)) return null;
  const rates = cleanRates(raw.rates);
  return rates ? { rates, date: raw.date, source: raw.source, fetchedAt: raw.fetchedAt } : null;
}
export const isFresh = (c, now = Date.now()) => !!c && now - c.fetchedAt > -CLOCK_SLACK_MS && now - c.fetchedAt < FX_FRESH_MS;
export const isUsable = (c, now = Date.now()) => !!c && now - c.fetchedAt > -CLOCK_SLACK_MS && now - c.fetchedAt < FX_STALE_OK_MS;
export const publicRates = (c) => ({ rates: c.rates, date: c.date, source: c.source });

// ---------- converting ----------
// amount of `cur` in USD, or null when there is no rate for it. `r` = a table as rates() returns it (or null: only USD converts).
export function toUsd(amount, cur, r) {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === "" || !Number.isFinite(n)) return null;
  const c = String(cur || "USD").toUpperCase();
  if (c === "USD") return n;
  const rate = r?.rates && Object.hasOwn(r.rates, c) ? r.rates[c] : undefined;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? n / rate : null;
}
// { USD: 12, EUR: 5 } → the USD value of the whole, or null when any currency has no rate. Used to order rows by spend.
export function usdEquivalent(totals, r) {
  let sum = 0;
  for (const [cur, v] of Object.entries(totals || {})) {
    const usd = toUsd(v, cur, r);
    if (usd === null) return null;
    sum += usd;
  }
  return sum;
}

// ---------- one line from several currencies ----------
// totals = { USD: 1695.7, EUR: 20 } (spend.js addUp: a currency that spent nothing is not in it). Returns
//   main        the line: "$1,696" · "$75 + €20.00" · "≈ $1,770"
//   approx      main is a USD conversion (starts with "≈")
//   breakdown   what it is made of, at most two currencies, biggest first: "$1,696 + VND 1,234,567" ("" when main already says it)
//   more        how many currencies breakdown leaves out (the caller prints "+N")
//   full        every currency, exact: "$1,696 + VND 1,234,567 + €20.00" (always filled: the tooltip / expanded body)
//   title       tooltip: full + "Approximate: converted at the daily rate of Oct 8, 2026. Rates By Exchange Rate API" ("" when exact)
//   note        "rates Oct 8" ("rates 08.10" in Russian); date, source, attribution (ATTRIBUTION when SRC_ER was used, else null)
//   parts       [{ cur, amount, text, usd }] in the order of full
function build(totals, r, approxFrom) {
  const parts = Object.entries(totals || {}).filter(([, v]) => Number.isFinite(v) && v !== 0)
    .map(([cur, amount]) => ({ cur, amount, text: fmtMoney(amount, cur), usd: toUsd(amount, cur, r) }));
  const out = { main: "", approx: false, breakdown: "", more: 0, full: "", title: "", note: "", date: null, source: null, attribution: null, parts };
  if (!parts.length) return out;
  const convertible = !!r && parts.every((p) => p.usd !== null);
  if (convertible) parts.sort((a, b) => b.usd - a.usd || (a.cur < b.cur ? -1 : 1));
  out.full = parts.map((p) => p.text).join(" + ");
  if (parts.length < approxFrom || !convertible) { out.main = out.full; return out; }
  const shown = parts.slice(0, 2);
  const attribution = r.source === SRC_ER ? ATTRIBUTION : null;
  Object.assign(out, {
    main: `≈ ${fmtMoney(parts.reduce((s, p) => s + p.usd, 0), "USD")}`, approx: true,
    breakdown: shown.map((p) => p.text).join(" + "), more: parts.length - shown.length,
    date: r.date, source: r.source, attribution, note: t("money.rates", { d: shortDate(r.date) }),
    title: `${out.full}\n${t("money.approx", { d: longDate(r.date) })}${attribution ? ` ${attribution.full}` : ""}`,
  });
  return out;
}
const longDate = (d) => {
  try { return new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)); } catch { return d; }
};
// The grand total of a list: two or more currencies → "≈ USD" when every one has a rate.
export const totalLine = (totals, r = null) => build(totals, r, 2);
// One row, group or business: one or two currencies → exact ("$75 + €20.00"), three or more → "≈ USD" (breakdown in `full` / `title`).
export const rowAmount = (totals, r = null) => build(totals, r, 3);
