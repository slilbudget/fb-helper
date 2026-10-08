// The Businesses tab: what do I have, and how much does each business spend? One shared list row (row.js) per business: picture, name |
// the spend of the selected period; line 2 = how many ad accounts it has ("3 ad accounts · 1 disabled"), silent while all is well, a
// problem word + its fix when not; the ID on the right. Click a row: the counts with the jump to the Ad accounts tab, the
// verification, what to do, Business settings. The business list is one paged read of me/businesses; spend, counts and state come
// from the Ad accounts list (each account names its owner business), which this tab asks for too (accounts.js).
// Same shape as the other tabs (auto-load on first show, cache per FB user, rate slot, dead token, other windows); what a row
// keeps and how the rows are built is bms-model.js (plain Node, tested), the strings are strings/bms.js.
// Read-only like the rest: GET only, no token of a page or BM is ever asked for.

import { t, tn, tnPlus, has, applyStatic } from "./i18n.js";
import "./strings/bms.js";
import { $, el, fill, toast, keepFocus } from "./dom.js";
import { state, Stale, saveSession } from "./state.js";
import { readPaged } from "./graph.js";
import { listLoader } from "./list-loader.js";
import { emptyView, listNote } from "./list-state.js";
import { LINKS } from "./links.js";
import { on, emit } from "./bus.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";
import { row, kv, whatToDo, linksRow } from "./row.js";
import { bindPeriods, fillTotal, refreshTip } from "./period.js";
import { fmtMoney, cachedRates, rates as fetchRates } from "./money.js";
import { statsOf, periodRange } from "./spend.js";
import { ensureAccounts, reloadAccounts } from "./accounts.js";
import { BM_BASE, BM_OPTIONAL, BM_LIMIT, BM_MAX_PAGES, BM_SLOT_MS, slimBm, bmKeysToDrop, buildRows, filterRows, sortRows, totalOf, spendOf } from "./bms-model.js";

// bmQuery is this tab's search (not saved). Not to be confused with accounts.js's state.bmFilter, the business the Accounts tab
// is filtered by. state.accounts / fetchedAt / truncated / failedBms / accLoading below are the Accounts tab's: the spend, counts and
// status of a business are read from that list (failedBms = the businesses whose accounts could not be read: no verdict for those).
Object.assign(state, {
  bms: [], bmsAt: 0, bmsTruncated: false, bmsLoading: false,
  bmQuery: "",
});
let bmSkip = new Set();                              // optional fields Graph refused for this token; own set, so no other tab's refusals mix in
const openRows = new Set();                          // ids of the rows that are open: a redraw (a new period, the accounts arriving) keeps them open
let ready = false;                                   // the controls are built (init): nothing is drawn before
const active = () => ready && $("#tab-bms").classList.contains("active");   // a hidden tab is redrawn when it is shown

// ---------- storage ----------
// Kept across popup reopen and token changes, dropped together with the other lists when the FB user changes. The cache is registered
// by the shared loader (list-loader.js, below), which also takes over what another window of the extension loaded.

// Token changed: Graph's refusals and the "can't read" state (state.listErr, cleared by the generation) belonged to the old one (the list itself stays).
on("generation", () => { bmSkip = new Set(); renderBms(); });
on("token-hint", () => renderBms());                 // the Token tab's reason for having no token changed
on("token-dead", () => renderBms());
// The cached lists belonged to another FB user and are gone: draw the empty list.
on("cache-dropped", () => { openRows.clear(); renderBms(); });
// The Ad accounts list (spend, counts, status) is loading, loaded or changed; the spend period was switched (here or on the
// Accounts tab, which share it).
on("accounts", () => { if (active()) renderBms(); });
on("period", () => { if (active()) renderBms(); });

// ---------- loading ----------
// The businesses of the profile: one paged read of me/businesses. A token that cannot read one of the extra fields may be refused the whole
// read with a permission error: the extras are given up one tier at a time (bms-model.js bmKeysToDrop), the list keeps what it can have.
async function readBms() {
  for (;;) {
    try {
      // skip as a function: a token change swaps bmSkip while the pages are still coming in. The rows are slimmed as each
      // page arrives, so a row keeps the refusals of its own page (a refused field reads "unknown", not "none").
      return await readPaged("me/businesses", { base: BM_BASE, optional: BM_OPTIONAL, skip: () => bmSkip, map: (r) => slimBm(r, bmSkip), limit: BM_LIMIT, maxPages: BM_MAX_PAGES });
    } catch (e) {
      if (e instanceof Stale) throw e;
      const drop = bmKeysToDrop(e, bmSkip);
      if (!drop.length) throw e;
      for (const k of drop) bmSkip.add(k);
    }
  }
}
const loader = listLoader({
  name: "bms", button: "#loadBms", slotMs: BM_SLOT_MS, waitKey: "bms.wait",
  keys: ["bms", "bmsAt", "bmsTruncated"],
  reset: () => Object.assign(state, { bms: [], bmsAt: 0, bmsTruncated: false }),
  load: (ses) => Object.assign(state, { bms: Array.isArray(ses.bms) ? ses.bms : [], bmsAt: ses.bmsAt || 0, bmsTruncated: !!ses.bmsTruncated }),
  has: () => !!state.bmsAt,
  atKey: "bmsAt", at: () => state.bmsAt,
  followed: () => renderBms(),
  loading: (on) => { state.bmsLoading = on; renderBms(); },
  // The tab loads the list by itself when nothing is cached for this FB user (bmsAt: another window may have filled it meanwhile).
  empty: () => !state.bmsAt, due: () => !state.bmsAt,
  read: readBms,
  commit: async ({ rows, truncated }, { auto, owner }) => {
    const bms = rows.filter(Boolean);                // a row without a usable id is not a business
    Object.assign(state, { bms, bmsAt: Date.now(), bmsTruncated: truncated, owner });
    await saveSession({ bms, bmsAt: state.bmsAt, bmsTruncated: truncated, owner });
    return !auto || truncated ? t("bms.loaded", { n: bms.length }) + (truncated ? t("bms.truncated") : "") : null;   // the list itself is the answer to an automatic load
  },
});

// ---------- drawing ----------
// One row per business: the profile's businesses and every business an account names, built from the Ad accounts list the way the Ad
// accounts tab groups it (bms-model.js buildRows). The list is "loaded" once it has been read (state.fetchedAt); until then the rows have no
// status and no spend ("—"), and a row never claims "No ad accounts" about a list that is not there.
const allRows = () => buildRows({
  bms: state.bms, accounts: state.accounts, loaded: !!state.fetchedAt, truncated: state.truncated, failedBms: state.failedBms,
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
// loaded. "updated 3 min ago" is the refresh button's tooltip, and it is the age of the BUSINESS list (bmsAt), not of the accounts. The grand
// total is the one place that says "≈" (period.js fillTotal). Without the business list (not read yet, or this token cannot read it) the
// rows are the businesses the loaded ad accounts name, and the line says the list is not whole.
function renderTotal(all = allRows()) {
  const total = $("#bmsTotal");
  if (!total) return;
  refreshTip($("#loadBms"), t("bms.refresh"), state.bmsAt);
  if (!state.bmsAt && !state.fetchedAt) return fill(total);
  const rows = filterRows(all, state.bmQuery);
  const metaText = `${isFiltered() ? t("bms.found", { n: rows.length, all: all.length }) : ""}${state.bmsTruncated || state.truncated || !state.bmsAt ? t("bms.notAll") : ""}`.trim();
  fillTotal(total, {
    labelTitle: t("bms.totalTitle"), metaText, range: state.period === "all" || !state.fetchedAt ? "" : periodRange(state.accounts, state.period, state.fetchedAt),
    sum: state.fetchedAt ? totalOf(rows) : null, zeroCur: rows.find((r) => r.accounts.length)?.accounts[0].currency,
  });
}
function renderBms() { if (ready) keepFocus(drawBms); }
function drawBms() {
  const list = $("#bmsList");
  const all = allRows();
  renderTotal(all);
  // The period and the total mean something only next to rows (no list yet, no token, an error, no business at all: one calm state instead).
  for (const sel of ["#bmsPeriod", "#bmsTotal"]) $(sel).classList.toggle("hidden", !all.length);
  // No business list (not read yet, or this token cannot read it) but ad accounts that name their businesses: those businesses are shown.
  if (!all.length) return fill(list, emptyView({ tab: "bms", loaded: !!state.bmsAt, loading: state.bmsLoading, none: t("bms.none"), loadingText: t("bms.loading"), retry: () => loader.retry() }));
  const note = listNote("bms");                       // a refresh was refused: the old list stays, the note says why it is old
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
  return [el("span", { class: "lrow-ctx", title: r.partial ? t("bms.accsPartial") : null }, `${c.total}${r.partial ? "+" : ""} ${tnPlus(c.total, "bms.accCount", r.partial)}`,
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
    body: () => bodyOf(r, name, sp),
  });
}
// The expanded row: the ad accounts (counts + the jump to the Ad accounts tab, filtered), the exact verification, the spend of three or more
// currencies in full; then what to do (the help + every fix); then the one link out, Business settings.
function bodyOf(r, name, sp) {
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
    tone: r.issues[0].tone, owner: name, focus: `bm-todo:${r.id}`,
  }) : null;
  return [
    kv([accounts,
      r.verificationState ? [t("bms.kv.verification"), verLabel(r.verificationState)] : null,
      sp.kind === "approx" ? [t("acc.spend"), sp.full, { wide: true, title: sp.title }] : null]),
    // This business's accounts could not be read: no verdict above, and the reason, muted. Only this business says it.
    r.unread ? el("p", { class: "lrow-note" }, t("bms.unread")) : null,
    todo,
    r.known ? linksRow([{ id: "settings", label: "bms.settings", url: LINKS.bmSettings(r.id), tip: t("bms.openSettings") }], { owner: name, focus: `bm-link:${r.id}` }) : null,
  ];
}

// ---------- wiring ----------
// Showing the tab draws it again (the Ad accounts list or the period may have changed meanwhile), starts its own auto-load and the
// Ad accounts list's (accounts.js: same rule and limits as when that tab is opened).
registerTab("bms", { onShow: () => { renderBms(); loader.ensure(); ensureAccounts(); } });
registerRender(() => renderBms());                   // RU · EN
registerRender(() => { if (active()) renderTotal(); }, { lang: false, tick: true });   // every 30 s: the refresh tooltip says how old the list is
registerInit(() => {
  buildControls();
  // The spend and counts come from the Ad accounts list: its refresh is part of this one (silent where its own button would complain,
  // except that a taken slot is said, after the Businesses answer: the numbers on screen are then the old ones).
  $("#loadBms").addEventListener("click", async () => {
    const accounts = reloadAccounts();
    await loader.load();
    const r = await accounts;
    if (r?.wait) toast(t("bms.accWait", { n: r.wait }), true);
  });
  $("#bmFilter").addEventListener("input", (e) => { state.bmQuery = e.target.value; renderBms(); });
  ready = true;
});
registerStart(() => renderBms());
