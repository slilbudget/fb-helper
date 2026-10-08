// BM tab: automatic first load, the one-minute slot, optional fields Graph refuses, a token that cannot read BMs, ad account
// counts + the jump to the Accounts tab, copied IDs, the cache per FB user, dead session / API pause / no token, paging,
// RU / EN, other windows, layout. Graph is a mock (fictional data); every /me/businesses request is checked to be a GET that
// never asks for a token field.
import { GRAPH, TOK, TOK2, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, captureClipboard, clip, accountsJson, adsFb, stored, boxWait } from "../harness.mjs";

const bm = (id, name, extra = {}) => ({ id, name, verification_status: "verified", permitted_roles: ["ADMIN"], created_time: "2026-03-01T10:00:00+0000", ...extra });
// Newest first: Beta (Sep) → Gamma (May) → Alpha (Mar). Three different verifications = three chips.
const BMS = [
  bm("1001", "Alpha Media"),
  bm("1002", "Beta Ads", { verification_status: "pending", permitted_roles: ["EMPLOYEE"], created_time: "2026-09-10T08:00:00+0000", primary_page: { id: "555", name: "Beta Page" }, two_factor_type: "all_required" }),
  bm("1003", "Gamma Group", { verification_status: "not_verified", permitted_roles: undefined, created_time: "2026-05-05T08:00:00+0000" }),
];
const isBms = (u) => u.pathname.endsWith("/me/businesses");
const isAccs = (u) => u.pathname.endsWith("/me/adaccounts");
const bmHits = (b) => b.hits.filter((h) => h.startsWith("/me/businesses"));
const accHits = (b) => b.hits.filter((h) => h.startsWith("/me/adaccounts"));
const fieldsOf = (h) => new URL(`${GRAPH}${h}`).searchParams.get("fields") || "";
// "id,name,primary_page{id,name},x" → ["id","name","primary_page","x"] (commas inside braces do not split)
const askedKeys = (fields) => { const keys = []; let depth = 0, cur = ""; for (const ch of fields) { if (ch === "{") depth++; if (ch === "}") depth--; if (ch === "," && !depth) { keys.push(cur); cur = ""; } else cur += ch; } keys.push(cur); return keys.map((k) => k.replace(/\{.*$/, "")); };
// What Graph would send for the asked fields only (the mock must not hand out a field nobody asked for).
const answer = (rows, u) => { const keys = askedKeys(u.searchParams.get("fields") || ""); return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => keys.includes(k) && v !== undefined))); };
const fieldError = (name) => ({ status: 400, body: { error: { code: 100, message: `(#100) Tried accessing nonexisting field (${name}) on node type (Business)` } } });
const graphFor = ({ rows = BMS, accounts = accountsJson, onBms } = {}) => (u) =>
  isBms(u) ? (onBms ? onBms(u) : { body: { data: answer(rows, u) } }) : isAccs(u) ? { body: accounts } : { body: { data: [] } };
// Method + path of every request to Graph, from the browser side (the route mock does not see the method).
const watch = (b) => { const seen = []; b.ctx.on("request", (r) => { if (r.url().startsWith(GRAPH)) seen.push({ method: r.method(), path: new URL(r.url()).pathname, fields: new URL(r.url()).searchParams.get("fields") || "" }); }); return seen; };
const readOnly = (seen) => { const mine = seen.filter((r) => r.path.endsWith("/me/businesses")); return mine.length > 0 && mine.every((r) => r.method === "GET" && !/access_token/.test(r.fields)); };
const toastOf = (p) => p.evaluate(() => document.querySelector("#toast").textContent.trim());
const names = (p) => p.$$eval(".bm .bm-name-text", (n) => n.map((x) => x.textContent));
const row = (p, name) => p.locator(".bm", { hasText: name });
const noErrs = (b) => ok("no console errors", b.errs.length === 0, b.errs.join(" | "));

// ---------- load, rows, limits ----------
async function bmsFlow() {
  console.log("\n# bms: load, rows, limits");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  const seen = watch(b);
  await adsPage(b);
  let pop = await popup(b);
  ok("token tab open: nothing requested yet", bmHits(b).length === 0);
  await pop.click('[data-tab="bms"]');
  ok("first visit: rows appear without pressing refresh", await rowsAre(pop, ".bm", 3));
  ok("…with exactly one request, a page of 50", bmHits(b).length === 1 && has(bmHits(b)[0], "limit=50"), bmHits(b).join());
  ok("…asking for the BM fields and nothing else",
    fieldsOf(bmHits(b)[0]) === "id,name,verification_status,permitted_roles,created_time,primary_page{id,name},two_factor_type", fieldsOf(bmHits(b)[0]));
  ok("…and no toast for an automatic load", (await toastOf(pop)) === "", await toastOf(pop));
  ok("the tab is full height", await pop.evaluate(() => document.body.classList.contains("tall")));
  ok("newest BM first, then by date", (await names(pop)).join() === "Beta Ads,Gamma Group,Alpha Media", (await names(pop)).join());
  ok("total line: count and age", /^3 BM · updated just now$/.test(await text(pop, "#bmsTotal")), await text(pop, "#bmsTotal"));

  const beta = await row(pop, "Beta Ads").innerText();
  ok("row: verification and role pills, ID, created, primary page, 2FA",
    has(beta, "Pending") && has(beta, "Employee") && has(beta, "1002") && has(beta, "Created 09/10/2026") && has(beta, "Page: Beta Page") && has(beta, "2FA: everyone"), beta);
  const alpha = await row(pop, "Alpha Media").innerText();
  ok("row: verified admin, no page, no 2FA", has(alpha, "Verified") && has(alpha, "Admin") && !has(alpha, "Page:") && !has(alpha, "2FA"), alpha);
  const gamma = await row(pop, "Gamma Group").innerText();
  ok("row without roles shows no role pill", has(gamma, "Not verified") && !has(gamma, "Admin") && !has(gamma, "Employee"), gamma);
  ok("pill tones: verified ok, pending warn, not verified neutral",
    (await row(pop, "Alpha Media").locator(".pill.ok").count()) === 1 && (await row(pop, "Beta Ads").locator(".pill.warn").count()) === 1
    && (await row(pop, "Gamma Group").locator(".pill.ok, .pill.warn, .pill.bad").count()) === 0);

  // links: new tab, noopener, the verification link only until verified
  const links = (name) => row(pop, name).locator(".bm-link").evaluateAll((a) => a.map((x) => [x.textContent.trim(), x.getAttribute("href"), x.target, x.rel]));
  const lb = await links("Beta Ads");
  ok("links: Settings, Ad accounts, Verification, Quality; new tab, noopener",
    lb.map((l) => l[0]).join() === "Settings,Ad accounts,Verification,Quality" && lb.every((l) => l[2] === "_blank" && l[3] === "noopener noreferrer"), JSON.stringify(lb));
  ok("…they point at this BM's pages on business.facebook.com",
    lb[0][1] === "https://business.facebook.com/settings/?business_id=1002" && lb[1][1] === "https://business.facebook.com/settings/ad-accounts?business_id=1002"
    && lb[2][1] === "https://business.facebook.com/settings/security?business_id=1002" && lb[3][1] === "https://business.facebook.com/business-support-home/?business_id=1002", JSON.stringify(lb.map((l) => l[1])));
  ok("a verified BM has no Verification link", (await links("Alpha Media")).map((l) => l[0]).join() === "Settings,Ad accounts,Quality");

  // chips: three statuses → three chips; one click narrows, the same click clears
  ok("verification chips with counts", (await pop.locator("#bmsChips .chip").allInnerTexts()).join() === "Verified 1,Pending 1,Not verified 1", (await pop.locator("#bmsChips .chip").allInnerTexts()).join());
  await pop.click('#bmsChips .chip:has-text("Pending")');
  ok("chip: one row, the total says found", (await rowsAre(pop, ".bm", 1)) && has(await text(pop, "#bmsTotal"), "1 of 3 found"), await text(pop, "#bmsTotal"));
  await pop.click('#bmsChips .chip:has-text("Pending")');
  ok("same chip again: all rows", await rowsAre(pop, ".bm", 3));
  // search: name or id
  await pop.fill("#bmFilter", "gam");
  ok("search by name", (await rowsAre(pop, ".bm", 1)) && (await names(pop))[0] === "Gamma Group");
  await pop.fill("#bmFilter", "1002");
  ok("search by id", (await rowsAre(pop, ".bm", 1)) && (await names(pop))[0] === "Beta Ads");
  await pop.fill("#bmFilter", "nothing like this");
  ok("search without a match", (await rowsAre(pop, ".bm", 0)) && has(await text(pop, "#bmsList"), "Nothing found"), await text(pop, "#bmsList"));
  await pop.fill("#bmFilter", "");
  ok("cleared search: all rows", await rowsAre(pop, ".bm", 3));

  // not requested again
  await pop.click('[data-tab="token"]'); await pop.click('[data-tab="bms"]'); await pop.waitForTimeout(700);
  ok("second visit in the same popup: no new request", bmHits(b).length === 1, String(bmHits(b).length));
  pop = await popup(b); await pop.waitForTimeout(700);
  ok("reopen (popup remembers the BM tab): cached rows, no request, no complaint", (await rowsAre(pop, ".bm", 3)) && bmHits(b).length === 1 && (await toastOf(pop)) === "", `${bmHits(b).length} ${await toastOf(pop)}`);
  // refresh: one attempt per minute (the automatic load took the slot)
  const refused = await clickToast(pop, "#loadBms");
  const secs = Number((/in (\d+) s/.exec(refused) || [])[1]);
  ok("refresh within a minute is refused with the seconds left, nothing sent", bmHits(b).length === 1 && secs >= 1 && secs <= 60, `${bmHits(b).length} ${refused}`);
  await resetLocks(pop);
  pop = await popup(b); await pop.waitForTimeout(1000);
  ok("reopen with the slot free: still no request while there is a list", bmHits(b).length === 1, String(bmHits(b).length));
  const done = await clickToast(pop, "#loadBms");
  ok("slot free: the refresh goes out and says how many", bmHits(b).length === 2 && has(done, "Business managers: 3"), `${bmHits(b).length} ${done}`);
  const slot = await stored(pop, "locks");
  ok("the slot is the key bms, about a minute", slot?.slots?.bms > Date.now() + 50000 && slot.slots.bms < Date.now() + 61000, JSON.stringify(slot));
  ok("every /me/businesses request was a GET and asked for no token field", readOnly(seen), JSON.stringify(seen.filter((r) => r.path.endsWith("/me/businesses"))));
  noErrs(b);
  await b.ctx.close();
}

// ---------- optional fields Graph refuses ----------
async function bmsFieldsFlow() {
  console.log("\n# bms: refused fields");
  const refuse = new Set(["verification_status", "created_time"]);
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: (u) => {
    const f = askedKeys(u.searchParams.get("fields") || "");
    const bad = [...refuse].find((k) => f.includes(k));
    return bad ? fieldError(bad) : { body: { data: answer(BMS, u) } };
  } }) });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("rows load although two optional fields are refused", await rowsAre(pop, ".bm", 3));
  const hits = bmHits(b);
  ok("each refusal is retried at once without that field only (same page)", hits.length === 3
    && askedKeys(fieldsOf(hits[0])).includes("verification_status") && !askedKeys(fieldsOf(hits[1])).includes("verification_status") && askedKeys(fieldsOf(hits[1])).includes("created_time")
    && !askedKeys(fieldsOf(hits[2])).includes("created_time") && askedKeys(fieldsOf(hits[2])).includes("permitted_roles") && hits.every((h) => !has(h, "after=")), hits.map(fieldsOf).join(" | "));
  const alpha = row(pop, "Alpha Media");
  ok("verification shows a dash (not 'not verified'), with the reason as tooltip",
    (await alpha.locator(".bm-pills .pill").first().innerText()) === "—" && has(await alpha.locator(".bm-pills .pill").first().getAttribute("title"), "did not return"), await alpha.locator(".bm-pills").innerText());
  ok("created shows a dash", has(await alpha.innerText(), "Created —"), await alpha.innerText());
  ok("the role, which was not refused, still shows", has(await alpha.innerText(), "Admin"), await alpha.innerText());
  ok("no verification chips (nothing to tell apart)", (await pop.locator("#bmsChips .chip").count()) === 0);
  ok("a refused verification does not hide the Verification link (unknown is not verified)", has(await alpha.innerText(), "Verification"));
  const saved = await stored(pop, "bms");
  ok("the cache keeps only whitelisted keys and the markers", saved.every((r) => Object.keys(r).every((k) => ["id", "name", "permitted_roles", "primary_page", "two_factor_type", "_noVerificationStatus", "_noCreatedTime"].includes(k)))
    && saved.every((r) => r._noVerificationStatus && r._noCreatedTime), JSON.stringify(saved[0]));
  await resetLocks(pop); await pop.click("#loadBms");
  for (let i = 0; i < 40 && bmHits(b).length < 4; i++) await pop.waitForTimeout(100);
  await pop.waitForTimeout(400);
  ok("the refusal is remembered for this token: the next read does not ask for those fields", bmHits(b).length === 4 && !askedKeys(fieldsOf(bmHits(b)[3])).some((k) => refuse.has(k)), bmHits(b).slice(3).map(fieldsOf).join());
  refuse.clear();
  noErrs(b);
  await b.ctx.close();
}

// ---------- a token that cannot read BMs ----------
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
    const calm = await until(pop, () => /can't read business managers/.test(document.querySelector("#bmsList").textContent));
    ok(`${label}: a calm message in the list, saying what to do`, calm && has(await text(pop, "#bmsList"), "refresh the token"), await text(pop, "#bmsList"));
    ok(`${label}: no red toast, no red text`, !(await pop.evaluate(() => document.querySelector("#toast").classList.contains("err") && document.querySelector("#toast").classList.contains("show")))
      && (await pop.locator("#bmsList .err-text").count()) === 0, await toastOf(pop));
    ok(`${label}: one request, no console error, nothing cached`, bmHits(b).length === 1 && !(await stored(pop, "bmsAt")), String(bmHits(b).length));
    noErrs(b);
    await b.ctx.close();
  }

  // a refused refresh keeps the old list and says why it is old
  let denied = false;
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: (u) => (denied ? { status: 403, body: { error: { code: 200, message: "(#200) Requires business_management permission" } } } : { body: { data: answer(BMS, u) } }) }) });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("loaded", await rowsAre(pop, ".bm", 3));
  denied = true; await resetLocks(pop);
  await pop.click("#loadBms");
  ok("refresh refused: the list stays and a note says the token can't read BMs", (await until(pop, () => !!document.querySelector("#bmsList .bm-note"))) && (await rowsAre(pop, ".bm", 3)), await text(pop, "#bmsList"));
  denied = false; await resetLocks(pop);
  await pop.click("#loadBms");
  ok("a good refresh removes the note", (await until(pop, () => !document.querySelector("#bmsList .bm-note"))) && (await rowsAre(pop, ".bm", 3)));
  noErrs(b);
  await b.ctx.close();

  // any other failure is a red toast, and the list is simply "not loaded"
  const b2 = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: () => ({ status: 500, body: { error: { code: 1, message: "boom" } } }) }) });
  await adsPage(b2);
  const pop2 = await popup(b2, "bms");
  ok("another error: the message is toasted in red", await until(pop2, () => /boom/.test(document.querySelector("#toast").textContent) && document.querySelector("#toast").classList.contains("err")), await toastOf(pop2));
  ok("…and the list is not the permission note", !has(await text(pop2, "#bmsList"), "can't read") && has(await text(pop2, "#bmsList"), "not loaded"), await text(pop2, "#bmsList"));
  await pop2.click('[data-tab="token"]'); await resetLocks(pop2); await pop2.click('[data-tab="bms"]'); await pop2.waitForTimeout(700);
  ok("…and not retried by going back to the tab", bmHits(b2).length === 1, String(bmHits(b2).length));
  await b2.ctx.close();
}

// ---------- ad accounts of a BM ----------
async function bmsAccountsFlow() {
  console.log("\n# bms: ad accounts of a BM");
  const acc = (id, name, st, bmId, bmName) => ({ account_id: id, name, account_status: st, currency: "USD", timezone_name: "UTC", amount_spent: "100", ...(bmId ? { business: { id: bmId, name: bmName } } : {}) });
  const accounts = { data: [
    acc("11", "A one", 1, "1001", "Alpha Media"), acc("12", "A two", 1, "1001", "Alpha Media"), acc("13", "A three", 2, "1001", "Alpha Media"),
    acc("21", "B one", 1, "1002", "Beta Ads"), acc("99", "Solo", 1),
  ] };
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ accounts }) });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("BM rows load", await rowsAre(pop, ".bm", 3));
  ok("Accounts not loaded yet: every row offers 'Show ad accounts', nothing requested for them", (await pop.locator(".bm-accs").allInnerTexts()).join() === "Show ad accounts,Show ad accounts,Show ad accounts" && accHits(b).length === 0,
    `${(await pop.locator(".bm-accs").allInnerTexts()).join()} ${accHits(b).length}`);
  await row(pop, "Alpha Media").locator(".bm-accs").click();
  ok("the click opens the Accounts tab", await until(pop, () => document.querySelector(".tab.active")?.dataset.tab === "accounts" && document.querySelector("#tab-accounts").classList.contains("active")));
  ok("…which loads by itself and shows only that BM's ad accounts", (await rowsAre(pop, ".acc", 3)) && accHits(b).length === 1
    && (await pop.$$eval(".acc .acc-name", (n) => n.map((x) => x.textContent).sort().join())) === "A one,A three,A two", String(accHits(b).length));
  ok("…with the BM chip on the filter row", has(await text(pop, "#statusChips"), "Alpha Media ✕") && (await pop.locator("#statusChips .chip.on").count()) >= 1, await text(pop, "#statusChips"));

  await pop.click('[data-tab="bms"]');
  ok("back on the BM tab the counts are there (from the Accounts list)", await until(pop, () => /3 ad accounts · 2 active · 1 disabled/.test(document.querySelector(".bm")?.parentElement.textContent)));
  const accText = async (name) => (await row(pop, name).locator(".bm-accs, .bm-none").first().innerText()).replace(/\s+/g, " ").trim();
  ok("Alpha: 3 ad accounts · 2 active · 1 disabled", (await accText("Alpha Media")) === "3 ad accounts · 2 active · 1 disabled", await accText("Alpha Media"));
  ok("Beta: 1 ad account · 1 active (singular, no disabled part)", (await accText("Beta Ads")) === "1 ad account · 1 active", await accText("Beta Ads"));
  ok("Gamma has none: plain text, not a button", (await accText("Gamma Group")) === "No ad accounts" && (await row(pop, "Gamma Group").locator("button.bm-accs").count()) === 0, await accText("Gamma Group"));
  await row(pop, "Beta Ads").locator(".bm-accs").click();
  ok("Beta's counter filters the Accounts tab to Beta's one account", (await until(pop, () => document.querySelector(".tab.active")?.dataset.tab === "accounts"))
    && (await rowsAre(pop, ".acc", 1)) && has(await text(pop, "#statusChips"), "Beta Ads ✕") && !has(await text(pop, "#statusChips"), "Alpha Media"), await text(pop, "#statusChips"));
  ok("…no second request for the Accounts list", accHits(b).length === 1, String(accHits(b).length));
  await pop.click('#statusChips .chip:has-text("Beta Ads")');
  ok("clearing the chip shows every account again", await rowsAre(pop, ".acc", 5));
  noErrs(b);
  await b.ctx.close();
}

// ---------- copy IDs ----------
async function bmsCopyFlow() {
  console.log("\n# bms: copy");
  const b = await boot({ fb: adsFb(TOK), graph: graphFor() });
  await adsPage(b);
  const pop = await popup(b, "bms");
  await rowsAre(pop, ".bm", 3);
  await captureClipboard(pop);
  await pop.click("#copyBmIds");
  ok("Copy IDs: every BM, one per line, in the order shown", (await clip(pop)).join("|") === "1002\n1003\n1001", JSON.stringify(await clip(pop)));
  ok("…and says how many", has(await toastOf(pop), "Copied IDs: 3"), await toastOf(pop));
  await pop.fill("#bmFilter", "beta");
  await rowsAre(pop, ".bm", 1);
  await pop.click("#copyBmIds");
  ok("with a search: only the visible one", (await clip(pop)).at(-1) === "1002", JSON.stringify(await clip(pop)));
  await pop.fill("#bmFilter", "");
  await pop.click('#bmsChips .chip:has-text("Verified")');
  await rowsAre(pop, ".bm", 1);
  await pop.click("#copyBmIds");
  ok("with a chip: only the visible one", (await clip(pop)).at(-1) === "1001", JSON.stringify(await clip(pop)));
  await pop.click('#bmsChips .chip:has-text("Verified")');
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
  ok("loaded for the first FB user", (await rowsAre(pop, ".bm", 3)) && (await stored(pop, "owner")) === "1001" && !!(await stored(pop, "bmsAt")));
  pop = await popup(b);
  ok("reopen keeps the rows (cache per FB user)", (await rowsAre(pop, ".bm", 3)) && bmHits(b).length === 1);
  await fb.close(); pop = await popup(b);
  ok("no FB tab: the cache stays, nothing sent", (await rowsAre(pop, ".bm", 3)) && bmHits(b).length === 1);
  const c0 = bmHits(b).length; await resetLocks(pop); await clickToast(pop, "#loadBms");
  ok("refresh without a token sends nothing", bmHits(b).length === c0);
  await b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }]);
  pop = await popup(b);
  ok("another FB user: the cache is dropped", (await rowsAre(pop, ".bm", 0)) && (await until(pop, () => chrome.storage.session.get(["bms", "bmsAt", "bmsTruncated"]).then((o) => !o.bms && !o.bmsAt && !o.bmsTruncated))));
  await adsPage(b); await resetLocks(pop);
  pop = await popup(b); await rowsAre(pop, ".bm", 3);
  ok("…and the tab loads again for the new user", bmHits(b).length === 2 && (await stored(pop, "owner")) === "2002", `${bmHits(b).length} ${await stored(pop, "owner")}`);

  // another window of the extension fills or drops the list
  await pop.evaluate(() => chrome.storage.session.set({ bms: [{ id: "9001", name: "From another window" }], bmsAt: Date.now() - 120000, bmsTruncated: true }));
  ok("a list stored by another window shows up", (await until(pop, () => document.querySelector(".bm .bm-name-text")?.textContent === "From another window"))
    && has(await text(pop, "#bmsTotal"), "1 BM (not all) · updated 2 min ago"), await text(pop, "#bmsTotal"));
  await pop.evaluate(() => chrome.storage.session.remove(["bms", "bmsAt", "bmsTruncated"]));
  ok("…and so does its removal", await rowsAre(pop, ".bm", 0));
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
  ok("no token: no request", bmHits(b).length === 0);
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
  ok("API pause: no automatic request", bmHits(b).length === 0, String(bmHits(b).length));
  const paused = await clickToast(pop, "#loadBms");
  ok("API pause: the button says so and sends nothing", bmHits(b).length === 0 && has(paused, "API limit hit"), `${bmHits(b).length} ${paused}`);
  ok("…without using up the minute slot", !(await stored(pop, "locks"))?.slots?.bms, JSON.stringify(await stored(pop, "locks")));
  await b.ctx.close();

  // dead session: the first 190 is reported, nothing is sent after it
  b = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: () => ({ status: 400, body: { error: { code: 190, error_subcode: 463, message: "Session has expired" } } }) }) });
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
  ok("while loading the list says so", await until(pop, () => /Loading business managers/.test(document.querySelector("#bmsList").textContent)), await text(pop, "#bmsList"));
  ok("…and the refresh button is busy", await until(pop, () => { const n = document.querySelector("#loadBms"); return n.disabled && n.getAttribute("aria-busy") === "true"; }));
  await pop.click("#loadBms", { force: true }).catch(() => {});
  await pop.waitForTimeout(300);
  ok("a click during the load neither complains nor doubles the request", !has(await toastOf(pop), "Refresh available") && bmHits(b).length === 1, `${await toastOf(pop)} / ${bmHits(b).length}`);
  ok("…then the rows", await rowsAre(pop, ".bm", 3));
  ok("…and the button is free again", await pop.$eval("#loadBms", (n) => !n.disabled && !n.hasAttribute("aria-busy")));
  noErrs(b);
  await b.ctx.close();

  // a token change while the list is loading: the old answer is dropped
  let tok = TOK;
  b = await boot({ fb: (u) => adsFb(tok)(u), graph: graphFor({ onBms: (u) => ({ delay: 1500, body: { data: answer(BMS, u) } }) }) });
  const fb = await adsPage(b);
  pop = await popup(b);
  await pop.click('[data-tab="bms"]');
  await until(pop, () => /Loading business managers/.test(document.querySelector("#bmsList").textContent));
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
  const one = (n) => bm(String(1000 + n), `BM ${n}`, { created_time: `2026-0${(n % 9) + 1}-01T00:00:00+0000` });
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ onBms: (u) => {
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
  ok("…the total line says the list is not complete", has(await text(pop, "#bmsTotal"), "(not all)"), await text(pop, "#bmsTotal"));
  noErrs(b);
  await b.ctx.close();
}

// ---------- RU / EN ----------
async function bmsLangFlow() {
  console.log("\n# bms: language");
  const acc = (id, st) => ({ account_id: id, name: `Acc ${id}`, account_status: st, currency: "USD", timezone_name: "UTC", amount_spent: "100", business: { id: "1001", name: "Alpha Media" } });
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ accounts: { data: [acc("1", 1), acc("2", 1), acc("3", 2)] } }) });
  await adsPage(b);
  const pop = await popup(b);
  await pop.click('[data-tab="accounts"]'); await rowsAre(pop, ".acc", 3);
  await pop.click('[data-tab="bms"]'); await rowsAre(pop, ".bm", 3);
  await pop.click('#bmsChips .chip:has-text("Pending")');
  ok("EN: the chip narrows to one row", await rowsAre(pop, ".bm", 1));
  await pop.click('[data-lang="ru"]');
  ok("RU: the chip stays selected (it holds the status, not the label) and is Russian", (await rowsAre(pop, ".bm", 1)) && has(await text(pop, "#bmsChips"), "На проверке 1") && (await pop.locator("#bmsChips .chip.on").count()) === 1, await text(pop, "#bmsChips"));
  await pop.click('#bmsChips .chip:has-text("На проверке")');
  await rowsAre(pop, ".bm", 3);
  const alpha = await row(pop, "Alpha Media").innerText();
  ok("RU: pills, created, links, counts", has(alpha, "Подтверждён") && has(alpha, "Админ") && has(alpha, "Создан 01.03.2026") && has(alpha, "Настройки") && has(alpha, "Качество") && has(alpha, "3 кабинета · 2 активно · 1 заблокировано"), alpha);
  const beta = await row(pop, "Beta Ads").innerText();
  ok("RU: role, page, 2FA", has(beta, "Сотрудник") && has(beta, "Страница: Beta Page") && has(beta, "2FA: для всех") && has(beta, "Нет кабинетов"), beta);
  ok("RU: total line, placeholder, button, tab name",
    /^3 BM · обновлено только что$/.test(await text(pop, "#bmsTotal")) && (await pop.getAttribute("#bmFilter", "placeholder")) === "Поиск" && has(await text(pop, "#copyBmIds"), "ID BM") && (await text(pop, '[data-tab="bms"]')) === "BM",
    `${await text(pop, "#bmsTotal")} | ${await pop.getAttribute("#bmFilter", "placeholder")} | ${await text(pop, "#copyBmIds")}`);
  ok("RU: the refresh button and search have Russian labels", (await pop.getAttribute("#loadBms", "aria-label")) === "Обновить BM" && (await pop.getAttribute("#bmFilter", "aria-label")) === "Поиск по BM");
  await pop.click('[data-lang="en"]');
  ok("back to English everywhere", await until(pop, () => /^3 BM · updated/.test(document.querySelector("#bmsTotal").textContent.trim()) && /Verified/.test(document.querySelector("#bmsList").textContent)
    && document.querySelector("#bmFilter").placeholder === "Search" && /Copy IDs/.test(document.querySelector("#copyBmIds").textContent)));
  noErrs(b);
  await b.ctx.close();
}

// ---------- layout, keyboard, focus ----------
async function bmsLayoutFlow() {
  console.log("\n# bms: layout and keyboard");
  const many = Array.from({ length: 30 }, (_, i) => bm(String(5000 + i), i % 3 ? `Business ${i}` : `A very long business manager name that has to end in an ellipsis instead of pushing the pills out ${i}`,
    { verification_status: ["verified", "pending_need_more_info", "revoked"][i % 3], created_time: `2026-0${(i % 9) + 1}-1${i % 9}T00:00:00+0000`, primary_page: i % 2 ? { id: "7", name: "A page with an extraordinarily long name for the layout test" } : undefined }));
  const b = await boot({ fb: adsFb(TOK), graph: graphFor({ rows: many }) });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("30 rows", await rowsAre(pop, ".bm", 30));
  ok("no horizontal overflow at 560 px (page and every row)", await pop.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    && [...document.querySelectorAll(".bm")].every((r) => r.scrollWidth <= r.clientWidth)), await pop.evaluate(() => `${document.documentElement.scrollWidth}/${document.documentElement.clientWidth}`));
  ok("a long name is cut with an ellipsis (the full one is the tooltip)", await pop.evaluate(() => { const n = [...document.querySelectorAll(".bm-name-text")].find((x) => x.textContent.startsWith("A very long")); return getComputedStyle(n).textOverflow === "ellipsis" && n.scrollWidth > n.clientWidth && !!n.parentElement.title; }));
  ok("the controls stay in the card, the list below it", await pop.evaluate(() => document.querySelector("#bmsCard #bmFilter") && document.querySelector("#bmsCard #loadBms") && document.querySelector("#bmsList").previousElementSibling.id === "bmsCard"));

  // focus survives a redraw: typing in the search, pressing a chip, pressing a row button
  await pop.click("#bmFilter"); await pop.keyboard.type("Business");
  ok("typing in the search keeps the caret in the field", await pop.evaluate(() => document.activeElement.id === "bmFilter" && document.activeElement.value === "Business"));
  await pop.fill("#bmFilter", "");
  await pop.focus('#bmsChips .chip:has-text("Verified")'); await pop.keyboard.press("Enter");
  ok("a chip pressed with the keyboard keeps focus after the redraw", await pop.evaluate(() => document.activeElement.dataset.focus === "bm-chip:verified" && document.activeElement.getAttribute("aria-pressed") === "true"), await pop.evaluate(() => document.activeElement.outerHTML.slice(0, 120)));
  await pop.keyboard.press("Enter");
  ok("…and again the other way", await pop.evaluate(() => document.activeElement.dataset.focus === "bm-chip:verified" && document.activeElement.getAttribute("aria-pressed") === "false"));
  ok("every control of a row is reachable by keyboard (buttons and links, no bare divs)", await pop.evaluate(() => { const r = document.querySelector(".bm"); return [...r.querySelectorAll("[data-focus]")].every((n) => ["BUTTON", "A"].includes(n.tagName) && n.tabIndex >= 0); }));
  noErrs(b);
  await b.ctx.close();

  // all BMs verified: one status, no chips
  const b2 = await boot({ fb: adsFb(TOK), graph: graphFor({ rows: [bm("1", "One"), bm("2", "Two")] }) });
  await adsPage(b2);
  const pop2 = await popup(b2, "bms");
  ok("one status for every BM: no chips", (await rowsAre(pop2, ".bm", 2)) && (await pop2.locator("#bmsChips .chip").count()) === 0);
  // no BMs at all
  const b3 = await boot({ fb: adsFb(TOK), graph: graphFor({ rows: [] }) });
  await adsPage(b3);
  const pop3 = await popup(b3, "bms");
  ok("no BMs: says so, and Copy IDs is disabled", (await until(pop3, () => /No business managers on this profile/.test(document.querySelector("#bmsList").textContent))) && (await pop3.$eval("#copyBmIds", (n) => n.disabled)), await text(pop3, "#bmsList"));
  const again = await popup(b3); await again.waitForTimeout(700);
  ok("…an empty list is a loaded list: reopening does not ask again", bmHits(b3).length === 1, String(bmHits(b3).length));
  await b2.ctx.close(); await b3.ctx.close();
}

export const flows = { bms: bmsFlow, bmsFields: bmsFieldsFlow, bmsPerm: bmsPermFlow, bmsAccounts: bmsAccountsFlow, bmsCopy: bmsCopyFlow, bmsCache: bmsCacheFlow, bmsLimits: bmsLimitsFlow, bmsPaging: bmsPagingFlow, bmsLang: bmsLangFlow, bmsLayout: bmsLayoutFlow };
