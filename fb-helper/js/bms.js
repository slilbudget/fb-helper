// The Businesses tab: what do I have, and how much does each business spend? One shared list row (row.js) per business: picture, name |
// the spend of the selected period; line 2 = how many ad accounts it has ("3 ad accounts · 1 disabled"), silent while all is well, a
// problem word + its fix when not; the ID on the right. Click a row: the counts with the jump to the Ad accounts tab, the
// verification, what to do, Business settings. The business list is one paged read of me/businesses; spend, counts and state come
// from the Ad accounts list (each account names its owner business), which this tab asks for too (accounts.js).
// Same shape as the other tabs (auto-load on first show, cache per FB user, rate slot, dead token, other windows); what a row
// keeps and how the rows are built is bms-model.js (plain Node, tested), the strings are strings/bms.js.
// Read-only like the rest: GET only, no token of a page or BM is ever asked for.

import { t, tn, has, applyStatic } from "./i18n.js";
import "./strings/bms.js";
import { $, el, fill, toast, keepFocus } from "./dom.js";
import { state, Stale, saveSession, fbUser, claimSlot, registerCache, isDead, deadCode } from "./state.js";
import { readPaged } from "./graph.js";
import { settledGrab, grabToken, tokenReady } from "./token.js";
import { LINKS } from "./links.js";
import { on, emit } from "./bus.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";
import { row, kv, whatToDo, linksRow } from "./row.js";
import { bindPeriods, fillTotal, refreshTip } from "./period.js";
import { fmtMoney, cachedRates, rates as fetchRates } from "./money.js";
import { statsOf, periodRange } from "./spend.js";
import { ensureAccounts, reloadAccounts } from "./accounts.js";
import { BM_BASE, BM_OPTIONAL, BM_LIMIT, BM_MAX_PAGES, BM_SLOT_MS, slimBm, buildRows, filterRows, sortRows, totalOf, spendOf, isPermError } from "./bms-model.js";

// bmQuery is this tab's search (not saved). Not to be confused with accounts.js's state.bmFilter, the business the Accounts tab
// is filtered by. state.accounts / fetchedAt / truncated / accLoading below are the Accounts tab's: the spend, counts and
// status of a business are read from that list.
Object.assign(state, {
  bms: [], bmsAt: 0, bmsTruncated: false, bmsLoading: false,
  bmPerm: false,                                     // the last read was refused as a permission error: the list draws the calm note
  bmQuery: "",
});
let bmSkip = new Set();                              // optional fields Graph refused for this token; own set, so no other tab's refusals mix in
const openRows = new Set();                          // ids of the rows that are open: a redraw (a new period, the accounts arriving) keeps them open
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
on("cache-dropped", () => { openRows.clear(); renderBms(); });
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
// One row per business: the profile's businesses and every business an account names, built from the Ad accounts list the way the Ad
// accounts tab groups it (bms-model.js buildRows). The list is "loaded" once it has been read (state.fetchedAt); until then the rows have no
// status and no spend ("—"), and a row never claims "No ad accounts" about a list that is not there.
const allRows = () => buildRows({
  bms: state.bms, accounts: state.accounts, loaded: !!state.fetchedAt, truncated: state.truncated,
  stats: (a) => statsOf(a, state.period, state.fetchedAt),
});
const isFiltered = () => !!state.bmQuery.trim();
// The controls are built once (a redraw would take the caret out of the search field); their texts carry data-i18n*
// attributes, which the language switch re-applies for the whole document.
function buildControls() {
  const card = $("#bmsCard");
  fill(card,
    el("div", { class: "search" },
      el("i", { class: "i i-search" }),
      el("input", { id: "bmFilter", class: "field", type: "search", "data-i18n-placeholder": "search", "data-i18n-aria": "bms.search.aria", autocomplete: "off" }),
      el("button", { id: "loadBms", type: "button", class: "icon-btn", "data-i18n-title": "bms.refresh", "data-i18n-aria": "bms.refresh" },
        el("i", { class: "i i-refresh" }))),
    el("div", { class: "seg", id: "bmsPeriod", role: "group", "data-i18n-aria": "period.aria" }),
    el("div", { class: "total", id: "bmsTotal" }));
  applyStatic(card);
  bindPeriods($("#bmsPeriod"), "bm-");                // the same period as the Ad accounts tab (period.js)
}
// "Spend · Aug 29" and the sum of the rows shown, so the rows add up to it (ad accounts without a business are not in it; the Ad accounts
// tab totals everything). A search shows "3 of 12 found" on the right; an incomplete list says so. "—" until the Ad accounts list is
// loaded. "updated 3 min ago" is the refresh button's tooltip. The grand total is the one place that says "≈" (period.js fillTotal).
function renderTotal(all = allRows()) {
  const total = $("#bmsTotal");
  if (!total) return;
  refreshTip($("#loadBms"), t("bms.refresh"), state.fetchedAt || state.bmsAt);
  if (!state.bmsAt) return fill(total);
  const rows = filterRows(all, state.bmQuery);
  const metaText = `${isFiltered() ? t("bms.found", { n: rows.length, all: all.length }) : ""}${state.bmsTruncated || state.truncated ? t("bms.notAll") : ""}`.trim();
  fillTotal(total, {
    metaText, range: state.period === "all" || !state.fetchedAt ? "" : periodRange(state.accounts, state.period, state.fetchedAt),
    sum: state.fetchedAt ? totalOf(rows) : null, zeroCur: rows.find((r) => r.accounts.length)?.accounts[0].currency,
  });
}
function renderBms() { if (ready) keepFocus(drawBms); }
function drawBms() {
  const list = $("#bmsList");
  const all = allRows();
  renderTotal(all);
  if (!state.bmsAt) return fill(list, el("div", { class: "empty" }, state.bmPerm ? t("bms.noPerm") : state.bmsLoading ? t("bms.loading") : t("bms.empty")));
  const note = state.bmPerm ? el("div", { class: "hint bm-note" }, t("bms.noPerm")) : null;   // a refresh was refused: the old list stays, the note says why it is old
  if (!all.length) return fill(list, note, el("div", { class: "empty" }, state.bmsLoading ? t("bms.loading") : t("bms.none")));
  const used = cachedRates();                         // the order and the "≈" of a row follow the rates known right now…
  const rows = sortRows(filterRows(all, state.bmQuery), used);
  if (!rows.length) return fill(list, note, el("div", { class: "empty" }, t("bms.noMatch")));
  fill(list, note, ...rows.map((r) => renderRow(r, used)));
  // …and when the table arrives later (a total of two or more currencies asks for it, period.js) the rows are drawn once more.
  if (active() && Object.keys(totalOf(rows).totals).length >= 2) fetchRates().then((r) => { if (r && r.rates !== used?.rates && active()) renderBms(); });
}

// The exact verification state, in words ("Rejected"); a state Meta adds later is shown as it came.
const verLabel = (s) => (has(`bms.ver.${s}`) ? t(`bms.ver.${s}`) : String(s).replace(/_/g, " "));
// Line 2, after the status: "3 ad accounts · 1 disabled" (the disabled count in red), one item so a narrow line cuts it with a single
// ellipsis (bms.css gives it the room the problem word and its fix must keep). Nothing before the Ad accounts list is read, nothing for a
// business that has none (its status says so). "3+" when that list stopped at its page limit.
function contextOf(r) {
  const c = r.counts;
  if (!state.fetchedAt || !c.total) return [];
  return [el("span", { class: "lrow-ctx", title: r.partial ? t("bms.accsPartial") : null }, `${c.total}${r.partial ? "+" : ""} ${tn(c.total, "bms.accCount")}`,
    c.disabled ? [el("span", { class: "lbm-sep" }, " · "), el("span", { class: "lbm-dis" }, `${c.disabled} ${tn(c.disabled, "bms.disabledWord")}`)] : null)];
}
// The right-hand amount: exact for one or two currencies, "≈ $" from three (the breakdown is its tooltip and the expanded row); a dash
// (muted) when there is nothing to add up, with the reason as its tooltip.
function valueOf(sp) {
  const dash = (title) => ({ value: "—", valueTitle: title, valueMuted: true });
  switch (sp.kind) {
    case "unloaded": return dash(t("bms.noSpend"));
    case "none": return dash(t("bms.st.none.title"));
    case "unknown": return dash(t("acc.noPeriod"));
    case "zero": return { value: fmtMoney(0, sp.cur), valueMuted: true };
    default: return { value: sp.text, valueTitle: [sp.title, sp.notAll ? t("acc.notAllTitle") : ""].filter(Boolean).join("\n") || null };
  }
}
function renderRow(r, rt) {
  const name = r.name || t("bms.noName");
  const [worst] = r.issues;
  // The worst problem IS the status word; its fix (when it has one on the line) sits right after it, the others are "+N" (all of them are in the body).
  const status = worst
    ? { tone: worst.tone, text: t(worst.label), title: worst.id === "verification" ? `${t(worst.tip)}: ${verLabel(r.verificationState)}` : t(worst.tip) }
    : r.state === "active" ? { tone: "ok", text: t("bms.st.active") } : undefined;           // a healthy row is silent (row.js: a word for screen readers only)
  const fix = worst?.line && worst.fix ? { label: worst.fix.label, url: worst.fix.url, tip: t(worst.fix.tip) } : null;
  const sp = spendOf(r, { loaded: !!state.fetchedAt, rates: rt });
  return row({
    key: `bm-${r.id}`, avatar: { kind: "business", url: r.picture }, name, ...valueOf(sp),
    status, context: contextOf(r), fix, more: Math.max(0, r.issues.length - 1), id: { value: r.id },
    open: openRows.has(r.id), onToggle: (open) => openRows[open ? "add" : "delete"](r.id),
    body: () => bodyOf(r, name, sp, fix),
  });
}
// The expanded row: the ad accounts (counts + the jump to the Ad accounts tab, filtered), the exact verification, the spend of three or more
// currencies in full; then what to do (the help + every fix not already on line 2); then the one link out, Business settings.
function bodyOf(r, name, sp, lineFix) {
  const c = r.counts, loaded = !!state.fetchedAt;
  const go = () => { emit("filter-bm", { id: r.id, name }); emit("show-tab", "accounts"); };
  const counts = loaded && c.total
    ? [`${c.total}${r.partial ? "+" : ""}`, c.active ? `${c.active} ${tn(c.active, "bms.activeWord")}` : "", c.disabled ? `${c.disabled} ${tn(c.disabled, "bms.disabledWord")}` : ""].filter(Boolean).join(" · ")
    : "";
  // A business with no ad accounts at all has nothing to show on that tab; before the list is read the Ad accounts tab loads it by itself.
  const accounts = loaded && !c.total && !r.partial ? null : [t("bms.kv.accounts"),
    el("span", { class: "lbm-accs" }, counts ? el("span", { title: r.partial ? t("bms.accsPartial") : null }, counts) : null,
      el("button", { type: "button", class: "act-inline lbm-go", "data-focus": `bm-go:${r.id}`, title: t("bms.showTitle"), onclick: go }, el("span", { class: "act-label" }, t("bms.show")))),
    { wide: true }];
  const todo = r.issues.length ? whatToDo({
    help: r.issues.map((i) => t(i.help)).join(" "),
    actions: r.issues.filter((i) => i.fix).map((i, n) => ({ id: i.id, label: i.fix.label, url: i.fix.url, tip: t(i.fix.tip), primary: n === 0 })),
    skip: lineFix, tone: r.issues[0].tone, owner: name, focus: `bm-todo:${r.id}`,
  }) : null;
  return [
    kv([accounts,
      r.verificationState ? [t("bms.kv.verification"), verLabel(r.verificationState)] : null,
      sp.kind === "approx" ? [t("acc.spend"), sp.full, { wide: true, title: sp.title }] : null]),
    todo,
    r.known ? linksRow([{ id: "settings", label: "bms.settings", url: LINKS.bmSettings(r.id), tip: t("bms.openSettings") }], { owner: name, focus: `bm-link:${r.id}` }) : null,
  ];
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
  $("#bmFilter").addEventListener("input", (e) => { state.bmQuery = e.target.value; renderBms(); });
  ready = true;
});
registerStart(() => renderBms());
