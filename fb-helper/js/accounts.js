// The Ad accounts tab: the account list (one paged read, optional fields, spend periods) and each account's ads
// (list, then the per-ad numbers). Accounts and ads live in one file on purpose: a row draws its ads card and an ads
// read redraws the row, so splitting them would make the two import each other.
//
// The list answers "which account works, how much does it spend, what is broken and how do I fix it" (design.md section 2 + 8):
// accounts grouped by business (sticky header + subtotal), each one the shared row of row.js: name | spend of the period on line 1;
// on line 2 nothing for a healthy account, else the problem word, its one fix and "+N". The expanded body holds the numbers, what to do
// and the ads. What a row says about an account is nextsteps.js accountState (pure, tested).

import { t, tn, tnPlus, getLang } from "./i18n.js";
import { AD_PROBLEMS, adRank, reviewLines, insightRow, cleanText, digitsId, humanEnum } from "./pure.js";
import { $, $$, el, fill, toast, copy, keepFocus, scrollFade } from "./dom.js";
import { numFmt, ago, sameDay, tzLabel, major, fullDate } from "./format.js";
import { state, Stale, saveSession, claimSlot, slotLeft, onLoad, isDead, deadCode } from "./state.js";
import { graph, readPaged, pauseNote } from "./graph.js";
import { readBusinessEdges } from "./biz-edges.js";
import { listLoader } from "./list-loader.js";
import { emptyView, listNote } from "./list-state.js";
import { readPictures, groupLogoIds, picturesOf } from "./pictures.js";
import { settledGrab, grabToken } from "./token.js";
import { on, emit } from "./bus.js";
import { accountState, adSteps } from "./nextsteps.js";
import { LINKS } from "./links.js";
import { row, groupHeader, fixLink, kv, whatToDo, linksRow } from "./row.js";
import { fmtMoney, rowAmount, rates, cachedRates } from "./money.js";
import { PERIODS, statsOf as spendStats, periodRange as rangeOf, addUp } from "./spend.js";
import { BASE_FIELDS, PERIOD_INSIGHTS, OPTIONAL_FIELDS, AD_ALL, AD_ALL_INSIGHTS, AD_ALIASES, AD_STATUS, slimWith, word, underBmFilter as underFilter, visibleAccounts, chipCounts, chipsInOrder, isLive, liveIds, groupAccounts, valueOf } from "./accounts-model.js";
import { bindPeriods, fillTotal, refreshTip, isShown } from "./period.js";
import "./strings/actions.js";
import "./strings/bms.js";
import { restrictedOf } from "./bms-model.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";

const MIN_REFRESH_MS = 60 * 1000;            // accounts: one attempt per minute (failed attempts count too)
const ADS_LOCK_MS = 30 * 1000;               // ads: one read per account per 30 s
Object.assign(state, {
  accounts: [], fetchedAt: 0, truncated: false, failedBms: [], filter: "", statusFilter: null, accLoading: false,   // failedBms: ids of the businesses whose accounts could not be read
  autoPage: null,                                    // the FB page load the list was last loaded for (the automatic refresh on a new page load)
  bmFilter: null,                                    // { id, name } from the Businesses tab ("ad accounts of this business"); not saved
  open: new Set(), ads: {}, adsBusy: new Set(), adsHidden: new Set(),
  statsBusy: new Set(), noStats: new Set(), noAll: new Set(),   // per-ad numbers: being read / refused by Graph for this account / all-time part refused
});                                                  // (state.period, the spend period, is period.js's: the Businesses tab shares it)

// ---------- storage ----------
// Accounts, ads and which rows are open: kept across popup reopen and token changes, dropped when the FB user changes. The cache is
// registered by the shared loader (list-loader.js, below), which also takes over what another window of the extension loaded.
const saveView = () => saveSession({ view: { open: [...state.open], hidden: [...state.adsHidden] } });
// One account's ads share a rate slot (claimSlot); the account list has its own, "accounts".
const adsKey = (id) => `ads:${id}`;
// Accounts whose ads are being read by THIS window (the list, then the numbers): another window's copy of the saved ads must not replace an
// entry that is still being worked on (loadAdStats checks that the entry in state is the one it started with).
const flight = new Set();
const ownFlight = () => Object.fromEntries([...flight].filter((id) => state.ads[id]).map((id) => [id, state.ads[id]]));
onLoad(["autoPage"], (ses) => { state.autoPage = ses.autoPage || null; });

// Token changed: the per-token sets of the rows start empty (the account cache itself stays).
on("generation", () => {
  state.adsBusy = new Set(); state.statsBusy = new Set(); state.noStats = new Set(); state.noAll = new Set();
  renderAccounts();                                  // the empty state follows the token (no token, a dead one, a new one)
});
on("token-hint", () => renderAccounts());            // the Token tab's reason for having no token changed
on("token-dead", () => renderAccounts());
// The cached lists belonged to another FB user and are gone: draw the empty list.
on("cache-dropped", () => { state.bmFilter = null; renderAccounts(); });
// The Businesses tab asks for the ad accounts of one business ({ id, name }; null clears). It switches the tab itself (bus "show-tab").
on("filter-bm", (bm) => { state.bmFilter = bm?.id ? { id: String(bm.id), name: bm.name || "" } : null; renderAccounts(); });
// The spend period changed (on this tab or the Businesses tab): numbers, total and ads follow.
on("period", () => renderAccounts());
// Pictures were read (pictures.js): the logos of the group headers follow.
on("pictures", () => renderAccounts());
// Rate slots changed (this window or another): the ads buttons follow.
on("locks", () => syncAdsButtons());

// ---------- accounts ----------
// What a row keeps from Graph's answer (accounts-model.js slimWith: names cleaned, markers for a field Graph refused).
const slim = (a) => slimWith(state.skip)(a);

// me/adaccounts lists only the accounts assigned to the person. A BM admin also reads every account of the BM
// (owned + client) without being assigned to it (live-checked 2026-10-08: 20 BM accounts, 7 of them assigned), so the
// list adds those. Best effort: a business or an edge this token can't read is skipped, the rest of the list stays - and the answer says WHICH
// business it could not read (failedBms: only those lose their verdict on the Businesses tab and get the muted hint; the list is not "not all"
// for everybody because of one refused business). `truncated` stays for real limits: a cap, a page limit, a business list that could not be read.
// The walk is biz-edges.js: at most 50 businesses, 3 pages per edge, owned edges before client edges, over as soon as nothing more may go out, one skip set for the whole
// walk (a field one edge refused is not asked for again on the next: it is a copy of the assigned list's set, so what an unassigned account
// refuses never drops the field for the assigned list).
// These rows are marked _viaBm (not assigned to the person: "No access" + "Assign me" in the list); _bmId / _bmName is the business they were
// read through, whose settings page is where the person assigns themselves (for a client account that is not the owner business).
const BM_EDGES = ["owned_ad_accounts", "client_ad_accounts"];
const BM_EDGE_PAGES = 3;
async function readBmAccounts(gen, have) {
  const skip = new Set(state.skip);
  return readBusinessEdges({
    gen, edges: BM_EDGES,
    readEdge: async (path, bm) => {
      const r = await readPaged(path, { base: BASE_FIELDS, optional: OPTIONAL_FIELDS, skip, map: slimWith(skip), maxPages: BM_EDGE_PAGES });
      const rows = [];
      for (const a of r.rows) if (a.account_id && !have.has(a.account_id)) { have.add(a.account_id); rows.push({ ...a, _viaBm: true, _bmId: bm.id, _bmName: bm.name }); }
      return { rows, truncated: r.truncated };
    },
  });
}

// The list is loading / has finished: draw it, and tell the Businesses tab (its spend and counts come from this list; bus "accounts").
function setLoading(on) { state.accLoading = on; renderAccounts(); emit("accounts"); }
// The Accounts tab loads the list by itself when there is nothing loaded yet, or when the FB page the token came from was reloaded since
// the last load AND the list is older than 10 minutes (a reload of the page alone is no reason to spend a request). Reopening the popup or
// switching tabs alone never sends a request. At most one try per popup open; the limits are a click's (the one-minute slot, the API pause,
// a dead session).
const REFRESH_AFTER_MS = 10 * 60 * 1000;
const loader = listLoader({
  name: "accounts", button: "#loadAccounts", slotMs: MIN_REFRESH_MS, waitKey: "acc.wait",
  keys: ["accounts", "fetchedAt", "truncated", "failedBms", "ads", "view"],
  reset: () => Object.assign(state, { accounts: [], fetchedAt: 0, truncated: false, failedBms: [], open: new Set(), ads: {}, adsHidden: new Set() }),
  load: (ses, { live = false } = {}) => Object.assign(state, {
    accounts: ses.accounts || [], fetchedAt: ses.fetchedAt || 0, truncated: !!ses.truncated,
    failedBms: Array.isArray(ses.failedBms) ? ses.failedBms.filter((id) => typeof id === "string") : [],
    // another window's saved ads, except what this window is still reading itself; the open rows are this window's own view
    ads: { ...(ses.ads || {}), ...(live ? ownFlight() : {}) },
    ...(live ? {} : { open: new Set(ses.view?.open), adsHidden: new Set(ses.view?.hidden) }),
  }),
  has: () => !!state.fetchedAt,
  atKey: "fetchedAt", at: () => state.fetchedAt,
  followed: () => { renderAccounts(); emit("accounts"); },
  loading: setLoading,
  empty: () => !state.accounts.length,
  due: () => {
    if (!state.fetchedAt) return true;
    const page = state.tokenSource?.page || null;
    return !!page && page !== state.autoPage && Date.now() - state.fetchedAt > REFRESH_AFTER_MS;
  },
  read: async ({ gen }) => {
    // skip as a function: a token change swaps state.skip while the pages are still coming in.
    const mine = await readPaged("me/adaccounts", { base: BASE_FIELDS, optional: OPTIONAL_FIELDS, skip: () => state.skip, map: slim });
    if (gen !== state.gen) throw new Stale();
    const viaBm = await readBmAccounts(gen, new Set(mine.rows.map((a) => a.account_id)));
    // "Not all of it" for everybody: a limit was hit (`cut`: a cap, a page limit) or the business list itself was not readable (`listFailed`: no
    // business can be named). A business whose edge could not be read is NOT that: it is named in failedBms and only its own verdict is withheld.
    return { rows: [...mine.rows, ...viaBm.rows], cut: mine.truncated || viaBm.truncated, listFailed: viaBm.listFailed, failedBms: viaBm.failedBms, bmIds: viaBm.bmIds };
  },
  commit: async ({ rows, cut, listFailed, failedBms, bmIds }, { gen, auto, owner }) => {
    // Another user's list: their ads and open rows don't belong to this one.
    if (owner !== state.owner) Object.assign(state, { open: new Set(), ads: {}, adsHidden: new Set() });
    const truncated = cut || listFailed;
    Object.assign(state, { accounts: rows, fetchedAt: Date.now(), truncated, failedBms, owner });
    await saveSession({ accounts: rows, fetchedAt: state.fetchedAt, truncated, failedBms, owner, ads: adsToSave() });
    await saveView();
    // The logos of the group headers: the businesses of the profile that the Businesses tab has not listed (it asks for its own). Not awaited, silent.
    readPictures("business", groupLogoIds(rows, bmIds), gen);
    // The list itself is the answer to an automatic load; it only speaks up for a cut-off one (a failed read has its own message - a dead session, a
    // refused edge - and is said by a click, and always by the "not all" on the count line / the muted line under the list / the business's row).
    return !auto || cut
      ? t("acc.loaded", { n: rows.length }) + (cut ? t("acc.truncated") : "")
        + (listFailed ? t("acc.listFail") : failedBms.length ? t("acc.readFail", { n: failedBms.length, w: tn(failedBms.length, "acc.bizCount") }) : "")
      : null;
  },
  // A request went out: this FB page load has had its list (never written for a refusal made before the network).
  sent: ({ gen }) => { if (gen === state.gen) { state.autoPage = state.tokenSource?.page || null; saveSession({ autoPage: state.autoPage }); } },
});
export const ensureAccounts = loader.ensure;               // the Businesses tab asks for the same list on its first visit (same rule and limits)
// The Businesses tab's refresh button also refreshes this list (its spend and counts come from it). Silent where a click on this tab would
// complain; → { wait } when the one-minute slot is taken, so the Businesses tab can say so in its own words.
export const reloadAccounts = () => loader.load({ auto: true });

// ---------- what a row says ----------
// Spend for the selected period (spend.js: the Businesses tab reads the same numbers the same way). null = unknown.
const statsOf = (a, key = state.period) => spendStats(a, key, state.fetchedAt);
const periodRange = () => rangeOf(state.accounts, state.period, state.fetchedAt);
// accountState is pure over the account object, which is never changed after a load: one answer per object.
const memo = new WeakMap();
const stateOf = (a) => { let s = memo.get(a); if (!s) memo.set(a, s = accountState(a)); return s; };
// Which rows the search + status chip + business filter leave, the chips, "Active IDs" and the groups are accounts-model.js (pure, tested in Node).
const underBmFilter = () => underFilter(state.accounts, state.bmFilter?.id ?? null);
const visibleRows = () => visibleAccounts(state.accounts, { filter: state.filter, statusFilter: state.statusFilter, bmId: state.bmFilter?.id ?? null }, stateOf);
const isFiltered = () => !!(state.filter.trim() || state.statusFilter || state.bmFilter);
function copyLiveIds() {
  const ids = liveIds(visibleRows());
  if (!ids.length) return toast(t("acc.noLive"), true);
  copy(ids.join("\n"), t("acc.idsCopied", { n: ids.length }) + (state.truncated ? t("acc.partial") : ""));
}

function renderHint() {
  const total = $("#accountsTotal");
  refreshTip($("#loadAccounts"), t("refresh"), state.fetchedAt);          // "Refresh · updated 3 min ago"
  if (!state.fetchedAt) return fill(total);
  const all = state.accounts.length, rows = visibleRows(), n = rows.length;
  // The count only when a search / filter is on ("3 of 10 found"); an incomplete list always says so.
  const metaText = `${isFiltered() ? t("acc.found", { n, all }) : ""}${state.truncated ? t("acc.notAll") : ""}`.trim();
  if (!n) return fill(total, metaText ? el("span", { class: "total-meta alone" }, metaText) : null);       // no rows: nothing to add up, only what the filter found
  // Row 1: what the number is (left: "Spend · Aug 29") + the filter count (right). Row 2: the number.
  fillTotal(total, { metaText, range: state.period === "all" ? "" : periodRange(), zeroCur: rows[0].currency,
    sum: addUp(rows.map((a) => ({ spend: statsOf(a)?.spend ?? null, currency: a.currency }))) });
}

// Rows are ordered by the USD value of their spend, so two or more currencies on screen need the rates: asked for here (one shared
// lookup: cached for a day, no repeat after a failure), and the list is drawn once more when a table arrives that the last draw did not use.
let usedRates = null;
function wantRates(rows) {
  if (new Set(rows.map((a) => a.currency || "USD")).size < 2 || !isShown($("#tab-accounts"))) return;   // only for a list that is on screen (showing the tab draws it again)
  rates().then((r) => { if ((r?.rates ?? null) !== usedRates) renderAccounts(); });
}

function renderAccounts() { keepFocus(drawAccounts); }
function drawAccounts() {
  const list = $("#accountsList");
  // The period, the total and "Active IDs" mean something only next to rows: while there are none (loading, no token, an error, an empty list) the
  // tab shows the search, the refresh and one calm state.
  const any = state.accounts.length > 0;
  for (const sel of ["#periodSeg", "#accountsTotal", "#copyLiveIds"]) $(sel).classList.toggle("hidden", !any);
  renderHint();
  $("#copyLiveIds").disabled = !state.accounts.some(isLive);
  // The chips count the rows the business filter leaves (not the search or the chip itself: the other chips must stay to switch to).
  const counts = chipCounts(state.accounts, state.bmFilter?.id ?? null, stateOf);
  if (state.statusFilter && !counts.has(state.statusFilter)) state.statusFilter = null;
  // A status filter is only useful when statuses differ; with one status it just repeats the count.
  if (counts.size < 2) { state.statusFilter = null; counts.clear(); }
  // The BM filter (set from the BM tab) comes first as its own chip; clicking it clears it.
  const bm = state.bmFilter;
  // A chip's accessible name is "Active: 12" (the text alone would read "Active 12"); the business chip names what pressing it does.
  fill($("#statusChips"), bm ? el("button", { type: "button", class: "pill chip on", "aria-pressed": "true", "data-focus": "chip:bm", title: t("acc.bmFilterClear"),
      "aria-label": `${bm.name || bm.id}: ${t("acc.bmFilterClear")}`, onclick: () => { state.bmFilter = null; renderAccounts(); } }, el("i", { class: "i i-bm", "aria-hidden": "true" }), `${bm.name || bm.id} ✕`) : null,
  ...chipsInOrder(counts).map(({ chip, n }) => {
    const on = state.statusFilter === chip.id;
    return el("button", { type: "button", class: `pill chip ${chip.tone}${on ? " on" : ""}`, "aria-pressed": String(on), "data-focus": `chip:${chip.id}`, "aria-label": `${word(chip)}: ${n}`,
      onclick: () => { state.statusFilter = on ? null : chip.id; renderAccounts(); } }, `${word(chip)} ${n}`);
  }));
  scrollFade($("#statusChips"));
  const rows = visibleRows();
  if (!any) return fill(list, emptyView({ tab: "accounts", loaded: !!state.fetchedAt, loading: state.accLoading, none: t("acc.none"), loadingText: t("acc.loading"), retry: () => loader.retry() }));
  if (!rows.length) return fill(list, listNote("accounts"), el("div", { class: "empty" }, t("acc.noMatch")));

  // Groups by business, the biggest spender first, the accounts inside a group by state and spend (accounts-model.js groupAccounts). Stats once
  // per row: the comparators would otherwise recompute them O(n log n) times.
  const r = cachedRates();
  usedRates = r?.rates ?? null;
  const stats = new Map(rows.map((a) => [a, statsOf(a)]));
  const groups = groupAccounts(rows, stats, r, getLang(), stateOf);
  // No header while one business is filtered (it would repeat the chip), nor above a list that is all personal (it would repeat the total).
  const headers = !state.bmFilter && !(groups.length === 1 && groups[0].id === null);
  // A business that could not be read: its accounts may be missing. One muted line, only when it concerns what is on screen (the business filter
  // names one business; without it, any).
  const unread = state.bmFilter ? state.failedBms.includes(state.bmFilter.id) : state.failedBms.length > 0;
  fill(list, listNote("accounts"), ...groups.flatMap((g) => [headers ? groupEl(g, r) : null, ...g.accounts.map((a) => renderAccount(a, stats.get(a), r))]),
    unread ? el("div", { class: "acc-foot" }, t("acc.bmHint")) : null);
  wantRates(rows);
}

// [16 px picture] Business · 3 ........ subtotal. A personal group gets a user icon on a circle instead of a building.
function groupEl(g, r) {
  const personal = g.id === null;
  const line = rowAmount(g.sum.totals, r);
  const unknown = g.sum.unknown;
  const value = line.text || (unknown ? "—" : fmtMoney(0, g.accounts[0].currency));            // text: the same "+N" cut as a business row, never a line wider than the header
  const title = [line.title || (line.text !== line.full ? line.full : ""), unknown ? t(line.main ? "acc.notAllTitle" : "acc.noPeriod") : ""].filter(Boolean).join("\n") || null;
  // The business's own picture, wherever it is known: the Businesses list (state.bms: its logo is only a URL imageUrl() accepted) or the pictures read (pictures.js).
  const logo = personal ? null : picturesOf("business", g.id, state.bms?.find((b) => b?.id === g.id)?.profile_picture_uri);
  // A business Meta restricted (bms-model.js restrictedOf: an account it owns is disabled for "Business integrity") says so after the count.
  const status = !personal && restrictedOf(g.accounts) ? { text: t("bms.st.restricted"), tone: "bad", title: t("bms.st.restricted.title") } : null;
  const h = groupHeader({ avatar: { kind: personal ? "page" : "business", url: logo }, name: personal ? t("acc.personal") : g.name || g.id,
    count: g.accounts.length, status, value, valueTitle: title });
  if (personal) h.querySelector(".lav .i")?.classList.replace("i-flag", "i-user");
  return h;
}

function renderAccount(a, st, r) {
  const s = stateOf(a), id = a.account_id;
  const name = a.name || t("acc.noName");
  const v = valueOf(a, st, r);
  return row({
    key: id, name, value: v.text, valueTitle: v.title, valueMuted: v.muted,
    status: { tone: s.tone, text: word(s.word), title: s.title ? s.title.map((k) => t(k)).join(": ") : null },
    fix: s.fix && { label: s.fix.label, url: s.fix.url, tip: s.help ? t(s.help) : null }, more: s.more,
    id: { value: id, copiedMsg: t("acc.idCopied") },
    open: state.open.has(id),
    onToggle: (open) => { state.open[open ? "add" : "delete"](id); saveView(); },
    body: () => accountBody(a, s, st, name),
  });
}

// The expanded body: the facts (only the ones Graph gave), what to do, the two places to open, then the ads. Built when the row opens.
function accountBody(a, s, st, name) {
  const id = a.account_id, cur = a.currency;
  const n = numFmt();
  const money = (minor) => (minor === undefined || minor === null || minor === "" ? "—" : fmtMoney(major(minor, cur), cur));
  const threshold = a.adspaymentcycle?.data?.[0]?.threshold_amount;
  const dsl = a.adtrust_dsl;
  const pixels = a.adspixels?.data;
  const funding = a.funding_source_details?.display_string || "—";
  const pixelText = pixels?.length ? pixels.map((p) => p.id).join(", ") : "";   // the pixel ID only: the name adds nothing a tool needs, and one line stays one line
  const showClicks = st && st.imp !== null && (st.imp || st.clicks);
  // Long values take a row of their own in the two-column layout; short ones sit beside their neighbour.
  const long = (text) => (String(text).length > 24 ? { wide: true } : undefined);
  const places = [{ id: "ads", label: "next.adsManager", url: LINKS.adsManager(id) }, { id: "billing", label: "next.billing", url: LINKS.billing(id) }];
  const box = el("div", { class: "ads", "data-ads-box": id });
  // ONE muted line for the small facts that are not worth a pair each: "UTC+3 Kiev · US · created 04.03.2025" (only what Graph gave).
  const facts = [tzLabel(a.timezone_name), a.business_country_code, a.created_time && fullDate(a.created_time) ? t("acc.createdOn", { d: fullDate(a.created_time) }) : ""].filter(Boolean).join(" · ");
  const parts = [
    kv([
      // The period's numbers first: "Clicks · CPC  310 · 4,00 $" (the impressions are its tooltip); then the account's own: spent, to pay, threshold, limits, payment.
      showClicks ? [t("acc.clicksCpc"), st.clicks ? `${n.format(st.clicks)} · ${fmtMoney(st.spend / st.clicks, cur)}` : n.format(st.clicks), `${n.format(st.imp)} ${tn(st.imp, "ads.imp")}`] : null,
      [t("acc.spent"), fmtMoney(statsOf(a, "all").spend, cur)],                                  // same number as the "All time" period
      [t("acc.balance"), money(a.balance)],
      [t("acc.threshold"), money(threshold)],
      [t("acc.daily"), dsl === undefined ? "—" : Number(dsl) < 0 ? t("acc.noLimit") : fmtMoney(Number(dsl), cur)],
      Number(a.spend_cap || 0) ? [t("acc.spendCap"), money(a.spend_cap)] : null,                // only when one is set
      [t("acc.funding"), funding, long(funding)],
      [t("acc.pixels"), a._noPixels ? "—" : pixelText || el("span", { class: "acc-warn" }, t("acc.no")), long(pixelText)],
    ]),
    // What to do: the help line and every step (the one on line 2 included) except the two places the footer line has.
    whatToDo({ help: s.help ? t(s.help) : null, actions: s.actions, skip: places, tone: s.tone === "ok" ? "" : s.tone, owner: name, focus: `todo:${id}` }),
    // ONE muted footer line: the small facts, then the two places to open ("UTC+3 Kiev · US · created 04.03.2025 · Ads Manager ↗ · Billing ↗").
    el("div", { class: "acc-foot-line" }, facts ? el("span", { class: "lrow-meta" }, facts) : null, linksRow(places, { owner: name, focus: `link:${id}` })),
    // The ads: one grey card (as before the redesign). Its header is the same before the first load, collapsed and open: toggling only adds or removes the list below.
    el("div", { class: "ads-sec" }, adsControls(id), box),
  ];
  if (state.ads[id]) renderAds(box, state.ads[id], a);
  return parts;
}

// ---------- ads ----------
const adsBlocked = (id) => state.adsBusy.has(id) || slotLeft(adsKey(id)) > 0;
// Buttons are looked up by account id each time: a re-render replaces the nodes.
function syncAdsButtons() {
  for (const b of $$("[data-ads]")) b.disabled = adsBlocked(b.dataset.ads);
}
const adsBox = (id) => document.querySelector(`[data-ads-box="${CSS.escape(id)}"]`);
// Only successful reads are kept across popup reopens: an error text would sit on the row long after it is stale.
const adsToSave = () => Object.fromEntries(Object.entries(state.ads).filter(([, v]) => !v.error).map(([k, { stale, statsFail, ...v }]) => [k, v]));
// The section's header row. Before the first load: "Ads" (loads them). After: "Ads · N", a show/hide toggle (no request,
// uses the cached list), and a refresh icon that re-reads this account's ads (the only control bound to the 30 s lock;
// the button above the list refreshes the accounts only, so the ads cost nothing unless asked).
function adsControls(id) {
  const data = state.ads[id];
  if (!data) return el("div", { class: "ads-head" }, el("button", { type: "button", class: "ads-toggle", "data-ads": id, "data-focus": `ads:${id}`,
    disabled: adsBlocked(id), onclick: () => loadAds(id) }, el("i", { class: "i i-chevron" }), t("ads.btn")));
  const hidden = state.adsHidden.has(id);
  return el("div", { class: "ads-head" },
    el("button", { type: "button", class: "ads-toggle", "aria-expanded": String(!hidden), "data-focus": `adsToggle:${id}`, onclick: () => {
      state.adsHidden[hidden ? "delete" : "add"](id); saveView(); renderAccounts();
    } }, el("i", { class: `i i-chevron${hidden ? "" : " up"}` }), `${t("ads.btn")}${data.error ? "" : ` · ${data.ads?.length || 0}`}`),
    el("button", { type: "button", class: "ads-refresh", "data-ads": id, "data-focus": `ads:${id}`, disabled: adsBlocked(id), title: t("ads.refresh"),
                   "aria-label": t("ads.refresh"), onclick: () => loadAds(id) }, el("i", { class: "i i-refresh" })));
}
// "$12.40 · 3,100 impressions · 48 clicks". An active ad with no delivery says so; a paused one stays quiet.
// s = [spend, impressions, clicks] as stored, or null = unknown.
function adStatsLine(s, status, cur) {
  if (!s) return null;
  const [spend, imp, clicks] = s;
  if (!spend && !imp && !clicks) return status === "ACTIVE" ? el("div", { class: "ad-stats" }, t("ads.noDelivery")) : null;
  const n = numFmt();
  return el("div", { class: "ad-stats" }, fmtMoney(spend, cur), " · ", n.format(imp), ` ${tn(imp, "ads.imp")} · `, n.format(clicks), ` ${tn(clicks, "ads.clk")}`,
    clicks ? [" · CPC ", fmtMoney(spend / clicks, cur)] : null);
}
// An ad's status: a dot and a word in the status colour, the grammar of a row; an active ad says nothing on screen (the summary counts them).
const adStatus = (label, tone) => (tone === "ok" ? el("span", { class: "sr-only" }, label)
  : el("span", { class: `lrow-status ${tone}` }, el("i", { class: "lrow-dot", "aria-hidden": "true" }), el("span", { class: "lrow-status-text" }, label)));
function renderAds(box, { ads, more, error, stale, stats, statsAt, statsAll, statsFail }, acc) {
  if (!box) return;
  const id = box.dataset.adsBox;
  if (state.adsHidden.has(id)) return fill(box);
  if (error) return fill(box, el("div", { class: "hint err-text" }, error));
  if (!ads.length) return fill(box, el("div", { class: "hint" }, t("ads.none")));
  const count = (st) => ads.filter((ad) => st.includes(ad.effective_status)).length;
  const live = count(["ACTIVE"]), rejected = count(AD_PROBLEMS);
  // Numbers of the selected period. They come from a second read (after the list is on screen), so they may be
  // loading, refused, or from an earlier day. One hint says which.
  const all = state.period === "all";
  const alias = all ? AD_ALL : PERIODS.find((p) => p.key === state.period).alias;
  const fresh = !!stats && sameDay(acc?.timezone_name, statsAt);
  const shown = fresh && (!all || !!statsAll);
  const hint = statsFail ? t("ads.statsFail") : state.statsBusy.has(id) ? t("ads.statsLoading")
    : !stats ? "" : !fresh ? t("ads.old") : all && !statsAll ? t("ads.noAll") : "";
  fill(box, el("div", { class: "ads-sum" },
      `${ads.length}${more ? "+" : ""} ${tnPlus(ads.length, "ads.count", more)}`,
      live ? t("ads.live", { n: live }) : "", rejected ? el("span", { class: "err-text" }, t("ads.rejected", { n: rejected })) : "",
      shown ? t("ads.statsAt", { a: ago(statsAt) }) : ""),
    stale ? el("div", { class: "hint err-text" }, t("ads.stale", { m: stale })) : null,
    hint ? el("div", { class: "hint" }, hint) : null,
    // Disapproved / with issues first, each with every reason and the placement it applies to.
    ...[...ads].sort((a, b) => adRank(a.effective_status) - adRank(b.effective_status)).map((ad) => {
    const st = ad.effective_status;
    const [l, tone] = st in AD_STATUS ? [t(`ad.${st}`), AD_STATUS[st]] : [humanEnum(st), ""];     // a status of the future: plain words, not a raw constant
    const why = reviewLines(ad), steps = adSteps(ad, id);
    return el("div", { class: "ad" }, el("span", { class: "ad-name", dir: "auto" }, ad.name), adStatus(l, tone),
      shown ? adStatsLine(stats[ad.id]?.[alias] ?? null, st, acc?.currency) : null,
      why.length ? el("small", {}, why.map((line) => el("span", { class: "why" }, line))) : null,
      // Rejected ad: ask for a review / open it in Ads Manager (links only), in the style of a row's fix link.
      steps.length ? el("div", { class: "ad-acts" }, steps.map((x) => fixLink(x, { tone: x.primary ? "bad" : "", owner: ad.name, focus: `adact:${ad.id}:${x.id}`, cls: "ad-act" }))) : null);
  }), ...(more ? [el("div", { class: "hint" }, t("ads.more", { n: ads.length }))] : []));
}
// The ads edge of an account. The id came from Graph: only digits go into a path (graph.js checks the shape of the whole path too).
const adsPath = (id) => {
  const d = digitsId(id);
  if (!d) throw new Error(t("err.path"));
  return `act_${d}/ads`;
};
const cleanAd = (ad) => ({ ...ad, name: cleanText(ad?.name) });         // an ad's name is somebody else's text like any other
// One GET of an account's ads. issues_info (the reason for "with issues") is optional like the account fields:
// if Graph rejects it, the call is repeated once without it.
async function readAds(id, extra = {}) {
  for (;;) {
    const fields = `id,name,effective_status,ad_review_feedback${state.skip.has("issues_info") ? "" : ",issues_info"}`;
    try { return await graph(adsPath(id), { fields, limit: "100", ...extra }); }
    catch (e) {
      if (e instanceof Stale || state.skip.has("issues_info") || !(e.raw || e.message || "").includes("issues_info")) throw e;
      state.skip.add("issues_info");
    }
  }
}
// The numbers per ad (every period), read AFTER the list is on screen: a heavy, slow or refused statistics read
// costs only the numbers, never the list. Stored compact: { adId: { p_today: [spend, impressions, clicks] | null } }
// (null = spend unknown; an ad Graph returned without a period key had no delivery = zeros).
// The first 100 ads only. The all-time part ("maximum") is the heaviest: if Graph refuses ("reduce the amount of
// data", or the field) it is dropped for this account and the other periods are read again; a refusal of the rest
// is remembered for the account too (never asked again until the token changes).
const readStats = (id, withAll) => graph(adsPath(id), { fields: `id,${PERIOD_INSIGHTS}${withAll ? `,${AD_ALL_INSIGHTS}` : ""}`, limit: "100" });
const refused = (e) => e.code === 1 || e.code === 100;
async function loadAdStats(id, gen, entry) {
  if (state.noStats.has(id) || gen !== state.gen) return;
  state.statsBusy.add(id); renderAccounts();
  let patch, withAll = !state.noAll.has(id);
  try {
    let res;
    try { res = await readStats(id, withAll); }
    catch (e) {
      if (e instanceof Stale || !withAll || !refused(e)) throw e;
      state.noAll.add(id); withAll = false;
      res = await readStats(id, false);
    }
    if (!Array.isArray(res.data)) throw new Error(t("err.noData"));
    const stats = {};
    for (const row of res.data) stats[row.id] = Object.fromEntries(AD_ALIASES.filter((a) => withAll || a !== AD_ALL).map((a) => {
      const r = insightRow(row[a]);
      return [a, r && [r.spend, r.imp, r.clicks]];
    }));
    patch = { stats, statsAt: Date.now(), statsAll: withAll, statsFail: undefined };
  } catch (e) {
    if (e instanceof Stale) { renderAccounts(); return; }   // a newer token owns the sets now; drop our "Loading numbers…"
    if (refused(e)) state.noStats.add(id);
    patch = { statsFail: true };
  }
  state.statsBusy.delete(id);
  if (gen === state.gen && state.ads[id] === entry) state.ads[id] = { ...entry, ...patch };
  await saveSession({ ads: adsToSave() });
  renderAccounts();
}
// The list on screen stays while it is re-read (nothing jumps); the icon is disabled meanwhile.
async function loadAds(id) {
  if (!digitsId(id) || state.adsBusy.has(id)) return;  // an id that is not digits never goes into a path
  await settledGrab();
  if (!state.token && !(await grabToken({ toClipboard: false }))) return;
  if (isDead()) return toast(t("err.session", { c: deadCode() }), true);
  const pause = pauseNote();
  if (pause) return toast(pause, true);                // before the slot: a refused attempt must not burn the 30 s
  if (state.adsBusy.has(id)) return;                  // a second click that waited for the same grab
  const gen = state.gen, busy = state.adsBusy;        // fixed before waiting for the lock
  busy.add(id);
  syncAdsButtons();
  let wait;
  try { wait = await claimSlot(adsKey(id), ADS_LOCK_MS); }
  catch (e) { busy.delete(id); syncAdsButtons(); return toast(t("err.slot", { m: e.message }), true); }
  if (gen !== state.gen) { busy.delete(id); return; } // new token while waiting: old account list
  if (wait > 0) {
    busy.delete(id); syncAdsButtons();
    return toast(t("ads.wait"), true);
  }
  syncAdsButtons();
  setTimeout(syncAdsButtons, ADS_LOCK_MS + 50);
  flight.add(id);                                     // until the numbers are in: another window's saved ads must not replace this entry
  try { await readAndShowAds(id, gen, busy); } finally { flight.delete(id); }
}
async function readAndShowAds(id, gen, busy) {
  const box = adsBox(id);
  if (box && (!state.ads[id] || state.ads[id].error)) fill(box, el("div", { class: "hint" }, t("ads.loading")));
  let entry = null;
  try {
    const res = await readAds(id);
    if (!Array.isArray(res.data)) throw new Error(t("err.noData"));
    let list = res.data.map(cleanAd);
    if (res.paging?.next) {
      // More than one page: the ads that need attention must not hide behind the first 100.
      try {
        const bad = await readAds(id, { effective_status: JSON.stringify(AD_PROBLEMS) });
        const have = new Set(list.map((a) => a.id));
        if (Array.isArray(bad.data)) list = list.concat(bad.data.filter((a) => !have.has(a.id)).map(cleanAd));
      } catch (e) {
        if (e instanceof Stale) throw e;
        toast(e.message, true);                        // the first page is still worth showing
      }
    }
    const prev = state.ads[id];                         // the earlier numbers stay (dated) until the new ones arrive
    state.ads[id] = entry = { ads: list, more: !!res.paging?.next, stats: prev?.stats, statsAt: prev?.statsAt, statsAll: prev?.statsAll };
  } catch (e) {
    if (e instanceof Stale) { renderAccounts(); return; }   // our "Loading ads…" must not outlive the token it was for
    // A failed refresh must not wipe the list you already have (a pause, a dead session, a timeout),
    // but the row says the list is old.
    const prev = state.ads[id];
    if (prev && !prev.error) { state.ads[id] = { ...prev, stale: e.message }; toast(e.message, true); }
    else state.ads[id] = { ads: [], error: e.message };
  } finally {
    busy.delete(id);                                    // our generation's set, not a newer one's
    syncAdsButtons();
  }
  state.adsHidden.delete(id);                           // a fresh load is shown expanded
  await Promise.all([saveSession({ ads: adsToSave() }), saveView()]);   // never rejects (state.js); awaited so the next step sees it stored
  renderAccounts();
  if (entry) await loadAdStats(id, gen, entry);        // the list is on screen; the numbers follow
}

// ---------- wiring ----------
// Re-render rows only when some account's "today" goes stale (its day rolled over).
const todaySig = () => state.accounts.map((a) => (statsOf(a, "today") ? 1 : 0)).join("");
let sig = "";

// Showing the tab starts the auto-load.
// Showing the tab draws it again: a total or an order that wanted rates while the tab was hidden asks for them now.
registerTab("accounts", { onShow: () => { renderAccounts(); ensureAccounts(); } });
// RU · EN: every word on the rows comes from keys, so a redraw from state is all it takes.
registerRender(() => renderAccounts());
registerRender(() => {
  syncAdsButtons();
  const now = todaySig();
  if (now !== sig) { sig = now; renderAccounts(); } else renderHint();
}, { lang: false, tick: true });
registerInit(() => {
  bindPeriods($("#periodSeg"));                           // the saved period was read by period.js's own init, which ran first
  $("#loadAccounts").addEventListener("click", () => loader.load());
  $("#copyLiveIds").addEventListener("click", copyLiveIds);
  $("#accountFilter").addEventListener("input", (e) => { state.filter = e.target.value; renderAccounts(); });
});
registerStart(() => { renderAccounts(); sig = todaySig(); });
