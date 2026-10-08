// The Ad accounts tab: the account list (one paged read, optional fields, spend periods) and each account's ads
// (list, then the per-ad numbers). Accounts and ads live in one file on purpose: a row draws its ads card and an ads
// read redraws the row, so splitting them would make the two import each other.

import { t, tn, has } from "./i18n.js";
import { AD_PROBLEMS, adRank, reviewLines, spendFloor, insightRow } from "./pure.js";
import { $, $$, el, fill, pill, numEl, toast, copy, keepFocus } from "./dom.js";
import { fmt, money, numFmt, ago, sameDay, tzLabel } from "./format.js";
import { state, Stale, saveSession, fbUser, claimSlot, slotLeft, registerCache, isDead, deadCode } from "./state.js";
import { graph, readPaged } from "./graph.js";
import { settledGrab, grabToken, tokenReady } from "./token.js";
import { on, emit } from "./bus.js";
import { accountSteps, adSteps } from "./nextsteps.js";
import { actLink } from "./rows.js";
import { PERIODS, statsOf as spendStats, periodRange as rangeOf, addUp } from "./spend.js";
import { bindPeriods, fillTotal, refreshTip } from "./period.js";
import "./strings/actions.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";

const MIN_REFRESH_MS = 60 * 1000;            // accounts: one attempt per minute (failed attempts count too)
const ADS_LOCK_MS = 30 * 1000;               // ads: one read per account per 30 s
const BASE_FIELDS = ["name", "account_id", "account_status", "disable_reason", "currency", "timezone_name",
  "amount_spent", "balance", "spend_cap", "created_time", "business{id,name}",
  "business_country_code"];
// All periods in one request via field aliases (live-checked 2026-09-27). Used by the accounts read and by the
// per-ad numbers, so switching the period never needs a request.
const insightsOf = (preset, alias) => `insights.date_preset(${preset}).as(${alias}){spend,impressions,inline_link_clicks}`;
const PERIOD_INSIGHTS = PERIODS.filter((p) => p.alias).map((p) => insightsOf(p.preset, p.alias)).join(",");
// Per ad only: "All time" = Graph's date_preset=maximum (Meta keeps at most 37 months; documented, replaced "lifetime" in v10).
// Accounts use their amount_spent field for it, which has no per-ad twin. Kept apart because it is the heaviest read.
const AD_ALL = "p_all";
const AD_ALL_INSIGHTS = insightsOf("maximum", AD_ALL);
const AD_ALIASES = [...PERIODS.filter((p) => p.alias).map((p) => p.alias), AD_ALL];
// Extras that some tokens can't read. On a field error only the named one is dropped and the page retried.
// Today's spend rides on the same call (date_preset=today = each account's own timezone).
const OPTIONAL_FIELDS = {
  funding_source_details: "funding_source_details",
  adtrust_dsl: "adtrust_dsl",
  adspaymentcycle: "adspaymentcycle{threshold_amount}",
  adspixels: "adspixels{id,name}",
  insights: PERIOD_INSIGHTS,
};
// Tone per Meta status code; the label is t("status.<code>") / t("ad.<status>"), disable reasons t("reason.<n>").
const ACCOUNT_STATUS = { 1: "ok", 2: "bad", 3: "warn", 7: "warn", 8: "warn", 9: "warn", 100: "bad", 101: "bad" };
const AD_STATUS = {
  ACTIVE: "ok", PAUSED: "", PENDING_REVIEW: "warn", IN_PROCESS: "warn", DISAPPROVED: "bad", WITH_ISSUES: "bad",
  CAMPAIGN_PAUSED: "", ADSET_PAUSED: "", PREAPPROVED: "warn", PENDING_BILLING_INFO: "warn", DELETED: "", ARCHIVED: "",
};

Object.assign(state, {
  accounts: [], fetchedAt: 0, truncated: false, filter: "", statusFilter: null, accLoading: false,
  bmFilter: null,                                    // { id, name } from the Businesses tab ("ad accounts of this business"); not saved
  open: new Set(), ads: {}, adsBusy: new Set(), adsHidden: new Set(),
  statsBusy: new Set(), noStats: new Set(), noAll: new Set(),   // per-ad numbers: being read / refused by Graph for this account / all-time part refused
});                                                  // (state.period, the spend period, is period.js's: the Businesses tab shares it)

// ---------- storage ----------
// Accounts, ads and which rows are open: kept across popup reopen and token changes, dropped when the FB user changes.
registerCache(["accounts", "fetchedAt", "truncated", "ads", "view"],
  () => Object.assign(state, { accounts: [], fetchedAt: 0, truncated: false, open: new Set(), ads: {}, adsHidden: new Set() }),
  {
    load: (ses) => Object.assign(state, {
      accounts: ses.accounts || [], fetchedAt: ses.fetchedAt || 0, truncated: !!ses.truncated,
      ads: ses.ads || {}, open: new Set(ses.view?.open), adsHidden: new Set(ses.view?.hidden),
    }),
    has: () => !!state.fetchedAt,
  });
const saveView = () => saveSession({ view: { open: [...state.open], hidden: [...state.adsHidden] } });
// One account's ads share a rate slot (claimSlot); the account list has its own, "accounts".
const adsKey = (id) => `ads:${id}`;

// Token changed: the per-token sets of the rows start empty (the account cache itself stays).
on("generation", () => {
  state.adsBusy = new Set(); state.statsBusy = new Set(); state.noStats = new Set(); state.noAll = new Set();
});
// The cached lists belonged to another FB user and are gone: draw the empty list.
on("cache-dropped", () => { state.bmFilter = null; renderAccounts(); });
// The Businesses tab asks for the ad accounts of one business ({ id, name }; null clears). It switches the tab itself (bus "show-tab").
on("filter-bm", (bm) => { state.bmFilter = bm?.id ? { id: String(bm.id), name: bm.name || "" } : null; renderAccounts(); });
// The spend period changed (on this tab or the Businesses tab): numbers, total and ads follow.
on("period", () => renderAccounts());
// Rate slots changed (this window or another): the ads buttons follow.
on("locks", () => syncAdsButtons());
// Accounts loaded or dropped in another window of this extension: show the same list.
on("session", (ch) => {
  if (ch.fetchedAt && (ch.fetchedAt.newValue || 0) !== state.fetchedAt) {
    chrome.storage.session.get(["accounts", "fetchedAt", "truncated", "owner", "ads"]).then((c) => {
      Object.assign(state, { accounts: c.accounts || [], fetchedAt: c.fetchedAt || 0, truncated: !!c.truncated,
        owner: c.owner || null, ads: c.ads || {} });
      renderAccounts();
      emit("accounts");
    });
  }
});

// ---------- accounts ----------
// Mark rows fetched without an optional field (spend = unknown, not 0; pixels = unknown, not none)
// and keep only the display string of the funding source.
// _floor: what the insights already prove was spent (today + last 30 days), kept for the "All time" figure.
const spendOfRow = (x) => Number(x?.data?.[0]?.spend);
const slimWith = (skip) => (a) => ({ ...a, _noInsights: skip.has("insights") || undefined,
  _floor: skip.has("insights") ? undefined : spendFloor(spendOfRow(a.p_today), spendOfRow(a.p_month)),
  _noPixels: skip.has("adspixels") || undefined,
  funding_source_details: a.funding_source_details ? { display_string: a.funding_source_details.display_string } : undefined });
const slim = (a) => slimWith(state.skip)(a);

// me/adaccounts lists only the accounts assigned to the person. A BM admin also reads every account of the BM
// (owned + client) without being assigned to it (live-checked 2026-10-08: 20 BM accounts, 7 of them assigned), so the
// list adds those. Best effort: a BM or an edge this token can't read is skipped, the rest of the list stays.
// Own skip set per edge read: a field refused on an unassigned account must not drop it for the assigned list too.
const BM_EDGES = ["owned_ad_accounts", "client_ad_accounts"];
async function readBmAccounts(have) {
  let bms;
  try { bms = await graph("me/businesses", { fields: "id,name", limit: "100" }); }
  catch (e) { if (e instanceof Stale) throw e; return { rows: [], truncated: false }; }
  const rows = [];
  let truncated = false;
  for (const bm of Array.isArray(bms?.data) ? bms.data.filter((b) => /^\d{1,25}$/.test(String(b?.id ?? ""))) : []) {
    for (const edge of BM_EDGES) {
      const skip = new Set(state.skip);
      try {
        const r = await readPaged(`${bm.id}/${edge}`, { base: BASE_FIELDS, optional: OPTIONAL_FIELDS, skip, map: slimWith(skip) });
        for (const a of r.rows) if (a.account_id && !have.has(a.account_id)) { have.add(a.account_id); rows.push(a); }
        truncated ||= r.truncated;
      } catch (e) { if (e instanceof Stale) throw e; }
    }
  }
  return { rows, truncated };
}

// auto: started by opening the Accounts tab, not by a click. Same limits as a click, but silent where a click
// would only complain (no token, dead session, the one-minute slot): the empty list explains itself.
// The list is loading / has finished: draw it, and tell the Businesses tab (its spend and counts come from this list; bus "accounts").
function setLoading(on) { state.accLoading = on; renderAccounts(); emit("accounts"); }
let accBusy = false;                                    // one list load at a time: a click during an automatic load is a no-op
async function fetchAccounts(opts) {
  if (accBusy) return;
  accBusy = true;
  try { await loadAccountsNow(opts); } finally { accBusy = false; }
}
async function loadAccountsNow({ auto = false } = {}) {
  await settledGrab();
  if (!state.token && !(await grabToken({ toClipboard: false, silent: auto }))) return;   // no token: grabToken says why
  if (isDead()) return auto ? undefined : toast(t("err.session", { c: deadCode() }), true);   // before the slot: costs nothing
  const gen = state.gen;                              // fixed before waiting for the lock
  let wait;
  try { wait = await claimSlot("accounts", MIN_REFRESH_MS); }        // before sending: a failed attempt counts too
  catch (e) { return auto ? undefined : toast(t("err.slot", { m: e.message }), true); }
  if (gen !== state.gen) return;                      // new token while waiting
  if (wait > 0) return auto ? undefined : toast(t("acc.wait", { n: Math.ceil(wait / 1000) }), true);
  // The request goes out now (a failure counts too): this FB page load has had its list.
  saveSession({ autoPage: state.tokenSource?.page || null });
  const btn = $("#loadAccounts");
  btn.disabled = true; btn.setAttribute("aria-busy", "true");
  setLoading(true);
  try {
    // skip as a function: a token change swaps state.skip while the pages are still coming in.
    const mine = await readPaged("me/adaccounts", { base: BASE_FIELDS, optional: OPTIONAL_FIELDS, skip: () => state.skip, map: slim });
    if (gen !== state.gen) return;
    const viaBm = await readBmAccounts(new Set(mine.rows.map((a) => a.account_id)));
    if (gen !== state.gen) return;
    const rows = [...mine.rows, ...viaBm.rows], truncated = mine.truncated || viaBm.truncated;
    const owner = await fbUser();
    if (gen !== state.gen) return;
    // Another user's list: their ads and open rows don't belong to this one.
    if (owner !== state.owner) Object.assign(state, { open: new Set(), ads: {}, adsHidden: new Set() });
    Object.assign(state, { accounts: rows, fetchedAt: Date.now(), truncated, owner });
    await saveSession({ accounts: rows, fetchedAt: state.fetchedAt, truncated: state.truncated, owner, ads: adsToSave() });
    saveView();
    if (!auto || truncated) toast(t("acc.loaded", { n: rows.length }) + (truncated ? t("acc.truncated") : ""));   // the list itself is the answer to an automatic load
  } catch (e) {
    if (!(e instanceof Stale)) toast(e.message, true);
  } finally {
    btn.disabled = false; btn.removeAttribute("aria-busy");
    setLoading(false);
  }
}
// The Accounts tab loads the list by itself when there is nothing loaded yet, or when the FB page the token came
// from was reloaded since the last load. Reopening the popup or switching tabs alone never sends a request.
// At most one try per popup open; the limits are a click's (the one-minute slot, the API pause, a dead session).
let autoTried = false;
// Exported: the Businesses tab asks for the same list on its first visit (same rule, same limits, same one try per popup open).
export async function ensureAccounts() {
  if (autoTried) return;
  autoTried = true;
  const placeholder = !state.accounts.length;           // "Loading…" at once, not "press refresh" and then "Loading…"
  if (placeholder) setLoading(true);
  try {
    // Without the silent token read the request could go out with a stale token. Not forever, though.
    await Promise.race([tokenReady, new Promise((resolve) => setTimeout(resolve, 15000))]);
    if (!state.token || isDead() || state.cooldownUntil > Date.now()) return;
    const page = state.tokenSource?.page || null;
    const { autoPage } = await chrome.storage.session.get("autoPage");
    if (state.fetchedAt && (!page || page === autoPage)) return;   // loaded before, same FB page load: keep the list
    await fetchAccounts({ auto: true });
  } finally {
    if (placeholder && !accBusy) setLoading(false);
  }
}
// The Businesses tab's refresh button also refreshes this list (its spend and counts come from it). Silent where a click on this
// tab would complain (the one-minute slot, no token…): the Businesses tab has its own message for its own refresh.
export const reloadAccounts = () => fetchAccounts({ auto: true });
// Spend for the selected period (spend.js: the Businesses tab reads the same numbers the same way). null = unknown.
const statsOf = (a, key = state.period) => spendStats(a, key, state.fetchedAt);
const periodRange = () => rangeOf(state.accounts, state.period, state.fetchedAt);
// Rows matching the search + status filter + BM filter. The total, the count and "Active IDs" all follow it.
function visibleRows() {
  const q = state.filter.trim().toLowerCase();
  return state.accounts.filter((a) => {
    const [label] = accStatus(a);
    if (state.statusFilter && label !== state.statusFilter) return false;
    if (state.bmFilter && a.business?.id !== state.bmFilter.id) return false;
    return !q || `${a.name} ${a.account_id} ${label} ${a.business?.name || ""}`.toLowerCase().includes(q);
  });
}
const isFiltered = () => !!(state.filter.trim() || state.statusFilter || state.bmFilter);
function copyLiveIds() {
  const ids = visibleRows().filter((a) => a.account_status === 1).map((a) => a.account_id);
  if (!ids.length) return toast(t("acc.noLive"), true);
  copy(ids.join("\n"), t("acc.idsCopied", { n: ids.length }) + (state.truncated ? t("acc.partial") : ""));
}
// [label, tone] for an account; unknown codes are shown as their number.
function accStatus(a) {
  const c = a.account_status;
  return c in ACCOUNT_STATUS ? [t(`status.${c}`), ACCOUNT_STATUS[c]] : [t("status.other", { n: c }), "warn"];
}
function renderHint() {
  const total = $("#accountsTotal");
  refreshTip($("#loadAccounts"), t("refresh"), state.fetchedAt);          // "Refresh · updated 3 min ago"
  if (!state.fetchedAt) return fill(total);
  const all = state.accounts.length, rows = visibleRows(), n = rows.length;
  // The count only when a search / filter is on ("3 of 10 found"); an incomplete list always says so.
  const metaText = `${isFiltered() ? t("acc.found", { n, all }) : ""}${state.truncated ? t("acc.notAll") : ""}`.trim();
  if (!n) return fill(total, metaText ? el("span", { class: "total-meta" }, metaText) : null);
  // Row 1: what the number is (left: "Spend · Aug 29") + the filter count (right). Row 2: the number.
  fillTotal(total, { metaText, range: state.period === "all" ? "" : periodRange(), zeroCur: rows[0].currency,
    sum: addUp(rows.map((a) => ({ spend: statsOf(a)?.spend ?? null, currency: a.currency }))) });
}
function renderAccounts() { keepFocus(drawAccounts); }
function drawAccounts() {
  const list = $("#accountsList");
  renderHint();
  $("#copyLiveIds").disabled = !state.accounts.some((a) => a.account_status === 1);
  const counts = {};
  for (const a of state.accounts) { const [l] = accStatus(a); counts[l] = (counts[l] || 0) + 1; }
  if (state.statusFilter && !counts[state.statusFilter]) state.statusFilter = null;
  // A status filter is only useful when statuses differ; with one status it just repeats the count.
  if (Object.keys(counts).length < 2) { state.statusFilter = null; for (const k of Object.keys(counts)) delete counts[k]; }
  // The BM filter (set from the BM tab) comes first as its own chip; clicking it clears it.
  const bm = state.bmFilter;
  fill($("#statusChips"), bm ? el("button", { class: "pill chip on", "aria-pressed": "true", "data-focus": "chip:bm", title: t("acc.bmFilterClear"),
      onclick: () => { state.bmFilter = null; renderAccounts(); } }, el("i", { class: "i i-bm" }), `${bm.name || bm.id} ✕`) : null,
    ...Object.entries(counts).map(([label, n]) => {
    const tone = Object.entries(ACCOUNT_STATUS).find(([c]) => t(`status.${c}`) === label)?.[1] || "";
    const on = state.statusFilter === label;
    return el("button", { class: `pill chip ${tone}${on ? " on" : ""}`, "aria-pressed": String(on), "data-focus": `chip:${label}`,
      onclick: () => { state.statusFilter = on ? null : label; renderAccounts(); } }, `${label} ${n}`);
  }));
  const rows = visibleRows();
  if (!state.accounts.length) return fill(list, el("div", { class: "empty" }, state.accLoading ? t("acc.loading") : t("acc.empty")));
  if (!rows.length) return fill(list, el("div", { class: "empty" }, t("acc.noMatch")));
  // Stats once per row: the sort comparator would otherwise recompute them O(n log n) times.
  const stats = new Map(rows.map((a) => [a, statsOf(a)]));
  const spendOf = (a) => stats.get(a)?.spend ?? -1;
  rows.sort((a, b) => (b.account_status === 1) - (a.account_status === 1) || spendOf(b) - spendOf(a));
  fill(list, ...rows.map((a) => renderAccount(a, stats.get(a))));
}
function renderAccount(a, st) {
  const [label, tone] = accStatus(a);
  const cur = a.currency;
  const threshold = a.adspaymentcycle?.data?.[0]?.threshold_amount;
  const dsl = a.adtrust_dsl;
  const cpc = st?.clicks ? st.spend / st.clicks : null;
  const isOpen = state.open.has(a.account_id);
  const steps = accountSteps(a), quick = steps.actions.find((x) => x.primary) || steps.actions[0];
  const card = el("div", { class: `acc${isOpen ? " open" : ""}` });
  const toggle = () => {
    const open = card.classList.toggle("open");
    state.open[open ? "add" : "delete"](a.account_id);
    title.setAttribute("aria-expanded", String(open));
    saveView();
  };
  // The whole row toggles on click (mouse); the keyboard / screen-reader control is the title button.
  // Its click bubbles to the row, so it has no handler of its own. The row itself is not a button:
  // it holds the copy-ID button and the Ads Manager link, and interactive controls must not nest.
  const title = el("button", { type: "button", class: "acc-title", "aria-expanded": String(isOpen), "data-focus": `acc:${a.account_id}` },
    el("i", { class: "i i-chevron", "aria-hidden": "true" }),
    el("span", { class: "acc-name", title: a.name }, a.name || t("acc.noName")));
  const head = el("div", { class: "acc-head", onclick: toggle },
    title,
    pill(label, tone),
    el("div", { class: "acc-ids" },
      el("button", { class: "acc-id", title: t("acc.copyId"), "data-focus": `id:${a.account_id}`,
                     onclick: (ev) => { ev.stopPropagation(); copy(a.account_id, t("acc.idCopied")); } },
         a.account_id, el("i", { class: "i i-copy" })),
      // Open in Ads Manager straight from the collapsed row; must not toggle the row.
      el("a", { class: "acc-link", title: t("acc.openAds"), "aria-label": t("acc.openAds"), target: "_blank", rel: "noopener noreferrer", "data-focus": `link:${a.account_id}`,
                href: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${a.account_id}`,
                onclick: (ev) => ev.stopPropagation() }, el("i", { class: "i i-external" }))),
    st ? el("div", { class: "acc-spend" }, fmt(st.spend, cur))
       : el("div", { class: "acc-spend muted", title: t("acc.noPeriod") }, "—"),  // .acc-spend uses the number font in CSS
    el("div", { class: "acc-meta" },
      a.business
        ? el("span", { class: "owner", title: t("acc.inBm", { n: a.business.name, id: a.business.id }) }, el("i", { class: "i i-bm" }), el("span", { class: "owner-name" }, a.business.name))
        : el("span", { class: "owner", title: t("acc.personalTitle") }, el("i", { class: "i i-user" }), t("acc.personal")),
      a.timezone_name ? el("span", { title: t("acc.tz", { tz: a.timezone_name }) }, tzLabel(a.timezone_name)) : null,
      a.disable_reason ? el("span", { class: "err-text" }, `${has(`reason.${a.disable_reason}`) ? t(`reason.${a.disable_reason}`) : t("reason.other")} (${a.disable_reason})`) : null,
      // Problem → its fix, right after it: the one next step (appeal, pay…; or where to look when there is nothing to push),
      // a plain underlined link in the status colour. The help line is its tooltip; the expanded row lists every step.
      quick ? actLink(quick, `act-inline ${steps.tone}`, `act:${a.account_id}:${quick.id}`, { tip: t(steps.help), owner: a.name }) : null),
    st && st.imp !== null && (st.imp || st.clicks)
      ? el("div", { class: "acc-sub", title: t("acc.imp", { n: numFmt().format(st.imp) }) },
          numEl(numFmt().format(st.clicks)), ` ${tn(st.clicks, "ads.clk")}`, cpc !== null ? [" · CPC ", numEl(fmt(cpc, cur))] : null)
      : el("div", { class: "acc-sub" }),
  );
  const adsBox = el("div", { class: "ads", "data-ads-box": a.account_id });
  const pixels = a.adspixels?.data;
  const body = el("div", { class: "acc-body" },
    // What to do: the help line and every next step, above the numbers (only for an account that has a problem).
    steps.help ? el("div", { class: `act-box ${steps.tone}`, role: "group", "aria-label": t("next.title") },
      el("div", { class: "act-title" }, t("next.title")),
      el("p", { class: "act-help" }, t(steps.help)),
      steps.actions.length ? el("div", { class: "act-btns" },
        steps.actions.map((x) => actLink(x, `btn act-link${x.primary ? " primary" : ""}`, `step:${a.account_id}:${x.id}`))) : null) : null,
    el("dl", { class: "kv" },
      el("dt", {}, t("acc.spent")), el("dd", {}, numEl(fmt(statsOf(a, "all").spend, cur))),   // same number as the "All time" period
      el("dt", {}, t("acc.balance")), el("dd", {}, numEl(money(a.balance, cur))),
      el("dt", {}, t("acc.threshold")), el("dd", {}, threshold !== undefined ? numEl(money(threshold, cur)) : "—"),
      el("dt", {}, t("acc.daily")), el("dd", {}, dsl === undefined ? "—" : Number(dsl) < 0 ? t("acc.noLimit") : numEl(fmt(Number(dsl), cur))),
      el("dt", {}, t("acc.spendCap")), el("dd", {}, Number(a.spend_cap || 0) ? numEl(money(a.spend_cap, cur)) : t("acc.no")),
      el("dt", {}, t("acc.funding")), el("dd", {}, a.funding_source_details?.display_string || "—"),
      el("dt", {}, t("acc.pixels")), el("dd", {}, a._noPixels ? "—"
        : pixels?.length ? pixels.flatMap((p, i) => [i ? ", " : null, p.name, " · ", numEl(p.id)]) : pill(t("acc.noPixel"), "warn")),
      el("dt", {}, t("acc.owner")), el("dd", {}, a.business ? [a.business.name, " · ", numEl(a.business.id)] : t("acc.noBm")),
      el("dt", {}, t("acc.country")), el("dd", {}, a.business_country_code || "—", " · ", a.created_time ? numEl(a.created_time.slice(0, 10)) : "—"),
    ),
    // One grey card for the ads, full width (it reaches back over the indent of the rows above, so the gutters match).
    // Its header is the same box before the first load, collapsed and open: toggling only adds or removes the list below.
    el("div", { class: "ads-card" }, adsControls(a.account_id), adsBox),
  );
  card.append(head, body);
  if (state.ads[a.account_id]) renderAds(adsBox, state.ads[a.account_id], a);
  return card;
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
// The card's header row. Before the first load: "Ads" (loads them). After: "Ads · N", a show/hide toggle (no request,
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
  return el("div", { class: "ad-stats" }, numEl(fmt(spend, cur)), " · ", numEl(n.format(imp)), ` ${tn(imp, "ads.imp")} · `, numEl(n.format(clicks)), ` ${tn(clicks, "ads.clk")}`,
    clicks ? [" · CPC ", numEl(fmt(spend / clicks, cur))] : null);
}
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
      `${ads.length}${more ? "+" : ""} ${tn(ads.length, "ads.count")}`,
      live ? t("ads.live", { n: live }) : "", rejected ? el("span", { class: "err-text" }, t("ads.rejected", { n: rejected })) : "",
      shown ? t("ads.statsAt", { a: ago(statsAt) }) : ""),
    stale ? el("div", { class: "hint err-text" }, t("ads.stale", { m: stale })) : null,
    hint ? el("div", { class: "hint" }, hint) : null,
    // Disapproved / with issues first, each with every reason and the placement it applies to.
    ...[...ads].sort((a, b) => adRank(a.effective_status) - adRank(b.effective_status)).map((ad) => {
    const st = ad.effective_status;
    const [l, tone] = st in AD_STATUS ? [t(`ad.${st}`), AD_STATUS[st]] : [st, ""];
    const why = reviewLines(ad), steps = adSteps(ad, id);
    return el("div", { class: "ad" }, el("span", {}, ad.name), pill(l, tone),
      shown ? adStatsLine(stats[ad.id]?.[alias] ?? null, st, acc?.currency) : null,
      why.length ? el("small", {}, why.map((line) => el("span", { class: "why" }, line))) : null,
      // Rejected ad: ask for a review / open it in Ads Manager (links only).
      steps.length ? el("div", { class: "ad-acts" }, steps.map((x) => actLink(x, "ad-act", `adact:${ad.id}:${x.id}`, { owner: ad.name }))) : null);
  }), ...(more ? [el("div", { class: "hint" }, t("ads.more", { n: ads.length }))] : []));
}
// One GET of an account's ads. issues_info (the reason for "with issues") is optional like the account fields:
// if Graph rejects it, the call is repeated once without it.
async function readAds(id, extra = {}) {
  for (;;) {
    const fields = `id,name,effective_status,ad_review_feedback${state.skip.has("issues_info") ? "" : ",issues_info"}`;
    try { return await graph(`act_${id}/ads`, { fields, limit: "100", ...extra }); }
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
const readStats = (id, withAll) => graph(`act_${id}/ads`, { fields: `id,${PERIOD_INSIGHTS}${withAll ? `,${AD_ALL_INSIGHTS}` : ""}`, limit: "100" });
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
  saveSession({ ads: adsToSave() });
  renderAccounts();
}
// The list on screen stays while it is re-read (nothing jumps); the icon is disabled meanwhile.
async function loadAds(id) {
  if (state.adsBusy.has(id)) return;
  await settledGrab();
  if (!state.token && !(await grabToken({ toClipboard: false }))) return;
  if (isDead()) return toast(t("err.session", { c: deadCode() }), true);
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
  const box = adsBox(id);
  if (box && (!state.ads[id] || state.ads[id].error)) fill(box, el("div", { class: "hint" }, t("ads.loading")));
  let entry = null;
  try {
    const res = await readAds(id);
    if (!Array.isArray(res.data)) throw new Error(t("err.noData"));
    let list = res.data;
    if (res.paging?.next) {
      // More than one page: the ads that need attention must not hide behind the first 100.
      try {
        const bad = await readAds(id, { effective_status: JSON.stringify(AD_PROBLEMS) });
        const have = new Set(list.map((a) => a.id));
        if (Array.isArray(bad.data)) list = list.concat(bad.data.filter((a) => !have.has(a.id)));
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
  saveSession({ ads: adsToSave() }); saveView();
  renderAccounts();
  if (entry) await loadAdStats(id, gen, entry);        // the list is on screen; the numbers follow
}

// ---------- wiring ----------
// Re-render rows only when some account's "today" goes stale (its day rolled over).
const todaySig = () => state.accounts.map((a) => (statsOf(a, "today") ? 1 : 0)).join("");
let sig = "";

// The Accounts tab takes Chrome's full 600 px from the start (tall), so a list arriving a moment later doesn't make the
// window jump; showing it starts the auto-load.
registerTab("accounts", { tall: true, onShow: ensureAccounts });
// RU · EN: the status filter holds a translated label, so it is cleared; everything else is redrawn from state.
registerRender(() => { state.statusFilter = null; renderAccounts(); });
registerRender(() => {
  syncAdsButtons();
  const now = todaySig();
  if (now !== sig) { sig = now; renderAccounts(); } else renderHint();
}, { lang: false, tick: true });
registerInit(() => {
  bindPeriods($("#periodSeg"));                           // the saved period was read by period.js's own init, which ran first
  $("#loadAccounts").addEventListener("click", () => fetchAccounts());
  $("#copyLiveIds").addEventListener("click", copyLiveIds);
  $("#accountFilter").addEventListener("input", (e) => { state.filter = e.target.value; renderAccounts(); });
});
registerStart(() => { renderAccounts(); sig = todaySig(); });
