// Ad accounts tab: "next step" links (js/nextsteps.js) — the one fix on line 2 of a problem row, the "What to do" lines of the expanded body, the
// review links of a rejected ad. Links only: nothing is sent to Graph by them. The structure of the list itself is flow accList (accounts.mjs).
import { TOK, ok, has, boot, adsPage, popup, text, until, loadAccounts, isAds, adsFb, ROW } from "../harness.mjs";
import { LINKS } from "../../fb-helper/js/links.js";
import { STRINGS } from "../../fb-helper/js/strings/actions.js";

const LONG = "A very long ad account name that has to end in an ellipsis long before it reaches the status word";
const acc = (account_id, name, account_status, disable_reason = 0) =>
  ({ account_id, name, account_status, disable_reason, currency: "USD", timezone_name: "UTC", amount_spent: "500", balance: "1500" });
const ACCOUNTS = { data: [
  acc("111", LONG, 2, 1),          // disabled, ads policy: appeal
  acc("222", "Unpaid B", 3),       // unsettled: pay
  acc("333", "Healthy C", 1),      // active: nothing
  acc("444", "Closed D", 2, 7),    // closed for good: no appeal, only Support + Account Quality (in the body)
  acc("555", "Risk E", 7),         // pending risk review: wait, the one link says where to look
] };
const ADS = { data: [
  { id: "9001", name: "Bad ad", effective_status: "DISAPPROVED", ad_review_feedback: { global: { "Personal attributes": "Implies knowledge of personal traits" } } },
  { id: "9002", name: "Stuck ad", effective_status: "WITH_ISSUES", issues_info: [{ error_summary: "Ad set has no budget", error_message: "Set a budget" }] },
  { id: "9003", name: "Fine ad", effective_status: "ACTIVE" },
] };

async function actionsFlow() {
  console.log("\n# actions: next steps");
  const b = await boot({ fb: adsFb(TOK), graph: (u) => (isAds(u) ? { body: ADS } : { body: ACCOUNTS }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("rows rendered", await loadAccounts(pop, 5));
  const row = (name) => pop.locator(ROW).filter({ has: pop.locator(".lrow-name", { hasText: name }) });
  const title = (name) => row(name).locator(".lrow-title");
  const hits0 = b.hits.length;
  // Click a link and wait for the tab it opens (the harness answers *.facebook.com with a mock page); it is closed again.
  const clickOpens = async (loc) => {
    const [np] = await Promise.all([b.ctx.waitForEvent("page", { timeout: 8000 }), loc.click()]);
    await np.waitForURL(/facebook\.com/, { timeout: 8000 }).catch(() => {});
    const url = np.url(); await np.close(); return url;
  };

  // ---- collapsed row ----
  const review = row(LONG).locator(".lrow-head .lrow-fix");
  ok("disabled (ads policy): line 2 has one 'Appeal' link", (await review.count()) === 1 && (await review.textContent()).trim() === "Appeal", await review.allTextContents());
  const attrs = await review.evaluate((n) => ({ href: n.href, target: n.target, rel: n.rel, tag: n.tagName, cls: n.className, tab: n.tabIndex, focus: n.dataset.focus, aria: n.getAttribute("aria-label"), inSub: !!n.closest(".lrow-sub"), icon: !!n.querySelector(".i"),
    deco: getComputedStyle(n.querySelector(".act-label")).textDecorationLine, color: getComputedStyle(n).color }));
  ok("…an <a> to Account Quality, new tab, noopener noreferrer, keyboard-focusable, red (bad), underlined, no ↗ icon, on line 2 after the problem word", attrs.tag === "A" && attrs.href === LINKS.accountQuality() && attrs.target === "_blank"
    && attrs.rel === "noopener noreferrer" && attrs.tab === 0 && /\bbad\b/.test(attrs.cls) && attrs.focus === "rowfix:111" && attrs.inSub && !attrs.icon && attrs.deco === "underline" && attrs.color === "rgb(207, 33, 39)", JSON.stringify(attrs));
  ok("…its accessible name carries the account name (many identical 'Appeal' links on one list)", attrs.aria === `Appeal · ${LONG}`, attrs.aria);
  ok("…and its tooltip is the plain-language help line", (await review.getAttribute("title")) === STRINGS.en["next.help.r1"], await review.getAttribute("title"));
  const opened = await clickOpens(review);
  ok("clicking it opens a new tab on that URL", opened === LINKS.accountQuality(), opened);
  ok("…and does NOT expand the row", (await pop.locator(`${ROW}.open`).count()) === 0 && (await pop.locator(`${ROW} .lrow-title[aria-expanded=true]`).count()) === 0);
  ok("…and sends nothing to Graph", b.hits.length === hits0, b.hits.slice(hits0).join());

  const pay = row("Unpaid B").locator(".lrow-head .lrow-fix");
  const payHref = await pay.getAttribute("href");
  ok("unpaid: 'Pay' with the billing link of ITS id", (await pay.textContent()).trim() === "Pay" && payHref === LINKS.billing("222") && /act=222$/.test(payHref), payHref);
  ok("…tinted warn (amber), like its status word", /\bwarn\b/.test(await pay.getAttribute("class")) && (await row("Unpaid B").locator(".lrow-status-text").textContent()) === "Unpaid");
  const opened2 = await clickOpens(pay);
  ok("…opens the billing page and leaves the row closed", opened2 === LINKS.billing("222") && (await pop.locator(`${ROW}.open`).count()) === 0, opened2);

  ok("active account: no link, no word (silent)", (await row("Healthy C").locator(".lrow-fix, .lrow-status, .lrow-more").count()) === 0);
  // One fix per row, and only where there is something to push: closed for good has nothing (its steps are in the body); a review in progress points to where to look.
  ok("closed for good: grey word, no link; risk review: 'Account Quality'", (await row("Closed D").locator(".lrow-status-text").textContent()) === "Closed for good" && (await row("Closed D").locator(".lrow-fix").count()) === 0
    && (await row("Risk E").locator(".lrow-fix").textContent()).trim() === "Account Quality" && (await row("Risk E").locator(".lrow-status-text").textContent()) === "In review");
  ok("every row with something to do has exactly one link: 3 on the list (disabled, unpaid, in review); none on the healthy and the dead one", (await pop.locator(`${ROW} .lrow-head .lrow-fix`).count()) === 3);
  ok("no button, pill or ↗ icon in the collapsed rows' links", (await pop.locator(`${ROW} .lrow-head .btn, ${ROW} .lrow-head .pill, ${ROW} .lrow-head a .i-external`).count()) === 0);

  // ---- expanded body ----
  await title(LONG).click();
  const box = pop.locator(`${ROW}.open .lrow-todo`);
  ok("expanded: the 'What to do' block sits after the key-value list and before the places to open", (await box.count()) === 1
    && (await pop.evaluate((sel) => { const o = document.querySelector(`${sel}.open`), b = o.querySelector(".lrow-todo"), kv = o.querySelector(".lrow-kv"), l = o.querySelector(".lrow-links"); return !!(kv.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(b.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING); }, ROW)));
  ok("…help text in English, a plain title (no tinted box)", (await text(pop, `${ROW}.open .lrow-todo-help`)) === STRINGS.en["next.help.r1"] && (await box.evaluate((n) => getComputedStyle(n).backgroundColor)) === "rgba(0, 0, 0, 0)", await text(pop, `${ROW}.open .lrow-todo-help`));
  ok("…every step is here, the one on line 2 included (Appeal, in the tone of the problem); Ads Manager is not repeated: it is in the links row", (await box.locator("a").allTextContents()).map((x) => x.trim()).join() === "Appeal"
    && (await box.locator("a").first().evaluate((n) => n.classList.contains("bad"))));
  const places = await pop.locator(`${ROW}.open .lrow-links a`).evaluateAll((as) => as.map((a) => ({ t: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, icon: !!a.querySelector(".i-external") })));
  ok("…'Ads Manager ↗' and 'Billing ↗' of this account, with their icons, new tab, noopener noreferrer", places.length === 2 && places[0].t === "Ads Manager" && places[0].href === LINKS.adsManager("111") && places[1].t === "Billing" && places[1].href === LINKS.billing("111")
    && places.every((x) => x.icon && x.target === "_blank" && x.rel === "noopener noreferrer"), JSON.stringify(places));
  const stepOpens = await clickOpens(pop.locator(`${ROW}.open .lrow-links a`).first());
  ok("…a link of the body opens its page too", stepOpens === LINKS.adsManager("111"), stepOpens);
  await pop.click('[data-lang="ru"]');
  ok("…help text in Russian after the language switch", await until(pop, (s) => document.querySelector("#accountsList .lrow.open .lrow-todo-help")?.textContent === s, STRINGS.ru["next.help.r1"]), await text(pop, `${ROW}.open .lrow-todo-help`));
  ok("…title in Russian, the collapsed fix too ('Апелляция')", (await text(pop, `${ROW}.open .lrow-todo-title`)) === "Что делать" && (await row(LONG).locator(".lrow-head .lrow-fix").textContent()).trim() === "Апелляция"
    && (await row("Unpaid B").locator(".lrow-head .lrow-fix").textContent()).trim() === "Оплатить");
  await pop.click('[data-lang="en"]');
  await until(pop, () => document.querySelector("#accountsList .lrow.open .lrow-todo-title")?.textContent === "What to do");
  await title(LONG).click();                                                       // close again
  for (const [name, key, labels] of [["Unpaid B", "next.help.unpaid", ["Pay"]], ["Closed D", "next.help.noAppeal", ["Support", "Account Quality"]], ["Risk E", "next.help.risk", ["Account Quality"]]]) {
    await title(name).click();
    const got = await row(name).locator(".lrow-todo a").allTextContents();
    ok(`${name}: help '${key}' and steps [${labels.join(" + ")}]`, (await text(pop, `${ROW}.open .lrow-todo-help`)) === STRINGS.en[key] && got.map((x) => x.trim()).join() === labels.join(), `${await text(pop, `${ROW}.open .lrow-todo-help`)} | ${got}`);
    await title(name).click();
  }
  await title("Closed D").click();
  const dead = await pop.locator(`${ROW}.open .lrow-todo a`).evaluateAll((as) => as.map((a) => a.href));
  ok("Closed D: Support and Account Quality lead to the right pages; no appeal is offered", dead.join() === [LINKS.support(), LINKS.accountQuality()].join() && !has(await row("Closed D").textContent(), "Appeal"), dead.join());
  await title("Closed D").click();
  await title("Healthy C").click();
  ok("a healthy account's body has no 'What to do'", (await pop.locator(`${ROW}.open .lrow-todo`).count()) === 0);
  await title("Healthy C").click();

  // ---- a rejected ad ----
  await title(LONG).click();
  await pop.click(`${ROW}.open [data-ads]`);
  ok("ads listed", await until(pop, () => document.querySelectorAll("#accountsList .lrow.open .ad").length === 3));
  const ad = (name) => pop.locator(`${ROW}.open .ad`, { hasText: name });
  const links = await ad("Bad ad").locator(".ad-act").evaluateAll((as) => as.map((a) => ({ t: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, focus: a.dataset.focus, bad: a.classList.contains("bad"), icon: !!a.querySelector(".i"), aria: a.getAttribute("aria-label") })));
  ok("disapproved ad: 'Appeal' + 'Open ad' under its reasons, in the style of a row's fix (underlined, no icon, owner in the accessible name)", links.length === 2 && links[0].t === "Appeal" && links[0].href === LINKS.accountQuality()
    && links[1].t === "Open ad" && links[1].href === "https://adsmanager.facebook.com/adsmanager/manage/ads?act=111&selected_ad_ids=9001"
    && links.every((l) => l.target === "_blank" && l.rel === "noopener noreferrer" && !l.icon) && links[0].focus === "adact:9001:review" && links[0].bad && !links[1].bad && links[0].aria === "Appeal · Bad ad", JSON.stringify(links));
  ok("…the links come after the reason text", await ad("Bad ad").evaluate((n) => { const s = n.querySelector("small"), a = n.querySelector(".ad-acts"); return !!(s && a && s.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  ok("with-issues ad: the same two links", (await ad("Stuck ad").locator(".ad-act").count()) === 2);
  ok("active ad: no links and no status word on screen (the summary counts it)", (await ad("Fine ad").locator(".ad-act").count()) === 0 && (await ad("Fine ad").locator(".lrow-status").count()) === 0 && (await ad("Bad ad").locator(".lrow-status-text").textContent()) === "Disapproved");
  const adUrl = await clickOpens(ad("Bad ad").locator(".ad-act").nth(1));
  ok("'Open ad' opens that ad in Ads Manager", adUrl === links[1].href, adUrl);
  ok("the ads list is still there (a link does not redraw or hide it)", (await pop.locator(`${ROW}.open .ad`).count()) === 3);

  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- layout: the link must not break the row ----------
async function actionsLayoutFlow() {
  console.log("\n# actions: layout");
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: ACCOUNTS }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await loadAccounts(pop, 5);
  await pop.locator(ROW).filter({ has: pop.locator(".lrow-name", { hasText: LONG }) }).locator(".lrow-title").click();
  for (const w of [560, 480, 380, 360, 320]) {
    await pop.setViewportSize({ width: w, height: 800 });
    await pop.waitForTimeout(150);
    const m = await pop.evaluate(() => {
      const de = document.documentElement, r = (n) => n.getBoundingClientRect();
      const heads = [...document.querySelectorAll("#accountsList .lrow-head")].map((h) => { const fix = h.querySelector(".lrow-fix"), sub = h.querySelector(".lrow-sub"), idc = h.querySelector(".lrow-idc");
        return { h: r(h), fix: fix && r(fix), sub: sub && r(sub), idc: idc && getComputedStyle(idc).display !== "none" ? r(idc) : null, value: r(h.querySelector(".lrow-value")), name: r(h.querySelector(".lrow-name")) }; });
      const box = document.querySelector("#accountsList .lrow.open .lrow-todo");
      return { sw: de.scrollWidth, cw: de.clientWidth, heads, box: r(box), labels: [...document.querySelectorAll(".lrow-head .lrow-fix .act-label")].map((l) => ({ t: l.textContent, cut: l.scrollWidth > l.clientWidth })) };
    });
    const touch = (a, c) => a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top;
    ok(`${w}px: no horizontal scroll`, m.sw <= m.cw, `${m.sw} > ${m.cw}`);
    ok(`${w}px: every fix link stays inside line 2 of its row and never overlaps the ID or the amount`, m.heads.every((x) => !x.fix || (x.fix.right <= x.sub.right + 1 && x.fix.right <= x.h.right + 0.5 && !(x.idc && touch(x.fix, x.idc)) && !touch(x.fix, x.value))), JSON.stringify(m.heads.map((x) => x.fix)));
    ok(`${w}px: the link labels are readable (not cut with "…")`, m.labels.length === 3 && m.labels.every((l) => !l.cut), JSON.stringify(m.labels));
    ok(`${w}px: the 'What to do' block is inside the window`, m.box.left >= 0 && m.box.right <= m.cw + 0.5, JSON.stringify(m.box));
    ok(`${w}px: line 2 is one line`, m.heads.every((x) => !x.sub || x.sub.height <= 24), JSON.stringify(m.heads.map((x) => x.sub?.height)));
  }
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

export const flows = { actions: actionsFlow, actionsLayout: actionsLayoutFlow };
