// Ad accounts tab: API version, the account cache per FB user, dead sessions, ads, automatic load, all-time spend, layout.
import { GRAPH, TOK, TOK2, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, accountsJson, isAds, adsFb, boxWait, GONE, loadAccounts, openAds, stored, ROW, ratesOk, captureClipboard, clip, done, ACC, tr, PERIOD, adsLoadingRe, agoRe, idle, settle, trVar, trn, trx, untilText, useLang, waitFor, near } from "../harness.mjs";
import { LINKS } from "../../fb-helper/js/links.js";

const SESSION = (c) => tr("err.session", { c });                    // the dead-session sentence as the popup writes it
const KV = (...keys) => keys.map((k) => tr(k)).join();                // the labels of a row body, in order

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
  await done(b);
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
  ok("ads loaded", await openAds(pop) && (await pop.locator(`${ACC} .ad`).count()) === 1);
  pop = await popup(b, "accounts");
  ok("reopen keeps rows, open row and ads", (await rowsAre(pop, ROW,2)) && (await rowsAre(pop, `${ROW}.open`, 1)) && (await rowsAre(pop, `${ACC} .ad`, 1)));
  await fb.close(); pop = await popup(b, "accounts");
  ok("no FB tab: token gone", await boxWait(pop, GONE), await text(pop, "#tokenBox"));
  ok("no FB tab: cache stays", await rowsAre(pop, ROW,2));
  const c0 = calls; await clickToast(pop, "#loadAccounts");
  ok("refresh without a token sends nothing", calls === c0);
  await b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }]);
  pop = await popup(b, "accounts");
  ok("another FB user -> cache dropped", (await rowsAre(pop, ROW,0)) && (await until(pop, () => chrome.storage.session.get("accounts").then((o) => !o.accounts))));
  await done(b);
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
    await done(b);
  }
  const b = await boot({ fb: (u) => adsFb(tok)(u), graph: () => dead(190, 463) });
  const fb = await adsPage(b);
  let pop = await popup(b, "accounts");
  await clickToast(pop, "#loadAccounts");
  ok("dead flag persisted", ((await stored(pop, "dead")) || []).some((d) => d.token === TOK));
  await resetLocks(pop);
  const again = await clickToast(pop, "#loadAccounts");
  ok("second click: no request, session message", b.hits.length === 1 && has(again, SESSION("190/463")), `${b.hits.length} ${again}`);
  pop = await popup(b, "token");
  ok("card says the session is closed", await until(pop, (s) => document.querySelector("#kindCard").textContent.includes(s), tr("kind.dead", { c: "190/463" })), await text(pop, "#kindCard"));
  await pop.click("#checkToken");
  ok("Check reports it and sends nothing", (await until(pop, (s) => document.querySelector("#tokenInfo").textContent.includes(s), SESSION("190/463"))) && b.hits.length === 1, b.hits.join());
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
  ok("A → B → A: the first token is still known dead, no request", accHits(b).length === 2 && has(back, SESSION("190/463")), `${accHits(b).length} ${back}`);
  await done(b);

  // a dead session must not replace an ads list you already have
  const b2 = await boot({ fb: adsFb(TOK), graph: (u) => isAds(u) ? { body: { data: [{ id: "a1", name: "Keep me", effective_status: "ACTIVE" }] } } : { body: accountsJson } });
  await adsPage(b2);
  pop = await popup(b2, "accounts");
  await loadAccounts(pop, 1); await openAds(pop);
  b2.graph = () => dead(190, 463); await resetLocks(pop);
  const toast = await clickToast(pop, `${ROW}.open .ads-refresh`);
  ok("failed ads refresh keeps the list", has(await text(pop, `${ACC} .ads`), "Keep me"), await text(pop, `${ACC} .ads`));
  ok("…and reports the code in a toast", has(toast, "190/463"), toast);
  await done(b2);
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
  const names = await pop.$$eval(`${ACC} .ad > span:first-child`, (n) => n.map((x) => x.textContent));
  ok("problem ads come first", names.slice(0, 3).sort().join() === "IG only,Issues,Rejected" && names[3] === "Fine", names.join());
  const body = await text(pop, `${ACC} .ads`);
  ok("global reason shows its key AND description", has(body, "Personal attributes — Implies knowledge of personal traits"), body);
  ok("placement-specific reason shows the placement", has(body, "Instagram: Misleading claims — Unrealistic claims"), body);
  ok("rejection only on Instagram is explained (was empty)", has(body, "Instagram: Sensational content — Shocking"), body);
  ok("WITH_ISSUES reason comes from issues_info", has(body, "Ad set has no budget — Set a budget"), body);
  ok("issues_info of a healthy ad stays hidden", !has(body, "Soft note"), body);
  ok("summary counts the rejected", has(await text(pop, `${ACC} .ads-sum`), tr("ads.rejected", { n: 3 })), await text(pop, `${ACC} .ads-sum`));
  await done(b);

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
  ok("the late rejected ad is shown, first", (await text(pop, `${ACC} .ad > span:first-child`)) === "Late reject", await text(pop, `${ACC} .ad > span:first-child`));
  ok("101 ads, 'more' hint present", has(await text(pop, `${ACC} .ads-sum`), "101+") && trx("ads.more").test(await text(pop, `${ACC} .ads`)), await text(pop, `${ACC} .ads-sum`));
  await done(b);

  // Graph refuses issues_info -> repeated once without it
  b = await boot({ fb: adsFb(TOK), graph: (u) => {
    if (!isAds(u)) return { body: accountsJson };
    if (u.searchParams.get("fields").includes("issues_info")) return { status: 400, body: { error: { code: 100, message: "(#100) Tried accessing nonexisting field (issues_info) on node type (Ad)" } } };
    return { body: { data: [base] } };
  } });
  pop = await open(b);
  const ah = b.hits.filter((h) => h.includes("/ads?") && !h.includes("p_today"));
  ok("issues_info refused -> one retry without it", ah.length === 2 && !has(ah[1], "issues_info"), ah.join(" | "));
  ok("ads still shown", (await pop.locator(`${ACC} .ad`).count()) === 1);
  await done(b);

  // a failed refresh keeps the list; error text is never persisted
  let fail = false;
  b = await boot({ fb: adsFb(TOK), graph: (u) => isAds(u) ? (fail ? { status: 500, body: { error: { code: 1, message: "boom" } } } : { body: { data: [base] } }) : { body: accountsJson } });
  pop = await open(b);
  fail = true; await resetLocks(pop);
  const toast = await clickToast(pop, `${ROW}.open .ads-refresh`);
  ok("failed refresh: list kept", (await pop.locator(`${ACC} .ad`).count()) === 1);
  ok("failed refresh: error toast", has(toast, "boom"), toast);
  ok("failed refresh: the row says the list is old", has(await text(pop, `${ACC} .ads`), tr("ads.stale", { m: tr("err.graphIs", { m: "boom" }) })), await text(pop, `${ACC} .ads`));
  ok("…and that mark is not persisted", !JSON.stringify(await stored(pop, "ads")).includes("stale"));
  ok("stored ads have no error text", !JSON.stringify(await stored(pop, "ads")).includes("boom"));
  await done(b);

  b = await boot({ fb: adsFb(TOK), graph: (u) => isAds(u) ? { status: 500, body: { error: { code: 1, message: "boom" } } } : { body: accountsJson } });
  pop = await open(b);
  ok("first load fails: error on the row", has(await text(pop, `${ACC} .ads`), "boom"), await text(pop, `${ACC} .ads`));
  ok("…and is not persisted", !JSON.stringify((await stored(pop, "ads")) || {}).includes("boom"));
  await done(b);

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
  await untilText(pop, "#accountsList .ads-sum", trx("ads.statsAt"));
  const adLines = () => pop.$$eval(`${ACC} .ad`, (n) => n.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  const listCalls = () => b.hits.filter((h) => h.includes("/ads?") && !h.includes("p_today")).length;
  const statCalls = () => b.hits.filter((h) => h.includes("/ads?") && h.includes("p_today")).length;
  const statCalls2 = (bb) => bb.hits.filter((h) => h.includes("/ads?") && h.includes("p_today")).length;
  const listN = (bb) => bb.hits.filter((h) => h.includes("/ads?") && !h.includes("p_today")).length;
  let lines = await adLines();
  const stat = b.hits.find((h) => h.includes("/ads?") && h.includes("p_today"));
  ok("the numbers are a separate read with all four periods", statCalls() === 1 && ["p_today", "p_yesterday", "p_week", "p_month", "p_all", "maximum", "spend", "impressions", "inline_link_clicks"].every((k) => has(stat, k)), stat);
  ok("the list read stays free of insights", !b.hits.filter((h) => h.includes("/ads?") && !h.includes("p_today")).some((h) => has(h, "insights")));
  ok("ad row: spend, impressions, clicks", has(lines[0], "$12.40") && has(lines[0], `3,100 ${trn(3100, "ads.imp")}`) && has(lines[0], `48 ${trn(48, "ads.clk")}`) && has(lines[0], "CPC $0.26"), lines[0]);
  ok("singular counts", has(lines[3], `1 ${trn(1, "ads.imp")} `) && has(lines[3], `1 ${trn(1, "ads.clk")}`) && !has(lines[3], `1 ${trn(2, "ads.clk")}`) && !has(lines[3], `1 ${trn(2, "ads.imp")}`), lines[3]);
  ok("active ad without delivery says so", has(lines[1], tr("ads.noDelivery")), lines[1]);
  ok("paused ad without delivery stays quiet", !has(lines[2], tr("ads.noDelivery")) && !has(lines[2], "$"), lines[2]);
  ok("the sum line says how old the numbers are", has(await text(pop, `${ACC} .ads-sum`), tr("ads.statsAt", { a: tr("ago.now") })), await text(pop, `${ACC} .ads-sum`));
  const calls = statCalls();
  await pop.click(PERIOD("week"));
  lines = await adLines();
  ok("switching to 7 days shows that period's numbers", has(lines[0], "$80.00") && has(lines[0], `310 ${trn(310, "ads.clk")}`), lines[0]);
  ok("…without a request", statCalls() === calls && listCalls() === 1);
  await pop.click(PERIOD("all"));
  lines = await adLines();
  ok("All time: per-ad numbers and CPC", has(lines[0], "$500.00") && has(lines[0], `400,000 ${trn(400000, "ads.imp")}`) && has(lines[0], `9,000 ${trn(9000, "ads.clk")}`) && has(lines[0], "CPC $0.06"), lines[0]);
  ok("All time: no extra note under the sum line", (await pop.locator(`${ACC} .ads .hint`).count()) === 0, await text(pop, `${ACC} .ads`));
  ok("…still without a request", statCalls() === calls);
  await pop.click(PERIOD("today"));
  ok("numbers are persisted compact (no raw Graph objects)", !JSON.stringify(await stored(pop, "ads")).includes("date_start"));
  // a day later the cached numbers must not pass for today's
  await pop.evaluate(() => chrome.storage.session.get("ads").then((o) => { for (const v of Object.values(o.ads)) v.statsAt -= 2 * 86400000; return chrome.storage.session.set({ ads: o.ads }); }));
  const oldPop = await popup(b, "accounts"); await rowsAre(oldPop, ROW,1);
  const oldTxt = await oldPop.evaluate(() => document.querySelector("#accountsList .ads").textContent);
  ok("cached from an earlier day: hint, no numbers", has(oldTxt, tr("ads.old")) && !has(oldTxt, "$12.40"), oldTxt);
  await done(b);

  // the button above the list refreshes the accounts only; each account's ads have their own refresh icon
  const liveAds = listAds.map((a) => ({ ...a })), liveRows = statRows.map((r) => ({ ...r }));
  b = await boot({ fb: adsFb(TOK), graph: (u) => !isAds(u) ? { body: accountsJson } : isStats(u) ? { body: { data: liveRows } } : { body: { data: liveAds } } });
  pop = await open(b);
  await untilText(pop, "#accountsList .ads-sum", trx("ads.statsAt"));
  const accReads = () => accHits(b).filter((h) => !h.includes("/ads?")).length;
  const [l0, s0, a0] = [listCalls(), statCalls(), accReads()];
  await resetLocks(pop); await pop.click("#loadAccounts");
  await waitFor(() => accReads() >= a0 + 1); await idle(pop, "#tab-accounts"); await settle(pop);      // the accounts read is done; an ads read would have been started by now
  ok("the top refresh reads the accounts only, the ads cost nothing", accReads() === a0 + 1 && listCalls() === l0 && statCalls() === s0, `${a0}/${l0}/${s0} -> ${accReads()}/${listCalls()}/${statCalls()}`);
  ok("…and the ads card is still expanded", (await pop.locator(`${ACC} .ad`).count()) === 4);
  liveAds[0].name = "Busy renamed"; liveRows[0].p_today = ins("20", "4000", "50");
  await resetLocks(pop); await pop.click(`${ROW}.open .ads-refresh`);
  await until(pop, () => /Busy renamed/.test(document.querySelector("#accountsList .ad")?.textContent || "") && /\$20\.00/.test(document.querySelector("#accountsList .ad")?.textContent || ""));
  lines = await adLines();
  ok("the ads icon re-reads this account's ads: new list and new numbers", has(lines[0], "Busy renamed") && has(lines[0], "$20.00") && has(lines[0], `50 ${trn(50, "ads.clk")}`), lines[0]);
  ok("…one list read, one numbers read, no accounts read", listCalls() === l0 + 1 && statCalls() === s0 + 1 && accReads() === a0 + 1, `${l0}/${s0} -> ${listCalls()}/${statCalls()}, accounts ${accReads()}`);
  ok("…the list stays expanded", (await pop.locator(`${ACC} .ad`).count()) === 4);
  // a popup opened hours later shows the old numbers; the ads icon replaces them
  // (up to 3 h, but never past UTC midnight: the mock account is in UTC and numbers of an earlier day are hidden)
  await pop.evaluate(() => { const d = new Date(), back = Math.min(3 * 3600000, d - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 90000);
    return chrome.storage.session.get("ads").then((o) => { for (const v of Object.values(o.ads)) v.statsAt -= back; return chrome.storage.session.set({ ads: o.ads }); }); });
  const re = await popup(b, "accounts"); await rowsAre(re, ROW,1);
  await untilText(re, "#accountsList .ads-sum", trx("ads.statsAt", { a: agoRe() }));
  ok("reopened later: the sum line shows the age of the numbers", trx("ads.statsAt", { a: agoRe() }).test(await text(re, `${ACC} .ads-sum`)), await text(re, `${ACC} .ads-sum`));
  liveRows[0].p_today = ins("33", "5000", "60");
  await resetLocks(re); await re.click(`${ROW}.open .ads-refresh`);
  await untilText(re, "#accountsList .ads-sum", trx("ads.statsAt", { a: tr("ago.now") }));
  ok("…the ads icon brings the numbers up to date", has(await text(re, `${ACC} .ads-sum`), tr("ads.statsAt", { a: tr("ago.now") })) && has(await text(re, `${ACC} .ad`), "$33.00"), await text(re, `${ACC} .ads-sum`) + " | " + await text(re, `${ACC} .ad`));
  await re.close();
  // the ads section is flat (no tinted box), lines up with the facts above it, and its header does not move when the list folds or unfolds
  const geo = () => pop.$eval(`${ROW}.open .ads-toggle`, (n) => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(); });
  const flat = () => pop.evaluate(() => {
    const sec = document.querySelector("#accountsList .lrow.open .ads-sec"), body = document.querySelector("#accountsList .lrow.open .lrow-body"), kv = body.querySelector(".lrow-kv");
    const cs = getComputedStyle(sec), bb = body.getBoundingClientRect(), r = sec.getBoundingClientRect();
    return { bg: cs.backgroundColor, radius: cs.borderRadius, left: Math.round(r.left - kv.getBoundingClientRect().left), right: Math.round(bb.right - r.right) };
  });
  const gOpen = await geo(), fl = await flat();
  ok("ads section: no tinted box (transparent, square) and the same left edge as the facts", fl.bg === "rgba(0, 0, 0, 0)" && fl.radius === "0px" && fl.left === 0, JSON.stringify(fl));
  ok("…and the same 16 px gutter on the right as every row", fl.right === 16, JSON.stringify(fl));
  await pop.hover(`${ROW}.open .ads-toggle`);
  ok("hover on the ads header keeps the bar as it is (words only, like the tabs)", (await pop.$eval(`${ROW}.open .ads-toggle`, (n) => getComputedStyle(n).backgroundColor)) === "rgba(0, 0, 0, 0)");
  await pop.click(`${ROW}.open .ads-toggle`);                      // collapse
  const gShut = await geo();
  ok("folding the ads keeps the header exactly where it was", gOpen === gShut, `${gOpen} -> ${gShut}`);
  ok("…and folded, the refresh icon is still there", (await pop.locator(`${ROW}.open .ads-refresh`).count()) === 1);
  await pop.click(`${ROW}.open .ads-toggle`);                      // expand
  ok("unfolding keeps it there too", (await geo()) === gOpen, `${gOpen} -> ${await geo()}`);
  await done(b);

  // only the all-time part is refused: the other periods are read again and shown, All time says so
  statsMode = "noall";
  b = await boot({ fb: adsFb(TOK), graph: statMock });
  pop = await open(b);
  await untilText(pop, "#accountsList .ads-sum", trx("ads.statsAt"));
  const sc = b.hits.filter((h) => h.includes("/ads?") && h.includes("p_today"));
  ok("all-time refused -> one retry without it", sc.length === 2 && has(sc[0], "p_all") && !has(sc[1], "p_all") && has(sc[1], "p_month"), sc.length + " " + sc.map((h) => has(h, "p_all")).join());
  lines = await adLines();
  ok("all-time refused -> Today still shown", has(lines[0], "$12.40"), lines[0]);
  await pop.click(PERIOD("all"));
  ok("all-time refused -> no numbers, one honest hint", (await pop.locator(`${ACC} .ad-stats`).count()) === 0 && has(await text(pop, `${ACC} .ads`), tr("ads.noAll")), await text(pop, `${ACC} .ads`));
  await done(b);

  // the numbers fail (too heavy / field refused / server down): the list stays, one hint, nothing else lost
  for (const mode of ["heavy", "field", "down"]) {
    statsMode = mode;
    b = await boot({ fb: adsFb(TOK), graph: statMock });
    pop = await open(b);
    await until(pop, (s) => (document.querySelector("#accountsList .ads")?.textContent || "").includes(s), tr("ads.statsFail"));
    ok(`numbers ${mode}: list shown (4 ads), hint, no stats lines`, (await pop.locator(`${ACC} .ad`).count()) === 4 && (await pop.locator(`${ACC} .ad-stats`).count()) === 0 && has(await text(pop, `${ACC} .ads`), tr("ads.statsFail")), await text(pop, `${ACC} .ads`));
    ok(`numbers ${mode}: the failure mark is not persisted`, !JSON.stringify(await stored(pop, "ads")).includes("statsFail"));
    if (mode !== "down") {
      await resetLocks(pop);
      const before = statCalls2(b), l1 = listN(b);
      await pop.click(`${ROW}.open .ads-refresh`);
      await waitFor(() => listN(b) > l1);                                    // the account's ads list was read again…
      await until(pop, (src) => !new RegExp(src).test(document.querySelector("#accountsList .ads")?.textContent || ""), adsLoadingRe().source);   // …and nothing is loading any more: the numbers were not asked for
      ok(`numbers ${mode}: refused for this account -> not asked again`, statCalls2(b) === before, `${before} -> ${statCalls2(b)}`);
    }
    await done(b);
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
  ok("first visit: rows appear without pressing refresh", await rowsAre(pop, ROW,1));
  ok("…with exactly one request", hitsOf(b) === 1, String(hitsOf(b)));
  ok("…and no toast for an automatic load", (await toastOf(pop)) === "", await toastOf(pop));
  await pop.click('[data-tab="token"]'); await pop.click('[data-tab="accounts"]'); await settle(pop); await idle(pop, "#tab-accounts");
  ok("second visit in the same popup: no new request", hitsOf(b) === 1, String(hitsOf(b)));

  // 2. reopening: the popup remembers the Accounts tab; the one-minute slot still holds -> silent, cache shown
  pop = await popup(b); await rowsAre(pop, ROW, 1); await settle(pop); await idle(pop, "#tab-accounts");     // the cache is on screen and the automatic decision has been taken
  ok("reopen within a minute: no request, cache shown, no complaint", hitsOf(b) === 1 && (await rowsAre(pop, ROW,1)) && !trx("acc.wait").test(await toastOf(pop)), `${hitsOf(b)} ${await toastOf(pop)}`);
  // 3. a minute later, same FB page: reopening the popup still sends nothing (the list is from this page load)
  await resetLocks(pop);
  pop = await popup(b); await rowsAre(pop, ROW, 1); await settle(pop); await idle(pop, "#tab-accounts");
  ok("reopen after a minute, FB page not reloaded: no request", hitsOf(b) === 1, String(hitsOf(b)));
  ok("the popup is as tall as its content on the Accounts tab (no fixed height)", await pop.evaluate(() => getComputedStyle(document.body).minHeight === "0px"));
  // 4. the FB page is reloaded: within 10 minutes of the last load that is no reason to spend a request (P6)…
  await fbTab.reload(); await resetLocks(pop);
  pop = await popup(b); await rowsAre(pop, ROW, 1); await settle(pop); await idle(pop, "#tab-accounts");
  ok("FB page reloaded 1 minute after the load: the list is fresh, no automatic refresh", hitsOf(b) === 1, String(hitsOf(b)));
  // …a list older than 10 minutes is refreshed once by the next popup open, the one after does not
  await pop.evaluate(() => chrome.storage.session.get("fetchedAt").then((o) => chrome.storage.session.set({ fetchedAt: o.fetchedAt - 11 * 60000 })));
  await fbTab.reload(); await resetLocks(pop);
  pop = await popup(b);
  await waitFor(() => hitsOf(b) >= 2); await idle(pop, "#tab-accounts");
  ok("after an FB page reload, with a list older than 10 minutes: one automatic refresh", hitsOf(b) === 2, String(hitsOf(b)));
  await resetLocks(pop);
  pop = await popup(b); await rowsAre(pop, ROW, 1); await settle(pop); await idle(pop, "#tab-accounts");
  ok("…and only one: reopening again sends nothing", hitsOf(b) === 2, String(hitsOf(b)));
  // 5. the manual refresh still works any time the slot allows
  await resetLocks(pop);
  await pop.click("#loadAccounts"); await waitFor(() => hitsOf(b) >= 3);
  ok("the refresh button still reloads", hitsOf(b) === 3, String(hitsOf(b)));
  await done(b);

  // 4. no token anywhere: nothing sent, the empty state says what to do
  b = await boot({ fb: () => "<p>feed</p>", graph: () => rowsPage });
  await (await b.ctx.newPage()).goto("https://www.facebook.com/");
  pop = await popup(b, "accounts");
  await until(pop, () => !!document.querySelector('#accountsList .lempty[data-state="notoken"]'));      // the automatic try ended: it found no token
  ok("no token: no request", hitsOf(b) === 0);
  ok("…the list says why in the Token tab's own words, with an icon and ONE 'Try again' button (not just a symbol)", (await text(pop, "#accountsList .lempty-text")) === (await text(pop, "#tokenBox")) && (await text(pop, "#tokenBox")) === tr("grab.notFound", { where: "www.facebook.com" })
    && (await text(pop, "#accountsList .lempty .btn")) === tr("list.retry") && (await pop.locator("#accountsList .lempty .btn").count()) === 1 && (await pop.locator("#accountsList .lempty .i").count()) === 1, await text(pop, "#accountsList"));
  ok("…the period, the total and 'Active IDs' are not shown without rows", await pop.evaluate(() => ["#periodSeg", "#accountsTotal", "#copyLiveIds"].every((s) => getComputedStyle(document.querySelector(s)).display === "none")));
  ok("…and shows no error toast", (await toastOf(pop)) === "", await toastOf(pop));
  await done(b);

  // 5. API pause: not even tried
  b = await boot({ fb: adsFb(TOK), graph: () => rowsPage });
  await adsPage(b);
  pop = await popup(b);
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 10 * 60000 }));
  await pop.reload(); await boxWait(pop, /^EAAB/);
  await pop.click('[data-tab="accounts"]');
  await until(pop, () => !!document.querySelector('#accountsList .lempty[data-state="idle"]'));         // the pause was seen: "Not loaded yet", nothing sent
  ok("API pause: no automatic request", hitsOf(b) === 0, String(hitsOf(b)));
  await done(b);

  // 6. failure: reported once, not retried on the next visit
  b = await boot({ fb: adsFb(TOK), graph: () => ({ status: 500, body: { error: { code: 1, message: "boom" } } }) });
  await adsPage(b);
  pop = await popup(b);
  await pop.click('[data-tab="accounts"]');
  ok("automatic load fails: the error is shown", await until(pop, () => /boom/.test(document.querySelector("#toast").textContent)), await toastOf(pop));
  await pop.click('[data-tab="token"]'); await resetLocks(pop); await pop.click('[data-tab="accounts"]'); await settle(pop); await idle(pop, "#tab-accounts");
  ok("…and not retried by going back to the tab", hitsOf(b) === 1, String(hitsOf(b)));
  await done(b);

  // 7. dead session: the automatic load is skipped after the first 190
  b = await boot({ fb: adsFb(TOK), graph: () => ({ status: 400, body: { error: { code: 190, error_subcode: 463, message: "expired" } } }) });
  await adsPage(b);
  pop = await popup(b);
  await pop.click('[data-tab="accounts"]'); await until(pop, (s) => document.querySelector("#toast").textContent.includes(s), SESSION("190/463"));
  await resetLocks(pop);
  pop = await popup(b);
  await until(pop, () => !!document.querySelector('#accountsList .lempty[data-state="dead"]'));
  ok("dead token: reopening does not send anything", hitsOf(b) === 1, String(hitsOf(b)));
  await done(b);

  // 8. a slow load shows "Loading" instead of "not loaded"
  b = await boot({ fb: adsFb(TOK), graph: () => ({ delay: 1200, body: accountsJson }) });
  await adsPage(b);
  pop = await popup(b);
  await pop.click('[data-tab="accounts"]');
  ok("while loading the list says so", await until(pop, (s) => document.querySelector("#accountsList").textContent.includes(s), tr("acc.loading")), await text(pop, "#accountsList"));
  await waitFor(() => hitsOf(b) >= 1);                                  // the request is on its way (the mock holds the answer for 1.2 s)
  await pop.click("#loadAccounts", { force: true }).catch(() => {});   // the button is disabled while loading: even a forced click must do nothing
  await settle(pop);
  ok("a click during the automatic load neither errors nor doubles the request", !trx("acc.wait").test(await toastOf(pop)) && hitsOf(b) === 1, `${await toastOf(pop)} / ${hitsOf(b)}`);
  ok("…then shows the rows", await rowsAre(pop, ROW,1));
  await done(b);
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
  await rowsAre(pop, ROW,3);
  const spends = () => pop.$$eval(ROW, (rows) => Object.fromEntries(rows.map((r) => [r.querySelector(".lrow-name").textContent, r.querySelector(".lrow-value").textContent.trim()])));
  const today = await spends();
  ok("Today: unchanged", today.New === "$3.00" && today.Old === "$3.00" && today.Reset === "$3.00", JSON.stringify(today));
  await pop.click(PERIOD("all"));
  const all = await spends();
  ok("All time, Meta total lagging at 0 -> shows today's $3.00 (was $0.00)", all.New === "$3.00", JSON.stringify(all));
  ok("All time, Meta total bigger -> kept", all.Old === "$100.00", JSON.stringify(all));
  ok("All time, total reset below 30 days + today -> $53.00", all.Reset === "$53.00", JSON.stringify(all));
  ok("All time total is the sum", has(await text(pop, "#accountsTotal .total-value"), "$156.00"), await text(pop, "#accountsTotal .total-value"));
  const totalOf = async (name) => {
    await pop.click(`${ROW}:has(.lrow-name:text-is("${name}")) .lrow-title`);
    const v = await pop.evaluate((n) => [...document.querySelectorAll("#accountsList .lrow")].find((r) => r.querySelector(".lrow-name").textContent === n).querySelector(".lrow-kv dd")?.textContent.trim(), name);
    await pop.click(`${ROW}:has(.lrow-name:text-is("${name}")) .lrow-title`);      // close it again
    return v;
  };
  ok("'Spent' inside the row matches All time (lagging total)", (await totalOf("New")) === "$3.00", await totalOf("New"));
  ok("'Spent' inside the row matches All time (reset total)", (await totalOf("Reset")) === "$53.00", await totalOf("Reset"));
  // a day later the cached "today" is stale ("—"), but All time must not jump back to Meta's lagging 0
  await pop.evaluate(() => chrome.storage.session.get("fetchedAt").then((o) => chrome.storage.session.set({ fetchedAt: o.fetchedAt - 2 * 86400000 })));
  const later = await popup(b, "accounts"); await rowsAre(later, ROW,3);
  await later.click(PERIOD("all"));
  const stable = await later.$$eval(ROW, (rows) => Object.fromEntries(rows.map((r) => [r.querySelector(".lrow-name").textContent, r.querySelector(".lrow-value").textContent.trim()])));
  ok("All time is stable when the cached day is stale", stable.New === "$3.00" && stable.Reset === "$53.00", JSON.stringify(stable));
  await later.click(PERIOD("today"));
  const todayStale = await later.$$eval(`${ROW} .lrow-value`, (n) => n.map((x) => x.textContent.trim()).join());
  ok("…while Today honestly shows unknown", !/\$/.test(todayStale), todayStale);
  await done(b);
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
  await pop.click(`${ROW} .lrow-title`); await pop.click(`${ROW}.open [data-ads]`);
  await until(pop, () => document.querySelectorAll("#accountsList .ad").length === 2);
  await pop.click(`${ROW}[data-row="222"] .lrow-title`);                  // the second row (disabled, long name and business) open too
  const widthOf = (w) => pop.setViewportSize({ width: w, height: 700 }).then(() => pop.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })));
  for (const w of [800, 560, 480, 380, 360, 320]) {
    const m = await widthOf(w);
    ok(`no horizontal scroll at ${w}px (long names, ads, business, pixels, payment)`, m.sw <= m.cw, JSON.stringify(m));
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
  await done(b);
}

// ---------- a token change while the ads are loading ----------
async function staleFlows() {
  console.log("\n# token change while ads load");
  let tok = TOK;
  const b = await boot({ fb: (u) => adsFb(tok)(u), graph: (u) => isAds(u) ? { delay: 2500, body: { data: [{ id: "a1", name: "Ad", effective_status: "ACTIVE" }] } } : { body: accountsJson } });
  const ads = await adsPage(b);
  const pop = await popup(b, "accounts");
  await loadAccounts(pop, 1);
  await pop.click(`${ROW} .lrow-title`); await pop.click(`${ROW}.open [data-ads]`);
  ok("ads are loading", await until(pop, (src) => new RegExp(src).test(document.querySelector("#accountsList .lrow.open .ads")?.textContent || ""), adsLoadingRe().source));
  tok = TOK2; await ads.reload();
  await pop.evaluate(() => document.querySelector("#refreshToken").click());
  ok("token changed meanwhile -> no 'Loading' left on screen", await until(pop, (src) => !new RegExp(src).test(document.querySelector("#accountsList .lrow.open .ads")?.textContent || ""), adsLoadingRe().source), await text(pop, `${ROW}.open .ads`));
  await done(b);
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
  ok("the list loads although pixels are refused", await rowsAre(pop, ROW,1));
  const r = reads();
  ok("one retry: the same page again, without that field only", r.length === 2 && has(r[0], "adspixels") && !has(r[1], "adspixels")
    && ["funding_source_details", "adtrust_dsl", "adspaymentcycle", "p_today"].every((f) => has(r[1], f)), r.join(" | "));
  await pop.click(`${ROW} .lrow-title`);
  ok("pixels are unknown (the pair is not drawn), not 'none'", !has(await text(pop, `${ROW} .lrow-kv`), tr("acc.pixels")), await text(pop, `${ROW} .lrow-kv`));
  await resetLocks(pop); await pop.click("#loadAccounts");
  await waitFor(() => reads().length >= 3); await idle(pop, "#tab-accounts");
  ok("the refusal is remembered for this token: the next read does not ask for the field again", reads().length === 3 && !has(reads()[2], "adspixels"), reads().join(" | "));
  refuse.add("insights");
  await resetLocks(pop); await pop.click("#loadAccounts");
  ok("refused insights: rows still load, spend is unknown (a dash), not 0", await until(pop, () => document.querySelector("#accountsList .lrow-value")?.textContent.trim() === "—"), await text(pop, `${ROW} .lrow-value`));
  await done(b);
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
  ok("two pages: both are read, the second by cursor", (await rowsAre(pop, ROW,2)) && reads().length === 2 && has(reads()[1], "after=c1") && !has(reads()[0], "after="), reads().join(" | "));
  ok("…the page size is 50", has(reads()[0], "limit=50"));
  pages = 99;                                             // an endless list
  await resetLocks(pop);
  const toast = await clickToast(pop, "#loadAccounts");
  ok("an endless list stops after 10 pages and says so", (await rowsAre(pop, ROW,10)) && reads().length === 12 && has(toast, tr("acc.truncated")), `${reads().length} ${toast}`);
  ok("…the count line says the list is not complete", has(await text(pop, "#accountsTotal .total-meta"), tr("acc.notAll").trim()), await text(pop, "#accountsTotal .total-meta"));
  await done(b);
}

// ---------- request limits: one list per minute, one account's ads per 30 s ----------
async function slotFlows() {
  console.log("\n# accounts: request limits");
  const b = await boot({ fb: adsFb(TOK), graph: (u) => isAds(u) ? { body: { data: [{ id: "a1", name: "Ad", effective_status: "ACTIVE" }] } } : { body: accountsJson } });
  await adsPage(b);
  const pop = await popup(b);
  await pop.click('[data-tab="accounts"]');               // the automatic load takes the one-minute slot
  ok("the automatic load shows the list", await rowsAre(pop, ROW,1));
  const reads = () => b.hits.filter((h) => h.startsWith("/me/adaccounts")).length;
  const refused = await clickToast(pop, "#loadAccounts");
  const secs = Number(trVar("acc.wait", refused));
  ok("refresh within a minute: refused with the seconds left, nothing sent", reads() === 1 && secs >= 55 && secs <= 60, `${reads()} ${refused}`);
  await resetLocks(pop); await pop.click("#loadAccounts");
  await waitFor(() => reads() >= 2);
  ok("slots freed: the refresh goes out", reads() === 2, String(reads()));
  await openAds(pop);
  ok("ads: the account's refresh icon is locked after a read (30 s per account)", await pop.$eval(`${ROW}.open .ads-refresh`, (n) => n.disabled));
  await resetLocks(pop);
  ok("ads: freeing the slots re-enables the icon (the storage change reaches the buttons)", await until(pop, () => !document.querySelector("#accountsList .lrow.open .ads-refresh").disabled));
  await done(b);
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
  ok("assigned + owned + client accounts of the BMs, each once", await rowsAre(pop, ROW,3), await text(pop, "#accountsList"));
  ok("…a BM edge the token can't read is skipped, the rest of the list stays", b.hits.some((h) => h.startsWith("/901/owned_ad_accounts")) && b.hits.some((h) => h.startsWith("/901/client_ad_accounts")), b.hits.join(" | "));
  ok("…the BM accounts carry the same fields as the assigned ones", has(b.hits.find((h) => h.startsWith("/900/owned_ad_accounts")) || "", "adtrust_dsl"));
  await done(b);
}

// ---------- the list: groups, order, silent healthy rows, problem words, fixes ----------
const day = new Date().toISOString().slice(0, 10);
const ins = (spend, imp = "1000", clicks = "30") => ({ data: [{ spend: String(spend), impressions: imp, inline_link_clicks: clicks, date_start: day, date_stop: day }] });
const TS = { id: "9001", name: "Tailspin Toys" }, CO = { id: "9002", name: "Contoso Ads" }, FA = { id: "9003", name: "Fabrikam Media" };
const mk = (id, name, cur, status, reason, today, biz, extra = {}) => ({ account_id: id, name, account_status: status, disable_reason: reason, currency: cur, timezone_name: "UTC",
  amount_spent: String(Math.round((today || 0) * 100 * 9)), balance: "0", spend_cap: "0", created_time: "2025-03-04T10:00:00+0000", business_country_code: "US",
  p_today: ins(today || 0, "12400", "310"), p_yesterday: ins(0), p_week: ins(0), p_month: ins(0), ...(biz ? { business: biz } : {}), ...extra });
// 13 accounts assigned to the person (3 businesses + personal) and one that only the business edge shows. USD / EUR / VND, one of every problem.
const MINE = [
  mk("1001", "TS | US | Prospecting", "USD", 1, 0, 1240.5, TS, { adtrust_dsl: "2500", balance: "12000", funding_source_details: { display_string: "Visa ·· 4242" },
    adspixels: { data: [{ id: "55501", name: "Main pixel" }] }, adspaymentcycle: { data: [{ threshold_amount: "25000" }] }, timezone_name: "Europe/Kiev" }),
  mk("1002", "TS | US | Retargeting", "USD", 1, 0, 215.3, TS),
  mk("1003", "TS | CA | Test", "USD", 2, 1, 0, TS),                       // disabled: ads policy
  mk("1004", "TS | Old 2023", "USD", 101, 0, 0, TS),                      // closed
  mk("2001", "Contoso EU 1", "EUR", 1, 0, 680.4, CO),
  mk("2002", "Contoso EU 2", "EUR", 3, 0, 90, CO, { balance: "35000" }),  // unpaid
  mk("2003", "Contoso Compromised", "EUR", 2, 15, 0, CO),                 // disabled: compromised (Secure + Appeal)
  mk("2004", "Contoso Restricted", "EUR", 1, 5, 20, CO),                  // active, restricted
  mk("3001", "Fabrikam VN 1", "VND", 1, 0, 25000000, FA),
  mk("3002", "Fabrikam VN 2", "VND", 7, 0, 0, FA),                        // risk review
  mk("3004", "Fabrikam Closed for good", "VND", 2, 7, 0, FA),             // disabled for good
  mk("4001", "Personal | Alex", "USD", 1, 0, 55.2, null),
  mk("4002", "Personal | Grace", "USD", 9, 0, 0, null),                   // grace period
];
const VIA = [mk("3003", "Fabrikam Unassigned", "VND", 1, 0, 1200000, FA)];   // read through business 9003, not assigned
const BMS = { data: [TS, CO, FA].map((x) => ({ id: x.id, name: x.name })) };
const listGraph = (accounts = MINE, via = VIA) => (u) => {
  const p = u.pathname.replace(/^\/v[\d.]+\//, "/");
  if (p === "/me/adaccounts") return { body: { data: accounts } };
  if (p === "/me/businesses") return { body: BMS };
  if (p === "/9003/owned_ad_accounts") return { body: { data: via } };
  return { body: { data: [] } };
};
// The list as the screen shows it, in DOM order: group headers and rows.
const dump = (p) => p.evaluate(() => [...document.querySelectorAll("#accountsList > *")].map((n) => {
  if (n.classList.contains("lgroup")) return { g: n.querySelector(".lgroup-text").textContent, count: n.querySelector(".lgroup-count").textContent, value: n.querySelector(".lgroup-value")?.textContent.replace(/\s+/g, " ").trim(), valueTitle: n.querySelector(".lgroup-value")?.title };
  const st = n.querySelector(".lrow-status"), fix = n.querySelector(".lrow-head .lrow-fix"), val = n.querySelector(".lrow-value");
  return { id: n.dataset.row, name: n.querySelector(".lrow-name").textContent, status: st?.querySelector(".lrow-status-text").textContent ?? null, tone: st ? st.className.replace("lrow-status", "").trim() : null,
    statusTitle: st?.title || null, sr: n.querySelector(".lrow-sub .sr-only")?.textContent ?? null, fix: fix?.textContent.trim() ?? null, href: fix?.href ?? null, aria: fix?.getAttribute("aria-label") ?? null,
    fixes: n.querySelectorAll(".lrow-head .lrow-fix").length, more: n.querySelector(".lrow-more")?.textContent ?? null,
    value: val.textContent.replace(/\s+/g, " ").trim(), muted: val.classList.contains("muted"), valueTitle: val.title || null, id2: n.querySelector(".lrow-idtext")?.textContent ?? null };
}));
const names = (d) => d.map((x) => x.g ?? x.name);

async function listFlow() {
  console.log("\n# accounts list: groups, order, silent healthy rows, problem words, fixes");
  let b = await boot({ fb: adsFb(TOK), graph: listGraph(), rates: ratesOk });
  await adsPage(b);
  let pop = await popup(b, "accounts");
  ok("14 rows: 13 assigned + 1 that only the business shows", await rowsAre(pop, ROW, 14));
  const WANT = ["Tailspin Toys", "Fabrikam Media", "Contoso Ads", tr("acc.personal")];
  ok("groups: biggest subtotal first by USD equivalent (Tailspin $1,456 > Fabrikam VND 26.2 M = $1,048 > Contoso €790 = $988), then the personal group last",
    await until(pop, (want) => [...document.querySelectorAll("#accountsList .lgroup-text")].map((x) => x.textContent).join("|") === want, WANT.join("|")), JSON.stringify((await dump(pop)).filter((x) => x.g).map((x) => x.g)));
  let d = await dump(pop);
  ok("inside a group: active by spend, then the ones with a problem (by spend), then the dead ones", JSON.stringify(names(d)) === JSON.stringify([
    "Tailspin Toys", "TS | US | Prospecting", "TS | US | Retargeting", "TS | CA | Test", "TS | Old 2023",
    "Fabrikam Media", "Fabrikam VN 1", "Fabrikam Unassigned", "Fabrikam VN 2", "Fabrikam Closed for good",
    "Contoso Ads", "Contoso EU 1", "Contoso EU 2", "Contoso Restricted", "Contoso Compromised",
    tr("acc.personal"), "Personal | Alex", "Personal | Grace"]), JSON.stringify(names(d)));
  const heads = d.filter((x) => x.g);
  ok("each header: name · count and the subtotal in its own currency (exact; two or more currencies would be 'a + b')", JSON.stringify(heads.map((h) => [h.count, h.value]))
    === JSON.stringify([["· 4", "$1,456"], ["· 4", "VND 26.2M"], ["· 4", "€790.40"], ["· 2", "$55.20"]]), JSON.stringify(heads));
  ok("the group header is sticky, a heading, 12 px", await pop.evaluate(() => { const g = document.querySelector("#accountsList .lgroup"), cs = getComputedStyle(g); return cs.position === "sticky" && g.getAttribute("role") === "heading" && cs.fontSize === "12px"; }));
  const R = (id) => d.find((x) => x.id === id);

  // silent healthy rows
  for (const id of ["1001", "1002", "2001", "3001", "4001"]) {
    ok(`${R(id).name}: healthy = silent (no dot, no word, no link; 'Active' only for screen readers)`, R(id).status === null && R(id).sr === tr("status.1") && R(id).fix === null && R(id).more === null, JSON.stringify(R(id)));
  }
  ok("the right column: amount on line 1, the full ID on line 2", R("1001").value === "$1,241" && R("1001").id2 === "1001" && R("1002").value === "$215.30" && R("2001").value === "€680.40" && R("3001").value === "VND 25M", JSON.stringify([R("1001").value, R("1002").value, R("2001").value, R("3001").value]));
  ok("zero spend is muted, spend is not", R("1003").value === "$0" && R("1003").muted && !R("1001").muted);
  ok("a non-USD amount says its USD value in the tooltip (rates known; a million of VND is short on the row, so its exact amount comes first), a USD one has none", R("3001").valueTitle.replace(/\s+/g, " ") === "VND 25,000,000 ≈ $1,000" && R("2001").valueTitle === "≈ $850.50" && R("1001").valueTitle === null, JSON.stringify([R("3001").valueTitle, R("2001").valueTitle, R("1001").valueTitle]));

  // problem words + ONE fix link each
  const FIX = { "1003": [tr("reason.1"), "bad", tr("next.review"), "https://www.facebook.com/accountquality/"], "2002": [tr("status.3"), "warn", tr("next.pay"), LINKS.billing("2002")],
    "2003": [tr("reason.15"), "bad", tr("next.secure"), LINKS.hacked()], "2004": [tr("status.restricted"), "warn", tr("next.requestReview"), LINKS.accountQuality()],
    "3002": [tr("status.7"), "warn", tr("next.quality"), LINKS.accountQuality()], "3003": [tr("acc.noAccess"), "warn", tr("next.assign"), LINKS.bmAdAccounts("9003")],
    "4002": [tr("status.9"), "warn", tr("next.pay"), LINKS.billing("4002")] };
  for (const [id, [word, tone, fix, href]] of Object.entries(FIX)) {
    const r = R(id);
    ok(`${r.name}: '${word}' (${tone}) + one fix link '${fix}' to the right page`, r.status === word && r.tone === tone && r.fix === fix && r.href === href && r.fixes === 1 && r.sr === null, JSON.stringify(r));
  }
  ok("the problem word replaces the status: no 'Disabled', no '(1)' code, no '/ Integrity'", d.filter((x) => x.status).every((x) => !new RegExp(`${tr("status.2")}|\\(\\d+\\)|\\/`).test(x.status)), JSON.stringify(d.map((x) => x.status)));
  ok("the tooltip of a reason word keeps both: 'Disabled: Ads policy' / 'Restricted: AFC review'", R("1003").statusTitle === `${tr("status.2")}: ${tr("reason.1")}` && R("2004").statusTitle === `${tr("status.restricted")}: ${tr("reason.5")}` && R("2002").statusTitle === null, JSON.stringify([R("1003").statusTitle, R("2004").statusTitle]));
  ok("the fix names its owner for a screen reader ('Appeal · TS | CA | Test')", R("1003").aria === `${tr("next.review")} · TS | CA | Test`, R("1003").aria);
  ok("'+N more' = a further step: Secure + Appeal → '+1 more'; one step → none; looking places (Ads Manager) do not count", R("2003").more === tr("row.more", { n: 1 }) && R("1003").more === null && R("2002").more === null && R("3002").more === null, JSON.stringify(d.map((x) => x.more)));
  ok("closed and closed-for-good accounts are grey with no link (the steps are in the body)", R("1004").status === tr("status.101") && R("1004").tone === "" && R("1004").fixes === 0 && R("3004").status === tr("reason.7") && R("3004").tone === "" && R("3004").fixes === 0, JSON.stringify([R("1004"), R("3004")]));
  ok("exactly 7 fix links on the whole list (one per problem row, none on healthy and dead rows)", d.reduce((n, x) => n + (x.fixes || 0), 0) === 7);
  ok("unassigned: 'No access' + 'Assign me' to the business it was read through", R("3003").status === tr("acc.noAccess") && R("3003").href === LINKS.bmAdAccounts("9003"));
  const rowsStored = await stored(pop, "accounts");
  ok("the accounts read through a business are marked in the cache, the assigned ones are not", rowsStored.find((x) => x.account_id === "3003")?._viaBm === true && rowsStored.find((x) => x.account_id === "3003")?._bmId === "9003" && rowsStored.filter((x) => x._viaBm).length === 1);

  // the status chips: the new short words, one chip per status
  const chips = () => pop.$$eval("#statusChips .chip", (c) => c.map((x) => x.textContent.trim()));
  ok("chips: short status words with counts, one per status (not per reason)", (await chips()).join() === [["status.1", 5], ["status.2", 3], ["status.3", 1], ["status.restricted", 1], ["acc.noAccess", 1], ["status.7", 1], ["status.9", 1], ["status.101", 1]].map(([k, n]) => `${tr(k)} ${n}`).join(), (await chips()).join());
  await pop.click(`#statusChips .chip:has-text("${tr("status.2")}")`);
  d = await dump(pop);
  ok("the Disabled chip: the 3 disabled accounts (three different reasons); the subtotals follow the rows shown (all zero → groups by name)", JSON.stringify(names(d)) === JSON.stringify(["Contoso Ads", "Contoso Compromised", "Fabrikam Media", "Fabrikam Closed for good", "Tailspin Toys", "TS | CA | Test"]), JSON.stringify(names(d)));
  ok("…and the count appears (only filtered): '3 of 14 found'", has(await text(pop, "#accountsTotal .total-meta"), tr("acc.found", { n: 3, all: 14 })), await text(pop, "#accountsTotal .total-meta"));
  await pop.click(`#statusChips .chip:has-text("${tr("status.2")}")`);
  ok("a second click clears it", await rowsAre(pop, ROW, 14));
  await pop.fill("#accountFilter", tr("acc.noAccess").toLowerCase());
  ok("search finds a status word ('no access' → the unassigned account)", await until(pop, () => document.querySelectorAll("#accountsList .lrow").length === 1 && /Unassigned/.test(document.querySelector("#accountsList").textContent)));
  await pop.fill("#accountFilter", "Contoso");
  d = await dump(pop);
  ok("search by business name: only that group, its count follows the rows shown, '4 of 14 found'", JSON.stringify(heads.length && d.filter((x) => x.g).map((x) => x.g)) === '["Contoso Ads"]' && has(await text(pop, "#accountsTotal .total-meta"), tr("acc.found", { n: 4, all: 14 })));
  await pop.fill("#accountFilter", "");
  await rowsAre(pop, ROW, 14);

  // Active IDs: the active accounts that are shown and assigned to the person (status ACTIVE: restricted ones too; 3003, read only through a business, is not theirs)
  await captureClipboard(pop);
  await pop.click("#copyLiveIds");
  ok("Active IDs copies the ACTIVE assigned accounts, one per line (not 3003, which is only read through a business)", await until(pop, () => window.__clip.length === 1) && (await clip(pop))[0].split("\n").sort().join() === "1001,1002,2001,2004,3001,4001", JSON.stringify(await clip(pop)));
  await pop.click(`#statusChips .chip:has-text("${tr("status.101")}")`);
  ok("…and follows the filter (no active account shown → nothing copied)", has(await clickToast(pop, "#copyLiveIds"), tr("acc.noLive")) && (await clip(pop)).length === 1);
  await pop.click(`#statusChips .chip:has-text("${tr("status.101")}")`);

  // the business filter (from the Businesses tab): no group headers, the chip
  await pop.evaluate(async () => { const { emit } = await import(chrome.runtime.getURL("js/bus.js")); emit("filter-bm", { id: "9001", name: "Tailspin Toys" }); });
  d = await dump(pop);
  ok("a business filter: its 4 accounts, no group headers (the chip says which business), the chip clears it", d.length === 4 && d.every((x) => !x.g) && has(await text(pop, "#statusChips"), "Tailspin Toys ✕") && (await pop.locator("#statusChips .chip.on").count()) === 1, JSON.stringify(names(d)));
  await pop.click('#statusChips .chip:has-text("Tailspin Toys")');
  ok("clearing it brings the headers back", (await pop.locator("#accountsList .lgroup").count()) === 4 && (await rowsAre(pop, ROW, 14)));

  // a period without spend: groups fall back to their names, the personal group stays last
  await pop.click(PERIOD("yesterday"));
  d = await dump(pop);
  ok("Yesterday (no spend anywhere): groups by name, personal last; zero amounts are muted", JSON.stringify(d.filter((x) => x.g).map((x) => x.g)) === JSON.stringify(["Contoso Ads", "Fabrikam Media", "Tailspin Toys", tr("acc.personal")]) && d.filter((x) => !x.g).every((x) => x.muted), JSON.stringify(d.filter((x) => x.g).map((x) => x.g)));
  await pop.click(PERIOD("today"));
  await done(b);

  // without rates dong are not set against dollars and euros by their raw numbers (they used to win): groups of different currencies are ordered by name
  b = await boot({ fb: adsFb(TOK), graph: listGraph() });
  await adsPage(b);
  pop = await popup(b, "accounts");
  await rowsAre(pop, ROW, 14); await waitFor(() => b.rateHits.length >= 2); await settle(pop);      // both rate sources have answered (503): the order cannot change any more
  d = await dump(pop);
  ok("rates unavailable: groups of different currencies by name (not by raw numbers), no crash, no '≈' anywhere on the rows", JSON.stringify(d.filter((x) => x.g).map((x) => x.g)) === JSON.stringify(["Contoso Ads", "Fabrikam Media", "Tailspin Toys", tr("acc.personal")]) && d.every((x) => !/≈/.test(x.value || "") && !/≈/.test(x.valueTitle || "")), JSON.stringify(d.filter((x) => x.g).map((x) => x.g)));
  await done(b);

  // only personal accounts: a header would repeat the total
  b = await boot({ fb: adsFb(TOK), graph: listGraph(MINE.filter((a) => !a.business), []) });
  await adsPage(b);
  pop = await popup(b, "accounts");
  ok("only personal accounts: just the rows, no header", (await rowsAre(pop, ROW, 2)) && (await pop.locator("#accountsList .lgroup").count()) === 0);
  await done(b);
  // one business and personal ones: the header shows
  b = await boot({ fb: adsFb(TOK), graph: listGraph(MINE.filter((a) => !a.business || a.business === TS), []) });
  await adsPage(b);
  pop = await popup(b, "accounts");
  ok("one business + personal accounts: both headers", (await rowsAre(pop, ROW, 6)) && (await pop.locator("#accountsList .lgroup").count()) === 2);
  await done(b);
}

// ---------- RU / EN ----------
async function listRuFlow() {
  console.log("\n# accounts list: Russian and English");
  const b = await boot({ fb: adsFb(TOK), graph: listGraph(), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await rowsAre(pop, ROW, 14);
  const label = () => text(pop, "#tabbtn-accounts");
  ok("EN: the tab is 'Accounts', the Personal group is 'Personal ad accounts'", (await label()) === tr("tab.accounts") && has(await text(pop, "#accountsList"), tr("acc.personal")), await label());
  await useLang(pop, "ru");
  ok("RU: the tab is 'Кабинеты'", await until(pop, (s) => document.querySelector("#tabbtn-accounts").textContent.trim() === s, tr("tab.accounts")));
  const d = await dump(pop);
  const R = (id) => d.find((x) => x.id === id);
  ok("RU: group 'Личные кабинеты', words and fix verbs (Правила рекламы · Апелляция, Долг · Оплатить, Взлом · Защитить ещё 1, Нет доступа · Назначить себя, Ограничен · Запросить проверку, На проверке, Отсрочка, Закрыт, Закрыт навсегда)",
    d.some((x) => x.g === tr("acc.personal")) && JSON.stringify([R("1003"), R("2002"), R("2003"), R("3003"), R("2004"), R("3002"), R("4002"), R("1004"), R("3004")].map((x) => [x.status, x.fix, x.more]))
      === JSON.stringify([[tr("reason.1"), tr("next.review"), null], [tr("status.3"), tr("next.pay"), null], [tr("reason.15"), tr("next.secure"), tr("row.more", { n: 1 })], [tr("acc.noAccess"), tr("next.assign"), null], [tr("status.restricted"), tr("next.requestReview"), null], [tr("status.7"), tr("next.quality"), null], [tr("status.9"), tr("next.pay"), null], [tr("status.101"), null, null], [tr("reason.7"), null, null]]), JSON.stringify(d.map((x) => x.status)));
  ok("RU: the tooltip 'Заблокирован: Правила рекламы'; amounts in the Russian format", R("1003").statusTitle === `${tr("status.2")}: ${tr("reason.1")}` && R("1001").value === "1 241 $" && R("2001").value === "680,40 €", JSON.stringify([R("1003").statusTitle, R("1001").value]));
  ok("RU: chips use the same words", (await pop.$$eval("#statusChips .chip", (c) => c.map((x) => x.textContent.trim()))).join() === [["status.1", 5], ["status.2", 3], ["status.3", 1], ["status.restricted", 1], ["acc.noAccess", 1], ["status.7", 1], ["status.9", 1], ["status.101", 1]].map(([k, n]) => `${tr(k)} ${n}`).join());
  await pop.click(`#statusChips .chip:has-text("${tr("status.3")}")`);
  ok("RU: a chip chosen in Russian still filters after switching to English (the filter is a status, not a word)", await rowsAre(pop, ROW, 1));
  await useLang(pop, "en");
  ok("…and shows the same account in English", (await rowsAre(pop, ROW, 1)) && (await pop.locator(`${ROW} .lrow-status-text`).textContent()) === tr("status.3"));
  await pop.click(`#statusChips .chip:has-text("${tr("status.3")}")`);
  await done(b);
}

// ---------- the expanded body ----------
async function bodyFlow() {
  console.log("\n# accounts list: the expanded body");
  const b = await boot({ fb: adsFb(TOK), graph: listGraph(), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await rowsAre(pop, ROW, 14);
  const rowSel = (id) => `${ROW}[data-row="${id}"]`;
  const open = async (id) => { await pop.click(`${rowSel(id)} .lrow-title`); };
  const body = (id) => pop.evaluate((sel) => {
    const bd = document.querySelector(`${sel} .lrow-body`);
    if (!bd) return null;
    const kvs = [...bd.querySelectorAll(".lrow-pair")].map((p) => [p.querySelector("dt").textContent, p.querySelector("dd").textContent.trim()]);
    const todo = bd.querySelector(".lrow-todo");
    return { children: [...bd.children].map((c) => c.className.split(" ")[0]), kvs, cols: bd.querySelector(".lrow-kv") && getComputedStyle(bd.querySelector(".lrow-kv")).gridTemplateColumns.split(" ").length,
      todo: todo && { title: todo.querySelector(".lrow-todo-title").textContent, cls: todo.className, help: todo.querySelector(".lrow-todo-help")?.textContent ?? null, links: [...todo.querySelectorAll("a")].map((a) => [a.textContent.trim(), a.href]) },
      meta: bd.querySelector(".lrow-meta")?.textContent.trim() ?? null,
      links: [...bd.querySelectorAll(".lrow-links a")].map((a) => [a.textContent.trim(), a.href, !!a.querySelector(".i-external")]), idline: bd.querySelector(".lrow-idline")?.textContent.replace(/\s+/g, " ").trim(), ads: !!bd.querySelector(".ads-sec .ads-toggle") };
  }, rowSel(id));

  await open("1001");
  let bd = await body("1001");
  ok("a full account: ID line, the facts, ONE muted line of small facts, the two places, then the Ads section (no 'What to do' for a healthy one)", JSON.stringify(bd.children) === JSON.stringify(["lrow-idline", "lrow-kv", "lrow-meta", "lrow-links", "ads-sec"]) && bd.todo === null && bd.ads, JSON.stringify(bd.children));
  ok("…Clicks · CPC · Spent · To pay · Billing threshold · Daily limit · Payment · Pixels (Spend cap only when one is set: none here; timezone, country and creation date are the muted line)", bd.kvs.map((x) => x[0]).join() === KV("acc.clicksCpc", "acc.spent", "acc.balance", "acc.threshold", "acc.daily", "acc.funding", "acc.pixels"), bd.kvs.map((x) => x[0]).join());
  const kv = Object.fromEntries(bd.kvs);
  ok("…with the values: 310 clicks · $4.00 per click, spent $11,165, to pay $120.00, threshold $250.00, limit $2,500, Visa, the pixel",
    kv[tr("acc.clicksCpc")] === "310 · $4.00" && kv[tr("acc.spent")] === "$11,165" && kv[tr("acc.balance")] === "$120.00" && kv[tr("acc.threshold")] === "$250.00" && kv[tr("acc.daily")] === "$2,500"
    && kv[tr("acc.funding")] === "Visa ·· 4242" && kv[tr("acc.pixels")] === "Main pixel · 55501", JSON.stringify(kv));
  ok("…the muted line: 'UTC+3 <city> · US · created Mar 4, 2025' (one line, 12 px, secondary grey)", new RegExp(`^UTC\\+3 \\S.* · US · ${trx("acc.createdOn", { d: "Mar 4, 2025" }).source}$`).test(bd.meta), String(bd.meta));
  ok("…and not one value is a dash", bd.kvs.every((x) => x[1] && x[1] !== "—"));
  ok("the body starts with the ID and its copy button, 'Ads Manager ↗ · Billing ↗' keep their icons and go to this account", bd.idline === "ID1001" && JSON.stringify(bd.links) === JSON.stringify([[tr("next.adsManager"), LINKS.adsManager("1001"), true], [tr("next.billing"), LINKS.billing("1001"), true]]), JSON.stringify(bd.links));
  ok("two columns at 560 px", bd.cols === 2, String(bd.cols));
  await pop.setViewportSize({ width: 380, height: 900 });
  ok("one column at 380 px", (await body("1001")).cols === 1);
  await pop.setViewportSize({ width: 560, height: 900 });
  await open("1001");
  ok("closing throws the body away", (await body("1001")) === null);

  // a bare account: pairs Graph did not give are not drawn
  await open("1002");
  bd = await body("1002");
  ok("a bare account: no threshold, daily limit, payment or spend cap rows (they would be '—' or 'none'); no pixels read as 'none'", bd.kvs.map((x) => x[0]).join() === KV("acc.clicksCpc", "acc.spent", "acc.balance", "acc.pixels") && Object.fromEntries(bd.kvs)[tr("acc.pixels")] === tr("acc.no"), bd.kvs.map((x) => x[0]).join());
  await pop.click(PERIOD("all"));
  ok("All time: Clicks and CPC are not the period's, they go; the total stays and equals the row's amount", (await body("1002")).kvs.map((x) => x[0]).join() === KV("acc.spent", "acc.balance", "acc.pixels"), (await body("1002")).kvs.map((x) => x[0]).join());
  ok("…the open row stays open across the redraw", await pop.locator(`${rowSel("1002")}.open`).count() === 1);
  await pop.click(PERIOD("today"));
  await open("1002");

  // what to do: the help line + EVERY step (the one on line 2 included) except the two places the links row has
  const stepsOf = async (id) => { await open(id); const x = await body(id); await open(id); return x; };
  bd = await stepsOf("1003");
  ok("disabled (ads policy): help line and the fix that is on line 2 too (Appeal; Ads Manager is in the links row), title in the problem's tone", bd.todo.title === tr("next.title") && has(bd.todo.cls, "bad") && bd.todo.help === tr("next.help.r1") && JSON.stringify(bd.todo.links) === JSON.stringify([[tr("next.review"), LINKS.accountQuality()]]), JSON.stringify(bd.todo));
  bd = await stepsOf("2003");
  ok("compromised: Secure (line 2) and Appeal, the primary one first", JSON.stringify(bd.todo.links) === JSON.stringify([[tr("next.secure"), LINKS.hacked()], [tr("next.review"), LINKS.accountQuality()]]) && bd.todo.help === tr("next.help.r15"), JSON.stringify(bd.todo));
  bd = await stepsOf("3004");
  ok("closed for good: no fix on line 2, both steps are here: Support, Account Quality (neutral title)", JSON.stringify(bd.todo.links) === JSON.stringify([[tr("next.support"), LINKS.support()], [tr("next.quality"), LINKS.accountQuality()]]) && !/bad|warn/.test(bd.todo.cls), JSON.stringify(bd.todo));
  bd = await stepsOf("3003");
  ok("unassigned: the help line says why; 'Assign me' is listed too", bd.todo.help === tr("next.help.noAccess") && JSON.stringify(bd.todo.links) === JSON.stringify([[tr("next.assign"), LINKS.bmAdAccounts("9003")]]), JSON.stringify(bd.todo));
  bd = await stepsOf("2002");
  ok("unpaid: help and Pay; Billing is in the links row", bd.todo.help === tr("next.help.unpaid") && JSON.stringify(bd.todo.links) === JSON.stringify([[tr("next.pay"), LINKS.billing("2002")]]) && bd.links.some((l) => l[0] === tr("next.billing")), JSON.stringify(bd));
  ok("a step link in the body opens a new tab (noopener noreferrer)", await (async () => { await open("2003"); const a = pop.locator(`${rowSel("2003")} .lrow-todo a`).first(); const r = await a.evaluate((n) => [n.target, n.rel]); await open("2003"); return r.join() === "_blank,noopener noreferrer"; })());

  // open rows and focus survive a redraw (the period event redraws the whole list)
  await open("1001"); await open("2004");
  await pop.focus(`${rowSel("1002")} .lrow-title`);
  await pop.evaluate(async () => { const { emit } = await import(chrome.runtime.getURL("js/bus.js")); emit("period", "today"); });
  ok("a redraw keeps the open rows open and the focus on the same control", (await pop.locator(`${ROW}.open`).count()) === 2 && (await pop.evaluate(() => document.activeElement.dataset.focus)) === "row:1002");
  ok("…the open rows are remembered across a popup reopen", await (async () => { const re = await popup(b, "accounts"); const ok2 = await rowsAre(re, `${ROW}.open`, 2); await re.close(); return ok2; })());
  await done(b);
}

// ---------- layout of the new list: two lines, no wrap, no sideways scroll ----------
async function listLayoutFlow() {
  console.log("\n# accounts list: layout at 560 and 380");
  const glued = "W".repeat(70);
  const long = "A very long ad account name that has to end in an ellipsis long before it reaches the amount on the right";
  const accounts = [mk("1", long, "VND", 2, 1, 123456789, { id: "9001", name: `${glued} Holding` }), mk("2", "Short", "USD", 1, 0, 5, { id: "9001", name: `${glued} Holding` }),
    mk("3", glued, "EUR", 2, 15, 7, { id: "9002", name: "Other business" }), mk("4", "Personal", "USD", 3, 0, 1, null)];
  const b = await boot({ fb: adsFb(TOK), graph: listGraph(accounts, []), rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await rowsAre(pop, ROW, 4);
  for (const w of [560, 380]) {
    await pop.setViewportSize({ width: w, height: 800 });
    await settle(pop);
    const m = await pop.evaluate(() => {
      const de = document.documentElement;
      const rows = [...document.querySelectorAll("#accountsList .lrow")].sort((a, b) => a.dataset.row - b.dataset.row).map((r) => { const hd = r.querySelector(".lrow-head").getBoundingClientRect(), sub = r.querySelector(".lrow-sub"), nm = r.querySelector(".lrow-name"), fix = r.querySelector(".lrow-fix"), val = r.querySelector(".lrow-value");
        return { h: Math.round(hd.height), subH: sub ? Math.round(sub.getBoundingClientRect().height) : 0, cut: nm.scrollWidth > nm.clientWidth, fixOk: !fix || fix.getBoundingClientRect().right <= sub.getBoundingClientRect().right + 1, valRight: Math.round(hd.right - val.getBoundingClientRect().right) }; });
      const groups = [...document.querySelectorAll("#accountsList .lgroup")].map((g) => { const t = g.querySelector(".lgroup-text"); return { cut: t.scrollWidth > t.clientWidth, over: g.scrollWidth > g.clientWidth + 1 }; });
      return { sw: de.scrollWidth, cw: de.clientWidth, rows, groups };
    });
    ok(`${w}px: no horizontal scroll`, m.sw <= m.cw, JSON.stringify([m.sw, m.cw]));
    ok(`${w}px: every row is two lines (all the same height: 68 px), line 2 never wraps (≤ 24 px), the amount is 16 px from the edge`, m.rows.every((r) => near(r.h, 68) && r.subH <= 24 && r.valRight === 16), JSON.stringify(m.rows));
    ok(`${w}px: long names end in an ellipsis; the fix link stays inside line 2; long business names are cut, not wrapped`, m.rows[0].cut && m.rows.every((r) => r.fixOk) && m.groups.every((g) => !g.over) && m.groups[0].cut, JSON.stringify([m.rows.map((r) => r.cut), m.groups]));
  }
  await pop.setViewportSize({ width: 560, height: 300 });
  await pop.evaluate(() => window.scrollTo(0, 300));
  await settle(pop);
  const top = await pop.$$eval("#accountsList .lgroup", (g) => g.map((x) => Math.round(x.getBoundingClientRect().top)));
  ok("scrolled, the header of the group in view sticks under the tab strip (34 px: the brand row has scrolled away)", top.some((x) => x === 34), JSON.stringify(top));
  ok("…and the bar itself sticks 40 px above the window: only the tabs stay", await pop.evaluate(() => { const r = document.querySelector(".bar").getBoundingClientRect(), tabs = document.querySelector(".tabs").getBoundingClientRect(); return Math.round(r.top) === -40 && Math.round(tabs.top) === 0; }));
  await done(b);
}

// ---------- the order of groups and rows without exchange rates ----------
async function sortFlow() {
  console.log("\n# accounts: order without rates, the '+N' cut of a group header");
  const today = new Date().toISOString().slice(0, 10);
  const spend = (v) => ({ data: [{ spend: String(v), impressions: "10", inline_link_clicks: "1", date_start: today, date_stop: today }] });
  const a = (id, name, cur, v, biz) => ({ account_id: id, name, account_status: 1, currency: cur, timezone_name: "UTC", amount_spent: "0", p_today: spend(v), p_yesterday: spend(0), p_week: spend(0), p_month: spend(0), business: { id: biz[0], name: biz[1] } });
  const ZETA = ["9101", "Zeta Co"], ALPHA = ["9102", "Alpha Co"], MIX = ["9103", "Mixed Inc"];
  const accounts = { data: [
    a("1", "Zeta VN", "VND", 25000000, ZETA), a("2", "Alpha US", "USD", 100, ALPHA), a("3", "Alpha US 2", "USD", 300, ALPHA),
    a("4", "Mix 1", "USD", 5, MIX), a("5", "Mix 2", "EUR", 20, MIX), a("6", "Mix 3", "VND", 1000, MIX),
  ] };
  const groupNames = (p) => p.$$eval("#accountsList .lgroup .lgroup-text", (n) => n.map((x) => x.textContent));
  const groupValue = (p, name) => p.evaluate((n) => { const g = [...document.querySelectorAll("#accountsList .lgroup")].find((x) => x.querySelector(".lgroup-text").textContent === n); return { text: g.querySelector(".lgroup-value").textContent.replace(/\s+/g, " ").trim(), title: g.querySelector(".lgroup-value").title }; }, name);

  // no rates (both sources answer 503): dong are not set against dollars by their raw numbers; the name decides, same currency by amount
  let b = await boot({ fb: adsFb(TOK), graph: (u) => ({ body: u.pathname.endsWith("/me/adaccounts") ? accounts : { data: [] } }) });
  await adsPage(b);
  let pop = await popup(b, "accounts");
  ok("six accounts in three groups", await rowsAre(pop, ROW, 6));
  ok("no rates: the groups are not ordered by raw numbers (25 000 000 dong is not more than 400 dollars): by name", (await groupNames(pop)).join() === "Alpha Co,Mixed Inc,Zeta Co", (await groupNames(pop)).join());
  const alpha = await pop.$$eval(`${ROW} .lrow-name`, (n) => n.map((x) => x.textContent));
  ok("…inside a group the same currency is ordered by amount ($300 before $100)", alpha.indexOf("Alpha US 2") < alpha.indexOf("Alpha US"), alpha.join());
  const mix = await groupValue(pop, "Mixed Inc");
  ok("a group header with three currencies and no rates is cut to the two biggest and '+1 more' (the whole is its tooltip)", new RegExp(`^\\$5\\.00 \\+ €20\\.00 ${trx("money.more", { n: 1 }).source}$`).test(mix.text) && /VND\s1,000/.test(mix.title), JSON.stringify(mix));
  await done(b);

  // with rates the same list is ordered by USD value: Zeta ($1 000) first
  b = await boot({ fb: adsFb(TOK), graph: (u) => ({ body: u.pathname.endsWith("/me/adaccounts") ? accounts : { data: [] } }), rates: ratesOk });
  await adsPage(b);
  pop = await popup(b, "accounts");
  ok("rates: the groups follow the USD value (Alpha $400, Zeta $1 000, Mixed ≈ $31)", await until(pop, () => [...document.querySelectorAll("#accountsList .lgroup .lgroup-text")].map((x) => x.textContent).join() === "Zeta Co,Alpha Co,Mixed Inc"), (await groupNames(pop)).join());
  const mix2 = await groupValue(pop, "Mixed Inc");
  ok("…the three-currency header is '≈ $…' now (not cut)", /^≈ \$\d+(\.\d+)?$/.test(mix2.text), JSON.stringify(mix2));
  await done(b);
}

// ---------- business membership (owner or read-through), chips under the business filter, Active IDs ----------
async function membersFlow() {
  console.log("\n# accounts: members of a business, chips under the filter, Active IDs");
  const acc = (id, name, status, biz, extra = {}) => ({ account_id: id, name, account_status: status, currency: "USD", timezone_name: "UTC", amount_spent: "100", business: { id: biz[0], name: biz[1] }, ...extra });
  const ALPHA = ["9001", "Alpha Media"], PARTNER = ["9002", "Partner Agency"], OTHER = ["9003", "Other Co"];
  const mine = [acc("11", "Alpha own", 1, ALPHA, { p_today: ins(40) }), acc("33", "Other own", 1, OTHER, { p_today: ins(5) })];
  const client = [acc("22", "Shared active", 1, PARTNER, { p_today: ins(7) }), acc("23", "Shared disabled", 2, PARTNER, { disable_reason: 1, p_today: ins(3) })];   // owned by Partner, shared with Alpha as a client
  const b = await boot({ fb: adsFb(TOK), graph: (u) => {
    const p = u.pathname.replace(/^\/v[\d.]+\//, "/");
    if (p === "/me/adaccounts") return { body: { data: mine } };
    if (p === "/me/businesses") return { body: { data: [{ id: "9001", name: "Alpha Media" }, { id: "9003", name: "Other Co" }] } };
    if (p === "/9001/client_ad_accounts") return { body: { data: client } };
    return { body: { data: [] } };
  } });
  await adsPage(b);
  await captureClipboard(await popup(b));
  const pop = await popup(b, "accounts");
  await captureClipboard(pop);
  ok("four accounts: two assigned, two only through Alpha's client edge", await rowsAre(pop, ROW, 4), await text(pop, "#accountsList"));
  // Active IDs: the assigned active ones only
  await pop.click("#copyLiveIds");
  ok("Active IDs copies the assigned active accounts and leaves out the one read through a business (22)", (await clip(pop)).join("|") === "11\n33", JSON.stringify(await clip(pop)));
  // the Businesses tab counts the shared accounts for Alpha (a client of them) and shows the spend of the owner's group only
  await pop.click('[data-tab="bms"]');
  const bmRow = (name) => pop.locator("#bmsList .lrow").filter({ has: pop.locator(".lrow-name", { hasText: name }) });
  await until(pop, () => document.querySelectorAll("#bmsList .lrow").length >= 3);
  const alpha = (await bmRow("Alpha Media").locator(".lrow-sub").textContent()).replace(/\s+/g, " ").trim();
  ok("Alpha Media counts its own and the two shared accounts: '3 ad accounts · 1 disabled', not 'No ad accounts'", has(alpha, `3 ${trn(3, "bms.accCount")}`) && has(alpha, `1 ${trn(1, "bms.disabledWord")}`) && !has(alpha, tr("bms.st.none")), alpha);
  const value = async (n) => (await bmRow(n).locator(".lrow-value").textContent()).replace(/\s+/g, " ").trim();
  ok("…spend stays with the owner: Alpha $40 (its own account), Partner Agency $10 (the two shared ones), the sum is the list's $55 once", (await value("Alpha Media")) === "$40.00" && (await value("Partner Agency")) === "$10.00" && (await value("Other Co")) === "$5.00", `${await value("Alpha Media")} ${await value("Partner Agency")} ${await value("Other Co")}`);
  const partner = (await bmRow("Partner Agency").locator(".lrow-sub").textContent()).replace(/\s+/g, " ").trim();
  ok("Partner Agency (owner, not one of the profile's businesses) counts the same two", has(partner, `2 ${trn(2, "bms.accCount")}`), partner);
  // the jump lists exactly the accounts the count counted, and the chips count under the filter
  await bmRow("Alpha Media").locator(".lrow-title").click();
  await bmRow("Alpha Media").locator(".lbm-go").click();
  ok("'Show ad accounts' lists Alpha's three (own + shared), not Other Co's", await rowsAre(pop, ROW, 3) && (await pop.$$eval(`${ROW} .lrow-name`, (n) => n.map((x) => x.textContent).sort().join())) === "Alpha own,Shared active,Shared disabled");
  const chips = () => pop.$$eval("#statusChips .chip", (n) => n.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  const c = await chips();
  ok("the chips count the rows under the filter (Active 1 of the three, not 2 of the whole list), plus the filter chip", c.includes(`${tr("status.1")} 1`) && c.includes(`${tr("status.2")} 1`) && c.includes(`${tr("acc.noAccess")} 1`) && !c.includes(`${tr("status.1")} 2`), JSON.stringify(c));
  await pop.click("#copyLiveIds");
  ok("Active IDs under the filter: 11 only", (await clip(pop)).at(-1) === "11", JSON.stringify(await clip(pop)));
  await pop.click("#statusChips .chip.on");                                    // clear the business filter
  await until(pop, () => document.querySelectorAll("#accountsList .lrow").length === 4);
  const all = await chips();
  ok("without the business filter the chips count the whole list again (Active 2)", all.includes(`${tr("status.1")} 2`), JSON.stringify(all));
  await done(b);
}

export const flows = { members: membersFlow, sort: sortFlow, version: versionFlows, cache: cacheFlows, session: sessionFlows, ads: adsFlows, auto: autoFlows, alltime: allTimeFlows, layout: layoutFlows, stale: staleFlows, fields: fieldsFlows, paging: pagingFlows, slots: slotFlows, bm: bmFlows,
  accList: listFlow, accRu: listRuFlow, accBody: bodyFlow, accLayout: listLayoutFlow };
