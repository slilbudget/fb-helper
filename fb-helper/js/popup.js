// FB Helper — read-only helper: EAAB token, session cookies, ad account status.
// Nothing leaves the browser except GET calls to the Graph host (GRAPH_URL below), made on a click or when the Accounts tab opens
// with nothing loaded yet / after the FB page was reloaded, and one public exchange-rate file (money.js) at most once a day, only
// while a total adds up several currencies.
// Reading the token from the FB tab is local.
// Token and account cache live in chrome.storage.session (gone when the browser closes). The account cache
// belongs to the FB user (c_user), not to a token string: FB pages hand out different tokens, and switching
// or reloading them must not throw away accounts you just loaded. Another user in the profile drops it;
// storage.local holds the interface language and a newer Graph API version learned from Graph itself; the popup's
// localStorage holds the last tab and the spend period. Cookies and the User-Agent are read live, never stored.
//
// This file is the entry only. Everything else lives in modules (the dependency graph is a DAG, lowest first):
//   dom.js format.js pure.js i18n.js config.js bus.js registry.js   leaves: DOM helpers, formatting, pure logic, strings, constants, events, hook lists
//   state.js      shared state, storage, caches per FB user, rate slots (claimSlot), dead-token marks
//   graph.js      every Graph request: versions, usage, throttle pause, readPaged
//   fbtabs.js     which FB tabs can be read
//   header.js     the API-usage pill
//   cookies.js    Cookies tab + the User-Agent        token.js     Token tab, owner check, "Token + cookies + UA"
//   spend.js      what an account spent in a period + adding amounts up (pure, shared by the list tabs)
//   period.js     the spend period switch and the total line (one state.period for the Ad accounts and Businesses tabs)
//   row.js        THE shared list row of the three list tabs: row(), groupHeader(), fixLink(), kv(), whatToDo(), linksRow() (css/rows.css)
//   list-loader.js THE shared loader of the three list tabs (token wait, pause / budget pre-check before the rate slot, slot, generation and
//                 owner checks, busy button, other windows followed); biz-edges.js the one capped walk over the edges of the profile's businesses
//   money-core.js money.js   amounts (fmtMoney), USD conversion, the lines of totals and rows (pure, tested in Node) + the daily exchange
//                 rates (rates(): chrome.storage.local, 24 h, the one network read besides Graph; the CSP lists its two origins)
//   accounts.js   Ad accounts tab, with the ads of each account
//   bms.js        Businesses tab (spend, status and problems per business; asks accounts.js for the ad account list)
//   pages.js      Pages tab (Instagram identity, publishing, ad rights, each problem with its fix)
// A feature module registers what it needs when it is imported (registry.js: registerTab / registerRender / registerInit /
// registerStart) and listens to the others through the bus (bus.js); this file only imports it and runs the lists.
// A new tab = its module + one import line below + its panel in popup.html; nothing here knows its name.
import { loadLang, setLang, applyStatic } from "./i18n.js";
import { $, $$ } from "./dom.js";
import { setGraphUrl } from "./config.js";
import { loadState, checkOwner } from "./state.js";
import { on, emit } from "./bus.js";
import { tabInfo, tabNames, runInit, runStart, runRenders } from "./registry.js";
// Feature modules: importing one is what registers its tab, redraws and listeners. Hooks run in the order the modules
// were evaluated (a module's own imports first), which is also the order of the first paint and of the language-switch redraws.
import "./header.js";
import "./token.js";
import "./cookies.js";
import "./accounts.js";
import "./bms.js";
import "./pages.js";

// The one place that names the Graph host; config.js hands it to the modules (state, graph, cookies) at call time.
const GRAPH_URL = "https://graph.facebook.com/";
setGraphUrl(GRAPH_URL);

// ---------- wiring ----------
// Visual only. The popup opens at the height of the tab it shows: a tab that registers `tall` (the Accounts tab) takes
// Chrome's full 600 px from the start, so a list arriving a moment later doesn't make the window jump.
let current = null;                                     // the tab on screen
function showTab(name) {
  current = name;
  document.body.classList.toggle("tall", !!tabInfo(name)?.tall);
  $$(".tab").forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle("active", on); tab.setAttribute("aria-selected", String(on)); tab.tabIndex = on ? 0 : -1;
  });
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  try { localStorage.setItem("tab", name); } catch { /* */ }
}
let started = false;                                    // start-up done: a tab's onShow (the Accounts auto-load) may run
function switchTab(name) {
  showTab(name);
  if (started) tabInfo(name)?.onShow?.();
}
// A module opens another tab (the BM tab's "ad accounts of this BM" → Accounts) without knowing popup.js.
on("show-tab", (name) => { if (tabInfo(name)) switchTab(name); });
const savedTab = () => { try { const v = localStorage.getItem("tab"); return tabNames().includes(v) ? v : "token"; } catch { return "token"; } };
showTab(savedTab());                                    // module code runs before the first paint: open on the right tab and height

// RU · EN in the header. Everything is redrawn from state: each module's redraw callback runs (registerRender). The token
// module also re-reads the token field from the FB tab (local) and hides the "Check" result (its text came from Graph in
// the old language — press again); the accounts module clears the status filter (it holds a translated label).
async function switchLang(l) {
  if (!(await setLang(l))) return;
  applyStatic();
  runRenders("lang");
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadLang(); applyStatic();
  $$("[data-lang]").forEach((b) => b.addEventListener("click", () => switchLang(b.dataset.lang)));
  await loadState();
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
  // WAI-ARIA tabs: arrows / Home / End move between tabs; Tab key goes straight into the panel.
  $(".tabs").addEventListener("keydown", (ev) => {
    const tabs = $$(".tab"), i = tabs.indexOf(document.activeElement), n = tabs.length;
    if (i < 0) return;
    const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[ev.key];
    if (j === undefined) return;
    ev.preventDefault(); switchTab(tabs[j].dataset.tab); tabs[j].focus();
  });
  runInit();                                            // every module attaches its listeners and reads its saved view

  await checkOwner();                                   // cache from another FB login: don't show it
  runStart();                                           // first paint; the token and the cookies are read from the open FB tab (local page reads, no request)
  started = true;
  tabInfo(current)?.onShow?.();                         // opened straight on a tab that loads by itself (Accounts)
  // Other windows of this extension write to storage.session; each module follows the keys it owns (bus "session").
  chrome.storage.session.onChanged?.addListener((ch) => emit("session", ch));
  setInterval(() => runRenders("tick"), 30000);
});
