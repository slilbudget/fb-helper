// The spend period (Today … All time) and the total line: one choice shared by the Ad accounts tab and the Businesses tab.
// state.period is the one value; switching it on either tab redraws both (bus "period") and is remembered in localStorage
// ("period"). What a period means and how amounts are added up is spend.js; this file is the screen part of it.

import { t } from "./i18n.js";
import { el, fill, keepFocus } from "./dom.js";
import { fmt } from "./format.js";
import { state } from "./state.js";
import { on, emit } from "./bus.js";
import { registerRender, registerInit } from "./registry.js";
import { PERIODS, isPeriod, totalsText } from "./spend.js";

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
export function setPeriod(key) {
  if (!isPeriod(key)) return;
  state.period = key;
  try { localStorage.setItem("period", key); } catch { /* */ }
  emit("period", key);
}
on("period", drawPeriods);
registerRender(drawPeriods);                                                   // RU · EN: the labels
registerInit(() => { try { const p = localStorage.getItem("period"); if (isPeriod(p)) state.period = p; } catch { /* */ } });

// ---------- the total ----------
// The block under the controls: "Spend · today · Aug 29" (left) and `metaText` (right) on the first row, the sum under them.
// label = what is added up ("Spend" by default; the Businesses tab says "Spend of businesses").
// sum = { totals, unknown } (spend.js addUp / mergeUp), or null when nothing is known yet (shown as "—").
// zeroCur = the currency to print a zero in when every spend was 0 (none known: "—").
export function fillTotal(box, { label = t("acc.spend"), metaText, range = "", sum = null, zeroCur = null }) {
  const period = t(PERIODS.find((p) => p.key === state.period).label);
  const sumText = sum ? totalsText(sum.totals) : "";
  const value = !sum ? "—" : sum.unknown && !sumText ? t("acc.refreshDash") : sumText || (zeroCur ? fmt(0, zeroCur) : "—");
  fill(box,
    el("span", { class: "total-label" }, `${label} · ${period.toLowerCase()}${range ? ` · ${range}` : ""}`),
    el("span", { class: "total-meta" }, metaText),
    el("span", { class: "total-value" }, value,
      sum?.unknown && sumText ? el("small", { title: t("acc.notAllTitle") }, t("acc.notAllShort")) : null));
}

// One row's spend, in the font of an account row's spend (.acc-spend). Same rules as the total. missing = the tooltip of a "—".
export function spendCell(sum, zeroCur, missing) {
  const sumText = sum ? totalsText(sum.totals) : "";
  if (!sum || (sum.unknown && !sumText) || (!sumText && !zeroCur)) return el("div", { class: "acc-spend muted", title: missing }, "—");
  return el("div", { class: "acc-spend" }, sumText || fmt(0, zeroCur),
    sum.unknown ? el("small", { class: "acc-spend-note", title: t("acc.notAllTitle") }, t("acc.notAllShort")) : null);
}
