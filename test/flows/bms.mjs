// Businesses tab: what do I have and how much does each business spend. Automatic first load (and the Ad accounts list it needs),
// the one-minute slot, optional fields Graph refuses, a token that cannot read businesses, spend per business and period (shared
// with the Ad accounts tab), the total, order, the status pill, problems with their fixes, the jump to the Ad accounts tab, copied
// IDs, the picture or its placeholder, the cache per FB user, dead session / API pause / no token, paging, RU / EN, layout.
// Graph is a mock (fictional data); every /me/businesses request is checked to be a GET that never asks for a token field.
import { GRAPH, TOK, TOK2, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, captureClipboard, clip, accountsJson, adsFb, stored, boxWait } from "../harness.mjs";
import { LINKS } from "../../fb-helper/js/links.js";

const day = new Date().toISOString().slice(0, 10);
const ins = (spend) => ({ data: [{ spend: String(spend), impressions: "100", inline_link_clicks: "10", date_start: day, date_stop: day }] });
// Spend per period: [today, yesterday, 7 days, 30 days]; all time = amount_spent in minor units.
const acc = (account_id, name, account_status, biz, currency, [today, yesterday, week, month], allMajor) => ({
  account_id, name, account_status, currency, timezone_name: "UTC", amount_spent: String(Math.round(allMajor * 100)),
  p_today: ins(today), p_yesterday: ins(yesterday), p_week: ins(week), p_month: ins(month), ...(biz ? { business: { id: biz[0], name: biz[1] } } : {}),
});
const ALPHA = ["1001", "Alpha Media"], BETA = ["1002", "Beta Ads"], GAMMA = ["1003", "Gamma Group"], PARTNER = ["9999", "Partner Agency"];
const PIC = "https://scontent.xx.fbcdn.net/v/t39.30808-1/alpha_50.jpg";
const bm = (id, name, extra = {}) => ({ id, name, verification_status: "verified", ...extra });
const BMS = [
  bm("1001", "Alpha Media", { profile_picture_uri: PIC }),
  bm("1002", "Beta Ads", { verification_status: "failed", profile_picture_uri: "https://evil.example.com/tracker.png" }),
  bm("1003", "Gamma Group", { verification_status: "not_verified", profile_picture_uri: "https://scontent.xx.fbcdn.net/v/t39.30808-1/broken_50.jpg" }),
];
const ACCOUNTS = { data: [
  acc("11", "A one", 1, ALPHA, "USD", [100, 80, 600, 2000], 9000), acc("12", "A two", 2, ALPHA, "USD", [0, 0, 0, 0], 0), acc("13", "A three", 1, ALPHA, "EUR", [50, 40, 300, 900], 1000),
  acc("21", "B one", 2, BETA, "USD", [10, 8, 1000, 3000], 5000),
  acc("91", "P one", 1, PARTNER, "USD", [7, 6, 40, 100], 500),            // a client account of a business the profile does not manage
  acc("99", "Solo", 1, null, "USD", [1000, 900, 7000, 20000], 50000),       // no business: not in this tab, not in its total
] };
const TODAY = { total: "$117.00 + €50.00", alpha: "$100.00 + €50.00", beta: "$10.00", partner: "$7.00" };
const isBms = (u) => u.pathname.endsWith("/me/businesses");
const isAccs = (u) => u.pathname.endsWith("/me/adaccounts");
const isTabRead = (u) => isBms(u) && u.searchParams.get("limit") === "50";      // this tab's own read; the Ad accounts load asks for id,name with limit 100
const bmHits = (b) => b.hits.filter((h) => h.startsWith("/me/businesses") && h.includes("limit=50"));
const accHits = (b) => b.hits.filter((h) => h.startsWith("/me/adaccounts"));
const fieldsOf = (h) => new URL(`${GRAPH}${h}`).searchParams.get("fields") || "";
// "id,name,primary_page{id,name},x" → ["id","name","primary_page","x"] (commas inside braces do not split)
const askedKeys = (fields) => { const keys = []; let depth = 0, cur = ""; for (const ch of fields) { if (ch === "{") depth++; if (ch === "}") depth--; if (ch === "," && !depth) { keys.push(cur); cur = ""; } else cur += ch; } keys.push(cur); return keys.map((k) => k.replace(/\{.*$/, "")); };
// What Graph would send for the asked fields only (the mock must not hand out a field nobody asked for).
const answer = (rows, u) => { const keys = askedKeys(u.searchParams.get("fields") || ""); return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => (k === "id" || k === "name" || keys.includes(k)) && v !== undefined))); };
const fieldError = (name, type = "Business") => ({ status: 400, body: { error: { code: 100, message: `(#100) Tried accessing nonexisting field (${name}) on node type (${type})` } } });
const graphFor = ({ rows = BMS, accounts = ACCOUNTS, onBms, onAccs } = {}) => (u) =>
  isBms(u) ? (onBms ? onBms(u) : { body: { data: answer(rows, u) } }) : isAccs(u) ? (onAccs ? onAccs(u) : { body: accounts }) : { body: { data: [] } };
// Method + path of every request to Graph, from the browser side (the route mock does not see the method).
const watch = (b) => { const seen = []; b.ctx.on("request", (r) => { if (r.url().startsWith(GRAPH)) seen.push({ method: r.method(), path: new URL(r.url()).pathname, fields: new URL(r.url()).searchParams.get("fields") || "" }); }); return seen; };
const readOnly = (seen) => { const mine = seen.filter((r) => r.path.endsWith("/me/businesses")); return mine.length > 0 && mine.every((r) => r.method === "GET" && !/access_token/.test(r.fields)); };
const toastOf = (p) => p.evaluate(() => document.querySelector("#toast").textContent.trim());
const names = (p) => p.$$eval(".bm .row-name-text", (n) => n.map((x) => x.textContent));
const noErrs = (b) => ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
// A row as the screen shows it.
const rowOf = (p, name) => p.evaluate((n) => {
  const r = [...document.querySelectorAll(".bm")].find((x) => x.querySelector(".row-name-text").textContent === n);
  if (!r) return null;
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const link = (a) => ({ text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, title: a.title, aria: a.getAttribute("aria-label"), focus: a.dataset.focus, tab: a.tabIndex });
  const pill = r.querySelector(".row-top .pill"), spend = r.querySelector(".acc-spend"), set = r.querySelector(".acc-link");
  return {
    pill: pill && { text: pill.textContent.trim(), tone: pill.className.replace("pill", "").trim(), title: pill.title }, pills: r.querySelectorAll(".pill").length,
    id: r.querySelector(".acc-id")?.textContent.trim(), settings: set && link(set), spend: spend && clean(spend.textContent), spendMuted: !!spend?.classList.contains("muted"), spendTitle: spend?.title,
    summary: clean(r.querySelector(".bm-accs")?.textContent || ""), summaryIsButton: r.querySelector(".bm-accs")?.tagName === "BUTTON",
    probs: [...r.querySelectorAll(".prob")].map((x) => ({ key: x.dataset.problem, text: x.querySelector(".prob-text").textContent.trim(), tone: x.querySelector(".prob-text").className.replace("prob-text", "").trim(),
      title: x.querySelector(".prob-text").title, fixes: [...x.querySelectorAll("a")].map(link) })),
    actLinks: r.querySelectorAll(".act-inline").length, boxed: r.querySelectorAll(".btn, .act-link, .pill a, .row-links").length, text: clean(r.innerText),
  };
}, name);
const row = (p, name) => p.locator(".bm").filter({ has: p.locator(".row-name-text", { hasText: name }) });
const spends = (p) => p.$$eval(".bm", (rs) => Object.fromEntries(rs.map((r) => [r.querySelector(".row-name-text").textContent, r.querySelector(".acc-spend").textContent.replace(/\s+/g, " ").trim()])));
const totalOfTab = (p) => p.evaluate(() => ({ label: document.querySelector("#bmsTotal .total-label")?.textContent.trim(), meta: document.querySelector("#bmsTotal .total-meta")?.textContent.trim(), value: document.querySelector("#bmsTotal .total-value")?.textContent.replace(/\s+/g, " ").trim() }));
const period = (p, box) => p.evaluate((sel) => document.querySelector(`${sel} .seg-btn.active`)?.textContent.trim(), box);

// ---------- load, rows, limits ----------
async function bmsFlow() {
  console.log("\n# bms: load, rows, status, problems, limits");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  const seen = watch(b);
  await adsPage(b);
  let pop = await popup(b);
  ok("token tab open: nothing requested yet", bmHits(b).length === 0 && accHits(b).length === 0);
  await pop.click('[data-tab="bms"]');
  ok("first visit: rows appear without pressing refresh (3 of the profile + the client business named by an account)", await rowsAre(pop, ".bm", 4));
  ok("…one request of its own, a page of 50, for the verification and the logo only",
    bmHits(b).length === 1 && has(bmHits(b)[0], "limit=50") && fieldsOf(bmHits(b)[0]) === "id,name,verification_status,profile_picture_uri", bmHits(b).join() + fieldsOf(bmHits(b)[0]));
  ok("…and it loads the Ad accounts list too (its spend, counts and status come from there): one request", accHits(b).length === 1, String(accHits(b).length));
  ok("…and no toast for an automatic load", (await toastOf(pop)) === "", await toastOf(pop));
  ok("the tab is full height", await pop.evaluate(() => document.body.classList.contains("tall")));
  ok("rows sorted by spend today: most first, a business without accounts last", (await names(pop)).join() === "Alpha Media,Beta Ads,Partner Agency,Gamma Group", (await names(pop)).join());
  const t0 = await totalOfTab(pop);
  ok("total line: 'Spend of businesses · today · <date>' + the sum of the business rows; count and age on the right",
    /^Spend of businesses · today · \w{3} \d{1,2}$/.test(t0.label) && t0.value === TODAY.total && /^4 businesses · updated just now$/.test(t0.meta), JSON.stringify(t0));
  ok("…the ad account without a business ($1,000) is in no row and not in the total", !has(t0.value, "1,0") && (await pop.locator(".bm").count()) === 4, t0.value);

  const alpha = await rowOf(pop, "Alpha Media");
  ok("Alpha: ONE pill 'Active' (ok), the ID, the spend of today on the right", alpha.pills === 1 && alpha.pill.text === "Active" && alpha.pill.tone === "ok" && alpha.id === "1001" && alpha.spend === TODAY.alpha && !alpha.spendMuted, JSON.stringify(alpha));
  ok("…the settings link next to the ID (new tab, noopener noreferrer, this business)", alpha.settings?.href === LINKS.bmSettings("1001") && alpha.settings.target === "_blank" && alpha.settings.rel === "noopener noreferrer", JSON.stringify(alpha.settings));
  ok("…'3 ad accounts · 2 active · 1 disabled ›' as a button, nothing wrong → no problem line, no fix link", alpha.summary === "3 ad accounts · 2 active · 1 disabled" && alpha.summaryIsButton && alpha.probs.length === 0 && alpha.actLinks === 0, JSON.stringify(alpha));
  const beta = await rowOf(pop, "Beta Ads");
  ok("Beta: ONE pill 'No active ad accounts' (bad); 1 ad account · 1 disabled", beta.pills === 1 && beta.pill.text === "No active ad accounts" && beta.pill.tone === "bad" && beta.summary === "1 ad account · 1 disabled" && beta.spend === TODAY.beta, JSON.stringify(beta));
  ok("Beta: a failed verification and no active accounts, each as 'problem → fix' with exactly ONE underlined link",
    beta.probs.map((x) => `${x.text}>${x.fixes.map((f) => f.text).join("+")}`).join() === "Verification failed>Open verification,No active ad accounts>Ad accounts"
    && beta.probs.every((x) => x.fixes.length === 1 && x.tone === "bad" && x.fixes[0].target === "_blank" && x.fixes[0].rel === "noopener noreferrer" && x.fixes[0].tab === 0)
    && beta.probs[0].fixes[0].href === LINKS.bmSecurity("1002") && beta.probs[1].fixes[0].href === LINKS.bmAdAccounts("1002") && beta.actLinks === 2, JSON.stringify(beta.probs));
  ok("…each link names its business for a screen reader and has a keyboard key", beta.probs.every((x) => x.fixes[0].aria === `${x.fixes[0].text} · Beta Ads` && x.fixes[0].focus === `bm-fix:1002:${x.key}`), JSON.stringify(beta.probs.map((x) => x.fixes[0].aria)));
  const gamma = await rowOf(pop, "Gamma Group");
  ok("Gamma (no ad accounts): ONE pill 'No ad accounts' (warn), a dash for spend, no summary; 'No ad accounts → Create ad account'",
    gamma.pill.text === "No ad accounts" && gamma.pill.tone === "warn" && gamma.spend === "—" && gamma.spendMuted && gamma.summary === ""
    && gamma.probs.length === 1 && gamma.probs[0].text === "No ad accounts" && gamma.probs[0].tone === "warn" && gamma.probs[0].fixes.length === 1 && gamma.probs[0].fixes[0].text === "Create ad account"
    && gamma.probs[0].fixes[0].href === LINKS.bmAdAccounts("1003") && has(gamma.probs[0].fixes[0].title, "Business Settings"), JSON.stringify(gamma));
  ok("a not verified (not failed) business has no verification problem", !gamma.probs.some((x) => x.key === "verification"));
  const partner = await rowOf(pop, "Partner Agency");
  ok("Partner (named by a client account, not a business of the profile): its status and spend, but no settings link and no problem line", partner.pill.text === "Active" && partner.spend === TODAY.partner
    && partner.settings === null && partner.probs.length === 0 && partner.summary === "1 ad account · 1 active", JSON.stringify(partner));
  ok("no role, created date, page, 2FA, verification pill, chips or links row anywhere", await pop.evaluate(() => !/Admin|Employee|Created|2FA|Verified|Pending|Not verified|Page:/.test(document.querySelector("#bmsList").textContent)
    && !document.querySelector("#bmsChips") && !document.querySelector(".bm .row-links") && !document.querySelector("#tab-bms .chip")));
  ok("no pill-shaped or boxed action in a row (the fix is a plain underlined link in the status colour)", (await pop.locator(".bm .btn, .bm .act-link, .bm .pill a").count()) === 0
    && (await pop.locator(".bm .act-inline").evaluateAll((a) => a.length === 3 && a.every((x) => getComputedStyle(x).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(x.querySelector(".act-label")).textDecorationLine === "underline"))));

  // search: name or id
  await pop.fill("#bmFilter", "gam");
  ok("search by name", (await rowsAre(pop, ".bm", 1)) && (await names(pop))[0] === "Gamma Group");
  ok("…the total follows the search (a business without spend: a dash) and the count says found", has((await totalOfTab(pop)).meta, "1 of 4 found"), JSON.stringify(await totalOfTab(pop)));
  await pop.fill("#bmFilter", "1002");
  ok("search by id", (await rowsAre(pop, ".bm", 1)) && (await names(pop))[0] === "Beta Ads" && (await totalOfTab(pop)).value === TODAY.beta, JSON.stringify(await totalOfTab(pop)));
  await pop.fill("#bmFilter", "nothing like this");
  ok("search without a match", (await rowsAre(pop, ".bm", 0)) && has(await text(pop, "#bmsList"), "Nothing found"), await text(pop, "#bmsList"));
  await pop.fill("#bmFilter", "");
  ok("cleared search: all rows", await rowsAre(pop, ".bm", 4));

  // not requested again
  await pop.click('[data-tab="token"]'); await pop.click('[data-tab="bms"]'); await pop.waitForTimeout(700);
  ok("second visit in the same popup: no new request", bmHits(b).length === 1 && accHits(b).length === 1, `${bmHits(b).length} ${accHits(b).length}`);
  pop = await popup(b); await pop.waitForTimeout(700);
  ok("reopen (popup remembers the Businesses tab): cached rows, no request, no complaint", (await rowsAre(pop, ".bm", 4)) && bmHits(b).length === 1 && accHits(b).length === 1 && (await toastOf(pop)) === "", `${bmHits(b).length} ${await toastOf(pop)}`);
  // refresh: one attempt per minute (the automatic load took the slot)
  const refused = await clickToast(pop, "#loadBms");
  const secs = Number((/in (\d+) s/.exec(refused) || [])[1]);
  ok("refresh within a minute is refused with the seconds left, nothing sent", bmHits(b).length === 1 && accHits(b).length === 1 && secs >= 1 && secs <= 60, `${bmHits(b).length} ${refused}`);
  await resetLocks(pop);
  pop = await popup(b); await pop.waitForTimeout(1000);
  ok("reopen with the slot free: still no request while there is a list", bmHits(b).length === 1 && accHits(b).length === 1, `${bmHits(b).length} ${accHits(b).length}`);
  const done = await clickToast(pop, "#loadBms");
  ok("slot free: the refresh goes out and says how many businesses", bmHits(b).length === 2 && has(done, "Businesses: 3"), `${bmHits(b).length} ${done}`);
  for (let i = 0; i < 40 && accHits(b).length < 2; i++) await pop.waitForTimeout(100);
  ok("…and refreshes the Ad accounts list with it (the spend comes from there), without a toast of its own", accHits(b).length === 2 && has(await toastOf(pop), "Businesses: 3"), `${accHits(b).length} ${await toastOf(pop)}`);
  const slot = await stored(pop, "locks");
  ok("the slot is the key bms, about a minute", slot?.slots?.bms > Date.now() + 50000 && slot.slots.bms < Date.now() + 61000, JSON.stringify(slot));
  ok("every /me/businesses request was a GET and asked for no token field", readOnly(seen), JSON.stringify(seen.filter((r) => r.path.endsWith("/me/businesses"))));
  noErrs(b);
  await b.ctx.close();
}

// ---------- spend per business and period, shared with the Ad accounts tab ----------
async function bmsSpendFlow() {
  console.log("\n# bms: spend, periods, total, order, period shared with the Ad accounts tab");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  await adsPage(b);
  const pop = await popup(b, "bms");
  await rowsAre(pop, ".bm", 4);
  ok("the period buttons are the Ad accounts tab's: Today · Yesterday · 7 days · 30 days · All time, Today selected",
    (await pop.locator("#bmsPeriod .seg-btn").allTextContents()).join() === "Today,Yesterday,7 days,30 days,All time" && (await period(pop, "#bmsPeriod")) === "Today");
  const before = b.hits.length;
  const expect = {
    "Yesterday": { order: "Alpha Media,Beta Ads,Partner Agency,Gamma Group", Alpha: "$80.00 + €40.00", Beta: "$8.00", Partner: "$6.00", total: "$94.00 + €40.00" },
    "7 days": { order: "Beta Ads,Alpha Media,Partner Agency,Gamma Group", Alpha: "$600.00 + €300.00", Beta: "$1,000.00", Partner: "$40.00", total: "$1,640.00 + €300.00" },
    "30 days": { order: "Beta Ads,Alpha Media,Partner Agency,Gamma Group", Alpha: "$2,000.00 + €900.00", Beta: "$3,000.00", Partner: "$100.00", total: "$5,100.00 + €900.00" },
    "All time": { order: "Alpha Media,Beta Ads,Partner Agency,Gamma Group", Alpha: "$9,000.00 + €1,000.00", Beta: "$5,000.00", Partner: "$500.00", total: "$14,500.00 + €1,000.00" },
  };
  for (const [label, e] of Object.entries(expect)) {
    await pop.click(`#bmsPeriod .seg-btn:has-text("${label}")`);
    await pop.waitForTimeout(100);
    const s = await spends(pop), t = await totalOfTab(pop);
    ok(`${label}: each business's spend and the total (the sum of the rows)`, s["Alpha Media"] === e.Alpha && s["Beta Ads"] === e.Beta && s["Partner Agency"] === e.Partner && s["Gamma Group"] === "—" && t.value === e.total, JSON.stringify({ s, t }));
    ok(`${label}: rows ordered by that period's spend`, (await names(pop)).join() === e.order, (await names(pop)).join());
    ok(`${label}: the total line names the period`, t.label.startsWith(`Spend of businesses · ${label.toLowerCase()}`) && (label === "All time" ? !/·.*·/.test(t.label) : /· \w{3} \d{1,2}(–\w{3} \d{1,2})?$/.test(t.label)), t.label);
  }
  ok("switching periods sends no request", b.hits.length === before, b.hits.slice(before).join());

  // the period is one value for both tabs
  await pop.click('#bmsPeriod .seg-btn:has-text("7 days")');
  await pop.click('[data-tab="accounts"]');
  ok("7 days chosen on the Businesses tab is 7 days on the Ad accounts tab", (await period(pop, "#periodSeg")) === "7 days" && (await pop.locator("#accountsTotal .total-label").textContent()).toLowerCase().includes("7 days"));
  ok("…with that period's numbers there ($1,640 + €300 over the business accounts, plus Solo's $7,000)", has(await text(pop, "#accountsTotal .total-value"), "$8,640.00") && has(await text(pop, "#accountsTotal .total-value"), "€300.00"), await text(pop, "#accountsTotal .total-value"));
  await pop.click('#periodSeg .seg-btn:has-text("All time")');
  await pop.click('[data-tab="bms"]');
  ok("All time chosen on the Ad accounts tab is All time on the Businesses tab", (await period(pop, "#bmsPeriod")) === "All time" && (await totalOfTab(pop)).value === expect["All time"].total, JSON.stringify(await totalOfTab(pop)));
  ok("the choice is remembered (localStorage 'period'), shared by both tabs", (await pop.evaluate(() => localStorage.getItem("period"))) === "all");
  const again = await popup(b, "bms");
  ok("a reopened popup shows it on both tabs", (await period(again, "#bmsPeriod")) === "All time" && (await period(again, "#periodSeg")) === "All time" && (await spends(again))["Beta Ads"] === "$5,000.00", JSON.stringify(await spends(again)));
  ok("the keyboard focus stays on the period button after the redraw", await (async () => { await again.focus('[data-focus="bm-period:week"]'); await again.keyboard.press("Enter"); return again.evaluate(() => document.activeElement?.dataset.focus === "bm-period:week" && document.activeElement.getAttribute("aria-pressed") === "true"); })());
  ok("…and the other tab followed", (await again.evaluate(() => document.querySelector("#periodSeg .seg-btn.active").textContent.trim())) === "7 days");
  ok("no request for any of it", b.hits.length === before, b.hits.slice(before).join());
  noErrs(b);
  await b.ctx.close();

  // while the Ad accounts list loads: no status, spend is a dash
  const slow = await boot({ fb: adsFb(TOK), graph: graphFor({ onAccs: () => ({ delay: 1500, body: ACCOUNTS }) }) });
  await adsPage(slow);
  const sp = await popup(slow, "bms");
  ok("rows come first", await rowsAre(sp, ".bm", 3));
  const waiting = await sp.evaluate(() => ({ pills: document.querySelectorAll(".bm .pill").length, spend: [...document.querySelectorAll(".bm .acc-spend")].map((x) => x.textContent.trim()).join(), muted: [...document.querySelectorAll(".bm .acc-spend")].every((x) => x.classList.contains("muted")),
    total: document.querySelector("#bmsTotal .total-value")?.textContent.trim(), summaries: document.querySelectorAll(".bm .bm-accs").length, probs: [...document.querySelectorAll(".bm .prob")].map((x) => x.dataset.problem).join() }));
  ok("while the Ad accounts list is loading: no status pill, spend and total are dashes, no count and no 'no ad accounts' verdict (only the failed verification shows)",
    waiting.pills === 0 && waiting.spend === "—,—,—" && waiting.muted && waiting.total === "—" && waiting.summaries === 0 && waiting.probs === "verification", JSON.stringify(waiting));
  ok("…then the pills, the spend and the total appear", await until(sp, () => document.querySelectorAll(".bm .pill").length === 4 && /\$117\.00/.test(document.querySelector("#bmsTotal .total-value").textContent)), JSON.stringify(await totalOfTab(sp)));
  await slow.ctx.close();

  // insights refused for this token: today's spend is unknown, not 0; All time still reads Meta's total
  const noIns = await boot({ fb: adsFb(TOK), graph: graphFor({ onAccs: (u) => ((u.searchParams.get("fields") || "").includes("insights") ? fieldError("insights", "AdAccount") : { body: ACCOUNTS }) }) });
  await adsPage(noIns);
  const ni = await popup(noIns, "bms");
  await rowsAre(ni, ".bm", 4);
  await until(ni, () => document.querySelectorAll(".bm .pill").length === 4);
  const unknown = await spends(ni);
  ok("spend refused for this token: every business shows a dash with the reason as tooltip (never a made-up $0), and the total says to refresh",
    unknown["Alpha Media"] === "—" && unknown["Beta Ads"] === "—" && has((await rowOf(ni, "Alpha Media")).spendTitle, "No data for this period") && has((await totalOfTab(ni)).value, "refresh"), JSON.stringify({ unknown, t: await totalOfTab(ni) }));
  await ni.click('#bmsPeriod .seg-btn:has-text("All time")');
  ok("…All time still shows Meta's totals", (await spends(ni))["Alpha Media"] === "$9,000.00 + €1,000.00" && (await totalOfTab(ni)).value === "$14,500.00 + €1,000.00", JSON.stringify(await spends(ni)));
  await noIns.ctx.close();
}

// ---------- optional fields Graph refuses ----------
async function bmsFieldsFlow() {
  console.log("\n# bms: refused fields");
  const refuse = new Set(["verification_status", "profile_picture_uri"]);
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: (u) => {
    const f = askedKeys(u.searchParams.get("fields") || "");
    const bad = [...refuse].find((k) => f.includes(k));
    return bad ? fieldError(bad) : { body: { data: answer(BMS, u) } };
  } }) });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("rows load although both optional fields are refused", await rowsAre(pop, ".bm", 4));
  const hits = bmHits(b);
  ok("each refusal is retried at once without that field only (same page)", hits.length === 3
    && askedKeys(fieldsOf(hits[0])).includes("verification_status") && !askedKeys(fieldsOf(hits[1])).includes("verification_status") && askedKeys(fieldsOf(hits[1])).includes("profile_picture_uri")
    && !askedKeys(fieldsOf(hits[2])).includes("profile_picture_uri") && hits.every((h) => !has(h, "after=")), hits.map(fieldsOf).join(" | "));
  const beta = await rowOf(pop, "Beta Ads");
  ok("an unread verification is no verdict: no 'Verification failed' problem (Beta's was failed), only what the accounts say", beta.probs.map((x) => x.key).join() === "noActive", JSON.stringify(beta.probs));
  ok("…and the logos fall back to the placeholder", (await pop.locator(".bm img").count()) === 0 && (await pop.locator(".bm .av .i-building").count()) === 4);
  const saved = await stored(pop, "bms");
  ok("the cache keeps only whitelisted keys and the markers", saved.every((r) => Object.keys(r).every((k) => ["id", "name", "_noVerificationStatus", "_noProfilePictureUri"].includes(k)))
    && saved.every((r) => r._noVerificationStatus && r._noProfilePictureUri), JSON.stringify(saved[0]));
  await resetLocks(pop); await pop.click("#loadBms");
  for (let i = 0; i < 40 && bmHits(b).length < 4; i++) await pop.waitForTimeout(100);
  await pop.waitForTimeout(400);
  ok("the refusal is remembered for this token: the next read does not ask for those fields", bmHits(b).length === 4 && !askedKeys(fieldsOf(bmHits(b)[3])).some((k) => refuse.has(k)), bmHits(b).slice(3).map(fieldsOf).join());
  refuse.clear();
  noErrs(b);
  await b.ctx.close();
}

// ---------- a token that cannot read businesses ----------
async function bmsPermFlow() {
  console.log("\n# bms: no permission");
  for (const [label, err] of [
    ["#10 permission", { code: 10, message: "(#10) Application does not have permission for this action" }],
    ["#200 business_management", { code: 200, message: "(#200) Requires business_management permission to manage the object" }],
    ["#100 without a field", { code: 100, message: "(#100) Unsupported get request. Object with ID 'me' does not exist, cannot be loaded due to missing permissions" }],
  ]) {
    const b = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: () => ({ status: 403, body: { error: err } }) }) });
    await adsPage(b);
    const pop = await popup(b, "bms");
    const calm = await until(pop, () => /can't read business portfolios/.test(document.querySelector("#bmsList").textContent));
    ok(`${label}: a calm message in the list, saying what to do`, calm && has(await text(pop, "#bmsList"), "refresh the token"), await text(pop, "#bmsList"));
    ok(`${label}: no red toast, no red text`, !(await pop.evaluate(() => document.querySelector("#toast").classList.contains("err") && document.querySelector("#toast").classList.contains("show")))
      && (await pop.locator("#bmsList .err-text").count()) === 0, await toastOf(pop));
    ok(`${label}: one request of its own, no console error, nothing cached`, bmHits(b).length === 1 && !(await stored(pop, "bmsAt")), String(bmHits(b).length));
    noErrs(b);
    await b.ctx.close();
  }

  // a refused refresh keeps the old list and says why it is old
  let denied = false;
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: (u) => (denied && isTabRead(u) ? { status: 403, body: { error: { code: 200, message: "(#200) Requires business_management permission" } } } : { body: { data: answer(BMS, u) } }) }) });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("loaded", await rowsAre(pop, ".bm", 4));
  denied = true; await resetLocks(pop);
  await pop.click("#loadBms");
  ok("refresh refused: the list stays and a note says the token can't read businesses", (await until(pop, () => !!document.querySelector("#bmsList .bm-note"))) && (await rowsAre(pop, ".bm", 4)), await text(pop, "#bmsList"));
  denied = false; await resetLocks(pop);
  await pop.click("#loadBms");
  ok("a good refresh removes the note", (await until(pop, () => !document.querySelector("#bmsList .bm-note"))) && (await rowsAre(pop, ".bm", 4)));
  noErrs(b);
  await b.ctx.close();

  // any other failure is a red toast, and the list is simply "not loaded"
  const b2 = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: (u) => (isTabRead(u) ? { status: 500, body: { error: { code: 1, message: "boom" } } } : { body: { data: answer(BMS, u) } }) }) });
  await adsPage(b2);
  const pop2 = await popup(b2, "bms");
  ok("another error: the message is toasted in red", await until(pop2, () => /boom/.test(document.querySelector("#toast").textContent) && document.querySelector("#toast").classList.contains("err")), await toastOf(pop2));
  ok("…and the list is not the permission note", !has(await text(pop2, "#bmsList"), "can't read") && has(await text(pop2, "#bmsList"), "not loaded"), await text(pop2, "#bmsList"));
  await pop2.click('[data-tab="token"]'); await resetLocks(pop2); await pop2.click('[data-tab="bms"]'); await pop2.waitForTimeout(700);
  ok("…and not retried by going back to the tab", bmHits(b2).length === 1, String(bmHits(b2).length));
  await b2.ctx.close();
}

// ---------- the jump to the Ad accounts tab ----------
async function bmsAccountsFlow() {
  console.log("\n# bms: ad accounts of a business");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("rows load", await rowsAre(pop, ".bm", 4));
  await until(pop, () => document.querySelectorAll(".bm .pill").length === 4);
  const summary = async (name) => (await row(pop, name).locator(".bm-accs").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  ok("Alpha: 3 ad accounts · 2 active · 1 disabled", (await summary("Alpha Media")) === "3 ad accounts · 2 active · 1 disabled", await summary("Alpha Media"));
  ok("Beta: 1 ad account · 1 disabled (singular, no active part)", (await summary("Beta Ads")) === "1 ad account · 1 disabled", await summary("Beta Ads"));
  ok("Gamma has none: no summary line at all", (await row(pop, "Gamma Group").locator(".bm-accs").count()) === 0);
  await row(pop, "Alpha Media").locator(".bm-accs").click();
  ok("the click opens the Ad accounts tab", await until(pop, () => document.querySelector(".tab.active")?.dataset.tab === "accounts" && document.querySelector("#tab-accounts").classList.contains("active")));
  ok("…showing only that business's ad accounts, no new request", (await rowsAre(pop, ".acc", 3)) && accHits(b).length === 1
    && (await pop.$$eval(".acc .acc-name", (n) => n.map((x) => x.textContent).sort().join())) === "A one,A three,A two", String(accHits(b).length));
  ok("…with the business chip on the filter row (no 'BM' wording)", has(await text(pop, "#statusChips"), "Alpha Media ✕") && !/\bBM\b/.test(await text(pop, "#statusChips")) && (await pop.locator("#statusChips .chip.on").count()) >= 1, await text(pop, "#statusChips"));
  ok("…and the owner line of a row has the business name without a prefix", (await pop.locator(".acc .owner-name").first().textContent()) === "Alpha Media");
  await pop.click('[data-tab="bms"]');
  await row(pop, "Beta Ads").locator(".bm-accs").click();
  ok("Beta's counter filters the Ad accounts tab to Beta's one account", (await until(pop, () => document.querySelector(".tab.active")?.dataset.tab === "accounts"))
    && (await rowsAre(pop, ".acc", 1)) && has(await text(pop, "#statusChips"), "Beta Ads ✕") && !has(await text(pop, "#statusChips"), "Alpha Media"), await text(pop, "#statusChips"));
  await pop.click('#statusChips .chip:has-text("Beta Ads")');
  ok("clearing the chip shows every account again (the one without a business too)", await rowsAre(pop, ".acc", 6));
  noErrs(b);
  await b.ctx.close();

  // the Ad accounts list could not be loaded: no verdicts, no numbers, but a way in
  const b2 = await boot({ fb: adsFb(TOK), graph: graphFor({ onAccs: () => ({ status: 500, body: { error: { code: 1, message: "boom" } } }) }) });
  await adsPage(b2);
  const p2 = await popup(b2, "bms");
  ok("rows load", await rowsAre(p2, ".bm", 3));
  await until(p2, () => document.querySelectorAll(".bm .bm-accs").length === 3);
  ok("without the Ad accounts list: no pill, a dash for spend, 'Show ad accounts' on every row, no 'no ad accounts' problem",
    (await p2.locator(".bm .pill").count()) === 0 && (await p2.locator(".bm .acc-spend.muted").count()) === 3 && (await p2.locator(".bm .bm-accs").allInnerTexts()).join() === "Show ad accounts,Show ad accounts,Show ad accounts"
    && (await p2.locator(".bm .prob").allInnerTexts()).join().replace(/\s+/g, " ").startsWith("Verification failed"), (await p2.locator(".bm .bm-accs").allInnerTexts()).join());
  await row(p2, "Alpha Media").locator(".bm-accs").click();
  ok("the click opens the Ad accounts tab filtered to that business", (await until(p2, () => document.querySelector(".tab.active")?.dataset.tab === "accounts")) && has(await text(p2, "#statusChips"), "Alpha Media ✕"));
  await b2.ctx.close();
}

// ---------- copy IDs ----------
async function bmsCopyFlow() {
  console.log("\n# bms: copy");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  await adsPage(b);
  const pop = await popup(b, "bms");
  await rowsAre(pop, ".bm", 4);
  await captureClipboard(pop);
  await pop.click("#copyBmIds");
  ok("Copy IDs: every business shown, one per line, in the order shown", (await clip(pop)).join("|") === "1001\n1002\n9999\n1003", JSON.stringify(await clip(pop)));
  ok("…and says how many", has(await toastOf(pop), "Copied IDs: 4"), await toastOf(pop));
  await pop.fill("#bmFilter", "beta");
  await rowsAre(pop, ".bm", 1);
  await pop.click("#copyBmIds");
  ok("with a search: only the visible one", (await clip(pop)).at(-1) === "1002", JSON.stringify(await clip(pop)));
  await pop.fill("#bmFilter", "");
  await rowsAre(pop, ".bm", 4);
  await pop.click('#bmsPeriod .seg-btn:has-text("7 days")');
  await pop.click("#copyBmIds");
  ok("the order is the order on screen (7 days puts Beta first)", (await clip(pop)).at(-1) === "1002\n1001\n9999\n1003", JSON.stringify(await clip(pop)));
  await row(pop, "Gamma Group").locator(".acc-id").click();
  ok("the ID button copies that one ID", (await clip(pop)).at(-1) === "1003" && has(await toastOf(pop), "ID copied"), `${JSON.stringify(await clip(pop))} ${await toastOf(pop)}`);
  await pop.fill("#bmFilter", "zzz");
  ok("Copy IDs is disabled while nothing is shown", await pop.$eval("#copyBmIds", (n) => n.disabled));
  noErrs(b);
  await b.ctx.close();
}

// ---------- cache per FB user, other windows ----------
async function bmsCacheFlow() {
  console.log("\n# bms: cache and windows");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  const fb = await adsPage(b);
  let pop = await popup(b, "bms");
  ok("loaded for the first FB user", (await rowsAre(pop, ".bm", 4)) && (await stored(pop, "owner")) === "1001" && !!(await stored(pop, "bmsAt")));
  pop = await popup(b);
  ok("reopen keeps the rows (cache per FB user)", (await rowsAre(pop, ".bm", 4)) && bmHits(b).length === 1);
  await fb.close(); pop = await popup(b);
  ok("no FB tab: the cache stays, nothing sent", (await rowsAre(pop, ".bm", 4)) && bmHits(b).length === 1);
  const c0 = bmHits(b).length; await resetLocks(pop); await clickToast(pop, "#loadBms");
  ok("refresh without a token sends nothing", bmHits(b).length === c0);
  await b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }]);
  pop = await popup(b);
  ok("another FB user: the cache is dropped", (await rowsAre(pop, ".bm", 0)) && (await until(pop, () => chrome.storage.session.get(["bms", "bmsAt", "bmsTruncated"]).then((o) => !o.bms && !o.bmsAt && !o.bmsTruncated))));
  await adsPage(b); await resetLocks(pop);
  pop = await popup(b); await rowsAre(pop, ".bm", 4);
  ok("…and the tab loads again for the new user", bmHits(b).length === 2 && (await stored(pop, "owner")) === "2002", `${bmHits(b).length} ${await stored(pop, "owner")}`);

  // another window of the extension fills or drops the list
  await pop.evaluate(() => chrome.storage.session.set({ bms: [{ id: "9001", name: "From another window" }], bmsAt: Date.now() - 120000, bmsTruncated: true }));
  ok("a list stored by another window shows up", (await until(pop, () => [...document.querySelectorAll(".bm .row-name-text")].some((n) => n.textContent === "From another window")))
    && has((await totalOfTab(pop)).meta, "(not all)"), JSON.stringify(await totalOfTab(pop)));
  await pop.evaluate(() => chrome.storage.session.remove(["bms", "bmsAt", "bmsTruncated"]));
  ok("…and its removal", await until(pop, () => ![...document.querySelectorAll(".bm .row-name-text")].some((n) => n.textContent === "From another window")));
  noErrs(b);
  await b.ctx.close();
}

// ---------- no token, API pause, dead session, slow load ----------
async function bmsLimitsFlow() {
  console.log("\n# bms: dead session, pause, no token");
  // no token anywhere: nothing sent, the empty state says what to do, no toast
  let b = await boot({ fb: () => "<p>feed</p>", graph: graphFor() });
  await (await b.ctx.newPage()).goto("https://www.facebook.com/");
  let pop = await popup(b, "bms"); await pop.waitForTimeout(700);
  ok("no token: no request", bmHits(b).length === 0 && accHits(b).length === 0);
  ok("…the list says which button to press", has(await text(pop, "#bmsList"), "press the refresh button above"), await text(pop, "#bmsList"));
  ok("…and shows no error toast", (await toastOf(pop)) === "", await toastOf(pop));
  await b.ctx.close();

  // API pause: not even tried, by the tab or by the button
  b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  await adsPage(b);
  pop = await popup(b);
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 10 * 60000 }));
  await pop.reload(); await pop.waitForTimeout(500);
  await pop.click('[data-tab="bms"]'); await pop.waitForTimeout(800);
  ok("API pause: no automatic request (neither for the businesses nor for the ad accounts)", bmHits(b).length === 0 && accHits(b).length === 0, `${bmHits(b).length} ${accHits(b).length}`);
  const paused = await clickToast(pop, "#loadBms");
  ok("API pause: the button says so and sends nothing", bmHits(b).length === 0 && accHits(b).length === 0 && has(paused, "API limit hit"), `${bmHits(b).length} ${paused}`);
  ok("…without using up the minute slot", !(await stored(pop, "locks"))?.slots?.bms, JSON.stringify(await stored(pop, "locks")));
  await b.ctx.close();

  // dead session: the first 190 is reported, nothing is sent after it
  b = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: (u) => (isTabRead(u) ? { status: 400, body: { error: { code: 190, error_subcode: 463, message: "Session has expired" } } } : { body: { data: answer(BMS, u) } }) }) });
  await adsPage(b);
  pop = await popup(b);
  await pop.click('[data-tab="bms"]');
  ok("dead session: the automatic load reports the code", await until(pop, () => /190\/463/.test(document.querySelector("#toast").textContent)), await toastOf(pop));
  await resetLocks(pop);
  const again = await clickToast(pop, "#loadBms");
  ok("refresh: no request, the session message", bmHits(b).length === 1 && has(again, "no longer valid"), `${bmHits(b).length} ${again}`);
  pop = await popup(b); await pop.waitForTimeout(800);
  ok("popup reopen: still nothing sent", bmHits(b).length === 1, String(bmHits(b).length));
  noErrs(b);
  await b.ctx.close();

  // slow load: "Loading", and a click meanwhile neither errors nor doubles the request
  b = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: (u) => ({ delay: 1200, body: { data: answer(BMS, u) } }) }) });
  await adsPage(b);
  pop = await popup(b);
  await pop.click('[data-tab="bms"]');
  ok("while loading the list says so", await until(pop, () => /Loading businesses/.test(document.querySelector("#bmsList").textContent)), await text(pop, "#bmsList"));
  ok("…and the refresh button is busy", await until(pop, () => { const n = document.querySelector("#loadBms"); return n.disabled && n.getAttribute("aria-busy") === "true"; }));
  await pop.click("#loadBms", { force: true }).catch(() => {});
  await pop.waitForTimeout(300);
  ok("a click during the load neither complains nor doubles the request", !has(await toastOf(pop), "Refresh available") && bmHits(b).length === 1, `${await toastOf(pop)} / ${bmHits(b).length}`);
  ok("…then the rows", await rowsAre(pop, ".bm", 4));
  ok("…and the button is free again", await pop.$eval("#loadBms", (n) => !n.disabled && !n.hasAttribute("aria-busy")));
  noErrs(b);
  await b.ctx.close();

  // a token change while the list is loading: the old answer is dropped
  let tok = TOK;
  b = await boot({ fb: (u) => adsFb(tok)(u), graph: graphFor({ onBms: (u) => ({ delay: 1500, body: { data: answer(BMS, u) } }) }) });
  const fb = await adsPage(b);
  pop = await popup(b);
  await pop.click('[data-tab="bms"]');
  await until(pop, () => /Loading businesses/.test(document.querySelector("#bmsList").textContent));
  tok = TOK2; await fb.reload();
  await pop.click('[data-tab="token"]'); await pop.click("#grabToken");
  await boxWait(pop, /^EAABy/);
  await pop.waitForTimeout(2000);                          // the old request would have answered by now
  await pop.click('[data-tab="bms"]');
  ok("token changed mid-load: the old answer is dropped, no list stored", (await rowsAre(pop, ".bm", 0)) && !(await stored(pop, "bmsAt")) && !has(await text(pop, "#bmsList"), "Loading"), `${await text(pop, "#bmsList")} ${await stored(pop, "bmsAt")}`);
  ok("…and the refresh button works again", await pop.$eval("#loadBms", (n) => !n.disabled));
  noErrs(b);
  await b.ctx.close();
}

// ---------- paging ----------
async function bmsPagingFlow() {
  console.log("\n# bms: paging");
  let pages = 2;
  const one = (n) => bm(String(1000 + n), `Business ${n}`);
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ accounts: accountsJson, onBms: (u) => {
    if (!isTabRead(u)) return { body: { data: [] } };
    const after = u.searchParams.get("after"), n = after ? Number(after.slice(1)) + 1 : 1;
    return { body: { data: answer([one(n)], u), ...(n < pages ? { paging: { next: `${GRAPH}/next`, cursors: { after: `c${n}` } } } : {}) } };
  } }) });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("two pages: both are read, the second by cursor", (await rowsAre(pop, ".bm", 2)) && bmHits(b).length === 2 && has(bmHits(b)[1], "after=c1") && !has(bmHits(b)[0], "after="), bmHits(b).join(" | "));
  pages = 99;
  await resetLocks(pop);
  const toast = await clickToast(pop, "#loadBms");
  ok("an endless list stops after 4 pages and says so", (await rowsAre(pop, ".bm", 4)) && bmHits(b).length === 6 && has(toast, "4-page limit"), `${bmHits(b).length} ${toast}`);
  ok("…the total line says the list is not complete", has((await totalOfTab(pop)).meta, "(not all)"), JSON.stringify(await totalOfTab(pop)));
  noErrs(b);
  await b.ctx.close();
}

// ---------- RU / EN ----------
async function bmsLangFlow() {
  console.log("\n# bms: language");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  await adsPage(b);
  const pop = await popup(b, "bms");
  await rowsAre(pop, ".bm", 4);
  await until(pop, () => document.querySelectorAll(".bm .pill").length === 4);
  await pop.click('[data-lang="ru"]');
  ok("RU: the tab is 'Бизнесы', placeholder, copy and refresh labels, period buttons", (await text(pop, '[data-tab="bms"]')) === "Бизнесы" && (await pop.getAttribute("#bmFilter", "placeholder")) === "Поиск" && has(await text(pop, "#copyBmIds"), "ID бизнесов")
    && (await pop.getAttribute("#loadBms", "aria-label")) === "Обновить бизнесы и спенд" && (await pop.getAttribute("#bmFilter", "aria-label")) === "Поиск бизнесов"
    && (await pop.locator("#bmsPeriod .seg-btn").allTextContents()).join() === "Сегодня,Вчера,7 дней,30 дней,Всё время", `${await text(pop, '[data-tab="bms"]')} | ${(await pop.locator("#bmsPeriod .seg-btn").allTextContents()).join()}`);
  const t = await totalOfTab(pop);
  ok("RU: total line (Спенд бизнесов · сегодня, count with a plural, age) and the sum", /^Спенд бизнесов · сегодня · \d{2}\.\d{2}$/.test(t.label) && /^4 бизнеса · обновлено только что$/.test(t.meta) && t.value === "117,00 $ + 50,00 €", JSON.stringify(t));
  const alpha = await rowOf(pop, "Alpha Media"), beta = await rowOf(pop, "Beta Ads"), gamma = await rowOf(pop, "Gamma Group");
  ok("RU: pills, summary and the problems with their fixes", alpha.pill.text === "Активен" && alpha.summary === "3 кабинета · 2 активно · 1 заблокировано" && beta.pill.text === "Нет активных кабинетов" && gamma.pill.text === "Нет кабинетов"
    && beta.probs.map((x) => `${x.text}>${x.fixes[0].text}`).join() === "Верификация не пройдена>Открыть верификацию,Нет активных кабинетов>Кабинеты" && gamma.probs[0].fixes[0].text === "Создать кабинет", JSON.stringify([alpha, beta, gamma].map((r) => [r.pill.text, r.summary, r.probs.map((x) => x.text)])));
  ok("RU: no 'BM' / 'БМ' anywhere in the tab", await pop.evaluate(() => !/(^|[^\p{L}])(BM|БМ)(?![\p{L}])/u.test(document.querySelector("#tab-bms").innerText + [...document.querySelectorAll("#tab-bms [title], #tab-bms [aria-label]")].map((n) => n.title + n.getAttribute("aria-label")).join())));
  await pop.fill("#bmFilter", "zzz");
  ok("RU: nothing found", has(await text(pop, "#bmsList"), "Ничего не найдено"));
  await pop.fill("#bmFilter", "");
  await pop.click('[data-lang="en"]');
  ok("back to English everywhere", await until(pop, () => /^4 businesses · updated/.test(document.querySelector("#bmsTotal .total-meta").textContent.trim()) && /Active/.test(document.querySelector("#bmsList").textContent)
    && document.querySelector("#bmFilter").placeholder === "Search" && /Copy IDs/.test(document.querySelector("#copyBmIds").textContent) && document.querySelector('[data-tab="bms"]').textContent.trim() === "Businesses"));
  noErrs(b);
  await b.ctx.close();
}

// ---------- the picture, the fix links, layout ----------
async function bmsRowsFlow() {
  console.log("\n# bms: picture or placeholder, fix links, layout, keyboard");
  const asked = [];
  const b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  b.ctx.on("request", (r) => asked.push({ url: r.url(), referer: r.headers().referer }));
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("rows", await rowsAre(pop, ".bm", 4));
  const av = (name) => pop.evaluate((n) => {
    const r = [...document.querySelectorAll(".bm")].find((x) => x.querySelector(".row-name-text").textContent === n);
    const box = r.querySelector(".av"), img = box.querySelector("img"), icon = box.querySelector(".i"), cs = getComputedStyle(box);
    return { cls: box.className, ariaHidden: box.getAttribute("aria-hidden"), w: box.offsetWidth, h: box.offsetHeight, radius: cs.borderRadius, color: cs.color, bg: cs.backgroundColor,
      img: img && { src: img.getAttribute("src"), rp: img.getAttribute("referrerpolicy"), loading: img.getAttribute("loading"), decoding: img.getAttribute("decoding"), alt: img.getAttribute("alt"), w: img.getAttribute("width"), h: img.getAttribute("height"), natural: img.naturalWidth },
      icon: icon && { cls: icon.className, visible: getComputedStyle(icon).visibility, mask: getComputedStyle(icon).maskImage || getComputedStyle(icon).webkitMaskImage } };
  }, name);
  await until(pop, () => [...document.querySelectorAll(".bm")].some((r) => r.querySelector(".row-name-text").textContent === "Alpha Media" && r.querySelector(".av.ok")));
  const alpha = await av("Alpha Media");
  ok("Alpha: the logo URL on fbcdn.net renders an <img> in a 24 px rounded square", !!alpha.img && alpha.img.src === PIC && alpha.w === 24 && alpha.h === 24 && /av-square/.test(alpha.cls) && parseFloat(alpha.radius) === 6, JSON.stringify(alpha));
  ok("…decorative (alt empty, aria-hidden), no referrer, lazy, async, width and height set", alpha.img.alt === "" && alpha.ariaHidden === "true" && alpha.img.rp === "no-referrer" && alpha.img.loading === "lazy" && alpha.img.decoding === "async" && alpha.img.w === "24" && alpha.img.h === "24", JSON.stringify(alpha.img));
  ok("…it loaded (the placeholder icon is hidden behind it) and the request carried no Referer", alpha.img.natural > 0 && alpha.icon.visible === "hidden" && asked.find((r) => r.url === PIC)?.referer === undefined, JSON.stringify(asked.find((r) => r.url === PIC)));
  const beta = await av("Beta Ads");
  ok("Beta: a logo URL on another host is never kept: the Lucide building on a muted 24 px square in the secondary text colour, no <img>, no request to that host",
    !beta.img && beta.icon?.cls === "i i-building" && beta.icon.visible === "visible" && has(beta.icon.mask, "building-2.svg") && beta.w === 24 && beta.h === 24 && beta.color === "rgb(96, 103, 112)" && beta.bg === "rgb(240, 242, 245)"
    && !asked.some((r) => /evil\.example\.com/.test(r.url)), JSON.stringify(beta));
  ok("Gamma: a logo that fails to load (404) falls back to the same placeholder, the broken <img> is gone", await until(pop, () => { const r = [...document.querySelectorAll(".bm")].find((x) => x.querySelector(".row-name-text").textContent === "Gamma Group"); const box = r?.querySelector(".av"); return !!box && !box.querySelector("img") && !box.classList.contains("ok"); })
    && b.images.some((x) => /broken_50/.test(x)) && (await av("Gamma Group")).icon?.cls === "i i-building" && (await av("Gamma Group")).icon.visible === "visible");
  ok("Partner (no logo field at all): the placeholder", !(await av("Partner Agency")).img && (await av("Partner Agency")).icon?.cls === "i i-building");
  const failed = b.images.filter((x) => /broken_50/.test(x)).length;
  await pop.fill("#bmFilter", "a"); await pop.fill("#bmFilter", "");
  await rowsAre(pop, ".bm", 4); await pop.waitForTimeout(300);
  ok("a redraw does not ask again for a logo that failed, and keeps the one that loaded", b.images.filter((x) => /broken_50/.test(x)).length === failed && (await av("Alpha Media")).img?.src === PIC && !(await av("Gamma Group")).img);

  // fix links: the right URL, a new tab, nothing sent, nothing toggled, keyboard
  await until(pop, () => document.querySelectorAll(".bm .pill").length === 4);
  const hits0 = b.hits.length;
  await pop.evaluate(() => { window.__rowClicks = 0; document.querySelectorAll(".bm").forEach((r) => r.addEventListener("click", () => { window.__rowClicks++; })); });
  const clickOpens = async (act) => {
    const [np] = await Promise.all([b.ctx.waitForEvent("page", { timeout: 8000 }), act()]);
    await np.waitForURL(/facebook\.com/, { timeout: 8000 }).catch(() => {});
    const url = np.url(); await np.close(); return url;
  };
  const fix = (id, key) => pop.locator(`[data-focus="bm-fix:${id}:${key}"]`);
  ok("'Open verification' opens the business's Security page", (await clickOpens(() => fix("1002", "verification").click())) === LINKS.bmSecurity("1002"));
  ok("'Create ad account' opens the business's Ad accounts page in Business Settings", (await clickOpens(() => fix("1003", "none").click())) === LINKS.bmAdAccounts("1003"));
  ok("…Enter on a focused fix link does the same (keyboard)", (await clickOpens(async () => { await fix("1002", "noActive").focus(); await pop.keyboard.press("Enter"); })) === LINKS.bmAdAccounts("1002"));
  ok("the settings link next to the ID opens that business's settings", (await clickOpens(() => pop.locator('[data-focus="bm-set:1001"]').click())) === LINKS.bmSettings("1001"));
  ok("fix links never reach the row's own click handler, and send nothing to Graph", (await pop.evaluate(() => window.__rowClicks)) === 0 && b.hits.length === hits0, `${await pop.evaluate(() => window.__rowClicks)} / ${b.hits.length - hits0}`);
  ok("the tab did not change and the list is the same after the clicks", (await pop.evaluate(() => document.querySelector(".tab.active").dataset.tab)) === "bms" && (await rowsAre(pop, ".bm", 4)) && (await rowOf(pop, "Beta Ads")).probs.length === 2);
  ok("every control of a row is reachable by keyboard (buttons and links, no bare divs)", await pop.evaluate(() => [...document.querySelectorAll(".bm [data-focus]")].every((n) => ["BUTTON", "A"].includes(n.tagName) && n.tabIndex >= 0)));
  await pop.focus('[data-focus="bm-accs:1001"]'); await pop.keyboard.press("Enter");
  ok("…the summary button works from the keyboard too (opens the Ad accounts tab)", await until(pop, () => document.querySelector(".tab.active")?.dataset.tab === "accounts" && /Alpha Media ✕/.test(document.querySelector("#statusChips").textContent)));
  await pop.click('[data-tab="bms"]');

  // layout: nothing sticks out at 560 and 380, in both languages
  for (const lang of ["en", "ru"]) {
    await pop.click(`[data-lang="${lang}"]`);
    for (const w of [560, 380]) {
      await pop.setViewportSize({ width: w, height: 900 }); await pop.waitForTimeout(150);
      const m = await pop.evaluate(() => {
        const de = document.documentElement, r = (n) => n.getBoundingClientRect(), rows = [...document.querySelectorAll(".bm")];
        return { sw: de.scrollWidth, cw: de.clientWidth, rowsOver: rows.filter((x) => x.scrollWidth > x.clientWidth + 0.5).length,
          outside: rows.flatMap((x) => [...x.querySelectorAll(".act-inline, .pill, .acc-id, .acc-spend, .av")].filter((n) => r(n).right > r(x).right - 15.5 || r(n).left < r(x).left + 15.5)).length,
          pillOneLine: rows.every((x) => !x.querySelector(".pill") || r(x.querySelector(".pill")).height <= 25), cut: [...document.querySelectorAll(".act-inline .act-label")].filter((l) => l.scrollWidth > l.clientWidth).length,
          tabsCut: [...document.querySelectorAll(".tab")].filter((t) => t.scrollWidth > t.clientWidth).length };
      });
      ok(`${lang} ${w}px: no horizontal scroll, no row wider than the window`, m.sw <= m.cw && m.rowsOver === 0, JSON.stringify(m));
      ok(`${lang} ${w}px: every link, pill, amount and logo stays inside the 16 px gutters; the pill is one line; no fix label is cut; no tab label is cut`, m.outside === 0 && m.pillOneLine && m.cut === 0 && m.tabsCut === 0, JSON.stringify(m));
    }
  }
  noErrs(b);
  await b.ctx.close();
}

// ---------- long names, many rows, keyboard, focus ----------
async function bmsLayoutFlow() {
  console.log("\n# bms: many rows and long names");
  const many = Array.from({ length: 30 }, (_, i) => bm(String(5000 + i), i % 3 ? `Business ${i}` : `A very long business name that has to end in an ellipsis instead of pushing the status pill out ${i}`,
    { verification_status: ["verified", "pending_need_more_info", "revoked"][i % 3] }));
  const accounts = { data: many.slice(0, 20).map((x, i) => acc(String(700 + i), `Acc ${i}`, i % 4 ? 1 : 2, [x.id, x.name], i % 2 ? "EUR" : "USD", [i * 3 + 1, 1, 1, 1], 10)) };
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ rows: many, accounts }) });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("30 rows", await rowsAre(pop, ".bm", 30));
  await until(pop, () => document.querySelectorAll(".bm .pill").length === 30);
  ok("no horizontal overflow at 560 px (page and every row)", await pop.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    && [...document.querySelectorAll(".bm")].every((r) => r.scrollWidth <= r.clientWidth)), await pop.evaluate(() => `${document.documentElement.scrollWidth}/${document.documentElement.clientWidth}`));
  await pop.setViewportSize({ width: 380, height: 900 }); await pop.waitForTimeout(150);
  ok("…and none at 380 px", await pop.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && [...document.querySelectorAll(".bm")].every((r) => r.scrollWidth <= r.clientWidth)), await pop.evaluate(() => `${document.documentElement.scrollWidth}/${document.documentElement.clientWidth}`));
  await pop.setViewportSize({ width: 560, height: 900 });
  ok("a long name is cut with an ellipsis (the full one is the tooltip)", await pop.evaluate(() => { const n = [...document.querySelectorAll(".bm .row-name-text")].find((x) => x.textContent.startsWith("A very long")); return getComputedStyle(n).textOverflow === "ellipsis" && n.scrollWidth > n.clientWidth && !!n.closest(".row-name").title; }));
  ok("the controls stay in the card, the list below it", await pop.evaluate(() => document.querySelector("#bmsCard #bmFilter") && document.querySelector("#bmsCard #loadBms") && document.querySelector("#bmsCard #bmsPeriod") && document.querySelector("#bmsList").previousElementSibling.id === "bmsCard"));
  ok("the sum line equals the rows: 20 accounts of 20 businesses, USD and EUR joined with ' + '", /^\$[\d,.]+ \+ €[\d,.]+$/.test((await totalOfTab(pop)).value), JSON.stringify(await totalOfTab(pop)));

  // focus survives a redraw: typing in the search, pressing a period button, pressing a row button
  await pop.click("#bmFilter"); await pop.keyboard.type("Business");
  ok("typing in the search keeps the caret in the field", await pop.evaluate(() => document.activeElement.id === "bmFilter" && document.activeElement.value === "Business"));
  await pop.fill("#bmFilter", "");
  await pop.focus('#bmsPeriod [data-focus="bm-period:yesterday"]'); await pop.keyboard.press("Enter");
  ok("a period button pressed with the keyboard keeps focus after the redraw", await pop.evaluate(() => document.activeElement.dataset.focus === "bm-period:yesterday" && document.activeElement.getAttribute("aria-pressed") === "true"), await pop.evaluate(() => document.activeElement.outerHTML.slice(0, 120)));
  noErrs(b);
  await b.ctx.close();

  // businesses without any ad account and verified: the quiet case, one status
  const b2 = await boot({ fb: adsFb(TOK), graph: graphFor({ rows: [bm("1", "One"), bm("2", "Two")], accounts: { data: [] } }) });
  await adsPage(b2);
  const pop2 = await popup(b2, "bms");
  ok("two businesses, no ad accounts at all: both 'No ad accounts', each with its one fix, and a dash total", (await rowsAre(pop2, ".bm", 2)) && (await until(pop2, () => document.querySelectorAll(".bm .pill").length === 2))
    && (await pop2.locator(".bm .prob .act-inline").count()) === 2 && (await totalOfTab(pop2)).value === "—", JSON.stringify(await totalOfTab(pop2)));
  // no businesses at all
  const b3 = await boot({ fb: adsFb(TOK), graph: graphFor({ rows: [], accounts: { data: [] } }) });
  await adsPage(b3);
  const pop3 = await popup(b3, "bms");
  ok("no businesses: says so, and Copy IDs is disabled", (await until(pop3, () => /No business portfolios on this profile/.test(document.querySelector("#bmsList").textContent))) && (await pop3.$eval("#copyBmIds", (n) => n.disabled)), await text(pop3, "#bmsList"));
  const again = await popup(b3); await again.waitForTimeout(700);
  ok("…an empty list is a loaded list: reopening does not ask again", bmHits(b3).length === 1, String(bmHits(b3).length));
  await b2.ctx.close(); await b3.ctx.close();
}

export const flows = { bms: bmsFlow, bmsSpend: bmsSpendFlow, bmsFields: bmsFieldsFlow, bmsPerm: bmsPermFlow, bmsAccounts: bmsAccountsFlow, bmsCopy: bmsCopyFlow, bmsCache: bmsCacheFlow, bmsLimits: bmsLimitsFlow, bmsPaging: bmsPagingFlow, bmsLang: bmsLangFlow, bmsRows: bmsRowsFlow, bmsLayout: bmsLayoutFlow };
