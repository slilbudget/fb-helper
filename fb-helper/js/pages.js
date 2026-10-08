// The Pages tab: every Facebook page this token can see, and whether each is alive for advertising and usable (Dead: Meta does not allow
// promoting it; Hidden: unpublished; No access: no Advertise task for me). Instagram is told in the body only: it is not a problem.
// The list = the profile's own pages (me/accounts, which carries the user's tasks) + every page of every business of the profile
// (<business>/owned_pages and /client_pages), one row per page. Every problem comes with its fix as one link. The logic is in
// pages-model.js (plain Node, tested); this file loads, caches and draws it with the shared row (row.js). Same shape as the other
// tabs: auto-load on the first visit when nothing is cached, a refresh button otherwise, one refresh per minute (the whole read,
// all requests, is under ONE rate slot), dead session / API pause respected, other windows followed.
// Read-only: GET only, and never a Page access token (the field lists are explicit, the rows whitelisted).

import { t } from "./i18n.js";
import "./strings/pages.js";
import { $, el, fill, keepFocus, toast, scrollFade } from "./dom.js";
import { ago } from "./format.js";
import { state, Stale, saveSession } from "./state.js";
import { readPaged } from "./graph.js";
import { readBusinessEdges } from "./biz-edges.js";
import { listLoader } from "./list-loader.js";
import { emptyView, listNote } from "./list-state.js";
import { readPictures, picturelessPages, picturesOf } from "./pictures.js";
import { on } from "./bus.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";
import { LINKS } from "./links.js";
import { row, kv, whatToDo, fixLink, linksRow } from "./row.js";
import {
  OPTIONAL, BASE, BIZ_OPTIONAL, BIZ_EDGES, CHIPS, IG_FIX, keysToDrop, slimPage, finishPages, accessVerdict, viaBusiness,
  igOf, issuesOf, chipCounts, filterPages, sortPages,
} from "./pages-model.js";

const SLOT_MS = 60 * 1000;                   // one list read per minute (a failed attempt counts too); the slot covers ALL requests of a refresh
const PAGE_SIZE = 50, MAX_PAGES = 4;         // per edge: up to 200 pages; more = "not all"

Object.assign(state, {
  pages: [], pagesAt: 0, pagesTruncated: false, pagesBizFail: false,   // pagesBizFail: a business or one of its edges could not be read (the pages only in it may be missing)
  pagesQ: "", pagesChip: null, pagesLoading: false, pagesOpen: new Set(),
});

// ---------- storage ----------
// Rows (already cut to the whitelist) kept across popup reopen and token changes, dropped when the FB user changes. The cache is
// registered by the shared loader (list-loader.js, below), which also takes over what another window of the extension loaded.

// Optional fields Graph refused for this token. Our own set: state.skip is shared with the Ad accounts tab. Replaced on a
// token change (the new token may read what the old one could not), hence the function form where it is handed to readPaged.
let skip = new Set();
on("generation", () => { skip = new Set(); renderPages(); });
on("token-hint", () => renderPages());               // the Token tab's reason for having no token changed
on("token-dead", () => renderPages());
on("cache-dropped", () => { state.pagesChip = null; renderPages(); });
on("pictures", () => renderPages());                 // pictures were read (pictures.js)

// ---------- load ----------
// The profile's own pages (me/accounts: it carries the person's tasks). The row keeps the refusals of its own page, and loses everything not
// whitelisted. A refusal readPaged cannot name (a nested field, a permission error that is really about the Instagram fields) gives up the
// optional fields it can blame, in tiers (pages-model keysToDrop), and asks again; what is left to blame decides when to stop.
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
// The pages of the profile's businesses (biz-edges.js: me/businesses, then owned_pages and client_pages of each, at most 50 businesses,
// owned edges first so a page both owned and shared keeps its owner). Best effort: a business list the token cannot read, a business or an
// edge that errors is skipped and the rest stays (failed = true then, so the screen says some pages may be missing). One skip set for the
// whole walk (a copy of the profile's: a field refused on one edge is not asked for again on the next, and never drops it for me/accounts).
// Every row is marked with the business it came through (`_viaBm`). The walk ends once the token is dead or paused (nothing more would go out).
const readBusinessPages = (gen) => {
  const edgeSkip = new Set(skip);
  return readBusinessEdges({
    gen, edges: BIZ_EDGES,
    readEdge: (path, bm, edge) => readPaged(path, {
      base: BASE, optional: BIZ_OPTIONAL, skip: edgeSkip, limit: PAGE_SIZE, maxPages: MAX_PAGES,
      map: (raw) => viaBusiness(slimPage(raw, [...edgeSkip]), bm, edge === "owned_pages"),
    }),
  });
};
const loader = listLoader({
  name: "pages", button: "#loadPages", slotMs: SLOT_MS, waitKey: "pages.wait",   // one list read per minute; the slot covers ALL requests of a refresh
  keys: ["pages", "pagesAt", "pagesTruncated", "pagesBizFail"],
  reset: () => Object.assign(state, { pages: [], pagesAt: 0, pagesTruncated: false, pagesBizFail: false, pagesOpen: new Set() }),
  load: (ses) => Object.assign(state, { pages: Array.isArray(ses.pages) ? ses.pages : [], pagesAt: ses.pagesAt || 0, pagesTruncated: !!ses.pagesTruncated, pagesBizFail: !!ses.pagesBizFail }),
  has: () => !!state.pagesAt,
  atKey: "pagesAt", at: () => state.pagesAt,
  followed: () => renderPages(),
  loading: (on) => { state.pagesLoading = on; renderPages(); },
  // The tab loads by itself on the first visit of a popup that has nothing cached for this FB user. A cached list is only refreshed by the
  // button: reopening the popup or switching tabs never sends a request.
  empty: () => !state.pagesAt, due: () => !state.pagesAt,
  read: async ({ gen }) => {
    const mine = await readMine();
    if (gen !== state.gen) throw new Stale();
    const biz = await readBusinessPages(gen);           // nothing of it is an error: the profile's own pages are already in hand
    return { mine, biz };
  },
  commit: async ({ mine, biz }, { gen, auto, owner }) => {
    // the profile's own row of a page wins: it has the tasks. "Not in me/accounts" is a verdict only when me/accounts was read completely.
    const pages = finishPages([...mine.rows, ...biz.rows], { verdict: accessVerdict(mine, biz) });
    const truncated = mine.truncated || biz.truncated;
    Object.assign(state, { pages, pagesAt: Date.now(), pagesTruncated: truncated, pagesBizFail: biz.failed, owner });   // before the write: our own storage event must find nothing new
    await saveSession({ pages, pagesAt: state.pagesAt, pagesTruncated: truncated, pagesBizFail: biz.failed, owner });
    readPictures("page", picturelessPages(pages), gen);   // the pictures the list read did not bring (pictures.js): not awaited, silent
    return !auto || truncated ? t("pages.loaded", { n: pages.length }) + (truncated ? t("pages.truncated") : "") : null;
  },
});

// ---------- draw ----------
const visiblePages = () => sortPages(filterPages(state.pages, { q: state.pagesQ, chip: state.pagesChip }));
const isFiltered = () => !!(state.pagesQ.trim() || state.pagesChip);
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
// Alive · Dead · Hidden · No access, each with its count; a chip with nothing behind it is not drawn (like the status chips of the Ad accounts tab).
function renderChips() {
  const counts = chipCounts(state.pages);
  if (state.pagesChip && !counts[state.pagesChip]) state.pagesChip = null;
  fill($("#pagesChips"), ...Object.keys(CHIPS).filter((k) => counts[k] > 0).map((k) => {
    const on = state.pagesChip === k;
    return el("button", { type: "button", class: `pill chip ${CHIPS[k]}${on ? " on" : ""}`, "aria-pressed": String(on), "data-focus": `pchip:${k}`, "aria-label": `${t(`pages.chip.${k}`)}: ${counts[k]}`,
      onclick: () => { state.pagesChip = on ? null : k; renderPages(); } }, `${t(`pages.chip.${k}`)} ${counts[k]}`);
  }));
  scrollFade($("#pagesChips"));
}
function renderPages() { if ($("#pageFilter")) keepFocus(drawPages); }          // nothing to draw before registerInit has built the controls
function drawPages() {
  const list = $("#pagesList");
  renderTotal();
  renderChips();
  const rows = visiblePages();
  const empty = () => emptyView({ tab: "pages", loaded: !!state.pagesAt, loading: state.pagesLoading, none: t("pages.none"), loadingText: t("pages.loading"), retry: () => loader.retry() });
  if (!state.pagesAt) return fill(list, empty());
  const notes = [listNote("pages", "pg-note")];                    // a refresh was refused: the old list stays, the note says why it is old
  // Pages that are only in a business: read through the business edges. A muted line only when one of those reads failed.
  const foot = state.pagesBizFail ? el("div", { class: "pg-foot" }, t("pages.bmHint")) : null;
  if (!state.pages.length) return fill(list, ...notes, empty(), foot);
  if (!rows.length) return fill(list, ...notes, el("div", { class: "empty" }, t("pages.noMatch")), foot);
  fill(list, ...notes, ...rows.map(renderPage), foot);
}

// The Instagram line of the body: what the identity is, with the explanation as the tooltip. Only here: a page without an account is not a
// problem of the row, but "none" is in the warning colour and has its way out beside it (Set up → Ads Manager, where «Use Facebook Page» is chosen).
function instagramPair(p, name) {
  const ig = igOf(p);
  const pair = (value, title) => [t("pages.kv.ig"), value, { title, wide: true }];
  if (ig.state === "real") return pair(ig.username ? `@${ig.username}` : t("pages.ig.realNoName"), t("pages.igRealTitle"));
  if (ig.state === "pbia") return pair(t("pages.ig.pbia"), t("pages.igPbiaTitle"));
  if (ig.state === "unknown") return pair(t("pages.ig.unknown"), t("pages.igUnknownTitle"));
  const url = IG_FIX.url(p);
  return pair([el("span", { class: "pg-none" }, t("pages.ig.none")),
    url ? fixLink({ label: IG_FIX.label, url, tip: t(IG_FIX.tip) }, { tone: "warn", cls: "pg-ig-fix", focus: `pfix:${p.id}:ig`, owner: name }) : null], t(IG_FIX.tip));
}
// The problems of a page when it has several (the worst is on line 2 of the row too): each as its word and its fix, so every problem has its way out in one place.
function problemList(p, issues, name) {
  return el("span", { class: "pg-probs" }, issues.map((i) => el("span", { class: "pg-prob", "data-problem": i.key },
    el("span", { class: `pg-prob-text ${i.tone}`, title: i.rawTip || t(i.tip) }, t(i.label)),
    i.fix ? fixLink({ label: i.fix.label, url: i.fix.url, tip: t(i.fix.tip) }, { tone: i.tone, focus: `pfix:${p.id}:${i.key}`, owner: name }) : null)));
}
// One page = the shared row (row.js): picture · name; line 2 is the ID alone while the page is fine (silent), else the ID · the worst problem
// (Dead / Hidden / No access) · its one fix (+N for the others). The body (built when the row opens): all the problems with their fixes when
// there are two or more (with one, line 2 already has it), the reason Graph gave for a dead page, Instagram, the owner business, the links.
function renderPage(p) {
  const name = p.name || t("pages.noName");
  const issues = issuesOf(p), worst = issues[0];
  const dead = issues.find((i) => i.key === "dead");
  return row({
    key: p.id, avatar: { kind: "page", url: picturesOf("page", p.id, p.picture) }, name,
    status: worst ? { tone: worst.tone, text: t(worst.label), title: worst.rawTip || t(worst.tip) } : { tone: "ok", text: t("pages.alive") },
    fix: worst?.fix && { label: worst.fix.label, url: worst.fix.url, tip: t(worst.fix.tip) },
    more: Math.max(0, issues.length - 1),
    id: { value: p.id },
    open: state.pagesOpen.has(p.id),
    onToggle: (open) => { if (open) state.pagesOpen.add(p.id); else state.pagesOpen.delete(p.id); },
    body: () => [
      issues.length > 1 ? whatToDo({ help: problemList(p, issues, name), tone: worst.tone, owner: name, focus: `ptodo:${p.id}` }) : null,
      kv([
        dead?.rawTip ? [t("pages.kv.reason"), dead.rawTip, { wide: true }] : null,
        instagramPair(p, name),
        [t("pages.kv.business"), p.business?.name || "", { wide: true }],
      ]),
      linksRow([
        { id: "page", label: "pages.linkPage", url: LINKS.page(p.id), tip: t("pages.linkPageTitle") },
        { id: "suite", label: "pages.linkSuite", url: LINKS.pageSuite(p.id), tip: t("pages.linkSuiteTitle") },
      ], { owner: name, focus: `plink:${p.id}` }),
    ],
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
  $("#loadPages").addEventListener("click", () => loader.load());
  $("#pageFilter").addEventListener("input", (e) => { state.pagesQ = e.target.value; renderPages(); });
}
function labelControls() {
  const q = $("#pageFilter");
  q.placeholder = t("search"); q.setAttribute("aria-label", t("pages.searchAria"));
  $("#loadPages").setAttribute("aria-label", t("refresh"));
  renderTotal();                                                                  // the refresh tooltip ("Refresh · updated 3 min ago")
}

// Full height from the start (a list arriving a moment later must not make the window jump); showing the tab starts the auto-load.
registerTab("pages", { onShow: loader.ensure });
registerRender(() => { labelControls(); renderPages(); });                       // RU · EN
registerRender(() => { renderTotal(); }, { lang: false, tick: true });          // "updated 3 min ago"
registerInit(() => { buildControls(); labelControls(); });
registerStart(renderPages);
