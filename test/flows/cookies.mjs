// Cookies tab: "Copy cookies + UA", the page's User-Agent.
import { TOK, ok, has, boot, popup, clickToast, captureClipboard, clip, adsFb } from "../harness.mjs";

// ---------- Cookies tab: "Copy cookies + UA" ----------
async function uaFlows() {
  console.log("\n# cookies + user agent");
  const SPOOF = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 <b>spoofed</b>";
  const uaPage = async (b, value) => {                    // an FB tab whose own JS reports `value` as its User-Agent
    const pg = await b.ctx.newPage();
    if (value !== undefined) await pg.addInitScript((v) => Object.defineProperty(Navigator.prototype, "userAgent", { get: () => v }), value);
    await pg.goto("https://adsmanager.facebook.com/adsmanager/manage/campaigns");
    return pg;
  };
  const parts = async (pop) => ((await clip(pop))[0] || "").split("\n\n");
  const b = await boot({ fb: adsFb(TOK) });

  let pop = await popup(b, "cookies");
  ok("Cookies tab: one main button + JSON, no UA field or Copy UA / Copy cookies buttons",
    (await pop.locator("#copyCookiesUa.primary").count()) === 1 && (await pop.locator("#copyCookieJson").count()) === 1
      && (await pop.locator("#uaBox, #copyUa, #copyCookies").count()) === 0);
  await captureClipboard(pop);
  const noTab = await clickToast(pop, "#copyCookiesUa");
  ok("no FB tab -> the click says why and copies nothing", (await clip(pop)).length === 0 && has(noTab, "Open Facebook"), `${noTab} / ${JSON.stringify(await clip(pop))}`);

  // the button is also the retry: the popup is still open from before the FB tab existed, one click re-reads it
  let pg = await uaPage(b);
  const real = await pg.evaluate(() => navigator.userAgent);
  await captureClipboard(pop);
  const hitsBefore = b.hits.length;
  const retry = await clickToast(pop, "#copyCookiesUa");
  let p = await parts(pop);
  ok("FB tab opened after the popup -> cookie string, blank line, the page's UA; no Graph request", p.length === 2 && has(p[0], "c_user=1001") && has(p[0], "xs=") && p[1] === real && has(retry, "Cookies + UA copied") && b.hits.length === hitsBefore, `${retry} / ${JSON.stringify(p.map((x) => x.slice(0, 30)))}`);

  // an antidetect profile spoofs the UA for pages: the extension must copy what the page reports, not its own navigator
  await pg.close(); pg = await uaPage(b, SPOOF);
  pop = await popup(b, "cookies");
  ok("popup's own navigator differs from the spoofed one (test is meaningful)", (await pop.evaluate(() => navigator.userAgent)) !== SPOOF);
  await captureClipboard(pop); await clickToast(pop, "#copyCookiesUa");
  p = await parts(pop);
  ok("spoofed UA of the page is what gets copied", p.length === 2 && p[1] === SPOOF, JSON.stringify(p.map((x) => x.slice(0, 30))));

  // the page's JS can return anything: only a printable-ASCII string of sane length is accepted
  for (const [name, bad] of [["a control character", "Mozilla/5.0\n(X11)"], ["a number", 5], ["an empty string", ""], ["600 characters", "M".repeat(600)]]) {
    await pg.close(); pg = await uaPage(b, bad);
    pop = await popup(b, "cookies");
    await captureClipboard(pop);
    const tst = await clickToast(pop, "#copyCookiesUa");
    ok(`UA with ${name} -> rejected: the click says why, nothing copied`, has(tst, "No access") && (await clip(pop)).length === 0, `${tst} / ${JSON.stringify(await clip(pop))}`);
  }
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

export const flows = { ua: uaFlows };
