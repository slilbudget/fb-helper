// Pages tab: automatic first load, the one-minute slot, optional fields Graph refuses, permission errors, a Page access token
// that must never be kept, problem chips, search, copy IDs, language, the per-user cache and other windows. Fictional data.
import { GRAPH, TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, captureClipboard, clip, accountsJson, adsFb, boxWait, GONE, stored } from "../harness.mjs";

const LEAK = "EAAPageSECRET" + "q".repeat(50);                   // a Page access token as Graph would hand it out by default
const ids = { nova: "100000000000001", fresh: "100000000000002", backed: "100000000000003", hidden: "100000000000004" };
const PAGES = [
  { id: ids.nova, name: "Nova Travel Blog", category: "Travel Company", followers_count: 12840, fan_count: 12100, is_published: true, verification_status: "blue_verified",
    tasks: ["ADVERTISE", "ANALYZE", "MANAGE"], instagram_business_account: { id: "17841400000000001", username: "nova.travel" }, promotion_eligible: true, business: { id: "555", name: "Nova Media" } },
  { id: ids.fresh, name: "Fresh Page", category: "Public Figure", followers_count: 0, fan_count: 0, is_published: true, verification_status: "not_verified", tasks: ["ADVERTISE", "MANAGE"], promotion_eligible: true },
  { id: ids.backed, name: "Backed Page", category: "Shopping & Retail", followers_count: 3, fan_count: 3, is_published: true, tasks: ["ADVERTISE"], connected_page_backed_instagram_account: { id: "17841400000000009" }, promotion_eligible: true },
  { id: ids.hidden, name: "Hidden Page", category: "Blogger", followers_count: 1, fan_count: 1, is_published: false, tasks: ["ANALYZE", "MODERATE"], promotion_eligible: false, promotion_ineligible_reason: "Page is not published" },
];                                                                // sorted by name: Backed, Fresh, Hidden, Nova
const complaint = (field) => ({ code: 100, message: `(#100) Tried accessing nonexisting field (${field}) on node type (Page)` });
const permission = (code = 10) => ({ code, message: `(#${code}) Application does not have permission for this action` });

// Top-level names of a `fields` value ("a,b{c,d},e" → a, b, e).
const topFields = (fields) => {
  const out = []; let depth = 0, cur = "";
  for (const ch of fields) { if (ch === "{") depth++; if (ch === "}") depth--; if (ch === "," && !depth) { out.push(cur); cur = ""; } else cur += ch; }
  return [...out, cur].map((f) => f.replace(/\{.*$/, ""));
};
// Graph as the tab sees it: only the fields that were asked for come back (id always), a refusal is a 400 with Graph's own words.
//   cfg.rows    the pages        cfg.refuse  [{ when(top, fields) → bool, error }] checked in order   cfg.leak  add an access_token to every row
const mock = (cfg) => (u) => {
  if (!/\/me\/accounts$/.test(u.pathname)) return { body: u.pathname.endsWith("/me/adaccounts") ? accountsJson : { data: [] } };
  const fields = u.searchParams.get("fields") || "", top = topFields(fields);
  for (const r of cfg.refuse || []) if (r.when(top, fields)) return { status: 400, body: { error: r.error } };
  const keep = (row) => ({ ...Object.fromEntries(Object.entries(row).filter(([k]) => k === "id" || k === "name" || top.includes(k))), ...(cfg.leak ? { access_token: LEAK, business: { id: "555", name: "Nova Media", access_token: LEAK } } : {}) });
  return { body: { data: cfg.rows.map(keep) } };
};
const reqs = (b) => b.hits.filter((h) => h.startsWith("/me/accounts"));
const fieldsOf = (h) => new URL(`http://x${h}`).searchParams.get("fields") || "";
const toastOf = (p) => p.evaluate(() => document.querySelector("#toast").textContent.trim());
const names = (p) => p.$$eval(".pg-name", (n) => n.map((x) => x.textContent));
const chips = (p) => p.$$eval(".chip", (n) => n.map((x) => x.textContent.trim()));
const rowOf = (p, name) => p.evaluate((n) => {
  const r = [...document.querySelectorAll(".pg")].find((x) => x.querySelector(".pg-name").textContent === n);
  if (!r) return null;
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  return { meta: clean(r.querySelector(".pg-meta").innerText), why: r.querySelector(".pg-why")?.textContent.trim() || null, id: r.querySelector(".acc-id").textContent.trim(),
    pills: [...r.querySelectorAll(".pill")].map((x) => ({ text: x.textContent.trim(), tone: x.className.replace("pill", "").trim(), title: x.title })),
    links: [...r.querySelectorAll("a")].map((a) => ({ text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel })) };
}, name);
// Waits for the n-th request for pages, then a moment for a stray extra one.
const waitReqs = async (p, b, n) => { for (let i = 0; i < 60 && reqs(b).length < n; i++) await p.waitForTimeout(100); await p.waitForTimeout(200); return reqs(b).length === n; };
const pill = (row, text) => row?.pills.find((x) => x.text === text);
// "Pages" tab reached by a click, like a person does.
const openPages = async (b) => { const pop = await popup(b); await pop.click('[data-tab="pages"]'); return pop; };

// ---------- list, chips, search, copy, language ----------
async function pagesFlow() {
  console.log("\n# pages: automatic load, rows, chips, search, copy, language");
  const b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES }) });
  const methods = [];
  b.ctx.on("request", (r) => { if (r.url().startsWith(GRAPH)) methods.push(r.method()); });
  await adsPage(b);
  let pop = await popup(b);
  ok("token tab open: nothing requested yet", reqs(b).length === 0);
  await pop.click('[data-tab="pages"]');
  ok("first visit: rows appear without pressing refresh", await rowsAre(pop, ".pg", 4));
  ok("…with exactly one request", reqs(b).length === 1, String(reqs(b).length));
  ok("…and no toast for an automatic load", (await toastOf(pop)) === "", await toastOf(pop));
  ok("the popup opens at full height on the Pages tab", await pop.evaluate(() => document.body.classList.contains("tall")));
  const fields = fieldsOf(reqs(b)[0]);
  ok("the request names id, name and every optional field", ["id", "name", "category", "followers_count", "fan_count", "is_published", "verification_status", "tasks",
    "connected_page_backed_instagram_account{id}", "instagram_business_account{id,username}", "connected_instagram_account{id,username}", "promotion_eligible", "promotion_ineligible_reason", "business{id,name}"]
    .every((f) => fields.includes(f)), fields);
  ok("…and never an access token", !/access_token/.test(reqs(b).map((h) => decodeURIComponent(h)).join()), fields);
  ok("every Graph request is a GET", methods.length > 0 && methods.every((m) => m === "GET"), methods.join());
  ok("rows are sorted by name", (await names(pop)).join() === "Backed Page,Fresh Page,Hidden Page,Nova Travel Blog", (await names(pop)).join());
  ok("total: count and age", has(await text(pop, "#pagesTotal"), "4 pages · updated just now"), await text(pop, "#pagesTotal"));
  ok("chips: only problems that exist, with counts", (await chips(pop)).join() === "No Instagram 2,Unpublished 1,Can't advertise 1,No ad rights 1", (await chips(pop)).join());
  ok("short list: the BM reminder under it", has(await text(pop, "#pagesList"), "Pages you manage only through a BM may not be listed"));
  await pop.click('[data-tab="token"]'); await pop.click('[data-tab="pages"]'); await pop.waitForTimeout(500);
  ok("second visit in the same popup: no new request", reqs(b).length === 1, String(reqs(b).length));

  // rows
  const nova = await rowOf(pop, "Nova Travel Blog");
  ok("Nova: category · followers, owner BM, ID", nova.meta === "Travel Company · 12,840 followers Nova Media" && nova.id === ids.nova, JSON.stringify(nova));
  ok("Nova: real Instagram → ok pill with the username; verified", pill(nova, "IG @nova.travel")?.tone === "ok" && pill(nova, "Verified")?.tone === "ok" && nova.pills.length === 2, JSON.stringify(nova.pills));
  ok("Nova: three links, new tab, noopener noreferrer, ids in the URLs", nova.links.length === 3 && nova.links.every((l) => l.target === "_blank" && l.rel === "noopener noreferrer")
    && nova.links[0].href === `https://www.facebook.com/${ids.nova}` && nova.links[1].href === `https://business.facebook.com/latest/home?asset_id=${ids.nova}`
    && nova.links[2].href === "https://business.facebook.com/settings/pages?business_id=555", JSON.stringify(nova.links));
  const backed = await rowOf(pop, "Backed Page");
  ok("Backed: page-backed Instagram → ok pill 'IG: page', the tooltip says what it means", pill(backed, "IG: page")?.tone === "ok" && has(pill(backed, "IG: page").title, "«Use Facebook Page» is set") && has(pill(backed, "IG: page").title, "Instagram placements will run as the page"), JSON.stringify(backed.pills));
  ok("Backed: no BM → no BM link", backed.links.length === 2 && backed.links.every((l) => !l.href.includes("settings/pages")), JSON.stringify(backed.links));
  const fresh = await rowOf(pop, "Fresh Page");
  const none = pill(fresh, "No Instagram");
  ok("Fresh: no Instagram → warn pill, the tooltip tells where to choose «Use Facebook Page»", none?.tone === "warn" && has(none.title, "«Use Facebook Page»") && has(none.title, "Ads Manager → ad → Identity → Instagram account") && has(none.title, "automated launches to Instagram placements fail"), JSON.stringify(fresh.pills));
  ok("Fresh: zero followers is shown as 0", has(fresh.meta, "0 followers"), fresh.meta);
  const hidden = await rowOf(pop, "Hidden Page");
  ok("Hidden: Can't advertise (bad, reason as tooltip), Unpublished, No ad rights, No Instagram — problems before anything else",
    hidden.pills.map((x) => x.text).join() === "Can't advertise,Unpublished,No ad rights,No Instagram" && pill(hidden, "Can't advertise").tone === "bad" && pill(hidden, "Can't advertise").title === "Page is not published"
    && pill(hidden, "Unpublished").tone === "warn" && pill(hidden, "No ad rights").tone === "warn", JSON.stringify(hidden.pills));
  ok("Hidden: the ineligibility reason is also a visible line", hidden.why === "Page is not published", String(hidden.why));
  ok("a page with nothing wrong has no problem pill", !(await rowOf(pop, "Nova Travel Blog")).pills.some((x) => x.tone === "warn" || x.tone === "bad"));

  // chips filter, keyboard
  await pop.focus('[data-focus="pchip:noIg"]'); await pop.keyboard.press("Enter");
  ok("chip (keyboard Enter): only the pages without Instagram", (await names(pop)).join() === "Fresh Page,Hidden Page", (await names(pop)).join());
  ok("…focus stays on the chip after the redraw, aria-pressed", await pop.evaluate(() => document.activeElement?.dataset.focus === "pchip:noIg" && document.activeElement.getAttribute("aria-pressed") === "true"));
  ok("…the total says 2 of 4, the fix is written out above the list", has(await text(pop, "#pagesTotal"), "2 of 4 found") && has(await text(pop, ".pg-note"), "choose «Use Facebook Page» once"), await text(pop, "#pagesTotal"));
  await pop.fill("#pageFilter", "hid");
  ok("chip + search together", (await names(pop)).join() === "Hidden Page", (await names(pop)).join());
  await pop.fill("#pageFilter", "");
  await pop.click('.chip:has-text("No Instagram")');
  ok("chip again: the full list, the note is gone", (await rowsAre(pop, ".pg", 4)) && (await pop.locator(".pg-note").count()) === 0);
  await pop.click('.chip:has-text("Unpublished")');
  ok("Unpublished chip", (await names(pop)).join() === "Hidden Page");
  await pop.click('.chip:has-text("Can\'t advertise")');
  ok("another chip replaces the first (one problem at a time)", (await names(pop)).join() === "Hidden Page" && (await pop.locator(".chip[aria-pressed=true]").count()) === 1);
  await pop.click('.chip:has-text("Can\'t advertise")');

  // search
  await pop.fill("#pageFilter", "NOVA");
  ok("search by name (any case)", (await names(pop)).join() === "Nova Travel Blog", (await names(pop)).join());
  await pop.fill("#pageFilter", ids.backed);
  ok("search by ID", (await names(pop)).join() === "Backed Page", (await names(pop)).join());
  await pop.fill("#pageFilter", "zzz");
  ok("nothing found: says so, Copy IDs is disabled", has(await text(pop, "#pagesList"), "Nothing found") && await pop.locator("#copyPageIds").isDisabled());
  await pop.fill("#pageFilter", "");
  ok("search cleared: all rows, Copy IDs enabled", (await rowsAre(pop, ".pg", 4)) && !(await pop.locator("#copyPageIds").isDisabled()));

  // copy
  await captureClipboard(pop);
  let tst = await clickToast(pop, "#copyPageIds");
  ok("Copy IDs: every visible page, one per line, in list order", (await clip(pop))[0] === [ids.backed, ids.fresh, ids.hidden, ids.nova].join("\n") && has(tst, "Copied IDs: 4"), `${JSON.stringify(await clip(pop))} ${tst}`);
  await pop.click('.chip:has-text("No Instagram")');
  tst = await clickToast(pop, "#copyPageIds");
  ok("…only the filtered ones when a filter is on", (await clip(pop))[1] === [ids.fresh, ids.hidden].join("\n") && has(tst, "Copied IDs: 2"), `${JSON.stringify(await clip(pop))} ${tst}`);
  await pop.click('.chip:has-text("No Instagram")');
  await pop.focus(`[data-focus="pid:${ids.nova}"]`); await pop.keyboard.press("Enter");
  ok("the ID button copies that page's ID (keyboard)", (await clip(pop)).at(-1) === ids.nova, JSON.stringify(await clip(pop)));

  // the minute: the auto-load took the slot
  tst = await clickToast(pop, "#loadPages");
  ok("refresh within a minute: toast with the wait, no request", /Refresh available in \d+ s/.test(tst) && Number(/\d+/.exec(tst)[0]) <= 60 && reqs(b).length === 1, `${tst} / ${reqs(b).length}`);
  ok("…the refresh button is usable again", !(await pop.locator("#loadPages").isDisabled()) && (await pop.locator("#loadPages").getAttribute("aria-busy")) === null);
  await resetLocks(pop); await pop.click("#loadPages");
  ok("refresh after the minute: one more request", await waitReqs(pop, b, 2), String(reqs(b).length));
  ok("…a manual load says how many pages", await until(pop, () => /Pages: 4/.test(document.querySelector("#toast").textContent)), await toastOf(pop));

  // reopen: the cache is shown, nothing is requested
  pop = await popup(b); await pop.waitForTimeout(700);
  ok("reopen: cached rows, no request (a cached list is only refreshed by the button)", (await rowsAre(pop, ".pg", 4)) && reqs(b).length === 2, String(reqs(b).length));
  ok("…on the Pages tab, no toast", (await pop.evaluate(() => document.querySelector(".tab.active").dataset.tab)) === "pages" && (await toastOf(pop)) === "");

  // language: labels, chips (the filter is by key, so it survives), pills, tooltips
  await pop.click('.chip:has-text("No Instagram")');
  await pop.click('[data-lang="ru"]');
  ok("RU: chips", (await chips(pop)).join() === "Нет Instagram 2,Не опубликована 1,Нельзя рекламировать 1,Нет прав на рекламу 1", (await chips(pop)).join());
  ok("RU: the filter stays on (2 rows), placeholder, Copy IDs, refresh", (await rowsAre(pop, ".pg", 2)) && (await pop.getAttribute("#pageFilter", "placeholder")) === "Поиск"
    && (await text(pop, "#copyPageIds")) === "Копировать ID" && (await pop.getAttribute("#loadPages", "title")) === "Обновить" && has(await text(pop, "#pagesTotal"), "найдено 2 из 4"),
    `${await text(pop, "#pagesTotal")} | ${await text(pop, "#copyPageIds")}`);
  ok("RU: the fix note", has(await text(pop, ".pg-note"), "один раз выбери «Use Facebook Page»"), await text(pop, ".pg-note"));
  await pop.click('.chip:has-text("Нет Instagram")');
  const ruNova = await rowOf(pop, "Nova Travel Blog"), ruHidden = await rowOf(pop, "Hidden Page");
  ok("RU: row text and pills", ruNova.meta === "Travel Company · 12 840 подписчиков Nova Media" && pill(ruNova, "Подтверждена") && pill(ruHidden, "Нельзя рекламировать") && pill(ruHidden, "Не опубликована") && pill(ruHidden, "Нет прав на рекламу")
    && has(pill(ruHidden, "Нет Instagram").title, "автозапуски"), `${ruNova.meta} | ${JSON.stringify(ruHidden.pills)}`);
  ok("RU: the BM reminder and the total", has(await text(pop, "#pagesList"), "только через BM") && /^4 страницы · обновлено /.test(await text(pop, "#pagesTotal")), await text(pop, "#pagesTotal"));
  await pop.click('[data-lang="en"]');
  ok("back to English", await until(pop, () => /^4 pages · updated/.test(document.querySelector("#pagesTotal").textContent.trim()) && document.querySelector("#copyPageIds").textContent.trim() === "Copy IDs"));
  ok("no request for any of it", reqs(b).length === 2, String(reqs(b).length));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- optional fields Graph refuses ----------
async function fieldsFlow() {
  console.log("\n# pages: optional fields refused");
  // 1. fields refused one by one: only they are dropped, the same page is asked again; the refusal is remembered
  let b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, refuse: [
    { when: (top) => top.includes("fan_count"), error: complaint("fan_count") },
    { when: (top) => top.includes("tasks"), error: complaint("tasks") }] }) });
  await adsPage(b);
  let pop = await openPages(b);
  ok("two refusals → three requests, the list still loads", (await rowsAre(pop, ".pg", 4)) && reqs(b).length === 3, String(reqs(b).length));
  const [, second, third] = reqs(b).map(fieldsOf);
  ok("each retry drops only the field Graph named", has(second, "tasks") && !has(second, "fan_count") && has(third, "category") && !has(third, "tasks") && !has(third, "fan_count"), `${second} || ${third}`);
  ok("tasks unknown → no 'No ad rights' pill or chip (no verdict)", !(await chips(pop)).some((c) => c.startsWith("No ad rights")) && !pill(await rowOf(pop, "Hidden Page"), "No ad rights"), (await chips(pop)).join());
  ok("what was read is still there (category, followers, Instagram, can't advertise)", has((await rowOf(pop, "Nova Travel Blog")).meta, "12,840 followers") && !!pill(await rowOf(pop, "Hidden Page"), "Can't advertise") && !!pill(await rowOf(pop, "Hidden Page"), "No Instagram"));
  ok("the refusal is stored with each row, not as a guess", JSON.stringify(await stored(pop, "pages")).includes('"_skip":["fan_count","tasks"]'), JSON.stringify(await stored(pop, "pages")).slice(0, 200));
  await resetLocks(pop); await pop.click("#loadPages");
  await waitReqs(pop, b, 4);
  ok("a refresh does not ask for the refused fields again (one request)", reqs(b).length === 4 && !has(fieldsOf(reqs(b)[3]), "tasks"), `${reqs(b).length} ${fieldsOf(reqs(b).at(-1))}`);
  await b.ctx.close();

  // 2. both real-Instagram fields refused: Instagram is UNKNOWN, never 'No Instagram'
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, refuse: [
    { when: (top) => top.includes("instagram_business_account"), error: complaint("instagram_business_account") },
    { when: (top) => top.includes("connected_instagram_account"), error: complaint("connected_instagram_account") }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, ".pg", 4);
  const novaNoIg = await rowOf(pop, "Nova Travel Blog"), freshNoIg = await rowOf(pop, "Fresh Page");
  ok("Instagram refused: a neutral 'IG —' pill with an explanation, not a warning", pill(novaNoIg, "IG —")?.tone === "" && has(pill(novaNoIg, "IG —").title, "did not return the Instagram fields") && !pill(freshNoIg, "No Instagram"), JSON.stringify(novaNoIg.pills));
  ok("…the page-backed account that WAS read still counts", !!pill(await rowOf(pop, "Backed Page"), "IG: page"));
  ok("…and there is no 'No Instagram' chip", !(await chips(pop)).some((c) => c.startsWith("No Instagram")), (await chips(pop)).join());
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();

  // 3. Graph blames a field INSIDE an expression (username): the real-Instagram fields go, the rest stays
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, refuse: [
    { when: (top, f) => f.includes("username"), error: complaint("username") }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, ".pg", 4);
  const last = fieldsOf(reqs(b).at(-1));
  ok("nested complaint: two requests, the second without the real-Instagram fields but with the rest", reqs(b).length === 2 && !has(last, "instagram_business_account") && !has(last, "connected_instagram_account")
    && has(last, "connected_page_backed_instagram_account{id}") && has(last, "tasks") && has(last, "business{id,name}"), reqs(b).map(fieldsOf).join(" || "));
  ok("…Instagram of a page without PBIA is unknown", !!pill(await rowOf(pop, "Nova Travel Blog"), "IG —") && !!pill(await rowOf(pop, "Backed Page"), "IG: page"));
  await b.ctx.close();

  // 4. a 100 that names no field, whatever is asked beyond id and name: business goes first, then Instagram, then the rest
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, refuse: [
    { when: (top) => top.length > 2, error: { code: 100, message: "(#100) Invalid parameter" } }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, ".pg", 4);
  const seq = reqs(b).map(fieldsOf);
  ok("an unnamed 100 → four requests: all, without business, without the Instagram fields, id and name only", (await rowsAre(pop, ".pg", 4)) && seq.length === 4
    && has(seq[0], "business{id,name}") && !has(seq[1], "business{") && has(seq[1], "instagram_business_account") && !has(seq[2], "instagram") && has(seq[2], "tasks") && seq[3] === "id,name", seq.join(" || "));
  ok("…no problem chips and an unknown Instagram on every row (nothing was read)", (await chips(pop)).length === 0 && (await pop.locator(".pg .pill").count()) === 4 && (await pop.locator('.pg .pill:has-text("IG —")').count()) === 4, (await chips(pop)).join());
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();

  // 5. only `business` needs a permission the token lacks (business_management): everything else survives
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, refuse: [{ when: (top) => top.includes("business"), error: permission(200) }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, ".pg", 4);
  const seq5 = reqs(b).map(fieldsOf);
  ok("business refused with a permission error → two requests, the second without business only", (await rowsAre(pop, ".pg", 4)) && seq5.length === 2 && !has(seq5[1], "business{") && has(seq5[1], "instagram_business_account") && has(seq5[1], "tasks"), seq5.join(" || "));
  const novaKept = await rowOf(pop, "Nova Travel Blog");
  ok("…Instagram, followers and ad rights are all there, only the owner BM is missing", !!pill(novaKept, "IG @nova.travel") && has(novaKept.meta, "12,840 followers") && !has(novaKept.meta, "Nova Media") && novaKept.links.length === 2
    && (await chips(pop)).join() === "No Instagram 2,Unpublished 1,Can't advertise 1,No ad rights 1", `${novaKept.meta} | ${(await chips(pop)).join()}`);
  await b.ctx.close();

  // 6. the Instagram fields need a permission the token lacks: business is tried first, then the Instagram trio goes
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, refuse: [{ when: (top) => top.some((f) => f.includes("instagram")), error: permission(10) }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, ".pg", 4);
  const seq6 = reqs(b).map(fieldsOf);
  ok("Instagram fields refused with a permission error → three requests, the list keeps everything else", (await rowsAre(pop, ".pg", 4)) && seq6.length === 3 && !has(seq6[2], "instagram") && has(seq6[2], "tasks") && has(seq6[2], "promotion_eligible"), seq6.join(" || "));
  ok("…Instagram is unknown on every row, nothing is called 'No Instagram'", (await pop.locator('.pg .pill:has-text("IG —")').count()) === 4 && !(await chips(pop)).some((c) => c.startsWith("No Instagram")), (await chips(pop)).join());
  await b.ctx.close();
}

// ---------- errors: permission, other, dead session, API pause ----------
async function errorsFlow() {
  console.log("\n# pages: permission errors, other errors, dead session, API pause");
  const calm = (p) => p.evaluate(() => ({ list: document.querySelector("#pagesList").textContent.trim(), rows: document.querySelectorAll(".pg").length, errToast: document.querySelector("#toast").classList.contains("err") && document.querySelector("#toast").classList.contains("show"),
    busy: document.querySelector("#loadPages").getAttribute("aria-busy"), disabled: document.querySelector("#loadPages").disabled }));
  // 1–3. the token cannot read pages at all: a calm line, not a crash, not a red toast
  for (const [label, error] of [["code 10", permission(10)], ["code 200", permission(200)], ["code 283", permission(283)], ["code 100 that names no field", { code: 100, message: "(#100) Unsupported get request. Object with ID 'me' does not exist, cannot be loaded due to missing permissions" }]]) {
    const b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, refuse: [{ when: () => true, error }] }) });
    await adsPage(b);
    const pop = await openPages(b);
    await until(pop, () => /can't read pages/.test(document.querySelector("#pagesList").textContent));
    const s = await calm(pop);
    ok(`${label}: a calm message in the list, no rows, no red toast`, has(s.list, "This token can't read pages — open Business Manager and refresh the token") && s.rows === 0 && !s.errToast, JSON.stringify(s));
    ok(`${label}: four requests (all fields, without business, without Instagram, id and name), the button is free again`, reqs(b).length === 4 && !has(fieldsOf(reqs(b)[1]), "business{") && fieldsOf(reqs(b)[3]) === "id,name" && s.busy === null && !s.disabled, reqs(b).map(fieldsOf).join(" || "));
    ok(`${label}: nothing is cached`, (await stored(pop, "pages")) === undefined && (await stored(pop, "pagesAt")) === undefined);
    await resetLocks(pop); await pop.click("#loadPages");
    await waitReqs(pop, b, 5);
    ok(`${label}: the next try is one request (the optional fields are given up for this token)`, reqs(b).length === 5 && fieldsOf(reqs(b)[4]) === "id,name", String(reqs(b).length));
    ok(`${label}: no console errors`, b.errs.length === 0, b.errs.join(" | "));
    if (label === "code 10") {
      // the message is in both languages and goes away when a later load works
      await pop.click('[data-lang="ru"]');
      ok("RU: the same calm message", has(await text(pop, "#pagesList"), "Этим токеном страницы не прочитать — открой Business Manager и обнови токен"), await text(pop, "#pagesList"));
      await pop.click('[data-lang="en"]');
      b.graph = mock({ rows: PAGES });
      await resetLocks(pop); await pop.click("#loadPages");
      ok("a later load that works replaces the message with the rows", await rowsAre(pop, ".pg", 4) && !has(await text(pop, "#pagesList"), "can't read pages"));
    }
    await b.ctx.close();
  }
  // 4. only the optional fields are the problem: the list still comes (from id and name), Instagram is unknown, no message
  let b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, refuse: [{ when: (top) => top.length > 2, error: permission(10) }] }) });
  await adsPage(b);
  let pop = await openPages(b);
  ok("a permission error caused by the extra fields: the list loads from id and name, no message", (await rowsAre(pop, ".pg", 4)) && !has(await text(pop, "#pagesList"), "can't read pages") && reqs(b).length === 4, String(reqs(b).length));
  await b.ctx.close();

  // 5. any other error: a red toast, the list says it is not loaded, no retry by going back to the tab
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, refuse: [{ when: () => true, error: { code: 1, message: "boom" } }] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("other error: shown once", await until(pop, () => /boom/.test(document.querySelector("#toast").textContent)) && reqs(b).length === 1, await toastOf(pop));
  ok("…the list tells you to press refresh, not a calm permission text", has(await text(pop, "#pagesList"), "press the refresh button above"), await text(pop, "#pagesList"));
  await pop.click('[data-tab="token"]'); await resetLocks(pop); await pop.click('[data-tab="pages"]'); await pop.waitForTimeout(700);
  ok("…and not retried by going back to the tab", reqs(b).length === 1, String(reqs(b).length));
  await b.ctx.close();

  // 6. dead session: reported, remembered, nothing more is sent
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, refuse: [{ when: () => true, error: { code: 190, error_subcode: 463, message: "Error validating access token: Session has expired" } }] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("dead session (190/463): the toast names the code, one request", await until(pop, () => /190\/463/.test(document.querySelector("#toast").textContent)) && reqs(b).length === 1, await toastOf(pop));
  await resetLocks(pop);
  const again = await clickToast(pop, "#loadPages");
  ok("a click on refresh: the session message, no request", has(again, "no longer valid") && reqs(b).length === 1, `${again} / ${reqs(b).length}`);
  pop = await popup(b); await pop.waitForTimeout(800);
  ok("popup reopened: still no request", reqs(b).length === 1, String(reqs(b).length));
  await b.ctx.close();

  // 7. API pause: no automatic request; a click says so and does not burn the one-minute slot
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES }) });
  await adsPage(b);
  pop = await popup(b);
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 10 * 60000 }));
  await pop.reload(); await pop.waitForTimeout(500);
  await pop.click('[data-tab="pages"]'); await pop.waitForTimeout(800);
  ok("API pause: no automatic request, the list explains itself", reqs(b).length === 0 && has(await text(pop, "#pagesList"), "press the refresh button above"), String(reqs(b).length));
  const paused = await clickToast(pop, "#loadPages");
  ok("API pause: a click says so and sends nothing", has(paused, "hands off") && reqs(b).length === 0, `${paused} / ${reqs(b).length}`);
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: 0 }));
  await pop.waitForTimeout(300); await pop.click("#loadPages");
  ok("…the pause is over: the next click loads at once (the slot was not used up)", await rowsAre(pop, ".pg", 4) && reqs(b).length === 1, String(reqs(b).length));
  await b.ctx.close();

  // 8. no token anywhere: nothing sent, the empty state says what to do
  b = await boot({ fb: () => "<p>feed</p>", graph: mock({ rows: PAGES }) });
  await (await b.ctx.newPage()).goto("https://www.facebook.com/");
  pop = await popup(b, "pages"); await pop.waitForTimeout(700);
  ok("no token: no request, the list tells you which button to press, no toast", reqs(b).length === 0 && has(await text(pop, "#pagesList"), "press the refresh button above") && (await toastOf(pop)) === "", await text(pop, "#pagesList"));
  await b.ctx.close();

  // 9. a slow load says "Loading", a click meanwhile does nothing
  b = await boot({ fb: adsFb(TOK), graph: (u) => ({ delay: 1200, ...mock({ rows: PAGES })(u) }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("while loading the list says so", await until(pop, () => /Loading pages/.test(document.querySelector("#pagesList").textContent)), await text(pop, "#pagesList"));
  await pop.click("#loadPages", { force: true }).catch(() => {});
  await pop.waitForTimeout(300);
  ok("a click during the load neither complains nor doubles the request", !has(await toastOf(pop), "Refresh available") && reqs(b).length === 1, `${await toastOf(pop)} / ${reqs(b).length}`);
  ok("…then the rows", await rowsAre(pop, ".pg", 4));
  await b.ctx.close();

  // 10. a page that Graph returns oddly: no console error, rows without an id are not pages
  b = await boot({ fb: adsFb(TOK), graph: () => ({ body: { data: [{ id: "100000000000009", name: "<img src=x onerror=alert(1)>" }, { name: "no id" }, null, { id: "12ab", name: "bad id" }, { id: "100000000000009", name: "dup" }] } }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("odd rows: one page survives, shown as text (no markup), no console errors", (await rowsAre(pop, ".pg", 1)) && (await pop.locator(".pg img").count()) === 0 && (await text(pop, ".pg-name")) === "<img src=x onerror=alert(1)>" && b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();

  // 11. an empty profile
  b = await boot({ fb: adsFb(TOK), graph: () => ({ body: { data: [] } }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("no pages: says so and shows the BM reminder", await until(pop, () => /No pages found for this profile/.test(document.querySelector("#pagesList").textContent)) && has(await text(pop, "#pagesList"), "only through a BM"), await text(pop, "#pagesList"));
  ok("…the total reads 0 pages, Copy IDs is disabled", has(await text(pop, "#pagesTotal"), "0 pages") && await pop.locator("#copyPageIds").isDisabled());
  await b.ctx.close();
}

// ---------- a Page access token must never be kept ----------
async function tokenFlow() {
  console.log("\n# pages: no Page access token");
  const methods = [];
  const b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, leak: true }) });
  b.ctx.on("request", (r) => { if (r.url().startsWith(GRAPH)) methods.push(r.method()); });
  await adsPage(b);
  let pop = await openPages(b);
  ok("rows load although Graph sent an access_token with every row", await rowsAre(pop, ".pg", 4));
  const everything = async (p) => p.evaluate(async () => JSON.stringify({ session: await chrome.storage.session.get(null), local: await chrome.storage.local.get(null), ls: { ...localStorage }, dom: document.documentElement.outerHTML }));
  let dump = await everything(pop);
  ok("the Page token is not in chrome.storage.session, chrome.storage.local, localStorage or the DOM", !dump.includes("SECRET") && !dump.includes("access_token"), dump.length > 0 ? "found" : "");
  const saved = await stored(pop, "pages");
  ok("stored rows hold whitelisted keys only", saved.length === 4 && saved.every((r) => Object.keys(r).every((k) => ["id", "name", "category", "followers_count", "fan_count", "is_published", "verification_status", "tasks", "connected_page_backed_instagram_account", "instagram_business_account", "connected_instagram_account", "promotion_eligible", "promotion_ineligible_reason", "business", "_skip"].includes(k))), JSON.stringify(saved[0]));
  ok("…the legitimate nested fields beside it are kept (owner BM)", has(await text(pop, "#pagesList"), "Nova Media"));
  pop = await popup(b); await pop.waitForTimeout(500);
  dump = await everything(pop);
  ok("after a reopen (rows from the cache): still nowhere", (await rowsAre(pop, ".pg", 4)) && !dump.includes("SECRET"));
  ok("every request for pages is a GET and none names access_token", reqs(b).length >= 1 && reqs(b).every((h) => !/access_token/.test(decodeURIComponent(h))) && methods.length > 0 && methods.every((m) => m === "GET"), `${methods.join()} | ${reqs(b).join(" ")}`);
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- cache per FB user, other windows, the slot ----------
async function cacheFlow() {
  console.log("\n# pages: cache per FB user, other windows, own rate slot");
  const cfg = { rows: PAGES };
  const b = await boot({ fb: adsFb(TOK), graph: mock(cfg) });
  const fb = await adsPage(b);
  let pop = await openPages(b);
  ok("pages loaded", await rowsAre(pop, ".pg", 4));
  ok("the cache is in storage.session next to the owner", (await stored(pop, "pages")).length === 4 && !!(await stored(pop, "pagesAt")) && (await stored(pop, "pagesTruncated")) === false && (await stored(pop, "owner")) === "1001");
  pop = await popup(b);
  ok("reopen keeps the rows", await rowsAre(pop, ".pg", 4));
  await fb.close(); pop = await popup(b);
  ok("no FB tab: the token is gone", await boxWait(pop, GONE), await text(pop, "#tokenBox"));
  ok("no FB tab: the cache stays", await rowsAre(pop, ".pg", 4));
  const before = reqs(b).length;
  await resetLocks(pop); await clickToast(pop, "#loadPages");
  ok("refresh without a token sends nothing", reqs(b).length === before);
  await b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }]);
  pop = await popup(b);
  ok("another FB user → the cache is dropped, no rows", (await rowsAre(pop, ".pg", 0)) && (await until(pop, () => chrome.storage.session.get("pages").then((o) => !o.pages))));
  ok("…and the list is empty, not someone else's pages", has(await text(pop, "#pagesList"), "Pages not loaded") || has(await text(pop, "#pagesList"), "Loading pages"), await text(pop, "#pagesList"));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();

  // another window of the extension: its load shows up here without doing anything
  const rows = PAGES.slice(0, 3).map((r) => ({ ...r }));
  const b2 = await boot({ fb: adsFb(TOK), graph: mock({ rows }) });
  await adsPage(b2);
  const one = await openPages(b2);
  ok("window 1 loaded 3 pages", await rowsAre(one, ".pg", 3));
  rows.push({ ...PAGES[3] });
  const two = await popup(b2);
  ok("window 2 opens on the cached list, no request", (await rowsAre(two, ".pg", 3)) && reqs(b2).length === 1);
  await resetLocks(two); await two.click("#loadPages");
  ok("window 2 refreshes: 4 pages", await rowsAre(two, ".pg", 4));
  ok("window 1 follows by itself", await rowsAre(one, ".pg", 4) && has(await text(one, "#pagesTotal"), "4 pages"), await text(one, "#pagesTotal"));
  ok("…with one request for the refresh", reqs(b2).length === 2, String(reqs(b2).length));
  await b2.ctx.close();

  // the Pages slot is its own: the Ad accounts list in the same minute does not eat it (and vice versa)
  const b3 = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES }) });
  await adsPage(b3);
  const p3 = await popup(b3, "accounts");
  ok("Ad accounts auto-load took its slot", await rowsAre(p3, ".acc", 1));
  await p3.click('[data-tab="pages"]');
  ok("…the Pages auto-load still goes out (own slot)", await rowsAre(p3, ".pg", 4) && reqs(b3).length === 1);
  const slots = (await stored(p3, "locks")).slots;
  ok("both slots are held, under their own keys", !!slots.accounts && !!slots.pages && slots.pages - Date.now() <= 60000, JSON.stringify(slots));
  ok("no console errors", b3.errs.length === 0, b3.errs.join(" | "));
  await b3.ctx.close();
}

export const flows = { pages: pagesFlow, pagesFields: fieldsFlow, pagesErrors: errorsFlow, pagesToken: tokenFlow, pagesCache: cacheFlow };
