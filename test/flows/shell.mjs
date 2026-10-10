// The popup shell: tabs (restore, height, keyboard) and the RU / EN switch.
import { TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, adsFb, boxWait, accountsJson, ROW, captureClipboard, done, tr, trx, useLang , golosLoaded } from "../harness.mjs";

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
  ok("opens on the Token tab, as tall as its content (well under 600 px), no request", s.tab === "token" && s.panel === "tab-token" && s.selected === "token" && s.h < 600 && reads(b) === 0, JSON.stringify(s));

  // the order of the tabs is the order in the page, so it is the order of the keyboard: Token · Cookies · Businesses · Accounts · Pages
  const order = await pop.evaluate(() => ({ tabs: [...document.querySelectorAll(".tab")].map((n) => n.dataset.tab), panels: [...document.querySelectorAll("main > .panel")].map((n) => n.id),
    labels: [...document.querySelectorAll(".tab")].map((n) => n.textContent.trim()) }));
  ok("tab order: Token · Cookies · Businesses · Accounts · Pages (buttons and panels)", order.tabs.join() === "token,cookies,bms,accounts,pages" && order.panels.join() === "tab-token,tab-cookies,tab-bms,tab-accounts,tab-pages"
    && order.labels.join() === ["tab.token", "tab.cookies", "tab.bms", "tab.accounts", "tab.pages"].map((k) => tr(k)).join(), JSON.stringify(order));

  // structure: the brand is the page's h1, the strip is a labelled tablist with one tab stop
  const struct = await pop.evaluate(() => ({ name: chrome.runtime.getManifest().name, h1: document.querySelector("h1.brand")?.textContent.trim(), h1s: document.querySelectorAll("h1").length, list: document.querySelector('[role="tablist"]')?.getAttribute("aria-label"),
    panelsLabelled: [...document.querySelectorAll('[role="tabpanel"]')].every((p) => document.getElementById(p.getAttribute("aria-labelledby"))) }));
  ok("structure: the product's name ('FB Helper', 'Ads Helper' in the store build) is the one h1; the tab strip is a tablist named 'Sections'; every panel is labelled by its tab", struct.h1 === struct.name && struct.h1s === 1 && struct.list === tr("tabs.aria") && struct.panelsLabelled, JSON.stringify(struct));
  ok("exactly one tab stop in the strip (roving tabindex): the open tab", s.tabbable === "token", s.tabbable);

  // height follows what is open (user decision): the Token tab grows when "Token types" opens and shrinks back when it closes
  const hb = () => pop.evaluate(() => Math.round(document.body.getBoundingClientRect().height));
  const h0 = await hb(); await pop.click(".guide summary"); const h1 = await hb(); await pop.click(".guide summary"); const h2 = await hb();
  ok("Token tab: closed sections → short; open → taller; closed again → back to the same height", h0 < 450 && h1 > h0 && h2 === h0, JSON.stringify([h0, h1, h2]));
  // keyboard (WAI-ARIA tabs, MANUAL activation): arrows / Home / End only move focus (a tab that loads a list must not send requests as the arrow passes it);
  // Enter or Space opens the focused tab
  await pop.focus('[data-tab="token"]');
  await pop.keyboard.press("ArrowRight"); s = await look(pop);
  ok("ArrowRight moves focus to Cookies and does NOT open it (Token stays open)", s.focus === "cookies" && s.tab === "token" && s.panel === "tab-token" && s.selected === "token", JSON.stringify(s));
  ok("…the focused tab is the strip's one tab stop now", s.tabbable === "cookies", s.tabbable);
  await pop.keyboard.press("Enter"); s = await look(pop);
  ok("Enter opens the focused tab", s.tab === "cookies" && s.panel === "tab-cookies" && s.selected === "cookies" && s.h < 600, JSON.stringify(s));
  await pop.keyboard.press("ArrowRight"); s = await look(pop);
  ok("ArrowRight again: focus on Businesses; its list is NOT loaded just because the arrow passed over it", s.focus === "bms" && s.tab === "cookies" && reads(b) === 0, JSON.stringify(s) + reads(b));
  await pop.keyboard.press("Space"); s = await look(pop);
  ok("Space opens it, as tall as its content", s.tab === "bms" && s.panel === "tab-bms" && s.h < 600, JSON.stringify(s));
  ok("…and it loads the Ad accounts list by itself too (its spend and counts come from there)", await until(pop, () => document.querySelectorAll("#accountsList .lrow").length === 1) && reads(b) === 1, String(reads(b)));
  await pop.keyboard.press("ArrowRight"); await pop.keyboard.press("Enter"); s = await look(pop);
  ok("Businesses → Accounts: the list is already there, nothing more is read", s.tab === "accounts" && s.panel === "tab-accounts" && (await rowsAre(pop, ROW, 1)) && reads(b) === 1, JSON.stringify(s) + reads(b));
  // within a tab the height only grows: a row that closes leaves the window as it was (nothing jumps); the next tab switch lets go of it
  const r0 = await hb(); await pop.click(`${ROW} .lrow-title`); const r1 = await hb(); await pop.click(`${ROW} .lrow-title`); const r2 = await hb();
  await pop.click('[data-tab="pages"]'); await pop.click('[data-tab="accounts"]'); const r3 = await hb();
  ok("Accounts: a row opens → taller; it closes → the height stays; another tab and back → as tall as the content again", r1 > r0 && r2 === r1 && r3 === r0, JSON.stringify([r0, r1, r2, r3]));
  await pop.focus('[data-tab="accounts"]');
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
  // The real popup closes itself on blur / when hidden (popup.js; checked by hand over CDP, the toolbar popup is out of Playwright's reach).
  // popup.html in a tab, as here, has a tab and stays open.
  await pop.evaluate(() => { window.dispatchEvent(new Event("blur")); Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await pop.waitForTimeout(300);
  ok("popup.html in a tab stays open on blur and when hidden (only the toolbar popup closes itself)", !pop.isClosed());

  // the last tab is remembered (localStorage) and restored, at the same full height
  for (const name of ["cookies", "accounts", "bms", "pages", "token"]) {
    await pop.click(`[data-tab="${name}"]`);
    pop = await popup(b);
    s = await look(pop);
    ok(`reopened on ${name}: that tab, as tall as its content`, s.tab === name && s.panel === `tab-${name}` && s.h < 600 && s.saved === name, JSON.stringify(s));
  }
  await pop.evaluate(() => localStorage.setItem("tab", "nonsense")); await pop.reload();
  s = await look(pop);
  ok("a saved tab nobody knows falls back to Token", s.tab === "token" && s.h < 600, JSON.stringify(s));
  ok("switching and reopening sent no further request", reads(b) === 1, String(reads(b)));
  await done(b);
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
  ok("'ID copied' goes to the #live region that was already there (no new region is created, no toast)", await until(pop, (s) => document.getElementById("live").textContent === s, tr("acc.idCopied")) && (await pop.evaluate(() => document.querySelectorAll("[aria-live]").length)) === 2
    && !(await pop.evaluate(() => document.querySelector("#toast").classList.contains("show"))));
  // the toast stays longer for a long text: 60 ms a character, 2.6 s at least
  const stay = await pop.evaluate(async (copied) => {
    const { toast } = await import(chrome.runtime.getURL("js/dom.js"));
    const el = document.querySelector("#toast"), out = {};
    for (const [k, msg] of [["short", copied], ["long", "x".repeat(100)]]) {
      toast(msg); const t0 = performance.now();
      while (el.classList.contains("show") && performance.now() - t0 < 9000) await new Promise((r) => setTimeout(r, 50));
      out[k] = Math.round(performance.now() - t0);
    }
    return out;
  }, tr("copied"));
  ok("a short toast stays ~2.6 s, a 100-character one ~6 s", stay.short >= 2500 && stay.short < 3300 && stay.long >= 5900 && stay.long < 7000, JSON.stringify(stay));
  await done(b);
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
  ok("English: tab names and the token card", (await text(pop, '[data-tab="token"]')) === tr("tab.token") && has(await text(pop, "#kindCard"), tr("kind.EAAB")), await text(pop, "#kindCard"));
  await pop.click('[data-tab="accounts"]');
  ok("two accounts, two statuses, two chips", (await rowsAre(pop, ROW, 2)) && (await pop.locator("#statusChips .chip").count()) === 2);
  await pop.click(`#statusChips .chip:has-text("${tr("status.2")}")`);
  ok("filtering by a status leaves one row", await rowsAre(pop, ROW, 1));
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 5 * 60000 }));   // as another window would
  ok("the throttle pause reaches the header pill from storage", await until(pop, (src) => new RegExp(src).test(document.querySelector("#usage").textContent.trim()), trx("usage.pause", { n: /\d+/ }, { exact: true }).source), await text(pop, "#usage"));

  await useLang(pop, "ru");
  ok("RU: the status filter stays (it holds a status, not a word), the chips are Russian", (await rowsAre(pop, ROW, 1)) && has(await text(pop, "#statusChips"), tr("status.2")), await text(pop, "#statusChips"));
  ok("RU: period buttons, total line, pause pill", (await text(pop, "#periodSeg .seg-btn.active")) === tr("period.today") && has(await text(pop, "#accountsTotal .total-label"), tr("acc.spend")) && trx("usage.pause", { n: /\d+/ }, { exact: true }).test(await text(pop, "#usage")),
    `${await text(pop, "#periodSeg .seg-btn.active")} | ${await text(pop, "#accountsTotal .total-label")} | ${await text(pop, "#usage")}`);
  ok("RU: tab names, token card, cookie status",
    (await text(pop, '[data-tab="token"]')) === tr("tab.token") && (await text(pop, '[data-tab="accounts"]')) === tr("tab.accounts") && (await text(pop, '[data-tab="bms"]')) === tr("tab.bms") && has(await text(pop, "#kindCard"), tr("kind.EAAB")) && has(await text(pop, "#cookieStatus"), tr("ck.loggedIn")),
    `${await text(pop, '[data-tab="token"]')} | ${await text(pop, "#kindCard")} | ${await text(pop, "#cookieStatus")}`);
  ok("RU: the token is read again from the FB tab (still there)", await boxWait(pop, /^EAAB/));
  ok("RU is remembered", (await pop.evaluate(() => chrome.storage.local.get("lang"))).lang === "ru");

  await useLang(pop, "en");
  ok("back to English", await until(pop, ([tab, src, chip]) => document.querySelector('[data-tab="token"]').textContent.trim() === tab && new RegExp(src).test(document.querySelector("#usage").textContent.trim())
    && document.querySelector("#statusChips").textContent.includes(chip), [tr("tab.token"), trx("usage.pause", { n: /\d+/ }, { exact: true }).source, tr("status.2")]));
  await done(b);
}

// Every width and height the layout checks measure is Golos Text's: the popup carries its own font (css/fonts.css, three woff2 files, no system font is asked for
// by name). A browser that had not loaded it would measure a fallback and every layout check would be about something else, on a Linux runner as much as on a Mac.
async function fontFlows() {
  console.log("\n# popup shell: the bundled font");
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: accountsJson }) });
  await adsPage(b);
  const pop = await popup(b, "token");
  const faces = () => pop.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map((f) => ({ family: f.family.replace(/["']/g, ""), status: f.status, range: f.unicodeRange })); });
  let list = await faces();
  const golos = list.filter((f) => f.family === "Golos Text");
  const range = { cyrillic: /U\+400/, latinExt: /U\+100-2BA/, latin: /U\+0-FF\b/ };
  ok("three faces of Golos Text are declared: Cyrillic, Latin extended, Latin", golos.length === 3 && golos.some((f) => range.cyrillic.test(f.range)) && golos.some((f) => range.latinExt.test(f.range)) && golos.some((f) => range.latin.test(f.range)), JSON.stringify(golos));
  ok("the Latin face is loaded for the English popup", golos.some((f) => range.latin.test(f.range) && f.status === "loaded"), JSON.stringify(golos));
  ok("the text of the page is set in it first (a missing face would fall back to the system font and every pixel check would measure that)", await pop.evaluate(() => getComputedStyle(document.body).fontFamily.startsWith('"Golos Text"') && getComputedStyle(document.querySelector(".tab")).fontFamily.startsWith('"Golos Text"')));
  ok("the faces come from the extension's own files, not from the network or a system font", await pop.evaluate(() => {
    const rules = [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).filter((r) => r instanceof CSSFontFaceRule);
    return rules.length === 3 && rules.every((r) => /^url\("\.\.\/fonts\/golostext-[a-z-]+\.woff2"\) format\("woff2"\)$/.test(r.style.getPropertyValue("src")));
  }));
  ok("the browser answers 'yes' for the Latin text of the popup", await pop.evaluate(() => document.fonts.check('14px "Golos Text"', "Account 123")));
  await useLang(pop, "ru");
  list = await faces();
  ok("switching to Russian loads the Cyrillic face, and the browser answers 'yes' for the Russian text", list.some((f) => f.family === "Golos Text" && range.cyrillic.test(f.range) && f.status === "loaded") && await pop.evaluate(() => document.fonts.check('14px "Golos Text"', "Кабинеты")), JSON.stringify(list.filter((f) => f.family === "Golos Text")));
  ok("…and the helper of the harness agrees (golosLoaded)", await golosLoaded(pop));
  await done(b);
}

export const flows = { tabs: tabFlows, live: liveFlows, lang: langFlows, fonts: fontFlows };
