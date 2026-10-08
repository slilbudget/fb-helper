// When the browser refuses the clipboard (no permission, no focus) every copy button says so, in the error toast, and claims nothing was copied: no "Copied",
// no tick on the ID's icon, no announcement for a screen reader. The same buttons work again as soon as the clipboard does. Graph is a mock.
import { TOK, ok, boot, adsPage, popup, text, until, rowsAre, clickToast, accountsJson, isAds, adsFb, captureClipboard, failClipboard, clip, ROW, idle, tr, done, loadAccounts } from "../harness.mjs";

const pathOf = (u) => u.pathname.replace(/^\/v[\d.]+\//, "/");
const PAGE = { id: "100000000000001", name: "Page One", is_published: true, tasks: ["ADVERTISE"], promotion_eligible: true };
const graph = (u) => {
  const p = pathOf(u);
  if (p === "/me/adaccounts") return { body: accountsJson };
  if (p === "/me/businesses") return { body: { data: [{ id: "900", name: "Nova Media" }] } };
  if (p === "/me/accounts") return { body: { data: [PAGE] } };
  if (p === "/me") return { body: { id: "1001", name: "Alex Carter" } };
  if (isAds(u)) return { body: { data: [] } };
  return { body: { data: [] } };
};
const toastState = (p) => p.evaluate(() => { const t = document.querySelector("#toast"); return { text: t.textContent.trim(), err: t.classList.contains("err"), shown: t.classList.contains("show") }; });
const live = (p) => p.evaluate(() => document.getElementById("live").textContent);

async function clipFail() {
  console.log("\n# clipboard: a refused copy says so");
  const b = await boot({ fb: adsFb(TOK), graph });
  await adsPage(b);
  const pop = await popup(b, "token");
  await failClipboard(pop);
  const FAIL = tr("copyFail");

  // ---- the Token and Cookies tabs ----
  for (const [what, tab, sel] of [["Copy token", "token", "#grabToken"], ["Token + cookies + UA", "token", "#copyEnv"], ["Copy cookies + UA", "cookies", "#copyCookiesUa"], ["JSON cookies", "cookies", "#copyCookieJson"]]) {
    await pop.click(`[data-tab="${tab}"]`);
    const said = await clickToast(pop, sel), s = await toastState(pop);
    ok(`${what}: 'Could not copy to clipboard' in the error toast, nothing copied, no success message`, said === FAIL && s.err && (await clip(pop)).length === 0 && !said.includes(tr("copied")) && !said.includes(tr("grab.copied")), JSON.stringify(s));
  }

  // ---- the ID of a row, and Active IDs ----
  await pop.click('[data-tab="accounts"]'); await loadAccounts(pop, 1); await idle(pop, "#tab-accounts");
  await pop.evaluate(() => { document.querySelector("#toast").textContent = ""; document.querySelector("#toast").className = "toast"; });
  await pop.click(`${ROW} .lrow-head .lrow-id`);
  ok("the ID on a row: the error toast, the row did not open, the icon is still the copy icon (no ✓), a screen reader was told nothing is copied (the toast), not 'ID copied'",
    await until(pop, (s) => document.querySelector("#toast").textContent.trim() === s, FAIL) && (await toastState(pop)).err && (await pop.locator(`${ROW}.open`).count()) === 0
    && (await pop.locator(`${ROW} .lrow-head .lrow-id .i-tick`).count()) === 0 && (await pop.locator(`${ROW} .lrow-head .lrow-id .i-copy`).count()) === 1 && (await live(pop)) !== tr("acc.idCopied"), JSON.stringify(await toastState(pop)));
  const ids = await clickToast(pop, "#copyLiveIds");
  ok("Active IDs: the same refusal, not 'Copied IDs: 1'", ids === FAIL && (await toastState(pop)).err && (await clip(pop)).length === 0, ids);
  await pop.click('[data-tab="bms"]'); await rowsAre(pop, "#bmsList .lrow", 1);
  await pop.click("#bmsList .lrow .lrow-head .lrow-id");
  ok("the ID on a Businesses row: the same refusal", await until(pop, (s) => document.querySelector("#toast").textContent.trim() === s, FAIL) && (await pop.locator("#bmsList .lrow .lrow-id .i-tick").count()) === 0);
  await pop.click('[data-tab="pages"]'); await rowsAre(pop, "#pagesList .lrow", 1);
  await pop.evaluate(() => { document.querySelector("#toast").textContent = ""; });
  await pop.click("#pagesList .lrow .lrow-head .lrow-id");
  ok("the ID on a Pages row: the same refusal", await until(pop, (s) => document.querySelector("#toast").textContent.trim() === s, FAIL) && (await pop.locator("#pagesList .lrow .lrow-id .i-tick").count()) === 0);

  // ---- and it works again when the clipboard does ----
  await captureClipboard(pop);
  await pop.click('[data-tab="accounts"]');
  const ok2 = await clickToast(pop, "#copyLiveIds");
  ok("the clipboard answers again: Active IDs copies and says how many", ok2 === tr("acc.idsCopied", { n: 1 }) && (await clip(pop)).join() === "111", ok2);
  await pop.click(`${ROW} .lrow-head .lrow-id`);
  ok("…and the ID on a row is copied, with its ✓ and the announcement", (await until(pop, () => !!document.querySelector("#accountsList .lrow .lrow-head .lrow-id .i-tick"))) && (await live(pop)) === tr("acc.idCopied") && (await clip(pop)).at(-1) === "111");
  await done(b);
}

export const flows = { clipFail };
