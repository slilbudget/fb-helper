// Money: the total line of the Ad accounts and Businesses tabs when it adds up several currencies. Rates come from mocks of both
// origins (never the network): "≈ $…" + the muted breakdown + the tooltip with the date and the attribution; the fallback source;
// both sources down (the per-currency sum, no "≈", no console error, no retry for 20 minutes); the 24 h cache across popups;
// one currency (no request at all); Russian. Graph is a mock (fictional data).
import { TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, adsFb, ratesOk, fxEr, fxCdn, FX, ROW, done, agoRe, esc, ratesIdle, tr, trx, useLang, waitFor } from "../harness.mjs";

const day = new Date().toISOString().slice(0, 10);
const ins = (spend) => ({ data: [{ spend: String(spend), impressions: "100", inline_link_clicks: "10", date_start: day, date_stop: day }] });
const acc = (account_id, name, currency, today, biz) => ({ account_id, name, account_status: 1, currency, timezone_name: "UTC", amount_spent: "0",
  p_today: ins(today), p_yesterday: ins(0), p_week: ins(0), p_month: ins(0), ...(biz ? { business: { id: biz[0], name: biz[1] } } : {}) });
const ALPHA = ["1001", "Alpha Media"], BETA = ["1002", "Beta Ads"];
// USD 1,695.70 + EUR 20 + VND 1,234,567; at FX (EUR 0.8, VND 25 000 per dollar) that is 1,695.70 + 25 + 49.38 = $1,770.08
const THREE = { data: [acc("11", "Alpha US", "USD", 1695.7, ALPHA), acc("12", "Alpha EU", "EUR", 20, ALPHA), acc("13", "Beta VN", "VND", 1234567, BETA)] };
const ONE = { data: [acc("11", "Alpha US", "USD", 1695.7, ALPHA), acc("14", "Alpha US 2", "USD", 4.3, ALPHA)] };
const BMS = { data: [{ id: ALPHA[0], name: ALPHA[1] }, { id: BETA[0], name: BETA[1] }] };
const graphFor = (accounts) => (u) => ({ body: u.pathname.endsWith("/me/adaccounts") ? accounts : u.pathname.endsWith("/me/businesses") ? BMS : { data: [] } });
const ER = "https://open.er-api.com/v6/latest/USD";
const CDN = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";

const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const shortEn = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const longEn = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const totalOf = (p, box) => p.evaluate((sel) => {
  const b = document.querySelector(sel), a = b.querySelector(".total-sub a");
  return { label: [...(b.querySelector(".total-label")?.childNodes ?? [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() || null, meta: b.querySelector(".total-meta")?.textContent.trim() ?? null,
    value: b.querySelector(".total-value")?.textContent.replace(/\s+/g, " ").trim() ?? null, valueTitle: b.querySelector(".total-value")?.title ?? null,
    sub: b.querySelector(".total-sub")?.textContent.replace(/\s+/g, " ").trim() ?? null, subTitle: b.querySelector(".total-sub")?.title ?? null,
    link: a && { text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel } };
}, box);
const approx = (p, box = "#accountsTotal") => until(p, (sel) => /^≈/.test(document.querySelector(`${sel} .total-value`)?.textContent.trim() ?? ""), box);
const plain = (p, box = "#accountsTotal") => until(p, (sel) => /\$1,695\.70/.test(document.querySelector(`${sel} .total-value`)?.textContent ?? "") && !/≈/.test(document.querySelector(`${sel} .total-value`).textContent), box);
// Waits (up to 5 s) until the mock has seen n requests.
const hitsReach = async (b, p, n) => { await waitFor(() => b.rateHits.length >= n, 5000); return b.rateHits.length === n; };
const open3 = async (b) => { await adsPage(b); const pop = await popup(b, "accounts"); ok("three accounts load", await rowsAre(pop, ROW,3)); return pop; };

// ---------- rates answered by the primary source ----------
async function ratesFlows() {
  console.log("\n# money: rates from the primary source");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(THREE), rates: ratesOk });
  const pop = await open3(b);
  ok("the total becomes '≈ $1,770' (USD + EUR + VND converted at the daily rate)", await approx(pop), JSON.stringify(await totalOf(pop, "#accountsTotal")));
  const t = await totalOf(pop, "#accountsTotal");
  ok("…label 'Spend · <date>' (no period word), no count while nothing is filtered", new RegExp(`^${esc(tr("acc.spend"))} · ${shortEn}$`).test(t.label) && t.meta === null, JSON.stringify(t));
  ok("…value '≈ $1,770' (no decimals from 1 000 up)", t.value === "≈ $1,770", t.value);
  ok("…muted line: two biggest currencies (one string, one fraction rule: cents everywhere; a million of VND is short), '+1 more', the date of the rates and the credit", t.sub === `$1,695.70 + VND 1.2M ${tr("money.more", { n: 1 })} · ${tr("money.rates", { d: shortEn })} · ExchangeRate-API`, t.sub);
  ok("…the credit is a link to the provider (new tab, noopener noreferrer)", t.link?.text === "ExchangeRate-API" && t.link.href === "https://www.exchangerate-api.com/" && t.link.target === "_blank" && has(t.link.rel, "noopener") && has(t.link.rel, "noreferrer"), JSON.stringify(t.link));
  ok("…tooltip: every currency, 'Approximate', the date, 'Rates By Exchange Rate API'", has(flat(t.valueTitle), "$1,695.70 + VND 1,234,567 + €20.00") && has(t.valueTitle, tr("money.approx", { d: longEn })) && has(t.valueTitle, longEn) && has(t.valueTitle, "Rates By Exchange Rate API") && t.valueTitle === t.subTitle, t.valueTitle);
  ok("…the refresh button says how old the list is (not the screen)", new RegExp(`^${esc(tr("refresh"))} · ${trx("acc.updated", { t: agoRe() }).source}$`).test(await pop.locator("#loadAccounts").getAttribute("title")), await pop.locator("#loadAccounts").getAttribute("title"));
  ok("…exactly one request to the primary source, none to the fallback", b.rateHits.length === 1 && b.rateHits[0] === ER, b.rateHits.join());
  const fx = await pop.evaluate(() => chrome.storage.local.get(["fx", "fxFail"]));
  ok("…the table is kept in chrome.storage.local (USD base, source, date, numbers) and there is no failure mark", fx.fx?.base === "USD" && fx.fx.source === "exchangerate-api" && fx.fx.date === day && fx.fx.rates.VND === FX.VND && typeof fx.fx.fetchedAt === "number" && !fx.fxFail, JSON.stringify(fx).slice(0, 200));
  ok("…the rows keep their own exact amounts (no '≈' on a row)", (await pop.$$eval(`${ROW} .lrow-value`, (n) => n.map((x) => x.textContent.replace(/\s+/g, " ").trim()))).every((x) => !x.includes("≈")), "rows");

  // the Businesses tab adds the same three currencies: same rates, no second request
  await pop.click('[data-tab="bms"]');
  ok("the Businesses total is '≈ $1,770' too, with the same muted line", await approx(pop, "#bmsTotal"), JSON.stringify(await totalOf(pop, "#bmsTotal")));
  const bt = await totalOf(pop, "#bmsTotal");
  ok("…label 'Spend · <date>', same breakdown", new RegExp(`^${esc(tr("acc.spend"))} · ${shortEn}$`).test(bt.label) && bt.sub === t.sub, JSON.stringify(bt));
  ok("…still one request in all", b.rateHits.length === 1, b.rateHits.join());
  ok("…the Businesses refresh button carries the age of the business list too (once it is loaded)", await until(pop, (s) => document.querySelector("#loadBms").title.startsWith(s), `${tr("bms.refresh")} · ${tr("acc.updated", { t: "" })}`), await pop.locator("#loadBms").getAttribute("title"));

  // a search: the count appears (only when filtered) and the total follows the rows
  await pop.click('[data-tab="accounts"]');
  await pop.fill("#accountFilter", "Alpha");
  ok("a search shows the count on the right ('2 of 3 found') and the sum of those rows ('≈ $1,721')", await until(pop, (found) => (document.querySelector("#accountsTotal .total-meta")?.textContent ?? "").includes(found) && /^≈ \$1,721$/.test(document.querySelector("#accountsTotal .total-value").textContent.trim()), tr("acc.found", { n: 2, all: 3 })), JSON.stringify(await totalOf(pop, "#accountsTotal")));
  ok("…two currencies → the muted line lists both, no '+N'", (await totalOf(pop, "#accountsTotal")).sub === `$1,695.70 + €20.00 · ${tr("money.rates", { d: shortEn })} · ExchangeRate-API`, (await totalOf(pop, "#accountsTotal")).sub);
  await pop.fill("#accountFilter", "Beta");
  ok("one currency (VND only) → 'VND 1.2M' (a million of an ISO-code currency is short), no '≈', no muted line; the exact amount is its tooltip", await until(pop, () => /^VND\s?1\.2M$/.test(document.querySelector("#accountsTotal .total-value").textContent.trim().replace(/\s/g, " ")) && !document.querySelector("#accountsTotal .total-sub"))
    && flat((await totalOf(pop, "#accountsTotal")).valueTitle) === "VND 1,234,567", JSON.stringify(await totalOf(pop, "#accountsTotal")));
  await pop.fill("#accountFilter", "");

  // second popup: the saved table is used, nothing is asked
  const pop2 = await popup(b, "accounts");
  ok("a second popup within 24 h shows '≈ $1,770' again and sends nothing", (await rowsAre(pop2, ROW,3)) && (await approx(pop2)) && b.rateHits.length === 1, b.rateHits.join());
  // a table older than 24 h is asked for again
  await pop2.evaluate(() => chrome.storage.local.get("fx").then(({ fx }) => chrome.storage.local.set({ fx: { ...fx, fetchedAt: Date.now() - 25 * 3600e3 } })));
  const pop3 = await popup(b, "accounts");
  ok("a table 25 h old is asked for again (one more request), the total stays '≈ $1,770'", (await hitsReach(b, pop3, 2)) && (await approx(pop3)), b.rateHits.join());
  const age = await pop3.evaluate(() => chrome.storage.local.get("fx").then(({ fx }) => Date.now() - fx.fetchedAt));
  ok("…and the saved table is new again", age < 60e3, String(age));
  await done(b);
}

// ---------- the table arrives late ----------
async function lateFlow() {
  console.log("\n# money: the total never waits for the rates");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(THREE), rates: (u) => ({ ...ratesOk(u), delay: 900 }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("rows", await rowsAre(pop, ROW,3));
  ok("the total is drawn at once as the per-currency sum…", await plain(pop), await text(pop, "#accountsTotal .total-value"));
  ok("…without the muted line", (await totalOf(pop, "#accountsTotal")).sub === null);
  ok("…and turns into '≈ $1,770' when the rates are there", await approx(pop), await text(pop, "#accountsTotal .total-value"));
  await done(b);
}

// ---------- the primary fails: the fallback source ----------
async function fallbackFlows() {
  console.log("\n# money: primary source down → fallback source");
  for (const [name, primary] of [["HTTP 500", { status: 500, body: { result: "error" } }], ["network error", { abort: true }],
    ["a table with no usable numbers", { body: fxEr({ EUR: -1, VND: 0, GBP: "x", UAH: null, RUB: 0 }) }]]) {
    const b = await boot({ fb: adsFb(TOK), graph: graphFor(THREE), rates: (u) => (u.hostname === "open.er-api.com" ? primary : { body: fxCdn() }) });
    const pop = await open3(b);
    ok(`${name}: the total is '≈ $1,770' from the fallback`, await approx(pop), await text(pop, "#accountsTotal .total-value"));
    const t = await totalOf(pop, "#accountsTotal");
    ok(`${name}: the primary was tried first, then the fallback, once each`, b.rateHits.join() === [ER, CDN].join(), b.rateHits.join());
    ok(`${name}: the line names the date but not ExchangeRate-API, the tooltip has no attribution`, t.sub === `$1,695.70 + VND 1.2M ${tr("money.more", { n: 1 })} · ${tr("money.rates", { d: shortEn })}` && t.link === null && !has(t.valueTitle, "Exchange Rate API") && has(t.valueTitle, longEn), JSON.stringify(t));
    ok(`${name}: the saved table says where it came from`, (await pop.evaluate(() => chrome.storage.local.get("fx"))).fx?.source === "currency-api");
    await done(b);
  }
}

// ---------- both sources down ----------
async function downFlows() {
  console.log("\n# money: both sources down");
  for (const [name, answer] of [["HTTP 503", () => ({ status: 503, body: {} })], ["offline", () => ({ abort: true })], ["not JSON", () => ({ body: "<html>maintenance</html>" })]]) {
    const b = await boot({ fb: adsFb(TOK), graph: graphFor(THREE), rates: answer });
    const pop = await open3(b);
    ok(`${name}: both sources were tried`, (await hitsReach(b, pop, 2)) && b.rateHits.join() === [ER, CDN].join(), b.rateHits.join());
    await until(pop, () => chrome.storage.local.get("fxFail").then((o) => typeof o.fxFail?.at === "number"));       // the failure was noted: the total has been drawn without rates
    const t = await totalOf(pop, "#accountsTotal");
    ok(`${name}: the total stays the per-currency sum (every currency, exact), no '≈', no muted line`, !t.value.includes("≈") && has(t.value, "$1,695.70") && has(t.value, "€20.00") && has(t.value, "VND 1.2M") && t.value.split(" + ").length === 3 && t.sub === null && flat(t.valueTitle) === "$1,695.70 + €20.00 + VND 1,234,567", JSON.stringify(t));
    const st = await pop.evaluate(() => chrome.storage.local.get(["fx", "fxFail"]));
    ok(`${name}: a failure mark is saved (no table)`, !st.fx && typeof st.fxFail?.at === "number", JSON.stringify(st));
    // another popup within 20 minutes: nothing is sent again
    const pop2 = await popup(b, "accounts");
    ok(`${name}: a popup opened right after sends nothing (20-minute pause)`, (await rowsAre(pop2, ROW,3)) && (await ratesIdle(pop2), b.rateHits.length === 2), b.rateHits.join());
    ok(`${name}: …and the total is still the plain sum`, !(await text(pop2, "#accountsTotal .total-value")).includes("≈"));
    // twenty minutes later it tries again (a mark 11 minutes old is still inside the pause)
    await pop2.evaluate(() => chrome.storage.local.set({ fxFail: { at: Date.now() - 11 * 60e3 } }));
    const pop2b = await popup(b, "accounts");
    ok(`${name}: a mark 11 minutes old still holds: nothing is sent`, (await rowsAre(pop2b, ROW,3)) && (await ratesIdle(pop2b), b.rateHits.length === 2), b.rateHits.join());
    await pop2b.evaluate(() => chrome.storage.local.set({ fxFail: { at: Date.now() - 21 * 60e3 } }));
    const pop3 = await popup(b, "accounts");
    ok(`${name}: with a mark older than 20 minutes both sources are tried again`, (await rowsAre(pop3, ROW,3)) && (await hitsReach(b, pop3, 4)), b.rateHits.join());
    await done(b);
  }
}

// ---------- one currency: no request at all ----------
async function oneCurrencyFlow() {
  console.log("\n# money: one currency");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(ONE), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("two USD accounts", await rowsAre(pop, ROW,2));
  await ratesIdle(pop);                                    // any lookup the page started has finished
  const t = await totalOf(pop, "#accountsTotal");
  ok("the total is the exact sum '$1,700' (1 695.70 + 4.30), no '≈', no muted line, no tooltip", t.value === "$1,700" && t.sub === null && !t.valueTitle, JSON.stringify(t));
  ok("no request to any rates source, nothing saved", b.rateHits.length === 0 && !(await pop.evaluate(() => chrome.storage.local.get(["fx", "fxFail"]).then((o) => o.fx || o.fxFail))), b.rateHits.join());
  await done(b);
}

// ---------- Russian ----------
async function russianFlow() {
  console.log("\n# money: Russian");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(THREE), rates: ratesOk });
  const pop = await open3(b);
  ok("en: ≈", await approx(pop));
  await useLang(pop, "ru");
  const ru = `${day.slice(8, 10)}.${day.slice(5, 7)}`;
  ok("ru: '≈ 1 770 $', muted line 'курс <dd.mm>' with the credit, tooltip in Russian", await until(pop, ([rates, approx]) => /^≈ 1\s770\s\$$/.test(document.querySelector("#accountsTotal .total-value").textContent.trim()) && (document.querySelector("#accountsTotal .total-sub")?.textContent ?? "").includes(rates) && new RegExp(approx).test(document.querySelector("#accountsTotal .total-value").title), [tr("money.rates", { d: ru }), trx("money.approx").source]), JSON.stringify(await totalOf(pop, "#accountsTotal")));
  const t = await totalOf(pop, "#accountsTotal");
  ok("ru: label 'Спенд · <dd.mm>'", new RegExp(`^${esc(tr("acc.spend"))} · ${ru}$`).test(t.label), t.label);
  ok("ru: the muted line", flat(t.sub) === `1 695,70 $ + 1,2 млн VND ${tr("money.more", { n: 1 })} · ${tr("money.rates", { d: ru })} · ExchangeRate-API`, t.sub);
  ok("ru: the refresh button tooltip", (await pop.locator("#loadAccounts").getAttribute("title")).startsWith(`${tr("refresh")} · ${tr("acc.updated", { t: "" })}`), await pop.locator("#loadAccounts").getAttribute("title"));
  await useLang(pop, "en");
  ok("back to en", await approx(pop) && (await text(pop, "#accountsTotal .total-value")) === "≈ $1,770");
  await done(b);
}

// ---------- rates are asked for only while the total is on screen ----------
async function hiddenFlow() {
  console.log("\n# money: no rate request from a hidden tab");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(THREE), rates: ratesOk });
  await adsPage(b);
  let pop = await popup(b, "accounts");
  ok("three accounts load, the total turns into '≈' (one rate request)", (await rowsAre(pop, ROW,3)) && (await approx(pop)) && b.rateHits.length === 1, b.rateHits.join());
  // a popup that opens on the Token tab with the list in the cache and no table: drawing the hidden lists must not ask for rates
  await pop.evaluate(() => { localStorage.setItem("tab", "token"); return chrome.storage.local.remove(["fx", "fxFail"]); });
  await pop.close();
  pop = await popup(b);
  await rowsAre(pop, ROW, 3); await ratesIdle(pop);        // the cached lists are drawn (hidden) and no lookup is under way
  ok("opened on the Token tab: the cached lists are drawn, nothing is requested", b.rateHits.length === 1 && (await pop.locator("#tab-token.active").count()) === 1, `${b.rateHits.length}`);
  await pop.click('[data-tab="bms"]');
  ok("showing the Businesses tab asks once (its total is on screen now)", await approx(pop, "#bmsTotal") && b.rateHits.length === 2, b.rateHits.join());
  await pop.click('[data-tab="accounts"]');
  ok("the Ad accounts tab uses the table that is there: no third request", (await approx(pop)) && b.rateHits.length === 2, b.rateHits.join());
  await done(b);
}

export const flows = { moneyRates: ratesFlows, moneyLate: lateFlow, moneyFallback: fallbackFlows, moneyDown: downFlows, moneyOne: oneCurrencyFlow, moneyRu: russianFlow, moneyHidden: hiddenFlow };
