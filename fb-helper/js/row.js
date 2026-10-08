// The one list row of the Businesses, Ad accounts and Pages tabs (design.md §1 and §8), and the small parts its expanded body is made of.
// DOM only; what a row says (status, problem, fix, amounts) is decided by the tabs' own model files. Styles: css/rows.css.
//
//   collapsed row = two lines, two columns:
//     line 1   › [24 px picture] Name (ellipsis)                                       value (amount, right-aligned, tabular digits)
//     line 2        ● Problem · Fix verb  +N                                    ⧉ 1864109161555839   (ID: muted, hidden below 480 px; ⧉ on hover only)
//   A healthy row is silent: a status with tone "ok" prints nothing (a screen-reader-only word instead), so the list shows only what
//   needs a look. A problem row says the problem ONCE (the status word is the problem) and puts its fix, an underlined link without
//   an icon, right after it; "+2 more" / "ещё 2" = further problems (all of them are in the expanded body).
//   Stretched-button pattern: the name is the one real <button aria-expanded aria-controls aria-describedby=value + line 2>; its ::after
//   covers the whole row, so the whole row clicks like a button while the fix link and the copy button sit above it (z-index), no
//   stopPropagation anywhere. The status, the value and "+N" sit above the cover too (tooltips, selectable text) and toggle on click via one
//   listener on the head. A mouse click that ends a text selection inside the head does not toggle the row.
//   Lazy body: the expanded body is built when the row opens and thrown away when it closes (100+ rows stay cheap); `open` lets the
//   caller redraw an open row open. The body starts with an "ID ⧉" line that shows below 480 px only (there the collapsed row has no ID);
//   from 480 px the collapsed row's copy button is the one, tabindex -1 while the row is closed (mouse) and tabbable once it is open.

import { t } from "./i18n.js";
import "./strings/row.js";
import "./strings/actions.js";                        // next.title ("What to do")
import { el, toast } from "./dom.js";
import { imageUrl } from "./links.js";

// ---------- helpers ----------
let uid = 0;                                          // ids for aria-controls / aria-describedby, unique within the document
// Every link comes from links.js (checked ids, https). A descriptor without an https URL draws nothing: never a javascript: or a half URL.
const https = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);
const present = (v) => !(v === null || v === undefined || v === false || v === "" || (Array.isArray(v) && !v.length));

// A polite live region for "ID copied" (no toast covering the rows). It is in popup.html from the start (#live): a region that is created
// together with its message is not announced. A page without it (a test lab) gets one on first use.
let live = null;
function announce(msg) {
  live ||= document.getElementById("live") || document.body.appendChild(el("div", { id: "live", class: "sr-only", role: "status", "aria-live": "polite" }));
  live.textContent = msg;
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => { live.textContent = ""; }, 1500);
}

// ---------- avatar ----------
// 24 px: a circle for a page, a rounded square for a business. Without a picture, while it loads and when it fails to load it is the
// Lucide icon (flag / building) on a muted background: never initials, never a broken image. The <img> is decorative (alt=""), sends
// no referrer, loads lazily, and takes the box over only once it has loaded. A URL is used only if links.js imageUrl() accepts it
// (https, facebook.com / fbcdn.net). Every redraw builds the list again, so URLs that loaded (or failed) once are remembered.
const KINDS = { page: { shape: "circle", icon: "flag" }, business: { shape: "square", icon: "building" } };
const loaded = new Set(), broken = new Set();
function avatarEl(kind, url) {
  const k = KINDS[kind] || KINDS.page, src = imageUrl(url);
  const box = el("span", { class: `lav lav-${k.shape}`, "aria-hidden": "true" }, el("i", { class: `i i-${k.icon}` }));
  if (!src || broken.has(src)) return box;
  if (loaded.has(src)) box.classList.add("ok");
  // The attribute order matters: the policy and `loading` must be there before `src` starts the request.
  const img = el("img", { class: "lav-img", alt: "", width: "24", height: "24", referrerpolicy: "no-referrer", loading: "lazy", decoding: "async", src });
  img.addEventListener("load", () => { loaded.add(src); box.classList.add("ok"); });
  img.addEventListener("error", () => { broken.add(src); box.classList.remove("ok"); img.remove(); });
  box.append(img);
  return box;
}

// ---------- links ----------
// fix = { label (i18n key), url, tip? (translated) }. The underlined link after a problem: new tab, no icon, in the problem's tone
// (actions.css .act-inline.bad / .warn), and its accessible name carries the owner ("Appeal · Nova Media"): a list of identical
// "Appeal" links is useless to a screen reader. null when the URL is not https.
export function fixLink(fix, { tone = "", focus, owner, cls = "" } = {}) {
  const href = https(fix?.url);
  if (!href) return null;
  const label = t(fix.label);
  return el("a", { class: ["act-inline", "lrow-fix", tone, cls].filter(Boolean).join(" "), href, target: "_blank", rel: "noopener noreferrer",
    title: fix.tip || null, "aria-label": owner ? `${label} · ${owner}` : null, "data-focus": focus || null },
  el("span", { class: "act-label" }, label));
}
// The muted row of secondary links at the bottom of an expanded body: "Ads Manager ↗ · Settings ↗" (these keep the icon).
// links = [{ id?, label (i18n key), url, tip? (translated) }]; opts.focus = the data-focus prefix.
export function linksRow(links, { owner, focus = "link" } = {}) {
  const list = (links || []).filter((l) => l && https(l.url));
  if (!list.length) return null;
  const kids = [];
  list.forEach((l, i) => {
    if (i) kids.push(el("span", { class: "lrow-sep", "aria-hidden": "true" }, "·"));
    kids.push(el("a", { class: "lrow-link", href: https(l.url), target: "_blank", rel: "noopener noreferrer", title: l.tip || null,
      "aria-label": owner ? `${t(l.label)}: ${owner}` : null, "data-focus": `${focus}:${l.id ?? i}` },
    t(l.label), el("i", { class: "i i-external", "aria-hidden": "true" })));
  });
  return el("div", { class: "lrow-links" }, kids);
}

// ---------- body parts ----------
// A compact key–value list. pairs = [[label, value, opts?]]; opts = a tooltip string, or { title, wide } (wide = a pair of its own row,
// for long values). A pair whose value is empty, false or "—" is NOT drawn (the row only lists what it knows); a false / null pair
// is skipped too, so `cond && [...]` works. Two columns from 520 px (rows.css). null when nothing is left.
export function kv(pairs) {
  const list = (pairs || []).filter(Array.isArray).filter(([, v]) => present(v) && v !== "—");
  if (!list.length) return null;
  return el("dl", { class: "lrow-kv" }, list.map(([k, v, o]) => {
    const opts = typeof o === "string" ? { title: o } : o || {};
    return el("div", { class: `lrow-pair${opts.wide ? " wide" : ""}` }, el("dt", {}, k), el("dd", { title: opts.title || null, dir: "auto" }, v));
  }));
}
// "What to do": the help line + ALL the next steps as plain underlined links, primary first (the fix that is on line 2 is here too: the body is
// where the whole answer is); no box, no tint. A link is the fix of a problem, so it is in the tone of the problem (the small title as well).
//   help     already translated text (or null)
//   actions  [{ label (i18n key), url, primary?, id?, tip? }]
//   skip     steps that are somewhere else in the body ({ label, url }: the links row at its end already has them): not listed twice
//   tone     "bad" / "warn" colours the title and the links; owner = the name in each link's accessible name; focus = data-focus prefix
// null when there is neither help nor an action left.
export function whatToDo({ help, actions = [], skip = [], tone = "", owner, focus = "todo" } = {}) {
  const skipped = [].concat(skip || []).filter(Boolean);
  const list = (actions || []).filter((a) => a && https(a.url) && !skipped.some((s) => s.url === a.url && s.label === a.label))
    .sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  if (!help && !list.length) return null;
  return el("div", { class: `lrow-todo ${tone}`.trim(), role: "group", "aria-label": t("next.title") },
    el("div", { class: "lrow-todo-title" }, t("next.title")),
    help ? el("p", { class: "lrow-todo-help" }, help) : null,
    list.length ? el("div", { class: "lrow-todo-links" },
      list.map((a, i) => fixLink(a, { tone, cls: `lrow-todo-link${a.primary ? " primary" : ""}`, focus: `${focus}:${a.id ?? i}`, owner }))) : null);
}

// ---------- ID + copy ----------
// id = { value, copiedMsg? }. Click copies and never toggles a row (the button sits above the row's covering ::after). The icon (LEFT of the
// digits, so they end where the amount above them ends; shown on hover / focus only) turns into a ✓ for 1.5 s and the message goes to a live
// region instead of a toast. tabbable = false on the collapsed row (mouse only; row() makes it tabbable while the row is open).
function idButton(id, { focus, tabbable = true }) {
  const icon = el("i", { class: "i i-copy", "aria-hidden": "true" });
  const btn = el("button", { type: "button", class: "lrow-id", title: t("acc.copyId"), "aria-label": `${t("acc.copyId")} ${id.value}`,
    tabindex: tabbable ? null : "-1", "data-focus": focus,
    onclick: async () => {
      try { await navigator.clipboard.writeText(id.value); } catch { toast(t("copyFail"), true); return; }
      announce(id.copiedMsg || t("acc.idCopied"));
      icon.classList.replace("i-copy", "i-tick");
      clearTimeout(btn.timer);
      btn.timer = setTimeout(() => icon.classList.replace("i-tick", "i-copy"), 1500);
    } },
  icon, el("span", { class: "lrow-idtext" }, id.value));
  return btn;
}

// ---------- line 2 fits its width ----------
// The context item of line 2 ("3 ad accounts · 1 disabled") is the first to give way: it shrinks with an ellipsis (css), and when fewer than ~6
// characters of it would be left it is dropped whole: "3…" says nothing and the problem word and its fix beside it are worth more. Measured
// whenever the line has, or changes, its width (a ResizeObserver: a hidden tab has no width yet), all rows of one batch in three steps
// (show every context, read, hide) so a long list costs one layout, not one per row.
const MIN_CTX_PX = 44;
function fitSubs(subs) {
  const items = subs.flatMap((s) => [...s.querySelectorAll(".lrow-it.ctx")]);
  for (const it of items) it.hidden = false;
  const cut = items.filter((it) => { const c = it.firstElementChild; return c.scrollWidth > c.clientWidth + 1 && c.clientWidth < MIN_CTX_PX; });
  for (const it of cut) it.hidden = true;
}
const fitter = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => fitSubs(entries.map((e) => e.target))) : null;
// A font that arrives after the first layout changes the width of every text without changing the width of the line: measure again then.
globalThis.document?.fonts?.addEventListener?.("loadingdone", () => fitSubs([...document.querySelectorAll(".lrow-sub")]));

// ---------- the row ----------
// row({
//   key      stable id of the row (data-row, data-focus keys: keepFocus finds the control again after a redraw)
//   avatar   { kind: "page" | "business", url } or null (Ad accounts have no picture)
//   name     text (ellipsis; the full name is the tooltip)
//   value, valueTitle, valueMuted   the right-hand amount of line 1 (string or Node); muted for "—", "0 $", an Instagram handle
//   status   { tone: "ok" | "warn" | "bad" | "", text, title? }  ok = silent (text only for screen readers); other tones = dot + word
//   context  [string | Node]  muted items after the status, separated by "·" (Businesses: "3 ad accounts")
//   fix      { label (i18n key), url, tip? }  the problem's fix, an underlined link after the status
//   more     number of further problems → "+N"
//   id       { value, copiedMsg? }  the ID (full, right of line 2, hidden below 480 px) + copy icon
//   open     start open (the caller keeps state.open); onToggle(open) is called after a click
//   body     () => Node[]  the expanded body, called each time the row opens (never while it is closed)
// }) → the row element. Without `body` the row is flat: no chevron, no button.
export function row({ key, avatar, name, value, valueTitle, valueMuted = false, status, context = [], fix, more = 0, id, open = false, onToggle, body }) {
  const k = String(key), n = ++uid, label = String(name ?? "");
  const expandable = typeof body === "function";
  const subId = `lrow-sub-${n}`, valId = `lrow-val-${n}`, bodyId = `lrow-body-${n}`;
  const card = el("div", { class: `lrow${avatar ? " has-av" : ""}${expandable ? "" : " flat"}`, "data-row": k });

  // line 2, left: status · context… · fix +N. Every item is one flex child, so only the status and the context ever shrink (ellipsis).
  const tone = status?.tone || "";
  const items = [];                                    // [node, isContext]
  const silent = status && tone === "ok" ? el("span", { class: "sr-only" }, status.text) : null;   // a healthy row says nothing on screen
  if (status && !silent) items.push([el("span", { class: `lrow-status ${tone}`, title: status.title || null },
    el("i", { class: "lrow-dot", "aria-hidden": "true" }), el("span", { class: "lrow-status-text" }, status.text)), false]);
  for (const c of context || []) if (present(c)) items.push([c instanceof Node ? c : el("span", { class: "lrow-ctx" }, c), true]);
  const fixEl = fix ? fixLink(fix, { tone: fix.tone || tone, focus: `rowfix:${k}`, owner: label }) : null;
  const moreEl = more > 0 ? el("span", { class: "lrow-more", title: t("row.moreTitle", { n: more }) }, t("row.more", { n: more })) : null;
  const sub = items.length || fixEl || moreEl || silent
    ? el("div", { class: "lrow-sub", id: subId }, silent, items.map(([i, ctx]) => el("span", { class: `lrow-it${ctx ? " ctx" : ""}` }, i)),
      fixEl || moreEl ? el("span", { class: "lrow-it fixed" }, fixEl, moreEl) : null)
    : null;

  // The name button comes first in the DOM (tab order, reading order); everything else above it is positioned over its ::after.
  const nameEl = el("span", { class: "lrow-name", dir: "auto" }, label);
  const title = expandable
    ? el("button", { type: "button", class: "lrow-title", title: label, "aria-expanded": String(!!open), "aria-controls": bodyId, "aria-describedby": [present(value) ? valId : null, sub ? subId : null].filter(Boolean).join(" ") || null,
      "data-focus": `row:${k}`, onclick: (ev) => { if (ev.detail > 0 && selectedInHead()) return; toggle(); } },
    el("i", { class: "i i-chevron", "aria-hidden": "true" }), avatar ? avatarEl(avatar.kind, avatar.url) : null, nameEl)
    : el("span", { class: "lrow-title", title: label }, avatar ? avatarEl(avatar.kind, avatar.url) : null, nameEl);
  const idHead = id ? idButton(id, { focus: `rowid:${k}`, tabbable: false }) : null;
  // Nothing visible on line 2 (a healthy row: only the screen-reader word): below 480 px, where the ID is not there either, the name sits in the
  // middle of the row's 68 px instead of at the top of an empty one (css .lrow-head.bare).
  const bare = !(items.length || fixEl || moreEl);
  const head = el("div", { class: `lrow-head${bare ? " bare" : ""}` }, title,
    present(value) ? el("span", { class: `lrow-value${valueMuted ? " muted" : ""}`, id: valId, title: valueTitle || null }, value) : null,
    sub,
    idHead ? el("span", { class: "lrow-idc" }, idHead) : null);
  card.append(head);
  if (sub && fitter && sub.querySelector(".ctx")) fitter.observe(sub);
  // The status, the value and "+N" sit above the covering ::after (so their tooltips and text selection work); a click on one of them
  // toggles like a click anywhere else on the row. The name button, the fix link and the copy button have their own behaviour.
  head.addEventListener("click", (ev) => {
    if (!expandable || ev.target.closest("a, button")) return;
    if (ev.detail > 0 && selectedInHead()) return;
    toggle();
  });

  // A drag that selects text inside the head ends in a click on the covering button: that is not a request to toggle.
  function selectedInHead() {
    const s = globalThis.getSelection?.();
    return !!s && !s.isCollapsed && s.toString().trim() !== "" && (head.contains(s.anchorNode) || head.contains(s.focusNode));
  }
  let bodyEl = null;
  function setOpen(next) {
    card.classList.toggle("open", next);
    title.setAttribute("aria-expanded", String(next));
    if (idHead) idHead.tabIndex = next ? 0 : -1;       // from 480 px the ID is on the collapsed row: its copy button is for the keyboard once the row is open
    if (next && !bodyEl) {
      bodyEl = el("div", { class: "lrow-body", id: bodyId },
        id ? el("div", { class: "lrow-idline" }, el("span", { class: "lrow-idlabel" }, "ID"), idButton(id, { focus: `rowid2:${k}` })) : null,
        (body() || []).filter(Boolean));
      card.append(bodyEl);
    } else if (!next && bodyEl) { bodyEl.remove(); bodyEl = null; }
  }
  function toggle() {
    const next = !card.classList.contains("open");
    setOpen(next);
    onToggle?.(next);
  }
  if (expandable && open) setOpen(true);
  return card;
}

// ---------- group header ----------
// A header above a group of rows ("Ad accounts" grouped by business): [16 px picture] Name · count ........ subtotal. Not clickable.
// avatar = { kind, url } or null; value / valueTitle as in row(). Sticky below the tabs (rows.css).
export function groupHeader({ avatar, name, count, value, valueTitle }) {
  const label = String(name ?? "");
  return el("div", { class: "lgroup", role: "heading", "aria-level": "2" },
    el("span", { class: "lgroup-name", title: label },
      avatar ? avatarEl(avatar.kind, avatar.url) : null,
      el("span", { class: "lgroup-text", dir: "auto" }, label),
      present(count) ? el("span", { class: "lgroup-count" }, `· ${count}`) : null),
    present(value) ? el("span", { class: "lgroup-value", title: valueTitle || null }, value) : null);
}
