// Pages tab: every page the token can see = me/accounts + every business's owned_pages and client_pages (merged by id; the profile's own
// row wins because it carries the tasks; a page seen only through a business is "No access" → "Assign me"). Automatic first load, the
// one-minute slot that covers the whole refresh (all requests), optional fields Graph refuses (me/accounts AND every business edge, each edge
// with its own skip set), edges and businesses that error (skipped, the rest stays, a muted hint), permission errors, a Page access token that
// must never be kept (me/accounts AND business edges), problem chips, search, the shared row (silent healthy rows, the worst problem + one fix +
// "+N", ID + copy, lazy body: other problems, Instagram, business, my access, links), avatars, no Copy IDs, language, per-user cache, layout.
// Fictional data.
import { GRAPH, TOK, ok, has, boot, adsPage, popup, text, until, rowsAre, resetLocks, clickToast, captureClipboard, clip, accountsJson, adsFb, boxWait, GONE, stored } from "../harness.mjs";
import { LINKS } from "../../fb-helper/js/links.js";

const LEAK = "EAAPageSECRET" + "q".repeat(50);                   // a Page access token as Graph would hand it out by default
const ids = { nova: "100000000000001", fresh: "100000000000002", backed: "100000000000003", hidden: "100000000000004", draft: "100000000000005", orion: "100000000000006",
  harbor: "100000000000007", client: "100000000000008", wing: "100000000000009" };
const PIC = "https://scontent.xx.fbcdn.net/v/t39.30808-1/nova_50.jpg";
const ig = (id, username) => ({ id, username });
// me/accounts: the pages the profile has a role on (with tasks)
const PAGES = [
  { id: ids.nova, name: "Nova Travel Blog", is_published: true, tasks: ["ADVERTISE", "ANALYZE", "MANAGE"], instagram_business_account: ig("17841400000000001", "nova.travel"), promotion_eligible: true,
    business: { id: "555", name: "Nova Media" }, picture: { data: { url: PIC, height: 50, width: 50, is_silhouette: false } } },
  { id: ids.fresh, name: "Fresh Page", is_published: true, tasks: ["ADVERTISE", "MANAGE"], promotion_eligible: true, picture: { data: { url: "https://evil.example.com/tracker.png" } } },
  { id: ids.backed, name: "Backed Page", is_published: true, tasks: ["ADVERTISE"], connected_page_backed_instagram_account: { id: "17841400000000009" }, promotion_eligible: true },
  { id: ids.hidden, name: "Hidden Page", is_published: false, tasks: ["ANALYZE", "MODERATE"], promotion_eligible: false, promotion_ineligible_reason: "Page is not published",
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
const ORDER = ["Backed Page", "Nova Travel Blog", "Client Fashion House", "Harbor Bakery", "Hidden Page", "Wingtip Gadgets", "Draft Page", "Orion Studio", "Fresh Page"];
//             healthy by name                       | No access by name                                                            | Unpublished | Can't advertise | No Instagram
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
const pageReqs = (b) => b.hits.filter((h) => /^\/me\/accounts|^\/me\/businesses|^\/\d+\/(owned|client)_pages/.test(h));   // everything a refresh sends
const fieldsOf = (h) => new URL(`http://x${h}`).searchParams.get("fields") || "";
const toastOf = (p) => p.evaluate(() => document.querySelector("#toast").textContent.trim());
const names = (p) => p.$$eval(".lrow .lrow-name", (n) => n.map((x) => x.textContent));
const chips = (p) => p.$$eval(".chip", (n) => n.map((x) => x.textContent.trim()));
// A row as the screen shows it, by page id: the name, the muted handle, line 2 (status word, context, the fix, "+N"), the ID, the picture.
const rowOf = (p, id) => p.evaluate((pid) => {
  const link = (a) => ({ text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, title: a.title, aria: a.getAttribute("aria-label"), focus: a.dataset.focus, tab: a.tabIndex });
  const r = document.querySelector(`.lrow[data-row="${pid}"]`);
  if (!r) return null;
  const q = (s) => r.querySelector(`.lrow-head ${s}`), st = q(".lrow-status"), val = q(".lrow-value"), fix = q(".lrow-fix");
  return { name: q(".lrow-name").textContent, value: val?.textContent.trim() ?? null, valueMuted: !!val?.classList.contains("muted"), valueTitle: val?.title || null,
    status: st ? { text: st.querySelector(".lrow-status-text").textContent, tone: st.className.replace("lrow-status", "").trim(), title: st.title } : null,
    dot: !!q(".lrow-dot"), sr: q(".lrow-sub .sr-only")?.textContent ?? null, ctx: [...r.querySelectorAll(".lrow-head .lrow-ctx")].map((x) => ({ text: x.textContent, title: x.title })),
    fix: fix ? link(fix) : null, fixes: r.querySelectorAll(".lrow-head .lrow-fix").length, more: q(".lrow-more")?.textContent ?? null, id: q(".lrow-idtext")?.textContent ?? null,
    open: q(".lrow-title").getAttribute("aria-expanded") === "true" };
}, id);
// The body of an open row: other problems with their fixes, key–value pairs, links.
const bodyOf = (p, id) => p.evaluate((pid) => {
  const link = (a) => ({ text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, title: a.title, aria: a.getAttribute("aria-label"), focus: a.dataset.focus, tab: a.tabIndex });
  const b = document.querySelector(`.lrow[data-row="${pid}"] .lrow-body`);
  if (!b) return null;
  return { idline: b.querySelector(".lrow-idline")?.innerText.replace(/\s+/g, " ").trim() ?? null, todo: !!b.querySelector(".lrow-todo"), todoTitle: b.querySelector(".lrow-todo-title")?.textContent ?? null,
    probs: [...b.querySelectorAll(".pg-prob")].map((x) => ({ key: x.dataset.problem, text: x.querySelector(".pg-prob-text").textContent, tone: x.querySelector(".pg-prob-text").className.replace("pg-prob-text", "").trim(),
      title: x.querySelector(".pg-prob-text").title, fixes: [...x.querySelectorAll("a")].map(link) })),
    kv: [...b.querySelectorAll(".lrow-pair")].map((x) => [x.querySelector("dt").textContent, x.querySelector("dd").textContent]), links: [...b.querySelectorAll(".lrow-link")].map(link),
    boxes: b.querySelectorAll(".btn, button.act, .pill").length };
}, id);
const openRow = async (p, id) => { if (!(await rowOf(p, id)).open) await p.click(`.lrow[data-row="${id}"] .lrow-title`); await until(p, (pid) => !!document.querySelector(`.lrow[data-row="${pid}"] .lrow-body`), id); };
const closeRow = async (p, id) => { if ((await rowOf(p, id)).open) await p.click(`.lrow[data-row="${id}"] .lrow-title`); };
// Waits for the n-th page-list request, then a moment for a stray extra one.
const waitReqs = async (p, b, n, get = reqs) => { for (let i = 0; i < 60 && get(b).length < n; i++) await p.waitForTimeout(100); await p.waitForTimeout(200); return get(b).length === n; };
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
  ok("first visit: a row for every page of the profile and of its businesses, without pressing refresh", await rowsAre(pop, ".lrow", 9));
  await pop.waitForTimeout(300);
  ok("…six requests: the profile's pages, the businesses, the owned edges of both businesses, then the client edges", pageReqs(b).map(pathOf).join() === ["/me/accounts", "/me/businesses", "/555/owned_pages", "/777/owned_pages", "/555/client_pages", "/777/client_pages"].join(), pageReqs(b).map(pathOf).join());
  ok("…and no toast for an automatic load", (await toastOf(pop)) === "", await toastOf(pop));
  ok("the popup opens at full height on the Pages tab", await pop.evaluate(() => document.body.getBoundingClientRect().height >= 600));
  const mine = fieldsOf(reqs(b)[0]), edge = fieldsOf(edgeReqs(b)[0]);
  ok("me/accounts names id, name and every optional field (with tasks)", ["id", "name", ...OPT_ALL].every((f) => mine.includes(f)), mine);
  ok("every business edge names the same fields without tasks", ["id", "name", ...OPT_ALL.filter((f) => f !== "tasks")].every((f) => edge.includes(f)) && !has(edge, "tasks") && edgeReqs(b).length === 4 && edgeReqs(b).every((h) => !has(fieldsOf(h), "tasks") && fieldsOf(h) === edge), edgeReqs(b).map(fieldsOf).join(" || "));
  ok("me/businesses asks for id and name only", fieldsOf(b.hits.find((h) => h.startsWith("/me/businesses"))) === "id,name");
  ok("no followers, likes, category or verification are asked for", !/category|followers_count|fan_count|verification_status/.test(pageReqs(b).map(fieldsOf).join()));
  ok("…and never an access token, in any request of the refresh (profile list, businesses, edges)", pageReqs(b).length === 6 && !/access_token/.test(pageReqs(b).map((h) => decodeURIComponent(h)).join()));
  ok("every Graph request is a GET", methods.length > 0 && methods.every((m) => m === "GET"), methods.join());
  ok("sorted: pages with nothing wrong first (by name), then by the worst problem (No access, Unpublished, Can't advertise, No Instagram), each by name", (await names(pop)).join() === ORDER.join(), (await names(pop)).join());
  ok("merged by id: the profile's own row wins (Nova keeps its name), a page in three business edges is one row (the owned one)", (await names(pop)).filter((n) => /Nova|Harbor/.test(n)).join() === "Nova Travel Blog,Harbor Bakery");
  ok("the count line is empty (and hidden) while nothing is filtered", (await text(pop, "#pagesTotal")) === "" && !(await pop.locator("#pagesTotal").isVisible()), await text(pop, "#pagesTotal"));
  ok("no 'pages only via business' hint: every business was read", (await pop.locator(".pg-foot").count()) === 0);
  ok("chips: only problems that exist, with counts, in the order of the priority", (await chips(pop)).join() === "No access 4,Unpublished 3,Can't advertise 2,No Instagram 3", (await chips(pop)).join());
  ok("controls: search and refresh only — no Copy IDs", (await pop.locator("#pagesCard .search button").count()) === 1 && (await pop.locator("#copyPageIds").count()) === 0 && !/Copy IDs/.test(await text(pop, "#tab-pages")) && (await pop.locator("#pagesCard input").count()) === 1);
  const tip = await pop.getAttribute("#loadPages", "title");
  ok("'updated X ago' lives in the refresh button's tooltip", /^Refresh · updated just now$/.test(tip), tip);
  await pop.click('[data-tab="token"]'); await pop.click('[data-tab="pages"]'); await pop.waitForTimeout(500);
  ok("second visit in the same popup: no new request", pageReqs(b).length === 6, String(pageReqs(b).length));

  // rows: healthy = silent, a problem = its word + ONE fix (+N)
  const nova = await rowOf(pop, ids.nova);
  ok("Nova (healthy, real Instagram): silent — no status word, no dot, no fix; a screen-reader 'Ready'; the handle muted at the right of the name", nova.status === null && !nova.dot && nova.fix === null && nova.more === null && nova.sr === "Ready"
    && nova.value === "@nova.travel" && nova.valueMuted && nova.ctx.length === 0 && nova.id === ids.nova, JSON.stringify(nova));
  ok("…the handle is shown once (not repeated on line 2)", (await pop.locator(`.lrow[data-row="${ids.nova}"] .lrow-head`).innerText()).split("@nova.travel").length === 2);
  const backed = await rowOf(pop, ids.backed);
  ok("Backed (healthy, “Use Facebook Page” set): silent; the only thing on line 2 is the identity 'IG via page', with its explanation as the tooltip; no handle", backed.status === null && backed.fix === null && backed.value === null
    && backed.ctx.length === 1 && backed.ctx[0].text === "IG via page" && has(backed.ctx[0].title, "“Use Facebook Page” is set") && has(backed.ctx[0].title, "Instagram placements will run as the page"), JSON.stringify(backed));
  const fresh = await rowOf(pop, ids.fresh);
  ok("Fresh (No Instagram): the word, then its ONE fix 'Set “Use Facebook Page”' → the Ads Manager ads view, with the explanation as tooltip; no '+N'",
    fresh.status?.text === "No Instagram" && fresh.status.tone === "warn" && fresh.fixes === 1 && fresh.fix.text === "Set “Use Facebook Page”" && fresh.fix.href === LINKS.adsManagerHome() && fresh.fix.target === "_blank" && fresh.fix.rel === "noopener noreferrer"
    && has(fresh.fix.title, "Identity → Instagram account") && has(fresh.fix.title, "once") && has(fresh.fix.title, "automated launches to Instagram placements fail") && fresh.more === null && fresh.sr === null, JSON.stringify(fresh));
  const hidden = await rowOf(pop, ids.hidden);
  ok("Hidden (tasks without ADVERTISE, unpublished, can't advertise, no Instagram): the WORST problem only — 'No access' → 'Assign me' (Business Suite: owner unknown) '+3 more'",
    hidden.status?.text === "No access" && hidden.status.tone === "warn" && hidden.fixes === 1 && hidden.fix.text === "Assign me" && hidden.fix.href === LINKS.pageSuite(ids.hidden) && hidden.more === "+3 more", JSON.stringify(hidden));
  const orion = await rowOf(pop, ids.orion);
  ok("Orion (Can't advertise): the word in red, Graph's reason is its tooltip (never a line of its own), the fix is 'Appeal' → Account Quality",
    orion.status?.text === "Can't advertise" && orion.status.tone === "bad" && orion.status.title === "This page is restricted from promoting" && orion.fix.text === "Appeal" && orion.fix.href === LINKS.accountQuality() && orion.more === null && orion.value === "@orion.studio", JSON.stringify(orion));
  const draft = await rowOf(pop, ids.draft);
  ok("Draft (Unpublished): 'Unpublished' → 'Publish' → the page in Business Suite", draft.status?.text === "Unpublished" && draft.fix.text === "Publish" && draft.fix.href === LINKS.pageSuite(ids.draft) && draft.more === null, JSON.stringify(draft));
  const harbor = await rowOf(pop, ids.harbor), client = await rowOf(pop, ids.client), wing = await rowOf(pop, ids.wing);
  ok("Harbor (owned by business 555, not in me/accounts): 'No access' → 'Assign me' → the Pages settings of THAT business; no '+N'; its own Instagram handle is still shown",
    harbor.status?.text === "No access" && harbor.fix.text === "Assign me" && harbor.fix.href === LINKS.bmPages("555") && harbor.more === null && harbor.value === "@harbor.bakery" && has(harbor.status.title, "not assigned"), JSON.stringify(harbor));
  ok("Client (shared with business 555 by another business, unpublished): 'No access' → 'Assign me' → business 555's Pages settings (the business I am in, not the owner's) '+1 more'",
    client.status?.text === "No access" && client.fix.href === LINKS.bmPages("555") && client.more === "+1 more", JSON.stringify(client));
  ok("Wingtip (owned by business 777, no Instagram): 'No access' → business 777's Pages settings '+1 more'", wing.status?.text === "No access" && wing.fix.href === LINKS.bmPages("777") && wing.more === "+1 more", JSON.stringify(wing));
  ok("exactly one fix link on every collapsed row that has a problem, none on healthy ones", (await pop.locator(".lrow .lrow-head .lrow-fix").count()) === 7 && (await pop.locator('.lrow[data-row="' + ids.nova + '"] .lrow-fix, .lrow[data-row="' + ids.backed + '"] .lrow-fix').count()) === 0);
  ok("no pill-shaped or boxed action anywhere in a row (fix links are plain underlined text, in the tone of the word)", (await pop.locator(".lrow .pill, .lrow .btn, .lrow .act-link").count()) === 0
    && (await pop.locator(".lrow .lrow-fix").evaluateAll((a) => a.every((x) => getComputedStyle(x).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(x.querySelector(".act-label")).textDecorationLine === "underline" && !x.querySelector(".i")))));
  ok("every fix names its page for a screen reader, and has a keyboard key", await pop.locator(".lrow .lrow-fix").evaluateAll((a) => a.every((x) => x.getAttribute("aria-label") === `${x.textContent.trim()} · ${x.closest(".lrow").querySelector(".lrow-name").textContent}` && /^rowfix:\d+$/.test(x.dataset.focus))));

  // the body: built when a row opens
  ok("no body exists while rows are closed", (await pop.locator(".lrow-body").count()) === 0);
  await openRow(pop, ids.hidden);
  const hb = await bodyOf(pop, ids.hidden);
  ok("Hidden, opened: 'What to do' lists EVERY problem (the worst, which is on line 2 too, first), worst first, each its word + exactly ONE fix link to the right page",
    hb.todo && hb.todoTitle === "What to do" && hb.probs.map((x) => `${x.text}>${x.fixes.map((f) => f.text).join("+")}`).join() === "No access>Assign me,Unpublished>Publish,Can't advertise>Appeal,No Instagram>Set “Use Facebook Page”"
    && hb.probs.every((x) => x.fixes.length === 1 && x.fixes[0].target === "_blank" && x.fixes[0].rel === "noopener noreferrer" && x.fixes[0].tab === 0)
    && hb.probs.map((x) => x.fixes[0].href).join() === [LINKS.pageSuite(ids.hidden), LINKS.pageSuite(ids.hidden), LINKS.accountQuality(), LINKS.adsManagerHome()].join() && hb.probs.map((x) => x.tone).join() === "warn,warn,bad,warn", JSON.stringify(hb.probs));
  ok("…Graph's reason is the tooltip of 'Can't advertise'; each fix names its page and has a keyboard key", hb.probs[2].title === "Page is not published"
    && hb.probs.every((x) => x.fixes[0].aria === `${x.fixes[0].text} · Hidden Page` && x.fixes[0].focus === `pfix:${ids.hidden}:${x.key}`), JSON.stringify(hb.probs.map((x) => x.fixes[0].aria)));
  ok("…key–value: no pair at all — 'Instagram: None' and 'Your access: …' only say again what the problems above say, and the business is unknown", hb.kv.length === 0, JSON.stringify(hb.kv));
  ok("…links: Page, Business Suite (no Portfolio: no owner business known), new tab, noopener noreferrer, ids in the URLs", hb.links.map((l) => l.text).join() === "Page,Business Suite" && hb.links.every((l) => l.target === "_blank" && l.rel === "noopener noreferrer")
    && hb.links[0].href === `https://www.facebook.com/${ids.hidden}` && hb.links[1].href === `https://business.facebook.com/latest/home?asset_id=${ids.hidden}`, JSON.stringify(hb.links));
  ok("…the body starts with the ID line (for narrow windows: from 480 px the ID is on the collapsed row and its copy button is tabbable once the row is open), no boxes or pills", /^ID\s?\d+$/.test(hb.idline) && hb.boxes === 0
    && (await pop.locator(`.lrow[data-row="${ids.hidden}"] .lrow-idline`).evaluate((n) => getComputedStyle(n).display)) === "none" && (await pop.locator(`.lrow[data-row="${ids.hidden}"] .lrow-head .lrow-id`).evaluate((n) => n.tabIndex)) === 0, JSON.stringify(hb));
  await openRow(pop, ids.nova); await openRow(pop, ids.harbor); await openRow(pop, ids.client); await openRow(pop, ids.fresh);
  const nb = await bodyOf(pop, ids.nova), hrb = await bodyOf(pop, ids.harbor), cb = await bodyOf(pop, ids.client), fb = await bodyOf(pop, ids.fresh);
  ok("Nova, opened: no 'What to do' (nothing wrong); Instagram account, owner business, my tasks; three links, Business pages → business 555", !nb.todo && nb.kv.map((x) => x.join("=")).join("|") === "Instagram=Account @nova.travel|Business=Nova Media|Your access=Advertise, Manage, Insights"
    && nb.links.map((l) => l.text).join() === "Page,Business Suite,Business pages" && nb.links[2].href === LINKS.bmPages("555"), JSON.stringify(nb));
  ok("Harbor, opened (via business): its one problem and fix are in What to do (No access → Assign me, 'not assigned' is that problem's tooltip, so no 'Your access' pair); Business = the owner (filled from the owned edge); Business pages → 555",
    hrb.todo && hrb.probs.map((x) => `${x.text}>${x.fixes[0].text}`).join() === "No access>Assign me" && has(hrb.probs[0].title, "not assigned") && hrb.kv.map((x) => x.join("=")).join("|") === "Instagram=Account @harbor.bakery|Business=Nova Media" && hrb.links[2]?.href === LINKS.bmPages("555"), JSON.stringify(hrb));
  ok("Client, opened: both problems with their fixes (No access → Assign me, Unpublished → Publish); Business = the owner Graph named; Business pages → the business I see it through (555), not the owner's", cb.probs.map((x) => `${x.text}>${x.fixes[0].text}`).join() === "No access>Assign me,Unpublished>Publish"
    && cb.kv[1]?.join("=") === "Business=Fashion Holding" && cb.links[2]?.href === LINKS.bmPages("555"), JSON.stringify(cb));
  ok("Fresh, opened: its one problem + fix in What to do, the explanation is the problem word's tooltip; no 'Instagram: None' pair (it would say the problem again)", fb.probs.map((x) => `${x.text}>${x.fixes[0].text}`).join() === "No Instagram>Set “Use Facebook Page”" && has(fb.probs[0].title, "Identity → Instagram account") && fb.kv.every((x) => x[0] !== "Instagram"), JSON.stringify(fb));
  ok("five bodies can be open at once", (await pop.locator(".lrow-body").count()) === 5);
  for (const k of ["nova", "harbor", "client", "fresh"]) await closeRow(pop, ids[k]);
  ok("a closed row throws its body away", (await pop.locator(".lrow-body").count()) === 1);

  // chips filter, keyboard
  await pop.focus('[data-focus="pchip:noIg"]'); await pop.keyboard.press("Enter");
  ok("chip (keyboard Enter): only the pages without Instagram", (await names(pop)).join() === "Hidden Page,Wingtip Gadgets,Fresh Page", (await names(pop)).join());
  ok("…focus stays on the chip after the redraw, aria-pressed", await pop.evaluate(() => document.activeElement?.dataset.focus === "pchip:noIg" && document.activeElement.getAttribute("aria-pressed") === "true"));
  ok("…an open row stays open through the redraw", (await rowOf(pop, ids.hidden)).open && !!(await bodyOf(pop, ids.hidden)));
  ok("…the count line appears only now ('3 of 9 found'), the fix is written out above the list", await text(pop, "#pagesTotal") === "3 of 9 found" && await pop.locator("#pagesTotal").isVisible() && has(await text(pop, ".pg-note"), "choose “Use Facebook Page” once"), await text(pop, "#pagesTotal"));
  await pop.fill("#pageFilter", "hid");
  ok("chip + search together", (await names(pop)).join() === "Hidden Page" && (await text(pop, "#pagesTotal")) === "1 of 9 found", (await names(pop)).join());
  await pop.fill("#pageFilter", "");
  await pop.click('.chip:has-text("No Instagram")');
  ok("chip again: the full list, the count line and the note are gone", (await rowsAre(pop, ".lrow", 9)) && (await pop.locator(".pg-note").count()) === 0 && !(await pop.locator("#pagesTotal").isVisible()));
  await pop.click('.chip:has-text("No access")');
  ok("No access chip: the pages the profile is not assigned to (no ADVERTISE task, or only through a business)", (await names(pop)).join() === "Client Fashion House,Harbor Bakery,Hidden Page,Wingtip Gadgets", (await names(pop)).join());
  await pop.click('.chip:has-text("Unpublished")');
  ok("another chip replaces the first (one problem at a time); Unpublished = every unpublished page, not only where it is the worst problem", (await names(pop)).join() === "Client Fashion House,Hidden Page,Draft Page" && (await pop.locator(".chip[aria-pressed=true]").count()) === 1, (await names(pop)).join());
  await pop.click('.chip:has-text("Can\'t advertise")');
  ok("Can't advertise chip", (await names(pop)).join() === "Hidden Page,Orion Studio", (await names(pop)).join());
  await pop.click('.chip:has-text("Can\'t advertise")');

  // search
  await pop.fill("#pageFilter", "NOVA");
  ok("search by name (any case) or owner business", (await names(pop)).join() === "Nova Travel Blog,Harbor Bakery", (await names(pop)).join());
  await pop.fill("#pageFilter", "tailspin");
  ok("search by the owner business named by the edge (owned_pages of 777)", (await names(pop)).join() === "Wingtip Gadgets", (await names(pop)).join());
  await pop.fill("#pageFilter", ids.backed);
  ok("search by ID", (await names(pop)).join() === "Backed Page", (await names(pop)).join());
  await pop.fill("#pageFilter", "zzz");
  ok("nothing found: says so", has(await text(pop, "#pagesList"), "Nothing found"));
  await pop.fill("#pageFilter", "");
  ok("search cleared: all rows", await rowsAre(pop, ".lrow", 9));

  // ID + copy
  await captureClipboard(pop);
  await pop.evaluate(() => { const t = document.querySelector("#toast"); t.textContent = ""; t.classList.remove("show"); });
  await pop.click(`.lrow[data-row="${ids.nova}"] .lrow-head .lrow-id`);
  ok("the copy icon copies the page's ID, the row does not toggle, and there is no toast (a live region says it)", (await clip(pop)).at(-1) === ids.nova && !(await rowOf(pop, ids.nova)).open && (await toastOf(pop)) === ""
    && (await until(pop, () => document.querySelector('.sr-only[aria-live]')?.textContent === "ID copied")));
  await pop.focus(`[data-focus="rowid:${ids.hidden}"]`); await pop.keyboard.press("Enter");
  ok("the copy button of an OPEN row's head is a tab stop and copies by keyboard (the body's own copy line is for narrow windows)", (await clip(pop)).at(-1) === ids.hidden, JSON.stringify(await clip(pop)));
  ok("…and the copy icon of the collapsed row is not a tab stop", await pop.locator(`.lrow[data-row="${ids.nova}"] .lrow-head .lrow-id`).evaluate((n) => n.tabIndex === -1));

  // the minute: the auto-load took the slot, which covers the whole refresh
  const before = pageReqs(b).length;
  const tst = await clickToast(pop, "#loadPages");
  ok("refresh within a minute: toast with the wait, NO request of any kind (the one slot covered the profile list, the businesses and every edge)", /Refresh available in \d+ s/.test(tst) && Number(/\d+/.exec(tst)[0]) <= 60 && pageReqs(b).length === before && before === 6, `${tst} / ${pageReqs(b).length}`);
  const slots = (await stored(pop, "locks")).slots;
  ok("…the slot is held under 'pages', for at most 60 s", !!slots.pages && slots.pages > Date.now() && slots.pages - Date.now() <= 60000, JSON.stringify(slots));
  ok("…the refresh button is usable again", !(await pop.locator("#loadPages").isDisabled()) && (await pop.locator("#loadPages").getAttribute("aria-busy")) === null);
  await resetLocks(pop); await pop.click("#loadPages");
  ok("refresh after the minute: the whole read again (12 requests in all), one slot", await waitReqs(pop, b, 12, pageReqs), String(pageReqs(b).length));
  ok("…a manual load says how many pages", await until(pop, () => /Pages: 9/.test(document.querySelector("#toast").textContent)), await toastOf(pop));
  ok("…an open row is still open after the refresh", (await rowOf(pop, ids.hidden)).open);

  // reopen: the cache is shown, nothing is requested
  pop = await popup(b); await pop.waitForTimeout(700);
  ok("reopen: cached rows, no request (a cached list is only refreshed by the button)", (await rowsAre(pop, ".lrow", 9)) && pageReqs(b).length === 12, String(pageReqs(b).length));
  ok("…on the Pages tab, no toast", (await pop.evaluate(() => document.querySelector(".tab.active").dataset.tab)) === "pages" && (await toastOf(pop)) === "");

  // language: chips, words, fixes, kv, tooltips
  await pop.click('.chip:has-text("No Instagram")');
  await pop.click('[data-lang="ru"]');
  ok("RU: chips", (await chips(pop)).join() === "Нет доступа 4,Не опубликована 3,Нельзя рекламировать 2,Нет Instagram 3", (await chips(pop)).join());
  ok("RU: the filter stays on (3 rows), placeholder, refresh tooltip, count line", (await rowsAre(pop, ".lrow", 3)) && (await pop.getAttribute("#pageFilter", "placeholder")) === "Поиск"
    && /^Обновить · обновлено /.test(await pop.getAttribute("#loadPages", "title")) && (await text(pop, "#pagesTotal")) === "найдено 3 из 9", `${await text(pop, "#pagesTotal")} | ${await pop.getAttribute("#loadPages", "title")}`);
  ok("RU: the fix note", has(await text(pop, ".pg-note"), "один раз выбери «Use Facebook Page»"), await text(pop, ".pg-note"));
  await pop.click('.chip:has-text("Нет Instagram")');
  const ruHidden = await rowOf(pop, ids.hidden), ruFresh = await rowOf(pop, ids.fresh), ruOrion = await rowOf(pop, ids.orion), ruDraft = await rowOf(pop, ids.draft), ruBacked = await rowOf(pop, ids.backed), ruNova = await rowOf(pop, ids.nova);
  ok("RU: words and fixes: Нет доступа → Назначить себя ещё 3 · Нельзя рекламировать → Апелляция · Не опубликована → Опубликовать · Нет Instagram → Выбрать «Use Facebook Page»",
    `${ruHidden.status.text}>${ruHidden.fix.text}${ruHidden.more}|${ruOrion.status.text}>${ruOrion.fix.text}|${ruDraft.status.text}>${ruDraft.fix.text}|${ruFresh.status.text}>${ruFresh.fix.text}` === "Нет доступа>Назначить себяещё 3|Нельзя рекламировать>Апелляция|Не опубликована>Опубликовать|Нет Instagram>Выбрать «Use Facebook Page»"
    && has(ruFresh.fix.title, "автозапуски") && ruBacked.ctx[0].text === "IG от страницы" && ruBacked.sr === "Готова" && ruNova.sr === "Готова", JSON.stringify([ruHidden, ruFresh]));
  await openRow(pop, ids.hidden);
  const ruHb = await bodyOf(pop, ids.hidden);
  ok("RU: the body — the title, every problem with its fix, no pair that restates them, links", ruHb.todoTitle === "Что делать" && ruHb.probs.map((x) => `${x.text}>${x.fixes[0].text}`).join() === "Нет доступа>Назначить себя,Не опубликована>Опубликовать,Нельзя рекламировать>Апелляция,Нет Instagram>Выбрать «Use Facebook Page»"
    && ruHb.kv.length === 0 && ruHb.links.map((l) => l.text).join() === "Страница,Business Suite", JSON.stringify(ruHb));
  await openRow(pop, ids.harbor);
  ok("RU: via business", (await bodyOf(pop, ids.harbor)).kv.map((x) => x.join("=")).join("|") === "Instagram=Аккаунт @harbor.bakery|Бизнес=Nova Media" && has((await bodyOf(pop, ids.harbor)).probs[0].title, "тебя на неё не назначили") && (await bodyOf(pop, ids.harbor)).links[2].text === "Страницы бизнеса");
  await closeRow(pop, ids.harbor);
  await pop.click('[data-lang="en"]');
  ok("back to English", await until(pop, () => /^Refresh · updated/.test(document.querySelector("#loadPages").title) && document.querySelector("#pageFilter").placeholder === "Search"));
  ok("no request for any of it", pageReqs(b).length === 12, String(pageReqs(b).length));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
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
  ok("two edges error: every other page is still listed, the pages that were only in those edges are not", (await rowsAre(pop, ".lrow", 7)) && (await names(pop)).join() === ORDER.filter((n) => !/Wingtip|Client/.test(n)).join(), (await names(pop)).join());
  ok("…all six requests were still made (a failing edge does not stop the rest), no red toast", pageReqs(b).length === 6 && !(await pop.evaluate(() => document.querySelector("#toast").classList.contains("err") && document.querySelector("#toast").classList.contains("show"))), String(pageReqs(b).length));
  const hint = await pop.evaluate(() => { const h = document.querySelector(".pg-foot"); return h && { text: h.textContent, color: getComputedStyle(h).color, size: getComputedStyle(h).fontSize }; });
  ok("…the muted hint: some businesses couldn't be read, pages only in them may be missing", hint?.text === "Some businesses couldn't be read, so pages that are only in them may be missing" && hint.color === "rgb(96, 103, 112)" && hint.size === "12px", JSON.stringify(hint));
  ok("…the hint survives a reopen (kept with the cache) and is in RU too", await (async () => { pop = await popup(b); await pop.waitForTimeout(500); await pop.click('[data-lang="ru"]'); return has(await text(pop, ".pg-foot"), "Часть бизнесов не удалось прочитать"); })());
  await pop.click('[data-lang="en"]');
  b.graph = mock(FULL);
  await resetLocks(pop); await pop.click("#loadPages");
  ok("a later refresh where every edge works: all nine pages, the hint is gone", (await rowsAre(pop, ".lrow", 9)) && (await pop.locator(".pg-foot").count()) === 0);
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();

  // 2. me/businesses itself cannot be read: only the profile's own pages, no edge is asked for, the hint is shown
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, bmsError: permission(10) }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("businesses unreadable: the profile's own pages only, no edge request, the hint is shown", (await rowsAre(pop, ".lrow", 6)) && edgeReqs(b).length === 0 && pageReqs(b).length === 2 && has(await text(pop, ".pg-foot"), "Some businesses couldn't be read"), pageReqs(b).map(pathOf).join());
  ok("…the chips count only the profile's own verdicts (no page is 'No access' just because a business could not be read)", (await chips(pop)).join() === "No access 1,Unpublished 2,Can't advertise 2,No Instagram 2", (await chips(pop)).join());
  await b.ctx.close();

  // 3. no businesses: no edge, no hint
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, bms: [] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("no businesses: two requests (profile list, businesses), no edge, no hint", (await rowsAre(pop, ".lrow", 6)) && pageReqs(b).map(pathOf).join() === "/me/accounts,/me/businesses" && (await pop.locator(".pg-foot").count()) === 0, pageReqs(b).map(pathOf).join());
  await b.ctx.close();

  // 4. ids that are not digits are never asked for; a business listed twice is read once; more than 50 businesses: only 50 are read
  const odd = [{ id: "12ab", name: "bad" }, { id: "../x", name: "bad" }, { name: "no id" }, null, { id: "555", name: "Nova Media" }, { id: "555", name: "again" }, { id: "9".repeat(26), name: "too long" }];
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, bms: odd }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("business ids that are not digits are skipped, a duplicate is read once: only /555/owned_pages and /555/client_pages", (await rowsAre(pop, ".lrow", 8)) && edgeReqs(b).map(pathOf).join() === "/555/owned_pages,/555/client_pages", edgeReqs(b).map(pathOf).join());
  await b.ctx.close();
  const many = Array.from({ length: 55 }, (_, i) => ({ id: String(3000 + i), name: `B${i}` }));
  b = await boot({ fb: adsFb(TOK), graph: mock({ rows: PAGES, bms: many }) });
  await adsPage(b);
  pop = await openPages(b);
  await until(pop, () => document.querySelectorAll(".lrow").length === 6 && /Not all pages/.test(document.querySelector("#pagesTotal").textContent), null, 40000);
  ok("55 businesses: only the first 50 are read (100 edge requests), and the list says it is not complete", edgeReqs(b).length === 100 && !edgeReqs(b).some((h) => /^\/30(5\d)\//.test(h)) && (await text(pop, "#pagesTotal")) === "Not all pages are shown", `${edgeReqs(b).length} / ${await text(pop, "#pagesTotal")}`);
  ok("…the slot still covers all 102 requests: a click sends nothing", await (async () => { const n = pageReqs(b).length; await clickToast(pop, "#loadPages"); return n === 102 && pageReqs(b).length === 102; })());
  await b.ctx.close();

  // 5. a field refused on an edge: only that edge's read drops it and asks again; the profile's own list is not touched; the rows say what was not read
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuseEdge: [{ when: (bm, edge, top) => top.includes("promotion_ineligible_reason"), error: complaint("promotion_ineligible_reason") }] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("a field refused on the edges: the first edge asks again without it, the list still has nine pages", (await rowsAre(pop, ".lrow", 9)) && edgeReqs(b).length === 5, String(edgeReqs(b).length));
  const eh = edgeReqs(b).map(fieldsOf);
  ok("…the refusal is learned once for the whole walk (one skip set across the edges): the first request had the field, the retry and every later edge did not; the profile's own read is untouched",
    eh.filter((f) => has(f, "promotion_ineligible_reason")).length === 1 && has(eh[0], "promotion_ineligible_reason") && eh.slice(1).every((f) => !has(f, "promotion_ineligible_reason"))
    && has(fieldsOf(reqs(b)[0]), "promotion_ineligible_reason") && reqs(b).length === 1, eh.join(" || "));
  const stk = await stored(pop, "pages");
  ok("…the rows read through the edges record the refusal (_skip), the profile's own rows do not", stk.filter((r) => r._viaBm).every((r) => r._skip?.join() === "promotion_ineligible_reason") && stk.filter((r) => !r._viaBm).every((r) => !r._skip), JSON.stringify(stk.map((r) => [r.name, r._skip])));
  await b.ctx.close();

  // 6. an edge whose refusal names none of our fields (a nested one, here): it is skipped, not retried; the other edges and the profile's own list are untouched
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuseEdge: [{ when: (bm, edge, top, f) => bm === "777" && edge === "owned_pages" && f.includes("username"), error: complaint("username") }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, ".lrow", 8);
  ok("a complaint on one edge that readPaged cannot pin on an optional field: that edge is asked once and skipped (4 edge requests), Wingtip is missing, the hint is shown", edgeReqs(b).length === 4 && reqs(b).length === 1 && !(await names(pop)).includes("Wingtip Gadgets")
    && has(await text(pop, ".pg-foot"), "couldn't be read"), edgeReqs(b).map(pathOf).join());
  await b.ctx.close();

  // 7. rate limit on an edge: the reading stops (nothing more would go out), what was read is shown, the hint says some may be missing
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuseEdge: [{ when: (bm, edge) => bm === "555" && edge === "owned_pages", error: { code: 4, message: "(#4) Application request limit reached" } }] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("throttled on the first edge: the list shows the profile's own pages and the hint; the remaining edges are not asked for", (await rowsAre(pop, ".lrow", 6)) && pageReqs(b).map(pathOf).join() === "/me/accounts,/me/businesses,/555/owned_pages" && has(await text(pop, ".pg-foot"), "couldn't be read"), pageReqs(b).map(pathOf).join());
  await b.ctx.close();
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
  ok("two refusals → three requests for the profile's list, the list still loads (and the businesses are read once)", (await rowsAre(pop, ".lrow", 9)) && reqs(b).length === 3 && edgeReqs(b).length === 4, `${reqs(b).length} / ${edgeReqs(b).length}`);
  const [, second, third] = reqs(b).map(fieldsOf);
  ok("each retry drops only the field Graph named", has(second, "tasks") && !has(second, "promotion_ineligible_reason") && has(third, "is_published") && !has(third, "tasks") && !has(third, "promotion_ineligible_reason"), `${second} || ${third}`);
  ok("tasks unknown → the profile's own pages are no longer 'No access' (no verdict), but the pages seen only through a business still are", (await chips(pop)).join() === "No access 3,Unpublished 3,Can't advertise 2,No Instagram 3" && (await rowOf(pop, ids.hidden)).status.text === "Unpublished" && (await rowOf(pop, ids.harbor)).status.text === "No access", (await chips(pop)).join());
  ok("…the business edges were asked with the refused fields already dropped (they start from what this token cannot read)", edgeReqs(b).every((h) => !has(fieldsOf(h), "promotion_ineligible_reason")), edgeReqs(b).map(fieldsOf).join(" || "));
  ok("what was read is still there (Instagram, can't advertise, unpublished)", (await rowOf(pop, ids.orion)).status.text === "Can't advertise" && (await rowOf(pop, ids.nova)).value === "@nova.travel");
  ok("the refusal is stored with each of the profile's rows, not as a guess", JSON.stringify((await stored(pop, "pages")).find((r) => r.id === ids.nova)).includes('"_skip":["promotion_ineligible_reason","tasks"]'), JSON.stringify((await stored(pop, "pages")).find((r) => r.id === ids.nova)));
  await resetLocks(pop); await pop.click("#loadPages");
  await waitReqs(pop, b, 4);
  ok("a refresh does not ask for the refused fields again (one request for the profile's list)", reqs(b).length === 4 && !has(fieldsOf(reqs(b)[3]), "tasks"), `${reqs(b).length} ${fieldsOf(reqs(b).at(-1))}`);
  await b.ctx.close();

  // 2. both real-Instagram fields refused: Instagram is UNKNOWN, never 'No Instagram'
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [
    { when: (top) => top.includes("instagram_business_account"), error: complaint("instagram_business_account") },
    { when: (top) => top.includes("connected_instagram_account"), error: complaint("connected_instagram_account") }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, ".lrow", 9);
  ok("Instagram refused: no row says 'No Instagram' for the profile's pages, no handle on them, and the body says 'Unknown'", (await rowOf(pop, ids.fresh)).status === null && (await rowOf(pop, ids.nova)).value === null && !(await chips(pop)).some((c) => c.startsWith("No Instagram")), (await chips(pop)).join());
  await openRow(pop, ids.nova);
  ok("…the Instagram line says Unknown, with the reason as tooltip", (await bodyOf(pop, ids.nova)).kv[0].join("=") === "Instagram=Unknown" && has(await pop.locator(`.lrow[data-row="${ids.nova}"] .lrow-pair dd`).first().getAttribute("title"), "did not return the Instagram fields"));
  ok("…the page-backed account that WAS read still counts", (await rowOf(pop, ids.backed)).ctx[0]?.text === "IG via page");
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();

  // 3. Graph blames a field INSIDE an expression (username): the real-Instagram fields go, the rest stays
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: (top, f) => f.includes("username"), error: complaint("username") }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, ".lrow", 9);
  const last = fieldsOf(reqs(b).at(-1));
  ok("nested complaint: two requests, the second without the real-Instagram fields but with the rest", reqs(b).length === 2 && !has(last, "instagram_business_account") && !has(last, "connected_instagram_account")
    && has(last, "connected_page_backed_instagram_account{id}") && has(last, "tasks") && has(last, "business{id,name}"), reqs(b).map(fieldsOf).join(" || "));
  ok("…Instagram of a page without PBIA is unknown, the page-backed one still counts", (await rowOf(pop, ids.nova)).value === null && (await rowOf(pop, ids.backed)).ctx[0]?.text === "IG via page");
  await b.ctx.close();

  // 4. a 100 that names no field, whatever is asked beyond id and name: business goes first, then Instagram, then the rest
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: (top) => top.length > 2, error: { code: 100, message: "(#100) Invalid parameter" } }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, ".lrow", 9);
  const seq = reqs(b).map(fieldsOf);
  ok("an unnamed 100 → four requests: all, without business, without the Instagram fields, id and name only", seq.length === 4
    && has(seq[0], "business{id,name}") && !has(seq[1], "business{") && has(seq[1], "instagram_business_account") && !has(seq[2], "instagram") && has(seq[2], "tasks") && seq[3] === "id,name", seq.join(" || "));
  ok("…no profile page has a problem word (nothing was read): only the pages seen through businesses say 'No access'", (await chips(pop)).join() === "No access 3", (await chips(pop)).join());
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();

  // 5. only `business` needs a permission the token lacks (business_management): everything else survives
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: (top) => top.includes("business"), error: permission(200) }] }) });
  await adsPage(b);
  pop = await openPages(b);
  await rowsAre(pop, ".lrow", 9);
  const seq5 = reqs(b).map(fieldsOf);
  ok("business refused with a permission error → two requests, the second without business only", seq5.length === 2 && !has(seq5[1], "business{") && has(seq5[1], "instagram_business_account") && has(seq5[1], "tasks"), seq5.join(" || "));
  await openRow(pop, ids.nova);
  ok("…Instagram, ad rights are all there, only the owner business is missing", (await rowOf(pop, ids.nova)).value === "@nova.travel" && (await bodyOf(pop, ids.nova)).kv.map((x) => x[0]).join() === "Instagram,Your access"
    && (await bodyOf(pop, ids.nova)).links.map((l) => l.text).join() === "Page,Business Suite", JSON.stringify(await bodyOf(pop, ids.nova)));
  await b.ctx.close();
}

// ---------- errors: permission, other, dead session, API pause ----------
async function errorsFlow() {
  console.log("\n# pages: permission errors, other errors, dead session, API pause");
  const calm = (p) => p.evaluate(() => ({ list: document.querySelector("#pagesList").textContent.trim(), rows: document.querySelectorAll(".lrow").length, errToast: document.querySelector("#toast").classList.contains("err") && document.querySelector("#toast").classList.contains("show"),
    busy: document.querySelector("#loadPages").getAttribute("aria-busy"), disabled: document.querySelector("#loadPages").disabled }));
  // 1–3. the token cannot read pages at all: a calm line, not a crash, not a red toast; the businesses are not even asked for
  for (const [label, error] of [["code 10", permission(10)], ["code 200", permission(200)], ["code 283", permission(283)], ["code 100 that names no field", { code: 100, message: "(#100) Unsupported get request. Object with ID 'me' does not exist, cannot be loaded due to missing permissions" }]]) {
    const b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: () => true, error }] }) });
    await adsPage(b);
    const pop = await openPages(b);
    await until(pop, () => /can't read the list/.test(document.querySelector("#pagesList").textContent));
    const s = await calm(pop);
    ok(`${label}: a calm message in the list, no rows, no red toast`, has(s.list, "This token can't read the list — open Ads Manager or Business Manager, refresh the token (the refresh button on the Token tab) and try again.") && s.rows === 0 && !s.errToast, JSON.stringify(s));
    ok(`${label}: four requests (all fields, without business, without Instagram, id and name), nothing about businesses, the button is free again`, reqs(b).length === 4 && !has(fieldsOf(reqs(b)[1]), "business{") && fieldsOf(reqs(b)[3]) === "id,name" && pageReqs(b).length === 4 && s.busy === null && !s.disabled, reqs(b).map(fieldsOf).join(" || "));
    ok(`${label}: nothing is cached`, (await stored(pop, "pages")) === undefined && (await stored(pop, "pagesAt")) === undefined);
    await resetLocks(pop); await pop.click("#loadPages");
    await waitReqs(pop, b, 5);
    ok(`${label}: the next try is one request (the optional fields are given up for this token)`, reqs(b).length === 5 && fieldsOf(reqs(b)[4]) === "id,name", String(reqs(b).length));
    ok(`${label}: no console errors`, b.errs.length === 0, b.errs.join(" | "));
    if (label === "code 10") {
      // the message is in both languages and goes away when a later load works
      await pop.click('[data-lang="ru"]');
      ok("RU: the same calm message", has(await text(pop, "#pagesList"), "Этим токеном список не прочитать — открой Ads Manager или Business Manager, обнови токен (кнопка обновления на вкладке «Токен») и повтори."), await text(pop, "#pagesList"));
      await pop.click('[data-lang="en"]');
      b.graph = mock(FULL);
      await resetLocks(pop); await pop.click("#loadPages");
      ok("a later load that works replaces the message with the rows", await rowsAre(pop, ".lrow", 9) && !has(await text(pop, "#pagesList"), "can't read the list"));
    }
    await b.ctx.close();
  }
  // 4. only the optional fields are the problem: the list still comes (from id and name), Instagram is unknown, no message
  let b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: (top) => top.length > 2, error: permission(10) }] }) });
  await adsPage(b);
  let pop = await openPages(b);
  ok("a permission error caused by the extra fields: the list loads from id and name, no message", (await rowsAre(pop, ".lrow", 9)) && !has(await text(pop, "#pagesList"), "can't read the list") && reqs(b).length === 4, String(reqs(b).length));
  await b.ctx.close();

  // 5. any other error: a red toast, the list says it is not loaded, no retry by going back to the tab
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: () => true, error: { code: 1, message: "boom" } }] }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("other error: shown once", await until(pop, () => /boom/.test(document.querySelector("#toast").textContent)) && reqs(b).length === 1, await toastOf(pop));
  ok("…the list says it could not load, with Graph's words muted under it and a 'Try again' button — not the calm permission text", (await text(pop, "#pagesList .lempty-text")) === "Couldn't load" && (await text(pop, "#pagesList .lempty-detail")) === "Graph says: boom"
    && (await text(pop, "#pagesList .lempty .btn")) === "Try again" && !has(await text(pop, "#pagesList"), "can't read the list"), await text(pop, "#pagesList"));
  await pop.click('[data-tab="token"]'); await resetLocks(pop); await pop.click('[data-tab="pages"]'); await pop.waitForTimeout(700);
  ok("…and not retried by going back to the tab", reqs(b).length === 1, String(reqs(b).length));
  await b.ctx.close();

  // 6. dead session: reported, remembered, nothing more is sent
  b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, refuse: [{ when: () => true, error: { code: 190, error_subcode: 463, message: "Error validating access token: Session has expired" } }] }) });
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
  b = await boot({ fb: adsFb(TOK), graph: mock(FULL) });
  await adsPage(b);
  pop = await popup(b);
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: Date.now() + 10 * 60000 }));
  await pop.reload(); await pop.waitForTimeout(500);
  await pop.click('[data-tab="pages"]'); await pop.waitForTimeout(800);
  ok("API pause: no automatic request, the list explains itself", pageReqs(b).length === 0 && (await text(pop, "#pagesList .lempty-text")) === "Not loaded yet" && (await text(pop, "#pagesList .lempty .btn")) === "Load", String(pageReqs(b).length));
  const paused = await clickToast(pop, "#loadPages");
  ok("API pause: a click says so and sends nothing", has(paused, "hands off") && pageReqs(b).length === 0, `${paused} / ${pageReqs(b).length}`);
  await pop.evaluate(() => chrome.storage.session.set({ cooldownUntil: 0 }));
  await pop.waitForTimeout(300); await pop.click("#loadPages");
  ok("…the pause is over: the next click loads at once (the slot was not used up)", await rowsAre(pop, ".lrow", 9) && reqs(b).length === 1, String(reqs(b).length));
  await b.ctx.close();

  // 8. no token anywhere: nothing sent, the empty state says what to do
  b = await boot({ fb: () => "<p>feed</p>", graph: mock(FULL) });
  await (await b.ctx.newPage()).goto("https://www.facebook.com/");
  pop = await popup(b, "pages"); await pop.waitForTimeout(700);
  ok("no token: no request, the list tells you which button to press, no toast", pageReqs(b).length === 0 && (await text(pop, "#pagesList .lempty-text")) === (await text(pop, "#tokenBox")) && (await text(pop, "#pagesList .lempty .btn")) === "Try again" && (await toastOf(pop)) === "", await text(pop, "#pagesList"));
  await b.ctx.close();

  // 9. a slow load says "Loading", a click meanwhile does nothing
  b = await boot({ fb: adsFb(TOK), graph: (u) => ({ delay: 300, ...mock(FULL)(u) }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("while loading the list says so", await until(pop, () => /Loading pages/.test(document.querySelector("#pagesList").textContent)), await text(pop, "#pagesList"));
  await pop.click("#loadPages", { force: true }).catch(() => {});
  await pop.waitForTimeout(300);
  ok("a click during the load neither complains nor doubles the request", !has(await toastOf(pop), "Refresh available") && reqs(b).length === 1, `${await toastOf(pop)} / ${reqs(b).length}`);
  ok("…then the rows (after all six slow requests)", await until(pop, () => document.querySelectorAll(".lrow").length === 9, null, 15000) && pageReqs(b).length === 6, String(pageReqs(b).length));
  await b.ctx.close();

  // 10. a page that Graph returns oddly: no console error, rows without an id are not pages
  const oddRows = [{ id: "100000000000009", name: "<img src=x onerror=alert(1)>" }, { name: "no id" }, null, { id: "12ab", name: "bad id" }, { id: "100000000000009", name: "dup" }];
  b = await boot({ fb: adsFb(TOK), graph: (u) => (/\/me\/accounts$/.test(u.pathname) ? { body: { data: oddRows } } : mock({ rows: [] })(u)) });
  await adsPage(b);
  pop = await openPages(b);
  ok("odd rows: one page survives, shown as text (no markup), no console errors", (await rowsAre(pop, ".lrow", 1)) && (await pop.locator(".lrow img").count()) === 0 && (await text(pop, ".lrow .lrow-name")) === "<img src=x onerror=alert(1)>" && b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();

  // 11. an empty profile
  b = await boot({ fb: adsFb(TOK), graph: () => ({ body: { data: [] } }) });
  await adsPage(b);
  pop = await openPages(b);
  ok("no pages: says so, no hint (nothing failed), the count line is empty", await until(pop, () => /No pages/.test(document.querySelector("#pagesList").textContent)) && (await pop.locator(".pg-foot").count()) === 0 && (await text(pop, "#pagesTotal")) === "", await text(pop, "#pagesList"));
  await b.ctx.close();
}

// ---------- a Page access token must never be kept ----------
async function tokenFlow() {
  console.log("\n# pages: no Page access token (profile list AND business edges)");
  const methods = [];
  const b = await boot({ fb: adsFb(TOK), graph: mock({ ...FULL, leak: true }) });
  b.ctx.on("request", (r) => { if (r.url().startsWith(GRAPH)) methods.push(r.method()); });
  await adsPage(b);
  let pop = await openPages(b);
  ok("rows load although Graph sent an access_token with every row of every list", await rowsAre(pop, ".lrow", 9));
  await openRow(pop, ids.harbor); await openRow(pop, ids.nova);
  let dump = await everything(pop);
  ok("the Page token is not in chrome.storage.session, chrome.storage.local, localStorage or the DOM (rows of me/accounts and of the edges alike, bodies open)", !dump.includes("SECRET") && !dump.includes("access_token"), dump.length > 0 ? "found" : "");
  const saved = await stored(pop, "pages");
  const KEYS = ["id", "name", "is_published", "tasks", "connected_page_backed_instagram_account", "instagram_business_account", "connected_instagram_account", "promotion_eligible", "promotion_ineligible_reason", "picture", "business", "_skip", "_viaBm"];
  ok("stored rows hold whitelisted keys only", saved.length === 9 && saved.every((r) => Object.keys(r).every((k) => KEYS.includes(k))), JSON.stringify(saved[0]));
  ok("…business edge rows carry no tasks and a digits-only _viaBm; the profile's own rows have tasks and no _viaBm", saved.filter((r) => r._viaBm).length === 3 && saved.filter((r) => r._viaBm).every((r) => !r.tasks && /^\d+$/.test(r._viaBm)) && saved.filter((r) => !r._viaBm).length === 6 && saved.filter((r) => !r._viaBm).every((r) => Array.isArray(r.tasks)),
    JSON.stringify(saved.map((r) => [r.name, r._viaBm, !!r.tasks])));
  ok("…the picture is kept as its URL string only, and only the one on fbcdn.net (the evil.example.com one is gone)", saved.filter((r) => r.picture).map((r) => `${r.name}=${r.picture}`).join("|") === `Nova Travel Blog=${PIC}|Hidden Page=https://scontent.xx.fbcdn.net/v/t39.30808-1/broken_50.jpg`, JSON.stringify(saved.map((r) => r.picture)));
  ok("…the legitimate nested fields beside it are kept (owner business, in the body)", (await bodyOf(pop, ids.nova)).kv.some((x) => x.join("=") === "Business=Nova Media"));
  pop = await popup(b); await pop.waitForTimeout(500);
  dump = await everything(pop);
  ok("after a reopen (rows from the cache): still nowhere", (await rowsAre(pop, ".lrow", 9)) && !dump.includes("SECRET"));
  ok("every request of the refresh is a GET and none names access_token (me/accounts, me/businesses, the four edges)", pageReqs(b).length === 6 && pageReqs(b).every((h) => !/access_token/.test(decodeURIComponent(h))) && methods.length > 0 && methods.every((m) => m === "GET"), `${methods.join()} | ${pageReqs(b).join(" ")}`);
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- cache per FB user, other windows, the slot ----------
async function cacheFlow() {
  console.log("\n# pages: cache per FB user, other windows, own rate slot");
  const cfg = { ...FULL };
  const b = await boot({ fb: adsFb(TOK), graph: mock(cfg) });
  const fb = await adsPage(b);
  let pop = await openPages(b);
  ok("pages loaded", await rowsAre(pop, ".lrow", 9));
  ok("the cache is in storage.session next to the owner", (await stored(pop, "pages")).length === 9 && !!(await stored(pop, "pagesAt")) && (await stored(pop, "pagesTruncated")) === false && (await stored(pop, "pagesBizFail")) === false && (await stored(pop, "owner")) === "1001");
  pop = await popup(b);
  ok("reopen keeps the rows", await rowsAre(pop, ".lrow", 9));
  await fb.close(); pop = await popup(b);
  ok("no FB tab: the token is gone", await boxWait(pop, GONE), await text(pop, "#tokenBox"));
  ok("no FB tab: the cache stays", await rowsAre(pop, ".lrow", 9));
  const before = pageReqs(b).length;
  await resetLocks(pop); await clickToast(pop, "#loadPages");
  ok("refresh without a token sends nothing", pageReqs(b).length === before);
  await b.ctx.addCookies([{ name: "c_user", value: "2002", domain: ".facebook.com", path: "/", secure: true }]);
  pop = await popup(b);
  ok("another FB user → the cache is dropped, no rows", (await rowsAre(pop, ".lrow", 0)) && (await until(pop, () => chrome.storage.session.get("pages").then((o) => !o.pages))));
  ok("…and the list is empty, not someone else's pages", (await pop.locator("#pagesList .lrow").count()) === 0 && (await pop.locator("#pagesList .lempty, #pagesList .lsk-list").count()) === 1, await text(pop, "#pagesList"));
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();

  // another window of the extension: its load shows up here without doing anything
  const rows = PAGES.slice(0, 3).map((r) => ({ ...r }));
  const b2 = await boot({ fb: adsFb(TOK), graph: mock({ rows, bms: [] }) });
  await adsPage(b2);
  const one = await openPages(b2);
  ok("window 1 loaded 3 pages", await rowsAre(one, ".lrow", 3));
  rows.push({ ...PAGES[3] });
  const two = await popup(b2);
  ok("window 2 opens on the cached list, no request", (await rowsAre(two, ".lrow", 3)) && reqs(b2).length === 1);
  await resetLocks(two); await two.click("#loadPages");
  ok("window 2 refreshes: 4 pages", await rowsAre(two, ".lrow", 4));
  ok("window 1 follows by itself", await rowsAre(one, ".lrow", 4));
  ok("…with one request for the profile's list in the refresh", reqs(b2).length === 2, String(reqs(b2).length));
  await b2.ctx.close();

  // the Pages slot is its own: the Ad accounts list in the same minute does not eat it (and vice versa)
  const b3 = await boot({ fb: adsFb(TOK), graph: mock(FULL) });
  await adsPage(b3);
  const p3 = await popup(b3, "accounts");
  ok("Ad accounts auto-load took its slot", await rowsAre(p3, "#accountsList .lrow", 1));
  await p3.click('[data-tab="pages"]');
  ok("…the Pages auto-load still goes out (own slot)", await rowsAre(p3, "#pagesList .lrow", 9) && reqs(b3).length === 1);
  const slots = (await stored(p3, "locks")).slots;
  ok("both slots are held, under their own keys", !!slots.accounts && !!slots.pages && slots.pages - Date.now() <= 60000, JSON.stringify(slots));
  ok("no console errors", b3.errs.length === 0, b3.errs.join(" | "));
  await b3.ctx.close();
}

// ---------- the row: pictures, fix links, layout ----------
async function rowsFlow() {
  console.log("\n# pages: picture or placeholder, links, keyboard, layout");
  const asked = [];                                                // every request the browser makes, with the Referer it sent
  const b = await boot({ fb: adsFb(TOK), graph: mock(FULL) });
  b.ctx.on("request", (r) => asked.push({ url: r.url(), referer: r.headers().referer }));
  await adsPage(b);
  const pop = await openPages(b);
  ok("rows", await rowsAre(pop, ".lrow", 9));
  const av = (id) => pop.evaluate((pid) => {
    const box = document.querySelector(`.lrow[data-row="${pid}"] .lav`), img = box.querySelector("img"), icon = box.querySelector(".i"), cs = getComputedStyle(box);
    return { cls: box.className, ariaHidden: box.getAttribute("aria-hidden"), w: box.offsetWidth, h: box.offsetHeight, radius: cs.borderRadius, color: cs.color, bg: cs.backgroundColor,
      img: img && { src: img.getAttribute("src"), rp: img.getAttribute("referrerpolicy"), loading: img.getAttribute("loading"), decoding: img.getAttribute("decoding"), alt: img.getAttribute("alt"),
        w: img.getAttribute("width"), h: img.getAttribute("height"), natural: img.naturalWidth },
      icon: icon && { cls: icon.className, visible: getComputedStyle(icon).visibility, mask: getComputedStyle(icon).maskImage || getComputedStyle(icon).webkitMaskImage } };
  }, id);
  await until(pop, (pid) => !!document.querySelector(`.lrow[data-row="${pid}"] .lav.ok`), ids.nova);
  const nova = await av(ids.nova);
  ok("Nova: a picture URL on fbcdn.net renders an <img> in a 24 px circle", !!nova.img && nova.img.src === PIC && nova.w === 24 && nova.h === 24 && /lav-circle/.test(nova.cls) && parseFloat(nova.radius) >= 12, JSON.stringify(nova));
  ok("…decorative (alt empty, aria-hidden), no referrer, lazy, async, width and height set", nova.img.alt === "" && nova.ariaHidden === "true" && nova.img.rp === "no-referrer" && nova.img.loading === "lazy" && nova.img.decoding === "async" && nova.img.w === "24" && nova.img.h === "24", JSON.stringify(nova.img));
  ok("…it did load (the placeholder icon is hidden behind it)", nova.img.natural > 0 && /\bok\b/.test(nova.cls) && nova.icon.visible === "hidden", JSON.stringify(nova));
  const req = asked.find((r) => r.url === PIC);
  ok("…and the request for it carried no Referer", !!req && req.referer === undefined, JSON.stringify(req));
  const backed = await av(ids.backed);
  ok("Backed: no picture field → the Lucide flag on a muted 24 px circle, in the secondary text colour, no <img>", !backed.img && backed.icon?.cls === "i i-flag" && backed.icon.visible === "visible" && has(backed.icon.mask, "flag.svg")
    && backed.w === 24 && backed.h === 24 && backed.color === "rgb(96, 103, 112)" && backed.bg === "rgb(240, 242, 245)" && parseFloat(backed.radius) >= 12, JSON.stringify(backed));
  const fresh = await av(ids.fresh);
  ok("Fresh: a picture URL on another host is never kept: placeholder, no <img>, no request to that host", !fresh.img && fresh.icon?.cls === "i i-flag" && !asked.some((r) => /evil\.example\.com/.test(r.url)), JSON.stringify(fresh));
  ok("Hidden: a picture that fails to load (404) falls back to the placeholder, the broken <img> is gone", await until(pop, (pid) => { const box = document.querySelector(`.lrow[data-row="${pid}"] .lav`); return !!box && !box.querySelector("img") && !box.classList.contains("ok"); }, ids.hidden)
    && b.images.some((x) => /broken_50/.test(x)) && (await av(ids.hidden)).icon?.visible === "visible", JSON.stringify(await av(ids.hidden)));
  const failed = b.images.filter((x) => /broken_50/.test(x)).length;
  await pop.fill("#pageFilter", "page"); await pop.fill("#pageFilter", "");
  await rowsAre(pop, ".lrow", 9); await pop.waitForTimeout(300);
  ok("a redraw (search typed and cleared) does not ask again for a picture that failed, and keeps the one that loaded", b.images.filter((x) => /broken_50/.test(x)).length === failed && (await av(ids.nova)).img?.src === PIC && !(await av(ids.hidden)).img, String(failed));
  ok("no <img> in the list is ever visible without having loaded (no broken-image icon can show)", await pop.evaluate(() => [...document.querySelectorAll(".lav img")].every((i) => i.closest(".lav").classList.contains("ok") ? i.naturalWidth > 0 : getComputedStyle(i).opacity === "0")));

  // keyboard: the name is the one button of a row
  await pop.focus(`[data-focus="row:${ids.hidden}"]`); await pop.keyboard.press("Enter");
  ok("keyboard: Enter on the name opens the row (aria-expanded), the body appears", (await rowOf(pop, ids.hidden)).open && !!(await bodyOf(pop, ids.hidden)));
  await pop.keyboard.press("Space");
  ok("…Space closes it", !(await rowOf(pop, ids.hidden)).open && (await bodyOf(pop, ids.hidden)) === null);
  await pop.click(`.lrow[data-row="${ids.hidden}"] .lrow-name`);
  ok("a click on the row opens it too", (await rowOf(pop, ids.hidden)).open);
  await pop.click(`.lrow[data-row="${ids.hidden}"] .lrow-head`, { position: { x: 300, y: 30 } });
  ok("…and a click anywhere on the row closes it", !(await rowOf(pop, ids.hidden)).open);

  // links: the right URL, a new tab, nothing sent, the row untouched, a keyboard key
  const hits0 = b.hits.length;
  const clickOpens = async (act) => {
    const [np] = await Promise.all([b.ctx.waitForEvent("page", { timeout: 8000 }), act()]);
    await np.waitForURL(/facebook\.com/, { timeout: 8000 }).catch(() => {});
    const url = np.url(); await np.close(); return url;
  };
  const fix = (id) => pop.locator(`.lrow[data-row="${id}"] [data-focus="rowfix:${id}"]`);
  ok("the fix on line 2 opens its URL in a new tab", (await clickOpens(() => fix(ids.orion).click())) === LINKS.accountQuality());
  ok("…the Instagram one opens the Ads Manager ads view", (await clickOpens(() => fix(ids.fresh).click())) === LINKS.adsManagerHome());
  ok("…Assign me opens the Pages settings of the business", (await clickOpens(() => fix(ids.harbor).click())) === LINKS.bmPages("555"));
  ok("…and Enter on the focused link does the same (keyboard)", (await clickOpens(async () => { await fix(ids.draft).focus(); await pop.keyboard.press("Enter"); })) === LINKS.pageSuite(ids.draft));
  ok("fix links never toggle the row (the row stays closed), and send nothing to Graph", !(await rowOf(pop, ids.orion)).open && !(await rowOf(pop, ids.draft)).open && b.hits.length === hits0, `${b.hits.length - hits0}`);
  await openRow(pop, ids.hidden); await openRow(pop, ids.nova);
  ok("a body link opens its URL (Portfolio → the Pages settings of the business)", (await clickOpens(() => pop.locator(`[data-focus="plink:${ids.nova}:bm"]`).click())) === LINKS.bmPages("555"));
  ok("a body fix opens its URL (Publish → Business Suite)", (await clickOpens(() => pop.locator(`[data-focus="pfix:${ids.hidden}:unpublished"]`).click())) === LINKS.pageSuite(ids.hidden));
  ok("…none of it sent a request, closed a row or changed the list", b.hits.length === hits0 && (await rowOf(pop, ids.hidden)).open && (await rowsAre(pop, ".lrow", 9)));
  await closeRow(pop, ids.hidden); await closeRow(pop, ids.nova);

  // layout: nothing sticks out at 560 and 380, in both languages, with the richest rows open
  for (const id of [ids.hidden, ids.client, ids.nova]) await openRow(pop, id);
  for (const lang of ["en", "ru"]) {
    await pop.click(`[data-lang="${lang}"]`);
    for (const w of [560, 380]) {
      await pop.setViewportSize({ width: w, height: 900 }); await pop.waitForTimeout(150);
      const m = await pop.evaluate(() => {
        const de = document.documentElement, r = (n) => n.getBoundingClientRect(), rows = [...document.querySelectorAll(".lrow")];
        return { sw: de.scrollWidth, cw: de.clientWidth, rowsOver: rows.filter((x) => x.scrollWidth > x.clientWidth + 0.5).length,
          outside: rows.flatMap((x) => [...x.querySelectorAll(".lrow-fix .act-label, .lrow-more, .lrow-value, .lrow-idc, .lav, .lrow-pair, .lrow-link, .lrow-todo")].filter((n) => r(n).width && (r(n).right > r(x).right - 15.5 || r(n).left < r(x).left + 15.5)).map((n) => n.className)),
          oneLine: rows.every((x) => r(x.querySelector(".lrow-sub") || x).height <= 22 || !x.querySelector(".lrow-sub")), cut: [...document.querySelectorAll(".lrow-fix .act-label")].filter((l) => l.scrollWidth > l.clientWidth).length,
          cutProb: [...document.querySelectorAll(".pg-prob-text")].filter((l) => l.scrollWidth > l.clientWidth).length, idHidden: [...document.querySelectorAll(".lrow-head .lrow-idc")].every((n) => getComputedStyle(n).display === "none") };
      });
      ok(`${lang} ${w}px: no horizontal scroll, no row wider than the window`, m.sw <= m.cw && m.rowsOver === 0, JSON.stringify(m));
      ok(`${lang} ${w}px: every link, word, picture and body part stays inside the row's 16 px gutters; line 2 is one line; no fix label and no problem word is cut`, m.outside.length === 0 && m.oneLine && m.cut === 0 && m.cutProb === 0, JSON.stringify(m));
      ok(`${lang} ${w}px: the ID is shown on the collapsed row from 480 px, hidden below`, w >= 480 ? !m.idHidden : m.idHidden, JSON.stringify(m));
    }
  }
  ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
  await b.ctx.close();
}

// ---------- "No access" is a verdict only when me/accounts was read completely ----------
async function verdictFlow() {
  console.log("\n# pages: no verdict about access when me/accounts was not read completely");
  const viaIds = [ids.harbor, ids.client, ids.wing];
  // complete: the three pages that are only in a business are "No access" (the existing flows check the details)
  let b = await boot({ fb: adsFb(TOK), graph: mock(FULL) });
  await adsPage(b);
  let pop = await openPages(b);
  ok("me/accounts complete: pages seen only through a business are 'No access' with a chip counting them (the three + Hidden Page, whose own task list has no Advertise)", (await rowsAre(pop, ".lrow", 9)) && (await chips(pop)).some((c) => /^No access 4$/.test(c)), (await chips(pop)).join());
  await b.ctx.close();

  for (const [label, cfg] of [["me/accounts is empty while the business edges have pages (the token cannot read it)", { ...FULL, rows: [] }],
    ["me/accounts is cut at its page limit (the page may be in the part that was not read)", { ...FULL, accountsNext: true }]]) {
    b = await boot({ fb: adsFb(TOK), graph: mock(cfg) });
    await adsPage(b);
    pop = await openPages(b);
    ok(`${label}: the pages are listed`, await until(pop, (n) => document.querySelectorAll(".lrow").length >= n, cfg.rows.length ? 9 : 3));
    const via = await Promise.all(viaIds.map((id) => rowOf(pop, id)));
    ok(`${label}: no 'No access', no 'Assign me' on a page seen only through a business (nothing is known about the person's access)`,
      via.every((r) => r && !/No access/.test(r.status?.text ?? "") && r.fix?.text !== "Assign me"), JSON.stringify(via.map((r) => r && [r.name, r.status, r.fix])));
    ok(`${label}: …and the 'No access' chip counts only a real verdict (${cfg.rows.length ? "Hidden Page, whose own task list has no Advertise" : "none"})`,
      cfg.rows.length ? (await chips(pop)).some((c) => /^No access 1$/.test(c)) : !(await chips(pop)).some((c) => /No access/.test(c)), (await chips(pop)).join());
    await pop.click(`.lrow[data-row="${ids.harbor}"] .lrow-title`);
    ok(`${label}: …the body says 'Via business', not 'not assigned'`, has(await text(pop, `.lrow[data-row="${ids.harbor}"] .lrow-body`), "Via business — assignment unknown") && !has(await text(pop, `.lrow[data-row="${ids.harbor}"] .lrow-body`), "not assigned"), await text(pop, `.lrow[data-row="${ids.harbor}"] .lrow-body`));
    ok(`${label}: …other problems of those pages still show (Client Fashion House is unpublished)`, (await chips(pop)).some((c) => /^Unpublished/.test(c)), (await chips(pop)).join());
    ok("no console errors", b.errs.length === 0, b.errs.join(" | "));
    await b.ctx.close();
  }
}

export const flows = { pagesVerdict: verdictFlow, pagesRows: rowsFlow, pages: pagesFlow, pagesBiz: bizFlow, pagesFields: fieldsFlow, pagesErrors: errorsFlow, pagesToken: tokenFlow, pagesCache: cacheFlow };
