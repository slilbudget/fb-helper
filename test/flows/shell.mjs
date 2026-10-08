// The popup shell: tabs (restore, height, keyboard) and the RU / EN switch.
import { TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, adsFb, boxWait, accountsJson } from "../harness.mjs";

async function tabFlows() {
  console.log("\n# popup shell: tabs");
  const reads = (b) => b.hits.filter((h) => h.startsWith("/me/adaccounts")).length;
  const look = (p) => p.evaluate(() => ({ tab: document.querySelector(".tab.active")?.dataset.tab, panel: document.querySelector(".panel.active")?.id,
    selected: document.querySelector(".tab[aria-selected=true]")?.dataset.tab, tall: document.body.classList.contains("tall"), saved: localStorage.getItem("tab") }));
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: accountsJson }) });
  await adsPage(b);
  let pop = await popup(b);
  let s = await look(pop);
  ok("opens on the Token tab, normal height, no request", s.tab === "token" && s.panel === "tab-token" && s.selected === "token" && !s.tall && reads(b) === 0, JSON.stringify(s));

  // the order of the tabs is the order in the page, so it is the order of the keyboard: Token · Cookies · Businesses · Ad accounts · Pages
  const order = await pop.evaluate(() => ({ tabs: [...document.querySelectorAll(".tab")].map((n) => n.dataset.tab), panels: [...document.querySelectorAll("main > .panel")].map((n) => n.id),
    labels: [...document.querySelectorAll(".tab")].map((n) => n.textContent.trim()) }));
  ok("tab order: Token · Cookies · Businesses · Ad accounts · Pages (buttons and panels)", order.tabs.join() === "token,cookies,bms,accounts,pages" && order.panels.join() === "tab-token,tab-cookies,tab-bms,tab-accounts,tab-pages"
    && order.labels.join() === "Token,Cookies,Businesses,Ad accounts,Pages", JSON.stringify(order));

  // keyboard (WAI-ARIA tabs): arrows / Home / End move between tabs and wrap; Businesses and Ad accounts load their lists like a click
  await pop.focus('[data-tab="token"]');
  await pop.keyboard.press("ArrowRight"); s = await look(pop);
  ok("ArrowRight: Token → Cookies", s.tab === "cookies" && s.panel === "tab-cookies" && s.selected === "cookies" && !s.tall, JSON.stringify(s));
  await pop.keyboard.press("ArrowRight"); s = await look(pop);
  ok("ArrowRight: Cookies → Businesses, at full height", s.tab === "bms" && s.panel === "tab-bms" && s.tall, JSON.stringify(s));
  ok("…and it loads the Ad accounts list by itself too (its spend and counts come from there)", await until(pop, () => document.querySelectorAll("#accountsList .acc").length === 1) && reads(b) === 1, String(reads(b)));
  await pop.keyboard.press("ArrowRight"); s = await look(pop);
  ok("ArrowRight: Businesses → Ad accounts, at full height; the list is already there, nothing more is read", s.tab === "accounts" && s.panel === "tab-accounts" && s.tall && (await rowsAre(pop, ".acc", 1)) && reads(b) === 1, JSON.stringify(s) + reads(b));
  await pop.keyboard.press("ArrowRight"); s = await look(pop);
  ok("ArrowRight: Ad accounts → Pages, at full height", s.tab === "pages" && s.panel === "tab-pages" && s.tall, JSON.stringify(s));
  await pop.keyboard.press("ArrowRight"); s = await look(pop);
  ok("ArrowRight wraps to Token, normal height again", s.tab === "token" && !s.tall, JSON.stringify(s));
  await pop.keyboard.press("End"); ok("End: the last tab", (await look(pop)).tab === "pages");
  await pop.keyboard.press("Home"); ok("Home: the first tab", (await look(pop)).tab === "token");
  ok("keyboard focus follows the tab", await pop.evaluate(() => document.activeElement?.dataset.tab === "token"));

  // the last tab is remembered (localStorage) and restored with its height
  for (const [name, tall] of [["cookies", false], ["accounts", true], ["bms", true], ["pages", true], ["token", false]]) {
    await pop.click(`[data-tab="${name}"]`);
    pop = await popup(b);
    s = await look(pop);
    ok(`reopened on ${name}: that tab, ${tall ? "full" : "normal"} height`, s.tab === name && s.panel === `tab-${name}` && s.tall === tall && s.saved === name, JSON.stringify(s));
  }
  await pop.evaluate(() => localStorage.setItem("tab", "nonsense")); await pop.reload();
  s = await look(pop);
  ok("a saved tab nobody knows falls back to Token", s.tab === "token" && !s.tall, JSON.stringify(s));
  ok("switching and reopening sent no further request", reads(b) === 1, String(reads(b)));
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
  ok("two accounts, two statuses, two chips", (await rowsAre(pop, ".acc", 2)) && (await pop.locator(".chip").count()) === 2);
  await pop.click('.chip:has-text("Disabled")');
  ok("filtering by a status leaves one row", await rowsAre(pop, ".acc", 1));
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 5 * 60000 }));   // as another window would
  ok("the throttle pause reaches the header pill from storage", await until(pop, () => /^Paused \d+ min$/.test(document.querySelector("#usage").textContent.trim())), await text(pop, "#usage"));

  await pop.click('[data-lang="ru"]');
  ok("RU: the status filter is cleared (it held an English label), the chips are Russian", (await rowsAre(pop, ".acc", 2)) && has(await text(pop, "#statusChips"), "Заблокирован"), await text(pop, "#statusChips"));
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

export const flows = { tabs: tabFlows, lang: langFlows };
