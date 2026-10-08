// Token tab: reading the token from FB tabs, the DOM fallback, "Token + cookies + UA", dead token + refresh, a hung tab.
import { TOK, TOK2, TOK_H, TOK_W, ok, has, boot, adsPage, popup, text, until, resetLocks, clickToast, captureClipboard, clip, accountsJson, adsFb, boxWait, GONE, loadAccounts, stored, done, tr } from "../harness.mjs";

// ---------- token ----------
async function tokenFlows() {
  console.log("\n# token");
  let tok = TOK;
  const b = await boot({ fb: (u) => adsFb(tok)(u) });
  const ads = await adsPage(b), feed = await b.ctx.newPage(); await feed.goto("https://www.facebook.com/");
  const pop = await popup(b);
  ok("silent open shows the Ads Manager token", await boxWait(pop, /^EAAB/), await text(pop, "#tokenBox"));
  tok = null; await ads.reload(); await pop.reload();
  ok("silent open, no token on any tab -> token dropped", await boxWait(pop, GONE), await text(pop, "#tokenBox"));
  ok("click with no token anywhere -> error toast", (await clickToast(pop, "#grabToken")).length > 0);
  tok = TOK_H; await ads.reload(); await pop.click("#grabToken");
  ok("new token from the tab replaces it (EAAH)", await boxWait(pop, /^EAAH/), await text(pop, "#tokenBox"));
  ok("EAAH card names the type", has(await text(pop, "#kindCard"), "EAAH"));
  tok = "EAAB<img src=x>" + "z".repeat(70); await ads.reload(); await pop.click("#grabToken");
  ok("spoofed token shape from the page is rejected", (await boxWait(pop, GONE)) && !has(await text(pop, "#tokenBox"), "<img"), await text(pop, "#tokenBox"));
  // refresh button: reads the CURRENT token from the tab, writes nothing to the clipboard
  tok = TOK2; await ads.reload(); await captureClipboard(pop);
  const rt = await clickToast(pop, "#refreshToken");
  ok("refresh: picks up the token now on the tab", (await boxWait(pop, /^EAABy/)) && has(rt, tr("token.refreshed")), `${await text(pop, "#tokenBox")} / ${rt}`);
  ok("refresh: nothing copied to the clipboard", (await clip(pop)).length === 0);
  tok = null; await ads.reload();
  const rt2 = await clickToast(pop, "#refreshToken");
  ok("refresh with no token on any tab: says why, field emptied", (await boxWait(pop, GONE)) && rt2.length > 0 && !has(rt2, tr("token.refreshed")), rt2);
  await ads.close(); await pop.reload();
  ok("no ads tab -> field shows a reason", await boxWait(pop, GONE), await text(pop, "#tokenBox"));
  ok("no ads tab -> nothing stored", !(await stored(pop, "token")));
  await done(b);
}

// The rendered-DOM fallback: read on ads / billing pages, never on feed-like pages full of other people's text.
async function fallbackFlows() {
  console.log("\n# token fallback (DOM scan)");
  const stray = `<p>comment: ${TOK_W}</p>`;
  for (const [url, expect] of [
    ["https://www.facebook.com/", false],
    ["https://www.facebook.com/groups/1/", false],
    ["https://www.facebook.com/groups/billing-tips/posts/1", false],
    ["https://www.facebook.com/billing.smith", false],
    ["https://www.facebook.com/billing_hub/payment_settings", true],
    ["https://adsmanager.facebook.com/adsmanager/manage/campaigns", true],
    ["https://www.facebook.com/ads/manager/account_settings/account_billing/", true],
    ["https://business.facebook.com/settings/", true],
  ]) {
    const b = await boot({ fb: () => stray });
    await (await b.ctx.newPage()).goto(url);
    const pop = await popup(b);
    await boxWait(pop, /^(?!—)/);
    const got = (await text(pop, "#tokenBox")).startsWith("EAAW");
    ok(`${new URL(url).host}${new URL(url).pathname}: token in plain DOM text ${expect ? "found" : "ignored"}`, got === expect, await text(pop, "#tokenBox"));
    await done(b);
  }
}

// ---------- token + cookies export: same account? ----------
async function exportFlows() {
  console.log("\n# token + cookies export");
  const run = async (name, tok, meReply, check) => {
    const b = await boot({ user: "1001", fb: adsFb(tok), graph: typeof meReply === "function" ? meReply : () => meReply });
    const ua = await (await adsPage(b)).evaluate(() => navigator.userAgent);
    const pop = await popup(b, "token"); await captureClipboard(pop);
    const toast = await clickToast(pop, "#copyEnv");
    const out = await clip(pop);
    ok(name, check(out, toast, b.hits, ua), `clip=${JSON.stringify(out).slice(0, 80)} toast=${toast} hits=${b.hits}`);
    await done(b);
  };
  await run("same account -> copied, one /me read (with name + BMs)", TOK, { body: { id: "1001", name: "Alex Carter", businesses: { data: [{ id: "111", name: "Nova Media" }, { id: "222", name: "Lumen Traffic" }] } } },
    (c, t, h, ua) => c.length === 1 && c[0].startsWith(TOK) && has(c[0], "c_user=1001") && has(t, tr("env.copied")) && !has(t, tr("env.unverified")) && h.length === 1
      && has(h[0], "businesses") && c[0].split("\n\n").length === 4 && c[0].split("\n\n")[0] === TOK && c[0].split("\n\n")[2] === ua
      && c[0].split("\n\n")[3] === "Profile: Alex Carter (1001)\nBM: Nova Media (111), Lumen Traffic (222)");
  await run("no BMs (Graph leaves the edge out) -> BM: none", TOK, { body: { id: "1001", name: "Alex Carter" } },
    (c, t, h) => c.length === 1 && h.length === 1 && c[0].endsWith("\n\nProfile: Alex Carter (1001)\nBM: none"));
  await run("BMs refused (#200) -> once more with id,name, BM: not available", TOK,
    (u) => u.searchParams.get("fields").includes("businesses") ? { status: 400, body: { error: { code: 200, message: "(#200) Requires business_management permission" } } } : { body: { id: "1001", name: "Alex Carter" } },
    (c, t, h) => c.length === 1 && h.length === 2 && !has(t, tr("env.unverified")) && c[0].endsWith("\n\nProfile: Alex Carter (1001)\nBM: not available"));
  await run("token of another account -> NOT copied, both ids in the toast", TOK, { body: { id: "999" } },
    (c, t) => c.length === 0 && has(t, tr("env.mismatch", { a: "999", b: "1001" })));
  await run("custom-app token (app-scoped /me.id) -> copied, marked unverified", TOK_W, { body: { id: "122190171494905792" } },
    (c, t) => c.length === 1 && has(t, tr("env.unverified")) && !has(c[0], "122190171494905792"));
  await run("/me fails with an ordinary error -> copied, marked unverified, no retry, no profile paragraph", TOK, { status: 500, body: { error: { code: 2, message: "temporary" } } },
    (c, t, h) => c.length === 1 && has(t, tr("env.unverified")) && h.length === 1 && c[0].split("\n\n").length === 3);
  await run("/me says the session is dead -> NOT copied", TOK, { status: 400, body: { error: { code: 190, error_subcode: 463, message: "expired" } } },
    (c, t) => c.length === 0 && has(t, "190/463"));

  // the block carries the UA the PAGE reports (an antidetect profile's spoofed one), not the popup's own navigator
  {
    const SPOOFED = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    const b = await boot({ user: "1001", fb: adsFb(TOK), graph: () => ({ body: { id: "1001" } }) });
    const pg = await b.ctx.newPage();
    await pg.addInitScript((v) => Object.defineProperty(Navigator.prototype, "userAgent", { get: () => v }), SPOOFED);
    await pg.goto("https://adsmanager.facebook.com/adsmanager/manage/campaigns");
    const pop = await popup(b, "token"); await captureClipboard(pop);
    await clickToast(pop, "#copyEnv");
    const out = (await clip(pop))[0] || "";
    const parts = out.split("\n\n");
    ok("block = token, cookies, the page's (spoofed) UA, profile + BMs — four paragraphs", parts.length === 4 && parts[3].startsWith("Profile: 1001\nBM: ") && parts[0] === TOK && has(parts[1], "c_user=1001") && parts[2] === SPOOFED && parts[2] !== await pop.evaluate(() => navigator.userAgent), JSON.stringify(parts.map((p) => p.slice(0, 30))));
    await done(b);
  }

  // no readable UA on the page -> the block is not copied (it would be an incomplete set), and no /me request is spent
  {
    const b = await boot({ user: "1001", fb: adsFb(TOK), graph: () => ({ body: { id: "1001" } }) });
    const pg = await b.ctx.newPage();
    await pg.addInitScript(() => Object.defineProperty(Navigator.prototype, "userAgent", { get: () => "bad\nua" }));
    await pg.goto("https://adsmanager.facebook.com/adsmanager/manage/campaigns");
    const pop = await popup(b, "token"); await captureClipboard(pop);
    const toast = await clickToast(pop, "#copyEnv");
    ok("unreadable UA -> NOT copied, says why, no /me request", (await clip(pop)).length === 0 && has(toast, tr("grab.noAccess")) && b.hits.length === 0, `${JSON.stringify(await clip(pop))} / ${toast} / ${b.hits}`);
    await done(b);
  }

  // the answer is remembered for the token + login: the second export makes no request
  const b = await boot({ user: "1001", fb: adsFb(TOK), graph: () => ({ body: { id: "1001" } }) });
  await adsPage(b);
  const pop = await popup(b, "token"); await captureClipboard(pop);
  await clickToast(pop, "#copyEnv"); await clickToast(pop, "#copyEnv");
  ok("second export reuses the owner check", (await clip(pop)).length === 2 && b.hits.length === 1, `${b.hits.length} hits`);
  await done(b);
}

// dead token + a cached "owner ok": still not exported; the refresh button is the way to try the same token again
async function deadExportFlows() {
  console.log("\n# dead token: export and refresh");
  let dead = false;
  const b = await boot({ fb: adsFb(TOK), graph: (u) => dead && u.pathname.endsWith("/adaccounts") ? { status: 400, body: { error: { code: 190, error_subcode: 463, message: "expired" } } }
    : u.pathname.endsWith("/me") ? { body: { id: "1001" } } : { body: accountsJson } });
  await adsPage(b);
  const pop = await popup(b, "token"); await captureClipboard(pop);
  await clickToast(pop, "#copyEnv");
  ok("first export is verified and copied", (await clip(pop)).length === 1);
  dead = true;
  await pop.click('[data-tab="accounts"]'); await clickToast(pop, "#loadAccounts");
  await pop.click('[data-tab="token"]');
  const t = await clickToast(pop, "#copyEnv");
  ok("token now dead: export refused although the owner check is cached", (await clip(pop)).length === 1 && has(t, tr("err.session", { c: "190/463" })), `${(await clip(pop)).length} ${t}`);
  const rt = await clickToast(pop, "#refreshToken");
  ok("refresh of the same dead token says so and clears the record (it holds the token)", has(rt, tr("token.retry")) && await until(pop, () => chrome.storage.session.get("dead").then((o) => !(o.dead || []).length)), rt);
  dead = false; await resetLocks(pop);
  const before = b.hits.length;
  await pop.click('[data-tab="accounts"]'); const ok2 = await loadAccounts(pop, 1);
  ok("after refresh the same token is tried again", ok2 && b.hits.length > before, `${b.hits.length} vs ${before}`);
  await done(b);
}

// ---------- a hung FB tab must not hold the popup ----------
async function hungFlows() {
  console.log("\n# hung tab");
  // The hung tab is an Ads Manager tab used most recently, so it is asked first; the token sits on a BM tab.
  const b = await boot({ fb: (u) => u.pathname.startsWith("/hang")
    ? "<script>setTimeout(() => { const end = Date.now() + 60000; while (Date.now() < end); }, 300)</script>hung"
    : u.hostname.startsWith("business") ? `<script>window.__accessToken=${JSON.stringify(TOK)}</script>bm` : "<p>feed</p>" });
  await (await b.ctx.newPage()).goto("https://business.facebook.com/settings/");
  const hung = await b.ctx.newPage(); await hung.goto("https://adsmanager.facebook.com/hang"); await hung.waitForTimeout(600);   // a fixed wait on purpose: the page's own 300 ms timer has to fire and start the busy loop before the popup opens; a hung page cannot say it hangs
  const pop = await popup(b);
  const t0 = Date.now();
  const got = await boxWait(pop, /^EAAB/);
  ok("token from the healthy tab within a few seconds although another FB tab hangs", got && Date.now() - t0 < 6000, `${got} ${Date.now() - t0} ms`);
  await done(b);
}

export const flows = { token: tokenFlows, fallback: fallbackFlows, export: exportFlows, deadexport: deadExportFlows, hung: hungFlows };
