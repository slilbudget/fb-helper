// The Pages tab: every Facebook page this token can see, and whether each is ready to run ads (an Instagram identity: a NEW page
// needs "Use Facebook Page" chosen once, else automated launches to Instagram placements fail; published; may advertise; my access).
// The list = the profile's own pages (me/accounts, which carries the user's tasks) + every page of every business of the profile
// (<business>/owned_pages and /client_pages), one row per page. Every problem comes with its fix as one link. The logic is in
// pages-model.js (plain Node, tested); this file loads, caches and draws it with the shared row (row.js). Same shape as the other
// tabs: auto-load on the first visit when nothing is cached, a refresh button otherwise, one refresh per minute (the whole read,
// all requests, is under ONE rate slot), dead session / API pause respected, other windows followed.
// Read-only: GET only, and never a Page access token (the field lists are explicit, the rows whitelisted).

import { t, has } from "./i18n.js";
import "./strings/pages.js";
import { $, el, fill, keepFocus, toast } from "./dom.js";
import { ago } from "./format.js";
import { state, Stale, saveSession, fbUser, checkOwner, claimSlot, registerCache, isDead, deadCode } from "./state.js";
import { graph, readPaged } from "./graph.js";
import { settledGrab, grabToken, tokenReady } from "./token.js";
import { on, emit } from "./bus.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";
import { LINKS } from "./links.js";
import { row, kv, whatToDo, fixLink, linksRow } from "./row.js";
import {
  OPTIONAL, BASE, BIZ_OPTIONAL, BIZ_EDGES, PROBLEMS, isPermissionError, keysToDrop, slimPage, finishPages, businessList, viaBusiness,
  igOf, handleOf, accessOf, humanTask, issuesOf, problemCounts, filterPages, sortPages, MAX_BUSINESSES,
} from "./pages-model.js";

const SLOT_MS = 60 * 1000;                   // one list read per minute (a failed attempt counts too); the slot covers ALL requests of a refresh
const PAGE_SIZE = 50, MAX_PAGES = 4;         // per edge: up to 200 pages; more = "not all"

Object.assign(state, {
  pages: [], pagesAt: 0, pagesTruncated: false, pagesBizFail: false,   // pagesBizFail: a business or one of its edges could not be read (the pages only in it may be missing)
  pagesQ: "", pagesProblem: null, pagesLoading: false, pagesNote: null, pagesOpen: new Set(),
});

// ---------- storage ----------
// Rows (already cut to the whitelist) kept across popup reopen and token changes, dropped when the FB user changes.
registerCache(["pages", "pagesAt", "pagesTruncated", "pagesBizFail"],
  () => Object.assign(state, { pages: [], pagesAt: 0, pagesTruncated: false, pagesBizFail: false, pagesNote: null, pagesOpen: new Set() }),
  {
    load: (ses) => Object.assign(state, { pages: Array.isArray(ses.pages) ? ses.pages : [], pagesAt: ses.pagesAt || 0, pagesTruncated: !!ses.pagesTruncated, pagesBizFail: !!ses.pagesBizFail }),
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
    chrome.storage.session.get(["pages", "pagesAt", "pagesTruncated", "pagesBizFail", "owner"]).then((c) => {
      Object.assign(state, { pages: Array.isArray(c.pages) ? c.pages : [], pagesAt: c.pagesAt || 0, pagesTruncated: !!c.pagesTruncated, pagesBizFail: !!c.pagesBizFail, owner: c.owner || null });
      renderPages();
    });
  }
});

// ---------- load ----------
// The profile's own pages. A refusal readPaged cannot name (a nested field, a permission error that is really about the Instagram
// fields) gives up the optional fields it can blame and asks again; what is left to blame decides when to stop.
async function readMine() {
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
// The pages of the profile's businesses: me/businesses (id, name), then for each business (at most MAX_BUSINESSES) its owned_pages and
// client_pages, sequentially, owned edges first so a page both owned and shared keeps its owner. Best effort: a business list the token
// cannot read, a business or an edge that errors is skipped and the rest stays (failed = true then, so the screen says some pages may
// be missing). Every edge has its own skip set (a copy of the profile's), so a field refused there never drops it from the other reads.
// Every row is marked with the business it came through (`_viaBm`). Stops reading once the token is dead or paused (nothing more would go out).
// `gen` = the generation the load started in: a token change in between ends it (Stale), like an aborted request does.
async function readBusinessPages(gen) {
  let bms;
  try {
    const r = await graph("me/businesses", { fields: "id,name", limit: String(MAX_BUSINESSES) });
    bms = businessList(r.data, !!r.paging?.next);
  } catch (e) {
    if (e instanceof Stale) throw e;
    return { rows: [], truncated: false, failed: true };            // no list of businesses: only the profile's own pages
  }
  const rows = [];
  let truncated = bms.more, failed = false;
  edges: for (const edge of BIZ_EDGES) {
    for (const bm of bms.list) {
      if (gen !== state.gen) throw new Stale();
      const edgeSkip = new Set(skip);
      try {
        const r = await readPaged(`${bm.id}/${edge}`, {
          base: BASE, optional: BIZ_OPTIONAL, skip: edgeSkip, limit: PAGE_SIZE, maxPages: MAX_PAGES,
          map: (raw) => viaBusiness(slimPage(raw, [...edgeSkip]), bm, edge === "owned_pages"),
        });
        rows.push(...r.rows);
        truncated ||= r.truncated;
      } catch (e) {
        if (e instanceof Stale) throw e;
        failed = true;
        if (isDead() || state.cooldownUntil > Date.now()) break edges;
      }
    }
  }
  return { rows, truncated, failed };
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
    const mine = await readMine();
    if (gen !== state.gen) return;
    const biz = await readBusinessPages(gen);           // nothing of it is an error: the profile's own pages are already in hand
    if (gen !== state.gen) return;
    // The list belongs to the FB user of this profile; a cache of another login (shared owner key) is dropped first.
    if (await checkOwner()) emit("cache-dropped");
    const owner = await fbUser();
    if (gen !== state.gen) return;
    const pages = finishPages([...mine.rows, ...biz.rows]);       // the profile's own row of a page wins: it has the tasks
    const truncated = mine.truncated || biz.truncated;
    Object.assign(state, { pages, pagesAt: Date.now(), pagesTruncated: truncated, pagesBizFail: biz.failed, owner });   // before the write: our own storage event must find nothing new
    await saveSession({ pages, pagesAt: state.pagesAt, pagesTruncated: truncated, pagesBizFail: biz.failed, owner });
    if (!auto || truncated) toast(t("pages.loaded", { n: pages.length }) + (truncated ? t("pages.truncated") : ""));
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
// The line under the controls says something only when there is something to say: how many of the pages a filter leaves ("3 of 10
// found"), or that the list is not complete. "Updated 3 min ago" is the refresh button's tooltip.
function renderTotal() {
  const box = $("#pagesTotal"), btn = $("#loadPages");
  if (btn) btn.title = state.pagesAt ? `${t("refresh")} · ${t("pages.updated", { t: ago(state.pagesAt) })}` : t("refresh");
  if (!box) return;
  const line = !state.pagesAt ? ""
    : isFiltered() ? `${t("pages.found", { n: visiblePages().length, all: state.pages.length })}${state.pagesTruncated ? t("pages.notAll") : ""}`
      : state.pagesTruncated ? t("pages.notAllLine") : "";
  fill(box, line ? el("span", { class: "total-label" }, line) : null);
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
  const perm = state.pagesNote === "perm" ? t("pages.perm") : null;
  if (!state.pagesAt) {
    return fill(list, el("div", { class: "empty" }, state.pagesLoading ? t("pages.loading") : perm || t("pages.empty")));
  }
  const notes = [
    perm ? el("div", { class: "hint pg-note" }, perm) : null,
    // The fix for the problem the chip shows, written out (the word's tooltip says it too, but a tooltip is easy to miss).
    state.pagesProblem === "noIg" ? el("div", { class: "hint pg-note" }, t("pages.igFix")) : null,
  ];
  // Pages that are only in a business: read through the business edges. A muted line only when one of those reads failed.
  const foot = state.pagesBizFail ? el("div", { class: "pg-foot" }, t("pages.bmHint")) : null;
  if (!state.pages.length) return fill(list, ...notes, el("div", { class: "empty" }, t("pages.none")), foot);
  if (!rows.length) return fill(list, ...notes, el("div", { class: "empty" }, t("pages.noMatch")), foot);
  fill(list, ...notes, ...rows.map(renderPage), foot);
}

// "Advertise, Manage, Insights": the tasks in plain words (an unknown task is shown as plain words too).
const taskText = (tasks) => tasks.map((x) => (has(`pages.task.${x}`) ? t(`pages.task.${x}`) : humanTask(x))).filter(Boolean).join(", ");
// The Instagram line of the body: what the identity is, with the explanation as the tooltip.
function instagramPair(p) {
  const ig = igOf(p);
  const pair = (value, title) => [t("pages.kv.ig"), value, { title, wide: true }];
  if (ig.state === "real") return pair(ig.username ? t("pages.ig.real", { u: ig.username }) : t("pages.ig.realNoName"), t("pages.igRealTitle"));
  if (ig.state === "pbia") return pair(t("pages.ig.pbia"), t("pages.igPbiaTitle"));
  if (ig.state === "none") return pair(t("pages.ig.none"), t("pages.igNoneTitle"));
  return pair(t("pages.ig.unknown"), t("pages.igUnknownTitle"));
}
// The other problems of a page (the worst is on line 2 of the row): each as its word and its fix, so every problem has its way out.
function otherProblems(p, issues, name) {
  return el("span", { class: "pg-probs" }, issues.map((i) => el("span", { class: "pg-prob", "data-problem": i.key },
    el("span", { class: `pg-prob-text ${i.tone}`, title: i.rawTip || t(i.tip) }, t(i.label)),
    i.fix ? fixLink({ label: i.fix.label, url: i.fix.url, tip: t(i.fix.tip) }, { tone: i.tone, focus: `pfix:${p.id}:${i.key}`, owner: name }) : null)));
}
// One page = the shared row (row.js): picture · name … the Instagram handle; healthy = silent (only the identity of a page-backed
// account), a problem = its word + its fix (+N for the others); the ID. The body (built when the row opens): the other problems,
// Instagram, business, my access, links.
function renderPage(p) {
  const name = p.name || t("pages.noName");
  const issues = issuesOf(p), worst = issues[0];
  const handle = handleOf(p), pbia = igOf(p).state === "pbia";
  return row({
    key: p.id, avatar: { kind: "page", url: p.picture }, name,
    value: handle, valueTitle: handle ? t("pages.igRealTitle") : null, valueMuted: true,
    status: worst ? { tone: worst.tone, text: t(worst.label), title: worst.rawTip || t(worst.tip) } : { tone: "ok", text: t("pages.ready") },
    context: !worst && pbia ? [el("span", { class: "lrow-ctx", title: t("pages.igPbiaTitle") }, t("pages.igPbia"))] : [],
    fix: worst?.fix && { label: worst.fix.label, url: worst.fix.url, tip: t(worst.fix.tip) },
    more: Math.max(0, issues.length - 1),
    id: { value: p.id },
    open: state.pagesOpen.has(p.id),
    onToggle: (open) => { if (open) state.pagesOpen.add(p.id); else state.pagesOpen.delete(p.id); },
    body: () => {
      const acc = accessOf(p), bmId = p._viaBm || p.business?.id;     // a business I am in comes first: the owner's settings may not be mine to open
      return [
        issues.length > 1 ? whatToDo({ help: otherProblems(p, issues.slice(1), name), owner: name, focus: `ptodo:${p.id}` }) : null,
        kv([
          instagramPair(p),
          [t("pages.kv.business"), p.business?.name || "", { wide: true }],
          [t("pages.kv.access"), acc.via ? t("pages.access.via") : taskText(acc.tasks), { wide: true }],
        ]),
        linksRow([
          { id: "page", label: "pages.linkPage", url: LINKS.page(p.id), tip: t("pages.linkPageTitle") },
          { id: "suite", label: "pages.linkSuite", url: LINKS.pageSuite(p.id), tip: t("pages.linkSuiteTitle") },
          { id: "bm", label: "pages.linkBm", url: LINKS.bmPages(bmId), tip: t("pages.linkBmTitle") },
        ], { owner: name, focus: `plink:${p.id}` }),
      ];
    },
  });
}

// ---------- wiring ----------
// The controls are built here (popup.html only has the empty card), so the strings come from t() and follow a language switch.
function buildControls() {
  fill($("#pagesCard"),
    el("div", { class: "search" },
      el("i", { class: "i i-search", "aria-hidden": "true" }),
      el("input", { id: "pageFilter", class: "field", type: "search", autocomplete: "off" }),
      el("button", { id: "loadPages", type: "button", class: "icon-btn" }, el("i", { class: "i i-refresh", "aria-hidden": "true" }))),
    el("div", { class: "total", id: "pagesTotal" }),
    el("div", { class: "chips", id: "pagesChips" }));
  $("#loadPages").addEventListener("click", () => fetchPages());
  $("#pageFilter").addEventListener("input", (e) => { state.pagesQ = e.target.value; renderPages(); });
}
function labelControls() {
  const q = $("#pageFilter");
  q.placeholder = t("search"); q.setAttribute("aria-label", t("pages.searchAria"));
  $("#loadPages").setAttribute("aria-label", t("refresh"));
  renderTotal();                                                                  // the refresh tooltip ("Refresh · updated 3 min ago")
}

// Full height from the start (a list arriving a moment later must not make the window jump); showing the tab starts the auto-load.
registerTab("pages", { tall: true, onShow: autoLoadPages });
registerRender(() => { labelControls(); renderPages(); });                       // RU · EN
registerRender(() => { renderTotal(); }, { lang: false, tick: true });          // "updated 3 min ago"
registerInit(() => { buildControls(); labelControls(); });
registerStart(renderPages);
