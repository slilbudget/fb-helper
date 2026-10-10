// The spend period (Today … All time) and the total line: one choice shared by the Ad accounts tab and the Businesses tab.
// state.period is the one value; switching it on either tab redraws both (bus "period") and is remembered in localStorage
// ("period"). What a period means and how amounts are added up is spend.js; this file is the screen part of it.

import { t } from "./i18n.js";
import { el, fill, keepFocus } from "./dom.js";
import { ago } from "./format.js";
import { state } from "./state.js";
import { on, emit } from "./bus.js";
import { registerRender, registerInit } from "./registry.js";
import { PERIODS, isPeriod } from "./spend.js";
import { fmtMoney, totalLine, cachedRates, loadCachedRates, rates } from "./money.js";

Object.assign(state, { period: "today" });

// ---------- the buttons ----------
// Every tab that shows the switch binds its own box; prefix keeps their data-focus keys apart.
const boxes = new Map();
function drawPeriods() {
  keepFocus(() => {
    for (const [box, prefix] of boxes) {
      fill(box, ...PERIODS.map((p) => el("button", {
        class: `seg-btn${p.key === state.period ? " active" : ""}`, "aria-pressed": String(p.key === state.period), "data-focus": `${prefix}period:${p.key}`,
        title: p.key === "week" || p.key === "month" ? t("period.noToday") : p.key === "all" ? t("period.allNote") : null,
        onclick: () => setPeriod(p.key),
      }, t(p.label))));
    }
  });
}
export function bindPeriods(box, prefix = "") { boxes.set(box, prefix); drawPeriods(); }
function setPeriod(key) {
  if (!isPeriod(key)) return;
  state.period = key;
  try { localStorage.setItem("period", key); } catch { /* */ }
  emit("period", key);
}
on("period", drawPeriods);
registerRender(drawPeriods);                                                   // RU · EN: the labels
registerInit(() => { try { const p = localStorage.getItem("period"); if (isPeriod(p)) state.period = p; } catch { /* */ } });
registerInit(() => { loadCachedRates(); });                                    // the saved rates (storage only, no request): the first paint of a total already has them

// ---------- the total ----------
// The block under the controls, ONE line: "Spend · Aug 29 · 3 of 10 found" on the left (the date range of the period: the segment above already
// says which period; `metaText`: "3 of 10 found", "(not all)", empty when nothing is to be said) and the sum on the right; what the sum is
// made of under it. label = what is added up ("Spend" by default), labelTitle = its tooltip (Businesses: "without personal ad accounts").
// sum = { totals, unknown } (spend.js addUp / mergeUp), or null when nothing is known yet (shown as "—").
// zeroCur = the currency to print a zero in when every spend was 0 (none known: "—").
// One currency: that amount. Two or more: "≈ 1 727 $" (USD, at the daily rate: money.js) with a muted line under it ("1 696 $ + 20 € ·
// rates 08.10") and the whole breakdown as the tooltip. Rates are asked for only for such a total AND only while its tab is
// on screen (a hidden tab redrawing from a bus event must not send a request nobody looks at; showing the tab draws it again), and a
// total never waits for them: it is drawn at once as "$1,696 + €20.00" and turns into "≈ …" when the rates are there. No rates at all
// (offline, both sources down): it stays the per-currency sum.
const latest = new WeakMap();                                                   // box → the arguments of its newest fillTotal (a late rates answer must not repaint an older one)
export const isShown = (node) => !!node?.closest?.(".panel.active");           // the tab the node is in is the one on screen
export function fillTotal(box, opts) {
  const multi = !!opts.sum && Object.keys(opts.sum.totals).length >= 2;
  const used = multi ? cachedRates() : null;
  paintTotal(box, opts, used);
  if (!multi || !isShown(box)) { latest.delete(box); return; }
  latest.set(box, opts);
  rates().then((r) => { if (r && r.rates !== used?.rates && latest.get(box) === opts) paintTotal(box, opts, r); });
}
function paintTotal(box, { label = t("acc.spend"), labelTitle, metaText, range = "", sum = null, zeroCur = null }, r) {
  const line = sum ? totalLine(sum.totals, r) : null;
  const value = !sum ? "—" : sum.unknown && !line.main ? t("acc.refreshDash") : line.main || (zeroCur ? fmtMoney(0, zeroCur) : "—");
  const parts = line?.approx ? [`${line.breakdown}${line.more ? ` ${t("money.more", { n: line.more })}` : ""}`, line.note] : [];
  fill(box,
    // The label and what is said about the list ("3 of 10 found", "(not all)") are one muted piece on the left; the sum is on the right of the same line.
    el("span", { class: "total-label", title: labelTitle || null }, `${label}${range ? ` · ${range}` : ""}`,
      metaText ? el("span", { class: `total-meta${metaText.startsWith("(") ? " paren" : ""}` }, metaText) : null),
    // The tooltip of the sum: the converted one's breakdown; the exact amounts when the line wrote a million of an ISO-code currency short.
    el("span", { class: "total-value", title: line?.approx ? line.title : line?.main && line.main !== line.full ? line.full : null }, value,
      sum?.unknown && line.main ? el("small", { title: t("acc.notAllTitle") }, t("acc.notAllShort")) : null),
    line?.approx ? el("span", { class: "total-sub", title: line.title }, parts.join(" · ")) : null);
}
// "updated 3 min ago" lives in the refresh button's tooltip, not on the screen: "Refresh · updated 3 min ago".
export function refreshTip(btn, base, updatedAt) {
  if (btn) btn.title = updatedAt ? `${base} · ${t("acc.updated", { t: ago(updatedAt) })}` : base;
}
