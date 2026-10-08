// The popup shell: tabs (restore, height, keyboard) and the RU / EN switch.
import { TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, adsFb, boxWait, accountsJson, ROW, captureClipboard } from "../harness.mjs";

async function tabFlows() {
  console.log("\n# popup shell: tabs");
  const reads = (b) => b.hits.filter((h) => h.startsWith("/me/adaccounts")).length;
  const look = (p) => p.evaluate(() => ({ tab: document.querySelector(".tab.active")?.dataset.tab, panel: document.querySelector(".panel.active")?.id,
    selected: document.querySelector(".tab[aria-selected=true]")?.dataset.tab, h: Math.round(document.body.getBoundingClientRect().height), saved: localStorage.getItem("tab"),
    focus: document.activeElement?.dataset?.tab ?? null, tabbable: [...document.querySelectorAll(".tab")].filter((t) => t.tabIndex === 0).map((t) => t.dataset.tab).join() }));
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: accountsJson }) });
  await adsPage(b);
  let pop = await popup(b);
  let s = await look(pop);
  ok("opens on the Token tab, full height (600 px on every tab), no request", s.tab === "token" && s.panel === "tab-token" && s.selected === "token" && s.h >= 600 && reads(b) === 0, JSON.stringify(s));

  // the order of the tabs is the order in the page, so it is the order of the keyboard: Token · Cookies · Businesses · Accounts · Pages
  const order = await pop.evaluate(() => ({ tabs: [...document.querySelectorAll(".tab")].map((n) => n.dataset.tab), panels: [...document.querySelectorAll("main > .panel")].map((n) => n.id),
    labels: [...document.querySelectorAll(".tab")].map((n) => n.textContent.trim()) }));
  ok("tab order: Token · Cookies · Businesses · Accounts · Pages (buttons and panels)", order.tabs.join() === "token,cookies,bms,accounts,pages" && order.panels.join() === "tab-token,tab-cookies,tab-bms,tab-accounts,tab-pages"
    && order.labels.join() === "Token,Cookies,Businesses,Accounts,Pages", JSON.stringify(order));

  // structure: the brand is the page's h1, the strip is a labelled tablist with one tab stop
  const struct = await pop.evaluate(() => ({ h1: document.querySelector("h1.brand")?.textContent.trim(), h1s: document.querySelectorAll("h1").length, list: document.querySelector('[role="tablist"]')?.getAttribute("aria-label"),
    panelsLabelled: [...document.querySelectorAll('[role="tabpanel"]')].every((p) => document.getElementById(p.getAttribute("aria-labelledby"))) }));
  ok("structure: 'FB Helper' is the one h1; the tab strip is a tablist named 'Sections'; every panel is labelled by its tab", struct.h1 === "FB Helper" && struct.h1s === 1 && struct.list === "Sections" && struct.panelsLabelled, JSON.stringify(struct));
  ok("exactly one tab stop in the strip (roving tabindex): the open tab", s.tabbable === "token", s.tabbable);

  // keyboard (WAI-ARIA tabs, MANUAL activation): arrows / Home / End only move focus (a tab that loads a list must not send requests as the arrow passes it);
  // Enter or Space opens the focused tab
  await pop.focus('[data-tab="token"]');
  await pop.keyboard.press("ArrowRight"); s = await look(pop);
  ok("ArrowRight moves focus to Cookies and does NOT open it (Token stays open)", s.focus === "cookies" && s.tab === "token" && s.panel === "tab-token" && s.selected === "token", JSON.stringify(s));
  ok("…the focused tab is the strip's one tab stop now", s.tabbable === "cookies", s.tabbable);
  await pop.keyboard.press("Enter"); s = await look(pop);
  ok("Enter opens the focused tab", s.tab === "cookies" && s.panel === "tab-cookies" && s.selected === "cookies" && s.h >= 600, JSON.stringify(s));
  await pop.keyboard.press("ArrowRight"); s = await look(pop);
  ok("ArrowRight again: focus on Businesses; its list is NOT loaded just because the arrow passed over it", s.focus === "bms" && s.tab === "cookies" && reads(b) === 0, JSON.stringify(s) + reads(b));
  await pop.keyboard.press("Space"); s = await look(pop);
  ok("Space opens it, at the same height", s.tab === "bms" && s.panel === "tab-bms" && s.h >= 600, JSON.stringify(s));
  ok("…and it loads the Ad accounts list by itself too (its spend and counts come from there)", await until(pop, () => document.querySelectorAll("#accountsList .lrow").length === 1) && reads(b) === 1, String(reads(b)));
  await pop.keyboard.press("ArrowRight"); await pop.keyboard.press("Enter"); s = await look(pop);
  ok("Businesses → Accounts: the list is already there, nothing more is read", s.tab === "accounts" && s.panel === "tab-accounts" && (await rowsAre(pop, ROW, 1)) && reads(b) === 1, JSON.stringify(s) + reads(b));
  await pop.keyboard.press("ArrowRight"); await pop.keyboard.press("Enter"); s = await look(pop);
  ok("Accounts → Pages", s.tab === "pages" && s.panel === "tab-pages", JSON.stringify(s));
  await pop.keyboard.press("ArrowRight"); s = await look(pop);
  ok("ArrowRight wraps from the last tab to the first (focus only)", s.focus === "token" && s.tab === "pages", JSON.stringify(s));
  await pop.keyboard.press("End"); ok("End: focus on the last tab", (await look(pop)).focus === "pages");
  await pop.keyboard.press("Home"); s = await look(pop);
  ok("Home: focus on the first tab; nothing was opened by moving around", s.focus === "token" && s.tab === "pages", JSON.stringify(s));
  await pop.keyboard.press("ArrowLeft"); ok("ArrowLeft wraps to the last", (await look(pop)).focus === "pages");
  await pop.keyboard.press("Tab"); s = await look(pop);
  ok("leaving the strip with the Tab key puts the tab stop back on the OPEN tab (Pages)", s.tabbable === "pages" && s.focus === null, JSON.stringify(s));
  await pop.click('[data-tab="token"]');
  ok("a click opens a tab at once (mouse users have no arrows)", (await look(pop)).tab === "token");

  // the last tab is remembered (localStorage) and restored, at the same full height
  for (const name of ["cookies", "accounts", "bms", "pages", "token"]) {
    await pop.click(`[data-tab="${name}"]`);
    pop = await popup(b);
    s = await look(pop);
    ok(`reopened on ${name}: that tab, full height`, s.tab === name && s.panel === `tab-${name}` && s.h >= 600 && s.saved === name, JSON.stringify(s));
  }
  await pop.evaluate(() => localStorage.setItem("tab", "nonsense")); await pop.reload();
  s = await look(pop);
  ok("a saved tab nobody knows falls back to Token", s.tab === "token" && s.h >= 600, JSON.stringify(s));
  ok("switching and reopening sent no further request", reads(b) === 1, String(reads(b)));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// A screen reader announces a change of a live region, not a region that appears together with its text: both regions are in the page from the start.
async function liveFlows() {
  console.log("\n# popup shell: live regions and toast");
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: accountsJson }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  const regions = await pop.evaluate(() => ({ live: (() => { const e = document.getElementById("live"); return e && { role: e.getAttribute("role"), aria: e.getAttribute("aria-live"), srOnly: e.classList.contains("sr-only"), w: e.getBoundingClientRect().width, text: e.textContent }; })(),
    toast: (() => { const e = document.getElementById("toast"); return e && { role: e.getAttribute("role"), aria: e.getAttribute("aria-live") }; })(), n: document.querySelectorAll("[aria-live]").length }));
  ok("both live regions exist before anything happened: #live (polite status, screen-reader-only, empty) and #toast", regions.live?.role === "status" && regions.live.aria === "polite" && regions.live.srOnly && regions.live.w <= 1 && regions.live.text === ""
    && regions.toast?.role === "status" && regions.toast.aria === "polite" && regions.n === 2, JSON.stringify(regions));
  await captureClipboard(pop);
  await rowsAre(pop, ROW, 1);
  await pop.click(`${ROW} .lrow-head .lrow-id`);
  ok("'ID copied' goes to the #live region that was already there (no new region is created, no toast)", await until(pop, () => document.getElementById("live").textContent === "ID copied") && (await pop.evaluate(() => document.querySelectorAll("[aria-live]").length)) === 2
    && !(await pop.evaluate(() => document.querySelector("#toast").classList.contains("show"))));
  // the toast stays longer for a long text: 60 ms a character, 2.6 s at least
  const stay = await pop.evaluate(async () => {
    const { toast } = await import(chrome.runtime.getURL("js/dom.js"));
    const el = document.querySelector("#toast"), out = {};
    for (const [k, msg] of [["short", "Copied"], ["long", "x".repeat(100)]]) {
      toast(msg); const t0 = performance.now();
      while (el.classList.contains("show") && performance.now() - t0 < 9000) await new Promise((r) => setTimeout(r, 50));
      out[k] = Math.round(performance.now() - t0);
    }
    return out;
  });
  ok("a short toast stays ~2.6 s, a 100-character one ~6 s", stay.short >= 2500 && stay.short < 3300 && stay.long >= 5900 && stay.long < 7000, JSON.stringify(stay));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

async function langFlows() {
  console.log("\n# popup shell: language switch");
  const two = { data: [
    { account_id: "111", name: "Acc A", account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: "500" },
    { account_id: "222", name: "Acc B", account_status: 2, currency: "USD", timezone_name: "UTC", amount_spent: "100" },
  ] };
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: two }) });
  await adsPage(b);
  const pop = await popup(b);
  ok("English: tab names and the token card", (await text(pop, '[data-tab="token"]')) === "Token" && has(await text(pop, "#kindCard"), "The main ads token"), await text(pop, "#kindCard"));
  await pop.click('[data-tab="accounts"]');
  ok("two accounts, two statuses, two chips", (await rowsAre(pop, ROW, 2)) && (await pop.locator(".chip").count()) === 2);
  await pop.click('.chip:has-text("Disabled")');
  ok("filtering by a status leaves one row", await rowsAre(pop, ROW, 1));
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 5 * 60000 }));   // as another window would
  ok("the throttle pause reaches the header pill from storage", await until(pop, () => /^Paused \d+ min$/.test(document.querySelector("#usage").textContent.trim())), await text(pop, "#usage"));

  await pop.click('[data-lang="ru"]');
  ok("RU: the status filter stays (it holds a status, not a word), the chips are Russian", (await rowsAre(pop, ROW, 1)) && has(await text(pop, "#statusChips"), "Заблокирован"), await text(pop, "#statusChips"));
  ok("RU: period buttons, total line, pause pill", (await text(pop, "#periodSeg .seg-btn.active")) === "Сегодня" && has(await text(pop, "#accountsTotal .total-label"), "Спенд") && /^Пауза \d+ мин$/.test(await text(pop, "#usage")),
    `${await text(pop, "#periodSeg .seg-btn.active")} | ${await text(pop, "#accountsTotal .total-label")} | ${await text(pop, "#usage")}`);
  ok("RU: tab names, token card, cookie status",
    (await text(pop, '[data-tab="token"]')) === "Токен" && (await text(pop, '[data-tab="accounts"]')) === "Кабинеты" && (await text(pop, '[data-tab="bms"]')) === "Бизнесы" && has(await text(pop, "#kindCard"), "Основной для рекламы") && has(await text(pop, "#cookieStatus"), "Вход выполнен"),
    `${await text(pop, '[data-tab="token"]')} | ${await text(pop, "#kindCard")} | ${await text(pop, "#cookieStatus")}`);
  ok("RU: the token is read again from the FB tab (still there)", await boxWait(pop, /^EAAB/));
  ok("RU is remembered", (await pop.evaluate(() => chrome.storage.local.get("lang"))).lang === "ru");

  await pop.click('[data-lang="en"]');
  ok("back to English", await until(pop, () => document.querySelector('[data-tab="token"]').textContent.trim() === "Token" && /^Paused \d+ min$/.test(document.querySelector("#usage").textContent.trim())
    && /Disabled/.test(document.querySelector("#statusChips").textContent)));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

export const flows = { tabs: tabFlows, live: liveFlows, lang: langFlows };
