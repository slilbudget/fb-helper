// Review round 1, "Fix B": the polish of the shared row and of the top zone, measured in the real popup. Row lab (a few rows built by row.js in the
// popup page): the ID first on line 2 under the name, the copy icon on hover / focus only, equal heights, a context that cannot keep ~6 characters is dropped,
// an open row's name wraps, the link colour rule, weight 500 amounts, the fade-in of a body that was just opened, reduced motion, the contrast
// tokens, focus rings, the logical properties. Real tabs (Graph is a mock): chips on one scrollable line, five periods in one row at 380 px, the
// total on one line with its breakdown under it and a quiet attribution, a group header with the business's own picture.
import { TOK, ok, has, boot, adsPage, popup, until, rowsAre, adsFb, ROW, ratesOk, done, settle, tr, trx, untilText, near, lineTwo } from "../harness.mjs";

const FB = "https://scontent.xx.fbcdn.net/v/t39.30808-1/";
const URL_REVIEW = "https://www.facebook.com/accountquality/", URL_ADS = "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=111";
const q = (p, fn, arg) => p.evaluate(fn, arg);

async function buildLab(pop) {
  await pop.evaluate(async ({ fb, review, ads }) => {
    const m = await import(chrome.runtime.getURL("js/row.js"));
    document.addEventListener("click", (e) => { if (e.target.closest?.("a")) e.preventDefault(); }, true);
    const host = document.createElement("div"); host.id = "lab"; host.className = "list"; document.body.append(host);
    const body = () => [m.kv([["Clicks · CPC", "310 · 4,00 $"]]), m.whatToDo({ help: "Meta stopped it.", tone: "bad", owner: "x", actions: [{ id: "r", label: "next.review", url: review, primary: true }, { id: "s", label: "next.support", url: ads }] }),
      m.linksRow([{ id: "ads", label: "next.adsManager", url: ads }], { owner: "x" })];
    host.append(
      m.row({ key: "plain", name: "Plain account", value: "1 241 $", status: { tone: "ok", text: "Active" }, id: { value: "1864109161555839" }, body }),
      m.row({ key: "pic", avatar: { kind: "business", url: fb + "tailspin_50.jpg" }, name: "With a picture", value: "$862.00", status: { tone: "ok", text: "Active" }, context: ["3 ad accounts"], id: { value: "1864109161555840" }, body }),
      m.row({ key: "problem", name: "A problem row", value: "$0", valueMuted: true, status: { tone: "bad", text: "Ads policy" }, fix: { label: "next.review", url: review }, more: 1, id: { value: "111222333444555" }, body }),
      // a long problem word + its fix leave a context very little room: it must be dropped whole, not shown as "3…"
      m.row({ key: "tight", name: "Tight line", value: "$1", status: { tone: "bad", text: "Verification rejected by the platform" }, context: ["12 ad accounts · 4 disabled"], fix: { label: "next.review", url: review }, id: { value: "9" }, body }),
      m.row({ key: "roomy", name: "Roomy line", value: "$1", status: { tone: "bad", text: "Rejected" }, context: ["12 ad accounts · 4 disabled"], fix: { label: "next.review", url: review }, id: { value: "8" }, body }),
      m.row({ key: "longname", name: "NW / Performance / North America / Prospecting / Evergreen / Account 001 / and then a very long tail of the name", value: "$2,650", id: { value: "7" }, body }),
      m.row({ key: "startsopen", name: "Starts open", value: "$9", open: true, status: { tone: "warn", text: "Unpaid" }, id: { value: "6" }, body }),
    );
  }, { fb: FB, review: URL_REVIEW, ads: URL_ADS });
}
const R = (k) => `#lab .lrow[data-row="${k}"]`;

async function rowLabFlow() {
  console.log("\n# polish: the row, measured in the lab");
  const b = await boot({ graph: () => ({ body: { data: [] } }) });
  const pop = await popup(b, "token");
  await buildLab(pop);
  await until(pop, () => !!document.querySelector('#lab .lrow[data-row="pic"] .lav.ok'));

  // ---- the ID starts under the name; the copy icon is for hover / focus ----
  const al = await q(pop, () => ["plain", "pic", "problem"].map((k) => { const n = document.querySelector(`#lab .lrow[data-row="${k}"] .lrow-name`).getBoundingClientRect(), t = document.querySelector(`#lab .lrow[data-row="${k}"] .lrow-head .lrow-idtext`).getBoundingClientRect(); return Math.round(t.left) - Math.round(n.left); }));
  ok("the ID digits start exactly where the name's text starts, under it (with or without a picture); the copy icon is in the indent left of them, not on the line", al.every((d) => d === 0), JSON.stringify(al));
  const order = await q(pop, () => [...document.querySelector('#lab .lrow[data-row="plain"] .lrow-head .lrow-id').children].map((c) => c.className.split(" ")[0]));
  ok("…DOM order: icon first, digits second", order.join() === "i,lrow-idtext", order.join());
  const opIs = (k, want) => until(pop, ([sel, v]) => Number(getComputedStyle(document.querySelector(`${sel} .lrow-head .lrow-id .i`)).opacity) === v, [R(k), want]);       // the fade of the copy icon has ended
  const op = (k) => q(pop, (sel) => Number(getComputedStyle(document.querySelector(`${sel} .lrow-head .lrow-id .i`)).opacity), R(k));
  await pop.mouse.move(0, 0);
  ok("the copy icon is invisible at rest", (await op("plain")) === 0, String(await op("plain")));
  await pop.hover(`${R("plain")} .lrow-head`); await opIs("plain", 1);
  ok("…visible while the row is hovered", (await op("plain")) === 1, String(await op("plain")));
  await pop.mouse.move(0, 0); await opIs("plain", 0);
  await pop.keyboard.press("Shift"); await pop.focus(`${R("plain")} .lrow-head .lrow-id`); await opIs("plain", 1);          // a key press first: from now on focus is :focus-visible
  ok("…and while the button has keyboard focus", (await op("plain")) === 1);
  await pop.evaluate(() => document.activeElement.blur()); await pop.mouse.move(0, 0);

  // ---- equal heights, the amount's weight ----
  const hs = await q(pop, () => [...document.querySelectorAll("#lab .lrow")].map((r) => Math.round(r.querySelector(".lrow-head").getBoundingClientRect().height)));
  ok("every collapsed row is 68 px: with or without a picture, with or without a status", hs.every((h) => near(h, 68)), JSON.stringify(hs));
  const wt = await q(pop, () => ({ amount: getComputedStyle(document.querySelector('#lab .lrow[data-row="plain"] .lrow-value')).fontWeight, muted: getComputedStyle(document.querySelector('#lab .lrow[data-row="problem"] .lrow-value')).fontWeight }));
  ok("amounts are weight 500, a muted amount (zero, dash, handle) stays 400", wt.amount === "500" && wt.muted === "400", JSON.stringify(wt));

  // ---- the context that cannot keep ~6 characters is dropped ----
  await pop.setViewportSize({ width: 380, height: 900 }); await settle(pop);
  const fit = await q(pop, () => Object.fromEntries(["tight", "roomy", "pic"].map((k) => { const it = document.querySelector(`#lab .lrow[data-row="${k}"] .lrow-it.ctx`), c = it.firstElementChild;
    return [k, { hidden: it.hidden, shown: it.getBoundingClientRect().width > 1, w: Math.round(c.clientWidth), cut: c.scrollWidth > c.clientWidth }]; })));
  const quiet = await q(pop, () => { const at = (k) => { const r = document.querySelector(`#lab .lrow[data-row="${k}"]`), hd = r.querySelector(".lrow-head").getBoundingClientRect(), n = r.querySelector(".lrow-name").getBoundingClientRect(), t = r.querySelector(".lrow-idtext").getBoundingClientRect(); return { h: Math.round(hd.height), nameTop: Math.round(n.top - hd.top), idTop: Math.round(t.top - hd.top), items: [...r.querySelectorAll(".lrow-sub .lrow-it")].length }; };
    return { plain: at("plain"), problem: at("problem") }; });
  ok("below 480 px a healthy row has the ID on line 2 and nothing else (one item): 68 px high like the others, its name at the top and the ID on the second line at the same y as on a problem row (no centring, no hidden ID)",
    quiet.plain.items === 1 && near(quiet.plain.h, 68) && quiet.plain.nameTop === quiet.problem.nameTop && quiet.plain.idTop === quiet.problem.idTop && quiet.plain.idTop > quiet.plain.nameTop + 12, JSON.stringify(quiet));
  ok("a long problem word + its fix leave the context less than ~6 characters: it is dropped whole (no '12…')", fit.tight.hidden && !fit.tight.shown, JSON.stringify(fit.tight));
  ok("…a context with room stays (cut by an ellipsis if need be, never below ~6 characters); a short one stays whole", !fit.roomy.hidden && fit.roomy.w >= 44 && !fit.pic.hidden && !fit.pic.cut, JSON.stringify(fit));
  ok("…its '·' goes with it: line 2 of the tight row is 'ID · status · fix' (no dangling separator); the roomy one keeps its context: 'ID · status · context · fix'",
    (await lineTwo(pop, R("tight"))) === `9 · Verification rejected by the platform · ${tr("next.review")}` && (await lineTwo(pop, R("roomy"))) === `8 · Rejected · 12 ad accounts · 4 disabled · ${tr("next.review")}`, `${await lineTwo(pop, R("tight"))} // ${await lineTwo(pop, R("roomy"))}`);
  ok("…the dropped context stays in the accessibility tree (visually hidden, not display: none): the row's description still reads it", await q(pop, () => { const r = document.querySelector('#lab .lrow[data-row="tight"]'); const d = document.getElementById(r.querySelector(".lrow-title").getAttribute("aria-describedby").split(" ").at(-1)); return d.textContent.includes("12 ad accounts") && getComputedStyle(r.querySelector(".lrow-it.ctx")).display !== "none"; }));
  await pop.setViewportSize({ width: 560, height: 900 }); await settle(pop);
  ok("…widen the window and it comes back (the line is measured again)", await q(pop, () => !document.querySelector('#lab .lrow[data-row="tight"] .lrow-it.ctx').hidden));

  // ---- opening a row moves nothing in its head ----
  const nm = async () => q(pop, () => { const r = document.querySelector('#lab .lrow[data-row="longname"]'), n = r.querySelector(".lrow-name"); return { open: r.classList.contains("open"), cut: n.scrollWidth > n.clientWidth, ws: getComputedStyle(n).whiteSpace, h: Math.round(r.querySelector(".lrow-head").getBoundingClientRect().height),
    valueTop: Math.round(r.querySelector(".lrow-value").getBoundingClientRect().top - r.querySelector(".lrow-head").getBoundingClientRect().top) }; });
  const closed = await nm();
  await pop.click(`${R("longname")} .lrow-title`);
  const opened = await nm();
  ok("collapsed and open alike: one line with an ellipsis, the head keeps its height and the amount its place (opening moves nothing)", closed.cut && closed.ws === "nowrap" && opened.open && opened.cut && opened.ws === "nowrap" && opened.h === closed.h && opened.valueTop === closed.valueTop, JSON.stringify([closed, opened]));
  await pop.click(`${R("longname")} .lrow-title`);

  // ---- no motion anywhere (user decision): opening a row is instant, nothing has a transition or an animation ----
  await pop.click(`${R("plain")} .lrow-title`);
  const mo = await q(pop, () => [...document.querySelectorAll("*")].filter((n) => { const c = getComputedStyle(n); return c.animationName !== "none" || !/^0s(, 0s)*$/.test(c.transitionDuration); }).map((n) => n.className || n.tagName));
  ok("no element has an animation or a transition (open row included)", mo.length === 0, JSON.stringify(mo.slice(0, 5)));
  await pop.click(`${R("plain")} .lrow-title`);

  // ---- the link colour rule: tone for a fix, grey for a plain link, accent only inside the extension ----
  await pop.click(`${R("problem")} .lrow-title`);
  const lc = await q(pop, () => { const c = (s) => getComputedStyle(document.querySelector(s)).color;
    return { line2: c('.lrow[data-row="problem"] .lrow-head .lrow-fix'), todoPrimary: c('.lrow[data-row="problem"] .lrow-todo-link.primary'), todoSecond: c('.lrow[data-row="problem"] .lrow-todo-link:not(.primary)'), places: c('.lrow[data-row="problem"] .lrow-links .lrow-link') }; });
  ok("the fix on line 2 and the links of 'What to do' are in the tone of the problem (red); the muted links row is grey; no accent blue", lc.line2 === "rgb(207, 33, 39)" && lc.todoPrimary === "rgb(207, 33, 39)" && lc.todoSecond === "rgb(207, 33, 39)" && lc.places === "rgb(96, 103, 112)", JSON.stringify(lc));
  const todoTone = await q(pop, () => getComputedStyle(document.querySelector('#lab .lrow[data-row="problem"] .lrow-todo-title')).color);
  ok("…and the small title of 'What to do' says the same red", todoTone === "rgb(207, 33, 39)", todoTone);
  await pop.click(`${R("problem")} .lrow-title`);

  // ---- contrast tokens ----
  await until(pop, () => getComputedStyle(document.querySelector('#lab .lrow[data-row="plain"] .lrow-title .i-chevron')).color === "rgb(138, 144, 153)");       // the chevron's colour transition has ended
  const tk = await q(pop, () => { const root = getComputedStyle(document.documentElement); const tok = (n) => root.getPropertyValue(n).trim().toUpperCase();
    return { success: tok("--color-success"), error: tok("--color-error"), icon: tok("--color-icon"), chevron: getComputedStyle(document.querySelector('#lab .lrow[data-row="plain"] .lrow-title .i-chevron')).color,
      placeholder: getComputedStyle(document.querySelector("#tokenBox"), null).color }; });
  ok("the contrast tokens: success #247A37, error #CF2127, quiet icons #8A9099 (the chevron), the empty token field in the secondary grey", tk.success === "#247A37" && tk.error === "#CF2127" && tk.icon === "#8A9099" && tk.chevron === "rgb(138, 144, 153)", JSON.stringify(tk));
  ok("…a search field's placeholder is the secondary grey (not the disabled one)", await q(pop, () => { const i = document.createElement("input"); i.className = "field"; i.placeholder = "x"; document.body.append(i); const c = getComputedStyle(i, "::placeholder").color; i.remove(); return c === "rgb(96, 103, 112)"; }));

  // ---- keyboard focus is a ring ----
  await pop.focus('[data-tab="token"]'); await pop.keyboard.press("ArrowRight");
  const ring = await q(pop, () => { const cs = getComputedStyle(document.activeElement); return { tab: document.activeElement.dataset.tab, style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor }; });
  ok("keyboard focus on a tab draws a 2 px accent ring (not hover's look)", ring.tab === "cookies" && ring.style === "solid" && ring.width === "2px" && ring.color === "rgb(66, 103, 178)", JSON.stringify(ring));
  await pop.click(`${R("problem")} .lrow-title`);
  await pop.keyboard.press("Shift"); await pop.focus(`${R("problem")} .lrow-head .lrow-fix`);
  const fr = await q(pop, () => { const a = document.activeElement, cs = getComputedStyle(a), sub = a.closest(".lrow-sub"), r = a.getBoundingClientRect(), s = sub.getBoundingClientRect();
    return { isFix: a.classList.contains("lrow-fix"), style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, insideClip: r.top >= s.top - 4.5 && r.bottom <= s.bottom + 4.5 }; });
  ok("the fix link's ring is drawn INSIDE its padding (2 px, offset -2 px): line 2 clips what is more than 4 px outside the text", fr.isFix && fr.style === "solid" && fr.width === "2px" && fr.offset === "-2px" && fr.insideClip, JSON.stringify(fr));
  const sp = await q(pop, () => getComputedStyle(document.documentElement).scrollPaddingTop);
  ok("scroll-padding-top keeps a focused row clear of the fixed header and a group header (120 px)", sp === "120px", sp);

  // ---- logical properties: the row mirrors in a right-to-left document ----
  await pop.evaluate(() => { document.documentElement.dir = "rtl"; });
  const rtl = await q(pop, () => { const hd = document.querySelector('#lab .lrow[data-row="plain"] .lrow-head').getBoundingClientRect(), v = document.querySelector('#lab .lrow[data-row="plain"] .lrow-value').getBoundingClientRect(), n = document.querySelector('#lab .lrow[data-row="plain"] .lrow-name').getBoundingClientRect();
    return { valueAtStart: v.left - hd.left, nameAtEnd: hd.right - n.right }; });
  await pop.evaluate(() => { document.documentElement.dir = "ltr"; });
  ok("in a right-to-left document the amount moves to the left edge and the name to the right (16 px from each): no physical left / right in rows.css", Math.round(rtl.valueAtStart) === 16 && rtl.nameAtEnd >= 16 && rtl.nameAtEnd < 50, JSON.stringify(rtl));
  await done(b);
}

// ---------- the real tabs ----------
const day = new Date().toISOString().slice(0, 10);
const ins = (s) => ({ data: [{ spend: String(s), impressions: "100", inline_link_clicks: "10", date_start: day, date_stop: day }] });
const acc = (id, name, status, biz, cur, today, extra = {}) => ({ account_id: id, name, account_status: status, currency: cur, timezone_name: "UTC", amount_spent: "1000", p_today: ins(today), p_yesterday: ins(0), p_week: ins(0), p_month: ins(0), ...(biz ? { business: { id: biz[0], name: biz[1] } } : {}), ...extra });
const ALPHA = ["1001", "Alpha Media"], BETA = ["1002", "Beta Ads"];
const PIC = FB + "alpha_50.jpg";
// nine different statuses (nine chips) in two businesses, three currencies (a breakdown line under the total)
const NINE = [acc("11", "A1", 1, ALPHA, "USD", 1695.7), acc("12", "A2", 2, ALPHA, "USD", 0, { disable_reason: 1 }), acc("13", "A3", 3, ALPHA, "EUR", 20), acc("14", "A4", 7, ALPHA, "USD", 0), acc("15", "A5", 8, ALPHA, "USD", 0),
  acc("21", "B1", 9, BETA, "VND", 1234567), acc("22", "B2", 100, BETA, "USD", 0), acc("23", "B3", 101, BETA, "USD", 0), acc("24", "B4", 1, BETA, "USD", 5, { disable_reason: 0 }), acc("25", "B5", 2, BETA, "USD", 0, { disable_reason: 3 })];
const graphNine = (u) => ({ body: u.pathname.endsWith("/me/adaccounts") ? { data: NINE } : u.pathname.endsWith("/me/businesses") ? { data: [{ id: ALPHA[0], name: ALPHA[1], profile_picture_uri: PIC }, { id: BETA[0], name: BETA[1] }] } : { data: [] } });

async function topZoneFlow() {
  console.log("\n# polish: the top zone of a list tab");
  const b = await boot({ fb: adsFb(TOK), graph: graphNine, rates: ratesOk });
  await adsPage(b);
  const pop = await popup(b, "bms");
  await rowsAre(pop, "#bmsList .lrow", 2);
  await pop.click('[data-tab="accounts"]');
  await rowsAre(pop, ROW, 10);
  const chips = await q(pop, () => { const c = document.querySelector("#statusChips"), cs = getComputedStyle(c); return { n: c.children.length, wrap: cs.flexWrap, ox: cs.overflowX, h: Math.round(c.getBoundingClientRect().height), more: c.scrollWidth > c.clientWidth, tops: [...new Set([...c.children].map((x) => Math.round(x.getBoundingClientRect().top)))].length,
    fade: getComputedStyle(c).getPropertyValue("--fade-r").trim() }; });
  ok("nine status chips stay on ONE line that scrolls sideways (no second row), with a fade at the edge that has more", chips.n >= 8 && chips.wrap === "nowrap" && chips.ox === "auto" && chips.h <= 30 && chips.tops === 1 && chips.more && chips.fade === "20px", JSON.stringify(chips));
  await pop.evaluate(() => { const c = document.querySelector("#statusChips"); c.scrollLeft = c.scrollWidth; c.dispatchEvent(new Event("scroll")); });
  ok("…scrolled to the end the right fade is gone and the left one is on", await q(pop, () => { const c = document.querySelector("#statusChips"); return c.style.getPropertyValue("--fade-r") === "0px" && c.style.getPropertyValue("--fade-l") === "20px"; }));
  const tops = await q(pop, () => ({ top: Math.round(document.querySelector(".top").getBoundingClientRect().height), seg: getComputedStyle(document.querySelector("#periodSeg")).gridTemplateColumns.split(" ").length }));
  ok("the brand row is 40 px; the period switch is five columns", tops.top === 40 && tops.seg === 5, JSON.stringify(tops));
  await pop.setViewportSize({ width: 380, height: 700 }); await settle(pop);
  const seg = await q(pop, () => { const s = document.querySelector("#periodSeg"), bs = [...s.children], cut = bs.filter((x) => x.scrollWidth > x.clientWidth).length; return { cols: getComputedStyle(s).gridTemplateColumns.split(" ").length, h: Math.round(s.getBoundingClientRect().height), cut, tops: new Set(bs.map((x) => Math.round(x.getBoundingClientRect().top))).size }; });
  ok("at 380 px the five periods are still ONE row of five, none of them cut", seg.cols === 5 && seg.tops === 1 && seg.h <= 40 && seg.cut === 0, JSON.stringify(seg));
  await pop.setViewportSize({ width: 560, height: 700 }); await settle(pop);
  // the total: label left + amount right on one line, the breakdown under it, quiet attribution
  await until(pop, () => /^≈/.test(document.querySelector("#accountsTotal .total-value")?.textContent ?? ""));
  const tot = await q(pop, () => { const t = document.querySelector("#accountsTotal"), l = t.querySelector(".total-label").getBoundingClientRect(), v = t.querySelector(".total-value").getBoundingClientRect(), s = t.querySelector(".total-sub").getBoundingClientRect(), a = t.querySelector(".total-sub a");
    return { sameLine: Math.abs((l.top + l.bottom) / 2 - (v.top + v.bottom) / 2) < 12, valueRight: Math.round(t.getBoundingClientRect().right - v.right), subRight: Math.round(t.getBoundingClientRect().right - s.right), underBelow: s.top >= v.bottom - 2, labelLeft: l.left < v.left, valueSize: getComputedStyle(t.querySelector(".total-value")).fontSize, valueWeight: getComputedStyle(t.querySelector(".total-value")).fontWeight, deco: getComputedStyle(a).textDecorationLine }; });
  ok("the total: label on the left and the amount on the right of ONE line (19 px, weight 500), the breakdown right under the amount, flush right", tot.sameLine && tot.labelLeft && tot.valueRight === 0 && tot.subRight === 0 && tot.underBelow && tot.valueSize === "19px" && tot.valueWeight === "500", JSON.stringify(tot));
  ok("…the attribution link is not underlined at rest", tot.deco === "none", tot.deco);
  await pop.hover("#accountsTotal .total-sub a"); await until(pop, () => getComputedStyle(document.querySelector("#accountsTotal .total-sub a")).textDecorationLine === "underline");
  ok("…it underlines when pointed at", (await q(pop, () => getComputedStyle(document.querySelector("#accountsTotal .total-sub a")).textDecorationLine)) === "underline");
  // a filter puts its count in the label, muted, after a dot
  await pop.fill("#accountFilter", "A");
  await untilText(pop, "#accountsTotal .total-meta", trx("acc.found", { n: /\d+/, all: 10 }));
  const meta = await q(pop, () => { const m = document.querySelector("#accountsTotal .total-meta"), l = document.querySelector("#accountsTotal .total-label"); return { text: m.textContent, inside: l.contains(m), color: getComputedStyle(m).color, dot: getComputedStyle(m, "::before").content }; });
  ok("a search puts '5 of 10 found' INSIDE the label (muted, after a dot), not on its own row", trx("acc.found", { n: /\d+/, all: 10 }, { exact: true }).test(meta.text) && meta.inside && meta.color === "rgb(96, 103, 112)" && meta.dot.includes("·"), JSON.stringify(meta));
  await pop.fill("#accountFilter", "zzzz");
  await untilText(pop, "#accountsTotal .total-meta", trx("acc.found", { n: 0, all: 10 }));
  const none = await q(pop, () => { const m = document.querySelector("#accountsTotal .total-meta"); return { text: m.textContent, dot: getComputedStyle(m, "::before").content, empty: document.querySelector("#accountsList .empty")?.textContent }; });
  ok("a search that finds nothing says '0 of 10 found' without a dangling dot, and 'Nothing found' under the controls", none.text === tr("acc.found", { n: 0, all: 10 }) && none.dot === "none" && none.empty === tr("acc.noMatch"), JSON.stringify(none));
  await pop.fill("#accountFilter", "");
  // group header: the business's own picture, primary colour, weight 500
  await until(pop, () => !!document.querySelector("#accountsList .lgroup .lav.ok"));
  const gh = await q(pop, () => { const g = [...document.querySelectorAll("#accountsList .lgroup")].find((x) => /Alpha/.test(x.textContent)), t = g.querySelector(".lgroup-text"), img = g.querySelector(".lav-img"), other = [...document.querySelectorAll("#accountsList .lgroup")].find((x) => /Beta/.test(x.textContent));
    return { img: img?.getAttribute("src"), square: g.querySelector(".lav").classList.contains("lav-square"), w: g.querySelector(".lav").offsetWidth, color: getComputedStyle(t).color, weight: getComputedStyle(t).fontWeight, valueColor: getComputedStyle(g.querySelector(".lgroup-value")).color, noPic: !other.querySelector(".lav-img") }; });
  ok("the group header shows the business's real picture (16 px rounded square) when the Businesses tab knows it, the placeholder icon otherwise; the name is primary colour, weight 500, the subtotal stays secondary",
    gh.img === PIC && gh.square && gh.w === 16 && gh.noPic && gh.color === "rgb(28, 30, 33)" && gh.weight === "500" && gh.valueColor === "rgb(96, 103, 112)", JSON.stringify(gh));
  // the Businesses total has a tooltip about what it leaves out
  await pop.click('[data-tab="bms"]');
  ok("the Businesses total says what it leaves out: 'Without personal ad accounts'", (await q(pop, () => document.querySelector("#bmsTotal .total-label")?.title)) === tr("bms.totalTitle"));
  await done(b);
}

export const flows = { polishRow: rowLabFlow, polishTop: topZoneFlow };
