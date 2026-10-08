// The BM tab: the business managers of the logged-in profile (one paged read of me/businesses), one row each: verification,
// the profile's role, ID, created, primary page, how many ad accounts it has (counted from the Accounts tab's list) and links
// into Business Settings. Same shape as accounts.js (auto-load on first show, cache per FB user, rate slot, dead token, other
// windows); what a row keeps and how it reads is bms-model.js (plain Node, tested), the strings are strings/bms.js.
// Read-only like the rest: GET only, no token of a page or BM is ever asked for.

import { t, tn, has, locale, applyStatic } from "./i18n.js";
import "./strings/bms.js";
import { $, el, fill, toast, copy, keepFocus } from "./dom.js";
import { ago } from "./format.js";
import { state, Stale, saveSession, fbUser, claimSlot, registerCache, isDead, deadCode } from "./state.js";
import { readPaged } from "./graph.js";
import { settledGrab, grabToken, tokenReady } from "./token.js";
import { LINKS } from "./links.js";
import { on, emit } from "./bus.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";
import {
  BM_BASE, BM_OPTIONAL, BM_LIMIT, BM_MAX_PAGES, BM_SLOT_MS, VERIFICATION, slimBm, verificationOf, isVerified, roleOf, humanize, isoDay,
  adCounts, filterBms, sortBms, statusChips, idsOf, isPermError,
} from "./bms-model.js";

// bmQuery / bmStatus are this tab's search and verification chip (not saved). Not to be confused with accounts.js's
// state.bmFilter, the BM the Accounts tab is filtered by. state.accounts / fetchedAt / truncated below are the Accounts tab's.
Object.assign(state, {
  bms: [], bmsAt: 0, bmsTruncated: false, bmsLoading: false,
  bmPerm: false,                                     // the last read was refused as a permission error: the list draws the calm note
  bmQuery: "", bmStatus: null,
});
let bmSkip = new Set();                              // optional fields Graph refused for this token; own set, so no other tab's refusals mix in
let ready = false;                                   // the controls are built (init): nothing is drawn before

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
    // page arrives, so a row keeps the refusals of its own page (fields Graph refused read "—", not "none").
    const { rows, truncated } = await readPaged("me/businesses", {
      base: BM_BASE, optional: BM_OPTIONAL, skip: () => bmSkip, map: (r) => slimBm(r, bmSkip), limit: BM_LIMIT, maxPages: BM_MAX_PAGES,
    });
    if (gen !== state.gen) return;
    const owner = await fbUser();
    if (gen !== state.gen) return;
    const bms = rows.filter(Boolean);                // a row without a usable id is not a BM
    Object.assign(state, { bms, bmsAt: Date.now(), bmsTruncated: truncated, bmPerm: false, owner });
    await saveSession({ bms, bmsAt: state.bmsAt, bmsTruncated: truncated, owner });
    if (!auto || truncated) toast(t("bms.loaded", { n: bms.length }) + (truncated ? t("bms.truncated") : ""));   // the list itself is the answer to an automatic load
  } catch (e) {
    if (e instanceof Stale) return;
    if (isPermError(e)) state.bmPerm = true;         // this token can't read BMs: say so in the list, calmly
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
const viewRows = () => sortBms(filterBms(state.bms, { q: state.bmQuery, status: state.bmStatus }));
const isFiltered = () => !!(state.bmQuery.trim() || state.bmStatus);
const verLabel = (status) => (has(`bms.ver.${status}`) ? t(`bms.ver.${status}`) : humanize(status));
const dayFmts = new Map();                           // one Intl formatter per UI locale (a row draws one each time)
function fmtDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const l = locale();
  if (!dayFmts.has(l)) dayFmts.set(l, new Intl.DateTimeFormat(l, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }));
  return dayFmts.get(l).format(d);
}
function copyIds() {
  const rows = viewRows();
  if (!rows.length) return;
  copy(idsOf(rows), t("bms.idsCopied", { n: rows.length }) + (state.bmsTruncated ? t("bms.partial") : ""));
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
    el("div", { class: "total", id: "bmsTotal" }),
    el("div", { class: "chips", id: "bmsChips" }));
  applyStatic(card);
}
// "12 BM (not all) · updated 3 min ago"; with a search or chip: "3 of 12 found".
function renderTotal() {
  const total = $("#bmsTotal");
  if (!total) return;
  if (!state.bmsAt) return fill(total);
  const all = state.bms.length, n = viewRows().length;
  const count = isFiltered() ? t("bms.found", { n, all }) : t("bms.total", { n: all });
  fill(total, el("span", { class: "total-label" }, `${count}${state.bmsTruncated ? t("bms.notAll") : ""} · ${t("bms.updated", { t: ago(state.bmsAt) })}`));
}
function renderBms() { if (ready) keepFocus(drawBms); }
function drawBms() {
  const list = $("#bmsList");
  // A chip is only useful while the BMs differ; a chip whose BMs are gone (refresh) is dropped.
  const chips = statusChips(state.bms);
  if (state.bmStatus && !chips.some(([s]) => s === state.bmStatus)) state.bmStatus = null;
  const rows = viewRows();
  renderTotal();
  $("#copyBmIds").disabled = !rows.length;
  fill($("#bmsChips"), ...chips.map(([status, n]) => {
    const on = state.bmStatus === status;
    return el("button", { type: "button", class: `pill chip ${VERIFICATION[status] || ""}${on ? " on" : ""}`, "aria-pressed": String(on), "data-focus": `bm-chip:${status}`,
      onclick: () => { state.bmStatus = on ? null : status; renderBms(); } }, `${verLabel(status)} ${n}`);
  }));
  if (!state.bmsAt) return fill(list, el("div", { class: "empty" }, state.bmPerm ? t("bms.noPerm") : state.bmsLoading ? t("bms.loading") : t("bms.empty")));
  const note = state.bmPerm ? el("div", { class: "hint bm-note" }, t("bms.noPerm")) : null;   // a refresh was refused: the old list stays, the note says why it is old
  if (!state.bms.length) return fill(list, note, el("div", { class: "empty" }, state.bmsLoading ? t("bms.loading") : t("bms.none")));
  if (!rows.length) return fill(list, note, el("div", { class: "empty" }, t("bms.noMatch")));
  const counts = adCounts(state.accounts);
  fill(list, note, ...rows.map((b) => renderBm(b, counts)));
}

// Unknown or refused values read "—" with the reason as a tooltip, never a guess.
const noField = (cls = "pill") => el("span", { class: cls, title: t("bms.noField") }, "—");
function verificationPill(b) {
  const v = verificationOf(b);
  if (v.state === "refused" || v.state === "unknown") return noField();
  return el("span", { class: `pill ${v.tone}`, title: `${t("bms.verTitle")} · ${v.status}` }, verLabel(v.status));
}
function rolePill(b) {
  const r = roleOf(b);
  if (r.state === "unknown") return null;
  if (r.state === "refused") return noField();
  const label = r.state === "admin" ? t("bms.role.admin") : r.state === "employee" ? t("bms.role.employee") : humanize(r.name);
  return el("span", { class: "pill", title: t("bms.roleTitle") }, label);
}
// The ad accounts of this BM (counted from the Accounts tab's list: each account names its owner). Clicking filters that tab
// by this BM and opens it; without a loaded list the same click is "Show ad accounts" (the Accounts tab loads by itself).
function accountsLine(b, counts) {
  const go = () => { emit("filter-bm", { id: b.id, name: b.name }); emit("show-tab", "accounts"); };
  const arrow = el("i", { class: "i i-chevron", "aria-hidden": "true" });
  if (!state.fetchedAt)
    return el("button", { type: "button", class: "bm-accs", "data-focus": `bm-accs:${b.id}`, title: t("bms.accsShowTitle"), onclick: go }, el("span", {}, t("bms.accsShow")), arrow);
  const c = counts.get(b.id);
  if (!c) return el("span", { class: "bm-none", title: t("bms.accsNoneTitle") }, t("bms.accsNone"));
  const partial = state.truncated;                   // the Accounts list stopped at its page limit: there may be more
  return el("button", { type: "button", class: "bm-accs", "data-focus": `bm-accs:${b.id}`, title: partial ? `${t("bms.accsTitle")}. ${t("bms.accsPartial")}` : t("bms.accsTitle"), onclick: go },
    el("span", {}, `${c.total}${partial ? "+" : ""} ${tn(c.total, "bms.accCount")}`,
      c.active ? el("span", { class: "bm-ok" }, t("bms.accActive", { n: c.active })) : null,
      c.disabled ? el("span", { class: "err-text" }, t("bms.accDisabled", { n: c.disabled })) : null),
    arrow);
}
// Business Settings, its ad accounts, verification (until it is verified), Business Support Home. A link only when the
// builder accepts the id (links.js).
function linksLine(b) {
  const defs = [["settings", LINKS.bmSettings(b.id)], ["accounts", LINKS.bmAdAccounts(b.id)],
    ...(isVerified(b) ? [] : [["security", LINKS.bmSecurity(b.id)]]), ["quality", LINKS.bmQuality(b.id)]];
  return el("div", { class: "bm-line bm-links" }, defs.filter(([, href]) => href).map(([k, href]) =>
    el("a", { class: "bm-link", href, target: "_blank", rel: "noopener noreferrer", title: t(`bms.link.${k}.title`), "data-focus": `bm-link:${b.id}:${k}` },
      t(`bms.link.${k}`), el("i", { class: "i i-external", "aria-hidden": "true" }))));
}
function renderBm(b, counts) {
  const day = isoDay(b.created_time);
  const page = b.primary_page?.name || b.primary_page?.id;
  const tfa = b.two_factor_type;
  return el("div", { class: "bm" },
    el("div", { class: "bm-top" },
      el("span", { class: "bm-name", title: b.name }, el("i", { class: "i i-bm", "aria-hidden": "true" }), el("span", { class: "bm-name-text" }, b.name || t("bms.noName"))),
      el("div", { class: "bm-pills" }, verificationPill(b), rolePill(b))),
    el("div", { class: "bm-line" },
      el("button", { type: "button", class: "acc-id", title: t("acc.copyId"), "data-focus": `bm-id:${b.id}`, onclick: () => copy(b.id, t("acc.idCopied")) },
        b.id, el("i", { class: "i i-copy" })),
      el("span", { title: day ? t("bms.createdTitle") : t("bms.noField") }, t("bms.created", { d: day ? fmtDay(day) : "—" })),
      page ? el("span", { class: "bm-page", title: t("bms.pageTitle", { id: b.primary_page?.id || "" }) }, t("bms.page", { n: page })) : null,
      tfa ? el("span", { title: t("bms.tfaTitle") }, t("bms.tfa", { v: has(`bms.tfa.${tfa}`) ? t(`bms.tfa.${tfa}`) : tfa })) : null),
    el("div", { class: "bm-line" }, accountsLine(b, counts)),
    linksLine(b));
}

// ---------- wiring ----------
// Showing the tab refreshes the counts (the Accounts tab may have loaded since) and starts the auto-load.
registerTab("bms", { tall: true, onShow: () => { renderBms(); autoLoadBms(); } });
registerRender(() => renderBms());                   // RU · EN
// Every 30 s: the "updated … ago" text; the rows only when the Accounts list they count from has changed.
let accSig = "";
registerRender(() => {
  if (!ready || !$("#tab-bms").classList.contains("active")) return;
  const sig = `${state.fetchedAt}:${state.accounts?.length}`;
  if (sig !== accSig) { accSig = sig; renderBms(); } else renderTotal();
}, { lang: false, tick: true });
registerInit(() => {
  buildControls();
  $("#loadBms").addEventListener("click", () => fetchBms());
  $("#copyBmIds").addEventListener("click", copyIds);
  $("#bmFilter").addEventListener("input", (e) => { state.bmQuery = e.target.value; renderBms(); });
  ready = true;
});
registerStart(() => { renderBms(); accSig = `${state.fetchedAt}:${state.accounts?.length}`; });
