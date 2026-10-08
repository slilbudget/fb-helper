// The parts the rows of the Ad accounts, Businesses and Pages tabs have in common, so the three read as one product:
//   actLink     a "next step": the underlined link after a problem, in the status colour (also used by the account rows)
//   avatar      the picture left of a name, or a neutral placeholder
//   problems    the problem line of a row: "<problem> <fix>" pairs
//   quietLinks  the muted row of secondary links at the bottom of a row
// DOM only; what a problem is and where its fix goes is decided by the *-model.js files.

import { t } from "./i18n.js";
import { el } from "./dom.js";

// A "next step" as a plain link to a Facebook page: new tab, keyboard-focusable, and it must never toggle the row it sits in
// (the collapsed account row toggles on any click). The URL was built and checked in links.js; nothing is sent or changed.
// x = { label (i18n key), url }. owner = the account / page / business name: a list of identical "Request review" links is
// useless to a screen reader without it.
export const actLink = (x, cls, focus, { tip, owner } = {}) => el("a", { class: cls, href: x.url, target: "_blank", rel: "noopener noreferrer", title: tip,
  "aria-label": owner ? `${t(x.label)} · ${owner}` : null, "data-focus": focus, onclick: (ev) => ev.stopPropagation() },
  el("span", { class: "act-label" }, t(x.label)), el("i", { class: "i i-external", "aria-hidden": "true" }));

// ---------- avatar ----------
// 24 px: a circle for a page, a rounded square for a business. Without a picture, while it loads and when it fails to load it is
// the tab's Lucide icon (`icon`: "flag" for a page, "building" for a business) on a muted background, never a broken image.
// The <img> is decorative (alt=""), sends no referrer, loads lazily, and takes the box over only once it has loaded. Every
// redraw builds the list again, so URLs that loaded (or failed) once are remembered and not asked twice.
const loaded = new Set(), broken = new Set();
export function avatar({ url = null, shape = "circle", icon } = {}) {
  const box = el("span", { class: `av av-${shape}`, "aria-hidden": "true" }, el("i", { class: `i i-${icon}` }));
  if (!url || broken.has(url)) return box;
  if (loaded.has(url)) box.classList.add("ok");
  // The attribute order matters: the policy and `loading` must be there before `src` starts the request.
  const img = el("img", { class: "av-img", alt: "", width: "24", height: "24", referrerpolicy: "no-referrer", loading: "lazy", decoding: "async", src: url });
  img.addEventListener("load", () => { loaded.add(url); box.classList.add("ok"); });
  img.addEventListener("error", () => { broken.add(url); box.classList.remove("ok"); img.remove(); });
  box.append(img);
  return box;
}

// ---------- the problem line ----------
// issues = [{ id, tone: "bad" | "warn", text (already translated), tip (already translated, may be empty), fix: { label (i18n key), tip (translated), url } | null }].
// Each is "problem text in the tone colour, then its fix as an underlined link": the way out is one click from the problem.
// focus = the data-focus prefix of the row; owner = the name for the link's accessible name. null when there is nothing wrong.
export function problems(issues, { focus, owner } = {}) {
  if (!issues.length) return null;
  return el("div", { class: "row-line row-probs" }, issues.map((i) =>
    el("span", { class: "prob", "data-problem": i.id },
      el("span", { class: `prob-text ${i.tone}`, title: i.tip || null }, i.text),
      i.fix ? actLink(i.fix, `act-inline ${i.tone}`, `${focus}:${i.id}`, { tip: i.fix.tip, owner }) : null)));
}

// ---------- secondary links ----------
// defs = [{ id, label, tip (i18n keys), href }]; a def without an href (id rejected by links.js) is dropped.
export function quietLinks(defs, { focus, owner } = {}) {
  const list = defs.filter((d) => d.href);
  if (!list.length) return null;
  return el("div", { class: "row-line row-links" }, list.map((d) =>
    el("a", { class: "row-link", href: d.href, target: "_blank", rel: "noopener noreferrer", title: t(d.tip), "aria-label": owner ? `${t(d.label)}: ${owner}` : null,
      "data-focus": `${focus}:${d.id}`, onclick: (ev) => ev.stopPropagation() }, t(d.label), el("i", { class: "i i-external", "aria-hidden": "true" }))));
}
