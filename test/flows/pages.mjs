// Pages tab: every page the token can see = me/accounts + every business's owned_pages and client_pages (merged by id; the profile's own
// row wins because it carries the tasks; a page seen only through a business is "No access" → "Assign me"). The tab asks one thing: is the
// page alive for advertising and can I use it: Dead (promotion_eligible = false → Appeal), Hidden (unpublished → Publish), No access
// (→ Assign me); Instagram is NOT a problem (the body says it: @handle, runs as the Page, none + Set up, unknown). Automatic first load, the
// one-minute slot that covers the whole refresh (all requests), optional fields Graph refuses (me/accounts AND every business edge, each edge
// with its own skip set), edges and businesses that error (skipped, the rest stays, a muted hint), permission errors, a Page access token that
// must never be kept (me/accounts AND business edges), the chips (Alive · Dead · Hidden · No access), search, the shared row (name only, no
// value on the right; healthy = the ID alone; a problem = the ID · word · one fix · "+N"; lazy body: Reason, Instagram, Business, two links,
// all problems with their fixes only when there are two or more), avatars, no Copy IDs, language, per-user cache, layout. Fictional data.
import { GRAPH, TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, captureClipboard, clip, accountsJson, adsFb, boxWait, GONE, stored, done, PGS, tr, autoDone, idle, settle, trVar, trx, useLang, waitFor, lineTwo } from "../harness.mjs";
import { LINKS } from "../../fb-helper/js/links.js";
import path from "node:path";

const SHOT = process.env.ROWS_SHOT_DIR || "";                    // when set, screenshots of the list (both languages, 560 and 380 px) go there

const LEAK = "EAAPageSECRET" + "q".repeat(50);                   // a Page access token as Graph would hand it out by default
const ids = { nova: "100000000000001", fresh: "100000000000002", backed: "100000000000003", dead: "100000000000004", draft: "100000000000005", orion: "100000000000006",
  harbor: "100000000000007", client: "100000000000008", wing: "100000000000009" };
const PIC = "https://scontent.xx.fbcdn.net/v/t39.30808-1/nova_50.jpg";
const ig = (id, username) => ({ id, username });
// me/accounts: the pages the profile has a role on (with tasks)
const PAGES = [
  { id: ids.nova, name: "Nova Travel Blog", is_published: true, tasks: ["ADVERTISE", "ANALYZE", "MANAGE"], instagram_business_account: ig("17841400000000001", "nova.travel"), promotion_eligible: true,
    business: { id: "555", name: "Nova Media" }, picture: { data: { url: PIC, height: 50, width: 50, is_silhouette: false } } },
  { id: ids.fresh, name: "Fresh Page", is_published: true, tasks: ["ADVERTISE", "MANAGE"], promotion_eligible: true, picture: { data: { url: "https://evil.example.com/tracker.png" } } },
  { id: ids.backed, name: "Backed Page", is_published: true, tasks: ["ADVERTISE"], connected_page_backed_instagram_account: { id: "17841400000000009" }, promotion_eligible: true },
  { id: ids.dead, name: "Dead Page", is_published: false, tasks: ["ANALYZE", "MODERATE"], promotion_eligible: false, promotion_ineligible_reason: "Page is not published",
    picture: { data: { url: "https://scontent.xx.fbcdn.net/v/t39.30808-1/broken_50.jpg" } } },
  { id: ids.draft, name: "Draft Page", is_published: false, tasks: ["ADVERTISE"], instagram_business_account: ig("17841400000000005", "draft.page"), promotion_eligible: true },
  { id: ids.orion, name: "Orion Studio", is_published: true, tasks: ["ADVERTISE"], instagram_business_account: ig("17841400000000006", "orion.studio"), promotion_eligible: false, promotion_ineligible_reason: "This page is restricted from promoting" },
];
const BMS = [{ id: "555", name: "Nova Media" }, { id: "777", name: "Tailspin Toys" }];
// the businesses' edges: no tasks. Nova is listed here too (under another name: the profile's own row must win), Harbor three times (the first, owned, wins)
const EDGES = {
  "555/owned_pages": [
    { id: ids.nova, name: "Nova (business view)", is_published: true, promotion_eligible: true },
    { id: ids.harbor, name: "Harbor Bakery", is_published: true, promotion_eligible: true, instagram_business_account: ig("17841400000000007", "harbor.bakery") }],
  "555/client_pages": [
    { id: ids.client, name: "Client Fashion House", is_published: false, promotion_eligible: true, instagram_business_account: ig("17841400000000008", "client.fashion"), business: { id: "888", name: "Fashion Holding" } },
    { id: ids.harbor, name: "Harbor (client copy)", is_published: true }],
  "777/owned_pages": [{ id: ids.wing, name: "Wingtip Gadgets", is_published: true, promotion_eligible: true }],
  "777/client_pages": [{ id: ids.harbor, name: "Harbor (shared again)", is_published: true }],
};
const FULL = { rows: PAGES, bms: BMS, edges: EDGES };
// Dead Page: dead + hidden + no access (3 problems, the worst is Dead); Orion: dead; Draft: hidden; Client: hidden + no access; Harbor, Wingtip: no access; Nova, Fresh (no Instagram), Backed: nothing
const ORDER = ["Backed Page", "Fresh Page", "Nova Travel Blog", "Dead Page", "Orion Studio", "Client Fashion House", "Draft Page", "Harbor Bakery", "Wingtip Gadgets"];
//             nothing wrong, by name                    | Dead                      | Hidden                          | No access
const CHIPS = [["pages.chip.alive", 5], ["pages.chip.dead", 2], ["pages.chip.hidden", 3], ["pages.chip.noAccess", 4]];   // Alive = not dead and not hidden (no access may overlap)
const OPT_ALL = ["is_published", "tasks", "connected_page_backed_instagram_account{id}", "instagram_business_account{id,username}", "connected_instagram_account{id,username}",
  "promotion_eligible", "promotion_ineligible_reason", "picture{url}", "business{id,name}"];
const complaint = (field) => ({ code: 100, message: `(#100) Tried accessing nonexisting field (${field}) on node type (Page)` });
const permission = (code = 10) => ({ code, message: `(#${code}) Application does not have permission for this action` });

// Top-level names of a `fields` value ("a,b{c,d},e" → a, b, e).
const topFields = (fields) => {
  const out = []; let depth = 0, cur = "";
  for (const ch of fields) { if (ch === "{") depth++; if (ch === "}") depth--; if (ch === "," && !depth) { out.push(cur); cur = ""; } else cur += ch; }
  return [...out, cur].map((f) => f.replace(/\{.*$/, ""));
};
// Graph as the tab sees it: only the fields that were asked for come back (id always), a refusal is a 400 with Graph's own words.
//   cfg.rows   me/accounts      cfg.bms  me/businesses       cfg.edges  { "<bm>/<edge>": [rows] }
//   cfg.refuse      [{ when(top, fields), error }] on me/accounts, checked in order
//   cfg.bmsError    an error for me/businesses
//   cfg.refuseEdge  [{ when(bm, edge, top, fields), error }] on the business edges
//   cfg.leak        add an access_token to every row (and its business) of every list
//   cfg.accountsNext  me/accounts always has a next page (an endless list: the read stops at its page limit)
const mock = (cfg) => (u) => {
  const fields = u.searchParams.get("fields") || "", top = topFields(fields);
  const keep = (row) => ({ ...Object.fromEntries(Object.entries(row).filter(([k]) => k === "id" || k === "name" || top.includes(k))),
    ...(cfg.leak ? { access_token: LEAK, business: { id: "555", name: "Nova Media", access_token: LEAK } } : {}) });
  if (u.pathname.endsWith("/me/adaccounts")) return { body: accountsJson };
  if (u.pathname.endsWith("/me/businesses")) return cfg.bmsError ? { status: 400, body: { error: cfg.bmsError } } : { body: { data: (cfg.bms || []).map((x) => ({ ...x })), ...(cfg.bmsNext ? { paging: { next: "https://x/next", cursors: { after: "B" } } } : {}) } };
  const edge = /\/(\d+)\/(owned_pages|client_pages)$/.exec(u.pathname);
  if (edge) {
    for (const r of cfg.refuseEdge || []) if (r.when(edge[1], edge[2], top, fields)) return { status: 400, body: { error: r.error } };
    return { body: { data: (cfg.edges?.[`${edge[1]}/${edge[2]}`] || []).map(keep) } };
  }
  if (!/\/me\/accounts$/.test(u.pathname)) return { body: { data: [] } };
  for (const r of cfg.refuse || []) if (r.when(top, fields)) return { status: 400, body: { error: r.error } };
  return { body: { data: cfg.rows.map(keep), ...(cfg.accountsNext ? { paging: { next: "https://x/next", cursors: { after: "A" } } } : {}) } };   // accountsNext: me/accounts never ends
};
const pathOf = (h) => h.split("?")[0];
const reqs = (b) => b.hits.filter((h) => h.startsWith("/me/accounts"));                         // the profile's own list
const edgeReqs = (b) => b.hits.filter((h) => /^\/\d+\/(owned|client)_pages/.test(h));
export const fixtures = { FULL, mock, ids };                  // the golden wording test (golden.mjs) reads the same pages
// "Alive 5,Dead 2": the chips as the tab writes them; "Dead>Appeal,…": a problem word and its one fix.
const chipList = (...p) => p.map(([k, n]) => `${tr(k)} ${n}`).join();
const probList = (...p) => p.map(([w, f]) => `${tr(w)}>${tr(f)}`).join();
const FIXES = { dead: "pages.fix.appeal", hidden: "pages.fix.publish", noAccess: "pages.fix.assign" };
const pageReqs = (b) => b.hits.filter((h) => /^\/me\/accounts|^\/me\/businesses|^\/\d+\/(owned|client)_pages/.test(h));   // everything a refresh sends
const fieldsOf = (h) => new URL(`http://x${h}`).searchParams.get("fields") || "";
const toastOf = (p) => p.evaluate(() => document.querySelector("#toast").textContent.trim());
const names = (p) => p.$$eval(`${PGS} .lrow .lrow-name`, (n) => n.map((x) => x.textContent));
const chips = (p) => p.$$eval(`#pagesChips .chip`, (n) => n.map((x) => x.textContent.trim()));
// A row as the screen shows it, by page id: the name, whatever is at the right of it (nothing, any more), line 2 (status word, the fix, "+N"), the ID.
const rowOf = (p, id) => p.evaluate((pid) => {
  const link = (a) => ({ text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, title: a.title, aria: a.getAttribute("aria-label"), focus: a.dataset.focus, tab: a.tabIndex });
  const r = document.querySelector(`#pagesList .lrow[data-row="${pid}"]`);
  if (!r) return null;
  const q = (s) => r.querySelector(`.lrow-head ${s}`), st = q(".lrow-status"), val = q(".lrow-value"), fix = q(".lrow-fix");
  return { name: q(".lrow-name").textContent, value: val?.textContent.trim() ?? null, valueMuted: !!val?.classList.contains("muted"), valueTitle: val?.title || null,
    status: st ? { text: st.querySelector(".lrow-status-text").textContent, tone: st.className.replace("lrow-status", "").trim(), title: st.title } : null,
    dot: !!q(".lrow-dot"), sr: q(".lrow-sub .sr-only")?.textContent ?? null, ctx: [...r.querySelectorAll(".lrow-head .lrow-ctx")].map((x) => ({ text: x.textContent, title: x.title })),
    fix: fix ? link(fix) : null, fixes: r.querySelectorAll(".lrow-head .lrow-fix").length, more: q(".lrow-more")?.textContent ?? null, id: q(".lrow-idtext")?.textContent ?? null,
    open: q(".lrow-title").getAttribute("aria-expanded") === "true" };
}, id);
// The body of an open row: all the problems with their fixes (only with two or more), key–value pairs, links. `ig` = the Instagram pair's own parts:
// the word "none" in the warning colour and its "Set up" link (null when the pair has neither).
const bodyOf = (p, id) => p.evaluate((pid) => {
  const link = (a) => ({ text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, title: a.title, aria: a.getAttribute("aria-label"), focus: a.dataset.focus, tab: a.tabIndex });
  const b = document.querySelector(`#pagesList .lrow[data-row="${pid}"] .lrow-body`);
  if (!b) return null;
  const none = b.querySelector(".pg-none"), fix = b.querySelector(".lrow-pair a");
  const probe = document.body.appendChild(document.createElement("i")); probe.style.color = "var(--color-warning)"; const warn = getComputedStyle(probe).color; probe.remove();     // the warning colour of the theme
  return { idIn: !!b.querySelector(".lrow-idline, .lrow-id"), todo: !!b.querySelector(".lrow-todo"), todoTitle: b.querySelector(".lrow-todo-title")?.textContent ?? null,
    probs: [...b.querySelectorAll(".pg-prob")].map((x) => ({ key: x.dataset.problem, text: x.querySelector(".pg-prob-text").textContent, tone: x.querySelector(".pg-prob-text").className.replace("pg-prob-text", "").trim(),
      title: x.querySelector(".pg-prob-text").title, fixes: [...x.querySelectorAll("a")].map(link) })),
    kv: [...b.querySelectorAll(".lrow-pair")].map((x) => [x.querySelector("dt").textContent, x.querySelector("dd").textContent]), kvTitles: [...b.querySelectorAll(".lrow-pair dd")].map((x) => x.title),
    ig: none || fix ? { none: none?.textContent ?? null, warn, color: none ? getComputedStyle(none).color : null, link: fix ? { ...link(fix), under: getComputedStyle(fix.querySelector(".act-label")).textDecorationLine, color: getComputedStyle(fix).color } : null } : null,
    links: [...b.querySelectorAll(".lrow-link")].map(link), boxes: b.querySelectorAll(".btn, button.act, .pill").length };
}, id);
const openRow = async (p, id) => { if (!(await rowOf(p, id)).open) await p.click(`${PGS} .lrow[data-row="${id}"] .lrow-title`); await until(p, (pid) => !!document.querySelector(`#pagesList .lrow[data-row="${pid}"] .lrow-body`), id); };
const closeRow = async (p, id) => { if ((await rowOf(p, id)).open) await p.click(`${PGS} .lrow[data-row="${id}"] .lrow-title`); };
// Waits for the n-th page-list request, then for the refresh to end (nothing more is on its way): true when exactly n went out.
const waitReqs = async (p, b, n, get = reqs) => { await waitFor(() => get(b).length >= n, 6000); await idle(p, "#tab-pages"); return get(b).length === n; };
// "Pages" tab reached by a click, like a person does.
const openPages = async (b) => { const pop = await popup(b); await pop.click('[data-tab="pages"]'); return pop; };
const everything = (p) => p.evaluate(async () => JSON.stringify({ session: await chrome.storage.session.get(null), local: await chrome.storage.local.get(null), ls: { ...localStorage }, dom: document.documentElement.outerHTML }));

// ---------- list, chips, search, language ----------
async function pagesFlow() {
  console.log("\n# pages: automatic load (profile + businesses), rows, chips, search, language");
  const b = await boot({ fb: adsFb(TOK), graph: mock(FULL) });
  const methods = [];
  b.ctx.on("request", (r) => { if (r.url().startsWith(GRAPH)) methods.push(r.method()); });
  await adsPage(b);
  let pop = await popup(b);
  ok("token tab open: nothing requested yet", pageReqs(b).length === 0);
  await pop.click('[data-tab="pages"]');
  ok("first visit: a row for every page of the profile and of its businesses, without pressing refresh", await rowsAre(pop, `${PGS} .lrow`, 9));
  await idle(pop, "#tab-pages");
  ok("…six requests: the profile's pages, the businesses, the owned edges of both businesses, then the client edges", pageReqs(b).map(pathOf).join() === ["/me/accounts", "/me/businesses", "/555/owned_pages", "/777/owned_pages", "/555/client_pages", "/777/client_pages"].join(), pageReqs(b).map(pathOf).join());
  ok("…and no toast for an automatic load", (await toastOf(pop)) === "", await toastOf(pop));
  ok("the popup is as tall as its content on the Pages tab (no fixed height)", await pop.evaluate(() => getComputedStyle(document.body).minHeight === "0px"));
  const mine = fieldsOf(reqs(b)[0]), edge = fieldsOf(edgeReqs(b)[0]);
  ok("me/accounts names id, name and every optional field (with tasks)", ["id", "name", ...OPT_ALL].every((f) => mine.includes(f)), mine);
  ok("every business edge names the same fields without tasks", ["id", "name", ...OPT_ALL.filter((f) => f !== "tasks")].every((f) => edge.includes(f)) && !has(edge, "tasks") && edgeReqs(b).length === 4 && edgeReqs(b).every((h) => !has(fieldsOf(h), "tasks") && fieldsOf(h) === edge), edgeReqs(b).map(fieldsOf).join(" || "));
  ok("me/businesses asks for id and name only", fieldsOf(b.hits.find((h) => h.startsWith("/me/businesses"))) === "id,name");
  ok("no followers, likes, category or verification are asked for", !/category|followers_count|fan_count|verification_status/.test(pageReqs(b).map(fieldsOf).join()));
  ok("…and never an access token, in any request of the refresh (profile list, businesses, edges)", pageReqs(b).length === 6 && !/access_token/.test(pageReqs(b).map((h) => decodeURIComponent(h)).join()));
  ok("every Graph request is a GET", methods.length > 0 && methods.every((m) => m === "GET"), methods.join());
  ok("sorted: pages with nothing wrong first (by name), then by the worst problem (Dead, Hidden, No access), each by name", (await names(pop)).join() === ORDER.join(), (await names(pop)).join());
  ok("merged by id: the profile's own row wins (Nova keeps its name), a page in three business edges is one row (the owned one)", (await names(pop)).filter((n) => /Nova|Harbor/.test(n)).join() === "Nova Travel Blog,Harbor Bakery");
  ok("the count line is empty (and hidden) while nothing is filtered", (await text(pop, "#pagesTotal")) === "" && !(await pop.locator("#pagesTotal").isVisible()), await text(pop, "#pagesTotal"));
  ok("no 'pages only via business' hint: every business was read", (await pop.locator(`${PGS} .pg-foot`).count()) === 0);
  ok("chips: Alive · Dead · Hidden · No access, each with its count (Alive = not dead and not hidden; a page can be in two)", (await chips(pop)).join() === chipList(...CHIPS) && (await chips(pop)).join() === "Alive 5,Dead 2,Hidden 3,No access 4", (await chips(pop)).join());
  ok("…the alive chip is green when pressed, the others are red and amber (their tones), and no chip says Instagram", await pop.locator("#pagesChips .chip").evaluateAll((n) => n.map((x) => [...x.classList].filter((c) => ["ok", "bad", "warn"].includes(c)).join()).join() === "ok,bad,warn,warn" && !/instagram/i.test(n.map((x) => x.textContent).join())));
  ok("controls: search and refresh only — no Copy IDs", (await pop.locator("#pagesCard .search button").count()) === 1 && (await pop.locator("#pagesCard button:not(.chip)").count()) === 1 && !has(await text(pop, "#tab-pages"), tr("liveIds")) && (await pop.locator("#pagesCard input").count()) === 1);
  const tip = await pop.getAttribute("#loadPages", "title");
  ok("'updated X ago' lives in the refresh button's tooltip", /^Refresh · updated just now$/.test(tip), tip);
  await pop.click('[data-tab="token"]'); await pop.click('[data-tab="pages"]'); await settle(pop); await idle(pop, "#tab-pages");
  ok("second visit in the same popup: no new request", pageReqs(b).length === 6, String(pageReqs(b).length));

  // rows: alive = silent (the ID alone), a problem = its word + ONE fix (+N); nothing at the right of the name, no handle, no identity on line 2
  const nova = await rowOf(pop, ids.nova);
  ok("Nova (alive, real Instagram): silent — no status word, no dot, no fix, no '+N'; a screen-reader 'Alive'; NOTHING at the right of the name (no @handle) and nothing on line 2 but the ID",
    nova.status === null && !nova.dot && nova.fix === null && nova.more === null && nova.sr === tr("pages.alive") && nova.value === null && nova.ctx.length === 0 && nova.id === ids.nova, JSON.stringify(nova));
  ok("…the handle is not on the row at all (it is in the body)", !has(await pop.locator(`${PGS} .lrow[data-row="${ids.nova}"] .lrow-head`).innerText(), "@nova.travel") && (await pop.locator(`${PGS} .lrow .lrow-value`).count()) === 0);
  const backed = await rowOf(pop, ids.backed);
  ok("Backed (“Use Facebook Page” set): silent like any alive page — no 'IG via page' on line 2 any more", backed.status === null && backed.fix === null && backed.value === null && backed.ctx.length === 0 && backed.sr === tr("pages.alive"), JSON.stringify(backed));
  const fresh = await rowOf(pop, ids.fresh);
  ok("Fresh (no Instagram at all): NOT a problem — silent, no word, no fix, no '+N', no chip of its own", fresh.status === null && fresh.fix === null && fresh.more === null && fresh.value === null && fresh.sr === tr("pages.alive"), JSON.stringify(fresh));
  const dead = await rowOf(pop, ids.dead);
  ok("Dead Page (not promotable, unpublished, tasks without ADVERTISE): the WORST problem only — 'Dead' in red, its ONE fix 'Appeal' → Account Quality (explanation as tooltip), '+2 more'; Graph's reason is the word's tooltip",
    dead.status?.text === tr("pages.p.dead") && dead.status.tone === "bad" && dead.status.title === "Page is not published" && dead.fixes === 1 && dead.fix.text === tr("pages.fix.appeal") && dead.fix.href === LINKS.accountQuality() && dead.fix.target === "_blank"
    && dead.fix.rel === "noopener noreferrer" && dead.fix.title === tr("pages.fix.appealTitle") && dead.more === tr("row.more", { n: 2 }) && dead.value === null, JSON.stringify(dead));
  const drawn = {}; for (const k of ["nova", "backed", "fresh", "dead"]) drawn[k] = await lineTwo(pop, `${PGS} .lrow[data-row="${ids[k]}"]`);
  ok("line 2 as it is drawn: an alive row is the ID alone (no dangling '·'); a problem row is 'ID · word · fix', with '+N' after the fix",
    drawn.nova === ids.nova && drawn.backed === ids.backed && drawn.fresh === ids.fresh && drawn.dead === `${ids.dead} · ${tr("pages.p.dead")} · ${tr("pages.fix.appeal")}${tr("row.more", { n: 2 })}`, JSON.stringify(drawn));
  const orion = await rowOf(pop, ids.orion);
  ok("Orion (dead, Graph gave a reason): 'Dead' in red, the reason is the tooltip (never a line of its own), 'Appeal' → Account Quality, no '+N', nothing at the right of the name",
    orion.status?.text === tr("pages.p.dead") && orion.status.tone === "bad" && orion.status.title === "This page is restricted from promoting" && orion.fix.text === tr("pages.fix.appeal") && orion.fix.href === LINKS.accountQuality() && orion.more === null && orion.value === null, JSON.stringify(orion));
  const draft = await rowOf(pop, ids.draft);
  ok("Draft (unpublished): 'Hidden' (amber) → 'Publish' → the page in Business Suite; the tooltip says why; no '+N'", draft.status?.text === tr("pages.p.hidden") && draft.status.tone === "warn" && draft.status.title === tr("pages.hiddenTitle")
    && draft.fix.text === tr("pages.fix.publish") && draft.fix.href === LINKS.pageSuite(ids.draft) && draft.more === null && draft.value === null, JSON.stringify(draft));
  const harbor = await rowOf(pop, ids.harbor), client = await rowOf(pop, ids.client), wing = await rowOf(pop, ids.wing);
  ok("Harbor (owned by business 555, not in me/accounts): 'No access' → 'Assign me' → the Pages settings of THAT business; no '+N'; nothing at the right of the name (its Instagram handle is in the body only)",
    harbor.status?.text === tr("pages.p.noAccess") && harbor.status.tone === "warn" && harbor.fix.text === tr("pages.fix.assign") && harbor.fix.href === LINKS.bmPages("555") && harbor.more === null && harbor.value === null && harbor.status.title === tr("pages.noAccessViaTitle"), JSON.stringify(harbor));
  ok("Client (shared with business 555 by another business, unpublished): the worst is 'Hidden' → 'Publish' → Business Suite, '+1 more' (No access)",
    client.status?.text === tr("pages.p.hidden") && client.fix.text === tr("pages.fix.publish") && client.fix.href === LINKS.pageSuite(ids.client) && client.more === tr("row.more", { n: 1 }), JSON.stringify(client));
  ok("Wingtip (owned by business 777, no Instagram): 'No access' → business 777's Pages settings; NO '+N' (no Instagram is not a problem)", wing.status?.text === tr("pages.p.noAccess") && wing.fix.href === LINKS.bmPages("777") && wing.more === null, JSON.stringify(wing));
  ok("exactly one fix link on every collapsed row that has a problem (6), none on the alive ones (Nova, Fresh, Backed)", (await pop.locator(`${PGS} .lrow .lrow-head .lrow-fix`).count()) === 6
    && (await pop.locator([ids.nova, ids.fresh, ids.backed].map((id) => `${PGS} .lrow[data-row="${id}"] .lrow-fix`).join(", ")).count()) === 0);
  ok("no pill-shaped or boxed action anywhere in a row (fix links are plain underlined text, in the tone of the word)", (await pop.locator(`${PGS} .lrow .pill, ${PGS} .lrow .btn`).count()) === 0
    && (await pop.locator(`${PGS} .lrow .lrow-fix`).evaluateAll((a) => a.every((x) => getComputedStyle(x).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(x.querySelector(".act-label")).textDecorationLine === "underline" && !x.querySelector(".i")))));
  ok("every fix names its page for a screen reader, and has a keyboard key", await pop.locator(`${PGS} .lrow .lrow-fix`).evaluateAll((a) => a.every((x) => x.getAttribute("aria-label") === `${x.textContent.trim()} · ${x.closest(".lrow").querySelector(".lrow-name").textContent}` && /^rowfix:\d+$/.test(x.dataset.focus))));

  // the body: built when a row opens; Reason (a dead page that has one) · Instagram · Business · two links; "What to do" only with two or more problems
  ok("no body exists while rows are closed", (await pop.locator(`${PGS} .lrow-body`).count()) === 0);
  await openRow(pop, ids.dead);
  const db = await bodyOf(pop, ids.dead);
  ok("Dead Page, opened (three problems): 'What to do' lists EVERY problem (the worst, which is on line 2 too, first), each its word + exactly ONE fix link to the right page",
    db.todo && db.todoTitle === tr("next.title") && db.probs.map((x) => `${x.text}>${x.fixes.map((f) => f.text).join("+")}`).join() === probList(["pages.p.dead", FIXES.dead], ["pages.p.hidden", FIXES.hidden], ["pages.p.noAccess", FIXES.noAccess])
    && db.probs.every((x) => x.fixes.length === 1 && x.fixes[0].target === "_blank" && x.fixes[0].rel === "noopener noreferrer" && x.fixes[0].tab === 0)
    && db.probs.map((x) => x.fixes[0].href).join() === [LINKS.accountQuality(), LINKS.pageSuite(ids.dead), LINKS.pageSuite(ids.dead)].join() && db.probs.map((x) => x.tone).join() === "bad,warn,warn", JSON.stringify(db.probs));
  ok("…Graph's reason is the tooltip of 'Dead'; each fix names its page and has a keyboard key", db.probs[0].title === "Page is not published" && db.probs[1].title === tr("pages.hiddenTitle") && db.probs[2].title === tr("pages.noAccessTitle")
    && db.probs.every((x) => x.fixes[0].aria === `${x.fixes[0].text} · Dead Page` && x.fixes[0].focus === `pfix:${ids.dead}:${x.key}`), JSON.stringify(db.probs.map((x) => x.fixes[0].aria)));
  ok("…key–value, in this order: Reason (Graph's words), Instagram (none, with its Set up link); no Business (unknown), no 'Your access'", db.kv.map((x) => x.join("=")).join("|") === `${tr("pages.kv.reason")}=Page is not published|${tr("pages.kv.ig")}=${tr("pages.ig.none")}${tr("pages.fix.ig")}`, JSON.stringify(db.kv));
  ok("…links: Page, Business Suite only (no Business pages link), new tab, noopener noreferrer, ids in the URLs", db.links.map((l) => l.text).join() === [tr("pages.linkPage"), tr("pages.linkSuite")].join() && db.links.every((l) => l.target === "_blank" && l.rel === "noopener noreferrer")
    && db.links[0].href === `https://www.facebook.com/${ids.dead}` && db.links[1].href === `https://business.facebook.com/latest/home?asset_id=${ids.dead}`, JSON.stringify(db.links));
  ok("…the body has no ID line (the ID is first on line 2 of the row, at every width; its copy button is tabbable once the row is open), no boxes or pills", !db.idIn && db.boxes === 0
    && (await pop.locator(`${PGS} .lrow[data-row="${ids.dead}"] .lrow-head .lrow-id`).evaluate((n) => n.tabIndex)) === 0, JSON.stringify(db));
  for (const k of ["nova", "harbor", "client", "fresh", "backed", "orion"]) await openRow(pop, ids[k]);
  const nb = await bodyOf(pop, ids.nova), hrb = await bodyOf(pop, ids.harbor), cb = await bodyOf(pop, ids.client), fb = await bodyOf(pop, ids.fresh), bb = await bodyOf(pop, ids.backed), ob = await bodyOf(pop, ids.orion);
  const kvs = (b) => b.kv.map((x) => x.join("=")).join("|");
  ok("Nova, opened: no 'What to do'; Instagram '@nova.travel' (tooltip: an account is connected), the owner business; two links", !nb.todo && kvs(nb) === `${tr("pages.kv.ig")}=@nova.travel|${tr("pages.kv.business")}=Nova Media` && nb.kvTitles[0] === tr("pages.igRealTitle") && nb.ig === null
    && nb.links.map((l) => l.text).join() === [tr("pages.linkPage"), tr("pages.linkSuite")].join(), JSON.stringify(nb));
  ok("Backed, opened: Instagram 'runs as the Page', the tooltip explains “Use Facebook Page” was chosen once; no Set up link (nothing to set up)", kvs(bb) === `${tr("pages.kv.ig")}=${tr("pages.ig.pbia")}` && bb.kvTitles[0] === tr("pages.igPbiaTitle") && bb.ig === null && !bb.todo, JSON.stringify(bb));
  ok("Fresh, opened (no Instagram at all): no 'What to do' (it is not a problem); Instagram 'none' in the warning colour, then an underlined 'Set up' → the Ads Manager ads view, tooltip: the existing explanation, named for its page, a keyboard key",
    !fb.todo && kvs(fb) === `${tr("pages.kv.ig")}=${tr("pages.ig.none")}${tr("pages.fix.ig")}` && fb.ig?.none === tr("pages.ig.none") && fb.ig.color === fb.ig.warn && fb.ig.link.text === tr("pages.fix.ig") && fb.ig.link.href === LINKS.adsManagerHome() && fb.ig.link.target === "_blank" && fb.ig.link.rel === "noopener noreferrer"
    && fb.ig.link.title === tr("pages.igNoneTitle") && fb.kvTitles[0] === tr("pages.igNoneTitle") && fb.ig.link.under === "underline" && fb.ig.link.color === fb.ig.warn && fb.ig.link.aria === `${tr("pages.fix.ig")} · Fresh Page` && fb.ig.link.focus === `pfix:${ids.fresh}:ig` && fb.ig.link.tab === 0, JSON.stringify(fb));
  ok("Harbor, opened (via business, ONE problem): no 'What to do' — the fix is already on line 2; Instagram handle; Business = the owner (filled from the owned edge); two links", !hrb.todo && kvs(hrb) === `${tr("pages.kv.ig")}=@harbor.bakery|${tr("pages.kv.business")}=Nova Media` && hrb.links.length === 2, JSON.stringify(hrb));
  ok("Client, opened (two problems): 'What to do' lists both with their fixes (Hidden → Publish, No access → Assign me → the business I see it through); Business = the owner Graph named", cb.todo
    && cb.probs.map((x) => `${x.text}>${x.fixes[0].text}`).join() === probList(["pages.p.hidden", FIXES.hidden], ["pages.p.noAccess", FIXES.noAccess]) && cb.probs[1].fixes[0].href === LINKS.bmPages("555") && cb.probs[1].title === tr("pages.noAccessViaTitle")
    && kvs(cb) === `${tr("pages.kv.ig")}=@client.fashion|${tr("pages.kv.business")}=Fashion Holding`, JSON.stringify(cb));
  ok("Orion, opened (ONE problem, with Graph's reason): no 'What to do'; 'Reason' first, in Graph's words; then Instagram", !ob.todo && kvs(ob) === `${tr("pages.kv.reason")}=This page is restricted from promoting|${tr("pages.kv.ig")}=@orion.studio`, JSON.stringify(ob));
  ok("seven bodies can be open at once", (await pop.locator(`${PGS} .lrow-body`).count()) === 7);
  for (const k of ["nova", "harbor", "client", "fresh", "backed", "orion"]) await closeRow(pop, ids[k]);
  ok("a closed row throws its body away", (await pop.locator(`${PGS} .lrow-body`).count()) === 1);

  // chips filter, keyboard
  await pop.focus('[data-focus="pchip:dead"]'); await pop.keyboard.press("Enter");
  ok("chip (keyboard Enter): only the dead pages", (await names(pop)).join() === "Dead Page,Orion Studio", (await names(pop)).join());
  ok("…focus stays on the chip after the redraw, aria-pressed", await pop.evaluate(() => document.activeElement?.dataset.focus === "pchip:dead" && document.activeElement.getAttribute("aria-pressed") === "true"));
  ok("…an open row stays open through the redraw", (await rowOf(pop, ids.dead)).open && !!(await bodyOf(pop, ids.dead)));
  ok("…the count line appears only now ('2 of 9 found'); no note above the list", await text(pop, "#pagesTotal") === tr("pages.found", { n: 2, all: 9 }) && await pop.locator("#pagesTotal").isVisible() && (await pop.locator(`${PGS} .pg-note`).count()) === 0, await text(pop, "#pagesTotal"));
  await pop.fill("#pageFilter", "orion");
  ok("chip + search together", (await names(pop)).join() === "Orion Studio" && (await text(pop, "#pagesTotal")) === "1 of 9 found", (await names(pop)).join());
  await pop.fill("#pageFilter", "");
  await pop.click(`#pagesChips .chip:has-text("${tr("pages.chip.dead")}")`);
  ok("chip again: the full list, the count line is gone", (await rowsAre(pop, `${PGS} .lrow`, 9)) && !(await pop.locator("#pagesTotal").isVisible()));
  await pop.click(`#pagesChips .chip:has-text("${tr("pages.chip.alive")}")`);
  ok("Alive chip: not dead and not hidden — Nova, Fresh, Backed, and the pages with no access that are otherwise fine (Harbor, Wingtip)", (await names(pop)).join() === "Backed Page,Fresh Page,Nova Travel Blog,Harbor Bakery,Wingtip Gadgets", (await names(pop)).join());
  await pop.click(`#pagesChips .chip:has-text("${tr("pages.chip.noAccess")}")`);
  ok("No access chip: the pages the profile is not assigned to (no ADVERTISE task, or only through a business); another chip replaces the first (one at a time)", (await names(pop)).join() === "Dead Page,Client Fashion House,Harbor Bakery,Wingtip Gadgets"
    && (await pop.locator(`#pagesChips .chip[aria-pressed=true]`).count()) === 1, (await names(pop)).join());
  await pop.click(`#pagesChips .chip:has-text("${tr("pages.chip.hidden")}")`);
  ok("Hidden chip: every unpublished page, not only where it is the worst problem", (await names(pop)).join() === "Dead Page,Client Fashion House,Draft Page", (await names(pop)).join());
  await pop.click(`#pagesChips .chip:has-text("${tr("pages.chip.dead")}")`);
  ok("Dead chip", (await names(pop)).join() === "Dead Page,Orion Studio", (await names(pop)).join());
  await pop.click(`#pagesChips .chip:has-text("${tr("pages.chip.dead")}")`);

  // search
  await pop.fill("#pageFilter", "NOVA");
  ok("search by name (any case) or owner business", (await names(pop)).join() === "Nova Travel Blog,Harbor Bakery", (await names(pop)).join());
  await pop.fill("#pageFilter", "tailspin");
  ok("search by the owner business named by the edge (owned_pages of 777)", (await names(pop)).join() === "Wingtip Gadgets", (await names(pop)).join());
  await pop.fill("#pageFilter", ids.backed);
  ok("search by ID", (await names(pop)).join() === "Backed Page", (await names(pop)).join());
  await pop.fill("#pageFilter", "zzz");
  ok("nothing found: says so", has(await text(pop, "#pagesList"), tr("pages.noMatch")));
  await pop.fill("#pageFilter", "");
  ok("search cleared: all rows", await rowsAre(pop, `${PGS} .lrow`, 9));

  // ID + copy
  await captureClipboard(pop);
  await pop.evaluate(() => { const t = document.querySelector("#toast"); t.textContent = ""; t.classList.remove("show"); });
  await pop.click(`${PGS} .lrow[data-row="${ids.nova}"] .lrow-head .lrow-id`);
  ok("the copy icon copies the page's ID, the row does not toggle, and there is no toast (a live region says it)", (await clip(pop)).at(-1) === ids.nova && !(await rowOf(pop, ids.nova)).open && (await toastOf(pop)) === ""
    && (await until(pop, (s) => document.querySelector('.sr-only[aria-live]')?.textContent === s, tr("acc.idCopied"))));
  await pop.focus(`[data-focus="rowid:${ids.dead}"]`); await pop.keyboard.press("Enter");
  ok("the copy button of an OPEN row's line 2 is a tab stop and copies by keyboard", (await clip(pop)).at(-1) === ids.dead, JSON.stringify(await clip(pop)));
  ok("…and the copy icon of the collapsed row is not a tab stop", await pop.locator(`${PGS} .lrow[data-row="${ids.nova}"] .lrow-head .lrow-id`).evaluate((n) => n.tabIndex === -1));

  // the minute: the auto-load took the slot, which covers the whole refresh
  const before = pageReqs(b).length;
  const tst = await clickToast(pop, "#loadPages");
  ok("refresh within a minute: toast with the wait, NO request of any kind (the one slot covered the profile list, the businesses and every edge)", trx("pages.wait", { n: /\d+/ }).test(tst) && Number(trVar("pages.wait", tst)) <= 60 && pageReqs(b).length === before && before === 6, `${tst} / ${pageReqs(b).length}`);
  const slots = (await stored(pop, "locks")).slots;
  ok("…the slot is held under 'pages', for at most 60 s", !!slots.pages && slots.pages > Date.now() && slots.pages - Date.now() <= 60000, JSON.stringify(slots));
  ok("…the refresh button is usable again", !(await pop.locator("#loadPages").isDisabled()) && (await pop.locator("#loadPages").getAttribute("aria-busy")) === null);
  await resetLocks(pop); await pop.click("#loadPages");
  ok("refresh after the minute: the whole read again (12 requests in all), one slot", await waitReqs(pop, b, 12, pageReqs), String(pageReqs(b).length));
  ok("…a manual load says how many pages", await until(pop, () => /Pages: 9/.test(document.querySelector("#toast").textContent)), await toastOf(pop));
  ok("…an open row is still open after the refresh", (await rowOf(pop, ids.dead)).open);

  // reopen: the cache is shown, nothing is requested
  pop = await popup(b); await rowsAre(pop, `${PGS} .lrow`, 9); await settle(pop); await idle(pop, "#tab-pages");
  ok("reopen: cached rows, no request (a cached list is only refreshed by the button)", (await rowsAre(pop, `${PGS} .lrow`, 9)) && pageReqs(b).length === 12, String(pageReqs(b).length));
  ok("…on the Pages tab, no toast", (await pop.evaluate(() => document.querySelector(".tab.active").dataset.tab)) === "pages" && (await toastOf(pop)) === "");

  // language: chips, words, fixes, kv, tooltips
  await pop.click(`#pagesChips .chip:has-text("${tr("pages.chip.dead")}")`);
  await useLang(pop, "ru");
  ok("RU: chips (Живые · Мёртвые · Скрытые · Без доступа)", (await chips(pop)).join() === chipList(...CHIPS) && (await chips(pop)).join() === "Живые 5,Мёртвые 2,Скрытые 3,Без доступа 4", (await chips(pop)).join());
  ok("RU: the filter stays on (2 rows), placeholder, refresh tooltip, count line", (await rowsAre(pop, `${PGS} .lrow`, 2)) && (await pop.getAttribute("#pageFilter", "placeholder")) === "Поиск"
    && /^Обновить · обновлено /.test(await pop.getAttribute("#loadPages", "title")) && (await text(pop, "#pagesTotal")) === "найдено 2 из 9", `${await text(pop, "#pagesTotal")} | ${await pop.getAttribute("#loadPages", "title")}`);
  await pop.click(`#pagesChips .chip:has-text("${tr("pages.chip.dead")}")`);
  const ruDead = await rowOf(pop, ids.dead), ruOrion = await rowOf(pop, ids.orion), ruDraft = await rowOf(pop, ids.draft), ruHarbor = await rowOf(pop, ids.harbor), ruBacked = await rowOf(pop, ids.backed), ruNova = await rowOf(pop, ids.nova);
  ok("RU: words and fixes: Мёртвая → Апелляция ещё 2 · Скрыта → Опубликовать · Нет доступа → Назначить себя",
    `${ruDead.status.text}>${ruDead.fix.text}${ruDead.more}|${ruOrion.status.text}>${ruOrion.fix.text}|${ruDraft.status.text}>${ruDraft.fix.text}|${ruHarbor.status.text}>${ruHarbor.fix.text}`
      === `${tr("pages.p.dead")}>${tr("pages.fix.appeal")}${tr("row.more", { n: 2 })}|${tr("pages.p.dead")}>${tr("pages.fix.appeal")}|${tr("pages.p.hidden")}>${tr("pages.fix.publish")}|${tr("pages.p.noAccess")}>${tr("pages.fix.assign")}`
    && `${ruDead.status.text}|${ruDraft.status.text}|${ruHarbor.status.text}` === "Мёртвая|Скрыта|Нет доступа" && ruBacked.sr === "Живая" && ruNova.sr === "Живая" && ruNova.value === null, JSON.stringify([ruDead, ruHarbor]));
  await openRow(pop, ids.dead);
  const ruDb = await bodyOf(pop, ids.dead);
  ok("RU: the body of a page with three problems — the title, every problem with its fix, Причина, Instagram (нет + Выбрать), the two links", ruDb.todoTitle === tr("next.title") && ruDb.probs.map((x) => `${x.text}>${x.fixes[0].text}`).join() === probList(["pages.p.dead", FIXES.dead], ["pages.p.hidden", FIXES.hidden], ["pages.p.noAccess", FIXES.noAccess])
    && ruDb.kv.map((x) => x.join("=")).join("|") === `Причина=Page is not published|Instagram=нетВыбрать` && ruDb.ig?.link?.text === "Выбрать" && has(ruDb.ig.link.title, "автозапуски")
    && ruDb.links.map((l) => l.text).join() === [tr("pages.linkPage"), tr("pages.linkSuite")].join(), JSON.stringify(ruDb));
  await openRow(pop, ids.backed); await openRow(pop, ids.nova);
  ok("RU: Instagram of the others — «от имени страницы» (with its tooltip), @handle; Бизнес", (await bodyOf(pop, ids.backed)).kv.map((x) => x.join("=")).join("|") === "Instagram=от имени страницы" && has((await bodyOf(pop, ids.backed)).kvTitles[0], "Один раз выбран")
    && (await bodyOf(pop, ids.nova)).kv.map((x) => x.join("=")).join("|") === "Instagram=@nova.travel|Бизнес=Nova Media");
  await closeRow(pop, ids.backed); await closeRow(pop, ids.nova);
  await useLang(pop, "en");
  ok("back to English", await until(pop, (w) => document.querySelector("#loadPages").title.startsWith(w.refresh) && document.querySelector("#pageFilter").placeholder === w.search, { refresh: `${tr("refresh")} · ${tr("acc.updated", { t: "" })}`, search: tr("search") }));
  ok("no request for any of it", pageReqs(b).length === 12, String(pageReqs(b).length));
  await done(b);
}

// ---------- the business edges: errors are skipped, the rest stays ----------
async function bizFlow() {
  console.log("\n# pages: business edges — failing edges, no businesses, invalid ids, the limit, refused fields, throttle");
  // 1. one edge refused (permission), one with another error: both skipped, every other page is shown, a muted hint says some may be missing
  let b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuseEdge: [
    { when: (bm, edge) => bm === "777" && edge === "owned_pages", error: permission(200) },
    { when: (bm, edge) => bm === "555" && edge === "client_pages", error: { code: 1, message: "An unknown error occurred" } }] }) });
  await adsPage(b);
  let pop = await openPages(b);
  ok("two edges error: every other page is still listed, the pages that were only in those edges are not", (await rowsAre(pop, `${PGS} .lrow`, 7)) && (await names(pop)).join() === ORDER.filter((n) => !/Wingtip|Client/.test(n)).join(), (await names(pop)).join());
  ok("…all six requests were still made (a failing edge does not stop the rest), no red toast", pageReqs(b).length === 6 && !(await pop.evaluate(() => document.querySelector("#toast").classList.contains("err") && document.querySelector("#toast").classList.contains("show"))), String(pageReqs(b).length));
  const hint = await pop.evaluate(() => { const h = document.querySelector("#pagesList .pg-foot"); return h && { text: h.textContent, color: getComputedStyle(h).color, size: getComputedStyle(h).fontSize }; });
  ok("…the muted hint: some businesses couldn't be read, pages only in them may be missing", hint?.text === tr("pages.bmHint") && hint.color === "rgb(96, 103, 112)" && hint.size === "12px", JSON.stringify(hint));
  ok("…the hint survives a reopen (kept with the cache) and is in RU too", await (async () => { pop = await popup(b); await until(pop, () => !!document.querySelector("#pagesList .pg-foot")); await useLang(pop, "ru"); return has(await text(pop, `${PGS} .pg-foot`), tr("pages.bmHint")); })());
  await useLang(pop, "en");
  b.graph = mock(FULL);
  await resetLocks(pop); await pop.click("#loadPages");
  ok("a later refresh where every edge works: all nine pages, the hint is gone", (await rowsAre(pop, `${PGS} .lrow`, 9)) && (await pop.locator(`${PGS} .pg-foot`).count()) === 0);
  await done(b);

  // 2. me/businesses itself cannot be read: only the profile's own pages, no edge is asked for, the hint is shown
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, bmsError: permission(10) }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("businesses unreadable: the profile's own pages only, no edge request, the hint is shown", (await rowsAre(pop, `${PGS} .lrow`, 6)) && edgeReqs(b).length === 0 && pageReqs(b).length === 2 && has(await text(pop, `${PGS} .pg-foot`), tr("pages.bmHint")), pageReqs(b).map(pathOf).join());
  ok("…the chips count only the profile's own verdicts (no page is 'No access' just because a business could not be read)", (await chips(pop)).join() === chipList(["pages.chip.alive", 3], ["pages.chip.dead", 2], ["pages.chip.hidden", 2], ["pages.chip.noAccess", 1]), (await chips(pop)).join());
  await done(b);

  // 3. no businesses: no edge, no hint
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, bms: [] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("no businesses: two requests (profile list, businesses), no edge, no hint", (await rowsAre(pop, `${PGS} .lrow`, 6)) && pageReqs(b).map(pathOf).join() === "/me/accounts,/me/businesses" && (await pop.locator(`${PGS} .pg-foot`).count()) === 0, pageReqs(b).map(pathOf).join());
  await done(b);

  // 4. ids that are not digits are never asked for; a business listed twice is read once; more than 50 businesses: only 50 are read
  const odd = [{ id: "12ab", name: "bad" }, { id: "../x", name: "bad" }, { name: "no id" }, null, { id: "555", name: "Nova Media" }, { id: "555", name: "again" }, { id: "9".repeat(26), name: "too long" }];
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, bms: odd }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("business ids that are not digits are skipped, a duplicate is read once: only /555/owned_pages and /555/client_pages", (await rowsAre(pop, `${PGS} .lrow`, 8)) && edgeReqs(b).map(pathOf).join() === "/555/owned_pages,/555/client_pages", edgeReqs(b).map(pathOf).join());
  await done(b);
  const many = Array.from({ length: 55 }, (_, i) => ({ id: String(3000 + i), name: `B${i}` }));
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, bms: many }) });
  await adsPage(b);
  pop = await openPages(b);
  await until(pop, (s) => document.querySelectorAll("#pagesList .lrow").length === 6 && document.querySelector("#pagesTotal").textContent.includes(s), tr("pages.notAllLine"), 40000);
  ok("55 businesses: only the first 50 are read (100 edge requests), and the list says it is not complete", edgeReqs(b).length === 100 && !edgeReqs(b).some((h) => /^\/30(5\d)\//.test(h)) && (await text(pop, "#pagesTotal")) === tr("pages.notAllLine"), `${edgeReqs(b).length} / ${await text(pop, "#pagesTotal")}`);
  ok("…the slot still covers all 102 requests: a click sends nothing", await (async () => { const n = pageReqs(b).length; await clickToast(pop, "#loadPages"); return n === 102 && pageReqs(b).length === 102; })());
  await done(b);

  // 5. a field refused on an edge: only that edge's read drops it and asks again; the profile's own list is not touched; the rows say what was not read
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuseEdge: [{ when: (bm, edge, top) => top.includes("promotion_ineligible_reason"), error: complaint("promotion_ineligible_reason") }] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("a field refused on the edges: the first edge asks again without it, the list still has nine pages", (await rowsAre(pop, `${PGS} .lrow`, 9)) && edgeReqs(b).length === 5, String(edgeReqs(b).length));
  const eh = edgeReqs(b).map(fieldsOf);
  ok("…the refusal is learned once for the whole walk (one skip set across the edges): the first request had the field, the retry and every later edge did not; the profile's own read is untouched",
    eh.filter((f) => has(f, "promotion_ineligible_reason")).length === 1 && has(eh[0], "promotion_ineligible_reason") && eh.slice(1).every((f) => !has(f, "promotion_ineligible_reason"))
    && has(fieldsOf(reqs(b)[0]), "promotion_ineligible_reason") && reqs(b).length === 1, eh.join(" || "));
  const stk = await stored(pop, "pages");
  ok("…the rows read through the edges record the refusal (_skip), the profile's own rows do not", stk.filter((r) => r._viaBm).every((r) => r._skip?.join() === "promotion_ineligible_reason") && stk.filter((r) => !r._viaBm).every((r) => !r._skip), JSON.stringify(stk.map((r) => [r.name, r._skip])));
  await done(b);

  // 6. an edge whose refusal names none of our fields (a nested one, here): it is skipped, not retried; the other edges and the profile's own list are untouched
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuseEdge: [{ when: (bm, edge, top, f) => bm === "777" && edge === "owned_pages" && f.includes("username"), error: complaint("username") }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, `${PGS} .lrow`, 8);
  ok("a complaint on one edge that readPaged cannot pin on an optional field: that edge is asked once and skipped (4 edge requests), Wingtip is missing, the hint is shown", edgeReqs(b).length === 4 && reqs(b).length === 1 && !(await names(pop)).includes("Wingtip Gadgets")
    && has(await text(pop, `${PGS} .pg-foot`), tr("pages.bmHint")), edgeReqs(b).map(pathOf).join());
  await done(b);

  // 7. rate limit on an edge: the reading stops (nothing more would go out), what was read is shown, the hint says some may be missing
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuseEdge: [{ when: (bm, edge) => bm === "555" && edge === "owned_pages", error: { code: 4, message: "(#4) Application request limit reached" } }] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("throttled on the first edge: the list shows the profile's own pages and the hint; the remaining edges are not asked for", (await rowsAre(pop, `${PGS} .lrow`, 6)) && pageReqs(b).map(pathOf).join() === "/me/accounts,/me/businesses,/555/owned_pages" && has(await text(pop, `${PGS} .pg-foot`), tr("pages.bmHint")), pageReqs(b).map(pathOf).join());
  await done(b);
}

// ---------- optional fields Graph refuses on the profile's own list ----------
async function fieldsFlow() {
  console.log("\n# pages: optional fields refused");
  // 1. fields refused one by one: only they are dropped, the same page is asked again; the refusal is remembered
  let b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [
    { when: (top) => top.includes("promotion_ineligible_reason"), error: complaint("promotion_ineligible_reason") },
    { when: (top) => top.includes("tasks"), error: complaint("tasks") }] }) });
  await adsPage(b);
  let pop = await openPages(b);
  ok("two refusals → three requests for the profile's list, the list still loads (and the businesses are read once)", (await rowsAre(pop, `${PGS} .lrow`, 9)) && reqs(b).length === 3 && edgeReqs(b).length === 4, `${reqs(b).length} / ${edgeReqs(b).length}`);
  const [, second, third] = reqs(b).map(fieldsOf);
  ok("each retry drops only the field Graph named", has(second, "tasks") && !has(second, "promotion_ineligible_reason") && has(third, "is_published") && !has(third, "tasks") && !has(third, "promotion_ineligible_reason"), `${second} || ${third}`);
  ok("tasks unknown → the profile's own pages are no longer 'No access' (no verdict), but the pages seen only through a business still are", (await chips(pop)).join() === chipList(["pages.chip.alive", 5], ["pages.chip.dead", 2], ["pages.chip.hidden", 3], ["pages.chip.noAccess", 3]) && (await rowOf(pop, ids.dead)).status.text === tr("pages.p.dead") && (await rowOf(pop, ids.harbor)).status.text === tr("pages.p.noAccess"), (await chips(pop)).join());
  ok("…the business edges were asked with the refused fields already dropped (they start from what this token cannot read)", edgeReqs(b).every((h) => !has(fieldsOf(h), "promotion_ineligible_reason")), edgeReqs(b).map(fieldsOf).join(" || "));
  await openRow(pop, ids.orion); await openRow(pop, ids.nova);
  ok("what was read is still there (dead, the Instagram handle in the body); the refused reason is not: the word's tooltip is the short explanation and the body has no Reason",
    (await rowOf(pop, ids.orion)).status.text === tr("pages.p.dead") && (await rowOf(pop, ids.orion)).status.title === tr("pages.deadTitle") && (await bodyOf(pop, ids.orion)).kv.map((x) => x[0]).join() === tr("pages.kv.ig")
    && (await bodyOf(pop, ids.nova)).kv[0].join("=") === `${tr("pages.kv.ig")}=@nova.travel`, JSON.stringify(await bodyOf(pop, ids.orion)));
  ok("the refusal is stored with each of the profile's rows, not as a guess", JSON.stringify((await stored(pop, "pages")).find((r) => r.id === ids.nova)).includes('"_skip":["promotion_ineligible_reason","tasks"]'), JSON.stringify((await stored(pop, "pages")).find((r) => r.id === ids.nova)));
  await resetLocks(pop); await pop.click("#loadPages");
  await waitReqs(pop, b, 4);
  ok("a refresh does not ask for the refused fields again (one request for the profile's list)", reqs(b).length === 4 && !has(fieldsOf(reqs(b)[3]), "tasks"), `${reqs(b).length} ${fieldsOf(reqs(b).at(-1))}`);
  await done(b);

  // 2. both real-Instagram fields refused: Instagram is UNKNOWN, never 'No Instagram'
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [
    { when: (top) => top.includes("instagram_business_account"), error: complaint("instagram_business_account") },
    { when: (top) => top.includes("connected_instagram_account"), error: complaint("connected_instagram_account") }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, `${PGS} .lrow`, 9);
  ok("Instagram refused: no row changes (Instagram is no problem), the chips are the same as with every field read", (await rowOf(pop, ids.fresh)).status === null && (await rowOf(pop, ids.nova)).status === null && (await chips(pop)).join() === chipList(...CHIPS), (await chips(pop)).join());
  await openRow(pop, ids.nova); await openRow(pop, ids.fresh); await openRow(pop, ids.backed);
  ok("…the Instagram line says 'unknown' (with the reason as tooltip), and no Set up link: nothing is known", (await bodyOf(pop, ids.nova)).kv[0].join("=") === `${tr("pages.kv.ig")}=${tr("pages.ig.unknown")}` && (await bodyOf(pop, ids.nova)).kvTitles[0] === tr("pages.igUnknownTitle")
    && (await bodyOf(pop, ids.fresh)).kv[0].join("=") === `${tr("pages.kv.ig")}=${tr("pages.ig.unknown")}` && (await bodyOf(pop, ids.fresh)).ig === null);
  ok("…the page-backed account that WAS read still counts: 'runs as the Page'", (await bodyOf(pop, ids.backed)).kv[0].join("=") === `${tr("pages.kv.ig")}=${tr("pages.ig.pbia")}`);
  await done(b);

  // 3. Graph blames a field INSIDE an expression (username): the real-Instagram fields go, the rest stays
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: (top, f) => f.includes("username"), error: complaint("username") }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, `${PGS} .lrow`, 9);
  const last = fieldsOf(reqs(b).at(-1));
  ok("nested complaint: two requests, the second without the real-Instagram fields but with the rest", reqs(b).length === 2 && !has(last, "instagram_business_account") && !has(last, "connected_instagram_account")
    && has(last, "connected_page_backed_instagram_account{id}") && has(last, "tasks") && has(last, "business{id,name}"), reqs(b).map(fieldsOf).join(" || "));
  await openRow(pop, ids.nova); await openRow(pop, ids.backed);
  ok("…Instagram of a page without PBIA is unknown, the page-backed one still counts", (await bodyOf(pop, ids.nova)).kv[0].join("=") === `${tr("pages.kv.ig")}=${tr("pages.ig.unknown")}` && (await bodyOf(pop, ids.backed)).kv[0].join("=") === `${tr("pages.kv.ig")}=${tr("pages.ig.pbia")}`);
  await done(b);

  // 4. a 100 that names no field, whatever is asked beyond id and name: business goes first, then Instagram, then the rest
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: (top) => top.length > 2, error: { code: 100, message: "(#100) Invalid parameter" } }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, `${PGS} .lrow`, 9);
  const seq = reqs(b).map(fieldsOf);
  ok("an unnamed 100 → four requests: all, without business, without the Instagram fields, id and name only", seq.length === 4
    && has(seq[0], "business{id,name}") && !has(seq[1], "business{") && has(seq[1], "instagram_business_account") && !has(seq[2], "instagram") && has(seq[2], "tasks") && seq[3] === "id,name", seq.join(" || "));
  ok("…no profile page has a problem word (nothing was read): only the pages seen through businesses say 'No access'", (await chips(pop)).join() === chipList(["pages.chip.alive", 9], ["pages.chip.noAccess", 3]), (await chips(pop)).join());
  await done(b);

  // 5. only `business` needs a permission the token lacks (business_management): everything else survives
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: (top) => top.includes("business"), error: permission(200) }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, `${PGS} .lrow`, 9);
  const seq5 = reqs(b).map(fieldsOf);
  ok("business refused with a permission error → two requests, the second without business only", seq5.length === 2 && !has(seq5[1], "business{") && has(seq5[1], "instagram_business_account") && has(seq5[1], "tasks"), seq5.join(" || "));
  await openRow(pop, ids.nova);
  ok("…Instagram and ad rights are all there (Nova is alive, silent), only the owner business is missing from the body", (await rowOf(pop, ids.nova)).status === null && (await bodyOf(pop, ids.nova)).kv.map((x) => x.join("=")).join("|") === `${tr("pages.kv.ig")}=@nova.travel`
    && (await bodyOf(pop, ids.nova)).links.map((l) => l.text).join() === [tr("pages.linkPage"), tr("pages.linkSuite")].join(), JSON.stringify(await bodyOf(pop, ids.nova)));
  await done(b);
}

// ---------- errors: permission, other, dead session, API pause ----------
async function errorsFlow() {
  console.log("\n# pages: permission errors, other errors, dead session, API pause");
  const calm = (p) => p.evaluate(() => ({ list: document.querySelector("#pagesList").textContent.trim(), rows: document.querySelectorAll("#pagesList .lrow").length, errToast: document.querySelector("#toast").classList.contains("err") && document.querySelector("#toast").classList.contains("show"),
    busy: document.querySelector("#loadPages").getAttribute("aria-busy"), disabled: document.querySelector("#loadPages").disabled }));
  // 1–3. the token cannot read pages at all: a calm line, not a crash, not a red toast; the businesses are not even asked for
  for (const [label, error] of [["code 10", permission(10)], ["code 200", permission(200)], ["code 283", permission(283)], ["code 100 that names no field", { code: 100, message: "(#100) Unsupported get request. Object with ID 'me' does not exist, cannot be loaded due to missing permissions" }]]) {
    const b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: () => true, error }] }) });
    await adsPage(b);
    const pop = await openPages(b);
    await until(pop, (s) => document.querySelector("#pagesList").textContent.includes(s), tr("list.perm"));
    const s = await calm(pop);
    ok(`${label}: a calm message in the list, no rows, no red toast`, has(s.list, tr("list.perm")) && s.rows === 0 && !s.errToast, JSON.stringify(s));
    ok(`${label}: four requests (all fields, without business, without Instagram, id and name), nothing about businesses, the button is free again`, reqs(b).length === 4 && !has(fieldsOf(reqs(b)[1]), "business{") && fieldsOf(reqs(b)[3]) === "id,name" && pageReqs(b).length === 4 && s.busy === null && !s.disabled, reqs(b).map(fieldsOf).join(" || "));
    ok(`${label}: nothing is cached`, (await stored(pop, "pages")) === undefined && (await stored(pop, "pagesAt")) === undefined);
    await resetLocks(pop); await pop.click("#loadPages");
    await waitReqs(pop, b, 5);
    ok(`${label}: the next try is one request (the optional fields are given up for this token)`, reqs(b).length === 5 && fieldsOf(reqs(b)[4]) === "id,name", String(reqs(b).length));
    ok(`${label}: no console errors`, b.errs.length === 0, b.errs.join(" | "));
    if (label === "code 10") {
      // the message is in both languages and goes away when a later load works
      await useLang(pop, "ru");
      ok("RU: the same calm message", has(await text(pop, "#pagesList"), tr("list.perm")), await text(pop, "#pagesList"));
      await useLang(pop, "en");
      b.graph = mock(FULL);
      await resetLocks(pop); await pop.click("#loadPages");
      ok("a later load that works replaces the message with the rows", await rowsAre(pop, `${PGS} .lrow`, 9) && !has(await text(pop, "#pagesList"), tr("list.perm")));
    }
    await done(b);
  }
  // 4. only the optional fields are the problem: the list still comes (from id and name), Instagram is unknown, no message
  let b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: (top) => top.length > 2, error: permission(10) }] }) });
  await adsPage(b);
  let pop = await openPages(b);
  ok("a permission error caused by the extra fields: the list loads from id and name, no message", (await rowsAre(pop, `${PGS} .lrow`, 9)) && !has(await text(pop, "#pagesList"), tr("list.perm")) && reqs(b).length === 4, String(reqs(b).length));
  await done(b);

  // 5. any other error: a red toast, the list says it is not loaded, no retry by going back to the tab
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: () => true, error: { code: 1, message: "boom" } }] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("other error: shown once", await until(pop, () => /boom/.test(document.querySelector("#toast").textContent)) && reqs(b).length === 1, await toastOf(pop));
  ok("…the list says it could not load, with Graph's words muted under it and a 'Try again' button — not the calm permission text", (await text(pop, "#pagesList .lempty-text")) === tr("list.error") && (await text(pop, "#pagesList .lempty-detail")) === tr("err.graphIs", { m: "boom" })
    && (await text(pop, "#pagesList .lempty .btn")) === tr("list.retry") && !has(await text(pop, "#pagesList"), tr("list.perm")), await text(pop, "#pagesList"));
  await pop.click('[data-tab="token"]'); await resetLocks(pop); await pop.click('[data-tab="pages"]'); await settle(pop); await idle(pop, "#tab-pages");
  ok("…and not retried by going back to the tab", reqs(b).length === 1, String(reqs(b).length));
  await done(b);

  // 6. dead session: reported, remembered, nothing more is sent
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: () => true, error: { code: 190, error_subcode: 463, message: "Error validating access token: Session has expired" } }] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("dead session (190/463): the toast names the code, one request", await until(pop, () => /190\/463/.test(document.querySelector("#toast").textContent)) && reqs(b).length === 1, await toastOf(pop));
  await resetLocks(pop);
  const again = await clickToast(pop, "#loadPages");
  ok("a click on refresh: the session message, no request", trx("err.session").test(again) && reqs(b).length === 1, `${again} / ${reqs(b).length}`);
  pop = await popup(b);
  await until(pop, () => !!document.querySelector('#pagesList .lempty[data-state="dead"]'));
  ok("popup reopened: still no request", reqs(b).length === 1, String(reqs(b).length));
  await done(b);

  // 7. API pause: no automatic request; a click says so and does not burn the one-minute slot
  b = await boot({ fb: adsFb(TOK), graph: mock(FULL) });
  await adsPage(b);
  pop = await popup(b);
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 10 * 60000 }));
  await pop.reload(); await boxWait(pop, /^EAAB/);
  await pop.click('[data-tab="pages"]'); await autoDone(pop, "#pagesList");       // the automatic try has met the pause and stopped
  ok("API pause: no automatic request, the list explains itself", pageReqs(b).length === 0 && (await text(pop, "#pagesList .lempty-text")) === tr("list.idle") && (await text(pop, "#pagesList .lempty .btn")) === tr("list.load"), String(pageReqs(b).length));
  const paused = await clickToast(pop, "#loadPages");
  ok("API pause: a click says so and sends nothing", trx("err.cooldown").test(paused) && pageReqs(b).length === 0, `${paused} / ${pageReqs(b).length}`);
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: 0 }));
  await until(pop, async () => (await import(chrome.runtime.getURL("js/state.js"))).state.cooldownUntil === 0); await pop.click("#loadPages");
  ok("…the pause is over: the next click loads at once (the slot was not used up)", await rowsAre(pop, `${PGS} .lrow`, 9) && reqs(b).length === 1, String(reqs(b).length));
  await done(b);

  // 8. no token anywhere: nothing sent, the empty state says what to do
  b = await boot({ fb: () => "<p>feed</p>", graph: mock(FULL) });
  await (await b.ctx.newPage()).goto("https://www.facebook.com/");
  pop = await popup(b, "pages");
  await until(pop, () => !!document.querySelector('#pagesList .lempty[data-state="notoken"]'));
  ok("no token: no request, the list tells you which button to press, no toast", pageReqs(b).length === 0 && (await text(pop, "#pagesList .lempty-text")) === (await text(pop, "#tokenBox")) && (await text(pop, "#pagesList .lempty .btn")) === tr("list.retry") && (await toastOf(pop)) === "", await text(pop, "#pagesList"));
  await done(b);

  // 9. a slow load says "Loading", a click meanwhile does nothing
  b = await boot({ fb: adsFb(TOK), graph: (u) => ({ delay: 300, ...mock(FULL)(u) }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("while loading the list says so", await until(pop, (s) => document.querySelector("#pagesList").textContent.includes(s), tr("pages.loading")), await text(pop, "#pagesList"));
  await waitFor(() => reqs(b).length >= 1);                            // the request is on its way (the mock holds the answer)
  await pop.click("#loadPages", { force: true }).catch(() => {});
  await settle(pop);
  ok("a click during the load neither complains nor doubles the request", !trx("pages.wait").test(await toastOf(pop)) && reqs(b).length === 1, `${await toastOf(pop)} / ${reqs(b).length}`);
  ok("…then the rows (after all six slow requests)", await until(pop, () => document.querySelectorAll("#pagesList .lrow").length === 9, null, 15000) && pageReqs(b).length === 6, String(pageReqs(b).length));
  await done(b);

  // 10. a page that Graph returns oddly: no console error, rows without an id are not pages
  const oddRows = [{ id: "100000000000009", name: "<img src=x onerror=alert(1)>" }, { name: "no id" }, null, { id: "12ab", name: "bad id" }, { id: "100000000000009", name: "dup" }];
  b = await boot({ fb: adsFb(TOK), graph: (u) => (/\/me\/accounts$/.test(u.pathname) ? { body: { data: oddRows } } : mock({ rows: [] })(u)) });
  await adsPage(b);
  pop = await openPages(b);
  ok("odd rows: one page survives, shown as text (no markup), no console errors", (await rowsAre(pop, `${PGS} .lrow`, 1)) && (await pop.locator(`${PGS} .lrow img`).count()) === 0 && (await text(pop, `${PGS} .lrow .lrow-name`)) === "<img src=x onerror=alert(1)>" && b.errs.length === 0, b.errs.join(" | "));
  await done(b);

  // 11. an empty profile
  b = await boot({ fb: adsFb(TOK), graph: () => ({ body: { data: [] } }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("no pages: says so, no hint (nothing failed), the count line is empty", await until(pop, (s) => document.querySelector("#pagesList").textContent.includes(s), tr("pages.none")) && (await pop.locator(`${PGS} .pg-foot`).count()) === 0 && (await text(pop, "#pagesTotal")) === "", await text(pop, "#pagesList"));
  await done(b);
}

// ---------- a Page access token must never be kept ----------
async function tokenFlow() {
  console.log("\n# pages: no Page access token (profile list AND business edges)");
  const methods = [];
  const b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, leak: true }) });
  b.ctx.on("request", (r) => { if (r.url().startsWith(GRAPH)) methods.push(r.method()); });
  await adsPage(b);
  let pop = await openPages(b);
  ok("rows load although Graph sent an access_token with every row of every list", await rowsAre(pop, `${PGS} .lrow`, 9));
  await openRow(pop, ids.harbor); await openRow(pop, ids.nova);
  let dump = await everything(pop);
  ok("the Page token is not in chrome.storage.session, chrome.storage.local, localStorage or the DOM (rows of me/accounts and of the edges alike, bodies open)", !dump.includes("SECRET") && !dump.includes("access_token"), dump.length > 0 ? "found" : "");
  const saved = await stored(pop, "pages");
  const KEYS = ["id", "name", "is_published", "tasks", "connected_page_backed_instagram_account", "instagram_business_account", "connected_instagram_account", "promotion_eligible", "promotion_ineligible_reason", "picture", "business", "_skip", "_viaBm"];
  ok("stored rows hold whitelisted keys only", saved.length === 9 && saved.every((r) => Object.keys(r).every((k) => KEYS.includes(k))), JSON.stringify(saved[0]));
  ok("…business edge rows carry no tasks and a digits-only _viaBm; the profile's own rows have tasks and no _viaBm", saved.filter((r) => r._viaBm).length === 3 && saved.filter((r) => r._viaBm).every((r) => !r.tasks && /^\d+$/.test(r._viaBm)) && saved.filter((r) => !r._viaBm).length === 6 && saved.filter((r) => !r._viaBm).every((r) => Array.isArray(r.tasks)),
    JSON.stringify(saved.map((r) => [r.name, r._viaBm, !!r.tasks])));
  ok("…the picture is kept as its URL string only, and only the one on fbcdn.net (the evil.example.com one is gone)", saved.filter((r) => r.picture).map((r) => `${r.name}=${r.picture}`).join("|") === `Nova Travel Blog=${PIC}|Dead Page=https://scontent.xx.fbcdn.net/v/t39.30808-1/broken_50.jpg`, JSON.stringify(saved.map((r) => r.picture)));
  ok("…the legitimate nested fields beside it are kept (owner business, in the body)", (await bodyOf(pop, ids.nova)).kv.some((x) => x.join("=") === "Business=Nova Media"));
  pop = await popup(b); await rowsAre(pop, `${PGS} .lrow`, 9); await settle(pop); await idle(pop, "#tab-pages");
  dump = await everything(pop);
  ok("after a reopen (rows from the cache): still nowhere", (await rowsAre(pop, `${PGS} .lrow`, 9)) && !dump.includes("SECRET"));
  ok("every request of the refresh is a GET and none names access_token (me/accounts, me/businesses, the four edges)", pageReqs(b).length === 6 && pageReqs(b).every((h) => !/access_token/.test(decodeURIComponent(h))) && methods.length > 0 && methods.every((m) => m === "GET"), `${methods.join()} | ${pageReqs(b).join(" ")}`);
  await done(b);
}

// ---------- cache per FB user, other windows, the slot ----------
async function cacheFlow() {
  console.log("\n# pages: cache per FB user, other windows, own rate slot");
  const cfg = { ...FULL };
  const b = await boot({ fb: adsFb(TOK), graph: mock(cfg) });
  const fb = await adsPage(b);
  let pop = await openPages(b);
  ok("pages loaded", await rowsAre(pop, `${PGS} .lrow`, 9));
  ok("the cache is in storage.session next to the owner", (await stored(pop, "pages")).length === 9 && !!(await stored(pop, "pagesAt")) && (await stored(pop, "pagesTruncated")) === false && (await stored(pop, "pagesBizFail")) === false && (await stored(pop, "owner")) === "1001");
  pop = await popup(b);
  ok("reopen keeps the rows", await rowsAre(pop, `${PGS} .lrow`, 9));
  await fb.close(); pop = await popup(b);
  ok("no FB tab: the token is gone", await boxWait(pop, GONE), await text(pop, "#tokenBox"));
  ok("no FB tab: the cache stays", await rowsAre(pop, `${PGS} .lrow`, 9));
  const before = pageReqs(b).length;
  await resetLocks(pop); await clickToast(pop, "#loadPages");
  ok("refresh without a token sends nothing", pageReqs(b).length === before);
  await b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }]);
  pop = await popup(b);
  ok("another FB user → the cache is dropped, no rows", (await rowsAre(pop, `${PGS} .lrow`, 0)) && (await until(pop, () => chrome.storage.session.get("pages").then((o) => !o.pages))));
  ok("…and the list is empty, not someone else's pages", (await pop.locator("#pagesList .lrow").count()) === 0 && (await pop.locator("#pagesList .lempty, #pagesList .lsk-list").count()) === 1, await text(pop, "#pagesList"));
  await done(b);

  // another window of the extension: its load shows up here without doing anything
  const rows = PAGES.slice(0, 3).map((r) => ({ ...r }));
  const b2 = await boot({ fb: adsFb(TOK), graph: mock({ rows, bms: [] }) });
  await adsPage(b2);
  const one = await openPages(b2);
  ok("window 1 loaded 3 pages", await rowsAre(one, `${PGS} .lrow`, 3));
  rows.push({ ...PAGES[3] });
  const two = await popup(b2);
  ok("window 2 opens on the cached list, no request", (await rowsAre(two, `${PGS} .lrow`, 3)) && reqs(b2).length === 1);
  await resetLocks(two); await two.click("#loadPages");
  ok("window 2 refreshes: 4 pages", await rowsAre(two, `${PGS} .lrow`, 4));
  ok("window 1 follows by itself", await rowsAre(one, `${PGS} .lrow`, 4));
  ok("…with one request for the profile's list in the refresh", reqs(b2).length === 2, String(reqs(b2).length));
  await done(b2);

  // the Pages slot is its own: the Ad accounts list in the same minute does not eat it (and vice versa)
  const b3 = await boot({ fb: adsFb(TOK), graph: mock(FULL) });
  await adsPage(b3);
  const p3 = await popup(b3, "accounts");
  ok("Ad accounts auto-load took its slot", await rowsAre(p3, "#accountsList .lrow", 1));
  await p3.click('[data-tab="pages"]');
  ok("…the Pages auto-load still goes out (own slot)", await rowsAre(p3, "#pagesList .lrow", 9) && reqs(b3).length === 1);
  const slots = (await stored(p3, "locks")).slots;
  ok("both slots are held, under their own keys", !!slots.accounts && !!slots.pages && slots.pages - Date.now() <= 60000, JSON.stringify(slots));
  await done(b3);
}

// ---------- the row: pictures, fix links, layout ----------
async function rowsFlow() {
  console.log("\n# pages: picture or placeholder, links, keyboard, layout");
  const asked = [];                                                // every request the browser makes, with the Referer it sent
  const b = await boot({ fb: adsFb(TOK), graph: mock(FULL) });
  b.ctx.on("request", (r) => asked.push({ url: r.url(), referer: r.headers().referer }));
  await adsPage(b);
  const pop = await openPages(b);
  ok("rows", await rowsAre(pop, `${PGS} .lrow`, 9));
  const av = (id) => pop.evaluate((pid) => {
    const box = document.querySelector(`#pagesList .lrow[data-row="${pid}"] .lav`), img = box.querySelector("img"), icon = box.querySelector(".i"), cs = getComputedStyle(box);
    return { cls: box.className, ariaHidden: box.getAttribute("aria-hidden"), w: box.offsetWidth, h: box.offsetHeight, radius: cs.borderRadius, color: cs.color, bg: cs.backgroundColor,
      img: img && { src: img.getAttribute("src"), rp: img.getAttribute("referrerpolicy"), loading: img.getAttribute("loading"), decoding: img.getAttribute("decoding"), alt: img.getAttribute("alt"),
        w: img.getAttribute("width"), h: img.getAttribute("height"), natural: img.naturalWidth },
      icon: icon && { cls: icon.className, visible: getComputedStyle(icon).visibility, mask: getComputedStyle(icon).maskImage || getComputedStyle(icon).webkitMaskImage } };
  }, id);
  await until(pop, (pid) => !!document.querySelector(`#pagesList .lrow[data-row="${pid}"] .lav.ok`), ids.nova);
  const nova = await av(ids.nova);
  ok("Nova: a picture URL on fbcdn.net renders an <img> in a 24 px circle", !!nova.img && nova.img.src === PIC && nova.w === 24 && nova.h === 24 && /lav-circle/.test(nova.cls) && parseFloat(nova.radius) >= 12, JSON.stringify(nova));
  ok("…decorative (alt empty, aria-hidden), no referrer, not lazy, async, width and height set", nova.img.alt === "" && nova.ariaHidden === "true" && nova.img.rp === "no-referrer" && nova.img.loading === null && nova.img.decoding === "async" && nova.img.w === "24" && nova.img.h === "24", JSON.stringify(nova.img));
  ok("…it did load (the placeholder icon is hidden behind it)", nova.img.natural > 0 && /\bok\b/.test(nova.cls) && nova.icon.visible === "hidden", JSON.stringify(nova));
  const req = asked.find((r) => r.url === PIC);
  ok("…and the request for it carried no Referer", !!req && req.referer === undefined, JSON.stringify(req));
  const backed = await av(ids.backed);
  ok("Backed: no picture field → the Lucide flag on a muted 24 px circle, in the secondary text colour, no <img>", !backed.img && backed.icon?.cls === "i i-flag" && backed.icon.visible === "visible" && has(backed.icon.mask, "flag.svg")
    && backed.w === 24 && backed.h === 24 && backed.color === "rgb(96, 103, 112)" && backed.bg === "rgb(240, 242, 245)" && parseFloat(backed.radius) >= 12, JSON.stringify(backed));
  const fresh = await av(ids.fresh);
  ok("Fresh: a picture URL on another host is never kept: placeholder, no <img>, no request to that host", !fresh.img && fresh.icon?.cls === "i i-flag" && !asked.some((r) => /evil\.example\.com/.test(r.url)), JSON.stringify(fresh));
  ok("Dead Page: a picture that fails to load (404) falls back to the placeholder, the broken <img> is gone", await until(pop, (pid) => { const box = document.querySelector(`#pagesList .lrow[data-row="${pid}"] .lav`); return !!box && !box.querySelector("img") && !box.classList.contains("ok"); }, ids.dead)
    && b.images.some((x) => /broken_50/.test(x)) && (await av(ids.dead)).icon?.visible === "visible", JSON.stringify(await av(ids.dead)));
  const failed = b.images.filter((x) => /broken_50/.test(x)).length;
  await pop.fill("#pageFilter", "page"); await pop.fill("#pageFilter", "");
  await rowsAre(pop, `${PGS} .lrow`, 9); await until(pop, () => [...document.querySelectorAll("#pagesList .lav img")].every((i) => i.complete)); await settle(pop);       // the pictures that can load have
  ok("a redraw (search typed and cleared) does not ask again for a picture that failed, and keeps the one that loaded", b.images.filter((x) => /broken_50/.test(x)).length === failed && (await av(ids.nova)).img?.src === PIC && !(await av(ids.dead)).img, String(failed));
  ok("no <img> in the list is ever visible without having loaded (no broken-image icon can show)", await pop.evaluate(() => [...document.querySelectorAll("#pagesList .lav img")].every((i) => i.closest(".lav").classList.contains("ok") ? i.naturalWidth > 0 : getComputedStyle(i).opacity === "0")));

  // keyboard: the name is the one button of a row
  await pop.focus(`[data-focus="row:${ids.dead}"]`); await pop.keyboard.press("Enter");
  ok("keyboard: Enter on the name opens the row (aria-expanded), the body appears", (await rowOf(pop, ids.dead)).open && !!(await bodyOf(pop, ids.dead)));
  await pop.keyboard.press("Space");
  ok("…Space closes it", !(await rowOf(pop, ids.dead)).open && (await bodyOf(pop, ids.dead)) === null);
  await pop.click(`${PGS} .lrow[data-row="${ids.dead}"] .lrow-name`);
  ok("a click on the row opens it too", (await rowOf(pop, ids.dead)).open);
  await pop.click(`${PGS} .lrow[data-row="${ids.dead}"] .lrow-head`, { position: { x: 300, y: 30 } });
  ok("…and a click anywhere on the row closes it", !(await rowOf(pop, ids.dead)).open);

  // links: the right URL, a new tab, nothing sent, the row untouched, a keyboard key
  const hits0 = b.hits.length;
  const clickOpens = async (act) => {
    const [np] = await Promise.all([b.ctx.waitForEvent("page", { timeout: 8000 }), act()]);
    await np.waitForURL(/facebook\.com/, { timeout: 8000 }).catch(() => {});
    const url = np.url(); await np.close(); return url;
  };
  const fix = (id) => pop.locator(`${PGS} .lrow[data-row="${id}"] [data-focus="rowfix:${id}"]`);
  ok("the fix on line 2 opens its URL in a new tab", (await clickOpens(() => fix(ids.orion).click())) === LINKS.accountQuality());
  ok("…Publish opens the page in Business Suite", (await clickOpens(() => fix(ids.client).click())) === LINKS.pageSuite(ids.client));
  ok("…Assign me opens the Pages settings of the business", (await clickOpens(() => fix(ids.harbor).click())) === LINKS.bmPages("555"));
  ok("…and Enter on the focused link does the same (keyboard)", (await clickOpens(async () => { await fix(ids.draft).focus(); await pop.keyboard.press("Enter"); })) === LINKS.pageSuite(ids.draft));
  ok("fix links never toggle the row (the row stays closed), and send nothing to Graph", !(await rowOf(pop, ids.orion)).open && !(await rowOf(pop, ids.draft)).open && b.hits.length === hits0, `${b.hits.length - hits0}`);
  await openRow(pop, ids.dead); await openRow(pop, ids.nova); await openRow(pop, ids.fresh);
  ok("a body link opens its URL (Page → the page on Facebook, Business Suite → the page there)", (await clickOpens(() => pop.locator(`[data-focus="plink:${ids.nova}:page"]`).click())) === LINKS.page(ids.nova)
    && (await clickOpens(() => pop.locator(`[data-focus="plink:${ids.nova}:suite"]`).click())) === LINKS.pageSuite(ids.nova));
  ok("a body fix opens its URL (Publish → Business Suite)", (await clickOpens(() => pop.locator(`[data-focus="pfix:${ids.dead}:hidden"]`).click())) === LINKS.pageSuite(ids.dead));
  ok("the Instagram line's Set up opens the Ads Manager ads view, from the keyboard too", (await clickOpens(() => pop.locator(`[data-focus="pfix:${ids.fresh}:ig"]`).click())) === LINKS.adsManagerHome()
    && (await clickOpens(async () => { await pop.focus(`[data-focus="pfix:${ids.fresh}:ig"]`); await pop.keyboard.press("Enter"); })) === LINKS.adsManagerHome());
  ok("…none of it sent a request, closed a row or changed the list", b.hits.length === hits0 && (await rowOf(pop, ids.dead)).open && (await rowOf(pop, ids.fresh)).open && (await rowsAre(pop, `${PGS} .lrow`, 9)));
  await closeRow(pop, ids.dead); await closeRow(pop, ids.nova); await closeRow(pop, ids.fresh);

  // layout: nothing sticks out at 560 and 380, in both languages, with the richest rows open (three problems; two; the Instagram line with its Set up)
  for (const id of [ids.dead, ids.client, ids.nova, ids.fresh]) await openRow(pop, id);
  for (const lang of ["en", "ru"]) {
    await useLang(pop, lang);
    for (const w of [560, 380]) {
      await pop.setViewportSize({ width: w, height: 900 }); await settle(pop);
      const m = await pop.evaluate(() => {
        const de = document.documentElement, r = (n) => n.getBoundingClientRect(), rows = [...document.querySelectorAll("#pagesList .lrow")];
        return { sw: de.scrollWidth, cw: de.clientWidth, rowsOver: rows.filter((x) => x.scrollWidth > x.clientWidth + 0.5).length,
          outside: rows.flatMap((x) => [...x.querySelectorAll(".lrow-fix .act-label, .lrow-more, .lrow-value, .lrow-id, .lav, .lrow-pair, .lrow-link, .lrow-todo")].filter((n) => r(n).width && (r(n).right > r(x).right - 15.5 || r(n).left < r(x).left + 15.5)).map((n) => `${n.className}:${n.textContent.trim().slice(0, 24)}:${Math.round(r(n).right - r(n.closest(".lrow")).right)}`)),
          oneLine: rows.every((x) => r(x.querySelector(".lrow-sub") || x).height <= 22 || !x.querySelector(".lrow-sub")), cut: [...document.querySelectorAll("#pagesList .lrow-fix .act-label")].filter((l) => l.scrollWidth > l.clientWidth).length,
          cutProb: [...document.querySelectorAll("#pagesList .pg-prob-text")].filter((l) => l.scrollWidth > l.clientWidth).length,
          // the ID: the first thing on line 2, under the name, at every width
          idShown: rows.every((x) => { const t = x.querySelector(".lrow-idtext"), nm = x.querySelector(".lrow-name"); return !!t && r(t).width > 0 && Math.abs(r(t).left - r(nm).left) <= 1 && r(t).top >= r(nm).bottom - 4 && x.querySelector(".lrow-sub .lrow-it:not([hidden])").contains(t); }),
          idCut: rows.filter((x) => { const t = x.querySelector(".lrow-idtext"); return t.scrollWidth > t.clientWidth + 0.5; }).map((x) => ({ full: x.querySelector(".lrow-id").getAttribute("aria-label"), title: x.querySelector(".lrow-id").title, status: !!x.querySelector(".lrow-it.sts:not([hidden])") })) };
      });
      if (SHOT) await pop.screenshot({ path: path.join(SHOT, `pages-${lang}-${w}.png`), fullPage: true });
      ok(`${lang} ${w}px: no horizontal scroll, no row wider than the window`, m.sw <= m.cw && m.rowsOver === 0, JSON.stringify(m));
      ok(`${lang} ${w}px: every link, word, picture and body part stays inside the row's 16 px gutters; line 2 is one line; no fix label and no problem word is cut`, m.outside.length === 0 && m.oneLine && m.cut === 0 && m.cutProb === 0, JSON.stringify(m));
      ok(`${lang} ${w}px: the ID is first on line 2 of every collapsed row, under the name, whatever the width (no hidden ID)`, m.idShown, JSON.stringify(m));
      // The fixes are short words now (the longest, 'Назначить себя', has room beside a 15-digit ID and the word at 380 px): no ID is ever cut.
      ok(`${lang} ${w}px: the ID is whole on every row`, m.idCut.length === 0, JSON.stringify(m.idCut));
    }
  }
  await done(b);
}

// ---------- "No access" is a verdict only when me/accounts was read completely ----------
async function verdictFlow() {
  console.log("\n# pages: no verdict about access when me/accounts was not read completely");
  const viaIds = [ids.harbor, ids.client, ids.wing];
  // complete: the three pages that are only in a business are "No access" (the existing flows check the details)
  let b = await boot({ fb: adsFb(TOK), graph: mock(FULL) });
  await adsPage(b);
  let pop = await openPages(b);
  ok("me/accounts complete: pages seen only through a business are 'No access' with a chip counting them (the three + Dead Page, whose own task list has no Advertise)", (await rowsAre(pop, `${PGS} .lrow`, 9)) && (await chips(pop)).some((c) => c === chipList(["pages.chip.noAccess", 4])), (await chips(pop)).join());
  await done(b);

  for (const [label, cfg] of [["me/accounts is empty while the business edges have pages (the token cannot read it)", { ...FULL, rows: [] }],
    ["me/accounts is cut at its page limit (the page may be in the part that was not read)", { ...FULL, accountsNext: true }]]) {
    b = await boot({ fb: adsFb(TOK), graph: mock(cfg) });
    await adsPage(b);
    pop = await openPages(b);
    ok(`${label}: the pages are listed`, await until(pop, (n) => document.querySelectorAll("#pagesList .lrow").length >= n, cfg.rows.length ? 9 : 3));
    const via = await Promise.all(viaIds.map((id) => rowOf(pop, id)));
    ok(`${label}: no 'No access', no 'Assign me' on a page seen only through a business (nothing is known about the person's access)`,
      via.every((r) => r && !(r.status?.text ?? "").includes(tr("pages.p.noAccess")) && r.fix?.text !== tr("pages.fix.assign")), JSON.stringify(via.map((r) => r && [r.name, r.status, r.fix])));
    ok(`${label}: …and the 'No access' chip counts only a real verdict (${cfg.rows.length ? "Dead Page, whose own task list has no Advertise" : "none"})`,
      cfg.rows.length ? (await chips(pop)).some((c) => c === chipList(["pages.chip.noAccess", 1])) : !(await chips(pop)).some((c) => c.includes(tr("pages.chip.noAccess"))), (await chips(pop)).join());
    await pop.click(`${PGS} .lrow[data-row="${ids.harbor}"] .lrow-title`);
    const hb = await bodyOf(pop, ids.harbor);
    ok(`${label}: …the page is alive and silent (the ID alone), its body has no 'What to do' and no word about access: Instagram and the owner only`, (await rowOf(pop, ids.harbor)).status === null && (await rowOf(pop, ids.harbor)).sr === tr("pages.alive") && !hb.todo
      && hb.kv.map((x) => x.join("=")).join("|") === `${tr("pages.kv.ig")}=@harbor.bakery|${tr("pages.kv.business")}=Nova Media`, JSON.stringify(hb));
    ok(`${label}: …other problems of those pages still show (Client Fashion House is unpublished: Hidden → Publish)`, (await chips(pop)).some((c) => c.startsWith(tr("pages.chip.hidden")))
      && (await rowOf(pop, ids.client)).status?.text === tr("pages.p.hidden") && (await rowOf(pop, ids.client)).fix?.text === tr("pages.fix.publish") && (await rowOf(pop, ids.client)).more === null, (await chips(pop)).join());
    await done(b);
  }
}

// ---------- the three problems one at a time, no Instagram is not a problem, only the chips that have a page behind them ----------
async function statesFlow() {
  console.log("\n# pages: Dead / Hidden / No access on their own, a page without Instagram is alive, the chips that exist");
  const S = (n) => `20000000000000${n}`;
  const OKR = { is_published: true, tasks: ["ADVERTISE"], promotion_eligible: true };
  const A = { id: S(1), name: "A Real", ...OKR, instagram_business_account: ig("17841400000000101", "a.real") };
  const B = { id: S(2), name: "B None", ...OKR };                                                                             // no Instagram at all
  const C = { id: S(3), name: "C Backed", ...OKR, connected_page_backed_instagram_account: { id: "17841400000000103" } };
  const D = { id: S(4), name: "D Dead", ...OKR, promotion_eligible: false, instagram_business_account: ig("17841400000000104", "d.dead") };      // dead, Graph gave no reason
  const E = { id: S(5), name: "E Hidden", ...OKR, is_published: false };
  const F = { id: S(6), name: "F No access", ...OKR, tasks: ["MANAGE"] };
  const cfg = { rows: [A, B, C, D, E, F], bms: [] };
  let b = await boot({ fb: adsFb(TOK), graph: mock(cfg) });
  await adsPage(b);
  let pop = await openPages(b);
  ok("six pages, in the order: alive by name, then Dead, Hidden, No access", (await rowsAre(pop, `${PGS} .lrow`, 6)) && (await names(pop)).join() === "A Real,B None,C Backed,D Dead,E Hidden,F No access", (await names(pop)).join());
  ok("chips: Alive 4 (a page with no access can still be alive) · Dead 1 · Hidden 1 · No access 1", (await chips(pop)).join() === chipList(["pages.chip.alive", 4], ["pages.chip.dead", 1], ["pages.chip.hidden", 1], ["pages.chip.noAccess", 1]), (await chips(pop)).join());
  const line = async (n) => lineTwo(pop, `${PGS} .lrow[data-row="${S(n)}"]`);
  ok("line 2: an alive page — real Instagram, none at all, or “Use Facebook Page” — is the ID and nothing else", (await line(1)) === S(1) && (await line(2)) === S(2) && (await line(3)) === S(3), `${await line(1)} | ${await line(2)} | ${await line(3)}`);
  ok("line 2: 'ID · Dead · Appeal', 'ID · Hidden · Publish', 'ID · No access · Assign me' — each with one word and one fix, no '+N'", (await line(4)) === `${S(4)} · ${tr("pages.p.dead")} · ${tr("pages.fix.appeal")}` && (await line(5)) === `${S(5)} · ${tr("pages.p.hidden")} · ${tr("pages.fix.publish")}`
    && (await line(6)) === `${S(6)} · ${tr("pages.p.noAccess")} · ${tr("pages.fix.assign")}`, `${await line(4)} | ${await line(5)} | ${await line(6)}`);
  const [rd, rh, rn, rb] = [await rowOf(pop, S(4)), await rowOf(pop, S(5)), await rowOf(pop, S(6)), await rowOf(pop, S(2))];
  ok("Dead: red, no reason from Graph → the word's tooltip is the short explanation 'Meta does not allow advertising this page'; Appeal → Account Quality", rd.status.tone === "bad" && rd.status.title === tr("pages.deadTitle") && rd.status.title === "Meta does not allow advertising this page" && rd.fix.href === LINKS.accountQuality() && rd.fix.title === tr("pages.fix.appealTitle"), JSON.stringify(rd));
  ok("Hidden: amber, Publish → the page in Business Suite", rh.status.tone === "warn" && rh.status.title === tr("pages.hiddenTitle") && rh.fix.href === LINKS.pageSuite(S(5)), JSON.stringify(rh));
  ok("No access (a task list without Advertise): amber, Assign me → Business Suite (no business known), the tooltip says the Advertise task is missing", rn.status.tone === "warn" && rn.status.title === tr("pages.noAccessTitle") && rn.fix.href === LINKS.pageSuite(S(6)), JSON.stringify(rn));
  ok("a page with no Instagram is silent: no word, no dot, no fix, a screen-reader 'Alive'; no row has a value at the right of its name", rb.status === null && !rb.dot && rb.fix === null && rb.more === null && rb.sr === tr("pages.alive") && (await pop.locator(`${PGS} .lrow .lrow-value`).count()) === 0, JSON.stringify(rb));
  await openRow(pop, S(4)); await openRow(pop, S(2)); await openRow(pop, S(5));
  const bd = await bodyOf(pop, S(4)), bn = await bodyOf(pop, S(2)), be = await bodyOf(pop, S(5));
  ok("Dead without a reason, opened: no 'Reason', no 'What to do' (its one fix is on line 2); Instagram, two links", !bd.todo && bd.kv.map((x) => x.join("=")).join("|") === `${tr("pages.kv.ig")}=@d.dead` && bd.links.map((l) => l.text).join() === [tr("pages.linkPage"), tr("pages.linkSuite")].join(), JSON.stringify(bd));
  ok("Hidden, opened: no 'What to do'; Instagram 'none' with its Set up link — a page can be hidden AND without Instagram, the row says only Hidden", !be.todo && be.ig?.link?.href === LINKS.adsManagerHome() && (await rowOf(pop, S(5))).more === null, JSON.stringify(be));
  ok("B (no Instagram, alive), opened: 'none' + Set up, and still silent on its row", bn.ig?.none === tr("pages.ig.none") && bn.ig.link.text === tr("pages.fix.ig") && (await rowOf(pop, S(2))).status === null, JSON.stringify(bn));
  for (const n of [4, 2, 5]) await closeRow(pop, S(n));
  for (const [chip, want] of [["alive", "A Real,B None,C Backed,F No access"], ["dead", "D Dead"], ["hidden", "E Hidden"], ["noAccess", "F No access"]]) {
    await pop.click(`#pagesChips .chip:has-text("${tr(`pages.chip.${chip}`)}")`);
    ok(`chip ${chip}: ${want}`, (await names(pop)).join() === want && (await pop.locator(`#pagesChips .chip[aria-pressed=true]`).count()) === 1, (await names(pop)).join());
  }
  await pop.click(`#pagesChips .chip:has-text("${tr("pages.chip.dead")}")`);
  cfg.rows = [A, B, C, E, F];                                                          // the dead page is gone at the next refresh
  await resetLocks(pop); await pop.click("#loadPages");
  ok("the Dead chip is pressed, its page disappears at a refresh: the chip goes, the filter with it, every page is listed", await until(pop, () => !document.querySelector("#pagesChips .chip.bad"))
    && (await rowsAre(pop, `${PGS} .lrow`, 5)) && (await pop.locator(`#pagesChips .chip[aria-pressed=true]`).count()) === 0 && (await chips(pop)).join() === chipList(["pages.chip.alive", 4], ["pages.chip.hidden", 1], ["pages.chip.noAccess", 1]), (await chips(pop)).join());
  await done(b);

  // only what exists: all alive → one chip; nothing alive → no Alive chip
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: [A, B, C], bms: [] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("every page alive: the one chip is 'Alive 3' (no chip with a zero)", (await rowsAre(pop, `${PGS} .lrow`, 3)) && (await chips(pop)).join() === chipList(["pages.chip.alive", 3]), (await chips(pop)).join());
  await done(b);
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: [D, E], bms: [] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("nothing alive: no Alive chip; Dead 1 · Hidden 1", (await rowsAre(pop, `${PGS} .lrow`, 2)) && (await chips(pop)).join() === chipList(["pages.chip.dead", 1], ["pages.chip.hidden", 1]), (await chips(pop)).join());
  await done(b);
}

export const flows = { pagesVerdict: verdictFlow, pagesRows: rowsFlow, pages: pagesFlow, pagesBiz: bizFlow, pagesFields: fieldsFlow, pagesErrors: errorsFlow, pagesToken: tokenFlow, pagesCache: cacheFlow, pagesStates: statesFlow };
