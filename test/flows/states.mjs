// The states of a list tab that has no rows (js/list-state.js): loading (skeleton), no token, a dead session, a token that cannot read the list
// (permission codes), another failure, nothing loaded yet, nothing there; the same calm states and phrases on the Businesses, Ad accounts and
// Pages tabs; the controls that only make sense next to rows are hidden; a refused refresh above old rows is a muted note; the refresh icon turns
// while a list is being read. Fictional data; Graph is a mock.
import { TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, accountsJson, adsFb, ROW, done, tr, trx, useLang, waitFor, near } from "../harness.mjs";

const TABS = { accounts: { list: "#accountsList", btn: "#loadAccounts", hidden: ["#periodSeg", "#accountsTotal", "#copyLiveIds"], none: tr("acc.none"), loading: tr("acc.loading") },
  bms: { list: "#bmsList", btn: "#loadBms", hidden: ["#bmsPeriod", "#bmsTotal"], none: tr("bms.none"), loading: tr("bms.loading") },
  pages: { list: "#pagesList", btn: "#loadPages", hidden: [], none: tr("pages.none"), loading: tr("pages.loading") } };
const perm = (code = 10) => ({ status: 400, body: { error: { code, message: `(#${code}) Application does not have permission for this action` } } });
const view = (p, list) => p.evaluate((sel) => { const e = document.querySelector(`${sel} .lempty`); return e && { kind: e.dataset.state, text: e.querySelector(".lempty-text")?.textContent, detail: e.querySelector(".lempty-detail")?.textContent ?? null,
  btn: [...e.querySelectorAll(".btn")].map((b) => b.textContent.trim()), icon: e.querySelectorAll(".i").length, iconColor: getComputedStyle(e.querySelector(".i")).color, textColor: getComputedStyle(e.querySelector(".lempty-text")).color }; }, list);
const hiddenControls = (p, sels) => p.evaluate((ss) => ss.every((s) => getComputedStyle(document.querySelector(s)).display === "none"), sels);
const toastErr = (p) => p.evaluate(() => document.querySelector("#toast").classList.contains("show") && document.querySelector("#toast").classList.contains("err"));

async function permFlow() {
  console.log("\n# list states: a token that cannot read the list");
  for (const [tab, T] of Object.entries(TABS)) {
    const b = await boot({ fb: adsFb(TOK), graph: () => perm(10) });
    await adsPage(b);
    const pop = await popup(b, tab);
    await until(pop, (sel) => !!document.querySelector(`${sel} .lempty[data-state="perm"]`), T.list);
    const v = await view(pop, T.list);
    ok(`${tab}: the same calm sentence on every tab, a lock icon (muted), ONE 'Try again' button`, v.kind === "perm" && v.text === tr("list.perm") && v.btn.join() === tr("list.retry") && v.icon === 1 && v.iconColor === "rgb(138, 144, 153)", JSON.stringify(v));
    ok(`${tab}: no red toast for it (it is not an error of ours), no red text`, !(await toastErr(pop)) && (await pop.locator(`${T.list} .err-text`).count()) === 0);
    ok(`${tab}: the controls that need rows are hidden`, await hiddenControls(pop, T.hidden));
    ok(`${tab}: the text is secondary grey, readable (not the disabled grey)`, v.textColor === "rgb(96, 103, 112)", v.textColor);
    if (tab === "accounts") {
      await useLang(pop, "ru");
      ok("RU: the same sentence in Russian", await until(pop, (s) => document.querySelector("#accountsList .lempty-text")?.textContent === s, tr("list.perm")), await text(pop, "#accountsList"));
      ok("…and the button says 'Try again' in Russian", (await text(pop, "#accountsList .lempty .btn")) === tr("list.retry"));
      b.graph = () => ({ body: accountsJson });
      await resetLocks(pop);
      await pop.click("#accountsList .lempty .btn");
      ok("the button loads again (a click, not an automatic try): the rows replace the state and the period / total are back", (await rowsAre(pop, ROW, 1)) && (await pop.locator("#accountsList .lempty").count()) === 0
        && !(await hiddenControls(pop, ["#periodSeg"])) && !(await hiddenControls(pop, ["#accountsTotal"])));
    }
    await done(b);
  }
  // codes 200-299 and 283 are the same family
  for (const code of [200, 283]) {
    const b = await boot({ fb: adsFb(TOK), graph: () => perm(code) });
    await adsPage(b);
    const pop = await popup(b, "accounts");
    ok(`code ${code}: the same permission state`, await until(pop, () => !!document.querySelector('#accountsList .lempty[data-state="perm"]')) && !(await toastErr(pop)));
    await done(b);
  }
}

async function errorFlow() {
  console.log("\n# list states: another failure, nothing loaded, nothing there, loading, no token, dead session");
  // another failure: the toast (a click) and the state say what happened, Graph's words are the detail
  let ok500 = false;
  let b = await boot({ fb: adsFb(TOK), graph: () => (ok500 ? { body: accountsJson } : { status: 500, body: { error: { code: 1, message: "An unknown error occurred" } } }) });
  await adsPage(b);
  let pop = await popup(b, "accounts");
  await until(pop, () => !!document.querySelector('#accountsList .lempty[data-state="error"]'));
  let v = await view(pop, "#accountsList");
  ok("a failed load: the empty list says what happened — 'Couldn't load', Graph's words muted under it, ONE 'Try again' button (a red toast came too, as for any failure)", v.kind === "error" && v.text === tr("list.error") && v.detail === tr("err.graphIs", { m: "An unknown error occurred" }) && v.btn.join() === tr("list.retry") && (await toastErr(pop)), JSON.stringify(v));
  ok("…the controls that need rows are hidden", await hiddenControls(pop, TABS.accounts.hidden));
  const sent = b.hits.length;
  await resetLocks(pop);
  await pop.click("#accountsList .lempty .btn");
  await waitFor(() => b.hits.length > sent);
  await until(pop, () => !document.querySelector("#loadAccounts").hasAttribute("aria-busy"));              // the load has ended
  ok("a click on 'Try again' loads again (a request goes out) and the state stays until a load works", b.hits.length > sent && (await view(pop, "#accountsList")).kind === "error", `${sent} ${b.hits.length}`);
  ok("…the one-minute slot is respected: a second click at once is told to wait, nothing is sent", await (async () => { const n = b.hits.length; await pop.evaluate(() => { document.querySelector("#toast").textContent = ""; }); await pop.click("#accountsList .lempty .btn"); const w = await until(pop, (src) => new RegExp(src).test(document.querySelector("#toast").textContent), trx("acc.wait", { n: /\d+/ }).source); return w && b.hits.length === n; })());
  ok500 = true; await resetLocks(pop);
  await pop.click("#accountsList .lempty .btn");
  ok("…and when the load works the rows are there", await rowsAre(pop, ROW, 1));
  await done(b);

  // nothing there: 'No ad accounts' + Refresh; the list is "loaded" so reopening does not load again
  b = await boot({ fb: adsFb(TOK), graph: () => ({ body: { data: [] } }) });
  await adsPage(b);
  for (const [tab, T] of Object.entries(TABS)) {
    pop = await popup(b, tab);
    await until(pop, (sel) => !!document.querySelector(`${sel} .lempty[data-state="none"]`), T.list);
    v = await view(pop, T.list);
    ok(`${tab}: nothing there → '${T.none}' and ONE 'Refresh' button (the Lucide inbox icon)`, v.kind === "none" && v.text === T.none && v.btn.join() === tr("refresh") && v.icon === 1, JSON.stringify(v));
    ok(`${tab}: …and the controls that need rows are hidden`, await hiddenControls(pop, T.hidden));
    await resetLocks(pop);
  }
  await done(b);

  // loading: skeleton rows, 'Loading…' for screen readers, the refresh icon turns, the controls that need rows are hidden
  b = await boot({ fb: adsFb(TOK), graph: () => ({ delay: 2000, body: accountsJson }) });       // every read takes 2 s (the list, then the business edges): the skeleton stays long enough to be measured
  await adsPage(b);
  pop = await popup(b, "accounts");
  await until(pop, () => !!document.querySelector("#accountsList .lsk-list"));
  await until(pop, () => document.querySelector("#loadAccounts").getAttribute("aria-busy") === "true");        // the loading line shows while the token is read; the read itself starts a moment later
  const sk = await pop.evaluate(() => { const l = document.querySelector("#accountsList .lsk-list");
    return { text: l?.textContent, busy: l?.getAttribute("aria-busy"), role: l?.getAttribute("role"), shapes: l?.children.length,
      anim: getComputedStyle(document.querySelector("#loadAccounts .i")).animationName, btnBusy: document.querySelector("#loadAccounts").getAttribute("aria-busy") }; });
  ok("loading: one plain 'Loading ad accounts…' line (status, busy), no placeholder shapes", sk.text === tr("acc.loading") && sk.busy === "true" && sk.role === "status" && sk.shapes === 0, JSON.stringify(sk));
  ok("…nothing moves: the busy refresh icon has no animation", sk.btnBusy === "true" && sk.anim === "none", JSON.stringify(sk));
  ok("…no controls without rows", await hiddenControls(pop, TABS.accounts.hidden));
  ok("…and when the rows arrive the loading line is gone", (await until(pop, ([s, k]) => document.querySelectorAll(s).length === k, [ROW, 1], 25000)) && (await pop.locator("#accountsList .lsk-list").count()) === 0);
  await done(b);

  // a refused refresh above old rows is a muted note, the rows stay
  let denied = false;
  b = await boot({ fb: adsFb(TOK), graph: () => (denied ? perm(10) : { body: accountsJson }) });
  await adsPage(b);
  pop = await popup(b, "accounts");
  await rowsAre(pop, ROW, 1);
  denied = true; await resetLocks(pop);
  await pop.click("#loadAccounts");
  ok("refresh refused as a permission problem: the old rows stay and a muted note above them says it", (await until(pop, () => !!document.querySelector("#accountsList .list-note"))) && (await rowsAre(pop, ROW, 1)) && has(await text(pop, "#accountsList .list-note"), tr("list.perm")) && !(await toastErr(pop)));
  denied = false; await resetLocks(pop);
  await pop.click("#loadAccounts");
  ok("…a good refresh removes it", await until(pop, () => !document.querySelector("#accountsList .list-note")) && (await rowsAre(pop, ROW, 1)));
  await done(b);

  // no token: the Token tab's own reason on every list tab
  b = await boot({ fb: () => "<p>feed</p>", graph: () => ({ body: accountsJson }) });
  await (await b.ctx.newPage()).goto("https://www.facebook.com/");
  for (const [tab, T] of Object.entries(TABS)) {
    pop = await popup(b, tab);
    await until(pop, (sel) => !!document.querySelector(`${sel} .lempty[data-state="notoken"]`), T.list);       // the automatic try ended without a token
    v = await view(pop, T.list);
    ok(`${tab}: no token → the Token tab's own reason ('${await text(pop, "#tokenBox")}'), a key icon, 'Try again'`, v.kind === "notoken" && v.text === (await text(pop, "#tokenBox")) && v.btn.join() === tr("list.retry") && v.icon === 1, JSON.stringify(v));
  }
  ok("…no request was sent", b.hits.length === 0);
  await done(b);

  // dead session: said in the state, the button reads the token again (the deliberate retry of the ⟳) and loads
  let dead = true;
  b = await boot({ fb: adsFb(TOK), graph: () => (dead ? { status: 400, body: { error: { code: 190, error_subcode: 463, message: "Session has expired" } } } : { body: accountsJson }) });
  await adsPage(b);
  pop = await popup(b, "accounts");
  await until(pop, () => !!document.querySelector('#accountsList .lempty[data-state="dead"]'));
  v = await view(pop, "#accountsList");
  ok("dead session: the state says so with the code, a lock icon, 'Try again'", v.kind === "dead" && has(v.text, "190/463") && v.btn.join() === tr("list.retry"), JSON.stringify(v));
  dead = false; await resetLocks(pop);
  await pop.click("#accountsList .lempty .btn");
  ok("…the button clears the dead mark (like ⟳), reads the token again and loads: the rows are there", await rowsAre(pop, ROW, 1) && !(await pop.evaluate(() => (document.querySelector("#kindCard")?.textContent || "").includes("closed"))), await text(pop, "#accountsList"));
  await done(b);
}

export const flows = { statesPerm: permFlow, statesOther: errorFlow };
