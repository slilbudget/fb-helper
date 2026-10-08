// The shared loader of the three list tabs (js/list-loader.js) and the business-edge walk (js/biz-edges.js), through the real popup:
// an API pause / budget never burns the rate slot nor marks the FB page as loaded; the button and the panel say "busy" and are put back
// whatever happens; another window's list is taken over; a list loaded after the FB user changed drops the other lists; the Businesses refresh
// says when the Ad accounts slot is taken; a try without a token is not used up; another window's saved ads never replace an entry that is
// still being read; the caps and failures of the business edges. Graph is a mock (fictional data).
import { GRAPH, TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, accountsJson, isAds, adsFb, stored, ROW, boxWait, GONE } from "../harness.mjs";

const day = new Date().toISOString().slice(0, 10);
const PAGE = { id: "100000000000001", name: "Page One", is_published: true, tasks: ["ADVERTISE"], instagram_business_account: { id: "1", username: "p" }, promotion_eligible: true };
const BMS = { data: [{ id: "900", name: "Nova Media" }] };
const pathOf = (u) => u.pathname.replace(/^\/v[\d.]+\//, "/");
// Every list tab has data; the business edges are empty unless a test brings its own.
const baseGraph = (over = {}) => (u, n) => {
  const p = pathOf(u);
  if (over[p]) return over[p](u, n);
  if (p === "/me/adaccounts") return { body: accountsJson };
  if (p === "/me/businesses") return { body: BMS };
  if (p === "/me/accounts") return { body: { data: [PAGE] } };
  if (isAds(u)) return { body: { data: [{ id: "a1", name: "Ad", effective_status: "ACTIVE" }] } };
  return { body: { data: [] } };
};
const TABS = {
  accounts: { slot: "accounts", btn: "#loadAccounts", rows: "#accountsList .lrow", panel: "#tab-accounts", reads: (b) => b.hits.filter((h) => h.startsWith("/me/adaccounts")).length },
  bms: { slot: "bms", btn: "#loadBms", rows: "#bmsList .lrow", panel: "#tab-bms", reads: (b) => b.hits.filter((h) => h.startsWith("/me/businesses") && h.includes("limit=50")).length },
  pages: { slot: "pages", btn: "#loadPages", rows: "#pagesList .lrow", panel: "#tab-pages", reads: (b) => b.hits.filter((h) => h.startsWith("/me/accounts")).length },
};
const slotsOf = (p) => p.evaluate(() => chrome.storage.session.get("locks").then((o) => Object.keys(o.locks?.slots || {})));
const toastOf = (p) => p.evaluate(() => document.querySelector("#toast").textContent.trim());
const noErrs = (b) => ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
const idle = (p, panel) => until(p, (sel) => !document.querySelector(sel).dataset.loading, panel);

// ---------- a pause refuses before the slot, in every tab ----------
async function pauseFlow() {
  console.log("\n# loader: an API pause or a spent budget never burns the rate slot");
  for (const [name, t] of Object.entries(TABS)) {
    const b = await boot({ fb: adsFb(TOK), graph: baseGraph() });
    await adsPage(b);
    let pop = await popup(b);
    await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 10 * 60000 }));
    await pop.reload();
    await pop.click(`[data-tab="${name}"]`); await pop.waitForTimeout(700);
    ok(`${name}: during the API pause the automatic load sends nothing, takes no slot, writes no "this FB page was loaded" mark, and stays quiet`,
      b.hits.length === 0 && !(await slotsOf(pop)).includes(t.slot) && (await stored(pop, "autoPage")) === undefined && (await toastOf(pop)) === "", `${b.hits.length} ${await slotsOf(pop)} ${await toastOf(pop)}`);
    const toast = await clickToast(pop, t.btn);
    ok(`${name}: a click says how long (a pause, not "refresh available in N s"), sends nothing and takes no slot`,
      /hands off for another (9|10) min/.test(toast) && b.hits.length === 0 && !(await slotsOf(pop)).includes(t.slot), `${toast} ${b.hits.length} ${await slotsOf(pop)}`);
    ok(`${name}: the button is back and the panel is idle`, !(await pop.$eval(t.btn, (n) => n.disabled || n.hasAttribute("aria-busy"))) && (await idle(pop, t.panel)));
    // the pause ends (another window cleared it): the very next click goes out — the slot was never spent
    await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: 0 }));
    await pop.waitForTimeout(200);
    await pop.click(t.btn);
    ok(`${name}: when the pause is over the same click loads the list`, await rowsAre(pop, t.rows, 1) || (name === "bms" && (await rowsAre(pop, t.rows, 1))), `${await text(pop, t.rows.split(" ")[0])}`);
    ok(`${name}: …and only now the slot is taken`, (await slotsOf(pop)).includes(t.slot));
    noErrs(b);
    await b.ctx.close();
  }

  // the hourly budget is a pause too: refused before the slot, an automatic load stays quiet, the FB page is not marked as loaded
  const b = await boot({ fb: adsFb(TOK), graph: baseGraph() });
  await adsPage(b);
  let pop = await popup(b);
  await pop.evaluate(() => chrome.storage.session.set({ budget: [[Date.now() - 20 * 60000, 600]] }));
  pop = await popup(b, "accounts");
  await pop.waitForTimeout(600);
  ok("budget used up: the automatic load sends nothing, takes no slot, marks nothing, and stays quiet", b.hits.length === 0 && !(await slotsOf(pop)).includes("accounts") && (await stored(pop, "autoPage")) === undefined && (await toastOf(pop)) === "", `${b.hits.length} ${await toastOf(pop)}`);
  const toast = await clickToast(pop, "#loadAccounts");
  ok("a click says so calmly, with the minutes (the oldest bucket leaves the hour in about 40)", b.hits.length === 0 && /600 requests per hour/.test(toast) && /(39|40|41) min/.test(toast) && !(await slotsOf(pop)).includes("accounts"), `${b.hits.length} ${toast}`);
  await pop.evaluate(() => chrome.storage.session.set({ budget: [[Date.now() - 61 * 60000, 600]] }));
  await pop.click("#loadAccounts");
  ok("buckets older than an hour do not count: the refresh goes out", (await rowsAre(pop, ROW, 1)) && b.hits.length >= 1, String(b.hits.length));
  ok("…and only a request that really went out marks the FB page as loaded", (await stored(pop, "autoPage")) !== undefined);
  const used = (await stored(pop, "budget")) || [];
  ok("every request is counted in storage.session", used.reduce((n, [, c]) => n + c, 0) === b.hits.length, JSON.stringify(used) + " vs " + b.hits.length);
  noErrs(b);
  await b.ctx.close();
}

// ---------- the button and the panel while a load runs ----------
async function busyFlow() {
  console.log("\n# loader: busy button, idle marker, one load at a time");
  for (const [name, t] of Object.entries(TABS)) {
    for (const fail of [false, true]) {
      const p = { "/me/adaccounts": () => (fail ? { delay: 900, status: 500, body: { error: { code: 1, message: "boom" } } } : { delay: 900, body: accountsJson }) };
      p["/me/businesses"] = (u) => (u.searchParams.get("limit") === "51" ? { body: BMS } : fail ? { delay: 900, status: 500, body: { error: { code: 1, message: "boom" } } } : { delay: 900, body: BMS });
      p["/me/accounts"] = () => (fail ? { delay: 900, status: 500, body: { error: { code: 1, message: "boom" } } } : { delay: 900, body: { data: [PAGE] } });
      const b = await boot({ fb: adsFb(TOK), graph: baseGraph(p) });
      await adsPage(b);
      const pop = await popup(b, name);
      const mid = await until(pop, ([btn, panel]) => document.querySelector(btn).disabled && document.querySelector(btn).getAttribute("aria-busy") === "true" && document.querySelector(panel).dataset.loading === "true", [t.btn, t.panel]);
      ok(`${name}${fail ? " (fails)" : ""}: while loading the button is disabled with aria-busy and the panel carries data-loading`, mid);
      const reads = t.reads(b);
      await pop.click(t.btn, { force: true }).catch(() => {});
      await pop.waitForTimeout(250);
      ok(`${name}${fail ? " (fails)" : ""}: a forced click during the load neither doubles the request nor complains`, t.reads(b) === reads && !has(await toastOf(pop), "Refresh available") && !has(await toastOf(pop), "wait"), `${reads} -> ${t.reads(b)} ${await toastOf(pop)}`);
      ok(`${name}${fail ? " (fails)" : ""}: afterwards the button is enabled again, without aria-busy, and the panel is idle`, (await idle(pop, t.panel)) && !(await pop.$eval(t.btn, (n) => n.disabled || n.hasAttribute("aria-busy"))), await text(pop, t.btn));
      if (fail) ok(`${name} (fails): the error is shown`, await until(pop, () => /boom/.test(document.querySelector("#toast").textContent)), await toastOf(pop));
      else ok(`${name}: the list is there`, await rowsAre(pop, t.rows, 1));
      noErrs(b);
      await b.ctx.close();
    }
  }
}

// ---------- another window of the extension loaded a list: this one shows the same ----------
async function followFlow() {
  console.log("\n# loader: a list loaded in another window is taken over");
  for (const [name, t] of Object.entries(TABS)) {
    const b = await boot({ fb: adsFb(TOK), graph: baseGraph() });
    await adsPage(b);
    const watcher = await popup(b);                                          // window 2, on the Token tab, nothing loaded
    const loader = await popup(b, name);                                     // window 1 loads the list by itself
    ok(`${name}: window 1 loads its list`, await rowsAre(loader, t.rows, 1));
    const hits = b.hits.length;
    await watcher.click(`[data-tab="${name}"]`);
    ok(`${name}: window 2 shows the very same list without a request of its own`, (await rowsAre(watcher, t.rows, 1)) && b.hits.length === hits, `${hits} -> ${b.hits.length}`);
    // and a refresh in window 1 reaches window 2 while it is on the tab
    await resetLocks(loader);
    await loader.click(t.btn);
    await until(loader, (btn) => !document.querySelector(btn).disabled, t.btn);
    ok(`${name}: window 2 is not disturbed by window 1's second load (still one list)`, await rowsAre(watcher, t.rows, 1));
    noErrs(b);
    await b.ctx.close();
  }
}

// ---------- the FB user changed while the popup was open: loading one list drops the others ----------
async function ownerFlow() {
  console.log("\n# loader: a load after the FB user changed drops every other list");
  const b = await boot({ fb: adsFb(TOK), graph: baseGraph() });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("accounts loaded for user 1001", await rowsAre(pop, ROW, 1));
  await pop.click('[data-tab="bms"]'); ok("businesses loaded", await rowsAre(pop, "#bmsList .lrow", 1) || (await until(pop, () => !!document.querySelector("#bmsList .lrow"))));
  await pop.click('[data-tab="pages"]'); ok("pages loaded", await rowsAre(pop, "#pagesList .lrow", 1));
  ok("all three caches are stored for 1001", !!(await stored(pop, "accounts")) && !!(await stored(pop, "bms")) && !!(await stored(pop, "pages")) && (await stored(pop, "owner")) === "1001");
  // another login in this profile while the popup stays open
  await b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }]);
  await pop.click('[data-tab="accounts"]');
  await resetLocks(pop);
  await pop.click("#loadAccounts");
  await until(pop, () => chrome.storage.session.get("owner").then((o) => o.owner === "2002"));
  await idle(pop, "#tab-accounts");
  ok("the accounts list is stored under 2002", (await stored(pop, "owner")) === "2002" && !!(await stored(pop, "accounts")));
  ok("…and the Businesses and Pages caches of the other login are gone, not stamped with the new user", (await stored(pop, "bms")) === undefined && (await stored(pop, "pages")) === undefined, JSON.stringify([await stored(pop, "bmsAt"), await stored(pop, "pagesAt")]));
  await pop.click('[data-tab="bms"]');
  ok("…the Businesses tab is empty again for the new user (the one automatic try of this popup was used up: it says to press refresh)", (await pop.locator("#bmsList .lrow").count()) === 0 && has(await text(pop, "#bmsList"), "press the refresh button"), await text(pop, "#bmsList"));
  noErrs(b);
  await b.ctx.close();
}

// ---------- the Businesses refresh says when the Ad accounts slot is taken ----------
async function waitFlow() {
  console.log("\n# loader: Businesses refresh and the Ad accounts slot");
  const b = await boot({ fb: adsFb(TOK), graph: baseGraph() });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("the Businesses tab loads (and the Ad accounts list with it)", await until(pop, () => !!document.querySelector("#bmsList .lrow")));
  await idle(pop, "#tab-bms");
  const accReads = () => b.hits.filter((h) => h.startsWith("/me/adaccounts")).length;
  const a0 = accReads(), own0 = TABS.bms.reads(b);
  // the Businesses slot is free, the Ad accounts slot is taken for another 45 s
  await pop.evaluate(() => chrome.storage.session.set({ locks: { slots: { accounts: Date.now() + 45000 } } }));
  await pop.waitForTimeout(200);
  await pop.click("#loadBms");
  for (let i = 0; i < 50 && TABS.bms.reads(b) < own0 + 1; i++) await pop.waitForTimeout(100);
  ok("the Businesses list refreshes (one request of its own)", TABS.bms.reads(b) === own0 + 1, `${own0} -> ${TABS.bms.reads(b)}`);
  ok("…and the toast says the Ad accounts are not refreshed yet (the spend is the old one), with the seconds left", await until(pop, () => /Ad accounts: refresh available in (4\d|3\d) s/.test(document.querySelector("#toast").textContent)), await toastOf(pop));
  ok("…no request went to the Ad accounts", accReads() === a0, `${a0} -> ${accReads()}`);
  // the refresh button's tooltip is the age of the BUSINESS list
  await pop.waitForTimeout(100);
  ok("the refresh tooltip says 'updated just now' for the business list", /^Refresh businesses and spend · updated (just now|\d+ min ago)$/.test(await pop.locator("#loadBms").getAttribute("title")), await pop.locator("#loadBms").getAttribute("title"));
  noErrs(b);
  await b.ctx.close();
}

// ---------- a try without a token is not used up ----------
async function tokenFlow() {
  console.log("\n# loader: no token yet, the automatic load is not used up");
  let withToken = false;
  for (const [name, t] of Object.entries(TABS)) {
    withToken = false;
    const b = await boot({ fb: (u) => adsFb(withToken ? TOK : null)(u), graph: baseGraph() });
    const feed = await b.ctx.newPage(); await feed.goto("https://www.facebook.com/");
    const pop = await popup(b, name);
    await pop.waitForTimeout(500);
    ok(`${name}: no token anywhere: nothing is sent, the list says what to do`, b.hits.length === 0 && (await boxWait(pop, GONE)), `${b.hits.length} ${await text(pop, "#tokenBox")}`);
    withToken = true;
    await feed.close();
    await adsPage(b);                                                       // an Ads Manager tab with a token appears
    await pop.click('[data-tab="token"]'); await pop.click("#refreshToken");
    ok(`${name}: the token is read from the new tab`, await until(pop, () => /^EAA/.test(document.querySelector("#tokenBox").textContent.trim())));
    await pop.click(`[data-tab="${name}"]`);
    ok(`${name}: showing the tab again loads the list by itself (the first visit did not use up the one try)`, await rowsAre(pop, t.rows, 1) && t.reads(b) >= 1, `${t.reads(b)}`);
    noErrs(b);
    await b.ctx.close();
  }
}

// ---------- another window's saved ads never replace an entry that is still being read ----------
async function flightFlow() {
  console.log("\n# loader: ads in flight survive another window's list");
  const ins = (spend) => ({ data: [{ spend: String(spend), impressions: "100", inline_link_clicks: "10", date_start: day, date_stop: day }] });
  const acc = { account_id: "111", name: "Acc A", account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: "500", p_today: ins(1) };
  const b = await boot({ fb: adsFb(TOK), graph: baseGraph({
    "/me/adaccounts": () => ({ body: { data: [acc] } }),
    "/act_111/ads": (u) => ((u.searchParams.get("fields") || "").includes("p_today") ? { delay: 2200, body: { data: [{ id: "a1", p_today: ins(12.4), p_yesterday: ins(0), p_week: ins(0), p_month: ins(0), p_all: ins(12.4) }] } } : { body: { data: [{ id: "a1", name: "Ad one", effective_status: "ACTIVE" }] } }),
  }) });
  await adsPage(b);
  const pop1 = await popup(b, "accounts");
  ok("window 1: the account is listed", await rowsAre(pop1, ROW, 1));
  await pop1.click(`${ROW} .lrow-title`); await pop1.click(`${ROW}.open [data-ads]`);
  ok("window 1: the ads list is on screen while the numbers are still being read", await until(pop1, () => /Ad one/.test(document.querySelector("#accountsList .lrow.open .ads")?.textContent || "") && /Loading metrics/.test(document.querySelector("#accountsList .lrow.open .ads")?.textContent || "")));
  // window 2 loads the account list again: window 1 follows the new list (fetchedAt changes)
  const pop2 = await popup(b, "accounts");
  await resetLocks(pop2);
  await pop2.click("#loadAccounts");
  ok("window 2 refreshes the list", await until(pop2, () => !document.querySelector("#loadAccounts").disabled) && (await stored(pop2, "fetchedAt")) > 0);
  await pop1.waitForTimeout(400);
  ok("window 1 still shows its ads while the numbers load (the saved copy of the other window did not replace the entry)", has(await text(pop1, "#accountsList .lrow.open .ads"), "Ad one"), await text(pop1, "#accountsList .lrow.open .ads"));
  ok("…and the numbers arrive: the entry they were meant for is still the one on screen", await until(pop1, () => /metrics updated/.test(document.querySelector("#accountsList .lrow.open .ads")?.textContent || ""), null, 12000) && has(await text(pop1, ".ad"), "$12.40"), await text(pop1, "#accountsList .lrow.open .ads"));
  noErrs(b);
  await b.ctx.close();
}

// ---------- the business edges of the Ad accounts list: caps and failures ----------
async function edgesFlow() {
  console.log("\n# loader: business edges of the Ad accounts list");
  const acc = (id, biz) => ({ account_id: id, name: `Acc ${id}`, account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: "100", business: { id: biz, name: `BM ${biz}` } });
  const edgeHits = (b) => b.hits.filter((h) => /^\/\d+\/(owned|client)_ad_accounts/.test(h));
  const bm = (n) => Array.from({ length: n }, (_, i) => ({ id: String(1000 + i), name: `BM ${1000 + i}` }));

  // 60 businesses: the read asks for 51, only 50 are walked (2 edges each), the answer says it is not all
  let b = await boot({ fb: adsFb(TOK), graph: baseGraph({
    "/me/businesses": (u) => ({ body: { data: bm(60).slice(0, Number(u.searchParams.get("limit"))) } }),
    "/me/adaccounts": () => ({ body: { data: [acc("1", "1000")] } }),
  }) });
  await adsPage(b);
  let pop = await popup(b, "accounts");
  ok("60 businesses: the list loads", await rowsAre(pop, ROW, 1));
  await idle(pop, "#tab-accounts");
  const bmRead = b.hits.find((h) => h.startsWith("/me/businesses"));
  ok("…the business list is asked with limit 51 (one over the cap of 50) and only id,name", has(bmRead, "limit=51") && has(decodeURIComponent(bmRead), "fields=id,name") && !has(decodeURIComponent(bmRead), "fields=id,name,"), bmRead);
  ok("…only 50 businesses are walked: 100 edge requests, none for the 51st", edgeHits(b).length === 100 && !edgeHits(b).some((h) => h.startsWith("/1050/")), String(edgeHits(b).length));
  ok("…and the list is stored as not complete", (await stored(pop, "truncated")) === true);
  ok("…the count line says so", has(await text(pop, "#accountsTotal .total-meta"), "(not all)"), await text(pop, "#accountsTotal"));
  await b.ctx.close();

  // an edge that answers an error: that business is named (failedBms), the rest of the list is whole, a click says why, the automatic load is silent
  b = await boot({ fb: adsFb(TOK), graph: baseGraph({
    "/me/businesses": () => ({ body: { data: bm(2) } }),
    "/me/adaccounts": () => ({ body: { data: [acc("1", "1000")] } }),
    "/1001/owned_ad_accounts": () => ({ status: 400, body: { error: { code: 200, message: "(#200) Requires business_management permission" } } }),
    "/1000/client_ad_accounts": () => ({ body: { data: [acc("7", "5555")] } }),
  }) });
  await adsPage(b);
  pop = await popup(b, "accounts");
  ok("a refused edge: the rest of the list stays (the assigned account and the one read through the other edge)", await rowsAre(pop, ROW, 2));
  await idle(pop, "#tab-accounts");
  ok("…the automatic load says nothing about it", (await toastOf(pop)) === "", await toastOf(pop));
  ok("…the refused business is NAMED (failedBms), not the whole list called incomplete: not stored as truncated, no 'not all' on the count line", (await stored(pop, "truncated")) === false
    && JSON.stringify(await stored(pop, "failedBms")) === '["1001"]' && (await text(pop, "#accountsTotal .total-meta")) === null, `${await stored(pop, "truncated")} ${JSON.stringify(await stored(pop, "failedBms"))} ${await text(pop, "#accountsTotal")}`);
  ok("…one muted line under the list says some businesses could not be read (their accounts may be missing)", has(await text(pop, "#accountsList .acc-foot"), "Some businesses couldn't be read, so their ad accounts may be missing"), await text(pop, "#accountsList"));
  await resetLocks(pop);
  const toast = await clickToast(pop, "#loadAccounts");
  ok("a click says why: how many businesses could not be read", await until(pop, () => /Ad accounts: 2 \(couldn't read 1 business\)/.test(document.querySelector("#toast").textContent)), toast);
  noErrs(b);
  await b.ctx.close();

  // an edge with endless pages: 3 pages, then it stops
  b = await boot({ fb: adsFb(TOK), graph: baseGraph({
    "/me/businesses": () => ({ body: { data: bm(1) } }),
    "/me/adaccounts": () => ({ body: { data: [acc("1", "1000")] } }),
    "/1000/owned_ad_accounts": (u) => { const n = Number((u.searchParams.get("after") || "c0").slice(1)) + 1; return { body: { data: [acc(String(100 + n), "1000")], paging: { next: `${GRAPH}/n`, cursors: { after: `c${n}` } } } }; },
  }) });
  await adsPage(b);
  pop = await popup(b, "accounts");
  ok("an endless edge: three pages are read (4 rows with the assigned one), no more", await rowsAre(pop, ROW, 4) && edgeHits(b).filter((h) => h.startsWith("/1000/owned_ad_accounts")).length === 3, String(edgeHits(b).length));
  ok("…and the list says it is not all (a page limit is a real limit: truncated for everybody, no business is 'unread')", (await stored(pop, "truncated")) === true && JSON.stringify(await stored(pop, "failedBms")) === "[]");
  await b.ctx.close();

  // the business list itself cannot be read: nothing was walked, no business can be named, so the whole list is "not all" (the global flag stays for this)
  b = await boot({ fb: adsFb(TOK), graph: baseGraph({
    "/me/businesses": () => ({ status: 400, body: { error: { code: 200, message: "(#200) Requires business_management permission" } } }),
    "/me/adaccounts": () => ({ body: { data: [acc("1", "1000")] } }),
  }) });
  await adsPage(b);
  pop = await popup(b, "accounts");
  await rowsAre(pop, ROW, 1); await idle(pop, "#tab-accounts");
  ok("an unreadable business list: stored as truncated with no business named, and the count line says 'not all'", (await stored(pop, "truncated")) === true && JSON.stringify(await stored(pop, "failedBms")) === "[]"
    && has(await text(pop, "#accountsTotal .total-meta"), "(not all)") && (await pop.locator("#accountsList .acc-foot").count()) === 0, `${await stored(pop, "truncated")} ${await text(pop, "#accountsTotal")}`);
  await b.ctx.close();

  // a field refused on the first edge is not asked for again on the next ones (one skip set for the walk), and never reaches the assigned list's reads
  const refuseDeep = (u) => ((u.searchParams.get("fields") || "").includes("adspixels")
    ? { status: 400, body: { error: { code: 100, message: "(#100) Tried accessing nonexisting field (adspixels) on node type (AdAccount)" } } } : { body: { data: [] } });
  const edgeMocks = {};
  for (const id of ["1000", "1001", "1002"]) for (const e of ["owned", "client"]) edgeMocks[`/${id}/${e}_ad_accounts`] = refuseDeep;
  b = await boot({ fb: adsFb(TOK), graph: baseGraph({
    "/me/businesses": () => ({ body: { data: bm(3) } }),
    "/me/adaccounts": () => ({ body: { data: [acc("1", "1000")] } }),
    ...edgeMocks,
  }) });
  await adsPage(b);
  pop = await popup(b, "accounts");
  await rowsAre(pop, ROW, 1); await idle(pop, "#tab-accounts");
  const asked = edgeHits(b).map((h) => has(decodeURIComponent(h), "adspixels"));
  ok("six edges: only the first asked for the refused field (twice in all: refused, then without), the other five did not", edgeHits(b).length === 7 && asked.filter(Boolean).length === 1 && asked[0], `${edgeHits(b).length} ${asked}`);
  ok("…the assigned list's own read had asked for it and was not affected", has(decodeURIComponent(b.hits.find((h) => h.startsWith("/me/adaccounts"))), "adspixels"));
  noErrs(b);
  await b.ctx.close();
}

export const flows = { loaderPause: pauseFlow, loaderBusy: busyFlow, loaderFollow: followFlow, loaderOwner: ownerFlow, loaderWait: waitFlow, loaderToken: tokenFlow, loaderFlight: flightFlow, loaderEdges: edgesFlow };
