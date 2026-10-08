// Ad accounts tab: API version, the account cache per FB user, dead sessions, ads, automatic load, all-time spend, layout.
import { GRAPH, TOK, TOK2, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, accountsJson, isAds, adsFb, boxWait, GONE, loadAccounts, openAds, stored } from "../harness.mjs";

// Every account-list load also asks /me/businesses (BM accounts the person is not assigned to): counted apart.
const accHits = (b) => b.hits.filter((h) => !h.startsWith("/me/businesses"));

// ---------- API version ----------
async function versionFlows() {
  console.log("\n# api version");
  const b = await boot({ fb: adsFb(TOK), graph: (u) => {
    if (u.pathname.startsWith("/v26.0/")) return { status: 400, body: { error: { code: 2635, message: "(#2635) You are calling a deprecated version of the Ads API. Please update to the latest version: v27.0." } } };
    if (u.pathname.startsWith("/v27.0/")) return { headers: { "x-ad-api-version-warning": "Version v27.0 is deprecated; the call was upgraded to v28.0" }, body: accountsJson };
    return { body: accountsJson };
  } });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("no request on open", b.hits.length === 0, b.hits.join());
  ok("rows rendered", await loadAccounts(pop, 1));
  ok("#2635 -> retried on v27.0", accHits(b).length === 2, b.hits.join());
  const v = await until(pop, () => chrome.storage.local.get("apiVersion").then((o) => o.apiVersion === "v28.0")) && "v28.0";
  ok("header names v27.0 first and v28.0 second -> v28.0 is stored (newest, not first)", v === "v28.0", String(v));
  await b.ctx.close();
}

// ---------- account cache keyed by FB user ----------
async function cacheFlows() {
  console.log("\n# account cache");
  let calls = 0;
  const b = await boot({ fb: adsFb(TOK), graph: (u) => { calls++; return { body: isAds(u) ? { data: [{ id: "a1", name: "Ad 1", effective_status: "ACTIVE" }] }
    : { data: [{ account_id: "111", name: "Acc A", account_status: 1, currency: "USD", timezone_name: "UTC" }, { account_id: "222", name: "Acc B", account_status: 2, currency: "USD", timezone_name: "UTC" }] } }; } });
  const fb = await adsPage(b);
  let pop = await popup(b, "accounts");
  ok("accounts loaded", await loadAccounts(pop, 2));
  ok("ads loaded", await openAds(pop) && (await pop.locator(".ad").count()) === 1);
  pop = await popup(b, "accounts");
  ok("reopen keeps rows, open row and ads", (await rowsAre(pop, ".acc", 2)) && (await rowsAre(pop, ".acc.open", 1)) && (await rowsAre(pop, ".ad", 1)));
  await fb.close(); pop = await popup(b, "accounts");
  ok("no FB tab: token gone", await boxWait(pop, GONE), await text(pop, "#tokenBox"));
  ok("no FB tab: cache stays", await rowsAre(pop, ".acc", 2));
  const c0 = calls; await clickToast(pop, "#loadAccounts");
  ok("refresh without a token sends nothing", calls === c0);
  await b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }]);
  pop = await popup(b, "accounts");
  ok("another FB user -> cache dropped", (await rowsAre(pop, ".acc", 0)) && (await until(pop, () => chrome.storage.session.get("accounts").then((o) => !o.accounts))));
  await b.ctx.close();
}

// ---------- dead session (190 / 459 / 460 / 463 / 467) ----------
async function sessionFlows() {
  console.log("\n# dead session");
  let tok = TOK;
  const dead = (code, sub) => ({ status: 400, body: { error: { code, error_subcode: sub, message: "Error validating access token: Session has expired" } } });
  for (const [code, sub] of [[190, 463], [190, 460], [190, 467], [190, 459], [190, undefined]]) {
    const b = await boot({ fb: adsFb(TOK), graph: () => dead(code, sub) });
    await adsPage(b);
    const pop = await popup(b, "accounts");
    const label = sub ? `${code}/${sub}` : String(code);
    const toast = await clickToast(pop, "#loadAccounts");
    ok(`${label}: one call goes out, the toast names the code`, b.hits.length === 1 && has(toast, label), `${b.hits.length} ${toast}`);
    await b.ctx.close();
  }
  const b = await boot({ fb: (u) => adsFb(tok)(u), graph: () => dead(190, 463) });
  const fb = await adsPage(b);
  let pop = await popup(b, "accounts");
  await clickToast(pop, "#loadAccounts");
  ok("dead flag persisted", ((await stored(pop, "dead")) || []).some((d) => d.token === TOK));
  await resetLocks(pop);
  const again = await clickToast(pop, "#loadAccounts");
  ok("second click: no request, session message", b.hits.length === 1 && has(again, "no longer valid"), `${b.hits.length} ${again}`);
  pop = await popup(b, "token");
  ok("card says the session is closed", await until(pop, () => /190\/463/.test(document.querySelector("#kindCard").textContent)), await text(pop, "#kindCard"));
  await pop.click("#checkToken");
  ok("Check reports it and sends nothing", (await until(pop, () => /no longer valid/.test(document.querySelector("#tokenInfo").textContent))) && b.hits.length === 1, b.hits.join());
  pop = await popup(b, "accounts"); await resetLocks(pop);
  await clickToast(pop, "#loadAccounts");
  ok("popup reopen: still no request", b.hits.length === 1);
  b.graph = () => ({ body: accountsJson });
  tok = TOK2; await fb.reload();
  await pop.click('[data-tab="token"]'); await pop.click("#grabToken");
  await boxWait(pop, /^EAABy/);                         // the grab reads the reloading tab: wait for it, don't race it
  ok("a different token is not dead", await until(pop, (t2) => chrome.storage.session.get("dead").then((o) => !(o.dead || []).some((d) => d.token === t2)), TOK2));
  await pop.click('[data-tab="accounts"]');
  const box2 = await text(pop, "#tokenBox");
  const loaded2 = await loadAccounts(pop, 1);
  ok("new token works again", loaded2 && accHits(b).length === 2, `${accHits(b).length} box=${box2.slice(0, 6)} toast=${await text(pop, "#toast")}`);
  // back to the old dead token (A → B → A): its mark is still there, nothing is sent
  b.graph = () => dead(190, 463);
  tok = TOK; await fb.reload();
  await pop.click('[data-tab="token"]'); await pop.click("#grabToken"); await boxWait(pop, /^EAABx/);
  await pop.click('[data-tab="accounts"]'); await resetLocks(pop);
  const back = await clickToast(pop, "#loadAccounts");
  ok("A → B → A: the first token is still known dead, no request", accHits(b).length === 2 && has(back, "no longer valid"), `${accHits(b).length} ${back}`);
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();

  // a dead session must not replace an ads list you already have
  const b2 = await boot({ fb: adsFb(TOK), graph: (u) => isAds(u) ? { body: { data: [{ id: "a1", name: "Keep me", effective_status: "ACTIVE" }] } } : { body: accountsJson } });
  await adsPage(b2);
  pop = await popup(b2, "accounts");
  await loadAccounts(pop, 1); await openAds(pop);
  b2.graph = () => dead(190, 463); await resetLocks(pop);
  const toast = await clickToast(pop, ".acc.open .ads-refresh");
  ok("failed ads refresh keeps the list", has(await text(pop, ".ads"), "Keep me"), await text(pop, ".ads"));
  ok("…and reports the code in a toast", has(toast, "190/463"), toast);
  await b2.ctx.close();
}

// ---------- ads: reasons, placements, issues_info, paging, failures ----------
async function adsFlows() {
  console.log("\n# ads");
  const base = { id: "a0", name: "Fine", effective_status: "ACTIVE", issues_info: [{ error_summary: "Soft note on a healthy ad", error_message: "ignore" }] };
  const rejected = { id: "a1", name: "Rejected", effective_status: "DISAPPROVED", ad_review_feedback: {
    global: { "Personal attributes": "Implies knowledge of personal traits" },
    placement_specific: { instagram: { "Misleading claims": "Unrealistic claims" } } } };
  const igOnly = { id: "a2", name: "IG only", effective_status: "DISAPPROVED", ad_review_feedback: { placement_specific: { instagram: { "Sensational content": "Shocking" } } } };
  const issues = { id: "a3", name: "Issues", effective_status: "WITH_ISSUES", issues_info: [{ error_summary: "Ad set has no budget", error_message: "Set a budget" }] };
  const open = async (b) => {
    await adsPage(b); const pop = await popup(b, "accounts");
    await loadAccounts(pop, 1); await openAds(pop);
    return pop;
  };

  let b = await boot({ fb: adsFb(TOK), graph: (u) => isAds(u) ? { body: { data: [base, rejected, igOnly, issues] } } : { body: accountsJson } });
  let pop = await open(b);
  const adHits = () => b.hits.filter((h) => h.includes("/ads?") && !h.includes("p_today"));   // list reads; the numbers are a second read
  ok("issues_info is requested", has(adHits()[0], "issues_info"), adHits()[0]);
  const names = await pop.$$eval(".ad > span:first-child", (n) => n.map((x) => x.textContent));
  ok("problem ads come first", names.slice(0, 3).sort().join() === "IG only,Issues,Rejected" && names[3] === "Fine", names.join());
  const body = await text(pop, ".ads");
  ok("global reason shows its key AND description", has(body, "Personal attributes — Implies knowledge of personal traits"), body);
  ok("placement-specific reason shows the placement", has(body, "Instagram: Misleading claims — Unrealistic claims"), body);
  ok("rejection only on Instagram is explained (was empty)", has(body, "Instagram: Sensational content — Shocking"), body);
  ok("WITH_ISSUES reason comes from issues_info", has(body, "Ad set has no budget — Set a budget"), body);
  ok("issues_info of a healthy ad stays hidden", !has(body, "Soft note"), body);
  ok("summary counts the rejected", has(await text(pop, ".ads-sum"), "3 disapproved"), await text(pop, ".ads-sum"));
  await b.ctx.close();

  // more than one page: a second request pulls the problem ads that sit beyond the first 100
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, name: `Ad ${i}`, effective_status: "ACTIVE" }));
  b = await boot({ fb: adsFb(TOK), graph: (u) => {
    if (!isAds(u)) return { body: accountsJson };
    if (u.searchParams.get("effective_status")) return { body: { data: [{ id: "late", name: "Late reject", effective_status: "DISAPPROVED", ad_review_feedback: { global: { Reason: "Beyond page one" } } }] } };
    return { body: { data: page1, paging: { next: `${GRAPH}/next` } } };
  } });
  pop = await open(b);
  const filtered = b.hits.filter((h) => h.includes("effective_status="));
  ok("second request filters DISAPPROVED / WITH_ISSUES", filtered.length === 1 && has(decodeURIComponent(filtered[0]), '["DISAPPROVED","WITH_ISSUES"]'), filtered.join());
  ok("the late rejected ad is shown, first", (await text(pop, ".ad > span:first-child")) === "Late reject", await text(pop, ".ad > span:first-child"));
  ok("101 ads, 'more' hint present", has(await text(pop, ".ads-sum"), "101+") && has(await text(pop, ".ads"), "more exist"), await text(pop, ".ads-sum"));
  await b.ctx.close();

  // Graph refuses issues_info -> repeated once without it
  b = await boot({ fb: adsFb(TOK), graph: (u) => {
    if (!isAds(u)) return { body: accountsJson };
    if (u.searchParams.get("fields").includes("issues_info")) return { status: 400, body: { error: { code: 100, message: "(#100) Tried accessing nonexisting field (issues_info) on node type (Ad)" } } };
    return { body: { data: [base] } };
  } });
  pop = await open(b);
  const ah = b.hits.filter((h) => h.includes("/ads?") && !h.includes("p_today"));
  ok("issues_info refused -> one retry without it", ah.length === 2 && !has(ah[1], "issues_info"), ah.join(" | "));
  ok("ads still shown", (await pop.locator(".ad").count()) === 1);
  await b.ctx.close();

  // a failed refresh keeps the list; error text is never persisted
  let fail = false;
  b = await boot({ fb: adsFb(TOK), graph: (u) => isAds(u) ? (fail ? { status: 500, body: { error: { code: 1, message: "boom" } } } : { body: { data: [base] } }) : { body: accountsJson } });
  pop = await open(b);
  fail = true; await resetLocks(pop);
  const toast = await clickToast(pop, ".acc.open .ads-refresh");
  ok("failed refresh: list kept", (await pop.locator(".ad").count()) === 1);
  ok("failed refresh: error toast", has(toast, "boom"), toast);
  ok("failed refresh: the row says the list is old", has(await text(pop, ".ads"), "Not refreshed: boom"), await text(pop, ".ads"));
  ok("…and that mark is not persisted", !JSON.stringify(await stored(pop, "ads")).includes("stale"));
  ok("stored ads have no error text", !JSON.stringify(await stored(pop, "ads")).includes("boom"));
  await b.ctx.close();

  b = await boot({ fb: adsFb(TOK), graph: (u) => isAds(u) ? { status: 500, body: { error: { code: 1, message: "boom" } } } : { body: accountsJson } });
  pop = await open(b);
  ok("first load fails: error on the row", has(await text(pop, ".ads"), "boom"), await text(pop, ".ads"));
  ok("…and is not persisted", !JSON.stringify((await stored(pop, "ads")) || {}).includes("boom"));
  await b.ctx.close();

  // per-ad numbers: a second read after the list, every period at once, switching the period sends nothing
  const ins = (spend, imp, clicks) => ({ data: [{ spend, impressions: imp, inline_link_clicks: clicks, date_start: "2026-09-30", date_stop: "2026-09-30" }] });
  const listAds = [
    { id: "s1", name: "Busy", effective_status: "ACTIVE" },
    { id: "s2", name: "Idle live", effective_status: "ACTIVE" },
    { id: "s3", name: "Idle paused", effective_status: "PAUSED" },
    { id: "s4", name: "Single", effective_status: "ACTIVE" },
  ];
  const statRows = [
    { id: "s1", p_today: ins("12.4", "3100", "48"), p_week: ins("80", "20000", "310"), p_all: ins("500", "400000", "9000") },
    { id: "s2" }, { id: "s3" },
    { id: "s4", p_today: ins("0.5", "1", "1"), p_all: ins("0.5", "1", "1") },
  ];
  const isStats = (u) => u.searchParams.get("fields").includes("p_today");
  let statsMode = "ok";
  const statMock = (u) => {
    if (!isAds(u)) return { body: accountsJson };
    if (!isStats(u)) return { body: { data: listAds } };
    if (statsMode === "noall" && u.searchParams.get("fields").includes("p_all")) return { status: 400, body: { error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" } } };
    if (statsMode === "heavy") return { status: 400, body: { error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" } } };
    if (statsMode === "field") return { status: 400, body: { error: { code: 100, message: "(#100) Tried accessing nonexisting field (insights) on node type (Ad)" } } };
    if (statsMode === "down") return { status: 500, body: { error: { code: 2, message: "temporary" } } };
    return { body: { data: statRows } };
  };
  b = await boot({ fb: adsFb(TOK), graph: statMock });
  pop = await open(b);
  await until(pop, () => /metrics updated/.test(document.querySelector(".ads-sum")?.textContent || ""));
  const adLines = () => pop.$$eval(".ad", (n) => n.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  const listCalls = () => b.hits.filter((h) => h.includes("/ads?") && !h.includes("p_today")).length;
  const statCalls = () => b.hits.filter((h) => h.includes("/ads?") && h.includes("p_today")).length;
  const statCalls2 = (bb) => bb.hits.filter((h) => h.includes("/ads?") && h.includes("p_today")).length;
  let lines = await adLines();
  const stat = b.hits.find((h) => h.includes("/ads?") && h.includes("p_today"));
  ok("the numbers are a separate read with all four periods", statCalls() === 1 && ["p_today", "p_yesterday", "p_week", "p_month", "p_all", "maximum", "spend", "impressions", "inline_link_clicks"].every((k) => has(stat, k)), stat);
  ok("the list read stays free of insights", !b.hits.filter((h) => h.includes("/ads?") && !h.includes("p_today")).some((h) => has(h, "insights")));
  ok("ad row: spend, impressions, clicks", has(lines[0], "$12.40") && has(lines[0], "3,100 impressions") && has(lines[0], "48 clicks") && has(lines[0], "CPC $0.26"), lines[0]);
  ok("singular counts", has(lines[3], "1 impression ") && has(lines[3], "1 click") && !has(lines[3], "1 clicks") && !has(lines[3], "1 impressions"), lines[3]);
  ok("active ad without delivery says so", has(lines[1], "No delivery in this period"), lines[1]);
  ok("paused ad without delivery stays quiet", !has(lines[2], "No delivery") && !has(lines[2], "$"), lines[2]);
  ok("the sum line says how old the numbers are", has(await text(pop, ".ads-sum"), "metrics updated just now"), await text(pop, ".ads-sum"));
  const calls = statCalls();
  await pop.click('#periodSeg .seg-btn:has-text("7 days")');
  lines = await adLines();
  ok("switching to 7 days shows that period's numbers", has(lines[0], "$80.00") && has(lines[0], "310 clicks"), lines[0]);
  ok("…without a request", statCalls() === calls && listCalls() === 1);
  await pop.click('#periodSeg .seg-btn:has-text("All time")');
  lines = await adLines();
  ok("All time: per-ad numbers and CPC", has(lines[0], "$500.00") && has(lines[0], "400,000 impressions") && has(lines[0], "9,000 clicks") && has(lines[0], "CPC $0.06"), lines[0]);
  ok("All time: no extra note under the sum line", !has(await text(pop, ".ads"), "37 months") && (await pop.locator(".ads .hint").count()) === 0, await text(pop, ".ads"));
  ok("…still without a request", statCalls() === calls);
  await pop.click('#periodSeg .seg-btn:has-text("Today")');
  ok("numbers are persisted compact (no raw Graph objects)", !JSON.stringify(await stored(pop, "ads")).includes("date_start"));
  // a day later the cached numbers must not pass for today's
  await pop.evaluate(() => chrome.storage.session.get("ads").then((o) => { for (const v of Object.values(o.ads)) v.statsAt -= 2 * 86400000; return chrome.storage.session.set({ ads: o.ads }); }));
  const oldPop = await popup(b, "accounts"); await rowsAre(oldPop, ".acc", 1);
  const oldTxt = await oldPop.evaluate(() => document.querySelector(".ads").textContent);
  ok("cached from an earlier day: hint, no numbers", has(oldTxt, "out of date") && !has(oldTxt, "$12.40"), oldTxt);
  await b.ctx.close();

  // the button above the list refreshes the accounts only; each account's ads have their own refresh icon
  const liveAds = listAds.map((a) => ({ ...a })), liveRows = statRows.map((r) => ({ ...r }));
  b = await boot({ fb: adsFb(TOK), graph: (u) => !isAds(u) ? { body: accountsJson } : isStats(u) ? { body: { data: liveRows } } : { body: { data: liveAds } } });
  pop = await open(b);
  await until(pop, () => /metrics updated/.test(document.querySelector(".ads-sum")?.textContent || ""));
  const accReads = () => accHits(b).filter((h) => !h.includes("/ads?")).length;
  const [l0, s0, a0] = [listCalls(), statCalls(), accReads()];
  await resetLocks(pop); await pop.click("#loadAccounts");
  await pop.waitForTimeout(900);
  ok("the top refresh reads the accounts only, the ads cost nothing", accReads() === a0 + 1 && listCalls() === l0 && statCalls() === s0, `${a0}/${l0}/${s0} -> ${accReads()}/${listCalls()}/${statCalls()}`);
  ok("…and the ads card is still expanded", (await pop.locator(".ad").count()) === 4);
  liveAds[0].name = "Busy renamed"; liveRows[0].p_today = ins("20", "4000", "50");
  await resetLocks(pop); await pop.click(".acc.open .ads-refresh");
  await until(pop, () => /Busy renamed/.test(document.querySelector(".ad")?.textContent || "") && /\$20\.00/.test(document.querySelector(".ad")?.textContent || ""));
  lines = await adLines();
  ok("the ads icon re-reads this account's ads: new list and new numbers", has(lines[0], "Busy renamed") && has(lines[0], "$20.00") && has(lines[0], "50 clicks"), lines[0]);
  ok("…one list read, one numbers read, no accounts read", listCalls() === l0 + 1 && statCalls() === s0 + 1 && accReads() === a0 + 1, `${l0}/${s0} -> ${listCalls()}/${statCalls()}, accounts ${accReads()}`);
  ok("…the list stays expanded", (await pop.locator(".ad").count()) === 4);
  // a popup opened hours later shows the old numbers; the ads icon replaces them
  // (up to 3 h, but never past UTC midnight: the mock account is in UTC and numbers of an earlier day are hidden)
  await pop.evaluate(() => { const d = new Date(), back = Math.min(3 * 3600000, d - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 90000);
    return chrome.storage.session.get("ads").then((o) => { for (const v of Object.values(o.ads)) v.statsAt -= back; return chrome.storage.session.set({ ads: o.ads }); }); });
  const re = await popup(b, "accounts"); await rowsAre(re, ".acc", 1);
  await until(re, () => /metrics updated (\d+ (min|h) ago|just now)/.test(document.querySelector(".ads-sum")?.textContent || ""));
  ok("reopened later: the sum line shows the age of the numbers", /metrics updated (\d+ (min|h) ago|just now)/.test(await text(re, ".ads-sum")), await text(re, ".ads-sum"));
  liveRows[0].p_today = ins("33", "5000", "60");
  await resetLocks(re); await re.click(".acc.open .ads-refresh");
  await until(re, () => /metrics updated just now/.test(document.querySelector(".ads-sum")?.textContent || ""));
  ok("…the ads icon brings the numbers up to date", has(await text(re, ".ads-sum"), "metrics updated just now") && has(await text(re, ".ad"), "$33.00"), await text(re, ".ads-sum") + " | " + await text(re, ".ad"));
  await re.close();
  // the card is symmetric and its header does not move when the list folds or unfolds
  const geo = () => pop.$eval(".acc.open .ads-toggle", (n) => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(); });
  const gap = () => pop.$eval(".acc.open .ads-card", (n) => { const r = n.getBoundingClientRect(), bb = document.body.getBoundingClientRect(); return { l: Math.round(r.left - bb.left), r: Math.round(bb.right - r.right) }; });
  const gOpen = await geo(), gg = await gap();
  ok("ads card: same gap left and right", Math.abs(gg.l - gg.r) <= 1, JSON.stringify(gg));
  await pop.hover(".acc.open .ads-toggle");
  ok("hover on the ads header keeps the bar as it is (words only, like the tabs)", (await pop.$eval(".acc.open .ads-toggle", (n) => getComputedStyle(n).backgroundColor)) === "rgba(0, 0, 0, 0)");
  await pop.click(".acc.open .ads-toggle");                      // collapse
  const gShut = await geo();
  ok("folding the ads keeps the header exactly where it was", gOpen === gShut, `${gOpen} -> ${gShut}`);
  ok("…and folded, the refresh icon is still there", (await pop.locator(".acc.open .ads-refresh").count()) === 1);
  await pop.click(".acc.open .ads-toggle");                      // expand
  ok("unfolding keeps it there too", (await geo()) === gOpen, `${gOpen} -> ${await geo()}`);
  await b.ctx.close();

  // only the all-time part is refused: the other periods are read again and shown, All time says so
  statsMode = "noall";
  b = await boot({ fb: adsFb(TOK), graph: statMock });
  pop = await open(b);
  await until(pop, () => /metrics updated/.test(document.querySelector(".ads-sum")?.textContent || ""));
  const sc = b.hits.filter((h) => h.includes("/ads?") && h.includes("p_today"));
  ok("all-time refused -> one retry without it", sc.length === 2 && has(sc[0], "p_all") && !has(sc[1], "p_all") && has(sc[1], "p_month"), sc.length + " " + sc.map((h) => has(h, "p_all")).join());
  lines = await adLines();
  ok("all-time refused -> Today still shown", has(lines[0], "$12.40"), lines[0]);
  await pop.click('#periodSeg .seg-btn:has-text("All time")');
  ok("all-time refused -> no numbers, one honest hint", (await pop.locator(".ad-stats").count()) === 0 && has(await text(pop, ".ads"), "did not return all-time metrics"), await text(pop, ".ads"));
  await b.ctx.close();

  // the numbers fail (too heavy / field refused / server down): the list stays, one hint, nothing else lost
  for (const mode of ["heavy", "field", "down"]) {
    statsMode = mode;
    b = await boot({ fb: adsFb(TOK), graph: statMock });
    pop = await open(b);
    await until(pop, () => /did not load/.test(document.querySelector(".ads")?.textContent || ""));
    ok(`numbers ${mode}: list shown (4 ads), hint, no stats lines`, (await pop.locator(".ad").count()) === 4 && (await pop.locator(".ad-stats").count()) === 0 && has(await text(pop, ".ads"), "Ad metrics did not load"), await text(pop, ".ads"));
    ok(`numbers ${mode}: the failure mark is not persisted`, !JSON.stringify(await stored(pop, "ads")).includes("statsFail"));
    if (mode !== "down") {
      await resetLocks(pop);
      const before = statCalls2(b);
      await pop.click(".acc.open .ads-refresh");
      await pop.waitForTimeout(800);
      ok(`numbers ${mode}: refused for this account -> not asked again`, statCalls2(b) === before, `${before} -> ${statCalls2(b)}`);
    }
    await b.ctx.close();
  }
  statsMode = "ok";
}

// ---------- Accounts tab: automatic first load ----------
async function autoFlows() {
  console.log("\n# accounts: automatic load");
  const rowsPage = { body: accountsJson };
  const hitsOf = (b) => b.hits.filter((h) => h.startsWith("/me/adaccounts")).length;
  const toastOf = (p) => p.evaluate(() => document.querySelector("#toast").textContent.trim());

  // 1. first visit loads by itself; later visits in the same popup do not
  let b = await boot({ fb: adsFb(TOK), graph: () => rowsPage });
  const fbTab = await adsPage(b);
  let pop = await popup(b);
  ok("token tab open: nothing requested yet", hitsOf(b) === 0);
  await pop.click('[data-tab="accounts"]');
  ok("first visit: rows appear without pressing refresh", await rowsAre(pop, ".acc", 1));
  ok("…with exactly one request", hitsOf(b) === 1, String(hitsOf(b)));
  ok("…and no toast for an automatic load", (await toastOf(pop)) === "", await toastOf(pop));
  await pop.click('[data-tab="token"]'); await pop.click('[data-tab="accounts"]'); await pop.waitForTimeout(700);
  ok("second visit in the same popup: no new request", hitsOf(b) === 1, String(hitsOf(b)));

  // 2. reopening: the popup remembers the Accounts tab; the one-minute slot still holds -> silent, cache shown
  pop = await popup(b); await pop.waitForTimeout(700);
  ok("reopen within a minute: no request, cache shown, no complaint", hitsOf(b) === 1 && (await rowsAre(pop, ".acc", 1)) && !has(await toastOf(pop), "Refresh available"), `${hitsOf(b)} ${await toastOf(pop)}`);
  // 3. a minute later, same FB page: reopening the popup still sends nothing (the list is from this page load)
  await resetLocks(pop);
  pop = await popup(b); await pop.waitForTimeout(1200);
  ok("reopen after a minute, FB page not reloaded: no request", hitsOf(b) === 1, String(hitsOf(b)));
  ok("the popup opens at full height on the Accounts tab", await pop.evaluate(() => document.body.classList.contains("tall") && document.body.getBoundingClientRect().height >= 600));
  // 4. the FB page is reloaded: the next popup open refreshes once, the one after does not
  await fbTab.reload(); await resetLocks(pop);
  pop = await popup(b);
  for (let i = 0; i < 40 && hitsOf(b) < 2; i++) await pop.waitForTimeout(100);
  await pop.waitForTimeout(500);
  ok("after an FB page reload: one automatic refresh", hitsOf(b) === 2, String(hitsOf(b)));
  await resetLocks(pop);
  pop = await popup(b); await pop.waitForTimeout(1200);
  ok("…and only one: reopening again sends nothing", hitsOf(b) === 2, String(hitsOf(b)));
  // 5. the manual refresh still works any time the slot allows
  await resetLocks(pop);
  await pop.click("#loadAccounts"); for (let i = 0; i < 30 && hitsOf(b) < 3; i++) await pop.waitForTimeout(100);
  ok("the refresh button still reloads", hitsOf(b) === 3, String(hitsOf(b)));
  await b.ctx.close();

  // 4. no token anywhere: nothing sent, the empty state says what to do
  b = await boot({ fb: () => "<p>feed</p>", graph: () => rowsPage });
  await (await b.ctx.newPage()).goto("https://www.facebook.com/");
  pop = await popup(b, "accounts"); await pop.waitForTimeout(700);
  ok("no token: no request", hitsOf(b) === 0);
  ok("…the list tells you which button to press (not just a symbol)", has(await text(pop, "#accountsList"), "press the refresh button above"), await text(pop, "#accountsList"));
  ok("…and shows no error toast", (await toastOf(pop)) === "", await toastOf(pop));
  await b.ctx.close();

  // 5. API pause: not even tried
  b = await boot({ fb: adsFb(TOK), graph: () => rowsPage });
  await adsPage(b);
  pop = await popup(b);
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 10 * 60000 }));
  await pop.reload(); await pop.waitForTimeout(500);
  await pop.click('[data-tab="accounts"]'); await pop.waitForTimeout(800);
  ok("API pause: no automatic request", hitsOf(b) === 0, String(hitsOf(b)));
  await b.ctx.close();

  // 6. failure: reported once, not retried on the next visit
  b = await boot({ fb: adsFb(TOK), graph: () => ({ status: 500, body: { error: { code: 1, message: "boom" } } }) });
  await adsPage(b);
  pop = await popup(b);
  await pop.click('[data-tab="accounts"]');
  ok("automatic load fails: the error is shown", await until(pop, () => /boom/.test(document.querySelector("#toast").textContent)), await toastOf(pop));
  await pop.click('[data-tab="token"]'); await resetLocks(pop); await pop.click('[data-tab="accounts"]'); await pop.waitForTimeout(700);
  ok("…and not retried by going back to the tab", hitsOf(b) === 1, String(hitsOf(b)));
  await b.ctx.close();

  // 7. dead session: the automatic load is skipped after the first 190
  b = await boot({ fb: adsFb(TOK), graph: () => ({ status: 400, body: { error: { code: 190, error_subcode: 463, message: "expired" } } }) });
  await adsPage(b);
  pop = await popup(b);
  await pop.click('[data-tab="accounts"]'); await until(pop, () => /no longer valid/.test(document.querySelector("#toast").textContent));
  await resetLocks(pop);
  pop = await popup(b); await pop.waitForTimeout(800);
  ok("dead token: reopening does not send anything", hitsOf(b) === 1, String(hitsOf(b)));
  await b.ctx.close();

  // 8. a slow load shows "Loading" instead of "not loaded"
  b = await boot({ fb: adsFb(TOK), graph: () => ({ delay: 1200, body: accountsJson }) });
  await adsPage(b);
  pop = await popup(b);
  await pop.click('[data-tab="accounts"]');
  ok("while loading the list says so", await until(pop, () => /Loading ad accounts/.test(document.querySelector("#accountsList").textContent)), await text(pop, "#accountsList"));
  await pop.click("#loadAccounts", { force: true }).catch(() => {});   // the button is disabled while loading: even a forced click must do nothing
  await pop.waitForTimeout(300);
  ok("a click during the automatic load neither errors nor doubles the request", !has(await toastOf(pop), "Refresh available") && hitsOf(b) === 1, `${await toastOf(pop)} / ${hitsOf(b)}`);
  ok("…then shows the rows", await rowsAre(pop, ".acc", 1));
  await b.ctx.close();
}

// ---------- "All time" spend ----------
async function allTimeFlows() {
  console.log("\n# accounts: all-time spend");
  const ins = (s) => ({ data: [{ spend: s, impressions: "10", inline_link_clicks: "2", date_start: "2026-09-01", date_stop: "2026-09-29" }] });
  const acc = (id, name, spent, today, month) => ({ account_id: id, name, account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: spent,
    ...(today ? { p_today: ins(today) } : {}), ...(month ? { p_month: ins(month) } : {}) });
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: { data: [
    acc("1", "New", "0", "3.00", null),          // Meta's total has not caught up: $3 spent today
    acc("2", "Old", "10000", "3.00", "20.00"),   // Meta's total ($100.00) is the bigger one
    acc("3", "Reset", "500", "3.00", "50.00"),   // total was reset below the last 30 days
  ] } }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await rowsAre(pop, ".acc", 3);
  const spends = () => pop.$$eval(".acc", (rows) => Object.fromEntries(rows.map((r) => [r.querySelector(".acc-name").textContent, r.querySelector(".acc-spend").textContent.trim()])));
  const today = await spends();
  ok("Today: unchanged", today.New === "$3.00" && today.Old === "$3.00" && today.Reset === "$3.00", JSON.stringify(today));
  await pop.click('#periodSeg .seg-btn:has-text("All time")');
  const all = await spends();
  ok("All time, Meta total lagging at 0 -> shows today's $3.00 (was $0.00)", all.New === "$3.00", JSON.stringify(all));
  ok("All time, Meta total bigger -> kept", all.Old === "$100.00", JSON.stringify(all));
  ok("All time, total reset below 30 days + today -> $53.00", all.Reset === "$53.00", JSON.stringify(all));
  ok("All time total is the sum", has(await text(pop, "#accountsTotal .total-value"), "$156.00"), await text(pop, "#accountsTotal .total-value"));
  const totalOf = async (name) => {
    await pop.click(`.acc:has(.acc-name:text-is("${name}")) .acc-title`);
    return pop.evaluate((n) => [...document.querySelectorAll(".acc")].find((r) => r.querySelector(".acc-name").textContent === n).querySelector(".kv dd").textContent.trim(), name);
  };
  ok("'Total spent' inside the row matches All time (lagging total)", (await totalOf("New")) === "$3.00", await totalOf("New"));
  ok("'Total spent' inside the row matches All time (reset total)", (await totalOf("Reset")) === "$53.00", await totalOf("Reset"));
  // a day later the cached "today" is stale ("—"), but All time must not jump back to Meta's lagging 0
  await pop.evaluate(() => chrome.storage.session.get("fetchedAt").then((o) => chrome.storage.session.set({ fetchedAt: o.fetchedAt - 2 * 86400000 })));
  const later = await popup(b, "accounts"); await rowsAre(later, ".acc", 3);
  await later.click('#periodSeg .seg-btn:has-text("All time")');
  const stable = await later.$$eval(".acc", (rows) => Object.fromEntries(rows.map((r) => [r.querySelector(".acc-name").textContent, r.querySelector(".acc-spend").textContent.trim()])));
  ok("All time is stable when the cached day is stale", stable.New === "$3.00" && stable.Reset === "$53.00", JSON.stringify(stable));
  await later.click('#periodSeg .seg-btn:has-text("Today")');
  const todayStale = await later.$$eval(".acc-spend", (n) => n.map((x) => x.textContent.trim()).join());
  ok("…while Today honestly shows unknown", !/\$/.test(todayStale), todayStale);
  await b.ctx.close();
}

// ---------- layout: long names, small windows ----------
async function layoutFlows() {
  console.log("\n# layout");
  const glued = "W".repeat(90);
  const long = "Very long ad account name with plenty of words to wrap or cut ".repeat(3);
  const accs = { data: [
    { account_id: "111", name: glued, account_status: 1, currency: "VND", timezone_name: "UTC", amount_spent: "123456789012345", business: { id: "9", name: glued + " Holding" }, adspixels: { data: [{ id: "7", name: glued }] }, funding_source_details: { display_string: long } },
    { account_id: "222", name: long, account_status: 2, disable_reason: 1, currency: "USD", timezone_name: "UTC", amount_spent: "1", business: { id: "8", name: long } },
  ] };
  const ads = { data: [{ id: "a1", name: glued, effective_status: "DISAPPROVED", ad_review_feedback: { global: { [glued]: glued } } }, { id: "a2", name: long, effective_status: "ACTIVE" }] };
  const b = await boot({ fb: adsFb(TOK), graph: (u) => isAds(u) ? { body: ads } : { body: accs } });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await loadAccounts(pop, 2);
  await pop.click(".acc .acc-title"); await pop.click(".acc.open [data-ads]");
  await until(pop, () => document.querySelectorAll(".ad").length === 2);
  const widthOf = (w) => pop.setViewportSize({ width: w, height: 700 }).then(() => pop.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })));
  for (const w of [800, 560, 480, 360, 320]) {
    const m = await widthOf(w);
    ok(`no horizontal scroll at ${w}px (long names, ads, BM, pixels)`, m.sw <= m.cw, JSON.stringify(m));
  }
  for (const tab of ["token", "cookies"]) {               // the copy buttons (incl. "Token + cookies + UA") and the UA box
    await pop.click(`[data-tab="${tab}"]`);
    for (const w of [560, 360, 320]) {
      const m = await widthOf(w);
      ok(`no horizontal scroll at ${w}px on the ${tab} tab`, m.sw <= m.cw, JSON.stringify(m));
    }
  }
  const body600 = await pop.evaluate(() => { document.documentElement.style.width = "1000px"; return document.body.getBoundingClientRect().width; });
  ok("the popup body is 560px wide", body600 === 560, String(body600));
  await b.ctx.close();
}

// ---------- a token change while the ads are loading ----------
async function staleFlows() {
  console.log("\n# token change while ads load");
  let tok = TOK;
  const b = await boot({ fb: (u) => adsFb(tok)(u), graph: (u) => isAds(u) ? { delay: 2500, body: { data: [{ id: "a1", name: "Ad", effective_status: "ACTIVE" }] } } : { body: accountsJson } });
  const ads = await adsPage(b);
  const pop = await popup(b, "accounts");
  await loadAccounts(pop, 1);
  await pop.click(".acc .acc-title"); await pop.click(".acc.open [data-ads]");
  ok("ads are loading", await until(pop, () => /Loading/.test(document.querySelector(".acc.open .ads")?.textContent || "")));
  tok = TOK2; await ads.reload();
  await pop.evaluate(() => document.querySelector("#refreshToken").click());
  ok("token changed meanwhile -> no 'Loading' left on screen", await until(pop, () => !/Loading/.test(document.querySelector(".acc.open .ads")?.textContent || "")), await text(pop, ".acc.open .ads"));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- optional fields: the page is asked again without the one field the token cannot read ----------
async function fieldsFlows() {
  console.log("\n# accounts: optional fields");
  const refuse = new Set();                               // fields the mock reports as nonexisting
  const b = await boot({ fb: adsFb(TOK), graph: (u) => {
    const bad = [...refuse].find((f) => (u.searchParams.get("fields") || "").includes(f));
    return bad ? { status: 400, body: { error: { code: 100, message: `(#100) Tried accessing nonexisting field (${bad}) on node type (AdAccount)` } } } : { body: accountsJson };
  } });
  await adsPage(b);
  const reads = () => b.hits.filter((h) => h.startsWith("/me/adaccounts"));
  refuse.add("adspixels");
  const pop = await popup(b, "accounts");
  ok("the list loads although pixels are refused", await rowsAre(pop, ".acc", 1));
  const r = reads();
  ok("one retry: the same page again, without that field only", r.length === 2 && has(r[0], "adspixels") && !has(r[1], "adspixels")
    && ["funding_source_details", "adtrust_dsl", "adspaymentcycle", "p_today"].every((f) => has(r[1], f)), r.join(" | "));
  await pop.click(".acc .acc-title");
  ok("pixels are shown as unknown, not as none", has(await text(pop, ".acc .kv"), "Pixels—"), await text(pop, ".acc .kv"));
  await resetLocks(pop); await pop.click("#loadAccounts");
  for (let i = 0; i < 40 && reads().length < 3; i++) await pop.waitForTimeout(100);
  await pop.waitForTimeout(500);
  ok("the refusal is remembered for this token: the next read does not ask for the field again", reads().length === 3 && !has(reads()[2], "adspixels"), reads().join(" | "));
  refuse.add("insights");
  await resetLocks(pop); await pop.click("#loadAccounts");
  ok("refused insights: rows still load, spend is unknown (a dash), not 0", await until(pop, () => document.querySelector(".acc-spend")?.textContent.trim() === "—"), await text(pop, ".acc-spend"));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- paging: pages are followed by cursor, ten at most ----------
async function pagingFlows() {
  console.log("\n# accounts: paging");
  const acc = (n) => ({ account_id: String(n), name: `Acc ${n}`, account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: "100" });
  let pages = 2;
  const b = await boot({ fb: adsFb(TOK), graph: (u) => {
    const after = u.searchParams.get("after"), n = after ? Number(after.slice(1)) + 1 : 1;   // cursor "c3" = after page 3
    return { body: { data: [acc(n)], ...(n < pages ? { paging: { next: `${GRAPH}/next`, cursors: { after: `c${n}` } } } : {}) } };
  } });
  await adsPage(b);
  const reads = () => b.hits.filter((h) => h.startsWith("/me/adaccounts"));
  const pop = await popup(b, "accounts");
  ok("two pages: both are read, the second by cursor", (await rowsAre(pop, ".acc", 2)) && reads().length === 2 && has(reads()[1], "after=c1") && !has(reads()[0], "after="), reads().join(" | "));
  ok("…the page size is 50", has(reads()[0], "limit=50"));
  pages = 99;                                             // an endless list
  await resetLocks(pop);
  const toast = await clickToast(pop, "#loadAccounts");
  ok("an endless list stops after 10 pages and says so", (await rowsAre(pop, ".acc", 10)) && reads().length === 12 && has(toast, "10-page limit"), `${reads().length} ${toast}`);
  ok("…the count line says the list is not complete", has(await text(pop, "#accountsTotal .total-meta"), "(not all)"), await text(pop, "#accountsTotal .total-meta"));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- request limits: one list per minute, one account's ads per 30 s ----------
async function slotFlows() {
  console.log("\n# accounts: request limits");
  const b = await boot({ fb: adsFb(TOK), graph: (u) => isAds(u) ? { body: { data: [{ id: "a1", name: "Ad", effective_status: "ACTIVE" }] } } : { body: accountsJson } });
  await adsPage(b);
  const pop = await popup(b);
  await pop.click('[data-tab="accounts"]');               // the automatic load takes the one-minute slot
  ok("the automatic load shows the list", await rowsAre(pop, ".acc", 1));
  const reads = () => b.hits.filter((h) => h.startsWith("/me/adaccounts")).length;
  const refused = await clickToast(pop, "#loadAccounts");
  const secs = Number((/in (\d+) s/.exec(refused) || [])[1]);
  ok("refresh within a minute: refused with the seconds left, nothing sent", reads() === 1 && secs >= 55 && secs <= 60, `${reads()} ${refused}`);
  await resetLocks(pop); await pop.click("#loadAccounts");
  for (let i = 0; i < 40 && reads() < 2; i++) await pop.waitForTimeout(100);
  ok("slots freed: the refresh goes out", reads() === 2, String(reads()));
  await openAds(pop);
  ok("ads: the account's refresh icon is locked after a read (30 s per account)", await pop.$eval(".acc.open .ads-refresh", (n) => n.disabled));
  await resetLocks(pop);
  ok("ads: freeing the slots re-enables the icon (the storage change reaches the buttons)", await until(pop, () => !document.querySelector(".acc.open .ads-refresh").disabled));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- accounts of the person's BMs that are not assigned to them ----------
async function bmFlows() {
  console.log("\n# accounts: BM accounts");
  const acc = (id, bm) => ({ account_id: id, name: `Acc ${id}`, account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: "100", business: { id: bm, name: `BM ${bm}` } });
  const b = await boot({ fb: adsFb(TOK), graph: (u) => {
    const p = u.pathname.replace(/^\/v[\d.]+\//, "/");
    if (p === "/me/adaccounts") return { body: { data: [acc("111", "900")] } };
    if (p === "/me/businesses") return { body: { data: [{ id: "900", name: "BM 900" }, { id: "901", name: "BM 901" }] } };
    if (p === "/900/owned_ad_accounts") return { body: { data: [acc("111", "900"), acc("222", "900")] } };   // 111 is assigned: listed once
    if (p === "/900/client_ad_accounts") return { body: { data: [acc("333", "777")] } };
    if (p === "/901/owned_ad_accounts") return { status: 400, body: { error: { code: 200, message: "(#200) Requires business_management permission" } } };
    return { body: { data: [] } };
  } });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("assigned + owned + client accounts of the BMs, each once", await rowsAre(pop, ".acc", 3), await text(pop, "#accountsList"));
  ok("…a BM edge the token can't read is skipped, the rest of the list stays", b.hits.some((h) => h.startsWith("/901/owned_ad_accounts")) && b.hits.some((h) => h.startsWith("/901/client_ad_accounts")), b.hits.join(" | "));
  ok("…the BM accounts carry the same fields as the assigned ones", has(b.hits.find((h) => h.startsWith("/900/owned_ad_accounts")) || "", "adtrust_dsl"));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

export const flows = { version: versionFlows, cache: cacheFlows, session: sessionFlows, ads: adsFlows, auto: autoFlows, alltime: allTimeFlows, layout: layoutFlows, stale: staleFlows, fields: fieldsFlows, paging: pagingFlows, slots: slotFlows, bm: bmFlows };
