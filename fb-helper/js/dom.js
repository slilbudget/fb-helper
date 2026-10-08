// DOM helpers shared by every tab: selectors, element builder, toast, clipboard, focus keeping.

import { t } from "./i18n.js";

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

// How long a toast stays: 2.6 s, longer for a long text (60 ms a character: a reader needs the time, and a long error is the one to read).
export const toastMs = (msg) => Math.max(2600, 60 * String(msg ?? "").length);
export function toast(msg, err = false) {
  const box = $("#toast");
  box.textContent = msg;
  box.classList.toggle("err", err);
  box.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => box.classList.remove("show"), toastMs(msg));
}
export async function copy(text, label = t("copied")) {
  try { await navigator.clipboard.writeText(text); toast(label); return true; }
  catch { toast(t("copyFail"), true); return false; }
}
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false)
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
// replaceChildren that drops null/undefined/false (they would otherwise render as the text "null").
export const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
export const pill = (text, tone = "") => el("span", { class: `pill ${tone}` }, text);
export const errText = (msg) => el("span", { class: "err-text" }, msg);
// Numbers/ids get equal-width digits (.num → tabular-nums), so they line up across rows.
export const numEl = (text) => el("span", { class: "num" }, text);
// A line that scrolls sideways (the chips) fades out at the edge that has more behind it: css --fade-l / --fade-r are 0 or 20 px. The listener is
// added once per box; call it after every refill (the contents changed), it also follows the box being resized.
const fading = new WeakSet();
export function scrollFade(box) {
  if (!box) return;
  const apply = () => {
    const max = box.scrollWidth - box.clientWidth, x = Math.abs(box.scrollLeft);
    box.style.setProperty("--fade-l", x > 1 ? "20px" : "0px");
    box.style.setProperty("--fade-r", max - x > 1 ? "20px" : "0px");
  };
  if (!fading.has(box)) {
    fading.add(box);
    box.addEventListener("scroll", apply, { passive: true });
    if (typeof ResizeObserver === "function") new ResizeObserver(apply).observe(box);
  }
  apply();
}
// Re-rendering replaces nodes: put keyboard focus back on the control with the same data-focus key.
export function keepFocus(render) {
  const key = document.activeElement?.dataset?.focus;
  render();
  if (key) document.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus();
}
