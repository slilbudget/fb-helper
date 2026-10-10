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
// opts.digits  force the fraction digits (0 or 2; a currency without cents always has 0): the amounts of ONE string share them (see build)
// opts.compact a currency written with its ISO code and a million or more is written short: "28,9 млн VND" / "VND 28.9M" (the exact number is
//              the tooltip's: build keeps both); a familiar currency never is
const compactFmts = new Map();
function compactFormatter(cur) {
  const k = `${locale()}:${cur}`;
  if (!compactFmts.has(k)) {
    try { compactFmts.set(k, new Intl.NumberFormat(locale(), { style: "currency", currency: cur, currencyDisplay: "code", notation: "compact", compactDisplay: "short", maximumFractionDigits: 1 })); }
    catch { compactFmts.set(k, null); }
  }
  return compactFmts.get(k);
}
export function fmtMoney(amount, cur, { digits: want, compact = false } = {}) {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  const c = String(cur || "USD").toUpperCase();
  // What would print as zero IS zero: −0, −0.001 and 0.004 are "0", never "-0.00" / "-$0.00" (Intl keeps the sign of a rounded zero).
  const v = Math.round(Math.abs(n) * (ZERO_DECIMAL.has(c) ? 1 : 100)) === 0 ? 0 : n;
  if (compact && !SYMBOL_CURRENCIES.has(c) && Math.abs(v) >= 1e6) { const cf = compactFormatter(c); if (cf) return cf.format(v); }
  const digits = ZERO_DECIMAL.has(c) || v === 0 ? 0 : want ?? (Math.abs(Math.round(v * 100) / 100) >= 1000 ? 0 : 2);
  const f = formatter(c, digits);
  return f ? f.format(v) : `${new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(v)} ${cur}`;
}

// ---------- rate tables ----------
// A table = { rates: { EUR: 0.86, VND: 26300, … }, date: "2026-10-08", source } where rates[X] = units of X per 1 USD.
// One public dataset (fawazahmed0/exchange-api, CC0), two mirrors of it (money.js SOURCES), one payload shape, one source id.
export const SRC_FX = "currency-api";
export const FX_FRESH_MS = 24 * 3600e3;                // rates are asked for again after a day
export const FX_STALE_OK_MS = 7 * 24 * 3600e3;         // …but a table up to a week old still beats no conversion when the refresh fails
export const FX_FAIL_BACKOFF_MS = 20 * 60e3;           // after a failed (or rejected) attempt: nothing for 20 minutes
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
// A table that arrives while another one is held must roughly agree with it: a day does not move the world's currencies by half. When more than
// a quarter of the codes both tables name (USD aside) moved by more than 50 % the newcomer is not believed (an inverted table, another unit,
// a broken mirror) and the held one stays. Not "any code": one real devaluation or a crypto ticker among the hundreds of codes of the dataset
// must not freeze the rates. With fewer than MIN_CODES shared codes there is nothing to compare, so it passes.
const FX_MAX_MOVE = 0.5, FX_MAX_WILD_SHARE = 0.25;
export function plausibleRates(next, prev) {
  if (!next || !prev) return true;
  const shared = Object.keys(next).filter((k) => k !== "USD" && Object.hasOwn(prev, k));
  if (shared.length < MIN_CODES) return true;
  const wild = shared.filter((k) => Math.abs(next[k] / prev[k] - 1) > FX_MAX_MOVE).length;
  return wild <= shared.length * FX_MAX_WILD_SHARE;
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// The payload ({ date: "2026-10-08", usd: { eur: 0.86, vnd: 26300, … } }, lower-case codes) → { rates, date, source } | null.
// `now` = the day to use when the payload carries no usable date.
export function normalizeRates(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object") return null;
  if (!payload.usd || typeof payload.usd !== "object" || Array.isArray(payload.usd)) return null;
  const rates = cleanRates(Object.fromEntries(Object.entries(payload.usd).map(([k, v]) => [k.toUpperCase(), v])));
  if (!rates) return null;
  return { rates, date: typeof payload.date === "string" && DAY.test(payload.date) ? payload.date : isoDay(now), source: SRC_FX };
}
// What chrome.storage.local holds ({ fetchedAt, date, base, rates, source }) → a checked table + fetchedAt, or null. A table saved by an
// older version carries another source id: it is not read (stale), the next lookup fetches a new one.
export function readCache(raw) {
  if (!raw || typeof raw !== "object" || raw.base !== "USD" || raw.source !== SRC_FX) return null;
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
//   main        the line: "$1,696" · "$75.00 + €20.00" · "≈ $1,770" (an ISO-code currency of a million or more is short: "VND 28.9M")
//   text        what a ROW prints on one line (rowAmount): main, except three or more currencies without rates, which would be a line wider than
//               the row: the two biggest and "+N more" ("$1,696 + VND 1.2M +1 more"). A total (totalLine) keeps every currency: text = main
//   approx      main is a USD conversion (starts with "≈")
//   breakdown   what it is made of, at most two currencies, biggest first: "$1,696 + VND 1,234,567" ("" when main already says it)
//   more        how many currencies breakdown leaves out (the caller prints "+N")
//   full        every currency, exact: "$1,696 + VND 1,234,567 + €20.00" (always filled: the tooltip / expanded body)
//   title       tooltip: full + "Approximate: converted at the daily rate of Oct 8, 2026." ("" when exact)
//   note        "rates Oct 8" ("rates 08.10" in Russian); date, source (no provider credit on screen: user decision 2026-10-08)
//   parts       [{ cur, amount, text (as printed on a line), exact, usd }] in the order of full
function build(totals, r, approxFrom) {
  const list = Object.entries(totals || {}).filter(([, v]) => Number.isFinite(v) && v !== 0);
  // The amounts of one string share their fraction digits: with any amount under 1 000 every amount has its cents ("1 695,70 $ + 20,00 €"), with
  // none under it no amount has them ("1 696 $ + 2 500 €"). A currency without cents has none either way.
  const cents = list.some(([cur, v]) => !ZERO_DECIMAL.has(cur) && Math.abs(Math.round(v * 100) / 100) < 1000);
  const digits = cents ? 2 : 0;
  const parts = list.map(([cur, amount]) => ({ cur, amount, text: fmtMoney(amount, cur, { digits, compact: true }), exact: fmtMoney(amount, cur, { digits }), usd: toUsd(amount, cur, r) }));
  const out = { main: "", text: "", approx: false, breakdown: "", more: 0, full: "", title: "", note: "", date: null, source: null, parts };
  if (!parts.length) return out;
  const convertible = !!r && parts.every((p) => p.usd !== null);
  if (convertible) parts.sort((a, b) => b.usd - a.usd || (a.cur < b.cur ? -1 : 1));
  out.full = parts.map((p) => p.exact).join(" + ");                        // always exact: the tooltip / the expanded body
  const shortFull = parts.map((p) => p.text).join(" + ");                   // what a line prints: a million of an ISO-code currency is written short
  if (parts.length < approxFrom || !convertible) {
    out.main = shortFull;
    // A row (approxFrom 3) with three or more currencies and no rates: the two biggest + "ещё N", never a line wider than the row.
    out.text = approxFrom === 3 && parts.length > 2 ? `${parts[0].text} + ${parts[1].text} ${t("money.more", { n: parts.length - 2 })}` : shortFull;
    return out;
  }
  const shown = parts.slice(0, 2);
  const main = `≈ ${fmtMoney(parts.reduce((s, p) => s + p.usd, 0), "USD")}`;
  Object.assign(out, {
    main, text: main, approx: true,
    breakdown: shown.map((p) => p.text).join(" + "), more: parts.length - shown.length,
    date: r.date, source: r.source, note: t("money.rates", { d: shortDate(r.date) }),
    title: `${out.full}\n${t("money.approx", { d: longDate(r.date) })}`,
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
