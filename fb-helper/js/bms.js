// The Businesses tab: what do I have, and how much does each business spend? One row per business: picture, name, one status pill
// (active / no active ad accounts / no ad accounts), ID, the spend of the selected period, how many ad accounts it has and, only
// when something is wrong, the problem with its fix. The business list is one paged read of me/businesses; spend, counts and
// status come from the Ad accounts list (each account names its owner business), which this tab asks for too (accounts.js).
// Same shape as the other tabs (auto-load on first show, cache per FB user, rate slot, dead token, other windows); what a row
// keeps and how the rows are built is bms-model.js (plain Node, tested), the strings are strings/bms.js.
// Read-only like the rest: GET only, no token of a page or BM is ever asked for.

import { t, tn, applyStatic } from "./i18n.js";
import "./strings/bms.js";
import { $, el, fill, pill, toast, copy, keepFocus } from "./dom.js";
import { state, Stale, saveSession, fbUser, claimSlot, registerCache, isDead, deadCode } from "./state.js";
import { readPaged } from "./graph.js";
import { settledGrab, grabToken, tokenReady } from "./token.js";
import { LINKS } from "./links.js";
import { on, emit } from "./bus.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";
import { avatar, problems } from "./rows.js";
import { bindPeriods, fillTotal, spendCell, refreshTip } from "./period.js";
import { statsOf, periodRange } from "./spend.js";
import { ensureAccounts, reloadAccounts } from "./accounts.js";
import { BM_BASE, BM_OPTIONAL, BM_LIMIT, BM_MAX_PAGES, BM_SLOT_MS, slimBm, buildRows, filterRows, sortRows, totalOf, idsOf, isPermError } from "./bms-model.js";

// bmQuery is this tab's search (not saved). Not to be confused with accounts.js's state.bmFilter, the business the Accounts tab
// is filtered by. state.accounts / fetchedAt / truncated / accLoading below are the Accounts tab's: the spend, counts and
// status of a business are read from that list.
Object.assign(state, {
  bms: [], bmsAt: 0, bmsTruncated: false, bmsLoading: false,
  bmPerm: false,                                     // the last read was refused as a permission error: the list draws the calm note
  bmQuery: "",
});
let bmSkip = new Set();                              // optional fields Graph refused for this token; own set, so no other tab's refusals mix in
let ready = false;                                   // the controls are built (init): nothing is drawn before
const active = () => ready && $("#tab-bms").classList.contains("active");   // a hidden tab is redrawn when it is shown

// ---------- storage ----------
// Kept across popup reopen and token changes, dropped together with the other lists when the FB user changes.
registerCache(["bms", "bmsAt", "bmsTruncated"],
  () => Object.assign(state, { bms: [], bmsAt: 0, bmsTruncated: false, bmPerm: false }),
  {
    load: (ses) => Object.assign(state, { bms: Array.isArray(ses.bms) ? ses.bms : [], bmsAt: ses.bmsAt || 0, bmsTruncated: !!ses.bmsTruncated }),
    has: () => !!state.bmsAt,
  });

// Token changed: Graph's refusals and the "can't read" note belonged to the old one (the list itself stays).
on("generation", () => { bmSkip = new Set(); state.bmPerm = false; renderBms(); });
// The cached lists belonged to another FB user and are gone: draw the empty list.
on("cache-dropped", () => renderBms());
// The Ad accounts list (spend, counts, status) is loading, loaded or changed; the spend period was switched (here or on the
// Accounts tab, which share it).
on("accounts", () => { if (active()) renderBms(); });
on("period", () => { if (active()) renderBms(); });
// Loaded or dropped in another window of this extension: show the same list.
on("session", (ch) => {
  if (ch.bmsAt && (ch.bmsAt.newValue || 0) !== state.bmsAt) {
    chrome.storage.session.get(["bms", "bmsAt", "bmsTruncated", "owner"]).then((c) => {
      Object.assign(state, { bms: Array.isArray(c.bms) ? c.bms : [], bmsAt: c.bmsAt || 0, bmsTruncated: !!c.bmsTruncated, owner: c.owner || null });
      renderBms();
    });
  }
});

// ---------- loading ----------
// auto: started by showing the tab, not by a click. Same limits as a click, but silent where a click would only complain
// (no token, dead session, API pause, the one-minute slot): the empty list explains itself.
let busy = false;                                    // one load at a time: a click during an automatic load is a no-op
async function fetchBms(opts) {
  if (busy) return;
  busy = true;
  try { await loadBmsNow(opts); } finally { busy = false; }
}
async function loadBmsNow({ auto = false } = {}) {
  await settledGrab();
  if (!state.token && !(await grabToken({ toClipboard: false, silent: auto }))) return;   // no token: grabToken says why
  if (isDead()) return auto ? undefined : toast(t("err.session", { c: deadCode() }), true);   // before the slot: costs nothing
  const pause = state.cooldownUntil - Date.now();    // the API pause: graph() would refuse anyway, so don't spend the slot on it
  if (pause > 0) return auto ? undefined : toast(t("err.cooldown", { n: Math.ceil(pause / 60000) }), true);
  const gen = state.gen;                             // fixed before waiting for the lock
  let wait;
  try { wait = await claimSlot("bms", BM_SLOT_MS); }  // before sending: a failed attempt counts too
  catch (e) { return auto ? undefined : toast(t("err.slot", { m: e.message }), true); }
  if (gen !== state.gen) return;                     // new token while waiting
  if (wait > 0) return auto ? undefined : toast(t("bms.wait", { n: Math.ceil(wait / 1000) }), true);
  const btn = $("#loadBms");
  btn.disabled = true; btn.setAttribute("aria-busy", "true");
  state.bmsLoading = true; renderBms();
  try {
    // skip as a function: a token change swaps bmSkip while the pages are still coming in. The rows are slimmed as each
    // page arrives, so a row keeps the refusals of its own page (a refused field reads "unknown", not "none").
    const { rows, truncated } = await readPaged("me/businesses", {
      base: BM_BASE, optional: BM_OPTIONAL, skip: () => bmSkip, map: (r) => slimBm(r, bmSkip), limit: BM_LIMIT, maxPages: BM_MAX_PAGES,
    });
    if (gen !== state.gen) return;
    const owner = await fbUser();
    if (gen !== state.gen) return;
    const bms = rows.filter(Boolean);                // a row without a usable id is not a business
    Object.assign(state, { bms, bmsAt: Date.now(), bmsTruncated: truncated, bmPerm: false, owner });
    await saveSession({ bms, bmsAt: state.bmsAt, bmsTruncated: truncated, owner });
    if (!auto || truncated) toast(t("bms.loaded", { n: bms.length }) + (truncated ? t("bms.truncated") : ""));   // the list itself is the answer to an automatic load
  } catch (e) {
    if (e instanceof Stale) return;
    if (isPermError(e)) state.bmPerm = true;         // this token can't read businesses: say so in the list, calmly
    else toast(e.message, true);
  } finally {
    state.bmsLoading = false;
    btn.disabled = false; btn.removeAttribute("aria-busy");
    renderBms();
  }
}
// The tab loads the list by itself when nothing is cached for this FB user. Reopening the popup or switching tabs alone
// never sends a request once there is a list (only the refresh button does). At most one try per popup open; the limits
// are a click's (the one-minute slot, the API pause, a dead session).
let autoTried = false;
async function autoLoadBms() {
  if (autoTried) return;
  autoTried = true;
  if (state.bmsAt) return;
  state.bmsLoading = true; renderBms();              // "Loading…" at once, not "press refresh" and then "Loading…"
  try {
    // Without the silent token read the request could go out with a stale token. Not forever, though.
    await Promise.race([tokenReady, new Promise((resolve) => setTimeout(resolve, 15000))]);
    if (!state.token || isDead() || state.cooldownUntil > Date.now() || state.bmsAt) return;   // bmsAt: another window filled it meanwhile
    await fetchBms({ auto: true });
  } finally {
    if (!busy) { state.bmsLoading = false; renderBms(); }
  }
}

// ---------- drawing ----------
// Every business of the profile + every business an account names: see bms-model.js buildRows. The Ad
// accounts list is "loaded" once it has been read (state.fetchedAt); until then the rows have no status and no spend.
const allRows = () => buildRows({
  bms: state.bms, accounts: state.accounts, loaded: !!state.fetchedAt, truncated: state.truncated,
  stats: (a) => statsOf(a, state.period, state.fetchedAt),
});
const isFiltered = () => !!state.bmQuery.trim();
function copyIds() {
  const rows = sortRows(filterRows(allRows(), state.bmQuery));
  if (!rows.length) return;
  copy(idsOf(rows), t("bms.idsCopied", { n: rows.length }) + (state.bmsTruncated || state.truncated ? t("bms.partial") : ""));
}
// The controls are built once (a redraw would take the caret out of the search field); their texts carry data-i18n*
// attributes, which the language switch re-applies for the whole document.
function buildControls() {
  const card = $("#bmsCard");
  fill(card,
    el("div", { class: "search" },
      el("i", { class: "i i-search" }),
      el("input", { id: "bmFilter", class: "field", type: "search", "data-i18n-placeholder": "search", "data-i18n-aria": "bms.search.aria", autocomplete: "off" }),
      el("button", { id: "copyBmIds", type: "button", class: "btn ghost", "data-i18n-title": "bms.copyIds.title", disabled: true },
        el("i", { class: "i i-copy" }), el("span", { "data-i18n": "bms.copyIds" })),
      el("button", { id: "loadBms", type: "button", class: "icon-btn", "data-i18n-title": "bms.refresh", "data-i18n-aria": "bms.refresh" },
        el("i", { class: "i i-refresh" }))),
    el("div", { class: "seg", id: "bmsPeriod", role: "group", "data-i18n-aria": "period.aria" }),
    el("div", { class: "total", id: "bmsTotal" }));
  applyStatic(card);
  bindPeriods($("#bmsPeriod"), "bm-");                // the same period as the Ad accounts tab (period.js)
}
// "Spend · Aug 29" and the sum of the rows shown, so the rows add up to it (ad accounts without a business are not in it; the Ad accounts
// tab totals everything). A search shows "3 of 12 found" on the right; an incomplete list says so. "—" until the Ad accounts list is
// loaded. "updated 3 min ago" is the refresh button's tooltip.
function renderTotal() {
  const total = $("#bmsTotal");
  if (!total) return;
  refreshTip($("#loadBms"), t("bms.refresh"), state.fetchedAt || state.bmsAt);
  if (!state.bmsAt) return fill(total);
  const all = allRows(), rows = filterRows(all, state.bmQuery);
  const metaText = `${isFiltered() ? t("bms.found", { n: rows.length, all: all.length }) : ""}${state.bmsTruncated || state.truncated ? t("bms.notAll") : ""}`.trim();
  fillTotal(total, {
    metaText, range: state.period === "all" || !state.fetchedAt ? "" : periodRange(state.accounts, state.period, state.fetchedAt),
    sum: state.fetchedAt ? totalOf(rows) : null, zeroCur: rows.find((r) => r.accounts.length)?.accounts[0].currency,
  });
}
function renderBms() { if (ready) keepFocus(drawBms); }
function drawBms() {
  const list = $("#bmsList");
  renderTotal();
  const all = allRows(), rows = sortRows(filterRows(all, state.bmQuery));
  $("#copyBmIds").disabled = !rows.length;
  if (!state.bmsAt) return fill(list, el("div", { class: "empty" }, state.bmPerm ? t("bms.noPerm") : state.bmsLoading ? t("bms.loading") : t("bms.empty")));
  const note = state.bmPerm ? el("div", { class: "hint bm-note" }, t("bms.noPerm")) : null;   // a refresh was refused: the old list stays, the note says why it is old
  if (!all.length) return fill(list, note, el("div", { class: "empty" }, state.bmsLoading ? t("bms.loading") : t("bms.none")));
  if (!rows.length) return fill(list, note, el("div", { class: "empty" }, t("bms.noMatch")));
  fill(list, note, ...rows.map(renderRow));
}

// "3 ad accounts · 2 active · 1 disabled ›": a button that opens the Accounts tab filtered to this business. Without a loaded list
// the same click is "Show ad accounts ›" (the Accounts tab loads by itself); while the list is loading there is nothing to say yet.
function summaryLine(r, name) {
  const go = () => { emit("filter-bm", { id: r.id, name }); emit("show-tab", "accounts"); };
  const arrow = el("i", { class: "i i-chevron", "aria-hidden": "true" });
  const focus = `bm-accs:${r.key}`;
  if (!state.fetchedAt) {
    if (state.accLoading) return null;
    return el("div", { class: "row-line" }, el("button", { type: "button", class: "bm-accs", "data-focus": focus, title: t("bms.accsShowTitle"), onclick: go }, el("span", {}, t("bms.accsShow")), arrow));
  }
  const c = r.counts;
  if (!c.total) return null;                         // "No ad accounts" is the pill and the problem line
  const partial = state.truncated;                   // the Accounts list stopped at its page limit: there may be more
  return el("div", { class: "row-line" },
    el("button", { type: "button", class: "bm-accs", "data-focus": focus, title: partial ? `${t("bms.accsTitle")}. ${t("bms.accsPartial")}` : t("bms.accsTitle"), onclick: go },
      el("span", {}, `${c.total}${partial ? "+" : ""} ${tn(c.total, "bms.accCount")}`,
        c.active ? el("span", { class: "bm-ok" }, t("bms.accActive", { n: c.active })) : null,
        c.disabled ? el("span", { class: "err-text" }, t("bms.accDisabled", { n: c.disabled })) : null),
      arrow));
}
function renderRow(r) {
  const name = r.name || t("bms.noName");
  const settings = r.known ? LINKS.bmSettings(r.id) : null;      // only a business of this profile has settings it can open
  const status = r.status && pill(t(`bms.st.${r.status.key}`), r.status.tone);
  if (status) status.title = t(`bms.st.${r.status.key}.title`);
  const spend = state.fetchedAt && r.accounts.length ? spendCell(r.spend, r.accounts[0].currency, t("acc.noPeriod"))
    : spendCell(null, null, state.fetchedAt ? t("bms.st.none.title") : t("bms.noSpend"));
  return el("div", { class: "row bm", "data-bm": r.key },
    el("div", { class: "row-top" },
      el("span", { class: "row-name", title: name }, avatar({ url: r.picture, shape: "square", icon: "building" }), el("span", { class: "row-name-text" }, name)),
      status),
    el("div", { class: "row-line" },
      el("div", { class: "acc-ids" },
        el("button", { type: "button", class: "acc-id", title: t("acc.copyId"), "data-focus": `bm-id:${r.id}`, onclick: () => copy(r.id, t("acc.idCopied")) }, r.id, el("i", { class: "i i-copy" })),
        settings ? el("a", { class: "acc-link", href: settings, target: "_blank", rel: "noopener noreferrer", title: t("bms.openSettings"), "aria-label": `${t("bms.openSettings")} · ${name}`,
          "data-focus": `bm-set:${r.id}`, onclick: (ev) => ev.stopPropagation() }, el("i", { class: "i i-external", "aria-hidden": "true" })) : null),
      spend),
    summaryLine(r, name),
    problems(r.issues.map((i) => ({ id: i.id, tone: i.tone, text: t(i.label), tip: t(i.tip), fix: i.fix && { label: i.fix.label, tip: t(i.fix.tip), url: i.fix.url } })),
      { focus: `bm-fix:${r.key}`, owner: name }));
}

// ---------- wiring ----------
// Showing the tab draws it again (the Ad accounts list or the period may have changed meanwhile), starts its own auto-load and the
// Ad accounts list's (accounts.js: same rule and limits as when that tab is opened).
registerTab("bms", { tall: true, onShow: () => { renderBms(); autoLoadBms(); ensureAccounts(); } });
registerRender(() => renderBms());                   // RU · EN
registerRender(() => { if (active()) renderTotal(); }, { lang: false, tick: true });   // every 30 s: the refresh tooltip says how old the list is
registerInit(() => {
  buildControls();
  // The spend and counts come from the Ad accounts list: its refresh is part of this one (silent where its own button would complain).
  $("#loadBms").addEventListener("click", () => { fetchBms(); reloadAccounts(); });
  $("#copyBmIds").addEventListener("click", copyIds);
  $("#bmFilter").addEventListener("input", (e) => { state.bmQuery = e.target.value; renderBms(); });
  ready = true;
});
registerStart(() => renderBms());
