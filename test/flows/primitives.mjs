// The shared building blocks a new tab relies on, exercised inside the real popup with the extension's own module
// instances: rate slots across windows, readPaged against the Graph mock, redraw registrations.
import { GRAPH, TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, accountsJson, adsFb, stored, openAds } from "../harness.mjs";

async function slotFlows() {
  console.log("\n# primitives: rate slots (claimSlot)");
  const b = await boot({ fb: adsFb(TOK), graph: (u) => (/\/ads$/.test(u.pathname) ? { body: { data: [{ id: "a1", name: "Ad", effective_status: "ACTIVE" }] } } : { body: accountsJson }) });
  await adsPage(b);
  const p1 = await popup(b), p2 = await popup(b);
  const claim = (p, key, ms) => p.evaluate(async ([k, m]) => (await import(chrome.runtime.getURL("js/state.js"))).claimSlot(k, m), [key, ms]);
  const slots = async (p) => (await stored(p, "locks"))?.slots || {};

  const first = await claim(p1, "bms", 5000), second = await claim(p2, "bms", 5000);
  ok("a slot taken in one window is taken in the other, with the time left", first === 0 && second > 3000 && second <= 5000, `${first} / ${second}`);
  ok("another key is independent and has its own interval", (await claim(p2, "pages", 1000)) === 0
    && (await slots(p1)).bms - (await slots(p1)).pages > 3000, JSON.stringify(await slots(p1)));
  const [r1, r2] = await Promise.all([claim(p1, "race", 10000), claim(p2, "race", 10000)]);
  ok("two windows claiming at the same instant: exactly one is granted", (r1 === 0) !== (r2 === 0), `${r1} / ${r2}`);
  await claim(p1, "sync", 20000);
  ok("a claim in one window reaches the other window's state", await until(p2, async () => (await import(chrome.runtime.getURL("js/state.js"))).slotLeft("sync") > 15000));

  await resetLocks(p1);                                    // the old { accountsAt, ads } shape: everything is free again
  ok("the old locks shape frees every key", (await claim(p2, "bms", 5000)) === 0 && (await claim(p2, "race", 10000)) === 0 && (await claim(p2, "sync", 1000)) === 0);

  // the list keeps its minute, one account's ads their 30 s
  await p1.click('[data-tab="accounts"]');
  await rowsAre(p1, ".acc", 1);
  const sl = await slots(p1), now = Date.now();
  ok("the account list holds its slot for a minute (key accounts)", sl.accounts - now > 55000 && sl.accounts - now <= 60500, String(sl.accounts - now));
  await resetLocks(p1); await openAds(p1);
  const ad = (await slots(p1))["ads:111"] - Date.now();
  ok("one account's ads hold theirs for 30 s (key ads:<id>)", ad > 25000 && ad <= 30500, String(ad));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

async function pagedFlows() {
  console.log("\n# primitives: readPaged");
  const refuse = { picture: true };
  const b = await boot({ fb: adsFb(TOK), graph: (u) => {
    if (!u.pathname.endsWith("/me/pages")) return { body: accountsJson };
    if (refuse.picture && u.searchParams.get("fields").includes("picture"))
      return { status: 400, body: { error: { code: 100, message: "(#100) Tried accessing nonexisting field (picture) on node type (Page)" } } };
    return { body: u.searchParams.get("after") ? { data: [{ id: "3" }] } : { data: [{ id: "1" }, { id: "2" }], paging: { next: `${GRAPH}/n`, cursors: { after: "c1" } } } };
  } });
  await adsPage(b);
  const pop = await popup(b);                              // the silent token read on open has put a token into the shared state
  const run = (opts) => pop.evaluate(async (o) => {
    const { readPaged } = await import(chrome.runtime.getURL("js/graph.js"));
    const { state } = await import(chrome.runtime.getURL("js/state.js"));
    state.skip = new Set();
    const r = await readPaged("me/pages", { base: ["id", "name"], optional: { picture: "picture{url}" }, skip: state.skip, ...o });
    return { ids: r.rows.map((x) => x.id), truncated: r.truncated, skip: [...state.skip] };
  }, opts);
  const reads = () => b.hits.filter((h) => h.startsWith("/me/pages"));

  const out = await run({ limit: 2 });
  ok("rows of every page, field dropped and remembered", out.ids.join() === "1,2,3" && !out.truncated && out.skip.join() === "picture", JSON.stringify(out));
  const r = reads();
  ok("the refused page is asked again as the same page; later pages skip the field too", r.length === 3 && has(r[0], "picture") && !has(r[1], "picture") && !has(r[1], "after=")
    && !has(r[2], "picture") && has(r[2], "after=c1") && has(r[0], "limit=2"), r.join(" | "));
  refuse.picture = false;
  const cut = await run({ maxPages: 1 });
  ok("maxPages stops the walk and reports truncated", cut.ids.join() === "1,2" && cut.truncated === true, JSON.stringify(cut));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

async function renderFlows() {
  console.log("\n# primitives: redraw registrations (registerRender)");
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: accountsJson }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await rowsAre(pop, ".acc", 1);
  const before = { pill: await text(pop, "#usage"), meta: await pop.getAttribute("#loadAccounts", "title") };
  await pop.evaluate(async () => {
    const { state } = await import(chrome.runtime.getURL("js/state.js"));
    const { runRenders } = await import(chrome.runtime.getURL("js/registry.js"));
    state.cooldownUntil = Date.now() + 5 * 60000;          // no storage event, no bus event: only the 30 s tick can show it
    state.fetchedAt -= 5 * 60000;
    runRenders("tick");
  });
  ok("the 30 s tick redraws the header pill and the 'updated … ago' of the refresh button's tooltip", (await text(pop, "#usage")) === "Paused 5 min" && has(await pop.getAttribute("#loadAccounts", "title"), "updated 5 min ago") && before.pill === "" && has(before.meta, "just now"),
    `${before.pill} | ${before.meta} -> ${await text(pop, "#usage")} | ${await pop.getAttribute("#loadAccounts", "title")}`);
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

async function tabApiFlows() {
  console.log("\n# primitives: registerTab");
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: accountsJson }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await rowsAre(pop, ".acc", 1);
  // Two tabs that exist only for this test: the button and panel are markup (popup.html in a real tab), the rest is registerTab.
  await pop.evaluate(async () => {
    for (const name of ["zz", "zy"]) {
      const btn = document.createElement("button");
      Object.assign(btn, { className: "tab", textContent: name }); btn.dataset.tab = name; btn.setAttribute("role", "tab");
      document.querySelector(".tabs").append(btn);
      const panel = document.createElement("section"); panel.id = `tab-${name}`; panel.className = "panel"; document.querySelector("main").append(panel);
    }
    const { registerTab } = await import(chrome.runtime.getURL("js/registry.js"));
    window.__shown = [];
    registerTab("zz", { tall: true, onShow: () => window.__shown.push("zz") });
    registerTab("zy", { onShow: () => window.__shown.push("zy") });
  });
  const look = () => pop.evaluate(() => ({ tab: document.querySelector(".tab.active")?.dataset.tab, panel: document.querySelector(".panel.active")?.id, tall: document.body.classList.contains("tall"), saved: localStorage.getItem("tab"), shown: window.__shown.join() }));
  await pop.focus('[data-tab="pages"]');   // the last real tab: the test tabs come right after it
  await pop.keyboard.press("ArrowRight"); let s = await look();
  ok("a registered tab shows its panel, is remembered, and its onShow runs", s.tab === "zz" && s.panel === "tab-zz" && s.saved === "zz" && s.shown === "zz", JSON.stringify(s));
  ok("tall: true gives the popup full height", s.tall === true, JSON.stringify(s));
  await pop.keyboard.press("ArrowRight"); s = await look();
  ok("a tab that is not tall goes back to normal height", s.tab === "zy" && s.tall === false && s.shown === "zz,zy", JSON.stringify(s));
  await pop.keyboard.press("ArrowLeft"); s = await look();
  ok("onShow runs every time the tab is shown", s.tab === "zz" && s.tall === true && s.shown === "zz,zy,zz", JSON.stringify(s));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

export const flows = { slotapi: slotFlows, pagedapi: pagedFlows, renderapi: renderFlows, tabapi: tabApiFlows };
