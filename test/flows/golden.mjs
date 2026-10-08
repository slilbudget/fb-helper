// GOLDEN WORDING: the English words of every tab, spelled out once, as a person reads them. Every other flow takes its strings from the extension itself
// (tr() in test/harness.mjs), so a reworded message cannot break forty tests; this is the ONE flow per tab that fails when the wording changes. It is meant
// to: when a text is changed on purpose, read the diff the failing check prints (got / want per key), then update the literal here. Fictional data.
import { TOK, ok, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, captureClipboard, accountsJson, isAds, adsFb, ROW, idle, done, autoDone, ratesOk, settle } from "../harness.mjs";
import { fixtures as bmsFx, graphFor as bmsGraph } from "./bms.mjs";
import { fixtures as pagesFx } from "./pages.mjs";

const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const dates = (s) => String(s).replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/g, "<date>");     // today's date is the clock's, not the wording's
const ages = (s) => String(s).replace(/updated (just now|\d+ (min|h) ago)/, "updated <age>");               // how old the list is: the clock's
const secs = (s) => String(s).replace(/\b\d+ (s|min)\b/g, "N $1");                    // "available in 57 s": the number is the clock's, not the wording's
// One check per topic: every key of `want` is compared with what the screen said; a failure names the keys that differ, with both texts.
function golden(name, got, want) {
  const bad = Object.keys({ ...want, ...got }).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
  ok(name, bad.length === 0, bad.map((k) => `\n    ${k}\n      got:  ${JSON.stringify(got[k])}\n      want: ${JSON.stringify(want[k])}`).join(""));
}
const pathOf = (u) => u.pathname.replace(/^\/v[\d.]+\//, "/");
// What a person sees of an element: its rendered text, one space between the parts.
const seen = (p, sel) => p.$$eval(sel, (ns) => ns.map((n) => n.innerText.replace(/\s+/g, " ").trim()));
const one = async (p, sel) => (await seen(p, sel))[0] ?? null;
const toast = async (p) => flat(await text(p, "#toast"));
const lampText = (p, list) => p.evaluate((sel) => { const e = document.querySelector(`${sel} .lempty`); return e && { kind: e.dataset.state, text: e.querySelector(".lempty-text")?.textContent, detail: e.querySelector(".lempty-detail")?.textContent ?? null, button: e.querySelector(".btn")?.textContent.trim() ?? null }; }, list);

// ---------- Token ----------
async function tokenWords() {
  console.log("\n# golden wording: Token");
  const me = { id: "1001", name: "Alex Carter" };
  const b = await boot({ fb: adsFb(TOK), graph: (u) => ({ body: pathOf(u) === "/me" ? me : pathOf(u) === "/app" ? { id: "1111", name: "Ads Suite" } : pathOf(u) === "/me/permissions" ? { data: ["ads_read", "ads_management", "pages_show_list"].map((permission) => ({ permission, status: "granted" })) } : { data: [] } }) });
  await adsPage(b);
  const pop = await popup(b, "token");
  await captureClipboard(pop);
  await pop.evaluate(() => { document.querySelector(".guide").open = true; });
  golden("Token tab: the tabs, the buttons and their tooltips, the token types, the card of the token", {
    tabs: await seen(pop, ".tab"), buttons: await seen(pop, "#checkToken, #grabToken, #copyEnv"),
    tooltips: await pop.$$eval("#checkToken, #refreshToken", (ns) => ns.map((n) => n.title)),
    guide: await seen(pop, ".guide summary, .guide-row"), card: await one(pop, "#kindCard"),
    tablist: await pop.getAttribute('[role="tablist"]', "aria-label"),
  }, {
    tabs: ["Token", "Cookies", "Businesses", "Accounts", "Pages"],
    buttons: ["Check", "Copy token", "Token + cookies + UA"],
    tooltips: ["Profile, app and permissions of the token", "Re-read the token from the FB tab"],
    guide: ["Token types", "EAAB Ads Manager — the main ads token: launch and edit.", "EAAG Business Manager — business assets: pages, Instagram, leads, WhatsApp, catalogs and ads.",
      "EAAd Events Manager — events: pixels, datasets and tracking.", "EAAH Commerce Manager — catalogs: products and advanced management.", "EAAI Automated Rules — automated rules."],
    card: "EAAB Ads Manager The main ads token: launch and edit.",
    tablist: "Sections",
  });
  const said = { copyToken: await clickToast(pop, "#grabToken"), copyAll: await clickToast(pop, "#copyEnv"), reread: await clickToast(pop, "#refreshToken") };
  await pop.click("#checkToken");
  await until(pop, () => !/Checking/.test(document.querySelector("#tokenInfo").textContent));
  said.check = await one(pop, "#tokenInfo");
  golden("Token tab: what the buttons say (copy, copy all three, read again) and what Check reports", said, {
    copyToken: "Token copied", copyAll: "Token + cookies + UA copied", reread: "Token refreshed",
    check: "Profile Alex Carter · 1001 App Ads Suite · 1111 Permissions (3) ads_read ads_management no business_management All permissions · 3",
  });
  await done(b);

  // no Facebook tab at all, and a Facebook tab with no token on it
  const none = await boot({ fb: () => "<p>feed</p>", graph: () => ({ body: {} }) });
  const q = await popup(none, "token");
  const words = { noTab: await clickToast(q, "#grabToken") };
  const feed = await none.ctx.newPage(); await feed.goto("https://www.facebook.com/");
  words.noToken = await clickToast(q, "#grabToken");
  golden("Token tab: no Facebook tab open; a Facebook tab with no token on it", words, { noTab: "Open Facebook in this profile", noToken: "No token found on www.facebook.com" });
  await done(none);

  // a token of another account, a dead session
  const d = await boot({ fb: adsFb(TOK), graph: (u) => (pathOf(u) === "/me" ? { body: { id: "999" } } : { status: 400, body: { error: { code: 190, error_subcode: 463, message: "expired" } } }) });
  await adsPage(d);
  const dp = await popup(d, "token"); await captureClipboard(dp);
  const mismatch = await clickToast(dp, "#copyEnv");
  await dp.click('[data-tab="accounts"]'); await resetLocks(dp);
  const sessionToast = await clickToast(dp, "#loadAccounts");
  await dp.click('[data-tab="token"]');
  golden("Token tab: another account's token; a dead session (the toast, the card of the token)", { mismatch, sessionToast, card: await one(dp, "#kindCard") }, {
    mismatch: "The token belongs to another account (999), the cookies to 1001. Reload the FB tab",
    sessionToast: "Session is no longer valid, or the token is from another account (code 190/463) — requests stopped. Reload the FB tab or log in again",
    card: "EAAB Ads Manager The main ads token: launch and edit. This token's session is closed (code 190/463) — Graph requests are stopped.",
  });
  await done(d);
}

// ---------- Cookies ----------
async function cookieWords() {
  console.log("\n# golden wording: Cookies");
  const b = await boot({ fb: adsFb(TOK) });
  const bare = await popup(b, "cookies"); await captureClipboard(bare);
  const noFb = await clickToast(bare, "#copyCookiesUa");
  await adsPage(b);
  const pop = await popup(b, "cookies"); await captureClipboard(pop);
  golden("Cookies tab: the buttons, their tooltips, the status line, what a copy says", {
    buttons: await seen(pop, "#copyCookiesUa, #copyCookieJson"), tooltips: await pop.$$eval("#copyCookiesUa, #copyCookieJson", (ns) => ns.map((n) => n.title)), status: await one(pop, "#cookieStatus"),
    noFb, copied: await clickToast(pop, "#copyCookiesUa"), json: await clickToast(pop, "#copyCookieJson"),
  }, {
    buttons: ["Copy cookies + UA", "JSON"],
    tooltips: ["Cookie string, blank line, this profile's User-Agent (as the Facebook page sees it)", "Same cookies with attributes (domain, path, expiry) — for import into an antidetect browser"],
    status: "Logged in session until the browser closes · 3 cookies", noFb: "Open Facebook in this profile", copied: "Cookies + UA copied", json: "JSON copied",
  });
  await b.ctx.clearCookies({ name: "c_user" });
  const out = await popup(b, "cookies"); await captureClipboard(out);
  golden("Cookies tab: logged out", { status: await one(out, "#cookieStatus"), copy: await clickToast(out, "#copyCookiesUa") }, { status: "Not logged in to Facebook", copy: "No c_user / xs — log in to FB" });
  await done(b);
}

// ---------- Ad accounts ----------
const insight = (spend) => ({ data: [{ spend, impressions: "100", inline_link_clicks: "5", date_start: "2026-01-01", date_stop: "2026-01-01" }] });
const A = (id, name, status, over = {}) => ({ account_id: id, name, account_status: status, currency: "USD", timezone_name: "UTC", amount_spent: "100000", balance: "0", p_today: insight("10"), ...over });
const TS = { id: "9001", name: "Tailspin Toys" };
const ACCOUNTS = [
  A("1", "A healthy one", 1, { business: TS }), A("2", "A disabled one", 2, { disable_reason: 1, business: TS }), A("3", "An unpaid one", 3, { balance: "12000", business: TS }),
  A("4", "A restricted one", 1, { disable_reason: 5 }), A("5", "One in review", 7), A("6", "A compromised one", 2, { disable_reason: 15 }), A("7", "A closed one", 101),
];
const accGraph = (over = {}) => (u) => {
  const p = pathOf(u);
  if (over[p]) return over[p](u);
  if (p === "/me/adaccounts") return { body: { data: ACCOUNTS } };
  if (p === "/me/businesses") return { body: { data: [{ id: "9002", name: "Contoso Ads" }] } };
  if (p === "/9002/owned_ad_accounts") return { body: { data: [A("8", "Not assigned", 1, { business: { id: "9002", name: "Contoso Ads" } })] } };
  if (isAds(u)) return { body: { data: [{ id: "a1", name: "Rejected ad", effective_status: "DISAPPROVED", ad_review_feedback: { global: { "Personal attributes": "Implies knowledge of personal traits" } } }, { id: "a2", name: "Fine ad", effective_status: "ACTIVE" }] } };
  return { body: { data: [] } };
};
async function accountWords() {
  console.log("\n# golden wording: Ad accounts");
  const b = await boot({ fb: adsFb(TOK), graph: accGraph(), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await rowsAre(pop, ROW, 8); await idle(pop, "#tab-accounts");
  await pop.click('#periodSeg .seg-btn:last-child');                                  // All time: the label has no date
  await captureClipboard(pop);
  golden("Ad accounts tab: the periods, the controls and their tooltips, the total line, the status chips", {
    periods: await seen(pop, "#periodSeg .seg-btn"), controls: [await pop.getAttribute("#accountFilter", "placeholder"), ...(await seen(pop, "#copyLiveIds")), ages(await pop.getAttribute("#loadAccounts", "title"))],
    total: await one(pop, "#accountsTotal"), chips: await seen(pop, "#statusChips .chip"),
  }, {
    periods: ["Today", "Yesterday", "7 days", "30 days", "All time"], controls: ["Search", "Active IDs", "Refresh · updated <age>"], total: "Spend $8,000",
    chips: ["Active 1", "Disabled 2", "Unpaid 1", "Restricted 1", "No access 1", "In review 1", "Closed 1"],
  });
  golden("Ad accounts tab: the groups and every row as it reads (name, amount, then line 2: the ID first, the problem word, its one fix, '+N more')", { groups: await seen(pop, "#accountsList .lgroup"), rows: await seen(pop, "#accountsList .lrow-head") }, {
    groups: ["Tailspin Toys · 3 $3,000", "Contoso Ads · 1 $1,000", "Personal ad accounts · 4 $4,000"],
    rows: ["A healthy one $1,000 1 Active", "A disabled one $1,000 2 Ads policy Appeal", "An unpaid one $1,000 3 Unpaid Pay", "Not assigned $1,000 8 No access Assign me", "A compromised one $1,000 6 Compromised Secure +1 more", "A restricted one $1,000 4 Restricted Request review", "One in review $1,000 5 In review Account Quality", "A closed one $1,000 7 Closed"],
  });
  // the body of a row with a problem, and its ads
  await pop.click(`${ROW}[data-row="2"] .lrow-title`);
  const bodyAcc = await one(pop, `${ROW}[data-row="2"] .lrow-body`);
  await pop.click(`${ROW}.open [data-ads]`);
  await until(pop, () => /Rejected ad/.test(document.querySelector("#accountsList .lrow.open .ads")?.textContent || "") && /metrics updated/.test(document.querySelector("#accountsList .lrow.open .ads")?.textContent || ""));
  golden("Ad accounts tab: an opened row (facts, What to do, the footer line: small facts · places) and its ads", { body: bodyAcc, ads: ages(await one(pop, "#accountsList .lrow.open .ads-sec")) }, {
    body: "Spent $1,000 To pay $0 Pixels none What to do Ads policy violation. Appeal in Account Quality — it shows what exactly was flagged. Appeal UTC Ads Manager · Billing Ads",
    ads: "Ads · 2 2 ads · 1 active · 1 disapproved · metrics updated <age> Rejected ad Disapproved Personal attributes — Implies knowledge of personal traits Appeal Open ad Fine ad Active No delivery in this period",
  });
  await pop.click(`${ROW}.open .lrow-title`);
  // what the buttons say, a search that finds nothing, Active IDs with nothing to copy
  await resetLocks(pop);
  const said = { refresh: await clickToast(pop, "#loadAccounts"), again: secs(await clickToast(pop, "#loadAccounts")), ids: await clickToast(pop, "#copyLiveIds") };
  await pop.click('#statusChips .chip:has-text("Closed")'); said.noIds = await clickToast(pop, "#copyLiveIds"); await pop.click('#statusChips .chip:has-text("Closed")');
  await pop.fill("#accountFilter", "zzz");
  said.search = await one(pop, "#accountsList"); said.count = await one(pop, "#accountsTotal");
  golden("Ad accounts tab: what the refresh, a second refresh, Active IDs say; a search that finds nothing", said, {
    refresh: "Ad accounts: 8", again: "Refresh available in N s", ids: "Copied IDs: 2", noIds: "No active ad accounts", search: "Nothing found", count: "0 of 8 found",
  });
  await done(b);
}

// The empty states of a list tab, one after the other in one browser: nothing loaded (the API pause stops the automatic try), an empty list, a token that cannot
// read it, a failure, the skeleton while it loads. Same sentences on every tab; only the tab's own "nothing there" and "Loading…" differ.
const TABS = { accounts: { list: "#accountsList", btn: "#loadAccounts", path: "/me/adaccounts" }, bms: { list: "#bmsList", btn: "#loadBms", path: "/me/businesses" }, pages: { list: "#pagesList", btn: "#loadPages", path: "/me/accounts" } };
async function stateWords(tab, want) {
  const T = TABS[tab];
  let mode = "empty";
  const b = await boot({ fb: adsFb(TOK), graph: () => (mode === "perm" ? { status: 400, body: { error: { code: 10, message: "(#10) no permission" } } } : mode === "boom" ? { status: 500, body: { error: { code: 1, message: "boom" } } } : { delay: mode === "slow" ? 1500 : 0, body: { data: [] } }) });
  await adsPage(b);
  const pop = await popup(b);
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 10 * 60000 }));
  await pop.click(`[data-tab="${tab}"]`); await autoDone(pop, T.list);
  const got = { idle: await lampText(pop, T.list) };
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: 0 }));
  await until(pop, async () => (await import(chrome.runtime.getURL("js/state.js"))).state.cooldownUntil === 0);
  await pop.click(`${T.list} .lempty .btn`); await until(pop, (l) => document.querySelector(`${l} .lempty`)?.dataset.state === "none", T.list);
  got.none = await lampText(pop, T.list);
  for (const next of ["perm", "boom"]) {
    mode = next; await resetLocks(pop);
    await pop.click(`${T.list} .lempty .btn`); await until(pop, (l) => ["perm", "error"].includes(document.querySelector(`${l} .lempty`)?.dataset.state), T.list); await idle(pop, `#tab-${tab}`);
    got[next] = await lampText(pop, T.list);
  }
  got.errorToast = await toast(pop);
  mode = "slow"; await resetLocks(pop);
  await pop.click(`${T.list} .lempty .btn`); await until(pop, (l) => !!document.querySelector(`${l} .lsk-list`), T.list);
  got.loading = await pop.$eval(`${T.list} .lsk-list`, (n) => n.textContent);
  golden(`${tab}: the empty states (not loaded, nothing there, no permission, a failure, loading)`, got, want ?? WANT_STATES[tab]);
  await done(b);
}
const PERM = "This token can't read the list — open Ads Manager or Business Manager, refresh the token (the refresh button on the Token tab) and try again.";
const WANT_STATES = Object.fromEntries([["accounts", "No ad accounts", "Loading ad accounts…"], ["bms", "No businesses", "Loading businesses…"], ["pages", "No pages", "Loading pages…"]].map(([tab, none, loading]) => [tab, {
  idle: { kind: "idle", text: "Not loaded yet", detail: null, button: "Load" }, none: { kind: "none", text: none, detail: null, button: "Refresh" }, perm: { kind: "perm", text: PERM, detail: null, button: "Try again" },
  boom: { kind: "error", text: "Couldn't load", detail: "Graph says: boom", button: "Try again" }, errorToast: "Graph says: boom", loading }]));

// ---------- Businesses ----------
async function bmsWords() {
  console.log("\n# golden wording: Businesses");
  const b = await boot({ fb: adsFb(TOK), graph: bmsGraph(), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "bms");
  await rowsAre(pop, "#bmsList .lrow", 6); await until(pop, () => document.querySelectorAll("#bmsList .lrow-status, #bmsList .lrow-sub .sr-only").length >= 6); await idle(pop, "#tab-bms");
  await captureClipboard(pop);
  golden("Businesses tab: the controls, the periods, the total line", {
    controls: [await pop.getAttribute("#bmFilter", "placeholder"), ages(await pop.getAttribute("#loadBms", "title"))], periods: await seen(pop, "#bmsPeriod .seg-btn"), total: dates(await one(pop, "#bmsTotal")),
  }, { controls: ["Search", "Refresh businesses and spend · updated <age>"], periods: ["Today", "Yesterday", "7 days", "30 days", "All time"], total: "Spend · <date> ≈ $227.00 $142.00 + €60.00 +1 more · rates <date> · ExchangeRate-API" });
  golden("Businesses tab: every row as it reads (name, the amount, then line 2: the ID first, the one problem word and its fix, '+N more', the counts)", { rows: await seen(pop, "#bmsList .lrow-head") }, {
    rows: ["Alpha Media $100.00 + €50.00 1001 Active 3 ad accounts · 1 disabled", "Delta Co ≈ $47.50 1004 Active 3 ad accounts", "Beta Ads $10.00 1002 Unverified 1 ad account · 1 disabled Verify +1 more", "Partner Agency $7.00 9999 Active 1 ad account",
      "Epsilon Digital $0 1005 None active 2 ad accounts · 1 disabled", "Gamma Group — 1003 No ad accounts Create account"],
  });
  await pop.click('#bmsList .lrow:has(.lrow-name:text-is("Beta Ads")) .lrow-title');
  golden("Businesses tab: an opened row (the counts, the jump button, verification, What to do with both helps and every step, the places)", { body: await one(pop, "#bmsList .lrow.open .lrow-body") }, {
    body: "Ad accounts 1 · 1 disabled Show ad accounts → Verification Failed What to do The reason is in Business Settings → Security. Verify the business again. Check why the ad accounts are not active, or add a new one. Verify Manage ad accounts Business settings",
  });
  await pop.click("#bmsList .lrow.open .lrow-title");
  await resetLocks(pop);
  const said = { refresh: await clickToast(pop, "#loadBms") };
  await pop.fill("#bmFilter", "zzz"); said.search = await one(pop, "#bmsList"); said.count = await one(pop, "#bmsTotal .total-meta"); said.value = await one(pop, "#bmsTotal .total-value");
  golden("Businesses tab: what the refresh says; a search that finds nothing", { refresh: secs(said.refresh), search: said.search, count: said.count, value: said.value }, { refresh: "Businesses: 5", search: "Nothing found", count: "0 of 6 found", value: "—" });
  await done(b);
}

// ---------- Pages ----------
async function pagesWords() {
  console.log("\n# golden wording: Pages");
  const b = await boot({ fb: adsFb(TOK), graph: pagesFx.mock(pagesFx.FULL) });
  await adsPage(b);
  const pop = await popup(b, "pages");
  await rowsAre(pop, "#pagesList .lrow", 9); await idle(pop, "#tab-pages");
  golden("Pages tab: the controls, the chips, the count", { controls: [await pop.getAttribute("#pageFilter", "placeholder"), ages(await pop.getAttribute("#loadPages", "title"))], chips: await seen(pop, "#pagesChips .chip"), total: await one(pop, "#pagesTotal") },
    { controls: ["Search", "Refresh · updated <age>"], chips: ["No access 4", "Unpublished 3", "Can't advertise 2", "No Instagram 3"], total: "" });
  golden("Pages tab: every row as it reads (name, handle, then line 2: the ID first, the worst problem and its one fix, '+N more')", { rows: await seen(pop, "#pagesList .lrow-head") }, {
    rows: ["Backed Page 100000000000003 Ready IG via page", "Nova Travel Blog @nova.travel 100000000000001 Ready", "Client Fashion House @client.fashion 100000000000008 No access Assign me +1 more", "Harbor Bakery @harbor.bakery 100000000000007 No access Assign me",
      "Hidden Page 100000000000004 No access Assign me +3 more", "Wingtip Gadgets 100000000000009 No access Assign me +1 more", "Draft Page @draft.page 100000000000005 Unpublished Publish", "Orion Studio @orion.studio 100000000000006 Can't advertise Appeal",
      "Fresh Page 100000000000002 No Instagram Set “Use Facebook Page”"],
  });
  await pop.click(`#pagesList .lrow[data-row="${pagesFx.ids.hidden}"] .lrow-title`);
  golden("Pages tab: an opened row (every problem with its fix, the places)", { body: await one(pop, `#pagesList .lrow[data-row="${pagesFx.ids.hidden}"] .lrow-body`) }, { body: "What to do No access Assign me Unpublished Publish Can't advertise Appeal No Instagram Set “Use Facebook Page” Page · Business Suite" });
  await pop.click(`#pagesList .lrow[data-row="${pagesFx.ids.nova}"] .lrow-title`);
  golden("Pages tab: an opened healthy row (Instagram, owner business, my tasks, three places)", { body: await one(pop, `#pagesList .lrow[data-row="${pagesFx.ids.nova}"] .lrow-body`) }, { body: "Instagram Account @nova.travel Business Nova Media Your access Advertise, Manage, Insights Page · Business Suite · Business pages" });
  await pop.click(`#pagesChips .chip:has-text("No Instagram")`);
  golden("Pages tab: the No Instagram chip: the count, the written-out fix", { total: await one(pop, "#pagesTotal"), note: await one(pop, "#pagesList .pg-note") }, {
    total: "3 of 9 found", note: "To fix: in an ad of each of these pages choose “Use Facebook Page” once (Ads Manager → Ad → Identity → Instagram account) — otherwise automated launches to Instagram placements fail.",
  });
  await pop.click(`#pagesChips .chip:has-text("No Instagram")`);
  await pop.fill("#pageFilter", "zzz");
  golden("Pages tab: a search that finds nothing", { list: await one(pop, "#pagesList") }, { list: "Nothing found" });
  await resetLocks(pop);
  golden("Pages tab: what the refresh says", { refresh: secs(await clickToast(pop, "#loadPages")) }, { refresh: "Pages: 9" });
  await done(b);
  // a business that could not be read, and a list cut at its limit
  const edge = await boot({ fb: adsFb(TOK), graph: pagesFx.mock({ ...pagesFx.FULL, refuseEdge: [{ when: (bm) => bm === "777", error: { code: 1, message: "boom" } }] }) });
  await adsPage(edge);
  const ep = await popup(edge, "pages");
  await rowsAre(ep, "#pagesList .lrow", 8); await idle(ep, "#tab-pages");
  golden("Pages tab: a business that could not be read (the muted line under the list)", { hint: await one(ep, "#pagesList .pg-foot") }, { hint: "Some businesses couldn't be read, so pages that are only in them may be missing" });
  await done(edge);
}

export const flows = { goldenToken: tokenWords, goldenCookies: cookieWords, goldenAccounts: async () => { await accountWords(); await stateWords("accounts"); },
  goldenBms: async () => { await bmsWords(); await stateWords("bms"); }, goldenPages: async () => { await pagesWords(); await stateWords("pages"); } };
