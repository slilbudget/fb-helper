// The Pages tab: the Facebook pages the profile manages (one paged read of me/accounts), with what a media buyer checks
// first: is there an Instagram identity (a NEW page needs "Use Facebook Page" chosen once, else automated launches to
// Instagram placements fail), is it published, may it advertise. Every problem comes with its fix as one link. The logic is
// in pages-model.js (plain Node, tested); this file loads, caches and draws it. Same shape as the Ad accounts tab: auto-load on the first visit when nothing is
// cached, a refresh button otherwise, one request per minute, dead session / API pause respected, other windows followed.

import { t, tn } from "./i18n.js";
import "./strings/pages.js";
import { $, el, fill, numEl, toast, copy, keepFocus } from "./dom.js";
import { numFmt, ago } from "./format.js";
import { state, Stale, saveSession, fbUser, checkOwner, claimSlot, registerCache, isDead, deadCode } from "./state.js";
import { readPaged } from "./graph.js";
import { settledGrab, grabToken, tokenReady } from "./token.js";
import { on, emit } from "./bus.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";
import { LINKS } from "./links.js";
import { avatar, problems, quietLinks } from "./rows.js";
import {
  OPTIONAL, BASE, PROBLEMS, isPermissionError, keysToDrop, slimPage, finishPages, isVerified, audienceOf,
  issuesOf, statusOf, problemCounts, filterPages, sortPages, idsText, showBmHint,
} from "./pages-model.js";

const SLOT_MS = 60 * 1000;                   // one list read per minute (a failed attempt counts too)
const PAGE_SIZE = 50, MAX_PAGES = 4;         // up to 200 pages; more = "not all"

Object.assign(state, { pages: [], pagesAt: 0, pagesTruncated: false, pagesQ: "", pagesProblem: null, pagesLoading: false, pagesNote: null });

// ---------- storage ----------
// Rows (already cut to the whitelist) kept across popup reopen and token changes, dropped when the FB user changes.
registerCache(["pages", "pagesAt", "pagesTruncated"],
  () => Object.assign(state, { pages: [], pagesAt: 0, pagesTruncated: false, pagesNote: null }),
  {
    load: (ses) => Object.assign(state, { pages: Array.isArray(ses.pages) ? ses.pages : [], pagesAt: ses.pagesAt || 0, pagesTruncated: !!ses.pagesTruncated }),
    has: () => !!state.pagesAt,
  });

// Optional fields Graph refused for this token. Our own set: state.skip is shared with the Ad accounts tab. Replaced on a
// token change (the new token may read what the old one could not), hence the function form where it is handed to readPaged.
let skip = new Set();
on("generation", () => { skip = new Set(); state.pagesNote = null; renderPages(); });
on("cache-dropped", () => { state.pagesProblem = null; renderPages(); });
// Another window of this extension loaded or dropped the list: show the same.
on("session", (ch) => {
  if (ch.pagesAt && (ch.pagesAt.newValue || 0) !== state.pagesAt) {
    chrome.storage.session.get(["pages", "pagesAt", "pagesTruncated", "owner"]).then((c) => {
      Object.assign(state, { pages: Array.isArray(c.pages) ? c.pages : [], pagesAt: c.pagesAt || 0, pagesTruncated: !!c.pagesTruncated, owner: c.owner || null });
      renderPages();
    });
  }
});

// ---------- load ----------
// The whole list. A refusal readPaged cannot name (a nested field, a permission error that is really about the Instagram
// fields) gives up the optional fields it can blame and asks again; what is left to blame decides when to stop.
async function readAll() {
  for (;;) {
    try {
      return await readPaged("me/accounts", {
        base: BASE, optional: OPTIONAL, skip: () => skip, limit: PAGE_SIZE, maxPages: MAX_PAGES,
        map: (raw) => slimPage(raw, [...skip]),         // the row keeps the refusals of its own page, and loses everything not whitelisted
      });
    } catch (e) {
      if (e instanceof Stale) throw e;
      const drop = keysToDrop(e, skip);
      if (!drop.length) throw e;
      for (const k of drop) skip.add(k);
    }
  }
}
// auto: started by opening the tab, not by a click. Same limits as a click, but silent where a click would only complain
// (no token, dead session, API pause, the one-minute slot): the empty list explains itself.
let busy = false;                                       // one load at a time: a click during an automatic load is a no-op
async function fetchPages(opts) {
  if (busy) return;
  busy = true;
  try { await loadPagesNow(opts); } finally { busy = false; }
}
async function loadPagesNow({ auto = false } = {}) {
  await settledGrab();
  if (!state.token && !(await grabToken({ toClipboard: false, silent: auto }))) return;   // no token: grabToken says why
  if (isDead()) return auto ? undefined : toast(t("err.session", { c: deadCode() }), true);   // before the slot: costs nothing
  const pause = state.cooldownUntil - Date.now();
  if (pause > 0) return auto ? undefined : toast(t("err.cooldown", { n: Math.ceil(pause / 60000) }), true);
  const gen = state.gen;                                // fixed before waiting for the lock
  let wait;
  try { wait = await claimSlot("pages", SLOT_MS); }     // before sending: a failed attempt counts too
  catch (e) { return auto ? undefined : toast(t("err.slot", { m: e.message }), true); }
  if (gen !== state.gen) return;                        // new token while waiting
  if (wait > 0) return auto ? undefined : toast(t("pages.wait", { n: Math.ceil(wait / 1000) }), true);
  const btn = $("#loadPages");
  btn.disabled = true; btn.setAttribute("aria-busy", "true");
  state.pagesLoading = true; state.pagesNote = null; renderPages();
  try {
    const { rows, truncated } = await readAll();
    if (gen !== state.gen) return;
    // The list belongs to the FB user of this profile; a cache of another login (shared owner key) is dropped first.
    if (await checkOwner()) emit("cache-dropped");
    const owner = await fbUser();
    if (gen !== state.gen) return;
    const pages = finishPages(rows);
    Object.assign(state, { pages, pagesAt: Date.now(), pagesTruncated: truncated, owner });   // before the write: our own storage event must find nothing new
    await saveSession({ pages, pagesAt: state.pagesAt, pagesTruncated: truncated, owner });
    if (!auto || truncated) toast(t("pages.loaded", { n: pages.length }) + (truncated ? t("pages.truncated", { n: PAGE_SIZE * MAX_PAGES }) : ""));
  } catch (e) {
    if (e instanceof Stale) return;
    // The token cannot read pages: not an error of ours, a calm line in the list says what to do (and no red toast).
    if (isPermissionError(e)) state.pagesNote = "perm"; else toast(e.message, true);
  } finally {
    state.pagesLoading = false;
    btn.disabled = false; btn.removeAttribute("aria-busy");
    renderPages();
  }
}
// The tab loads the list by itself on the first visit of a popup that has nothing cached for this FB user. A cached list
// is only refreshed by the button: reopening the popup or switching tabs never sends a request.
let autoTried = false;
async function autoLoadPages() {
  if (autoTried || state.pagesAt) return;
  autoTried = true;
  state.pagesLoading = true; renderPages();             // "Loading…" at once, not "press refresh" and then "Loading…"
  try {
    // Without the silent token read the request could go out with a stale token. Not forever, though.
    await Promise.race([tokenReady, new Promise((resolve) => setTimeout(resolve, 15000))]);
    if (!state.token || isDead() || state.cooldownUntil > Date.now()) return;
    await fetchPages({ auto: true });
  } finally {
    if (!busy) { state.pagesLoading = false; renderPages(); }
  }
}

// ---------- draw ----------
const visiblePages = () => sortPages(filterPages(state.pages, { q: state.pagesQ, problem: state.pagesProblem }));
const isFiltered = () => !!(state.pagesQ.trim() || state.pagesProblem);
function copyIds() {
  const rows = visiblePages();
  if (!rows.length) return toast(t("pages.noIds"), true);
  copy(idsText(rows), t("pages.idsCopied", { n: rows.length }) + (state.pagesTruncated ? t("pages.partial") : ""));
}
function renderTotal() {
  const box = $("#pagesTotal");
  if (!box) return;
  if (!state.pagesAt) return fill(box);
  const all = state.pages.length, n = visiblePages().length;
  const count = isFiltered() ? t("pages.found", { n, all }) : `${all} ${tn(all, "pages.count")}`;
  fill(box, el("span", { class: "total-label" }, `${count}${state.pagesTruncated ? t("pages.notAll") : ""} · ${t("pages.updated", { t: ago(state.pagesAt) })}`));
}
function renderChips() {
  const counts = problemCounts(state.pages);
  if (state.pagesProblem && !counts[state.pagesProblem]) state.pagesProblem = null;
  fill($("#pagesChips"), ...Object.keys(PROBLEMS).filter((k) => counts[k] > 0).map((k) => {
    const on = state.pagesProblem === k;
    return el("button", { type: "button", class: `pill chip ${PROBLEMS[k]}${on ? " on" : ""}`, "aria-pressed": String(on), "data-focus": `pchip:${k}`,
      onclick: () => { state.pagesProblem = on ? null : k; renderPages(); } }, `${t(`pages.p.${k}`)} ${counts[k]}`);
  }));
}
function renderPages() { if ($("#pageFilter")) keepFocus(drawPages); }          // nothing to draw before registerInit has built the controls
function drawPages() {
  const list = $("#pagesList");
  renderTotal();
  renderChips();
  const rows = visiblePages();
  $("#copyPageIds").disabled = !rows.length;
  const perm = state.pagesNote === "perm" ? t("pages.perm") : null;
  if (!state.pagesAt) {
    return fill(list, el("div", { class: "empty" }, state.pagesLoading ? t("pages.loading") : perm || t("pages.empty")));
  }
  const notes = [
    perm ? el("div", { class: "hint pg-note" }, perm) : null,
    // The fix for the problem the chip shows, written out (the pill's tooltip says it too, but a tooltip is easy to miss).
    state.pagesProblem === "noIg" ? el("div", { class: "hint pg-note" }, t("pages.igFix")) : null,
  ];
  const foot = showBmHint(state.pages.length) ? el("div", { class: "pg-foot" }, t("pages.bmHint")) : null;
  if (!state.pages.length) return fill(list, ...notes, el("div", { class: "empty" }, t("pages.none")), foot);
  if (!rows.length) return fill(list, ...notes, el("div", { class: "empty" }, t("pages.noMatch")), foot);
  fill(list, ...notes, ...rows.map(renderPage), foot);
}
// One page = the grammar of every row (rows.js / popup.css): picture · name … ONE pill (the worst problem, else the Instagram
// state); ID + facts; each problem with its fix; secondary links.
function renderPage(p) {
  const name = p.name || t("pages.noName");
  const st = statusOf(p), aud = audienceOf(p);
  const audience = !aud ? null : `${numFmt().format(aud.n)} ${tn(aud.n, aud.kind === "followers" ? "pages.followers" : "pages.likes")}`;   // "likes" only when followers were not read
  const issues = issuesOf(p).map((i) => ({ id: i.key, tone: i.tone, text: t(i.label), tip: i.rawTip || t(i.tip), fix: i.fix && { label: i.fix.label, tip: t(i.fix.tip), url: i.fix.url } }));
  return el("div", { class: "row pg", "data-page": p.id },
    el("div", { class: "row-top" },
      el("span", { class: "row-name", title: p.name }, avatar({ url: p.picture, shape: "circle", icon: "flag" }), el("span", { class: "row-name-text" }, name)),
      el("span", { class: `pill ${st.tone}`, title: st.rawTip || t(st.tip) }, t(st.label, st.params))),
    el("div", { class: "row-line" },
      el("button", { type: "button", class: "acc-id", title: t("pages.copyId"), "data-focus": `pid:${p.id}`, onclick: () => copy(p.id, t("pages.idCopied")) },
        numEl(p.id), el("i", { class: "i i-copy", "aria-hidden": "true" })),
      p.category ? el("span", {}, p.category) : null,
      audience ? el("span", {}, audience) : null,
      p.business ? el("span", { class: "owner", title: t("pages.inBm", { n: p.business.name || "", id: p.business.id }) },
        el("i", { class: "i i-bm", "aria-hidden": "true" }), el("span", { class: "owner-name" }, p.business.name || p.business.id)) : null,
      isVerified(p) ? el("span", { title: t("pages.verifiedTitle", { s: p.verification_status }) }, t("pages.verified")) : null),
    problems(issues, { focus: `pfix:${p.id}`, owner: name }),
    // Links only when the id passes links.js (digits); each opens in a new tab and changes nothing by being opened.
    quietLinks([
      { id: "page", label: "pages.linkPage", tip: "pages.linkPageTitle", href: LINKS.page(p.id) },
      { id: "suite", label: "pages.linkSuite", tip: "pages.linkSuiteTitle", href: LINKS.pageSuite(p.id) },
      { id: "bm", label: "pages.linkBm", tip: "pages.linkBmTitle", href: LINKS.bmPages(p.business?.id) },
    ], { focus: `plink:${p.id}`, owner: name }));
}

// ---------- wiring ----------
// The controls are built here (popup.html only has the empty card), so the strings come from t() and follow a language switch.
function buildControls() {
  fill($("#pagesCard"),
    el("div", { class: "search" },
      el("i", { class: "i i-search", "aria-hidden": "true" }),
      el("input", { id: "pageFilter", class: "field", type: "search", autocomplete: "off" }),
      el("button", { id: "copyPageIds", type: "button", class: "btn ghost", disabled: true }, el("i", { class: "i i-copy", "aria-hidden": "true" }), el("span")),
      el("button", { id: "loadPages", type: "button", class: "icon-btn" }, el("i", { class: "i i-refresh", "aria-hidden": "true" }))),
    el("div", { class: "total", id: "pagesTotal" }),
    el("div", { class: "chips", id: "pagesChips" }));
  $("#loadPages").addEventListener("click", () => fetchPages());
  $("#copyPageIds").addEventListener("click", copyIds);
  $("#pageFilter").addEventListener("input", (e) => { state.pagesQ = e.target.value; renderPages(); });
}
function labelControls() {
  const q = $("#pageFilter");
  q.placeholder = t("search"); q.setAttribute("aria-label", t("pages.searchAria"));
  $("#copyPageIds").title = t("pages.copyIdsTitle"); $("#copyPageIds span").textContent = t("pages.copyIds");
  $("#loadPages").title = t("refresh"); $("#loadPages").setAttribute("aria-label", t("refresh"));
}

// Full height from the start (a list arriving a moment later must not make the window jump); showing the tab starts the auto-load.
registerTab("pages", { tall: true, onShow: autoLoadPages });
registerRender(() => { labelControls(); renderPages(); });                       // RU · EN
registerRender(() => { renderTotal(); }, { lang: false, tick: true });          // "updated 3 min ago"
registerInit(() => { buildControls(); labelControls(); });
registerStart(renderPages);
