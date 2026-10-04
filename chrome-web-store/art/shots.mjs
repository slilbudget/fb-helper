// Store artwork, rendered from the STORE build (name "Ads Helper", neutral logo) with fictional data:
// popup captures -> raw/*.png (English) and raw/ru/*.png, then the composed images in ./out: the screenshot sets
// out/screenshots/en and out/screenshots/ru (1280x800, one popup view each), the overview screenshot 1280x800,
// small tile 440x280, cover 2100x1182, social preview 1280x640. Nothing leaves the machine: Facebook and Graph are route() mocks.
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
const { chromium } = [process.env.PLAYWRIGHT_CORE, "playwright-core", "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright-core"]
  .filter(Boolean).reduce((found, p) => found || (() => { try { return require(p); } catch { return null; } })(), null) || {};
if (!chromium) throw new Error("playwright-core not found");
fs.mkdirSync(path.join(HERE, "raw", "ru"), { recursive: true });
fs.mkdirSync(path.join(HERE, "raw", "dev"), { recursive: true });
fs.mkdirSync(path.join(HERE, "out", "screenshots", "en"), { recursive: true });
fs.mkdirSync(path.join(HERE, "out", "screenshots", "ru"), { recursive: true });
fs.mkdirSync(path.join(HERE, "out"), { recursive: true });

// ---------- fictional data ----------
const TOKEN = "EAAB" + "A5RNthUuuhqnyPXrrDqd5yHf5qnj44XUzUJSaS6itQwK3mVbLpYc8ZdT1eRxG2oHsJfNaWvBu9".slice(0, 70);
const USER = "100087452196634";
const PERMS = ["ads_management", "ads_read", "business_management", "catalog_management", "pages_manage_ads", "pages_manage_engagement",
  "pages_manage_metadata", "pages_manage_posts", "pages_read_engagement", "pages_read_user_content", "pages_show_list", "read_insights",
  "instagram_basic", "instagram_manage_comments", "instagram_manage_insights", "leads_retrieval", "public_profile", "email"];
const ins = (spend, clicks) => ({ data: [{ spend: String(spend), impressions: String(clicks * 38), inline_link_clicks: String(clicks) }] });
const acc = (o) => ({ account_id: o.id, name: o.name, account_status: o.status ?? 1, disable_reason: o.reason ?? 0, currency: o.cur,
  timezone_name: o.tz, amount_spent: String(Math.round(o.all * 100)), balance: "0", created_time: "2025-03-11T10:00:00+0000",
  business: { id: "9100" + o.id.slice(-6), name: o.biz }, business_country_code: o.cc,
  funding_source_details: { display_string: o.card }, adtrust_dsl: o.dsl, adspaymentcycle: { data: [{ threshold_amount: String(o.th * 100) }] },
  adspixels: { data: [{ id: "77" + o.id.slice(-8), name: o.biz + " Pixel" }] },
  p_today: ins(o.d0, o.c0), p_yesterday: ins(o.d1, o.c1), p_week: ins(o.d7, o.c7), p_month: ins(o.d30, o.c30) });
const ACCOUNTS = [
  acc({ id: "1187340965221094", name: "Nova · US Main", biz: "Nova Media", cur: "USD", tz: "America/New_York", cc: "US", card: "Visa *4242", dsl: 2500, th: 500, all: 31480.2, d0: 412.6, c0: 812, d1: 806.4, c1: 1604, d7: 5420.3, c7: 10730, d30: 12840.52, c30: 23870 }),
  acc({ id: "2210457893316620", name: "Nova · EU Scale", biz: "Nova Media", cur: "EUR", tz: "Europe/Berlin", cc: "DE", card: "Mastercard *8210", dsl: 1500, th: 300, all: 9204.7, d0: 148.2, c0: 262, d1: 390.7, c1: 741, d7: 2610.4, c7: 4990, d30: 4630.15, c30: 8710 }),
  acc({ id: "1509826643170382", name: "Lumen · Leadgen", biz: "Lumen Traffic", cur: "USD", tz: "Asia/Bangkok", cc: "TH", card: "Visa *1881", dsl: 1000, th: 250, all: 6120.4, d0: 96.1, c0: 190, d1: 240.9, c1: 470, d7: 1490.8, c7: 3020, d30: 1985.44, c30: 4310 }),
  acc({ id: "3390118227450811", name: "Atlas · Retail", biz: "Atlas Group", status: 3, cur: "USD", tz: "America/Chicago", cc: "US", card: "Visa *0093", dsl: 800, th: 200, all: 2240, d0: 0, c0: 0, d1: 0, c1: 0, d7: 0, c7: 0, d30: 214.7, c30: 380 }),
  acc({ id: "4402871960135522", name: "Old · Test", biz: "Nova Media", status: 2, reason: 1, cur: "USD", tz: "UTC", cc: "US", card: "—", dsl: 500, th: 100, all: 880.6, d0: 0, c0: 0, d1: 0, c1: 0, d7: 0, c7: 0, d30: 0, c30: 0 }),
];
const ADS = [
  { id: "a1", name: "Spring sale · video 1", effective_status: "ACTIVE" },
  { id: "a2", name: "Spring sale · carousel", effective_status: "ACTIVE" },
  { id: "a3", name: "Lookalike 1% · static", effective_status: "DISAPPROVED", ad_review_feedback: {
    global: { "Personal attributes": "Ad implies knowledge of personal traits" },
    placement_specific: { instagram: { "Misleading claims": "Ad makes unrealistic claims" } } } },
  { id: "a4", name: "Retarget 7d · story", effective_status: "PENDING_REVIEW" },
  { id: "a5", name: "Brand · reel", effective_status: "PAUSED" },
];
// the second read (numbers per ad): one row per ad, every period as a field alias; an ad without a key had no delivery
const ADS_STATS = [
  { id: "a1", p_today: ins(412.6, 812), p_yesterday: ins(806.4, 1604), p_week: ins(3420.3, 6730), p_month: ins(4820.35, 9210), p_all: ins(9860.1, 19340) },
  { id: "a2", p_today: ins(96.1, 190), p_yesterday: ins(240.9, 470), p_week: ins(1490.8, 3020), p_month: ins(3112.8, 6100), p_all: ins(5210.4, 10180) },
  { id: "a3", p_week: ins(540.2, 1010), p_month: ins(1260.4, 2300), p_all: ins(1260.4, 2300) },
  { id: "a4" },
  { id: "a5", p_month: ins(410.2, 820), p_all: ins(2980.5, 6120) },
];

// ---------- browser ----------
const ctx = await chromium.launchPersistentContext("", { channel: "chromium", headless: true, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
// Obviously synthetic values in the real cookie shapes: these end up in public screenshots.
const jar = { c_user: USER, xs: "47%3AExampleExampleEx%3A2%3A1759012345%3A-1%3A-1", datr: "ExampleDatrExampleDatr01",
  fr: "0ExampleFr1Example2.AAA.0.0.BExample.AWExample", sb: "ExampleSbExampleSbExampl" };
const SHOT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
await ctx.addCookies(Object.entries(jar).map(([name, value]) => ({ name, value, domain: ".facebook.com", path: "/", secure: true })));
await ctx.route("https://*.facebook.com/**", (r) => r.fulfill({ contentType: "text/html",
  body: r.request().url().includes("adsmanager") ? `<script>window.__accessToken=${JSON.stringify(TOKEN)}</script>Ads Manager` : "<p>feed</p>" }));
await ctx.route("https://graph.facebook.com/**", (r) => {
  const u = new URL(r.request().url()), p = u.pathname.replace(/^\/v[\d.]+\//, "/");
  const body = p === "/me" ? { id: USER, name: "Alex Carter" }
    : p === "/app" ? { id: "119211728144504", name: "Facebook Ads Manager" }
    : p === "/me/permissions" ? { data: PERMS.map((permission) => ({ permission, status: "granted" })) }
    : p === "/me/adaccounts" ? { data: ACCOUNTS }
    : /\/act_\d+\/ads$/.test(p) ? { data: (u.searchParams.get("fields") || "").includes("p_today") ? ADS_STATS : ADS } : { data: [] };
  r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
});
const boot = await ctx.newPage(); await boot.goto("chrome://extensions");
const id = await boot.evaluate(() => document.querySelector("extensions-manager").shadowRoot.querySelector("extensions-item-list").shadowRoot.querySelector("extensions-item").id);
await boot.close();
const ads = await ctx.newPage();
// The headless browser would report "HeadlessChrome" (and the host OS): the shots show a typical profile's UA, spoofed for pages like an antidetect browser does.
await ads.addInitScript((ua) => Object.defineProperty(Navigator.prototype, "userAgent", { get: () => ua }), SHOT_UA);
await ads.goto("https://adsmanager.facebook.com/adsmanager/manage/campaigns");

const settleFor = (pg) => (ms = 500) => pg.waitForTimeout(ms);
async function capture(lang, dir) {
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 560, height: 600 });
  await pop.goto(`chrome-extension://${id}/popup.html`);
  // a clean start per language: no accounts, ads or open rows left from the previous pass
  await pop.evaluate(async ([l]) => { await chrome.storage.session.clear(); await chrome.storage.local.set({ lang: l }); localStorage.setItem("period", "month"); localStorage.removeItem("tab"); }, [lang]);
  await pop.reload();
  await pop.waitForFunction(() => /^EAA/.test(document.querySelector("#tokenBox").textContent.trim()), null, { timeout: 8000 });
  const settle = settleFor(pop);
  const shot = async (name, clip) => {
    await pop.evaluate(() => document.activeElement?.blur());
    const h = await pop.evaluate(() => Math.min(600, document.body.scrollHeight));
    await pop.screenshot({ path: path.join(dir, name + ".png"), clip: { x: 0, y: 0, width: 560, height: clip || h } });
  };

  // 1 token + check (the popup reopens on the tab used last)
  await pop.click('[data-tab="token"]');
  await pop.waitForFunction(() => !document.querySelector("#checkToken").disabled, null, { timeout: 8000 });
  await pop.click("#checkToken"); await pop.waitForFunction(() => document.querySelectorAll("#tokenInfo dd").length >= 3 && !/…/.test(document.querySelector("#tokenInfo").textContent));
  await settle(); await shot("check");
  // 2 cookies
  await pop.click('[data-tab="cookies"]'); await pop.waitForFunction(() => document.querySelector("#cookieBox").classList.contains("filled") && /^Mozilla/.test(document.querySelector("#uaBox").textContent)); await settle(); await shot("cookies");
  // 3 accounts
  await pop.click('[data-tab="accounts"]'); await pop.waitForFunction(() => document.querySelectorAll(".acc").length === 5, null, { timeout: 15000 }).catch(async () => {
    await pop.click("#loadAccounts"); await pop.waitForFunction(() => document.querySelectorAll(".acc").length === 5, null, { timeout: 15000 }); });
  await settle(700); await shot("accounts");
  // cover variant: only the first three rows, cut right under the third (the header still says "5 ad accounts")
  {
    const h = await pop.evaluate(() => { const r = [...document.querySelectorAll(".acc")]; r.slice(3).forEach((x) => { x.style.display = "none"; });
      return Math.ceil(r[2].getBoundingClientRect().bottom + 12); });
    await shot("accounts-cover", h);
    await pop.evaluate(() => document.querySelectorAll(".acc").forEach((x) => { x.style.display = ""; }));
  }
  // 4 ads: the first account open, its ads loaded (list, then the numbers), scrolled so the ads card starts in the upper part
  await pop.click(".acc .acc-title");
  await pop.click(".acc.open [data-ads]");
  await pop.waitForFunction(() => document.querySelectorAll(".ad-stats").length >= 3, null, { timeout: 15000 });
  await settle(700);
  await pop.evaluate(() => { const c = document.querySelector(".ads-card"); window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 203); });
  await pop.mouse.move(2, 590); await settle(300);
  await shot("ads", 600);
  await pop.close();
}
if (DEV) await capture("en", path.join(HERE, "raw", "dev"));
else { await capture("en", path.join(HERE, "raw")); await capture("ru", path.join(HERE, "raw", "ru")); }
await ctx.close();

// ---------- compose ----------
const b = await chromium.launch({ channel: "chromium", headless: true });
const render = async (html, out, w, h, scale = 1, type = "png") => {
  const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await pg.goto(pathToFileURL(path.join(HERE, html.split("#")[0])).href + (html.includes("#") ? "#" + html.split("#")[1] : ""));
  await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(HERE, "out", out), type, ...(type === "jpeg" ? { quality: 92 } : {}) });
  await pg.close();
};
if (DEV) {
  await render("cover.html#dev", "cover-fb.png", 1400, 788, 1.5);
  fs.copyFileSync(path.join(HERE, "out", "cover-fb.png"), path.join(HERE, "../../docs/cover.png")); fs.rmSync(path.join(HERE, "out", "cover-fb.png"));
  await b.close(); console.log("done -> docs/cover.png"); process.exit(0);
}
await render("cover.html", "cover.png", 1400, 788, 1.5);
await render("social.html", "social-preview.png", 1280, 640, 1);
await render("tile.html", "promo-tile-440x280.png", 440, 280, 1);
await render("cover-1280x800.html", "store-screenshot-1280x800.png", 1280, 800, 1);
// one popup view per screenshot, English and Russian
const SCREENS = [
  { f: "01-accounts", img: "accounts-cover", en: ["Every ad account at a glance", "Status, spend for today, yesterday, 7 and 30 days and all time, limits and billing — without opening Facebook."],
    ru: ["Все кабинеты перед глазами", "Статус, спенд за сегодня, вчера, 7 и 30 дней и всё время, лимиты и оплата — не заходя в Facebook."] },
  { f: "02-ads", img: "ads", en: ["Ads with their own numbers", "Status, rejection reasons, spend, impressions, clicks and CPC for each ad."],
    ru: ["Объявления со своими метриками", "Статус, причины отклонения, спенд, показы, клики и CPC по каждому объявлению."] },
  { f: "03-token", img: "check", en: ["The token, checked", "Its type, owner, app and permissions, plus where to find each of the five token types."],
    ru: ["Токен с проверкой", "Тип, владелец, приложение и права, плюс где взять каждый из пяти типов токенов."] },
  { f: "04-cookies", img: "cookies", en: ["Cookies and User-Agent in one click", "Cookies as a string or JSON — or the token, cookies and User-Agent in one block."],
    ru: ["Cookie и User-Agent в один клик", "Cookie строкой или JSON — либо токен, cookie и User-Agent одним блоком."] },
];
for (const lang of ["en", "ru"]) for (const sc of SCREENS) {
  const q = new URLSearchParams({ img: (lang === "ru" ? "raw/ru/" : "raw/") + sc.img + ".png", t: sc[lang][0], s: sc[lang][1], lang });
  await render(`screen.html#${q}`, `screenshots/${lang}/${sc.f}.png`, 1280, 800, 1);
}
await b.close();
console.log("done ->", path.join(HERE, "out"));
