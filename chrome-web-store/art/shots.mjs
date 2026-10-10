// Store artwork, rendered from the STORE build (name "Ads Helper", neutral logo) with fictional data:
// popup captures -> raw/*.png (English) and raw/ru/*.png, then the composed images in ./out: the screenshot sets
// out/screenshots/en and out/screenshots/ru (1280x800, ONE popup view per tab: Businesses, Accounts, Pages, Token, Cookies = the five
// screenshots the Dashboard takes), the overview screenshot 1280x800, small tile 440x280, cover 2100x1182, social preview 1280x640.
// Anything in raw/ or out/screenshots/ that this run did not produce is deleted, so those folders only hold the current set.
// Nothing leaves the machine: Facebook, Graph (lists, the picture reads, the page picture redirect), the picture CDN and the two
// exchange-rate sources are route() mocks; every logo and picture is a generated SVG (no real faces, brands or Facebook marks).
// The run ends with a list of console errors, page errors, failed and unmocked requests of the popup (exit code 1 when there is any).
// Run:  chrome-web-store/build.sh && node chrome-web-store/art/shots.mjs
// README cover (the repo's own "FB Helper" build, original logo) -> docs/cover.png:  ART_DEV=1 node chrome-web-store/art/shots.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV = process.env.ART_DEV === "1";
const EXT = path.resolve(HERE, DEV ? "../../fb-helper" : "../release/unpacked");
const require = createRequire(import.meta.url);
// The Graph origin is the first one of the manifest's connect-src (the one place the extension names it): the mock listens on exactly that.
const GRAPH = new URL(JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")).content_security_policy.extension_pages.match(/connect-src\s+([^\s;]+)/)[1]).origin;
const { chromium } = [process.env.PLAYWRIGHT_CORE, "playwright-core", "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright-core"]
  .filter(Boolean).reduce((found, p) => found || (() => { try { return require(p); } catch { return null; } })(), null) || {};
if (!chromium) throw new Error("playwright-core not found");
fs.mkdirSync(path.join(HERE, "raw", "ru"), { recursive: true });
fs.mkdirSync(path.join(HERE, "raw", "dev"), { recursive: true });
fs.mkdirSync(path.join(HERE, "out", "screenshots", "en"), { recursive: true });
fs.mkdirSync(path.join(HERE, "out", "screenshots", "ru"), { recursive: true });

// ---------- fictional data ----------
const TOKEN = "EAAB" + "A5RNthUuuhqnyPXrrDqd5yHf5qnj44XUzUJSaS6itQwK3mVbLpYc8ZdT1eRxG2oHsJfNaWvBu9".slice(0, 70);
const USER = "100087452196634";
const PERMS = ["ads_management", "ads_read", "business_management", "catalog_management", "pages_manage_ads", "pages_manage_engagement",
  "pages_manage_metadata", "pages_manage_posts", "pages_read_engagement", "pages_read_user_content", "pages_show_list", "read_insights",
  "instagram_basic", "instagram_manage_comments", "instagram_manage_insights", "leads_retrieval", "public_profile", "email"];

// Pictures: a generated tile per business and per Page (a gradient and one white shape), served by the picture CDN mock below. `how` says
// where the extension finds the picture, so every route to it is used once: "list" = the list read brings the URL, "batch" = only the
// GET /<version>/?ids=…&fields=… picture read does, "redirect" = nothing but the Page picture redirect <Graph>/<version>/<id>/picture does.
const SHAPES = {
  star: '<path d="M32 9 36.5 27.5 55 32 36.5 36.5 32 55 27.5 36.5 9 32 27.5 27.5Z" fill="#fff"/>',
  arc: '<path d="M13 46C19 18 45 18 51 46" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/><circle cx="32" cy="47" r="4.5" fill="#fff"/>',
  ring: '<circle cx="32" cy="32" r="15" fill="none" stroke="#fff" stroke-width="8"/><circle cx="32" cy="32" r="4" fill="#fff"/>',
  chevrons: '<path d="M14 36 32 18 50 36M14 51 32 33 50 51" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
  peak: '<path d="M9 52 32 11 55 52Z" fill="#fff"/><path d="M32 31 41 52H23Z" fill="BG"/>',
  bars: '<rect x="12" y="30" width="10" height="22" rx="3" fill="#fff"/><rect x="27" y="18" width="10" height="34" rx="3" fill="#fff"/><rect x="42" y="10" width="10" height="42" rx="3" fill="#fff"/>',
  wave: '<path d="M8 26C16 16 24 16 32 26S48 36 56 26M8 44C16 34 24 34 32 44S48 54 56 44" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>',
  leaf: '<path d="M14 50C12 26 28 12 52 12 54 36 40 52 14 50Z" fill="#fff"/><path d="M16 48 38 26" stroke="BG" stroke-width="4" stroke-linecap="round"/>',
  cup: '<path d="M16 22H44V36C44 46 38 52 30 52S16 46 16 36Z" fill="#fff"/><path d="M44 27H48A6 6 0 0 1 48 41H43" fill="none" stroke="#fff" stroke-width="5"/>',
  diamond: '<path d="M32 9 55 32 32 55 9 32Z" fill="#fff"/><path d="M32 22 42 32 32 42 22 32Z" fill="BG"/>',
  drop: '<path d="M32 9C42 23 48 31 48 39A16 16 0 0 1 16 39C16 31 22 23 32 9Z" fill="#fff"/>',
  pin: '<path d="M32 10A15 15 0 0 1 47 25C47 38 32 54 32 54S17 38 17 25A15 15 0 0 1 32 10Z" fill="#fff"/><circle cx="32" cy="25" r="6" fill="BG"/>',
};
const tile = (shape, c1, c2) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/>${SHAPES[shape].replaceAll("BG", c2)}</svg>`;
const CDN = "https://scontent-ams4-1.xx.fbcdn.net";
const picUrl = (kind, id) => `${CDN}/v/t39.30808-1/${kind}_${id}_n.jpg?stp=dst-jpg_s200x200&_nc_cat=100&_nc_ohc=ExampleHash`;

const BUSINESSES = [
  { id: "1847259306418275", name: "Nova Media", ver: "verified", how: "list", art: ["star", "#4C6EF5", "#7048E8"] },
  { id: "1703856294071538", name: "Brightpath Digital", ver: "verified", how: "list", art: ["arc", "#12B886", "#087F5B"] },
  { id: "1362940785113247", name: "Atlas Group", ver: "verified", how: "list", art: ["peak", "#BE4BDB", "#862E9C"] },
  { id: "2284170396652081", name: "Kestrel Commerce", ver: "pending", how: "batch", art: ["chevrons", "#495057", "#212529"] },
  { id: "2091837465520316", name: "Lumen Traffic", ver: "verified", how: "list", art: ["ring", "#FCC419", "#F76707"] },
];
const BIZ = Object.fromEntries(BUSINESSES.map((b) => [b.name, b.id]));
const bizOf = (id) => BUSINESSES.find((b) => b.id === id);

// The dates a period covers, in the account's own time zone, as Graph answers them (date_start / date_stop of each insights row).
const dayOf = (tz, back) => new Date(Date.now() - back * 864e5).toLocaleDateString("en-CA", { timeZone: tz });
const SPAN = { p_today: [0, 0], p_yesterday: [1, 1], p_week: [7, 1], p_month: [30, 1] };
const ins = (tz, key, spend, clicks) => { const [from, to] = SPAN[key]; return { data: [{ spend: String(spend), impressions: String(Math.round(clicks * 38)), inline_link_clicks: String(clicks), date_start: dayOf(tz, from), date_stop: dayOf(tz, to) }] }; };
// o.d0 / d1 / d7 / d30 = spend of today / yesterday / 7 / 30 days, c* = link clicks; a period without delivery has no key at all (as Graph leaves it out).
const acc = (o) => {
  const a = { account_id: o.id, name: o.name, account_status: o.status ?? 1, disable_reason: o.reason ?? 0, currency: o.cur,
    timezone_name: o.tz, amount_spent: String(Math.round(o.all * 100)), balance: String(Math.round((o.bal ?? 0) * 100)), created_time: o.created ?? "2025-03-11T10:00:00+0000",
    business: { id: BIZ[o.biz], name: o.biz }, business_country_code: o.cc,
    funding_source_details: { display_string: o.card }, adtrust_dsl: o.dsl, adspaymentcycle: { data: [{ threshold_amount: String(o.th * 100) }] },
    adspixels: { data: [{ id: "77" + o.id.slice(-8), name: o.biz + " Pixel" }] } };
  for (const [key, spend, clicks] of [["p_today", o.d0, o.c0], ["p_yesterday", o.d1, o.c1], ["p_week", o.d7, o.c7], ["p_month", o.d30, o.c30]]) if (spend) a[key] = ins(o.tz, key, spend, clicks);
  return a;
};
const ACCOUNTS = [
  acc({ id: "1187340965221094", name: "Nova · US Main", biz: "Nova Media", cur: "USD", tz: "America/New_York", cc: "US", card: "Visa *4242", dsl: 2500, th: 500, all: 31480.2, d0: 412.6, c0: 812, d1: 806.4, c1: 1604, d7: 5420.3, c7: 10730, d30: 12840.52, c30: 23870 }),
  acc({ id: "2210457893316620", name: "Nova · EU Scale", biz: "Nova Media", cur: "EUR", tz: "Europe/Berlin", cc: "DE", card: "Mastercard *8210", dsl: 1500, th: 300, all: 9204.7, d0: 148.2, c0: 262, d1: 390.7, c1: 741, d7: 2610.4, c7: 4990, d30: 4630.15, c30: 8710 }),
  // Atlas Group is the restricted business: it OWNS an account that is disabled with disable_reason 6 (BUSINESS_INTEGRITY_RAR), the one sign Graph gives
  acc({ id: "3390118227450811", name: "Atlas · Retail", biz: "Atlas Group", status: 2, reason: 6, cur: "USD", tz: "America/Chicago", cc: "US", card: "Visa *0093", dsl: 800, th: 200, all: 12480.3, d7: 2140.5, c7: 4280, d30: 9308.8, c30: 17650 }),
  acc({ id: "5120948837721906", name: "Brightpath · NL Retail", biz: "Brightpath Digital", cur: "EUR", tz: "Europe/Amsterdam", cc: "NL", card: "Visa *7714", dsl: 1800, th: 400, all: 14210.9, d0: 96.4, c0: 190, d1: 212.8, c1: 421, d7: 1480.2, c7: 2950, d30: 5926.4, c30: 11320 }),
  acc({ id: "5120948837725583", name: "Brightpath · Promo", biz: "Brightpath Digital", status: 3, cur: "EUR", tz: "Europe/Amsterdam", cc: "NL", card: "Visa *7714", bal: 243.8, dsl: 600, th: 150, all: 1120.45, d30: 612.45, c30: 1190 }),
  acc({ id: "6603217745098813", name: "Kestrel · Shop", biz: "Kestrel Commerce", cur: "USD", tz: "America/Denver", cc: "US", card: "Mastercard *5521", dsl: 1000, th: 250, all: 5330.8, d0: 82.4, c0: 160, d1: 133.5, c1: 262, d7: 905.3, c7: 1790, d30: 3140, c30: 6120 }),
  acc({ id: "6603217745092270", name: "Kestrel · Old Test", biz: "Kestrel Commerce", status: 2, reason: 1, cur: "USD", tz: "America/Denver", cc: "US", card: "—", dsl: 500, th: 100, all: 215.3, created: "2024-11-02T09:30:00+0000" }),
  acc({ id: "1509826643170382", name: "Lumen · Leadgen", biz: "Lumen Traffic", cur: "USD", tz: "Asia/Bangkok", cc: "TH", card: "Visa *1881", dsl: 1000, th: 250, all: 6120.4, d0: 96.1, c0: 190, d1: 240.9, c1: 470, d7: 1490.8, c7: 3020, d30: 1985.44, c30: 4310 }),
  acc({ id: "1509826643170518", name: "Lumen · Retarget", biz: "Lumen Traffic", cur: "USD", tz: "Asia/Bangkok", cc: "TH", card: "Visa *1881", dsl: 500, th: 120, all: 1544.9, d0: 21.7, c0: 44, d1: 58.3, c1: 117, d7: 331.6, c7: 662, d30: 820.3, c30: 1580 }),
];

// Pages: mine = in me/accounts (the profile has a task on it); the rest is only seen through the owner business (owned_pages).
// tasks without ADVERTISE would also be "No access"; here the missing task is the missing me/accounts row.
const PAGES = [
  { id: "108374925510246", name: "Harbor & Pine Coffee", biz: "Nova Media", mine: true, how: "list", art: ["cup", "#B7791F", "#7B341E"], ig: { id: "17841400118820341", username: "harborpine" } },
  { id: "112950846307731", name: "Brightpath Fitness Studio", biz: "Brightpath Digital", mine: true, how: "batch", art: ["bars", "#20C997", "#0B7285"], pbia: "17841400227731095" },
  { id: "104286531792048", name: "Kestrel Outdoor Gear", biz: "Kestrel Commerce", mine: true, how: "redirect", art: ["peak", "#74C0FC", "#1864AB"] },
  { id: "109618270453319", name: "Atlas Home Outlet", biz: "Atlas Group", mine: true, how: "list", art: ["diamond", "#FF8787", "#C92A2A"], dead: "This Page is restricted from advertising because of Advertising Standards violations.", ig: { id: "17841400339904412", username: "atlashomeoutlet" } },
  { id: "115402736881254", name: "Orchid Skin Lab", biz: "Brightpath Digital", mine: true, how: "list", art: ["drop", "#F783AC", "#A61E4D"], hidden: true },
  { id: "101937468205573", name: "Lumen Travel Deals", biz: "Lumen Traffic", mine: false, how: "list", art: ["pin", "#FFA94D", "#D9480F"], ig: { id: "17841400448815560", username: "lumentraveldeals" } },
];
const pageNode = (p, { tasks = false } = {}) => ({
  id: p.id, name: p.name, is_published: !p.hidden, promotion_eligible: !p.dead, ...(p.dead ? { promotion_ineligible_reason: p.dead } : {}),
  ...(tasks ? { tasks: ["ADVERTISE", "ANALYZE", "CREATE_CONTENT", "MESSAGING", "MODERATE", "MANAGE"] } : {}),
  ...(p.ig ? { instagram_business_account: p.ig } : {}), ...(p.pbia ? { connected_page_backed_instagram_account: { id: p.pbia } } : {}),
  ...(p.how === "list" ? { picture: { data: { url: picUrl("page", p.id), width: 50, height: 50, is_silhouette: false } } } : {}),
  business: { id: BIZ[p.biz], name: p.biz },
});

// ---------- browser ----------
const problems = [];                                           // what went wrong on the way: reported at the end, never silently dropped
const ctx = await chromium.launchPersistentContext("", { channel: "chromium", headless: true, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
// Obviously synthetic values in the real cookie shapes: these end up in public screenshots.
const jar = { c_user: USER, xs: "47%3AExampleExampleEx%3A2%3A1759012345%3A-1%3A-1", datr: "ExampleDatrExampleDatr01",
  fr: "0ExampleFr1Example2.AAA.0.0.BExample.AWExample", sb: "ExampleSbExampleSbExampl" };
const SHOT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
await ctx.addCookies(Object.entries(jar).map(([name, value]) => ({ name, value, domain: ".facebook.com", path: "/", secure: true })));
await ctx.route("https://*.facebook.com/**", (r) => r.fulfill({ contentType: "text/html",
  body: r.request().url().includes("adsmanager") ? `<script>window.__accessToken=${JSON.stringify(TOKEN)}</script>Ads Manager` : "<p>feed</p>" }));
// The exchange-rate sources (the total of several currencies asks for them): a fixed table, never the network.
await ctx.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ date: new Date().toISOString().slice(0, 10),
  usd: { usd: 1, eur: 0.92, gbp: 0.78, pln: 3.95, uah: 41.2, rub: 91.5, vnd: 25400 } }) }));
await ctx.route("https://latest.currency-api.pages.dev/**", (r) => r.abort("failed"));
// The picture CDN: the generated tile of a business or Page (the id is in the path), nothing from the network.
const svg = (body) => ({ status: 200, contentType: "image/svg+xml", headers: { "cache-control": "no-store" }, body });
const artOf = (kind, id) => (kind === "biz" ? bizOf(id) : PAGES.find((p) => p.id === id))?.art;
await ctx.route("https://*.fbcdn.net/**", (r) => {
  const m = new URL(r.request().url()).pathname.match(/\/(biz|page)_(\d+)_n\.jpg$/), a = m && artOf(m[1], m[2]);
  if (!a) { problems.push(`unmocked picture: ${r.request().url()}`); return r.fulfill({ status: 404, body: "" }); }
  r.fulfill(svg(tile(...a)));
});
const reply = (r, body) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
await ctx.route(`${GRAPH}/**`, (r) => {
  const u = new URL(r.request().url()), p = u.pathname.replace(/^\/v[\d.]+(?=\/|$)/, "") || "/", fields = u.searchParams.get("fields") || "";
  let m;
  if (p === "/me") return reply(r, { id: USER, name: "Alex Carter" });
  if (p === "/app") return reply(r, { id: "119211728144504", name: "Facebook Ads Manager" });
  if (p === "/me/permissions") return reply(r, { data: PERMS.map((permission) => ({ permission, status: "granted" })) });
  if (p === "/me/adaccounts") return reply(r, { data: ACCOUNTS });
  if (p === "/me/businesses") return reply(r, { data: BUSINESSES.map((b) => ({ id: b.id, name: b.name,
    ...(fields.includes("verification_status") ? { verification_status: b.ver } : {}),
    ...(fields.includes("profile_picture_uri") && b.how === "list" ? { profile_picture_uri: picUrl("biz", b.id) } : {}) })) });
  if (p === "/me/accounts") return reply(r, { data: PAGES.filter((x) => x.mine).map((x) => pageNode(x, { tasks: true })) });
  if ((m = p.match(/^\/(\d+)\/(owned_ad_accounts|client_ad_accounts|owned_pages|client_pages)$/))) {
    const [, id, edge] = m;
    return reply(r, { data: edge === "owned_ad_accounts" ? ACCOUNTS.filter((a) => a.business.id === id)
      : edge === "owned_pages" ? PAGES.filter((x) => BIZ[x.biz] === id).map((x) => pageNode(x)) : [] });
  }
  // the picture reads (js/pictures.js): GET /<version>/?ids=1,2,3&fields=picture{url} (Pages) or fields=profile_picture_uri (businesses); the answer is { "<id>": { … } }
  if (p === "/" && u.searchParams.has("ids")) {
    const out = {};
    for (const id of u.searchParams.get("ids").split(",")) {
      const biz = bizOf(id), pg = PAGES.find((x) => x.id === id);
      if (fields.includes("profile_picture_uri") && biz) out[id] = { id, ...(biz.how !== "redirect" ? { profile_picture_uri: picUrl("biz", id) } : {}) };
      else if (fields.includes("picture") && pg) out[id] = { id, ...(pg.how === "list" || pg.how === "batch" ? { picture: { data: { url: picUrl("page", id) } } } : {}) };
    }
    return reply(r, out);
  }
  // the picture redirect of a Page that has no URL yet: <Graph>/<version>/<id>/picture?type=small answers with the picture (Playwright does not route the second leg of a redirect)
  if ((m = p.match(/^\/(\d+)\/picture$/)) && artOf("page", m[1])) return r.fulfill(svg(tile(...artOf("page", m[1]))));
  problems.push(`unmocked Graph request: ${p}${u.search}`);
  reply(r, { data: [] });
});
const boot = await ctx.newPage(); await boot.goto("chrome://extensions");
const id = await boot.evaluate(() => document.querySelector("extensions-manager").shadowRoot.querySelector("extensions-item-list").shadowRoot.querySelector("extensions-item").id);
await boot.close();
const ads = await ctx.newPage();
// The headless browser would report "HeadlessChrome" (and the host OS): the shots show a typical profile's UA, spoofed for pages like an antidetect browser does.
await ads.addInitScript((ua) => Object.defineProperty(Navigator.prototype, "userAgent", { get: () => ua }), SHOT_UA);
await ads.goto("https://adsmanager.facebook.com/adsmanager/manage/campaigns");

// The popup is at most 600 px tall: a list that is longer is cut at its last row that fits whole (and its divider and a group header left
// without rows are taken away), so no row is cut through. Returns the clip height; unfit() puts the rows back.
async function fit(pop, listSel, max = 600, pad = 0) {
  return pop.evaluate(([sel, max, pad]) => {
    window.scrollTo(0, 0);
    document.getElementById("fit-style")?.remove();
    document.head.append(Object.assign(document.createElement("style"), { id: "fit-style", textContent: ".fit-last::after { display: none !important; }" }));
    const kids = [...document.querySelector(sel).children], tops = kids.map((k) => k.getBoundingClientRect().bottom + window.scrollY);
    if (document.body.scrollHeight <= max) return document.body.scrollHeight;
    let n = kids.findIndex((k, i) => tops[i] + pad > max);
    if (n < 0) n = kids.length;
    while (n > 0 && kids[n - 1].classList.contains("lgroup")) n--;                       // a group header with no rows under it
    kids.forEach((k, i) => { k.style.display = i < n ? "" : "none"; k.classList.toggle("fit-last", i === n - 1); });
    return Math.ceil(tops[n - 1] + pad);
  }, [listSel, max, pad]);
}
const unfit = (pop, listSel) => pop.evaluate((sel) => [...document.querySelector(sel).children].forEach((k) => { k.style.display = ""; k.classList.remove("fit-last"); }), listSel);

const produced = new Set();                                    // raw captures of this run (anything else in raw/ is stale)
async function capture(lang, dir, { cover = true } = {}) {
  const pop = await ctx.newPage();
  const label = `popup ${lang}`;
  pop.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`${label} console.${m.type()}: ${m.text()}`); });
  pop.on("pageerror", (e) => problems.push(`${label} page error: ${e.message}`));
  pop.on("requestfailed", (q) => problems.push(`${label} request failed: ${q.url()} (${q.failure()?.errorText})`));
  await pop.setViewportSize({ width: 560, height: 600 });
  await pop.goto(`chrome-extension://${id}/popup.html`);
  // a clean start per language: no accounts, lists or open rows left from the previous pass
  await pop.evaluate(async ([l]) => { await chrome.storage.session.clear(); await chrome.storage.local.set({ lang: l }); localStorage.setItem("period", "month"); localStorage.removeItem("tab"); }, [lang]);
  await pop.reload();
  await pop.waitForFunction(() => /^EAA/.test(document.querySelector("#tokenBox").textContent.trim()), null, { timeout: 8000 });
  const settle = (ms = 500) => pop.waitForTimeout(ms);
  const shot = async (name, clip) => {
    await pop.evaluate(() => document.activeElement?.blur());
    await pop.mouse.move(2, 2);                                  // no hover on a tab or a row
    const h = clip ?? await pop.evaluate(() => Math.min(600, document.body.scrollHeight));
    await pop.screenshot({ path: path.join(dir, name + ".png"), clip: { x: 0, y: 0, width: 560, height: h } });
    produced.add(path.join(dir, name + ".png"));
  };
  // the list tab is loaded (rows, the load has ended, every picture is in) and the font is ready
  const ready = async (tab, list, rows, total) => {
    await pop.click(`[data-tab="${tab}"]`);
    await pop.waitForFunction(([list, rows]) => document.querySelectorAll(`${list} .lrow`).length === rows, [list, rows], { timeout: 15000 });
    await pop.waitForFunction(() => !document.querySelector(".panel.active").dataset.loading && !document.querySelector("#tab-accounts").dataset.loading, null, { timeout: 15000 });
    if (total) await pop.waitForFunction((sel) => /^≈/.test(document.querySelector(sel)?.textContent.trim() ?? ""), total, { timeout: 15000 });
    await pop.waitForFunction((list) => document.querySelectorAll(`${list} .lav`).length === document.querySelectorAll(`${list} .lav.ok`).length, list, { timeout: 15000 });
    await pop.evaluate(() => document.fonts.ready);
    await settle(700);
  };

  // 1 token + check (the popup reopens on the tab used last)
  await pop.click('[data-tab="token"]');
  await pop.waitForFunction(() => !document.querySelector("#checkToken").disabled, null, { timeout: 8000 });
  await pop.click("#checkToken"); await pop.waitForFunction(() => document.querySelectorAll("#tokenInfo dd").length >= 3 && !/…/.test(document.querySelector("#tokenInfo").textContent));
  await settle(); await shot("check");
  // 2 cookies
  await pop.click('[data-tab="cookies"]'); await pop.waitForFunction(() => document.querySelector("#cookieBox").classList.contains("filled")); await pop.evaluate(() => document.fonts.ready); await settle(); await shot("cookies");
  // 3 businesses (the tab loads the Accounts list too: its spend, counts and the restricted state come from it)
  if (!DEV) {
    await ready("bms", "#bmsList", BUSINESSES.length, "#bmsTotal .total-value");
    await shot("businesses", await fit(pop, "#bmsList")); await unfit(pop, "#bmsList");
  }
  // 4 accounts, grouped by business
  await ready("accounts", "#accountsList", ACCOUNTS.length, "#accountsTotal .total-value");
  await shot("accounts", await fit(pop, "#accountsList")); await unfit(pop, "#accountsList");
  // cover variant: only the first three rows, cut right under the third (the total still adds up all of them)
  if (cover) {
    const h = await pop.evaluate(() => { const kids = [...document.querySelector("#accountsList").children]; const third = kids.filter((k) => k.classList.contains("lrow"))[2];
      kids.slice(kids.indexOf(third) + 1).forEach((x) => { x.style.display = "none"; }); third.classList.add("fit-last");
      document.head.append(Object.assign(document.createElement("style"), { textContent: ".fit-last::after { display: none !important; }" }));
      return Math.ceil(third.getBoundingClientRect().bottom + 12); });
    await shot("accounts-cover", h);
    await unfit(pop, "#accountsList");
  }
  // 5 pages
  if (!DEV) {
    await ready("pages", "#pagesList", PAGES.length);
    await shot("pages", await fit(pop, "#pagesList")); await unfit(pop, "#pagesList");
  }
  await pop.close();
}
if (DEV) await capture("en", path.join(HERE, "raw", "dev"));
else { await capture("en", path.join(HERE, "raw")); await capture("ru", path.join(HERE, "raw", "ru"), { cover: false }); }
await ctx.close();

// ---------- compose ----------
const b = await chromium.launch({ channel: "chromium", headless: true });
const made = new Set();
const render = async (html, out, w, h, scale = 1, type = "png") => {
  const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await pg.goto(pathToFileURL(path.join(HERE, html.split("#")[0])).href + (html.includes("#") ? "#" + html.split("#")[1] : ""));
  await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(HERE, "out", out), type, ...(type === "jpeg" ? { quality: 92 } : {}) });
  made.add(path.join(HERE, "out", out));
  await pg.close();
};
if (DEV) {
  await render("cover.html#dev", "cover-fb.png", 1400, 788, 1.5);
  fs.copyFileSync(path.join(HERE, "out", "cover-fb.png"), path.join(HERE, "../../docs/cover.png")); fs.rmSync(path.join(HERE, "out", "cover-fb.png"));
  await b.close(); console.log("done -> docs/cover.png");
  if (problems.length) { console.log(`PROBLEMS (${problems.length}):\n${[...new Set(problems)].join("\n")}`); process.exit(1); }
  process.exit(0);
}
await render("cover.html", "cover.png", 1400, 788, 1.5);
await render("social.html", "social-preview.png", 1280, 640, 1);
await render("tile.html", "promo-tile-440x280.png", 440, 280, 1);
await render("cover-1280x800.html", "store-screenshot-1280x800.png", 1280, 800, 1);
// one popup view per tab and per screenshot, English and Russian (the Dashboard takes five per language)
const SCREENS = [
  { f: "01-businesses", img: "businesses", en: ["Every business and what it spends", "Spend per business for the period you pick, active and disabled ad accounts, and a restriction or a failed verification with a link to where you fix it."],
    ru: ["Все бизнесы и их спенд", "Спенд бизнеса за выбранный период, активные и заблокированные кабинеты, а ограничение или непройденная верификация — со ссылкой, где это исправить."] },
  { f: "02-accounts", img: "accounts", en: ["Every ad account at a glance", "Grouped by business: status, spend for today, yesterday, 7 and 30 days and all time, limits and billing — without opening Facebook."],
    ru: ["Все кабинеты перед глазами", "Группы по бизнесам: статус, спенд за сегодня, вчера, 7 и 30 дней и всё время, лимиты и оплата — не заходя в Facebook."] },
  { f: "03-pages", img: "pages", en: ["Which Pages can run ads", "Alive, dead, hidden or without your access — with Meta's reason for a dead Page and a link to fix each problem."],
    ru: ["Какие страницы годятся для рекламы", "Живая, мёртвая, скрытая или без вашего доступа — с причиной от Meta для мёртвой страницы и ссылкой, как исправить каждую проблему."] },
  { f: "04-token", img: "check", en: ["The token, checked", "Its type, owner, app and permissions, plus where to find each of the five token types."],
    ru: ["Токен с проверкой", "Тип, владелец, приложение и права, плюс где взять каждый из пяти типов токенов."] },
  { f: "05-cookies", img: "cookies", en: ["Cookies and User-Agent in one click", "Cookies with the User-Agent, or JSON — or the token, cookies and User-Agent in one block."],
    ru: ["Cookie и User-Agent в один клик", "Cookie вместе с User-Agent или JSON — либо токен, cookie и User-Agent одним блоком."] },
];
for (const lang of ["en", "ru"]) for (const sc of SCREENS) {
  const q = new URLSearchParams({ img: (lang === "ru" ? "raw/ru/" : "raw/") + sc.img + ".png", t: sc[lang][0], s: sc[lang][1], lang });
  await render(`screen.html#${q}`, `screenshots/${lang}/${sc.f}.png`, 1280, 800, 1);
}
await b.close();
// What this run did not make is stale (a capture or a screenshot that was renamed or dropped): out/ and raw/ only hold the current set.
const sweep = (dir, keep) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isFile() && !keep.has(p) && f.name !== ".DS_Store") { fs.rmSync(p); console.log("removed stale", path.relative(HERE, p)); } } };
sweep(path.join(HERE, "raw"), produced); sweep(path.join(HERE, "raw", "ru"), produced);
sweep(path.join(HERE, "out"), made); sweep(path.join(HERE, "out", "screenshots", "en"), made); sweep(path.join(HERE, "out", "screenshots", "ru"), made);
console.log("done ->", path.join(HERE, "out"));
if (problems.length) { console.log(`PROBLEMS (${problems.length}):\n${[...new Set(problems)].join("\n")}`); process.exitCode = 1; }
