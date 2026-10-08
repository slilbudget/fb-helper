// Businesses tab: what do I have and how much does each business spend. Automatic first load (and the Ad accounts list it needs), the
// one-minute slot, optional fields Graph refuses, a token that cannot read businesses, spend per business and period (shared with the
// Ad accounts tab), exact amounts on rows ("≈" only on the total), the order by USD equivalent, silent healthy rows, every problem with its
// one fix, the expanded row, the jump to the Ad accounts tab, no Copy IDs, the picture or its placeholder, the cache per FB user, dead
// session / API pause / no token, paging, RU / EN, layout. Graph is a mock (fictional data); every /me/businesses request is checked to
// be a GET that never asks for a token field.
import path from "node:path";
import { GRAPH, TOK, TOK2, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, captureClipboard, clip, accountsJson, adsFb, stored, boxWait, ratesOk } from "../harness.mjs";
import { LINKS } from "../../fb-helper/js/links.js";

const SHOT = process.env.BMS_SHOT_DIR || "";               // when set, screenshots of the tab go there
const day = new Date().toISOString().slice(0, 10);
const ins = (spend) => ({ data: [{ spend: String(spend), impressions: "100", inline_link_clicks: "10", date_start: day, date_stop: day }] });
// Spend per period: [today, yesterday, 7 days, 30 days]; all time = amount_spent (minor units, except for a currency without cents).
const acc = (account_id, name, account_status, biz, currency, [today, yesterday, week, month], allMajor) => ({
  account_id, name, account_status, currency, timezone_name: "UTC", amount_spent: String(currency === "VND" ? allMajor : Math.round(allMajor * 100)),
  p_today: ins(today), p_yesterday: ins(yesterday), p_week: ins(week), p_month: ins(month), ...(biz ? { business: { id: biz[0], name: biz[1] } } : {}),
});
const ALPHA = ["1001", "Alpha Media"], BETA = ["1002", "Beta Ads"], GAMMA = ["1003", "Gamma Group"], DELTA = ["1004", "Delta Co"], EPS = ["1005", "Epsilon Digital"], PARTNER = ["9999", "Partner Agency"];
const PIC = "https://scontent.xx.fbcdn.net/v/t39.30808-1/alpha_50.jpg";
const bm = (id, name, extra = {}) => ({ id, name, verification_status: "verified", ...extra });
const BMS = [
  bm("1001", "Alpha Media", { profile_picture_uri: PIC }),
  bm("1002", "Beta Ads", { verification_status: "failed", profile_picture_uri: "https://evil.example.com/tracker.png" }),
  bm("1003", "Gamma Group", { verification_status: "not_verified", profile_picture_uri: "https://scontent.xx.fbcdn.net/v/t39.30808-1/broken_50.jpg" }),
  bm("1004", "Delta Co", { profile_picture_uri: "https://scontent.xx.fbcdn.net/v/t39.30808-1/delta_50.jpg" }),
  bm("1005", "Epsilon Digital", { verification_status: "pending" }),
];
const ACCOUNTS = { data: [
  acc("11", "A one", 1, ALPHA, "USD", [100, 80, 600, 2000], 9000), acc("12", "A two", 2, ALPHA, "USD", [0, 0, 0, 0], 0), acc("13", "A three", 1, ALPHA, "EUR", [50, 40, 300, 900], 1000),
  acc("21", "B one", 2, BETA, "USD", [10, 8, 1000, 3000], 5000),
  acc("31", "D one", 1, DELTA, "USD", [25, 20, 150, 500], 2000), acc("32", "D two", 1, DELTA, "EUR", [10, 8, 60, 200], 800), acc("33", "D three", 1, DELTA, "VND", [250000, 200000, 1500000, 5000000], 40000000),
  acc("41", "E one", 2, EPS, "USD", [0, 0, 0, 0], 300), acc("42", "E two", 101, EPS, "USD", [0, 0, 0, 0], 0),   // disabled + closed: nothing active
  acc("91", "P one", 1, PARTNER, "USD", [7, 6, 40, 100], 500),            // a client account of a business the profile does not manage
  acc("99", "Solo", 1, null, "USD", [1000, 900, 7000, 20000], 50000),       // no business: not in this tab, not in its total
] };
// The six rows in the order of Today at USD equivalents (EUR 0.8, VND 25 000 per dollar): Alpha 162.50, Delta 47.50, Beta 10, Partner 7, Epsilon 0, Gamma none.
const ORDER_TODAY = "Alpha Media,Delta Co,Beta Ads,Partner Agency,Epsilon Digital,Gamma Group";
export const fixtures = { BMS, ACCOUNTS, PIC, ratesOk, ORDER_TODAY };
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
export const graphFor = ({ rows = BMS, accounts = ACCOUNTS, onBms, onAccs } = {}) => (u) =>
  isBms(u) ? (onBms ? onBms(u) : { body: { data: answer(rows, u) } }) : isAccs(u) ? (onAccs ? onAccs(u) : { body: accounts }) : { body: { data: [] } };
// Method + path of every request to Graph, from the browser side (the route mock does not see the method).
const watch = (b) => { const seen = []; b.ctx.on("request", (r) => { if (r.url().startsWith(GRAPH)) seen.push({ method: r.method(), path: new URL(r.url()).pathname, fields: new URL(r.url()).searchParams.get("fields") || "" }); }); return seen; };
const readOnly = (seen) => { const mine = seen.filter((r) => r.path.endsWith("/me/businesses")); return mine.length > 0 && mine.every((r) => r.method === "GET" && !/access_token/.test(r.fields)); };
const toastOf = (p) => p.evaluate(() => document.querySelector("#toast").textContent.trim());
const ROW = "#bmsList .lrow";
const names = (p) => p.$$eval(`${ROW} .lrow-name`, (n) => n.map((x) => x.textContent));
const noErrs = (b) => ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// A row as the screen shows it: the status, the context, the fix, the amount, the ID.
const rowOf = (p, name) => p.evaluate(([sel, n]) => {
  const r = [...document.querySelectorAll(sel)].find((x) => x.querySelector(".lrow-name").textContent === n);
  if (!r) return null;
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const link = (a) => a && { text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, title: a.title, aria: a.getAttribute("aria-label"), focus: a.dataset.focus, tab: a.tabIndex, icon: !!a.querySelector(".i") };
  const st = r.querySelector(".lrow-status"), val = r.querySelector(".lrow-value"), sub = r.querySelector(".lrow-sub");
  return {
    key: r.dataset.row, open: r.classList.contains("open"), avatar: !!r.querySelector(".lav-square"),
    status: st && { text: st.textContent.trim(), tone: ["ok", "warn", "bad"].find((c) => st.classList.contains(c)) || "", title: st.title, dot: getComputedStyle(st.querySelector(".lrow-dot")).backgroundColor, color: getComputedStyle(st).color },
    sr: r.querySelector(".lrow-sub .sr-only")?.textContent ?? null,
    ctx: [...r.querySelectorAll(".lrow-ctx")].map((x) => clean(x.textContent)), disabled: [...r.querySelectorAll(".lrow-ctx .lbm-dis")].map((x) => ({ text: clean(x.textContent), color: getComputedStyle(x).color })),
    fix: link(r.querySelector(".lrow-sub .lrow-fix")), fixes: r.querySelectorAll(".lrow-sub .lrow-fix").length, more: r.querySelector(".lrow-more")?.textContent ?? null,
    value: val ? clean(val.textContent) : null, valueMuted: !!val?.classList.contains("muted"), valueTitle: val?.title ?? null,
    id: r.querySelector(".lrow-head .lrow-id")?.textContent.trim() ?? null, sub: sub ? clean(sub.textContent) : "",
    pills: r.querySelectorAll(".pill").length, boxed: r.querySelectorAll(".btn, .act-box, .row-links, .acc-id").length,
  };
}, [ROW, name]);
// The expanded body of a row (it must be open): kv pairs, what to do, links.
const bodyOf = (p, name) => p.evaluate(([sel, n]) => {
  const r = [...document.querySelectorAll(sel)].find((x) => x.querySelector(".lrow-name").textContent === n);
  const bd = r?.querySelector(".lrow-body");
  if (!bd) return null;
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const link = (a) => ({ text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, aria: a.getAttribute("aria-label"), icon: !!a.querySelector(".i") });
  const txt = (n) => (n.nodeType === 3 ? n.textContent : [...n.childNodes].map(txt).join(n.classList?.contains("lbm-accs") ? " " : ""));   // the counts and the button are two things: a space between
  const todo = bd.querySelector(".lrow-todo"), go = bd.querySelector(".lbm-go");
  return {
    kv: [...bd.querySelectorAll(".lrow-pair")].map((x) => [clean(x.querySelector("dt").textContent), clean(txt(x.querySelector("dd")))]),
    kvTitles: Object.fromEntries([...bd.querySelectorAll(".lrow-pair")].map((x) => [clean(x.querySelector("dt").textContent), x.querySelector("dd").title])),
    todo: todo && { title: todo.querySelector(".lrow-todo-title").textContent, help: clean(todo.querySelector(".lrow-todo-help")?.textContent ?? ""), links: [...todo.querySelectorAll("a")].map(link), tone: ["bad", "warn"].find((c) => todo.classList.contains(c)) || "", bg: getComputedStyle(todo).backgroundColor },
    links: [...bd.querySelectorAll(".lrow-links a")].map(link),
    go: go && { text: go.textContent.trim(), tag: go.tagName, focus: go.dataset.focus, title: go.title }, idline: clean(bd.querySelector(".lrow-idline")?.textContent ?? ""),
  };
}, [ROW, name]);
const row = (p, name) => p.locator(ROW).filter({ has: p.locator(".lrow-name", { hasText: name }) });
const toggle = (p, name) => row(p, name).locator(".lrow-title").click();
const spends = (p) => p.$$eval(ROW, (rs) => Object.fromEntries(rs.map((r) => [r.querySelector(".lrow-name").textContent, r.querySelector(".lrow-value").textContent.replace(/\s+/g, " ").trim()])));
// The label is the text of .total-label itself: the muted "3 of 10 found" / "(not all)" is a span inside it (the meta, read apart).
const totalOfTab = (p) => p.evaluate(() => ({ label: [...(document.querySelector("#bmsTotal .total-label")?.childNodes ?? [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() || undefined, meta: document.querySelector("#bmsTotal .total-meta")?.textContent.trim(), value: document.querySelector("#bmsTotal .total-value")?.textContent.replace(/\s+/g, " ").trim(),
  sub: document.querySelector("#bmsTotal .total-sub")?.textContent.replace(/\s+/g, " ").trim() ?? null }));
const period = (p, box) => p.evaluate((sel) => document.querySelector(`${sel} .seg-btn.active`)?.textContent.trim(), box);
const settled = (p, n = 6) => until(p, (k) => document.querySelectorAll("#bmsList .lrow-status, #bmsList .lrow-sub .sr-only").length >= k, n);   // the Ad accounts list has arrived: every row has a state word
const TODAY = { total: "≈ $227.00", Alpha: "$100.00 + €50.00", Beta: "$10.00", Delta: "≈ $47.50", Epsilon: "$0", Partner: "$7.00" };

// ---------- load, rows, status, limits ----------
async function bmsFlow() {
  console.log("\n# bms: load, rows, state, limits");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(), rates: ratesOk });
  const seen = watch(b);
  await adsPage(b);
  let pop = await popup(b);
  ok("token tab open: nothing requested yet", bmHits(b).length === 0 && accHits(b).length === 0);
  await pop.click('[data-tab="bms"]');
  ok("first visit: rows appear without pressing refresh (5 of the profile + the client business named by an account)", await rowsAre(pop, ROW, 6));
  ok("…one request of its own, a page of 50, for the verification and the logo only",
    bmHits(b).length === 1 && has(bmHits(b)[0], "limit=50") && fieldsOf(bmHits(b)[0]) === "id,name,verification_status,profile_picture_uri", bmHits(b).join() + fieldsOf(bmHits(b)[0]));
  ok("…and it loads the Ad accounts list too (its spend, counts and state come from there): one request", accHits(b).length === 1, String(accHits(b).length));
  ok("…and no toast for an automatic load", (await toastOf(pop)) === "", await toastOf(pop));
  ok("the tab is full height", await pop.evaluate(() => document.body.getBoundingClientRect().height >= 600));
  ok("one row grammar: shared .lrow rows with a 24 px business picture; no old row, pill or boxed action in the list", await pop.evaluate(() => document.querySelectorAll("#bmsList .lrow").length === 6 && !document.querySelector("#bmsList .row, #bmsList .acc, #bmsList .pill, #bmsList .btn, #bmsList .act-box")
    && [...document.querySelectorAll("#bmsList .lrow .lav")].every((a) => a.offsetWidth === 24 && a.classList.contains("lav-square"))));
  await settled(pop);
  ok("rows sorted by spend today in USD equivalents (not by the raw sum: Delta's 250 000 dong are $10), a business without ad accounts last", (await names(pop)).join() === ORDER_TODAY, (await names(pop)).join());
  const t0 = await totalOfTab(pop);
  ok("total line: 'Spend · <date>' (the segment says which period) + the sum of the business rows, the one '≈'; no count while nothing is filtered",
    /^Spend · \w{3} \d{1,2}$/.test(t0.label) && t0.value === TODAY.total && !t0.meta, JSON.stringify(t0));
  ok("…the ad account without a business ($1,000) is in no row and not in the total", (await names(pop)).length === 6 && !has(t0.value, "1,"), t0.value);
  const sum = await spends(pop);
  ok("…≈ appears on the total only (rows: exact amounts per currency, '≈' only from three currencies)", !Object.entries(sum).some(([n, v]) => v.includes("≈") && n !== "Delta Co") && sum["Delta Co"] === TODAY.Delta, JSON.stringify(sum));

  // a healthy row is silent
  const alpha = await rowOf(pop, "Alpha Media");
  ok("Alpha (3 ad accounts, one disabled): nothing on screen but the context; the state word is there for screen readers only", alpha.status === null && alpha.sr === "Active" && alpha.fixes === 0 && alpha.more === null && alpha.sub === "Active3 ad accounts · 1 disabled", JSON.stringify(alpha));
  ok("…'3 ad accounts · 1 disabled': the disabled count in red, the rest muted", alpha.ctx.join("|") === "3 ad accounts · 1 disabled" && alpha.disabled.length === 1 && alpha.disabled[0].text === "1 disabled" && alpha.disabled[0].color === "rgb(207, 33, 39)", JSON.stringify([alpha.ctx, alpha.disabled]));
  ok("…the amount of today on the right (exact, two currencies), the ID under it, no pill", alpha.value === TODAY.Alpha && !alpha.valueMuted && alpha.id === "1001" && alpha.pills === 0, JSON.stringify(alpha));
  // problems: one word, one fix
  const beta = await rowOf(pop, "Beta Ads");
  ok("Beta (failed verification, its one account disabled): 'Unverified' in red, ONE underlined fix 'Verify' to the Security page, '+1 more' for the other problem", beta.status?.text === "Unverified" && beta.status.tone === "bad" && beta.fixes === 1 && beta.fix.text === "Verify"
    && beta.fix.href === LINKS.bmSecurity("1002") && beta.fix.target === "_blank" && beta.fix.rel === "noopener noreferrer" && !beta.fix.icon && beta.more === "+1 more", JSON.stringify(beta));
  ok("…its tooltip names the exact state; the context says '1 ad account · 1 disabled'; the fix has the owner in its accessible name", beta.status.title === "Business verification: Failed" && beta.ctx.join("|") === "1 ad account · 1 disabled" && beta.fix.aria === "Verify · Beta Ads", JSON.stringify(beta));
  ok("…the amount is exact ($10.00)", beta.value === TODAY.Beta, beta.value);
  const gamma = await rowOf(pop, "Gamma Group");
  ok("Gamma (no ad accounts): 'No ad accounts' (amber) → 'Create account' to its Ad accounts page in Business Settings; no context; a muted dash", gamma.status?.text === "No ad accounts" && gamma.status.tone === "warn" && gamma.fix?.text === "Create account"
    && gamma.fix.href === LINKS.bmAdAccounts("1003") && has(gamma.fix.title, "Business Settings") && gamma.ctx.length === 0 && gamma.value === "—" && gamma.valueMuted && gamma.more === null, JSON.stringify(gamma));
  ok("a not verified (not failed) business has no verification problem; neither has a pending one", gamma.status.text !== "Unverified" && (await rowOf(pop, "Epsilon Digital")).status.text !== "Unverified");
  const eps = await rowOf(pop, "Epsilon Digital");
  ok("Epsilon (a disabled and a closed account): 'None active' (red), no fix on the line, '2 ad accounts · 1 disabled', '$0' muted (zero spend, not a dash)", eps.status?.text === "None active" && eps.status.tone === "bad" && eps.fixes === 0 && eps.more === null
    && eps.ctx.join("|") === "2 ad accounts · 1 disabled" && eps.value === "$0" && eps.valueMuted, JSON.stringify(eps));
  const partner = await rowOf(pop, "Partner Agency");
  ok("Partner (named by a client account, not a business of the profile): silent, exact spend, its one account", partner.status === null && partner.sr === "Active" && partner.value === TODAY.Partner && partner.ctx.join("|") === "1 ad account", JSON.stringify(partner));
  const delta = await rowOf(pop, "Delta Co");
  ok("Delta (USD + EUR + VND): '≈ $47.50' on the row, every currency in the tooltip", delta.value === TODAY.Delta && has(clean(delta.valueTitle), "$25.00 + €10.00 + VND 250,000") && has(delta.valueTitle, "Approximate"), JSON.stringify(delta));
  ok("no role, created date, page, 2FA, verification pill, chips, links row or Copy IDs anywhere on the collapsed rows", await pop.evaluate(() => !/Admin|Employee|Created|2FA|Verified|Pending|Not verified|Page:|Copy IDs/.test(document.querySelector("#bmsList").textContent)
    && !document.querySelector("#bmsChips") && !document.querySelector("#bmsList .lrow-links") && !document.querySelector("#tab-bms .chip") && !document.querySelector("#copyBmIds")));
  ok("the controls are the search and the refresh button (Copy IDs is gone), the period segment, the total", await pop.evaluate(() => [...document.querySelectorAll("#bmsCard .search > *")].map((n) => n.id || n.className).join() === "i i-search,bmFilter,loadBms"
    && !!document.querySelector("#bmsCard #bmsPeriod") && !!document.querySelector("#bmsCard #bmsTotal") && !/Copy IDs|ID бизнесов/.test(document.querySelector("#bmsCard").textContent)));
  ok("fixes are plain underlined links in the status colour (no pill, no box): Verify red, Create account amber", await pop.evaluate(() => {
    const f = (n) => { const r = [...document.querySelectorAll("#bmsList .lrow")].find((x) => x.querySelector(".lrow-name").textContent === n).querySelector(".lrow-fix"); const cs = getComputedStyle(r); return [cs.backgroundColor, getComputedStyle(r.querySelector(".act-label")).textDecorationLine, cs.color]; };
    return JSON.stringify([f("Beta Ads"), f("Gamma Group")]) === JSON.stringify([["rgba(0, 0, 0, 0)", "underline", "rgb(207, 33, 39)"], ["rgba(0, 0, 0, 0)", "underline", "rgb(138, 97, 0)"]]);
  }));

  // search: name or id
  await pop.fill("#bmFilter", "gam");
  ok("search by name", (await rowsAre(pop, ROW, 1)) && (await names(pop))[0] === "Gamma Group");
  ok("…the count appears only now ('1 of 6 found'); the total is a dash (nothing to add up)", has((await totalOfTab(pop)).meta, "1 of 6 found") && (await totalOfTab(pop)).value === "—", JSON.stringify(await totalOfTab(pop)));
  await pop.fill("#bmFilter", "1002");
  ok("search by id; the total is that row's amount (exact: one currency)", (await rowsAre(pop, ROW, 1)) && (await names(pop))[0] === "Beta Ads" && (await totalOfTab(pop)).value === TODAY.Beta, JSON.stringify(await totalOfTab(pop)));
  await pop.fill("#bmFilter", "nothing like this");
  ok("search without a match", (await rowsAre(pop, ROW, 0)) && has(await text(pop, "#bmsList"), "Nothing found"), await text(pop, "#bmsList"));
  await pop.fill("#bmFilter", "");
  ok("cleared search: all rows, no count", (await rowsAre(pop, ROW, 6)) && !(await totalOfTab(pop)).meta);

  // not requested again
  await pop.click('[data-tab="token"]'); await pop.click('[data-tab="bms"]'); await pop.waitForTimeout(700);
  ok("second visit in the same popup: no new request", bmHits(b).length === 1 && accHits(b).length === 1, `${bmHits(b).length} ${accHits(b).length}`);
  pop = await popup(b); await pop.waitForTimeout(700);
  ok("reopen (popup remembers the Businesses tab): cached rows, no request, no complaint", (await rowsAre(pop, ROW, 6)) && bmHits(b).length === 1 && accHits(b).length === 1 && (await toastOf(pop)) === "", `${bmHits(b).length} ${await toastOf(pop)}`);
  // refresh: one attempt per minute (the automatic load took the slot)
  const refused = await clickToast(pop, "#loadBms");
  const secs = Number((/in (\d+) s/.exec(refused) || [])[1]);
  ok("refresh within a minute is refused with the seconds left, nothing sent", bmHits(b).length === 1 && accHits(b).length === 1 && secs >= 1 && secs <= 60, `${bmHits(b).length} ${refused}`);
  await resetLocks(pop);
  pop = await popup(b); await pop.waitForTimeout(1000);
  ok("reopen with the slot free: still no request while there is a list", bmHits(b).length === 1 && accHits(b).length === 1, `${bmHits(b).length} ${accHits(b).length}`);
  const done = await clickToast(pop, "#loadBms");
  ok("slot free: the refresh goes out and says how many businesses", bmHits(b).length === 2 && has(done, "Businesses: 5"), `${bmHits(b).length} ${done}`);
  for (let i = 0; i < 40 && accHits(b).length < 2; i++) await pop.waitForTimeout(100);
  ok("…and refreshes the Ad accounts list with it (the spend comes from there), without a toast of its own", accHits(b).length === 2 && has(await toastOf(pop), "Businesses: 5"), `${accHits(b).length} ${await toastOf(pop)}`);
  ok("…the age of the list is the refresh button's tooltip, not text on the screen", /^Refresh businesses and spend · updated /.test(await pop.getAttribute("#loadBms", "title")) && !/updated/.test(await text(pop, "#bmsTotal")), await pop.getAttribute("#loadBms", "title"));
  const slot = await stored(pop, "locks");
  ok("the slot is the key bms, about a minute", slot?.slots?.bms > Date.now() + 50000 && slot.slots.bms < Date.now() + 61000, JSON.stringify(slot));
  ok("every /me/businesses request was a GET and asked for no token field", readOnly(seen), JSON.stringify(seen.filter((r) => r.path.endsWith("/me/businesses"))));
  noErrs(b);
  await b.ctx.close();
}

// ---------- spend per business and period, shared with the Ad accounts tab ----------
async function bmsSpendFlow() {
  console.log("\n# bms: spend, periods, total, order, rates, period shared with the Ad accounts tab");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "bms");
  await rowsAre(pop, ROW, 6); await settled(pop);
  ok("the period buttons are the Ad accounts tab's: Today · Yesterday · 7 days · 30 days · All time, Today selected",
    (await pop.locator("#bmsPeriod .seg-btn").allTextContents()).join() === "Today,Yesterday,7 days,30 days,All time" && (await period(pop, "#bmsPeriod")) === "Today");
  const before = b.hits.length;
  // Per period: each business's amount (one currency exact, two "a + b", three "≈"), the order by USD equivalent, the total = the sum of the rows (the only ≈ besides the 3-currency row).
  const expect = {
    "Today": { order: ORDER_TODAY, Alpha: "$100.00 + €50.00", Beta: "$10.00", Delta: "≈ $47.50", Epsilon: "$0", Partner: "$7.00", total: "≈ $227.00" },
    "Yesterday": { order: ORDER_TODAY, Alpha: "$80.00 + €40.00", Beta: "$8.00", Delta: "≈ $38.00", Epsilon: "$0", Partner: "$6.00", total: "≈ $182.00" },
    "7 days": { order: "Beta Ads,Alpha Media,Delta Co,Partner Agency,Epsilon Digital,Gamma Group", Alpha: "$600.00 + €300.00", Beta: "$1,000", Delta: "≈ $285.00", Epsilon: "$0", Partner: "$40.00", total: "≈ $2,300" },
    "30 days": { order: "Alpha Media,Beta Ads,Delta Co,Partner Agency,Epsilon Digital,Gamma Group", Alpha: "$2,000.00 + €900.00", Beta: "$3,000", Delta: "≈ $950.00", Epsilon: "$0", Partner: "$100.00", total: "≈ $7,175" },
    "All time": { order: "Alpha Media,Beta Ads,Delta Co,Partner Agency,Epsilon Digital,Gamma Group", Alpha: "$9,000 + €1,000", Beta: "$5,000", Delta: "≈ $4,600", Epsilon: "$300.00", Partner: "$500.00", total: "≈ $20,650" },
  };
  for (const [label, e] of Object.entries(expect)) {
    await pop.click(`#bmsPeriod .seg-btn:has-text("${label}")`);
    await pop.waitForTimeout(100);
    const s = await spends(pop), t = await totalOfTab(pop);
    ok(`${label}: each business's spend (a currency: exact, two: 'a + b', three: '≈') and the total`, s["Alpha Media"] === e.Alpha && s["Beta Ads"] === e.Beta && s["Delta Co"] === e.Delta && s["Epsilon Digital"] === e.Epsilon && s["Partner Agency"] === e.Partner && s["Gamma Group"] === "—" && t.value === e.total, JSON.stringify({ s, t }));
    ok(`${label}: rows ordered by that period's spend in USD equivalents`, (await names(pop)).join() === e.order, (await names(pop)).join());
    ok(`${label}: the total line is 'Spend' + the date range (no period word, nothing after 'Spend' for All time)`, label === "All time" ? t.label === "Spend" : /^Spend · \w{3} \d{1,2}(–\w{3} \d{1,2})?$/.test(t.label), t.label);
  }
  ok("switching periods sends no request to Graph", b.hits.length === before, b.hits.slice(before).join());
  ok("the total of the rows is the sum of the rows: at today's rates $142 + €60 + VND 250 000 = $227.00 (the muted line lists the biggest currencies)", await (async () => {
    await pop.click('#bmsPeriod .seg-btn:has-text("Today")'); await pop.waitForTimeout(100);
    const t = await totalOfTab(pop);
    return t.value === "≈ $227.00" && /^\$142\.00 \+ €60\.00 \+1 more · rates /.test(t.sub) && has(t.sub, "ExchangeRate-API");
  })(), JSON.stringify(await totalOfTab(pop)));
  ok("only the total says '≈' for a two-currency sum; a row never does: Alpha stays 'a + b' next to the converted total", (await spends(pop))["Alpha Media"] === "$100.00 + €50.00");

  // the order really follows USD, not the raw sum: without rates Delta's 250 000 dong outweigh everything
  const nr = await boot({ fb: adsFb(TOK), graph: graphFor() });
  await adsPage(nr);
  const np = await popup(nr, "bms");
  await rowsAre(np, ROW, 6); await settled(np);
  const raw = await spends(np);
  ok("without rates (both sources down): rows keep exact amounts per currency (three: the first two + '+1 more'), the total is the per-currency sum, no '≈' anywhere", raw["Delta Co"] === "$25.00 + €10.00 +1 more" && raw["Alpha Media"] === TODAY.Alpha && !has(JSON.stringify(raw), "≈")
    && (await totalOfTab(np)).value === "$142.00 + €60.00 + VND 250,000" && (await totalOfTab(np)).sub === null, JSON.stringify({ raw, t: await totalOfTab(np) }));
  ok("…and the order falls back to the plain sum of the amounts (documented: right only within one currency)", (await names(np))[0] === "Delta Co", (await names(np)).join());
  await nr.ctx.close();

  // the period is one value for both tabs
  await pop.click('#bmsPeriod .seg-btn:has-text("7 days")');
  await pop.click('[data-tab="accounts"]');
  ok("7 days chosen on the Businesses tab is 7 days on the Ad accounts tab", (await period(pop, "#periodSeg")) === "7 days" && /^Spend · \w{3} \d{1,2}(–\w{3} \d{1,2})?$/.test(await pop.locator("#accountsTotal .total-label").textContent()));
  await pop.click('#periodSeg .seg-btn:has-text("All time")');
  await pop.click('[data-tab="bms"]');
  ok("All time chosen on the Ad accounts tab is All time on the Businesses tab", (await period(pop, "#bmsPeriod")) === "All time" && (await totalOfTab(pop)).value === expect["All time"].total, JSON.stringify(await totalOfTab(pop)));
  ok("the choice is remembered (localStorage 'period'), shared by both tabs", (await pop.evaluate(() => localStorage.getItem("period"))) === "all");
  const again = await popup(b, "bms");
  ok("a reopened popup shows it on both tabs", (await period(again, "#bmsPeriod")) === "All time" && (await period(again, "#periodSeg")) === "All time" && (await spends(again))["Beta Ads"] === "$5,000", JSON.stringify(await spends(again)));
  ok("the keyboard focus stays on the period button after the redraw", await (async () => { await again.focus('[data-focus="bm-period:week"]'); await again.keyboard.press("Enter"); return again.evaluate(() => document.activeElement?.dataset.focus === "bm-period:week" && document.activeElement.getAttribute("aria-pressed") === "true"); })());
  ok("…and the other tab followed", (await again.evaluate(() => document.querySelector("#periodSeg .seg-btn.active").textContent.trim())) === "7 days");
  ok("no request for any of it", b.hits.length === before, b.hits.slice(before).join());
  noErrs(b);
  await b.ctx.close();

  // while the Ad accounts list loads: no state word, spend is a dash, nothing claims "No ad accounts"
  const slow = await boot({ fb: adsFb(TOK), graph: graphFor({ onAccs: () => ({ delay: 1500, body: ACCOUNTS }) }) });
  await adsPage(slow);
  const sp = await popup(slow, "bms");
  ok("rows come first", await rowsAre(sp, ROW, 5));
  const waiting = await sp.evaluate(() => ({ states: document.querySelectorAll("#bmsList .lrow-status, #bmsList .sr-only").length, ctx: document.querySelectorAll("#bmsList .lrow-ctx").length, spend: [...document.querySelectorAll("#bmsList .lrow-value")].map((x) => x.textContent.trim()).join(),
    muted: [...document.querySelectorAll("#bmsList .lrow-value")].every((x) => x.classList.contains("muted")), total: document.querySelector("#bmsTotal .total-value")?.textContent.trim() ?? "", status: [...document.querySelectorAll("#bmsList .lrow-status")].map((x) => x.textContent.trim()).join(),
    title: document.querySelector("#bmsList .lrow-value").title }));
  ok("while the Ad accounts list is loading: no state word, no count, every amount a muted dash (with the reason as tooltip), the total a dash; the only thing said is the failed verification, never 'No ad accounts'",
    waiting.states === 1 && waiting.status === "Unverified" && waiting.ctx === 0 && waiting.spend === "—,—,—,—,—" && waiting.muted && waiting.total === "—" && has(waiting.title, "not loaded yet"), JSON.stringify(waiting));
  ok("…then the state, the counts, the amounts and the total appear", await until(sp, () => document.querySelectorAll("#bmsList .lrow-ctx").length > 0 && /\$/.test(document.querySelector("#bmsTotal .total-value").textContent)), JSON.stringify(await totalOfTab(sp)));
  await slow.ctx.close();

  // insights refused for this token: today's spend is unknown, not 0; All time still reads Meta's total
  const noIns = await boot({ fb: adsFb(TOK), graph: graphFor({ onAccs: (u) => ((u.searchParams.get("fields") || "").includes("insights") ? fieldError("insights", "AdAccount") : { body: ACCOUNTS }) }), rates: ratesOk });
  await adsPage(noIns);
  const ni = await popup(noIns, "bms");
  await rowsAre(ni, ROW, 6); await settled(ni);
  const unknown = await spends(ni);
  ok("spend refused for this token: every business shows a dash with the reason as tooltip (never a made-up $0), and the total says to refresh",
    unknown["Alpha Media"] === "—" && unknown["Beta Ads"] === "—" && unknown["Epsilon Digital"] === "—" && has((await rowOf(ni, "Alpha Media")).valueTitle, "No data for this period") && has((await totalOfTab(ni)).value, "refresh"), JSON.stringify({ unknown, t: await totalOfTab(ni) }));
  await ni.click('#bmsPeriod .seg-btn:has-text("All time")');
  ok("…All time still shows Meta's totals (the converted total arrives with the rates)", (await spends(ni))["Alpha Media"] === "$9,000 + €1,000" && (await until(ni, (v) => document.querySelector("#bmsTotal .total-value").textContent.trim() === v, expect["All time"].total)), JSON.stringify([await spends(ni), await totalOfTab(ni)]));
  await noIns.ctx.close();
}

// ---------- the Ad accounts list stopped at its page limit ----------
async function bmsTruncatedFlow() {
  console.log("\n# bms: incomplete Ad accounts list");
  let pages = 0;
  const b = await boot({ fb: adsFb(TOK), rates: ratesOk, graph: graphFor({ rows: [bm("1001", "Alpha Media"), bm("1003", "Gamma Group")], onAccs: () => {
    pages++;
    return { body: { data: [acc(String(100 + pages), `A ${pages}`, pages === 1 ? 1 : 2, ALPHA, "USD", [pages, 0, 0, 0], 0)], paging: { next: `${GRAPH}/next`, cursors: { after: `c${pages}` } } } };   // never ends: 10 pages, then "not all"
  } }) });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("two businesses", await rowsAre(pop, ROW, 2));
  await until(pop, () => /not all/.test(document.querySelector("#bmsTotal")?.textContent ?? ""));
  const alpha = await rowOf(pop, "Alpha Media"), gamma = await rowOf(pop, "Gamma Group");
  ok("the list is incomplete: the total says '(not all)'; a business with accounts read shows its count as 'at least' ('10+')", has((await totalOfTab(pop)).meta, "(not all)") && alpha.ctx[0] === "10+ ad accounts · 9 disabled", JSON.stringify([await totalOfTab(pop), alpha.ctx]));
  ok("…and never claims what the unread part may contradict: Gamma has no 'No ad accounts', no fix, a dash", gamma.status === null && gamma.fix === null && gamma.value === "—" && gamma.ctx.length === 0, JSON.stringify(gamma));
  await b.ctx.close();
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
  ok("rows load although both optional fields are refused", await rowsAre(pop, ROW, 6));
  const hits = bmHits(b);
  ok("each refusal is retried at once without that field only (same page)", hits.length === 3
    && askedKeys(fieldsOf(hits[0])).includes("verification_status") && !askedKeys(fieldsOf(hits[1])).includes("verification_status") && askedKeys(fieldsOf(hits[1])).includes("profile_picture_uri")
    && !askedKeys(fieldsOf(hits[2])).includes("profile_picture_uri") && hits.every((h) => !has(h, "after=")), hits.map(fieldsOf).join(" | "));
  await settled(pop);
  const beta = await rowOf(pop, "Beta Ads");
  ok("an unread verification is no verdict: no 'Unverified' (Beta's was failed), only what the accounts say ('None active')", beta.status?.text === "None active" && beta.fixes === 0 && beta.more === null, JSON.stringify(beta));
  await toggle(pop, "Beta Ads");
  ok("…and the expanded row has no Verification line", !(await bodyOf(pop, "Beta Ads")).kv.some(([k]) => k === "Verification"), JSON.stringify(await bodyOf(pop, "Beta Ads")));
  ok("…the logos fall back to the placeholder", (await pop.locator(`${ROW} img`).count()) === 0 && (await pop.locator(`${ROW} .lav .i-building`).count()) === 6);
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
    const calm = await until(pop, () => /can't read the list/.test(document.querySelector("#bmsList").textContent));
    ok(`${label}: a calm line above the businesses the ad accounts name, saying what to do (the same words on every tab)`, calm && (await text(pop, "#bmsList .list-note")) === "This token can't read the list — open Ads Manager or Business Manager, refresh the token (the refresh button on the Token tab) and try again.", await text(pop, "#bmsList"));
    ok(`${label}: no red toast, no red text`, !(await pop.evaluate(() => document.querySelector("#toast").classList.contains("err") && document.querySelector("#toast").classList.contains("show")))
      && (await pop.locator("#bmsList .err-text").count()) === 0, await toastOf(pop));
    // a permission error may be about ONE extra field: the extras are given up one tier at a time (verification, then the logo), then it is final
    const own = bmHits(b).map(fieldsOf);
    ok(`${label}: three requests of its own, each without the next extra field (verification, then the logo), then the calm note; no console error, nothing cached`,
      own.length === 3 && askedKeys(own[0]).join() === "id,name,verification_status,profile_picture_uri" && askedKeys(own[1]).join() === "id,name,profile_picture_uri" && askedKeys(own[2]).join() === "id,name" && !(await stored(pop, "bmsAt")), own.join(" | "));
    noErrs(b);
    await b.ctx.close();
  }

  // a refused refresh keeps the old list and says why it is old
  let denied = false;
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: (u) => (denied && isTabRead(u) ? { status: 403, body: { error: { code: 200, message: "(#200) Requires business_management permission" } } } : { body: { data: answer(BMS, u) } }) }) });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("loaded", await rowsAre(pop, ROW, 6));
  denied = true; await resetLocks(pop);
  await pop.click("#loadBms");
  ok("refresh refused: the list stays and a note says the token can't read businesses", (await until(pop, () => !!document.querySelector("#bmsList .list-note"))) && (await rowsAre(pop, ROW, 6)), await text(pop, "#bmsList"));
  denied = false; await resetLocks(pop);
  await pop.click("#loadBms");
  ok("a good refresh removes the note", (await until(pop, () => !document.querySelector("#bmsList .list-note"))) && (await rowsAre(pop, ROW, 6)));
  noErrs(b);
  await b.ctx.close();

  // any other failure is a red toast, and the list is simply "not loaded"
  const b2 = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: (u) => (isTabRead(u) ? { status: 500, body: { error: { code: 1, message: "boom" } } } : { body: { data: answer(BMS, u) } }) }) });
  await adsPage(b2);
  const pop2 = await popup(b2, "bms");
  ok("another error: the message is toasted in red", await until(pop2, () => /boom/.test(document.querySelector("#toast").textContent) && document.querySelector("#toast").classList.contains("err")), await toastOf(pop2));
  ok("…and not the permission note; the five businesses the loaded ad accounts name (not Gamma, which has none) are shown instead of an empty list (no logo, no fix link: nothing is known of them), the line says it is not all",
    await until(pop2, () => document.querySelectorAll("#bmsList .lrow").length === 5) && !has(await text(pop2, "#bmsList"), "can't read") && (await pop2.locator(`${ROW} .lrow-fix`).count()) === 0
    && has(await text(pop2, "#bmsTotal .total-meta"), "(not all)") && (await pop2.locator(`${ROW} img`).count()) === 0, await text(pop2, "#bmsList") + await text(pop2, "#bmsTotal"));
  ok("…its refresh button says how old the BUSINESS list is: never loaded, so no 'updated'", (await pop2.locator("#loadBms").getAttribute("title")) === "Refresh businesses and spend", await pop2.locator("#loadBms").getAttribute("title"));
  await pop2.click('[data-tab="token"]'); await resetLocks(pop2); await pop2.click('[data-tab="bms"]'); await pop2.waitForTimeout(700);
  ok("…and not retried by going back to the tab", bmHits(b2).length === 1, String(bmHits(b2).length));
  await b2.ctx.close();
}

// ---------- the expanded row and the jump to the Ad accounts tab ----------
async function bmsAccountsFlow() {
  console.log("\n# bms: expanded row, ad accounts of a business");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("rows load", await rowsAre(pop, ROW, 6));
  await settled(pop);
  ok("collapsed rows have no body at all (built when a row opens)", (await pop.locator("#bmsList .lrow-body").count()) === 0);

  // Alpha: counts, the button, verification, Business settings only
  await toggle(pop, "Alpha Media");
  const a = await bodyOf(pop, "Alpha Media");
  ok("Alpha: 'Ad accounts: 3 · 2 active · 1 disabled' + the 'Show ad accounts →' button (a real <button>), 'Verification: Verified'", a.kv.map((x) => x.join(": ")).join("|") === "Ad accounts: 3 · 2 active · 1 disabled Show ad accounts →|Verification: Verified" && a.go?.tag === "BUTTON" && a.go.text === "Show ad accounts →" && a.go.focus === "bm-go:1001", JSON.stringify(a));
  ok("…no 'What to do' on a healthy row; the links row has Business settings only (↗, new tab, owner in its name); the ID line comes first with its copy button", a.todo === null && a.links.length === 1 && a.links[0].text === "Business settings" && a.links[0].href === LINKS.bmSettings("1001") && a.links[0].icon && a.links[0].target === "_blank" && a.links[0].rel === "noopener noreferrer" && a.links[0].aria === "Business settings: Alpha Media" && a.idline === "ID1001", JSON.stringify(a));
  ok("…the open state is kept across a redraw (period switch) and the body is rebuilt", await (async () => { await pop.click('#bmsPeriod .seg-btn:has-text("Yesterday")'); return (await rowOf(pop, "Alpha Media")).open && !!(await bodyOf(pop, "Alpha Media")) && (await rowOf(pop, "Alpha Media")).value === "$80.00 + €40.00"; })());
  await pop.click('#bmsPeriod .seg-btn:has-text("Today")');
  // Beta: both problems in the body, the fix on line 2 is not repeated
  await toggle(pop, "Beta Ads");
  const be = await bodyOf(pop, "Beta Ads");
  ok("Beta: 'Verification: Failed' in the body; What to do = both helps and EVERY action, the Verify fix of line 2 first, then Manage ad accounts, tone bad (title and links), no tinted box", be.kv.some((k) => k.join(": ") === "Verification: Failed") && be.todo?.title === "What to do" && has(be.todo.help, "Verify the business again.") && has(be.todo.help, "Check why the ad accounts are not active")
    && be.todo.links.map((l) => `${l.text}>${l.href}`).join() === `Verify>${LINKS.bmSecurity("1002")},Manage ad accounts>${LINKS.bmAdAccounts("1002")}` && be.todo.tone === "bad" && be.todo.bg === "rgba(0, 0, 0, 0)", JSON.stringify(be.todo));
  ok("…Beta's counts: '1 · 1 disabled' (no zero part)", be.kv[0].join(": ") === "Ad accounts: 1 · 1 disabled Show ad accounts →", JSON.stringify(be.kv));
  // Gamma: nothing to show on the Ad accounts tab
  await toggle(pop, "Gamma Group");
  const ga = await bodyOf(pop, "Gamma Group");
  ok("Gamma: no ad accounts → no counts and no jump button (nothing to show there); What to do has the help and the fix of line 2 (Create account); Business settings", ga.kv.length === 1 && ga.kv[0][0] === "Verification" && ga.go === null && ga.todo.help === "Create an ad account, or ask a business admin to give you access to an existing one." && ga.todo.links.map((l) => l.text).join() === "Create account" && ga.links.length === 1, JSON.stringify(ga));
  // Epsilon: no fix on the line, so the action is in the body
  await toggle(pop, "Epsilon Digital");
  const ep = await bodyOf(pop, "Epsilon Digital");
  ok("Epsilon: 'None active' has no fix on line 2, so its Business Settings link is in What to do", ep.todo.links.map((l) => `${l.text}>${l.href}`).join() === `Manage ad accounts>${LINKS.bmAdAccounts("1005")}` && ep.kv[0].join(": ") === "Ad accounts: 2 · 1 disabled Show ad accounts →" && ep.kv.some((k) => k.join(": ") === "Verification: In review"), JSON.stringify(ep));
  // Delta: three currencies → the full breakdown
  await toggle(pop, "Delta Co");
  const de = await bodyOf(pop, "Delta Co");
  ok("Delta (three currencies): the body has 'Spend' with every currency exact, the tooltip says approximate", de.kv.some(([k, v]) => k === "Spend" && v === "$25.00 + €10.00 + VND 250,000") && has(de.kvTitles.Spend, "Approximate") && de.kv.length === 3, JSON.stringify(de));
  // Partner: not a business of the profile → no settings link
  await toggle(pop, "Partner Agency");
  const pa = await bodyOf(pop, "Partner Agency");
  ok("Partner (only named by a client account): counts and the jump, no Verification, no Business settings link, no What to do", pa.kv.length === 1 && pa.kv[0][0] === "Ad accounts" && pa.links.length === 0 && pa.todo === null, JSON.stringify(pa));
  // All the rows were opened: close them again
  for (const n of ["Alpha Media", "Beta Ads", "Gamma Group", "Epsilon Digital", "Delta Co", "Partner Agency"]) await toggle(pop, n);
  ok("a click on the name closes a row and throws its body away", (await pop.locator("#bmsList .lrow-body").count()) === 0);

  // the jump
  await toggle(pop, "Alpha Media");
  await row(pop, "Alpha Media").locator(".lbm-go").click();
  ok("'Show ad accounts →' opens the Ad accounts tab", await until(pop, () => document.querySelector(".tab.active")?.dataset.tab === "accounts" && document.querySelector("#tab-accounts").classList.contains("active")));
  const listText = async () => clean(await text(pop, "#accountsList"));
  ok("…showing only that business's ad accounts (A one, A two, A three), no new request", (await until(pop, () => /A one/.test(document.querySelector("#accountsList").textContent))) && accHits(b).length === 1
    && /A two/.test(await listText()) && /A three/.test(await listText()) && !/B one|D one|Solo|P one/.test(await listText()), await listText());
  ok("…with the business named on the filter row (no 'BM' wording)", has(await text(pop, "#tab-accounts"), "Alpha Media") && !/\bBM\b/.test(await text(pop, "#statusChips")), await text(pop, "#statusChips"));
  ok("…keyboard focus moved to the Accounts tab button (the control that asked for the jump is gone with its tab)", await pop.evaluate(() => document.activeElement?.id === "tabbtn-accounts"), await pop.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
  ok("…the business chip's accessible name says what pressing it does", await pop.evaluate(() => { const c = document.querySelector("#statusChips .chip"); return c.getAttribute("aria-label") === "Alpha Media: Show ad accounts of every business" && c.getAttribute("aria-pressed") === "true"; }), await pop.evaluate(() => document.querySelector("#statusChips .chip")?.getAttribute("aria-label")));
  await pop.click('[data-tab="bms"]');
  await toggle(pop, "Beta Ads");
  await row(pop, "Beta Ads").locator(".lbm-go").click();
  ok("Beta's button filters the Ad accounts tab to Beta's one account", (await until(pop, () => document.querySelector(".tab.active")?.dataset.tab === "accounts"))
    && (await until(pop, () => /B one/.test(document.querySelector("#accountsList").textContent) && !/A one/.test(document.querySelector("#accountsList").textContent))), await listText());
  await pop.click('[data-tab="bms"]');
  noErrs(b);
  await b.ctx.close();

  // the Ad accounts list could not be loaded: no verdicts, no numbers, but a way in
  const b2 = await boot({ fb: adsFb(TOK), graph: graphFor({ onAccs: () => ({ status: 500, body: { error: { code: 1, message: "boom" } } }) }) });
  await adsPage(b2);
  const p2 = await popup(b2, "bms");
  ok("rows load", await rowsAre(p2, ROW, 5));
  await p2.waitForTimeout(700);
  ok("without the Ad accounts list: no state word, no count, a muted dash for every amount, no 'No ad accounts' (only the failed verification shows)",
    (await p2.locator("#bmsList .lrow-ctx").count()) === 0 && (await p2.locator("#bmsList .lrow-value.muted").count()) === 5 && (await p2.locator("#bmsList .lrow-status").allInnerTexts()).join() === "Unverified" && !/No ad accounts/.test(await text(p2, "#bmsList")));
  await toggle(p2, "Alpha Media");
  const e2 = await bodyOf(p2, "Alpha Media");
  ok("…but the way in stays: the body has the 'Show ad accounts →' button (the Ad accounts tab loads by itself)", e2.go?.text === "Show ad accounts →" && e2.kv[0].join(": ") === "Ad accounts: Show ad accounts →", JSON.stringify(e2));
  await row(p2, "Alpha Media").locator(".lbm-go").click();
  ok("the click opens the Ad accounts tab filtered to that business", (await until(p2, () => document.querySelector(".tab.active")?.dataset.tab === "accounts")) && has(await text(p2, "#tab-accounts"), "Alpha Media"));
  await b2.ctx.close();
}

// ---------- cache per FB user, other windows ----------
async function bmsCacheFlow() {
  console.log("\n# bms: cache and windows");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  const fb = await adsPage(b);
  let pop = await popup(b, "bms");
  ok("loaded for the first FB user", (await rowsAre(pop, ROW, 6)) && (await stored(pop, "owner")) === "1001" && !!(await stored(pop, "bmsAt")));
  pop = await popup(b);
  ok("reopen keeps the rows (cache per FB user)", (await rowsAre(pop, ROW, 6)) && bmHits(b).length === 1);
  await fb.close(); pop = await popup(b);
  ok("no FB tab: the cache stays, nothing sent", (await rowsAre(pop, ROW, 6)) && bmHits(b).length === 1);
  const c0 = bmHits(b).length; await resetLocks(pop); await clickToast(pop, "#loadBms");
  ok("refresh without a token sends nothing", bmHits(b).length === c0);
  await b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }]);
  pop = await popup(b);
  ok("another FB user: the cache is dropped", (await rowsAre(pop, ROW, 0)) && (await until(pop, () => chrome.storage.session.get(["bms", "bmsAt", "bmsTruncated"]).then((o) => !o.bms && !o.bmsAt && !o.bmsTruncated))));
  await adsPage(b); await resetLocks(pop);
  pop = await popup(b); await rowsAre(pop, ROW, 6);
  ok("…and the tab loads again for the new user", bmHits(b).length === 2 && (await stored(pop, "owner")) === "2002", `${bmHits(b).length} ${await stored(pop, "owner")}`);

  // another window of the extension fills or drops the list
  await pop.evaluate(() => chrome.storage.session.set({ bms: [{ id: "9001", name: "From another window" }], bmsAt: Date.now() - 120000, bmsTruncated: true }));
  ok("a list stored by another window shows up", (await until(pop, () => [...document.querySelectorAll("#bmsList .lrow-name")].some((n) => n.textContent === "From another window")))
    && has((await totalOfTab(pop)).meta, "(not all)"), JSON.stringify(await totalOfTab(pop)));
  await pop.evaluate(() => chrome.storage.session.remove(["bms", "bmsAt", "bmsTruncated"]));
  ok("…and its removal", await until(pop, () => ![...document.querySelectorAll("#bmsList .lrow-name")].some((n) => n.textContent === "From another window")));
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
  ok("…the list says why in the Token tab's own words with one 'Try again' button; no period, no total", (await text(pop, "#bmsList .lempty-text")) === (await text(pop, "#tokenBox")) && (await text(pop, "#bmsList .lempty .btn")) === "Try again"
    && (await pop.evaluate(() => ["#bmsPeriod", "#bmsTotal"].every((s) => getComputedStyle(document.querySelector(s)).display === "none"))), await text(pop, "#bmsList"));
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
  ok("…then the rows", await rowsAre(pop, ROW, 6));
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
  ok("token changed mid-load: the old answer is dropped, no list stored", (await rowsAre(pop, ROW, 0)) && !(await stored(pop, "bmsAt")) && !has(await text(pop, "#bmsList"), "Loading"), `${await text(pop, "#bmsList")} ${await stored(pop, "bmsAt")}`);
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
  ok("two pages: both are read, the second by cursor", (await rowsAre(pop, ROW, 2)) && bmHits(b).length === 2 && has(bmHits(b)[1], "after=c1") && !has(bmHits(b)[0], "after="), bmHits(b).join(" | "));
  pages = 99;
  await resetLocks(pop);
  const toast = await clickToast(pop, "#loadBms");
  ok("an endless list stops after 4 pages and says so", (await rowsAre(pop, ROW, 4)) && bmHits(b).length === 6 && has(toast, "load limit"), `${bmHits(b).length} ${toast}`);
  ok("…the total line says the list is not complete", has((await totalOfTab(pop)).meta, "(not all)"), JSON.stringify(await totalOfTab(pop)));
  noErrs(b);
  await b.ctx.close();
}

// ---------- RU / EN ----------
async function bmsLangFlow() {
  console.log("\n# bms: language");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "bms");
  await rowsAre(pop, ROW, 6); await settled(pop);
  await pop.click('[data-lang="ru"]');
  ok("RU: the tab is 'Бизнесы', placeholder, refresh label, period buttons; no Copy IDs", (await text(pop, '[data-tab="bms"]')) === "Бизнесы" && (await pop.getAttribute("#bmFilter", "placeholder")) === "Поиск"
    && (await pop.getAttribute("#loadBms", "aria-label")) === "Обновить бизнесы и спенд" && (await pop.getAttribute("#bmFilter", "aria-label")) === "Поиск бизнесов" && !(await pop.locator("#copyBmIds").count())
    && (await pop.locator("#bmsPeriod .seg-btn").allTextContents()).join() === "Сегодня,Вчера,7 дней,30 дней,Всё время", `${await text(pop, '[data-tab="bms"]')} | ${(await pop.locator("#bmsPeriod .seg-btn").allTextContents()).join()}`);
  const t = await totalOfTab(pop);
  ok("RU: total line (Спенд · date, no count, the age is the refresh tooltip) and the converted total", /^Спенд · \d{2}\.\d{2}$/.test(t.label) && !t.meta && /^Обновить бизнесы и спенд · обновлено /.test(await pop.getAttribute("#loadBms", "title")) && /^≈ 227,00\s\$$/.test(t.value), JSON.stringify(t));
  const alpha = await rowOf(pop, "Alpha Media"), beta = await rowOf(pop, "Beta Ads"), gamma = await rowOf(pop, "Gamma Group"), eps = await rowOf(pop, "Epsilon Digital"), delta = await rowOf(pop, "Delta Co");
  ok("RU: context '3 кабинета · 1 заблокирован', the amounts in Russian format (2 currencies exact, 3 ≈)", alpha.ctx.join("|") === "3 кабинета · 1 заблокирован" && /^100,00\s\$ \+ 50,00\s€$/.test(alpha.value) && /^≈ 47,50\s\$$/.test(delta.value) && alpha.sr === "Активен", JSON.stringify([alpha.ctx, alpha.value, delta.value]));
  ok("RU: the problem words and fixes — Не верифицирован → Верификация (ещё 1), Нет кабинетов → Создать кабинет, Нет активных", beta.status.text === "Не верифицирован" && beta.fix.text === "Верификация" && beta.more === "ещё 1" && gamma.status.text === "Нет кабинетов" && gamma.fix.text === "Создать кабинет" && eps.status.text === "Нет активных" && eps.ctx.join("|") === "2 кабинета · 1 заблокирован", JSON.stringify([beta, gamma, eps].map((r) => [r.status?.text, r.fix?.text, r.ctx])));
  await toggle(pop, "Beta Ads");
  const bb = await bodyOf(pop, "Beta Ads");
  ok("RU: the expanded row (Кабинеты, Верификация: Не удалась, Что делать, Настройки бизнеса, the button)", bb.kv[0].join(": ") === "Кабинеты: 1 · 1 заблокирован Показать кабинеты →" && bb.kv[1].join(": ") === "Верификация: Не удалась" && bb.todo.title === "Что делать" && has(bb.todo.help, "Пройди верификацию бизнеса заново.") && bb.links[0].text === "Настройки бизнеса", JSON.stringify(bb));
  ok("RU: no 'BM' / 'БМ' anywhere in the tab", await pop.evaluate(() => !/(^|[^\p{L}])(BM|БМ)(?![\p{L}])/u.test(document.querySelector("#tab-bms").innerText + [...document.querySelectorAll("#tab-bms [title], #tab-bms [aria-label]")].map((n) => n.title + n.getAttribute("aria-label")).join())));
  await toggle(pop, "Beta Ads");
  await pop.fill("#bmFilter", "zzz");
  ok("RU: nothing found", has(await text(pop, "#bmsList"), "Ничего не найдено"));
  await pop.fill("#bmFilter", "");
  await pop.click('[data-lang="en"]');
  ok("back to English everywhere", await until(pop, () => /^Spend · /.test(document.querySelector("#bmsTotal .total-label").textContent.trim()) && /^Refresh businesses and spend · updated/.test(document.querySelector("#loadBms").title) && /Unverified/.test(document.querySelector("#bmsList").textContent)
    && document.querySelector("#bmFilter").placeholder === "Search" && document.querySelector('[data-tab="bms"]').textContent.trim() === "Businesses"));
  noErrs(b);
  await b.ctx.close();
}

// ---------- the picture, the fix links, copy, keyboard ----------
async function bmsRowsFlow() {
  console.log("\n# bms: picture or placeholder, links, copy, keyboard");
  const asked = [];
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(), rates: ratesOk });
  b.ctx.on("request", (r) => asked.push({ url: r.url(), referer: r.headers().referer }));
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("rows", await rowsAre(pop, ROW, 6));
  const av = (name) => pop.evaluate(([sel, n]) => {
    const r = [...document.querySelectorAll(sel)].find((x) => x.querySelector(".lrow-name").textContent === n);
    const box = r.querySelector(".lav"), img = box.querySelector("img"), icon = box.querySelector(".i"), cs = getComputedStyle(box);
    return { cls: box.className, ariaHidden: box.getAttribute("aria-hidden"), w: box.offsetWidth, h: box.offsetHeight, radius: cs.borderRadius, color: cs.color, bg: cs.backgroundColor,
      img: img && { src: img.getAttribute("src"), rp: img.getAttribute("referrerpolicy"), loading: img.getAttribute("loading"), decoding: img.getAttribute("decoding"), alt: img.getAttribute("alt"), w: img.getAttribute("width"), h: img.getAttribute("height"), natural: img.naturalWidth },
      icon: icon && { cls: icon.className, visible: getComputedStyle(icon).visibility, mask: getComputedStyle(icon).maskImage || getComputedStyle(icon).webkitMaskImage } };
  }, [ROW, name]);
  await until(pop, () => [...document.querySelectorAll("#bmsList .lrow")].some((r) => r.querySelector(".lrow-name").textContent === "Alpha Media" && r.querySelector(".lav.ok")));
  const alpha = await av("Alpha Media");
  ok("Alpha: the logo URL on fbcdn.net renders an <img> in a 24 px rounded square (5 px)", !!alpha.img && alpha.img.src === PIC && alpha.w === 24 && alpha.h === 24 && /lav-square/.test(alpha.cls) && alpha.radius === "5px", JSON.stringify(alpha));
  ok("…decorative (alt empty, aria-hidden), no referrer, lazy, async, width and height set", alpha.img.alt === "" && alpha.ariaHidden === "true" && alpha.img.rp === "no-referrer" && alpha.img.loading === "lazy" && alpha.img.decoding === "async" && alpha.img.w === "24" && alpha.img.h === "24", JSON.stringify(alpha.img));
  ok("…it loaded (the placeholder icon is hidden behind it) and the request carried no Referer", alpha.img.natural > 0 && alpha.icon.visible === "hidden" && asked.find((r) => r.url === PIC)?.referer === undefined, JSON.stringify(asked.find((r) => r.url === PIC)));
  const beta = await av("Beta Ads");
  ok("Beta: a logo URL on another host is never kept: the Lucide building on a muted 24 px square in the secondary text colour, no <img>, no request to that host",
    !beta.img && beta.icon?.cls === "i i-building" && beta.icon.visible === "visible" && has(beta.icon.mask, "building-2.svg") && beta.w === 24 && beta.h === 24 && beta.color === "rgb(96, 103, 112)" && beta.bg === "rgb(240, 242, 245)"
    && !asked.some((r) => /evil\.example\.com/.test(r.url)), JSON.stringify(beta));
  ok("Gamma: a logo that fails to load (404) falls back to the same placeholder, the broken <img> is gone", await until(pop, () => { const r = [...document.querySelectorAll("#bmsList .lrow")].find((x) => x.querySelector(".lrow-name").textContent === "Gamma Group"); const box = r?.querySelector(".lav"); return !!box && !box.querySelector("img") && !box.classList.contains("ok"); })
    && b.images.some((x) => /broken_50/.test(x)) && (await av("Gamma Group")).icon?.cls === "i i-building" && (await av("Gamma Group")).icon.visible === "visible");
  ok("Partner (no logo field at all): the placeholder", !(await av("Partner Agency")).img && (await av("Partner Agency")).icon?.cls === "i i-building");
  const failed = b.images.filter((x) => /broken_50/.test(x)).length;
  await pop.fill("#bmFilter", "a"); await pop.fill("#bmFilter", "");
  await rowsAre(pop, ROW, 6); await pop.waitForTimeout(300);
  ok("a redraw does not ask again for a logo that failed, and keeps the one that loaded", b.images.filter((x) => /broken_50/.test(x)).length === failed && (await av("Alpha Media")).img?.src === PIC && !(await av("Gamma Group")).img);

  // fix links: the right URL, a new tab, nothing sent, nothing toggled, keyboard
  await settled(pop);
  const hits0 = b.hits.length;
  const clickOpens = async (act) => {
    const [np] = await Promise.all([b.ctx.waitForEvent("page", { timeout: 8000 }), act()]);
    await np.waitForURL(/facebook\.com/, { timeout: 8000 }).catch(() => {});
    const url = np.url(); await np.close(); return url;
  };
  const fix = (id) => pop.locator(`[data-focus="rowfix:bm-${id}"]`);
  ok("'Verify' opens the business's Security page", (await clickOpens(() => fix("1002").click())) === LINKS.bmSecurity("1002"));
  ok("'Create account' opens the business's Ad accounts page in Business Settings", (await clickOpens(() => fix("1003").click())) === LINKS.bmAdAccounts("1003"));
  ok("…Enter on a focused fix link does the same (keyboard)", (await clickOpens(async () => { await fix("1002").focus(); await pop.keyboard.press("Enter"); })) === LINKS.bmSecurity("1002"));
  ok("a fix link never opens or closes its row, and sends nothing to Graph", (await pop.locator("#bmsList .lrow.open").count()) === 0 && b.hits.length === hits0, `${await pop.locator("#bmsList .lrow.open").count()} / ${b.hits.length - hits0}`);
  await toggle(pop, "Alpha Media");
  ok("Business settings (in the body) opens that business's settings", (await clickOpens(() => pop.locator('[data-focus="bm-link:1001:settings"]').click())) === LINKS.bmSettings("1001"));
  await toggle(pop, "Alpha Media");
  ok("the tab did not change and the list is the same after the clicks", (await pop.evaluate(() => document.querySelector(".tab.active").dataset.tab)) === "bms" && (await rowsAre(pop, ROW, 6)));

  // keyboard: the name is the one button of a row; Enter / Space open it; the button of the body works from the keyboard too
  ok("every control of a row is reachable by keyboard (buttons and links, no bare divs); the copy icon of a collapsed row is for the mouse", await pop.evaluate(() => [...document.querySelectorAll("#bmsList .lrow [data-focus]")].every((n) => ["BUTTON", "A"].includes(n.tagName) && (n.tabIndex >= 0 || n.classList.contains("lrow-id")))));
  await pop.focus('[data-focus="row:bm-1004"]'); await pop.keyboard.press("Enter");
  ok("Enter on the focused name opens the row (aria-expanded, the body)", await pop.evaluate(() => document.querySelector('[data-focus="row:bm-1004"]').getAttribute("aria-expanded") === "true" && !!document.querySelector('#bmsList .lrow[data-row="bm-1004"] .lrow-body')));
  ok("…the keyboard focus survives a redraw (period switch by Enter on a period button, then back to the row)", await (async () => {
    await pop.focus('[data-focus="bm-period:week"]'); await pop.keyboard.press("Enter");
    await pop.focus('[data-focus="row:bm-1004"]'); await pop.keyboard.press("Enter");
    await pop.keyboard.press("Space");
    return pop.evaluate(() => document.activeElement?.dataset.focus === "row:bm-1004");
  })());
  await pop.click('#bmsPeriod .seg-btn:has-text("Today")');
  await pop.focus('[data-focus="row:bm-1001"]'); await pop.keyboard.press("Enter");
  await pop.focus('[data-focus="bm-go:1001"]'); await pop.keyboard.press("Enter");
  ok("…'Show ad accounts →' works from the keyboard too (opens the Ad accounts tab, filtered); focus lands on the tab's button", await until(pop, () => document.querySelector(".tab.active")?.dataset.tab === "accounts" && /Alpha Media/.test(document.querySelector("#tab-accounts").textContent)
    && document.activeElement?.id === "tabbtn-accounts"));
  await pop.click('[data-tab="bms"]');

  // copy: the ID button copies that one ID and does not open the row; there is no Copy IDs
  await captureClipboard(pop);
  await row(pop, "Gamma Group").locator(".lrow-head .lrow-id").click();
  ok("the ID button copies that one ID; the row stays closed, the icon turns into ✓, no toast", (await clip(pop)).at(-1) === "1003" && !(await rowOf(pop, "Gamma Group")).open && (await row(pop, "Gamma Group").locator(".lrow-head .lrow-id .i-tick").count()) === 1 && (await toastOf(pop)) === "", `${JSON.stringify(await clip(pop))} ${await toastOf(pop)}`);
  ok("there is no Copy IDs button and nothing else on the tab copies a list", (await pop.locator("#copyBmIds").count()) === 0 && !has(await text(pop, "#tab-bms"), "Copy IDs"));
  noErrs(b);
  await b.ctx.close();
}

// ---------- layout: nothing sticks out at 560 and 380, in both languages ----------
async function bmsLayoutFlow() {
  console.log("\n# bms: layout, many rows and long names");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor(), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("rows", await rowsAre(pop, ROW, 6));
  await settled(pop);
  await toggle(pop, "Beta Ads");                           // one open row: the widest body (two problems)
  for (const lang of ["en", "ru"]) {
    await pop.click(`[data-lang="${lang}"]`);
    for (const w of [560, 380]) {
      await pop.setViewportSize({ width: w, height: 900 }); await pop.waitForTimeout(150);
      const m = await pop.evaluate(() => {
        const de = document.documentElement, r = (n) => n.getBoundingClientRect(), rows = [...document.querySelectorAll("#bmsList .lrow")];
        return { sw: de.scrollWidth, cw: de.clientWidth, rowsOver: rows.filter((x) => x.scrollWidth > x.clientWidth + 0.5).length,
          outside: rows.flatMap((x) => [...x.querySelectorAll(".lrow-head .lrow-fix, .lrow-value, .lrow-idc, .lav")].filter((n) => n.offsetWidth > 0 && (r(n).right > r(x).right - 15.5 || r(n).left < r(x).left + 15.5))).length,
          subWrap: rows.filter((x) => { const s = x.querySelector(".lrow-sub"); return s && r(s).height > 24; }).length, subCut: rows.filter((x) => { const s = x.querySelector(".lrow-sub"); return s && s.scrollWidth > s.clientWidth + 1; }).length,
          cut: [...document.querySelectorAll("#bmsList .lrow-fix .act-label")].filter((l) => l.scrollWidth > l.clientWidth).length,
          bodyOver: [...document.querySelectorAll("#bmsList .lrow-body")].filter((x) => x.scrollWidth > x.clientWidth + 0.5).length, tabsCut: [...document.querySelectorAll(".tab")].filter((t) => t.scrollWidth > t.clientWidth).length,
          idHidden: getComputedStyle(document.querySelector("#bmsList .lrow-idc")).display === "none", heights: [...new Set(rows.map((x) => Math.round(r(x.querySelector(".lrow-head")).height)))].sort() };
      });
      ok(`${lang} ${w}px: no horizontal scroll, no row or body wider than the window`, m.sw <= m.cw && m.rowsOver === 0 && m.bodyOver === 0, JSON.stringify(m));
      ok(`${lang} ${w}px: every fix, amount, ID and picture stays inside the 16 px gutters; line 2 never wraps or clips; no fix label is cut; no tab label is cut`, m.outside === 0 && m.subWrap === 0 && m.subCut === 0 && m.cut === 0 && m.tabsCut === 0, JSON.stringify(m));
      ok(`${lang} ${w}px: the ID ${w < 480 ? "is hidden on collapsed rows" : "is shown on collapsed rows"}; collapsed rows are two lines (≤ 68 px)`, m.idHidden === (w < 480) && m.heights.every((h) => h <= 68), JSON.stringify(m));
      if (SHOT) await pop.screenshot({ path: path.join(SHOT, `p4-bms-${lang}${w === 380 ? "-380" : ""}.png`), fullPage: true });
    }
  }
  await pop.setViewportSize({ width: 560, height: 900 });
  noErrs(b);
  await b.ctx.close();

  // many rows and long names
  const many = Array.from({ length: 30 }, (_, i) => bm(String(5000 + i), i % 3 ? `Business ${i}` : `A very long business name that has to end in an ellipsis instead of pushing the amount out ${i}`,
    { verification_status: ["verified", "pending_need_more_info", "revoked"][i % 3] }));
  const accounts = { data: many.slice(0, 20).map((x, i) => acc(String(700 + i), `Acc ${i}`, i % 4 ? 1 : 2, [x.id, x.name], i % 2 ? "EUR" : "USD", [i * 3 + 1, 1, 1, 1], 10)) };
  const b2 = await boot({ fb: adsFb(TOK), graph: graphFor({ rows: many, accounts }) });
  await adsPage(b2);
  const p2 = await popup(b2, "bms");
  ok("30 rows", await rowsAre(p2, ROW, 30));
  await until(p2, () => document.querySelectorAll("#bmsList .lrow-ctx").length >= 20);
  ok("no horizontal overflow at 560 px (page and every row)", await p2.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    && [...document.querySelectorAll("#bmsList .lrow")].every((r) => r.scrollWidth <= r.clientWidth)), await p2.evaluate(() => `${document.documentElement.scrollWidth}/${document.documentElement.clientWidth}`));
  await p2.setViewportSize({ width: 380, height: 900 }); await p2.waitForTimeout(150);
  ok("…and none at 380 px", await p2.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && [...document.querySelectorAll("#bmsList .lrow")].every((r) => r.scrollWidth <= r.clientWidth)), await p2.evaluate(() => `${document.documentElement.scrollWidth}/${document.documentElement.clientWidth}`));
  await p2.setViewportSize({ width: 560, height: 900 });
  ok("a long name is cut with an ellipsis (the full one is the tooltip)", await p2.evaluate(() => { const n = [...document.querySelectorAll("#bmsList .lrow-name")].find((x) => x.textContent.startsWith("A very long")); return getComputedStyle(n).textOverflow === "ellipsis" && n.scrollWidth > n.clientWidth && !!n.closest(".lrow-title").title; }));
  ok("the controls stay in the card, the list below it", await p2.evaluate(() => document.querySelector("#bmsCard #bmFilter") && document.querySelector("#bmsCard #loadBms") && document.querySelector("#bmsCard #bmsPeriod") && document.querySelector("#bmsList").previousElementSibling.id === "bmsCard"));
  ok("the total of the 20 businesses with accounts (USD + EUR) is one converted or per-currency line, not a row's text", /^(≈ )?\$[\d,.]+( \+ €[\d,.]+)?$/.test((await totalOfTab(p2)).value), JSON.stringify(await totalOfTab(p2)));
  // focus survives a redraw: typing in the search, pressing a period button
  await p2.click("#bmFilter"); await p2.keyboard.type("Business");
  ok("typing in the search keeps the caret in the field", await p2.evaluate(() => document.activeElement.id === "bmFilter" && document.activeElement.value === "Business"));
  await p2.fill("#bmFilter", "");
  await p2.focus('#bmsPeriod [data-focus="bm-period:yesterday"]'); await p2.keyboard.press("Enter");
  ok("a period button pressed with the keyboard keeps focus after the redraw", await p2.evaluate(() => document.activeElement.dataset.focus === "bm-period:yesterday" && document.activeElement.getAttribute("aria-pressed") === "true"), await p2.evaluate(() => document.activeElement.outerHTML.slice(0, 120)));
  noErrs(b2);
  await b2.ctx.close();

  // businesses without any ad account and verified: the quiet case, one state each
  const b3 = await boot({ fb: adsFb(TOK), graph: graphFor({ rows: [bm("1", "One"), bm("2", "Two")], accounts: { data: [] } }) });
  await adsPage(b3);
  const p3 = await popup(b3, "bms");
  ok("two businesses, no ad accounts at all: both 'No ad accounts', each with its one fix, and a dash total", (await rowsAre(p3, ROW, 2)) && (await until(p3, () => document.querySelectorAll("#bmsList .lrow-status").length === 2))
    && (await p3.locator("#bmsList .lrow-fix").count()) === 2 && (await totalOfTab(p3)).value === "—", JSON.stringify(await totalOfTab(p3)));
  // no businesses at all
  const b4 = await boot({ fb: adsFb(TOK), graph: graphFor({ rows: [], accounts: { data: [] } }) });
  await adsPage(b4);
  const p4 = await popup(b4, "bms");
  ok("no businesses: says so", await until(p4, () => /No businesses/.test(document.querySelector("#bmsList").textContent)), await text(p4, "#bmsList"));
  const again = await popup(b4); await again.waitForTimeout(700);
  ok("…an empty list is a loaded list: reopening does not ask again", bmHits(b4).length === 1, String(bmHits(b4).length));
  await b3.ctx.close(); await b4.ctx.close();
}

// ---------- one business whose accounts could not be read ----------
// Its edges answer an error: ONLY that business loses its verdict (and says "couldn't read" in its body); the others keep theirs, and the
// list is not called "not all" for everybody because of it.
async function bmsUnreadFlow() {
  console.log("\n# bms: one business that could not be read");
  const g = graphFor();
  const refuse = { status: 400, body: { error: { code: 200, message: "(#200) Requires business_management permission" } } };
  const b = await boot({ fb: adsFb(TOK), graph: (u) => (/\/1003\/(owned|client)_ad_accounts$/.test(u.pathname) ? refuse : g(u)), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("six rows, as when everything is readable", await rowsAre(pop, ROW, 6));
  await until(pop, () => document.querySelectorAll("#bmsList .lrow-status, #bmsList .lrow-sub .sr-only").length >= 5, null, 8000);
  const gamma = await rowOf(pop, "Gamma Group"), beta = await rowOf(pop, "Beta Ads"), eps = await rowOf(pop, "Epsilon Digital"), alpha = await rowOf(pop, "Alpha Media");
  ok("Gamma (its edges were refused): no verdict at all — not 'No ad accounts', no fix, no state word for screen readers", gamma.status === null && gamma.sr === null && gamma.fixes === 0 && gamma.more === null, JSON.stringify(gamma));
  ok("…the other businesses keep theirs: Beta 'Unverified' (+1), Epsilon 'None active', Alpha silent and active", beta.status?.text === "Unverified" && eps.status?.text === "None active" && alpha.sr === "Active", JSON.stringify([beta.status, eps.status, alpha.sr]));
  const t0 = await totalOfTab(pop);
  ok("the total line does not say '(not all)': the list is not cut, one business could not be read", !t0.meta && t0.value === TODAY.total, JSON.stringify(t0));
  ok("…stored: not truncated, the one business named", (await stored(pop, "truncated")) === false && JSON.stringify(await stored(pop, "failedBms")) === '["1003"]', `${await stored(pop, "truncated")} ${JSON.stringify(await stored(pop, "failedBms"))}`);
  await toggle(pop, "Gamma Group");
  const gb = await pop.evaluate(() => { const r = [...document.querySelectorAll("#bmsList .lrow")].find((x) => x.querySelector(".lrow-name").textContent === "Gamma Group"); const n = r.querySelector(".lrow-note");
    return { note: n?.textContent.trim() ?? null, color: n && getComputedStyle(n).color, size: n && getComputedStyle(n).fontSize, todo: !!r.querySelector(".lrow-todo") }; });
  ok("Gamma's body says, muted, that its ad accounts could not be read (12 px, secondary grey); no 'What to do' for a problem nobody can state", gb.note === "Couldn't read the ad accounts of this business — the list may be incomplete" && gb.color === "rgb(96, 103, 112)" && gb.size === "12px" && !gb.todo, JSON.stringify(gb));
  await toggle(pop, "Alpha Media");
  ok("…and only Gamma's: Alpha's body has no such line", await pop.evaluate(() => { const r = [...document.querySelectorAll("#bmsList .lrow")].find((x) => x.querySelector(".lrow-name").textContent === "Alpha Media"); return !!r.querySelector(".lrow-body") && !r.querySelector(".lrow-note"); }));
  await pop.click('[data-tab="accounts"]');
  ok("the Ad accounts tab says it under the list, once, and its count line stays clean", has(await text(pop, "#accountsList .acc-foot"), "Some businesses couldn't be read") && (await pop.locator("#accountsList .acc-foot").count()) === 1 && !(await text(pop, "#accountsTotal .total-meta")), await text(pop, "#accountsTotal"));
  noErrs(b);
  await b.ctx.close();
}

export const flows = { bms: bmsFlow, bmsUnread: bmsUnreadFlow, bmsSpend: bmsSpendFlow, bmsTruncated: bmsTruncatedFlow, bmsFields: bmsFieldsFlow, bmsPerm: bmsPermFlow, bmsAccounts: bmsAccountsFlow, bmsCache: bmsCacheFlow, bmsLimits: bmsLimitsFlow, bmsPaging: bmsPagingFlow, bmsLang: bmsLangFlow, bmsRows: bmsRowsFlow, bmsLayout: bmsLayoutFlow };
