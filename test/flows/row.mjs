// The shared list row (js/row.js + css/rows.css), rendered in a lab inside the real popup page (no tab uses it yet): structure and
// ARIA of the stretched-button pattern, keyboard, the lazy body, silent healthy rows, problem rows (status word + fix link + "+N"),
// copy button (no toggle, ✓, live region, no toast), selection, avatars (24 px, fallbacks, never a bad URL), hit areas, layout at
// 560 and 380 px, group header, kv / whatToDo / linksRow. Fictional data; nothing leaves the machine.
import path from "node:path";
import { ok, has, boot, popup, until, captureClipboard, clip, done, tr, near } from "../harness.mjs";

const SHOT = process.env.ROW_SHOT_DIR || "";                 // when set, screenshots of the lab go there
const FB = "https://scontent.xx.fbcdn.net/v/t39.30808-1/";
const URL_REVIEW = "https://www.facebook.com/accountquality/", URL_ADS = "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=111";

// Builds the lab inside the popup page: a list of rows made by row.js. window.__lab records every body build and toggle.
async function buildLab(pop) {
  await pop.evaluate(async ({ fb, review, ads }) => {
    const m = await import(chrome.runtime.getURL("js/row.js"));
    const lab = window.__lab = { built: {}, toggles: [], clicks: [] };
    document.addEventListener("click", (e) => { const a = e.target.closest?.("a"); if (a) { lab.clicks.push(a.href); e.preventDefault(); } }, true);   // no new tabs
    const host = document.createElement("div");
    host.id = "lab"; host.className = "list";
    document.body.append(host);
    const body = (key, extra = []) => () => {
      lab.built[key] = (lab.built[key] || 0) + 1;
      return [m.kv([["Clicks", "1,240"], ["CPC", "—"], ["Balance", "$0"], ["Timezone", "UTC+3 · Kyiv"], false, null, ["Country", ""],
        ["Payment", "Visa ···· 4242 and a long funding source description that has to wrap somewhere inside the column", { wide: true, title: "full text" }]]), ...extra,
        m.linksRow([{ id: "ads", label: "next.adsManager", url: ads }, { id: "bill", label: "next.billing", url: ads.replace("campaigns", "billing") }], { owner: key })];
    };
    const fix = { label: "next.review", url: review, tip: "Opens Account Quality" };
    const rows = [
      m.groupHeader({ avatar: { kind: "business", url: fb + "tailspin_50.jpg" }, name: "Tailspin Toys", count: 3, value: "≈ $1,770", valueTitle: "breakdown" }),
      m.row({ key: "healthy", avatar: { kind: "business", url: fb + "tailspin_50.jpg" }, name: "Tailspin Toys", value: "$1,240", status: { tone: "ok", text: "Active" },
        context: ["3 ad accounts"], id: { value: "1864109161555839", copiedMsg: "ID copied" }, body: body("healthy"), onToggle: (o) => lab.toggles.push(["healthy", o]) }),
      m.row({ key: "problem", name: "Nova Media — spring promo", value: "55,20 $ + 20,00 €", valueTitle: "55,20 $ + 20,00 €", status: { tone: "bad", text: "Ads policy", title: "Disabled: ads integrity" },
        fix, more: 2, id: { value: "111222333444555" },
        body: body("problem", [m.whatToDo({ help: "Meta stopped it for an ads-policy violation.", tone: "bad", owner: "Nova Media — spring promo",
          actions: [{ id: "ads", label: "next.adsManager", url: ads }, { id: "review", label: "next.review", url: review, primary: true }, { id: "billing", label: "next.billing", url: "javascript:alert(1)" }], skip: [fix] })]) }),
      m.row({ key: "warn", name: "Gamma Group", value: "0 $", valueMuted: true, status: { tone: "warn", text: "Unpaid" }, fix: { label: "next.pay", url: ads }, id: { value: "7" }, body: body("warn") }),
      m.row({ key: "grey", name: "Closed account", value: "—", valueMuted: true, status: { tone: "", text: "Closed" }, id: { value: "42" }, body: body("grey") }),
      m.row({ key: "long", avatar: { kind: "page", url: fb + "broken_50.jpg" }, name: "A very long name that cannot possibly fit on one line of a popup of this width, whatever the font is", value: "@nova.travel", valueMuted: true,
        status: { tone: "bad", text: "A very long problem phrase that has to be cut with an ellipsis and never wrap" }, fix: { label: "next.review", url: review }, more: 3, id: { value: "999888777666555" }, body: body("long") }),
      m.row({ key: "evil", avatar: { kind: "page", url: "https://evil.example.com/t.png" }, name: "Evil picture", value: "", context: ["IG: page", "Published"], id: { value: "5" }, body: body("evil") }),
      m.row({ key: "bare", avatar: { kind: "business", url: null }, name: "No status, no ID", body: body("bare") }),
      m.row({ key: "flat", name: "Flat row (nothing to open)", value: "$3", status: { tone: "ok", text: "Active" } }),
      m.row({ key: "open", avatar: { kind: "business", url: fb + "tailspin_50.jpg" }, name: "Starts open", value: "$9", open: true, status: { tone: "warn", text: "In review" }, body: body("open"), id: { value: "123" } }),
    ];
    host.append(...rows);
  }, { fb: FB, review: URL_REVIEW, ads: URL_ADS });
}
const q = (p, fn, arg) => p.evaluate(fn, arg);
const rowSel = (key) => `#lab .lrow[data-row="${key}"]`;
const rect = (p, sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; }, sel);
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.body.scrollWidth <= document.body.clientWidth);

async function rowFlow() {
  console.log("\n# row: the shared list row (lab inside the popup page)");
  const b = await boot({ graph: () => ({ body: { data: [] } }) });
  const pop = await popup(b, "token");
  await captureClipboard(pop);
  await buildLab(pop);
  ok("the lab rendered 9 rows and a group header", (await pop.locator(`#lab .lrow`).count()) === 9 && (await pop.locator(`#lab .lgroup`).count()) === 1);

  // ---- structure and ARIA ----
  const s = await q(pop, () => {
    const r = document.querySelector('#lab .lrow[data-row="problem"]'), btn = r.querySelector("button.lrow-title"), sub = r.querySelector(".lrow-sub");
    return { tag: btn.tagName, expanded: btn.getAttribute("aria-expanded"), controls: btn.getAttribute("aria-controls"), describedby: btn.getAttribute("aria-describedby"), subId: sub.id, valId: r.querySelector(".lrow-value").id,
      desc: btn.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id).textContent.replace(/\s+/g, " ").trim()).join(" | "),
      subText: sub.textContent.replace(/\s+/g, " ").trim(), buttons: r.querySelectorAll("button").length, links: r.querySelectorAll("a").length, name: btn.textContent.trim(), titleAttr: btn.title,
      controlsExists: !!document.getElementById(btn.getAttribute("aria-controls")), tab: btn.tabIndex };
  });
  ok("the name is a real <button aria-expanded=false aria-controls aria-describedby=value + line 2>", s.tag === "BUTTON" && s.expanded === "false" && s.describedby === `${s.valId} ${s.subId}` && /^lrow-val-\d+$/.test(s.valId) && /^lrow-body-\d+$/.test(s.controls) && !s.controlsExists, JSON.stringify(s));
  ok("…the description a screen reader gives is the amount, then line 2: '55,20 $ + 20,00 € | Ads policy Appeal +2 more'", has(s.desc, "55,20 $ + 20,00 €") && s.desc.endsWith(`| Ads policy${tr("next.review")}${tr("row.more", { n: 2 })}`), s.desc);
  ok("…its accessible name is the name only; the full name is its tooltip", s.name === "Nova Media — spring promo" && s.titleAttr === "Nova Media — spring promo");
  ok("…line 2 reads: the problem word, the fix, '+2 more'", s.subText === `Ads policy${tr("next.review")}${tr("row.more", { n: 2 })}`, s.subText);   // the "·" between the items is CSS, not text
  ok("…the row has exactly one name button, the copy button, and one fix link in its head", s.buttons === 2 && s.links === 1, JSON.stringify(s));
  const dom = await q(pop, () => [...document.querySelectorAll("#lab .lrow")].every((r) => r.querySelector(".lrow-head") && !r.querySelector(".lrow-head a, .lrow-head button")?.closest("button.lrow-title")?.querySelector("a, button")));
  ok("…no interactive control nested inside another", dom);

  // ---- healthy rows are silent ----
  const h = await q(pop, () => {
    const r = document.querySelector('#lab .lrow[data-row="healthy"]');
    return { status: !!r.querySelector(".lrow-status"), dot: !!r.querySelector(".lrow-dot"), sr: r.querySelector(".sr-only")?.textContent, srVisible: r.querySelector(".sr-only").getBoundingClientRect().width,
      sub: r.querySelector(".lrow-sub").textContent.replace(/\s+/g, " ").trim(), fix: !!r.querySelector(".lrow-fix") };
  });
  ok("a healthy row prints no status word and no dot; the word is there for screen readers only", !h.status && !h.dot && h.sr === "Active" && h.srVisible <= 1, JSON.stringify(h));
  const hd = await q(pop, () => { const btn = document.querySelector('#lab .lrow[data-row="healthy"] .lrow-title'); return btn.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id).textContent.replace(/\s+/g, " ").trim()).join(" | "); });
  ok("…and it is part of the button's description: '$1,240 | Active3 ad accounts' (value, the sr-only status, the context)", hd === "$1,240 | Active3 ad accounts", hd);
  ok("names carry dir=auto (a right-to-left name from Graph lays itself out)", await q(pop, () => [...document.querySelectorAll("#lab .lrow-name, #lab .lgroup-text")].every((n) => n.getAttribute("dir") === "auto")));
  ok("…line 2 shows the context ('3 ad accounts') and nothing else", h.sub === "Active3 ad accounts" && !h.fix, h.sub);
  const g = await q(pop, () => {
    const st = (k) => { const e = document.querySelector(`#lab .lrow[data-row="${k}"] .lrow-status`); return e && { text: e.textContent.trim(), cls: e.className, title: e.title, color: getComputedStyle(e).color, dot: getComputedStyle(e.querySelector(".lrow-dot")).backgroundColor }; };
    return { bad: st("problem"), warn: st("warn"), grey: st("grey") };
  });
  ok("a problem shows a dot + the problem word in its tone: bad red, warn amber, neutral grey; the tooltip is the status title", g.bad.text === "Ads policy" && g.bad.color === "rgb(207, 33, 39)" && g.bad.dot === "rgb(250, 56, 62)" && g.bad.title === "Disabled: ads integrity"
    && g.warn.color === "rgb(138, 97, 0)" && g.warn.dot === "rgb(247, 185, 40)" && g.grey.text === "Closed" && g.grey.dot === "rgb(188, 192, 196)" && g.grey.color === "rgb(96, 103, 112)", JSON.stringify(g));

  // ---- the fix link ----
  const fx = await q(pop, () => {
    const a = document.querySelector('#lab .lrow[data-row="problem"] .lrow-fix');
    const cs = getComputedStyle(a), lab = a.querySelector(".act-label"), r = a.getBoundingClientRect();
    return { href: a.href, target: a.target, rel: a.rel, aria: a.getAttribute("aria-label"), title: a.title, icon: !!a.querySelector(".i"), focus: a.dataset.focus, color: cs.color, deco: getComputedStyle(lab).textDecorationLine,
      h: r.height, z: cs.zIndex, pos: cs.position };
  });
  ok("the fix is an underlined link in the problem's colour, no ↗ icon, new tab, noopener noreferrer, owner in its accessible name, tooltip", fx.href === URL_REVIEW && fx.target === "_blank" && fx.rel === "noopener noreferrer" && fx.aria === `${tr("next.review")} · Nova Media — spring promo` && fx.title === "Opens Account Quality" && !fx.icon && fx.deco === "underline" && fx.color === "rgb(207, 33, 39)", JSON.stringify(fx));
  ok("…24 px high hit area, above the row's covering area", fx.h >= 24 && fx.pos === "relative" && fx.z === "1", JSON.stringify(fx));
  const more = await q(pop, () => { const e = document.querySelector('#lab .lrow[data-row="problem"] .lrow-more'); return { text: e.textContent, title: e.title }; });
  ok("'+2 more' is muted text with a tooltip", more.text === tr("row.more", { n: 2 }) && more.title === tr("row.moreTitle", { n: 2 }), JSON.stringify(more));

  // ---- value ----
  const v = await q(pop, () => ["healthy", "problem", "warn", "grey", "long"].map((k) => { const e = document.querySelector(`#lab .lrow[data-row="${k}"] .lrow-value`); const cs = getComputedStyle(e); const hd = document.querySelector(`#lab .lrow[data-row="${k}"] .lrow-head`).getBoundingClientRect();
    return { k, text: e.textContent, tab: cs.fontVariantNumeric, muted: e.classList.contains("muted"), color: cs.color, rightGap: Math.round(hd.right - e.getBoundingClientRect().right), align: cs.justifySelf }; }));
  ok("values are right-aligned 16 px from the edge, tabular digits; muted ones (0, —, handle) are secondary grey", v.every((x) => x.rightGap === 16 && has(x.tab, "tabular-nums")) && v.filter((x) => x.muted).every((x) => x.color === "rgb(96, 103, 112)") && v.find((x) => x.k === "healthy").color === "rgb(28, 30, 33)", JSON.stringify(v));

  // ---- avatars ----
  await until(pop, () => !!document.querySelector('#lab .lrow[data-row="healthy"] .lav.ok'));
  await until(pop, () => !document.querySelector('#lab .lrow[data-row="long"] .lav-img'));
  const av = await q(pop, () => {
    const info = (k) => { const box = document.querySelector(`#lab .lrow[data-row="${k}"] .lav`); if (!box) return null; const img = box.querySelector("img"), ic = box.querySelector(".i"), cs = getComputedStyle(box);
      return { w: box.offsetWidth, h: box.offsetHeight, radius: cs.borderRadius, bg: cs.backgroundColor, aria: box.getAttribute("aria-hidden"), ok: box.classList.contains("ok"),
        img: img && { rp: img.getAttribute("referrerpolicy"), loading: img.getAttribute("loading"), decoding: img.getAttribute("decoding"), alt: img.getAttribute("alt"), src: img.getAttribute("src"), natural: img.naturalWidth },
        icon: ic.className, iconVisible: getComputedStyle(ic).visibility, mask: getComputedStyle(ic).maskImage || getComputedStyle(ic).webkitMaskImage }; };
    return { healthy: info("healthy"), long: info("long"), evil: info("evil"), bare: info("bare"), group: (() => { const box = document.querySelector("#lab .lgroup .lav"); return { w: box.offsetWidth, radius: getComputedStyle(box).borderRadius }; })() };
  });
  ok("a business picture on fbcdn.net: 24 px rounded square (5 px), <img alt='' no-referrer lazy async>, decorative, loaded → the placeholder is hidden", av.healthy.w === 24 && av.healthy.h === 24 && av.healthy.radius === "5px" && av.healthy.aria === "true" && av.healthy.ok
    && av.healthy.img.alt === "" && av.healthy.img.rp === "no-referrer" && av.healthy.img.loading === "lazy" && av.healthy.img.decoding === "async" && av.healthy.img.natural > 0 && av.healthy.iconVisible === "hidden", JSON.stringify(av.healthy));
  ok("a page picture that fails to load: the <img> is removed, the Lucide flag on a muted circle stays (never a broken image)", av.long.w === 24 && !av.long.img && !av.long.ok && has(av.long.mask, "flag.svg") && has(av.long.icon, "i-flag") && parseFloat(av.long.radius) >= 12 && av.long.bg === "rgb(240, 242, 245)" && av.long.iconVisible === "visible", JSON.stringify(av.long));
  ok("a URL on another host is never used: no <img>, the flag", !av.evil.img && has(av.evil.mask, "flag.svg"), JSON.stringify(av.evil));
  ok("a business without a URL: the Lucide building on a rounded square", !av.bare.img && has(av.bare.mask, "building-2.svg") && av.bare.radius === "5px", JSON.stringify(av.bare));
  ok("the group header's picture is 16 px", av.group.w === 16, JSON.stringify(av.group));
  const asked = b.images.filter((x) => /evil|t\.png/.test(x));
  ok("…and no request went to the other host", asked.length === 0, asked.join());

  // ---- layout at 560 ----
  const lay = await q(pop, () => {
    const out = {};
    for (const k of ["healthy", "problem", "long", "bare", "flat"]) {
      const r = document.querySelector(`#lab .lrow[data-row="${k}"]`), hd = r.querySelector(".lrow-head"), name = r.querySelector(".lrow-name"), sub = r.querySelector(".lrow-sub");
      out[k] = { h: Math.round(hd.getBoundingClientRect().height), nameCut: name.scrollWidth > name.clientWidth, nameOverflow: getComputedStyle(name).textOverflow, subH: sub ? Math.round(sub.getBoundingClientRect().height) : null,
        subScroll: sub ? sub.scrollWidth <= sub.clientWidth + 1 : null, st: r.querySelector(".lrow-status-text") && (() => { const e = r.querySelector(".lrow-status-text"); return { cut: e.scrollWidth > e.clientWidth, ov: getComputedStyle(e).textOverflow }; })() };
    }
    return out;
  });
  ok("collapsed rows are two lines and ALL the same height (68 px, with or without a picture), a long name ends in an ellipsis", near(lay.healthy.h, 68) && near(lay.problem.h, 68) && near(lay.long.h, 68) && near(lay.bare.h, 68) && near(lay.flat.h, 68) && lay.long.nameCut && lay.long.nameOverflow === "ellipsis", JSON.stringify(lay));
  ok("line 2 never wraps (one 17-px line); a long status phrase is cut with an ellipsis while the fix and '+3' keep their width", lay.long.subH <= 24 && lay.long.st.cut && lay.long.st.ov === "ellipsis" && lay.long.subScroll, JSON.stringify(lay.long));
  const keep = await q(pop, () => { const r = document.querySelector('#lab .lrow[data-row="long"]'), fixR = r.querySelector(".lrow-fix").getBoundingClientRect(), sub = r.querySelector(".lrow-sub").getBoundingClientRect(), more = r.querySelector(".lrow-more").getBoundingClientRect(); return { fixInside: fixR.right <= sub.right + 1, moreInside: more.right <= sub.right + 1, fixW: Math.round(fixR.width) }; });
  ok("…the fix link and '+3' are fully inside line 2", keep.fixInside && keep.moreInside && keep.fixW > 40, JSON.stringify(keep));
  ok("no fix label is ever cut: 'Pay' shows whole (the 24 px hit area is padding that a negative margin takes back, not width the text loses)", await q(pop, () => [...document.querySelectorAll("#lab .lrow-head .lrow-fix .act-label")].length === 3 && [...document.querySelectorAll("#lab .lrow-head .lrow-fix .act-label")].every((e) => e.scrollWidth <= e.clientWidth)));
  ok("no horizontal scroll at 560 px", await noHScroll(pop));
  const idc = await q(pop, () => { const out = {}; for (const k of ["healthy", "long"]) { const e = document.querySelector(`#lab .lrow[data-row="${k}"] .lrow-idc`), hd = document.querySelector(`#lab .lrow[data-row="${k}"] .lrow-head`).getBoundingClientRect(); const r = e.getBoundingClientRect(); out[k] = { shown: getComputedStyle(e).display !== "none", rightGap: Math.round(hd.right - r.right), text: e.textContent.trim(), color: getComputedStyle(e.querySelector(".lrow-id")).color }; } return out; });
  ok("the full ID is right-aligned under the value, muted, on collapsed rows at 560 px", idc.healthy.shown && idc.healthy.text === "1864109161555839" && idc.healthy.rightGap === 16 && idc.long.text === "999888777666555" && idc.healthy.color === "rgb(96, 103, 112)", JSON.stringify(idc));
  const cp = await q(pop, () => { const b = document.querySelector('#lab .lrow[data-row="healthy"] .lrow-head .lrow-id'); const r = b.getBoundingClientRect(); return { tab: b.getAttribute("tabindex"), h: Math.round(r.height), w: Math.round(r.width), aria: b.getAttribute("aria-label"), title: b.title, focus: b.dataset.focus }; });
  ok("the copy button on a collapsed row is for the mouse (tabindex -1), ≥ 24 px high, named 'Copy ID <id>'", cp.tab === "-1" && cp.h >= 24 && cp.aria === `${tr("acc.copyId")} 1864109161555839` && cp.title === tr("acc.copyId") && cp.focus === "rowid:healthy", JSON.stringify(cp));
  const hov = await q(pop, () => { const r = document.querySelector("#lab .lrow"); return { clickable: getComputedStyle(r.querySelector(".lrow-head")).cursor, pos: getComputedStyle(r.querySelector(".lrow-title"), "::after").position, content: getComputedStyle(r.querySelector(".lrow-title"), "::after").content }; });
  ok("the name button's ::after is the covering area (absolute, over the whole head)", hov.pos === "absolute" && hov.content !== "none" && hov.clickable === "pointer", JSON.stringify(hov));
  const sticky = await q(pop, () => getComputedStyle(document.querySelector("#lab .lgroup")).position);
  ok("the group header is sticky", sticky === "sticky");
  const gh = await q(pop, () => { const g = document.querySelector("#lab .lgroup"); return { role: g.getAttribute("role"), level: g.getAttribute("aria-level"), text: g.textContent.replace(/\s+/g, " ").trim(), valueTitle: g.querySelector(".lgroup-value").title, size: getComputedStyle(g).fontSize }; });
  ok("the group header: heading role (level 2, under the h1), 'Tailspin Toys · 3', the subtotal with its tooltip, 12 px", gh.role === "heading" && gh.level === "2" && gh.text === "Tailspin Toys· 3≈ $1,770" && gh.valueTitle === "breakdown" && gh.size === "12px", JSON.stringify(gh));
  if (SHOT) await pop.screenshot({ path: path.join(SHOT, "rows-lab-560.png"), fullPage: true });

  // ---- keyboard focus ring (first: no mouse has touched the page yet) ----
  await pop.focus(`#lab .lrow[data-row="problem"] .lrow-title`);
  await pop.keyboard.press("Shift+Tab"); await pop.keyboard.press("Tab");           // a key press: from now on focus is :focus-visible
  const ring = await q(pop, () => { const hd = document.querySelector('#lab .lrow[data-row="problem"] .lrow-head'); const cs = getComputedStyle(hd); return { outline: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, focusedKey: document.activeElement.dataset.focus }; });
  ok("keyboard focus on the name draws a ring around the whole row (:has(:focus-visible)); the control carries data-focus 'row:<key>'", ring.outline === "solid" && ring.width === "2px" && ring.focusedKey === "row:problem", JSON.stringify(ring));

  // ---- lazy body + toggling ----
  ok("nothing is built while rows are closed (only the row that starts open built its body)", await q(pop, () => JSON.stringify(window.__lab.built) === '{"open":1}' && document.querySelectorAll("#lab .lrow-body").length === 1), JSON.stringify(await q(pop, () => window.__lab.built)));
  const o = await q(pop, () => { const r = document.querySelector('#lab .lrow[data-row="open"]'); return { expanded: r.querySelector(".lrow-title").getAttribute("aria-expanded"), cls: r.classList.contains("open"), body: !!r.querySelector(".lrow-body"), toggles: window.__lab.toggles.length }; });
  ok("a row that starts open has aria-expanded=true and its body, and onToggle was not called for it", o.expanded === "true" && o.cls && o.body && o.toggles === 0, JSON.stringify(o));
  await pop.click(`#lab .lrow[data-row="healthy"] .lrow-title`);
  const t1 = await q(pop, () => { const r = document.querySelector('#lab .lrow[data-row="healthy"]'); const bd = r.querySelector(".lrow-body"); return { expanded: r.querySelector(".lrow-title").getAttribute("aria-expanded"), body: !!bd, built: window.__lab.built.healthy, toggles: JSON.stringify(window.__lab.toggles), bodyId: bd?.id, controls: r.querySelector(".lrow-title").getAttribute("aria-controls") }; });
  ok("a click on the name opens: aria-expanded=true, the body is built once and is what aria-controls points at, onToggle(true) fired", t1.expanded === "true" && t1.body && t1.built === 1 && t1.toggles === '[["healthy",true]]' && t1.bodyId === t1.controls, JSON.stringify(t1));
  await pop.click(`#lab .lrow[data-row="healthy"] .lrow-title`);
  const t2 = await q(pop, () => ({ body: !!document.querySelector('#lab .lrow[data-row="healthy"] .lrow-body'), expanded: document.querySelector('#lab .lrow[data-row="healthy"] .lrow-title').getAttribute("aria-expanded"), built: window.__lab.built.healthy, toggles: window.__lab.toggles.length }));
  ok("a second click closes it and throws the body away (it is built again on the next open); onToggle(false)", !t2.body && t2.expanded === "false" && t2.built === 1 && t2.toggles === 2, JSON.stringify(t2));
  // keyboard
  await pop.focus(`#lab .lrow[data-row="grey"] .lrow-title`);
  await pop.keyboard.press("Enter");
  ok("Enter on the focused name opens the row exactly once", await q(pop, () => document.querySelector('#lab .lrow[data-row="grey"] .lrow-title').getAttribute("aria-expanded") === "true" && window.__lab.built.grey === 1));
  await pop.keyboard.press("Space");
  ok("Space closes it", await q(pop, () => document.querySelector('#lab .lrow[data-row="grey"] .lrow-title').getAttribute("aria-expanded") === "false"));
  // clicking anywhere on the row: the value (above the cover), the empty padding (the cover itself)
  await pop.click(`#lab .lrow[data-row="grey"] .lrow-value`);
  ok("a click on the value (it sits above the cover) toggles the row too", await q(pop, () => document.querySelector('#lab .lrow[data-row="grey"] .lrow-title').getAttribute("aria-expanded") === "true"));
  const hr = await rect(pop, `#lab .lrow[data-row="grey"] .lrow-head`);
  await pop.mouse.click(hr.x + 5, hr.y + 5);
  ok("a click on the row's padding (the cover) closes it", await q(pop, () => document.querySelector('#lab .lrow[data-row="grey"] .lrow-title').getAttribute("aria-expanded") === "false"));
  await pop.click(`#lab .lrow[data-row="grey"] .lrow-status`);
  ok("a click on the status toggles too", await q(pop, () => document.querySelector('#lab .lrow[data-row="grey"] .lrow-title').getAttribute("aria-expanded") === "true"));
  await pop.click(`#lab .lrow[data-row="grey"] .lrow-title`);

  // ---- inner controls never toggle ----
  await pop.click(`#lab .lrow[data-row="problem"] .lrow-fix`);
  const fclick = await q(pop, () => ({ open: document.querySelector('#lab .lrow[data-row="problem"]').classList.contains("open"), clicks: window.__lab.clicks.at(-1) }));
  ok("a click on the fix link does not toggle the row (and would open its URL)", !fclick.open && fclick.clicks === URL_REVIEW, JSON.stringify(fclick));
  await pop.evaluate(() => { document.querySelector("#toast").className = "toast"; window.__lab.before = document.querySelector("#toast").textContent; });
  await pop.click(`#lab .lrow[data-row="healthy"] .lrow-head .lrow-id`);
  const cc = await q(pop, () => { const r = document.querySelector('#lab .lrow[data-row="healthy"]'); const ic = r.querySelector(".lrow-head .lrow-id .i"); return { open: r.classList.contains("open"), icon: ic.className, live: document.querySelector('[aria-live="polite"].sr-only')?.textContent, toast: document.querySelector("#toast").classList.contains("show") }; });
  ok("a click on the copy icon copies the full ID, does not toggle, swaps the icon to ✓ and announces 'ID copied' in a live region (no toast)", !cc.open && has(cc.icon, "i-tick") && cc.live === "ID copied" && !cc.toast && (await clip(pop)).at(-1) === "1864109161555839", JSON.stringify({ ...cc, clip: await clip(pop) }));
  ok("…the live region is polite and screen-reader-only", await q(pop, () => { const l = document.querySelector('.sr-only[aria-live]'); return l.getAttribute("aria-live") === "polite" && l.getAttribute("role") === "status" && l.getBoundingClientRect().width <= 1; }));
  await until(pop, () => document.querySelector('#lab .lrow[data-row="healthy"] .lrow-head .lrow-id .i').className.includes("i-copy") && document.querySelector('.sr-only[aria-live]').textContent === "", null, 2500);       // the copy icon comes back by itself (a 1.5 s timer)
  const back = await q(pop, () => ({ icon: document.querySelector('#lab .lrow[data-row="healthy"] .lrow-head .lrow-id .i').className, live: document.querySelector('.sr-only[aria-live]').textContent }));
  ok("…after 1.5 s the ✓ is the copy icon again and the message is cleared", has(back.icon, "i-copy") && back.live === "", JSON.stringify(back));

  // ---- selection ----
  await q(pop, () => { const v = document.querySelector('#lab .lrow[data-row="grey"] .lrow-value'); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(v); s.addRange(r); });
  await q(pop, () => document.querySelector('#lab .lrow[data-row="grey"] .lrow-value').dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  ok("a mouse click that ends a text selection inside the head does not toggle the row", await q(pop, () => !document.querySelector('#lab .lrow[data-row="grey"]').classList.contains("open")));
  await q(pop, () => getSelection().removeAllRanges());
  await q(pop, () => document.querySelector('#lab .lrow[data-row="grey"] .lrow-value').dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  ok("…once nothing is selected it toggles again", await q(pop, () => document.querySelector('#lab .lrow[data-row="grey"]').classList.contains("open")));
  await pop.click(`#lab .lrow[data-row="grey"] .lrow-title`);

  // ---- the expanded body ----
  await pop.click(`#lab .lrow[data-row="problem"] .lrow-title`);
  const body = await q(pop, () => {
    const r = document.querySelector('#lab .lrow[data-row="problem"]'), bd = r.querySelector(".lrow-body"), dts = [...bd.querySelectorAll("dt")].map((x) => x.textContent);
    const todo = bd.querySelector(".lrow-todo"), links = [...todo.querySelectorAll("a")].map((a) => ({ text: a.textContent.trim(), cls: a.className, href: a.href, tab: a.tabIndex, h: Math.round(a.getBoundingClientRect().height) }));
    const idline = bd.querySelector(".lrow-idline");
    return { dts, first: bd.firstElementChild.className, idText: idline.textContent.replace(/\s+/g, " ").trim(), idTab: idline.querySelector("button").getAttribute("tabindex"), idFocus: idline.querySelector("button").dataset.focus,
      todoTitle: todo.querySelector(".lrow-todo-title").textContent, help: todo.querySelector(".lrow-todo-help")?.textContent, links, todoBox: getComputedStyle(todo).backgroundColor, linksRow: [...bd.querySelectorAll(".lrow-link")].map((a) => ({ text: a.textContent.trim(), icon: !!a.querySelector(".i-external"), aria: a.getAttribute("aria-label"), rel: a.rel })),
      pairs: bd.querySelectorAll(".lrow-pair").length, wide: bd.querySelectorAll(".lrow-pair.wide").length, cols: getComputedStyle(bd.querySelector(".lrow-kv")).gridTemplateColumns.split(" ").length, indent: Math.round(bd.getBoundingClientRect().left + parseFloat(getComputedStyle(bd).paddingLeft)), nameX: Math.round(r.querySelector(".lrow-name").getBoundingClientRect().left) };
  });
  ok("…and so do the values of the key–value list", await q(pop, () => [...document.querySelectorAll("#lab .lrow-body .lrow-pair dd")].length > 0 && [...document.querySelectorAll("#lab .lrow-body .lrow-pair dd")].every((n) => n.getAttribute("dir") === "auto")));
  ok("the body starts with a keyboard-reachable 'ID <id> ⧉' line", has(body.first, "lrow-idline") && body.idText === "ID111222333444555" && body.idTab === null && body.idFocus === "rowid2:problem", JSON.stringify(body));
  ok("kv drops the pairs that are '—', '', false or null (Clicks, Balance, Timezone, Payment stay; CPC, Country gone)", body.dts.join() === "Clicks,Balance,Timezone,Payment", body.dts.join());
  ok("…two columns at 560 px; a pair marked wide has a row of its own", body.cols === 2 && body.wide === 1, JSON.stringify([body.cols, body.wide]));
  ok("…the body is indented under the name", body.indent === body.nameX, JSON.stringify([body.indent, body.nameX]));
  ok("What to do: the help line, then ONLY the actions not already on line 2 (the 'Appeal' fix is not repeated; the javascript: URL is dropped)", body.todoTitle === tr("next.title") && has(body.help, "ads-policy") && body.links.map((l) => l.text).join() === tr("next.adsManager"), JSON.stringify(body.links));
  ok("…plain: no tint, links ≥ 24 px, still real links", body.todoBox === "rgba(0, 0, 0, 0)" && body.links.every((l) => l.h >= 24 && l.href.startsWith("https://")), JSON.stringify(body.links));
  ok("the muted links row keeps its ↗ icons and names the owner", body.linksRow.length === 2 && body.linksRow.every((l) => l.icon && l.aria.endsWith(": problem") && l.rel === "noopener noreferrer"), JSON.stringify(body.linksRow));
  await pop.click(`#lab .lrow[data-row="problem"] .lrow-title`);

  // whatToDo: primary first, and nothing when all actions are on line 2
  const wtd = await q(pop, async () => {
    const m = await import(chrome.runtime.getURL("js/row.js"));
    const u = (n) => `https://www.facebook.com/${n}`;
    const a = m.whatToDo({ help: "H", actions: [{ label: "next.adsManager", url: u(1) }, { label: "next.review", url: u(2), primary: true }, { label: "next.billing", url: u(3) }] });
    const onlyFix = m.whatToDo({ actions: [{ label: "next.review", url: u(2) }], skip: { label: "next.review", url: u(2) } });
    const helpOnly = m.whatToDo({ help: "Just words", actions: [{ label: "next.review", url: u(2) }], skip: [{ label: "next.review", url: u(2) }] });
    const sameUrlOtherLabel = m.whatToDo({ actions: [{ label: "next.quality", url: u(2) }, { label: "next.review", url: u(2) }], skip: [{ label: "next.review", url: u(2) }] });
    return { order: [...a.querySelectorAll("a")].map((x) => x.textContent.trim()).join(), primaryCls: a.querySelector("a.primary")?.textContent.trim(), onlyFix, helpOnly: helpOnly.querySelectorAll("a").length + "/" + helpOnly.querySelector("p").textContent,
      other: [...sameUrlOtherLabel.querySelectorAll("a")].map((x) => x.textContent.trim()).join(), nothing: m.whatToDo({}) === null, linksNone: m.linksRow([{ label: "next.review", url: "http://insecure" }, null]) === null, kvNone: m.kv([["A", "—"], ["B", ""], false]) === null,
      fixBad: m.fixLink({ label: "next.review", url: "javascript:alert(1)" }) === null };
  });
  ok("whatToDo puts the primary action first; with every action on line 2 and no help it is null; help alone still shows; the same URL under another label is kept", wtd.order === [tr("next.review"), tr("next.adsManager"), tr("next.billing")].join() && wtd.primaryCls === tr("next.review") && wtd.onlyFix === null && wtd.helpOnly === "0/Just words" && wtd.other === tr("next.quality") && wtd.nothing, JSON.stringify(wtd));
  ok("fixLink / linksRow refuse a URL that is not https; kv with nothing to show is null", wtd.fixBad && wtd.linksNone && wtd.kvNone, JSON.stringify(wtd));

  // ---- layout at 380 px ----
  await pop.setViewportSize({ width: 380, height: 900 });
  await pop.click(`#lab .lrow[data-row="healthy"] .lrow-title`);
  await pop.click(`#lab .lrow[data-row="problem"] .lrow-title`);
  const narrow = await q(pop, () => {
    const out = { idc: {}, rows: {} };
    for (const k of ["healthy", "problem", "long"]) {
      const r = document.querySelector(`#lab .lrow[data-row="${k}"]`), hd = r.querySelector(".lrow-head").getBoundingClientRect(), sub = r.querySelector(".lrow-sub"), name = r.querySelector(".lrow-name");
      out.idc[k] = getComputedStyle(r.querySelector(".lrow-idc")).display;
      out.rows[k] = { h: Math.round(hd.height), subH: Math.round(sub.getBoundingClientRect().height), cut: name.scrollWidth > name.clientWidth };
    }
    const bd = document.querySelector('#lab .lrow[data-row="problem"] .lrow-body');
    out.kvCols = getComputedStyle(bd.querySelector(".lrow-kv")).gridTemplateColumns.split(" ").length;
    out.bodyId = getComputedStyle(bd.querySelector(".lrow-idline")).display;
    out.idButtonVisible = bd.querySelector(".lrow-idline .lrow-id").getBoundingClientRect().width > 0;
    out.bodyScroll = bd.scrollWidth <= bd.clientWidth;
    return out;
  });
  ok("at 380 px the ID leaves the collapsed rows (it stays in the body, always reachable)", narrow.idc.healthy === "none" && narrow.idc.problem === "none" && narrow.bodyId !== "none" && narrow.idButtonVisible, JSON.stringify(narrow));
  ok("…rows stay two lines (line 2 does not wrap), long names are cut, the body is one column", narrow.rows.problem.subH <= 24 && narrow.rows.long.subH <= 24 && narrow.rows.long.cut && narrow.kvCols === 1 && narrow.bodyScroll, JSON.stringify(narrow));
  ok("…no horizontal scroll at 380 px", await noHScroll(pop));
  if (SHOT) await pop.screenshot({ path: path.join(SHOT, "rows-lab-380.png"), fullPage: true });
  await pop.setViewportSize({ width: 560, height: 900 });
  await done(b);
}

export const flows = { row: rowFlow };
