// The lists belong to ONE Facebook login. When the FB user of the profile changes (another c_user cookie, or none) every cached list of the previous
// user goes at once, on whatever path the popup notices: the token read again with the ⟳ while the popup is open, a popup opened afterwards. Accounts, ads,
// Businesses and Pages all go, from the screen and from storage, and nothing is stamped as belonging to the new user. Graph is a mock (fictional data).
import { TOK, ok, boot, adsPage, popup, text, until, rowsAre, resetLocks, accountsJson, isAds, adsFb, stored, ROW, idle, done, openAds } from "../harness.mjs";

const pathOf = (u) => u.pathname.replace(/^\/v[\d.]+\//, "/");
const PAGE = { id: "100000000000001", name: "Page One", is_published: true, tasks: ["ADVERTISE"], promotion_eligible: true };
const graph = (u) => {
  const p = pathOf(u);
  if (p === "/me/adaccounts") return { body: accountsJson };
  if (p === "/me/businesses") return { body: { data: [{ id: "900", name: "Nova Media" }] } };
  if (p === "/me/accounts") return { body: { data: [PAGE] } };
  if (isAds(u)) return { body: { data: [{ id: "a1", name: "Ad", effective_status: "ACTIVE" }] } };
  return { body: { data: [] } };
};
const KEYS = ["accounts", "ads", "bms", "pages", "fetchedAt", "bmsAt", "pagesAt", "view", "failedBms"];
const LISTS = [["accounts", "#accountsList", ROW], ["bms", "#bmsList", "#bmsList .lrow"], ["pages", "#pagesList", "#pagesList .lrow"]];
const stateOf = (p) => p.evaluate(async () => { const { state } = await import(chrome.runtime.getURL("js/state.js")); return { accounts: state.accounts.length, ads: Object.keys(state.ads).length, bms: state.bms?.length ?? 0, pages: state.pages?.length ?? 0, owner: state.owner }; });
const storedKeys = (p) => p.evaluate((keys) => chrome.storage.session.get(keys).then((o) => Object.keys(o)), KEYS);

// Everything loaded for user 1001 in one open popup: accounts + an account's ads, Businesses, Pages.
async function loadAll(b) {
  await adsPage(b);
  const pop = await popup(b, "accounts");
  await rowsAre(pop, ROW, 1); await openAds(pop);
  await pop.click('[data-tab="bms"]'); await rowsAre(pop, "#bmsList .lrow", 1); await idle(pop, "#tab-bms");
  await pop.click('[data-tab="pages"]'); await rowsAre(pop, "#pagesList .lrow", 1); await idle(pop, "#tab-pages");
  return pop;
}
// Every list is empty on screen (nothing but a calm state) and in memory, and every key of the lists is gone from storage.session.
async function allGone(p, why) {
  const s = await stateOf(p), keys = await storedKeys(p);
  ok(`${why}: memory holds nothing of the previous user (accounts, ads, businesses, pages)`, s.accounts === 0 && s.ads === 0 && s.bms === 0 && s.pages === 0 && s.owner === null, JSON.stringify(s));
  ok(`${why}: storage.session holds none of their keys, and the owner mark is gone`, keys.length === 0 && (await stored(p, "owner")) === undefined, JSON.stringify(keys));
  for (const [name, list, rows] of LISTS) {
    await p.click(`[data-tab="${name}"]`);
    await until(p, (l) => !!document.querySelector(`${l} .lempty`), list);   // showing the tab may start its auto-load: one "Loading…" line first, then the state
    ok(`${why}: the ${name} tab shows no row of the previous user, only a state with a button`, (await p.locator(rows).count()) === 0 && (await p.locator(`${list} .lempty`).count()) === 1, await text(p, list));
  }
}

async function switchWhileOpen() {
  console.log("\n# owner: the FB user changes while the popup is open");
  const b = await boot({ fb: adsFb(TOK), graph });
  const pop = await loadAll(b);
  ok("every list is loaded for 1001 and stored under it", (await stateOf(pop)).owner === "1001" && (await storedKeys(pop)).length >= 6 && (await stored(pop, "owner")) === "1001", JSON.stringify(await storedKeys(pop)));
  // the login in this profile changes under the open popup; the person re-reads the token (⟳)
  await b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }]);
  await pop.click('[data-tab="token"]'); await pop.click("#refreshToken");
  await until(pop, async () => (await import(chrome.runtime.getURL("js/state.js"))).state.owner === null && (await chrome.storage.session.get("accounts")).accounts === undefined);
  await allGone(pop, "token re-read (⟳)");
  // the next load belongs to the new user
  await pop.click('[data-tab="accounts"]'); await resetLocks(pop); await pop.click("#loadAccounts");
  ok("…and a list loaded afterwards is stamped with the new user, 2002", (await rowsAre(pop, ROW, 1)) && (await until(pop, async () => (await chrome.storage.session.get("owner")).owner === "2002")), String(await stored(pop, "owner")));
  await done(b);
}

async function switchBeforeOpening() {
  console.log("\n# owner: the FB user changed while no popup was open (and: logged out)");
  for (const [name, change] of [["another login", (b) => b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }])], ["logged out (no c_user at all)", (b) => b.ctx.clearCookies({ name: "c_user" })]]) {
    const b = await boot({ fb: adsFb(TOK), graph });
    const first = await loadAll(b);
    ok(`${name}: the lists of 1001 are there before`, (await stateOf(first)).accounts === 1 && (await stateOf(first)).pages === 1);
    await first.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 10 * 60000 }));         // the API pause: the new popup's automatic loads stay quiet, so what is on screen is only what was kept
    await first.close();
    await change(b);
    const pop = await popup(b);
    await until(pop, async () => (await chrome.storage.session.get("owner")).owner === undefined);
    await allGone(pop, `${name}, a new popup`);
    await done(b);
  }
}

export const flows = { ownerOpen: switchWhileOpen, ownerReopen: switchBeforeOpening };
