// Ad accounts tab: "next step" buttons (js/nextsteps.js) — links to the right Facebook page for a blocked / unpaid account
// and a rejected ad, with a plain-language help line. Links only: nothing is sent to Graph by them.
import { TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, loadAccounts, isAds, adsFb } from "../harness.mjs";
import { LINKS } from "../../fb-helper/js/links.js";
import { STRINGS } from "../../fb-helper/js/strings/actions.js";

const LONG = "A very long ad account name that has to end in an ellipsis long before it reaches the status pill";
const acc = (account_id, name, account_status, disable_reason = 0) =>
  ({ account_id, name, account_status, disable_reason, currency: "USD", timezone_name: "UTC", amount_spent: "500", balance: "1500" });
const ACCOUNTS = { data: [
  acc("111", LONG, 2, 1),          // disabled, ads policy: appeal
  acc("222", "Unpaid B", 3),       // unsettled: pay
  acc("333", "Healthy C", 1),      // active: nothing
  acc("444", "Closed D", 2, 7),    // permanent close: no appeal, only Support + Account Quality
  acc("555", "Risk E", 7),         // pending risk review: wait, no primary button
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
  const row = (name) => pop.locator(".acc").filter({ has: pop.locator(".acc-name", { hasText: name }) });   // by name only: "Unpaid balance" is also a label inside every row
  const hits0 = b.hits.length;
  // Click a link and wait for the tab it opens (the harness answers *.facebook.com with a mock page); it is closed again.
  const clickOpens = async (loc) => {
    const [np] = await Promise.all([b.ctx.waitForEvent("page", { timeout: 8000 }), loc.click()]);
    await np.waitForURL(/facebook\.com/, { timeout: 8000 }).catch(() => {});
    const url = np.url(); await np.close(); return url;
  };

  // ---- collapsed row ----
  const review = row(LONG).locator(".act-btn");
  ok("disabled (reason 1): the collapsed row has one 'Request review' button", (await review.count()) === 1 && (await review.textContent()).trim() === "Request review", await review.allTextContents());
  const attrs = await review.evaluate((n) => ({ href: n.href, target: n.target, rel: n.rel, tag: n.tagName, cls: n.className, tab: n.tabIndex, focus: n.dataset.focus, aria: n.getAttribute("aria-label"), inHead: !!n.closest(".acc-head") }));
  ok("…an <a> to Account Quality, new tab, noopener noreferrer, keyboard-focusable, tinted bad", attrs.tag === "A" && attrs.href === LINKS.accountQuality() && attrs.target === "_blank"
    && attrs.rel === "noopener noreferrer" && attrs.tab === 0 && /\bbad\b/.test(attrs.cls) && attrs.focus === "act:111:review" && attrs.inHead, JSON.stringify(attrs));
  ok("…its accessible name carries the account name (many identical 'Request review' links on one list)", attrs.aria === `Request review · ${LONG}`, attrs.aria);
  const opened = await clickOpens(review);
  ok("clicking it opens a new tab on that URL", opened === LINKS.accountQuality(), opened);
  ok("…and does NOT expand the row", (await pop.locator(".acc.open").count()) === 0 && (await pop.locator(".acc-title[aria-expanded=true]").count()) === 0);
  ok("…and sends nothing to Graph", b.hits.length === hits0, b.hits.slice(hits0).join());

  const pay = row("Unpaid B").locator(".act-btn");
  const payHref = await pay.getAttribute("href");
  ok("unsettled: 'Pay balance' with the billing link of ITS id", (await pay.textContent()).trim() === "Pay balance" && payHref === LINKS.billing("222") && /act=222$/.test(payHref), payHref);
  ok("…tinted warn (amber), like its status pill", /\bwarn\b/.test(await pay.getAttribute("class")));
  const opened2 = await clickOpens(pay);
  ok("…opens the billing page and leaves the row closed", opened2 === LINKS.billing("222") && (await pop.locator(".acc.open").count()) === 0, opened2);

  ok("active account: no button, no 'What to do' block", (await row("Healthy C").locator(".act-btn, .act-box").count()) === 0);
  ok("permanent close and risk review: nothing to push, so no button in the collapsed row", (await row("Closed D").locator(".act-btn").count()) === 0 && (await row("Risk E").locator(".act-btn").count()) === 0);
  ok("only the two accounts with a primary step have a button", (await pop.locator(".acc .act-btn").count()) === 2);

  // ---- expanded body ----
  await row(LONG).locator(".acc-title").click();
  const box = pop.locator(".acc.open .act-box");
  ok("expanded: the 'What to do' block sits above the key-value list", (await box.count()) === 1
    && (await pop.evaluate(() => { const b = document.querySelector(".acc.open .act-box"), kv = document.querySelector(".acc.open .kv"); return !!(b.compareDocumentPosition(kv) & Node.DOCUMENT_POSITION_FOLLOWING); })));
  ok("…help text in English", (await text(pop, ".acc.open .act-help")) === "Ads policy violation. Appeal in Account Quality — it shows what exactly was flagged.", await text(pop, ".acc.open .act-help"));
  const btns = await box.locator("a").evaluateAll((as) => as.map((a) => ({ t: a.textContent.trim(), href: a.href, primary: a.classList.contains("primary"), target: a.target, rel: a.rel })));
  ok("…buttons: 'Request review' (primary) then 'Ads Manager'", btns.length === 2 && btns[0].t === "Request review" && btns[0].primary && btns[0].href === LINKS.accountQuality()
    && btns[1].t === "Ads Manager" && !btns[1].primary && btns[1].href === LINKS.adsManager("111") && btns.every((x) => x.target === "_blank" && x.rel === "noopener noreferrer"), JSON.stringify(btns));
  const stepOpens = await clickOpens(box.locator("a").nth(1));
  ok("…a body button opens its page too", stepOpens === LINKS.adsManager("111"), stepOpens);
  await pop.click('[data-lang="ru"]');
  ok("…help text in Russian after the language switch", await until(pop, (s) => document.querySelector(".acc.open .act-help")?.textContent === s, STRINGS.ru["next.help.r1"]), await text(pop, ".acc.open .act-help"));
  ok("…buttons and title in Russian", (await text(pop, ".acc.open .act-title")) === "Что делать" && (await box.locator("a").first().textContent()).trim() === "Запросить проверку");
  ok("…the collapsed button too", (await row(LONG).locator(".act-btn").textContent()).trim() === "Запросить проверку");
  await pop.click('[data-lang="en"]');
  await until(pop, () => document.querySelector(".acc.open .act-title")?.textContent === "What to do");
  await row(LONG).locator(".acc-title").click();                          // close again
  for (const [name, key, labels] of [["Unpaid B", "next.help.unpaid", ["Pay balance"]], ["Closed D", "next.help.noAppeal", ["Support", "Account Quality"]], ["Risk E", "next.help.risk", ["Account Quality"]]]) {
    await row(name).locator(".acc-title").click();
    const got = await row(name).locator(".act-box a").allTextContents();
    ok(`${name}: help '${key}' and buttons ${labels.join(" + ")}`, (await text(pop, ".acc.open .act-help")) === STRINGS.en[key] && got.map((x) => x.trim()).join() === labels.join(), `${await text(pop, ".acc.open .act-help")} | ${got}`);
    await row(name).locator(".acc-title").click();
  }
  ok("Closed D offers no appeal", !has(await row("Closed D").textContent(), "Request review"));
  await row("Healthy C").locator(".acc-title").click();
  ok("a healthy account's body has no 'What to do'", (await pop.locator(".acc.open .act-box").count()) === 0);
  await row("Healthy C").locator(".acc-title").click();

  // ---- a rejected ad ----
  await row(LONG).locator(".acc-title").click();
  await pop.click(".acc.open [data-ads]");
  ok("ads listed", await until(pop, () => document.querySelectorAll(".acc.open .ad").length === 3));
  const ad = (name) => pop.locator(".acc.open .ad", { hasText: name });
  const links = await ad("Bad ad").locator(".ad-act").evaluateAll((as) => as.map((a) => ({ t: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, focus: a.dataset.focus })));
  ok("disapproved ad: 'Request review' + 'Open ad' under its reasons", links.length === 2 && links[0].t === "Request review" && links[0].href === LINKS.accountQuality()
    && links[1].t === "Open ad" && links[1].href === "https://adsmanager.facebook.com/adsmanager/manage/ads?act=111&selected_ad_ids=9001"
    && links.every((l) => l.target === "_blank" && l.rel === "noopener noreferrer") && links[0].focus === "adact:9001:review", JSON.stringify(links));
  ok("…the links come after the reason text", await ad("Bad ad").evaluate((n) => { const s = n.querySelector("small"), a = n.querySelector(".ad-acts"); return !!(s && a && s.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  ok("with-issues ad: the same two links", (await ad("Stuck ad").locator(".ad-act").count()) === 2);
  ok("active ad: no links", (await ad("Fine ad").locator(".ad-act").count()) === 0);
  const adUrl = await clickOpens(ad("Bad ad").locator(".ad-act").nth(1));
  ok("'Open ad' opens that ad in Ads Manager", adUrl === links[1].href, adUrl);
  ok("the ads list is still there (a link does not redraw or hide it)", (await pop.locator(".acc.open .ad").count()) === 3);

  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- layout: the button must not break the row ----------
async function actionsLayoutFlow() {
  console.log("\n# actions: layout");
  const b = await boot({ fb: adsFb(TOK), graph: () => ({ body: ACCOUNTS }) });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await loadAccounts(pop, 5);
  await pop.locator(".acc").filter({ has: pop.locator(".acc-name", { hasText: LONG }) }).locator(".acc-title").click();
  for (const w of [560, 480, 360, 320]) {
    await pop.setViewportSize({ width: w, height: 800 });
    await pop.waitForTimeout(150);
    const m = await pop.evaluate(() => {
      const de = document.documentElement, r = (n) => n.getBoundingClientRect();
      const heads = [...document.querySelectorAll(".acc-head")].map((h) => ({ h: r(h), btn: h.querySelector(".act-btn") && r(h.querySelector(".act-btn")), ids: r(h.querySelector(".acc-ids")),
        spend: r(h.querySelector(".acc-spend")), name: r(h.querySelector(".acc-name")), pill: r(h.querySelector(".pill")) }));
      const box = document.querySelector(".acc.open .act-box");
      return { sw: de.scrollWidth, cw: de.clientWidth, heads, box: r(box), boxRight: r(box).right,
        labels: [...document.querySelectorAll(".act-btn .act-label")].map((l) => ({ t: l.textContent, cut: l.scrollWidth > l.clientWidth })) };
    });
    ok(`${w}px: no horizontal scroll`, m.sw <= m.cw, `${m.sw} > ${m.cw}`);
    ok(`${w}px: every action button stays inside its row and never overlaps the other cells`, m.heads.every((x) => !x.btn || (x.btn.right <= x.h.right + 0.5
      && !(x.btn.left < x.pill.right && x.btn.right > x.pill.left && x.btn.top < x.pill.bottom && x.btn.bottom > x.pill.top))), JSON.stringify(m.heads.map((x) => x.btn)));
    ok(`${w}px: the button labels are readable (not cut with "…")`, m.labels.length === 2 && m.labels.every((l) => !l.cut), JSON.stringify(m.labels));
    ok(`${w}px: the 'What to do' card is inside the window`, m.box.left >= 0 && m.boxRight <= m.cw + 0.5, JSON.stringify(m.box));
    ok(`${w}px: button height 24px, the label is one line`, m.heads.every((x) => !x.btn || Math.round(x.btn.height) === 24), JSON.stringify(m.heads.map((x) => x.btn?.height)));
  }
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

export const flows = { actions: actionsFlow, actionsLayout: actionsLayoutFlow };
