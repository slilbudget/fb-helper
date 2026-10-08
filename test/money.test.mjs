// Money (js/money-core.js + js/money.js): how amounts are written (symbol or ISO code, decimals), rate-table validation, conversion,
// the lines of totals and rows, and the rates() cache / fallback / backoff / lock with a fake chrome.storage, fetch and Web Locks.
// Plain Node: nothing here touches the network. Run: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../fb-helper/js/i18n.js";
import {
  fmtMoney, cleanRates, normalizeRates, readCache, isFresh, isUsable, toUsd, usdEquivalent, totalLine, rowAmount,
  SRC_ER, SRC_CDN, ATTRIBUTION, FX_FRESH_MS, FX_STALE_OK_MS, FX_FAIL_BACKOFF_MS, SYMBOL_CURRENCIES, ZERO_DECIMAL, plausibleRates,
} from "../fb-helper/js/money-core.js";

await setLang("en");
const flat = (s) => String(s).replace(/\s/g, " ");                 // Intl uses no-break and narrow spaces
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const RATES = { USD: 1, EUR: 0.8, GBP: 0.75, VND: 25000, UAH: 40, RUB: 90, PLN: 4 };
const TABLE = { rates: RATES, date: "2026-10-08", source: SRC_ER };

// ---------- writing an amount ----------
test("fmtMoney: whatever prints as zero is plain zero — never '-0.00' (C17)", () => {
  for (const [v, cur] of [[-0.001, "USD"], [-0.004, "EUR"], [0.004, "USD"], [-0, "USD"], [-0.4, "VND"], [-0.4, "JPY"], [-1e-9, "RUB"]]) {
    const s = flat(fmtMoney(v, cur));
    assert.ok(!s.includes("-") && !s.includes("−"), `${v} ${cur}: ${s}`);
    assert.equal(s, flat(fmtMoney(0, cur)), `${v} ${cur} is the plain zero`);
  }
  assert.equal(flat(fmtMoney(0, "USD")), "$0");
  assert.equal(flat(fmtMoney(-0.005, "USD")), "-$0.01", "half a cent rounds away from zero: that is a real amount");
  assert.equal(flat(fmtMoney(-12.5, "USD")), "-$12.50");
  assert.equal(flat(fmtMoney(0.5, "VND")), "VND 1", "half a dong rounds up, as before");
});

test("fmtMoney: the familiar currencies keep their symbol, every other one is written with its ISO code", () => {
  assert.equal(fmtMoney(20, "EUR"), "€20.00");
  assert.equal(fmtMoney(20.5, "GBP"), "£20.50");
  assert.equal(fmtMoney(20.5, "USD"), "$20.50");
  assert.equal(fmtMoney(20.5, "INR"), "₹20.50");
  assert.equal(fmtMoney(20.5, "BRL"), "R$20.50");
  for (const cur of ["CAD", "AUD", "CNY", "CHF", "MXN", "NGN", "THB"]) {
    const s = flat(fmtMoney(20.5, cur));
    assert.ok(s.includes(cur), `${cur} is written as its code: ${s}`);
    assert.ok(!/[$¥]/.test(s), `${cur} must not borrow an ambiguous symbol: ${s}`);
  }
  // the symbols this app trusts are exactly the whitelist; a currency outside it never prints a lone symbol
  assert.deepEqual([...SYMBOL_CURRENCIES].sort(), ["BRL", "EUR", "GBP", "INR", "JPY", "KRW", "KZT", "PLN", "RUB", "TRY", "UAH", "USD"]);
  assert.equal(fmtMoney(5, "VND").includes("₫"), false);
  assert.equal(fmtMoney(5, "PYG").includes("₲"), false);
  assert.equal(fmtMoney(5, "CRC").includes("₡"), false);
});

test("fmtMoney: the Russian format puts the symbol / code after the number", async () => {
  await setLang("ru");
  try {
    assert.equal(flat(fmtMoney(20.5, "USD")), "20,50 $");
    assert.equal(flat(fmtMoney(20, "EUR")), "20,00 €");
    assert.equal(flat(fmtMoney(1234567, "VND")), "1 234 567 VND");
    assert.equal(flat(fmtMoney(20.5, "CAD")), "20,50 CAD");
    assert.equal(flat(fmtMoney(1727.3, "USD")), "1 727 $");
  } finally { await setLang("en"); }
});

test("fmtMoney: 1 000 and more has no decimals, zero is '0', cents appear below 1 000", () => {
  assert.equal(fmtMoney(1727.3, "USD"), "$1,727");
  assert.equal(fmtMoney(1000, "EUR"), "€1,000");
  assert.equal(fmtMoney(999.99, "USD"), "$999.99");
  assert.equal(fmtMoney(999.996, "USD"), "$1,000", "rounds up to 1 000 → no decimals");
  assert.equal(fmtMoney(0, "USD"), "$0");
  assert.equal(fmtMoney(-0, "EUR"), "€0");
  assert.equal(fmtMoney("12.5", "USD"), "$12.50", "a numeric string is a number");
  assert.equal(fmtMoney(-1500, "USD"), "-$1,500");
});

test("fmtMoney: VND / PYG / ISK / CRC / KRW / JPY (and the other whole-unit currencies) never show decimals", () => {
  for (const cur of ["VND", "PYG", "ISK", "CRC", "KRW", "JPY", "CLP", "COP", "IDR", "HUF"]) {
    assert.ok(ZERO_DECIMAL.has(cur), cur);
    assert.ok(!/[.,]\d/.test(fmtMoney(20.5, cur)), `${cur} small: ${fmtMoney(20.5, cur)}`);
    assert.ok(!/[.,]\d{1,2}$/.test(fmtMoney(1234567.5, cur)), `${cur} large: ${fmtMoney(1234567.5, cur)}`);
  }
  assert.equal(flat(fmtMoney(1234567, "VND")), "VND 1,234,567");
  assert.equal(fmtMoney(1234, "JPY"), "¥1,234");
  assert.equal(fmtMoney(20.5, "KRW"), "₩21");
  assert.equal(flat(fmtMoney(20.5, "CRC")), "CRC 21");
  assert.ok(!ZERO_DECIMAL.has("TWD") && !ZERO_DECIMAL.has("USD"), "TWD keeps its cents");
});

test("fmtMoney: nothing to print gives a dash; a currency Intl does not know still prints the number and the code", () => {
  for (const bad of [null, undefined, "", NaN, "abc", Infinity]) assert.equal(fmtMoney(bad, "USD"), "—", String(bad));
  assert.equal(fmtMoney(20.5), "$20.50", "no currency = USD (as format.js fmt does)");
  assert.equal(flat(fmtMoney(20.5, "XYZ")), "XYZ 20.50", "any three letters are a code to Intl");
  assert.ok(fmtMoney(20.5, "12").includes("12"), "not even a code: number + the text, no throw");
  assert.equal(fmtMoney(20.5, "eur"), "€20.50", "lower case is fine");
});

// ---------- rate tables ----------
const goodRates = () => ({ USD: 1, EUR: 0.8, GBP: 0.75, VND: 25000, UAH: 40, RUB: 90, PLN: 4, CHF: 0.8, CAD: 1.25 });
test("cleanRates: only 3-letter codes with a finite number in range survive; USD is always 1; too little is not a table", () => {
  const r = cleanRates({ ...goodRates(), USD: 2, bad1: 1, TOOLONG: 3, ABC: "0.5", NEG: -1, ZER: 0, NAN: NaN, HUG: 1e13, TIN: 1e-12, OBJ: { a: 1 }, NUL: null, ARR: [1] });
  assert.deepEqual(Object.keys(r).sort(), Object.keys(goodRates()).sort());
  assert.equal(r.USD, 1, "USD cannot be anything else");
  assert.equal(r.EUR, 0.8);
  for (const bad of [null, undefined, 5, "x", [], [1, 2, 3, 4, 5, 6]]) assert.equal(cleanRates(bad), null, JSON.stringify(bad));
  assert.equal(cleanRates({ USD: 1, EUR: 0.8 }), null, "a table of two currencies is not a rate table");
  assert.equal(cleanRates({ EUR: "0.8", GBP: "0.75", VND: "25000", UAH: "40", RUB: "90", PLN: "4", CHF: "1" }), null, "numbers in quotes are not numbers");
  const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`K${i}`, 1]));
  assert.equal(cleanRates(many), null, "absurdly many keys");
  const proto = cleanRates(JSON.parse('{"__proto__": {"EUR": 9}, "EUR": 0.8, "GBP": 0.75, "VND": 25000, "UAH": 40, "RUB": 90, "PLN": 4}'));
  assert.equal(proto.EUR, 0.8); assert.equal(Object.getPrototypeOf(proto), Object.prototype); assert.equal({}.EUR, undefined);
});

test("normalizeRates: the primary payload (ExchangeRate-API shape)", () => {
  const unix = Date.UTC(2026, 9, 8, 0, 2, 31) / 1000;
  const ok = normalizeRates({ result: "success", base_code: "USD", time_last_update_unix: unix, rates: goodRates() }, SRC_ER, NOW);
  assert.deepEqual(ok, { rates: { ...goodRates() }, date: "2026-10-08", source: SRC_ER });
  assert.equal(normalizeRates({ result: "success", time_last_update_utc: "Thu, 08 Oct 2026 00:02:31 +0000", rates: goodRates() }, SRC_ER, NOW).date, "2026-10-08", "the text date also reads");
  assert.equal(normalizeRates({ rates: goodRates() }, SRC_ER, NOW).date, "2026-10-08", "no date at all: the day of the fetch");
  assert.equal(normalizeRates({ result: "success", rates: goodRates(), time_last_update_unix: "soon" }, SRC_ER, NOW).date, "2026-10-08");
  assert.equal(normalizeRates({ result: "error", "error-type": "quota-reached" }, SRC_ER, NOW), null);
  assert.equal(normalizeRates({ result: "success", base_code: "EUR", rates: goodRates() }, SRC_ER, NOW), null, "base must be USD");
  assert.equal(normalizeRates({ result: "success", rates: { ...goodRates(), EUR: -1 } }, SRC_ER, NOW).rates.EUR, undefined, "a bad entry is dropped, the rest stays");
  for (const bad of [null, undefined, "x", 5, [], {}, { rates: null }, { rates: [] }, { result: "success", rates: { EUR: "no" } }]) assert.equal(normalizeRates(bad, SRC_ER, NOW), null, JSON.stringify(bad));
  assert.equal(normalizeRates({ rates: goodRates() }, "somewhere-else", NOW), null, "an unknown source is refused");
});

test("normalizeRates: the fallback payload (lower-case codes under usd)", () => {
  const low = Object.fromEntries(Object.entries(goodRates()).map(([k, v]) => [k.toLowerCase(), v]));
  const ok = normalizeRates({ date: "2026-10-07", usd: low }, SRC_CDN, NOW);
  assert.deepEqual(ok, { rates: goodRates(), date: "2026-10-07", source: SRC_CDN });
  assert.equal(normalizeRates({ date: "yesterday", usd: low }, SRC_CDN, NOW).date, "2026-10-08", "a date that is not a date: the day of the fetch");
  assert.equal(normalizeRates({ date: "2026-10-07", usd: { ...low, eur: { v: 1 }, gbp: "0.7", xxx: 0 } }, SRC_CDN, NOW).rates.EUR, undefined);
  for (const bad of [{ date: "2026-10-07" }, { usd: [] }, { usd: null }, { usd: { eur: 0.8 } }, { date: "2026-10-07", usd: "no" }]) assert.equal(normalizeRates(bad, SRC_CDN, NOW), null, JSON.stringify(bad));
});

test("readCache / isFresh / isUsable: what storage holds is checked again; a table from the future or a week old is not trusted", () => {
  const raw = { fetchedAt: NOW - 1000, date: "2026-10-08", base: "USD", rates: goodRates(), source: SRC_ER };
  assert.deepEqual(readCache(raw), { rates: goodRates(), date: "2026-10-08", source: SRC_ER, fetchedAt: NOW - 1000 });
  for (const bad of [null, {}, { ...raw, base: "EUR" }, { ...raw, source: "evil" }, { ...raw, fetchedAt: "now" }, { ...raw, date: "x" }, { ...raw, rates: { EUR: 1 } }, "str"]) assert.equal(readCache(bad), null, JSON.stringify(bad));
  const at = (ms) => ({ fetchedAt: NOW - ms });
  assert.ok(isFresh(at(0), NOW) && isFresh(at(FX_FRESH_MS - 1), NOW));
  assert.ok(!isFresh(at(FX_FRESH_MS), NOW) && !isFresh(at(-24 * 3600e3), NOW), "a day old, or from tomorrow (the clock moved)");
  assert.ok(isFresh(at(-60e3), NOW), "a minute of clock slack");
  assert.ok(isUsable(at(FX_STALE_OK_MS - 1), NOW) && !isUsable(at(FX_STALE_OK_MS), NOW) && !isUsable(null, NOW));
});

// ---------- converting ----------
test("toUsd: divides by the units-per-dollar rate; no rate, no number", () => {
  assert.equal(toUsd(20, "EUR", TABLE), 25);
  assert.equal(toUsd(1234567, "VND", TABLE), 1234567 / 25000);
  assert.equal(toUsd(12.5, "USD", TABLE), 12.5);
  assert.equal(toUsd(12.5, "USD", null), 12.5, "dollars need no table");
  assert.equal(toUsd("12.5", "usd", null), 12.5);
  assert.equal(toUsd(20, "eur", TABLE), 25, "lower case");
  assert.equal(toUsd(20, "EUR", null), null);
  assert.equal(toUsd(20, "XYZ", TABLE), null);
  assert.equal(toUsd(20, "toString", TABLE), null, "no prototype keys");
  assert.equal(toUsd(20, "EUR", { rates: { EUR: 0 } }), null);
  for (const bad of [null, undefined, "", NaN, "abc"]) assert.equal(toUsd(bad, "USD", TABLE), null, String(bad));
});

test("usdEquivalent: the USD value of a whole { currency: amount } map, null when any currency has no rate", () => {
  assert.equal(usdEquivalent({ USD: 10, EUR: 8 }, TABLE), 20);
  assert.equal(usdEquivalent({ USD: 10 }, null), 10);
  assert.equal(usdEquivalent({ USD: 10, EUR: 8 }, null), null);
  assert.equal(usdEquivalent({ USD: 10, XYZ: 8 }, TABLE), null);
  assert.equal(usdEquivalent({}, TABLE), 0);
});

// ---------- one line from several currencies ----------
test("totalLine: one currency is exact, with no breakdown and no tooltip", () => {
  const l = totalLine({ EUR: 20 }, TABLE);
  assert.deepEqual([l.main, l.approx, l.breakdown, l.more, l.title, l.note], ["€20.00", false, "", 0, "", ""]);
  assert.equal(totalLine({ USD: 1695.7 }, null).main, "$1,696");
  assert.equal(totalLine({}, TABLE).main, "");
  assert.equal(totalLine(undefined, TABLE).main, "");
  assert.equal(totalLine({ USD: 0, EUR: 5 }, TABLE).main, "€5.00", "a zero adds no currency");
  assert.equal(totalLine({ USD: 0 }, TABLE).main, "");
});

test("totalLine: two currencies → '≈ USD' + the exact breakdown, the date and the attribution", () => {
  const l = totalLine({ USD: 1695.7, EUR: 20 }, TABLE);
  assert.equal(l.main, "≈ $1,721");
  assert.equal(l.approx, true);
  assert.equal(l.breakdown, "$1,696 + €20.00");
  assert.equal(l.more, 0);
  assert.equal(l.full, "$1,696 + €20.00");
  assert.equal(l.note, "rates Oct 8");
  assert.deepEqual([l.date, l.source], ["2026-10-08", SRC_ER]);
  assert.equal(l.attribution, ATTRIBUTION);
  assert.equal(ATTRIBUTION.url, "https://www.exchangerate-api.com");
  assert.ok(l.title.includes("$1,696 + €20.00") && l.title.includes("Oct 8, 2026") && l.title.includes("Rates By Exchange Rate API") && /^\$1,696/.test(l.title), l.title);
  assert.deepEqual(l.parts.map((p) => p.cur), ["USD", "EUR"]);
});

test("totalLine: three currencies (USD, EUR, VND) are ordered by their USD value; the breakdown shows two and counts the rest", () => {
  const l = totalLine({ EUR: 20, USD: 1695.7, VND: 1234567 }, TABLE);
  assert.equal(l.main, "≈ $1,770");                        // 1695.7 + 25 + 49.38
  assert.deepEqual(l.parts.map((p) => p.cur), ["USD", "VND", "EUR"], "49 $ of VND is more than 25 $ of EUR");
  assert.equal(flat(l.breakdown), "$1,696 + VND 1,234,567");
  assert.equal(l.more, 1);
  assert.equal(flat(l.full), "$1,696 + VND 1,234,567 + €20.00");
  assert.ok(flat(l.title).includes("$1,696 + VND 1,234,567 + €20.00"), "the tooltip lists every currency");
});

test("totalLine: five currencies → two shown, '+3'; the sum is every one converted", () => {
  const l = totalLine({ USD: 1000, EUR: 80, GBP: 75, UAH: 4000, PLN: 40 }, TABLE);
  assert.equal(l.main, "≈ $1,310");                         // 1000 + 100 + 100 + 100 + 10
  assert.equal(l.parts.length, 5);
  assert.equal(l.breakdown.split(" + ").length, 2);
  assert.equal(l.more, 3);
  assert.equal(l.full.split(" + ").length, 5);
});

test("totalLine: no rates (null) or a currency without a rate → the exact sum, never a half-converted '≈'", () => {
  const none = totalLine({ USD: 1695.7, EUR: 20 }, null);
  assert.deepEqual([none.main, none.approx, none.breakdown, none.title, none.note, none.date], ["$1,696 + €20.00", false, "", "", "", null]);
  const missing = totalLine({ USD: 100, EUR: 20, XYZ: 5 }, TABLE);
  assert.equal(missing.approx, false);
  assert.equal(flat(missing.main), "$100.00 + €20.00 + XYZ 5.00", "insertion order, every currency, nothing dropped");
  assert.equal(totalLine({ USD: 100, EUR: 20 }, { rates: { USD: 1 }, date: "2026-10-08", source: SRC_ER }).approx, false);
  assert.equal(totalLine({ USD: 100, EUR: 20 }, undefined).approx, false);
});

test("totalLine: the fallback source is credited by date only (no attribution link)", () => {
  const l = totalLine({ USD: 100, EUR: 20 }, { ...TABLE, source: SRC_CDN });
  assert.equal(l.approx, true);
  assert.equal(l.attribution, null);
  assert.ok(!/Exchange Rate API/i.test(l.title), l.title);
  assert.ok(l.title.includes("Oct 8, 2026"));
});

test("totalLine in Russian: the date is '08.10', the line is '≈ 1 770 $'", async () => {
  await setLang("ru");
  try {
    const l = totalLine({ USD: 1695.7, EUR: 20, VND: 1234567 }, TABLE);
    assert.equal(flat(l.main), "≈ 1 770 $");
    assert.equal(l.note, "курс 08.10");
    assert.equal(flat(l.breakdown), "1 696 $ + 1 234 567 VND");
    assert.ok(l.title.includes("Примерно") && l.title.includes("Rates By Exchange Rate API"), l.title);
  } finally { await setLang("en"); }
});

test("rowAmount.text: the row's one line; three or more currencies without rates: the two biggest and '+N'; a total (totalLine) keeps every currency", () => {
  const t3 = { USD: 5, EUR: 20, VND: 1000 };
  const noRates = rowAmount(t3, null);
  assert.equal(flat(noRates.text), "$5.00 + €20.00 +1", "in the order of the amounts as they came (no rates to rank them)");
  assert.equal(flat(noRates.full), "$5.00 + €20.00 + VND 1,000");
  assert.equal(flat(noRates.main), flat(noRates.full), "main stays the whole");
  assert.equal(rowAmount({ USD: 5 }, null).text, "$5.00");
  assert.equal(flat(rowAmount({ USD: 5, EUR: 2 }, null).text), "$5.00 + €2.00");
  const withRates = rowAmount({ USD: 1695.7, EUR: 20, VND: 1234567 }, TABLE);
  assert.equal(withRates.text, withRates.main, "with rates the line is the '≈' one");
  assert.equal(rowAmount({}, TABLE).text, "");
  assert.equal(flat(totalLine(t3, null).text), flat(totalLine(t3, null).full), "the grand total is never cut");
});

test("rowAmount: one or two currencies are exact, three or more are '≈ USD'", () => {
  const one = rowAmount({ EUR: 20 }, TABLE);
  assert.deepEqual([one.main, one.approx], ["€20.00", false]);
  const two = rowAmount({ USD: 55.2, EUR: 20 }, TABLE);
  assert.deepEqual([two.main, two.approx, two.breakdown, two.title], ["$55.20 + €20.00", false, "", ""]);
  assert.equal(rowAmount({ USD: 55.2, EUR: 20 }, null).main, "$55.20 + €20.00", "two currencies need no rates at all");
  const three = rowAmount({ USD: 1695.7, EUR: 20, VND: 1234567 }, TABLE);
  assert.equal(three.main, "≈ $1,770");
  assert.equal(three.approx, true);
  assert.equal(flat(three.full), "$1,696 + VND 1,234,567 + €20.00");
  assert.ok(three.title.includes("Rates By Exchange Rate API"));
  const noRates = rowAmount({ USD: 5, EUR: 20, VND: 1000 }, null);
  assert.deepEqual([noRates.approx, flat(noRates.main)], [false, "$5.00 + €20.00 + VND 1,000"]);
});

// ---------- rates(): cache, fallback, backoff, lock ----------
let instance = 0;
// A fake world: chrome.storage.local, fetch (every call recorded), Web Locks (one holder at a time). Several `popup()`s share it, like
// several popup windows of one extension share storage and locks.
function world({ store = {}, answer } = {}) {
  const w = { store, calls: [], lockRuns: 0, answer, failStorage: false, failSet: false };
  let chain = Promise.resolve();
  globalThis.chrome = { storage: { local: {
    get: async (keys) => { if (w.failStorage) throw new Error("storage is gone"); const ks = typeof keys === "string" ? [keys] : keys; return Object.fromEntries(ks.filter((k) => k in w.store).map((k) => [k, structuredClone(w.store[k])])); },
    set: async (patch) => { if (w.failSet) throw new Error("quota"); Object.assign(w.store, structuredClone(patch)); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete w.store[k]; },
  } } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { locks: { request: (name, fn) => {
    assert.equal(name, "fbh-fx");
    const run = chain.then(() => { w.lockRuns++; return fn(); });
    chain = run.then(() => {}, () => {});
    return run;
  } } } });
  globalThis.fetch = async (url, init = {}) => {
    w.calls.push({ url: String(url), init });
    const out = await w.answer(String(url), w.calls.length);
    if (out === "throw") throw new TypeError("Failed to fetch");
    return { ok: (out.status || 200) < 400, status: out.status || 200, headers: { get: (h) => (out.headers || {})[h.toLowerCase()] ?? null },
      text: async () => (typeof out.body === "string" ? out.body : JSON.stringify(out.body)) };
  };
  w.popup = () => import(`../fb-helper/js/money.js?popup=${++instance}`);   // a new module instance = a newly opened popup (its own memory)
  return w;
}
const ER = "https://open.er-api.com/v6/latest/USD";
const CDN = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";
const erBody = (rates = goodRates(), at = Date.now()) => ({ result: "success", base_code: "USD", time_last_update_unix: Math.floor(at / 1000), rates });
const cdnBody = (rates = goodRates(), at = Date.now()) => ({ date: new Date(at).toISOString().slice(0, 10), usd: Object.fromEntries(Object.entries(rates).map(([k, v]) => [k.toLowerCase(), v])) });
const answerOk = (url) => ({ body: url === ER ? erBody() : cdnBody() });
const saved = (over = {}) => ({ fetchedAt: Date.now() - 3600e3, date: "2026-10-07", base: "USD", rates: { ...goodRates(), EUR: 0.9 }, source: SRC_ER, ...over });

test("rates(): an empty cache asks the primary source once, stores the table, and answers the next call from memory", async () => {
  const w = world({ answer: answerOk });
  const m = await w.popup();
  assert.equal(m.cachedRates(), null, "nothing before the first call");
  const r = await m.rates();
  assert.deepEqual(w.calls.map((c) => c.url), [ER], "one request to the primary only");
  assert.equal(r.source, SRC_ER); assert.equal(r.rates.EUR, 0.8); assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(r).sort(), ["date", "rates", "source"]);
  const st = w.store.fx;
  assert.deepEqual([st.base, st.source, st.date, typeof st.fetchedAt, st.rates.VND], ["USD", SRC_ER, r.date, "number", 25000]);
  assert.ok(!("fxFail" in w.store));
  assert.equal(w.calls[0].init.credentials, "omit"); assert.equal(w.calls[0].init.referrerPolicy, "no-referrer"); assert.equal(w.calls[0].init.cache, "no-store");
  assert.ok(w.calls[0].init.signal instanceof AbortSignal, "a timeout guards the request");
  await m.rates(); await m.rates();
  assert.equal(w.calls.length, 1, "fresh: no more requests, not even storage reads matter");
  assert.deepEqual(m.cachedRates(), r);
});

test("rates(): a second popup within 24 h reads the saved table and sends nothing", async () => {
  const w = world({ answer: answerOk });
  await (await w.popup()).rates();
  assert.equal(w.calls.length, 1);
  const b = await w.popup();
  assert.equal(b.cachedRates(), null, "a new popup starts empty…");
  assert.deepEqual(Object.keys(await b.loadCachedRates()).sort(), ["date", "rates", "source"], "…reads storage without any request…");
  assert.ok(b.cachedRates());
  const c = await w.popup();
  const r = await c.rates();
  assert.equal(r.source, SRC_ER);
  assert.equal(w.calls.length, 1, "…and rates() finds the table fresh");
});

test("rates(): a table older than 24 h is asked for again; one younger is not", async () => {
  const w = world({ store: { fx: saved({ fetchedAt: Date.now() - FX_FRESH_MS + 60e3 }) }, answer: answerOk });
  assert.equal((await (await w.popup()).rates()).rates.EUR, 0.9, "23 h 59 min: the saved table");
  assert.equal(w.calls.length, 0);
  w.store.fx = saved({ fetchedAt: Date.now() - FX_FRESH_MS - 60e3 });
  const r = await (await w.popup()).rates();
  assert.equal(w.calls.length, 1, "24 h 1 min: asked again");
  assert.equal(r.rates.EUR, 0.8);
  assert.equal(w.store.fx.rates.EUR, 0.8, "and saved");
});

test("rates(): the primary fails (HTTP error, network error, bad payload, oversize, not JSON) → the fallback source is used", async () => {
  const bads = [
    { status: 500, body: {} }, "throw", { body: { result: "error", "error-type": "quota-reached" } },
    { body: erBody({ ...goodRates(), EUR: -3, GBP: "x", VND: 0, UAH: null, RUB: NaN }) },   // nothing believable left
    { body: erBody(), headers: { "content-length": "5000000" } }, { body: "<html>maintenance</html>" },
  ];
  for (const bad of bads) {
    const w = world({ answer: (url) => (url === ER ? bad : { body: cdnBody() }) });
    const r = await (await w.popup()).rates();
    assert.deepEqual(w.calls.map((c) => c.url), [ER, CDN], JSON.stringify(bad));
    assert.equal(r?.source, SRC_CDN, JSON.stringify(bad));
    assert.equal(r.rates.EUR, 0.8);
    assert.equal(w.store.fx.source, SRC_CDN);
  }
});

test("rates(): both sources fail → null, no throw, a failure mark; nothing more is sent for 20 minutes, then it tries again", async () => {
  const w = world({ answer: () => ({ status: 503, body: {} }) });
  const a = await w.popup();
  assert.equal(await a.rates(), null);
  assert.deepEqual(w.calls.map((c) => c.url), [ER, CDN]);
  assert.ok(Math.abs(w.store.fxFail.at - Date.now()) < 5000 && !("fx" in w.store));
  assert.equal(await a.rates(), null);
  assert.equal(await (await w.popup()).rates(), null);          // another popup: reads the mark from storage
  assert.equal(w.calls.length, 2, "backoff: no new request, same popup or another");
  w.store.fxFail = { at: Date.now() - FX_FAIL_BACKOFF_MS - 1000 };
  assert.equal(await (await w.popup()).rates(), null);
  assert.equal(w.calls.length, 4, "the mark is 20 min old: both sources tried again");
  // a mark from the future (the clock moved back) is not a reason to stay silent for good
  w.store.fxFail = { at: Date.now() + 3 * 24 * 3600e3 };
  await (await w.popup()).rates();
  assert.equal(w.calls.length, 6);
});

test("FX_FAIL_BACKOFF_MS is 20 minutes", () => assert.equal(FX_FAIL_BACKOFF_MS, 20 * 60e3));

// ---------- a new table must roughly agree with the one we hold ----------
const T = { USD: 1, EUR: 0.86, GBP: 0.75, JPY: 150, VND: 25000, UAH: 40, RUB: 90, PLN: 4 };
test("plausibleRates: small moves pass; a table where more than a quarter of the shared codes moved by over 50 % does not (inverted, other unit)", () => {
  assert.equal(plausibleRates({ ...T, EUR: 0.88, JPY: 152 }, T), true, "an ordinary day");
  assert.equal(plausibleRates(T, T), true);
  const inverted = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, 1 / v]));
  assert.equal(plausibleRates(inverted, T), false, "1/x: JPY and VND and UAH and RUB and PLN are far off");
  assert.equal(plausibleRates(Object.fromEntries(Object.entries(T).map(([k, v]) => [k, k === "USD" ? 1 : v * 100])), T), false, "another unit");
  assert.equal(plausibleRates({ ...T, UAH: 400 }, T), true, "one real devaluation (1 of 7 shared codes) is believed");
  assert.equal(plausibleRates({ ...T, UAH: 400, RUB: 900 }, T), false, "two of seven is more than a quarter");
  assert.equal(plausibleRates({ ...T, UAH: 60, RUB: 135 }, T), true, "exactly +50 % is not over 50 %");
  assert.equal(plausibleRates({ ...T, UAH: 60.1, RUB: 135.5 }, T), false, "just over 50 % on two");
});
test("plausibleRates: nothing to compare (too few shared codes, nothing held) passes; USD is not compared", () => {
  assert.equal(plausibleRates({ USD: 1, EUR: 5, GBP: 5, JPY: 5, VND: 5 }, { USD: 1, EUR: 0.8, GBP: 0.7, JPY: 150, VND: 25000 }), true, "only four shared codes: no verdict");
  assert.equal(plausibleRates(T, null), true);
  assert.equal(plausibleRates(null, T), true);
  assert.equal(plausibleRates({ XXX: 1, YYY: 2, ZZZ: 3, AAA: 4, BBB: 5, USD: 1 }, T), true, "no shared code");
});

test("rates(): a table that disagrees wildly with the held one is not taken (the held one stays, the next source is tried, then the failure mark)", async () => {
  const wild = Object.fromEntries(Object.entries(goodRates()).map(([k, v]) => [k, k === "USD" ? 1 : v * 7]));
  const w = world({ store: { fx: saved({ fetchedAt: Date.now() - FX_FRESH_MS - 3600e3 }) }, answer: () => ({ body: erBody(wild) }) });
  w.answer = (url) => ({ body: url === ER ? erBody(wild) : cdnBody(wild) });
  const r = await (await w.popup()).rates();
  assert.deepEqual(w.calls.map((c) => c.url), [ER, CDN], "both were asked, neither was believed");
  assert.equal(r.rates.EUR, 0.9, "the held table (stale but under a week old) is what answers");
  assert.equal(w.store.fx.rates.EUR, 0.9, "and it was not overwritten");
  assert.ok(w.store.fxFail?.at, "a rejection counts as a failed attempt: 20 minutes of silence");
  const again = await (await w.popup()).rates();
  assert.equal(w.calls.length, 2); assert.equal(again.rates.EUR, 0.9);
  // the first source is wild, the second agrees with the held table: the second is taken
  const w2 = world({ store: { fx: saved({ fetchedAt: Date.now() - FX_FRESH_MS - 3600e3 }) }, answer: (url) => ({ body: url === ER ? erBody(wild) : cdnBody({ ...goodRates(), EUR: 0.91 }) }) });
  const r2 = await (await w2.popup()).rates();
  assert.equal(r2.source, SRC_CDN); assert.equal(r2.rates.EUR, 0.91);
  // nothing held (or held too long ago to be used): the first table seen is taken, there is nothing to compare it with
  const w3 = world({ answer: () => ({ body: erBody(wild) }) });
  assert.equal((await (await w3.popup()).rates()).rates.EUR, 0.8 * 7);
  const w4 = world({ store: { fx: saved({ fetchedAt: Date.now() - FX_STALE_OK_MS - 3600e3 }) }, answer: () => ({ body: erBody(wild) }) });
  assert.equal((await (await w4.popup()).rates()).rates.EUR, 0.8 * 7, "a table older than a week is no yardstick");
});

test("rates(): a success clears the failure mark", async () => {
  const w = world({ store: { fxFail: { at: Date.now() - FX_FAIL_BACKOFF_MS - 1000 } }, answer: answerOk });
  assert.ok((await (await w.popup()).rates()));
  assert.ok(!("fxFail" in w.store));
});

test("rates(): when the refresh fails an older table (up to a week) is still answered, an older one is not", async () => {
  const w = world({ store: { fx: saved({ fetchedAt: Date.now() - 3 * 24 * 3600e3, date: "2026-10-05" }) }, answer: () => ({ status: 500, body: {} }) });
  const r = await (await w.popup()).rates();
  assert.equal(w.calls.length, 2, "it did try");
  assert.deepEqual([r.date, r.rates.EUR], ["2026-10-05", 0.9], "the 3-day-old table, with its own date");
  w.store.fx = saved({ fetchedAt: Date.now() - FX_STALE_OK_MS - 3600e3 });
  delete w.store.fxFail;
  assert.equal(await (await w.popup()).rates(), null, "8 days old: not used");
});

test("rates(): a table dated in the future is not trusted (the clock moved)", async () => {
  const w = world({ store: { fx: saved({ fetchedAt: Date.now() + 24 * 3600e3 }) }, answer: answerOk });
  const r = await (await w.popup()).rates();
  assert.equal(w.calls.length, 1);
  assert.equal(r.rates.EUR, 0.8);
});

test("rates(): two popups at once ask once (Web Lock), and calls inside one popup share one lookup", async () => {
  const w = world({ answer: async (url) => { await new Promise((r) => setTimeout(r, 30)); return answerOk(url); } });
  const [a, b] = [await w.popup(), await w.popup()];
  const all = await Promise.all([a.rates(), b.rates(), a.rates(), b.rates()]);
  assert.equal(w.calls.length, 1, "one request for four callers");
  assert.ok(all.every((r) => r?.rates.EUR === 0.8));
  assert.ok(w.lockRuns >= 1 && w.lockRuns <= 2, `lock runs: ${w.lockRuns}`);
});

test("rates(): never throws — storage that fails, a fetch that throws, junk in the cache, no Web Locks", async () => {
  let w = world({ answer: answerOk });
  w.failStorage = true;
  assert.ok(await (await w.popup()).rates(), "storage unreadable: still fetches and answers from memory");
  w = world({ answer: () => "throw" });
  assert.equal(await (await w.popup()).rates(), null);
  w = world({ store: { fx: "junk", fxFail: [1, 2] }, answer: answerOk });
  assert.ok(await (await w.popup()).rates(), "junk in the cache is ignored");
  w = world({ answer: answerOk });
  w.failSet = true;
  assert.ok(await (await w.popup()).rates(), "storage refuses the write: the table still serves from memory");
  w = world({ answer: answerOk });
  Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: {} });
  assert.ok(await (await w.popup()).rates(), "no navigator.locks: runs without the lock");
  delete globalThis.chrome;
  w = world({ answer: answerOk }); delete globalThis.chrome;
  assert.ok(await (await w.popup()).rates(), "no chrome at all: network and memory only");
  assert.equal(await (await world({ answer: answerOk }).popup()).loadCachedRates(), null);
});

test("money.js exports the whole surface the tabs use", async () => {
  const m = await world({ answer: answerOk }).popup();
  for (const name of ["fmtMoney", "rates", "toUsd", "usdEquivalent", "totalLine", "rowAmount", "cachedRates", "loadCachedRates", "ATTRIBUTION"]) assert.ok(name in m, name);
  assert.equal(typeof m.rates, "function"); assert.equal(typeof m.totalLine, "function");
});

// ---------- the network surface is declared ----------
test("network: the only code that sends a request is graph.js and money.js, and every URL money.js uses is pinned in the manifest CSP (https, no wildcard, with its path)", async () => {
  const fs = await import("node:fs");
  const dir = new URL("../fb-helper/", import.meta.url);
  const csp = JSON.parse(fs.readFileSync(new URL("manifest.json", dir), "utf8")).content_security_policy.extension_pages;
  const sources = csp.match(/connect-src\s+([^;]+)/)[1].trim().split(/\s+/);
  assert.equal(sources.length, 3, sources.join(" "));
  assert.ok(/^https:\/\/[a-z0-9.-]+$/.test(sources[0]) && sources[0].startsWith("https://graph."), "the Graph origin stays first (test/harness.mjs derives its mock from the first one)");
  const urls = sources.slice(1);
  assert.deepEqual(urls.sort(), ["https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json", "https://open.er-api.com/v6/latest/USD"]);
  assert.ok(urls.every((u) => /^https:\/\/[a-z0-9.-]+\/[\w@./-]+$/.test(u)), "each one is pinned to its path");
  const money = fs.readFileSync(new URL("js/money.js", dir), "utf8");
  const used = new Set([...money.matchAll(/url: "(https:\/\/[^"]+)"/g)].map((m) => m[1]));
  for (const o of used) assert.ok(urls.includes(o), `${o} is used by money.js but not allowed by the CSP`);
  assert.equal(used.size, 2);
  const senders = fs.readdirSync(new URL("js/", dir), { recursive: true }).filter((f) => f.endsWith(".js"))
    .filter((f) => /\b(fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource)/.test(fs.readFileSync(new URL(`js/${f}`, dir), "utf8"))).sort();
  assert.deepEqual(senders, ["graph.js", "money.js"]);
});
