// js/pages-model.js: the logic of the Pages tab (field lists, row whitelist, pages found through businesses, Instagram state, problems
// and their fixes, chips, search, order). Plain Node: the model has no DOM. Run: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import {
  OPTIONAL, BASE, BIZ_OPTIONAL, BIZ_EDGES, MAX_BUSINESSES, ROW_KEYS, PROBLEMS, isPermissionError, keysToDrop, slimPage, finishPages, businessList, viaBusiness,
  igOf, handleOf, adRightsOf, accessOf, humanTask, problemsOf, problemCounts, filterPages, sortPages, PRIORITY, FIXES, issuesOf,
} from "../fb-helper/js/pages-model.js";
import { LINKS } from "../fb-helper/js/links.js";
import { optionalFieldIn } from "../fb-helper/js/graph.js";
import { setLang, has } from "../fb-helper/js/i18n.js";

const PAGE_TOKEN = "EAAPageSECRET" + "q".repeat(50);
const complaint = (field) => ({ code: 100, raw: `(#100) Tried accessing nonexisting field (${field}) on node type (Page)` });

// ---------- no Page access token, ever ----------
test("fields: explicit, id + name + the optional ones, never an access token; no followers, likes, category or verification", () => {
  const fields = [...BASE, ...Object.values(OPTIONAL)].join(",");
  assert.ok(!/access_token/.test(fields), fields);
  assert.deepEqual(BASE, ["id", "name"]);
  for (const f of ["is_published", "tasks", "promotion_eligible", "promotion_ineligible_reason", "connected_page_backed_instagram_account{id}",
    "instagram_business_account{id,username}", "connected_instagram_account{id,username}", "picture{url}", "business{id,name}"]) assert.ok(Object.values(OPTIONAL).includes(f), f);
  for (const gone of ["category", "followers_count", "fan_count", "verification_status"]) assert.ok(!(gone in OPTIONAL), `${gone} is not asked for any more`);
});

test("business edges: owned_pages and client_pages, the same field list minus tasks, never an access token", () => {
  assert.deepEqual(BIZ_EDGES, ["owned_pages", "client_pages"]);
  assert.deepEqual(Object.keys(BIZ_OPTIONAL), Object.keys(OPTIONAL).filter((k) => k !== "tasks"), "same fields, same order, without tasks");
  assert.ok(!("tasks" in BIZ_OPTIONAL));
  assert.ok(!/access_token/.test([...BASE, ...Object.values(BIZ_OPTIONAL)].join(",")));
  assert.equal(MAX_BUSINESSES, 50);
});

test("slimPage: keeps the whitelist only; access_token (top level and nested) and unknown keys are dropped", () => {
  const raw = {
    id: "1001", name: "Nova", access_token: PAGE_TOKEN, category: "Travel", followers_count: 5, fan_count: 4, is_published: true,
    verification_status: "blue_verified", tasks: ["ADVERTISE", "MANAGE"], promotion_eligible: true, promotion_ineligible_reason: "none",
    connected_page_backed_instagram_account: { id: "9", access_token: PAGE_TOKEN, extra: 1 },
    instagram_business_account: { id: "17", username: "@nova", access_token: PAGE_TOKEN, followers_count: 99 },
    connected_instagram_account: { id: "18", username: "nova2" },
    business: { id: "555", name: "Nova Media", access_token: PAGE_TOKEN, verification_status: "x" },
    category_list: [{ id: "1" }], cover: { source: "https://x" }, picture: { data: { url: "https://scontent.xx.fbcdn.net/v/t39.30808-1/a.jpg", height: 50, width: 50, is_silhouette: false }, access_token: PAGE_TOKEN }, link: "https://x",
    _skip: ["hacked"], _viaBm: "999",
  };
  const row = slimPage(raw);
  assert.ok(!JSON.stringify(row).includes("SECRET") && !JSON.stringify(row).includes("access_token"), JSON.stringify(row));
  assert.ok(Object.keys(row).every((k) => ROW_KEYS.includes(k)), Object.keys(row).join());
  for (const k of ["category", "followers_count", "fan_count", "verification_status"]) assert.equal(k in row, false, `${k} is not kept`);
  assert.deepEqual(row.connected_page_backed_instagram_account, { id: "9" });
  assert.deepEqual(row.instagram_business_account, { id: "17", username: "nova" }, "nested keys cut to id + username, @ stripped");
  assert.deepEqual(row.business, { id: "555", name: "Nova Media" });
  assert.equal(row.picture, "https://scontent.xx.fbcdn.net/v/t39.30808-1/a.jpg", "only the URL string of the picture is kept");
  assert.equal(row._skip, undefined, "the skip list comes from the caller, not from Graph");
  assert.equal(row._viaBm, undefined, "a business marker never comes from Graph either");
  assert.equal(row.category_list, undefined);
  assert.deepEqual(slimPage({ id: "7", name: "Only id and name", access_token: PAGE_TOKEN }), { id: "7", name: "Only id and name" });
});

test("slimPage: values of the wrong type are dropped, text is cleaned, a row without a numeric id is not a page", () => {
  const row = slimPage({ id: 42, name: "A\nB\u0000C", category: 5, followers_count: "12", fan_count: -1, is_published: "yes", tasks: ["ADVERTISE", 3, null],
    promotion_eligible: 1, business: { id: "x1", name: "bad id" }, instagram_business_account: { id: "oops" }, connected_instagram_account: "str" });
  assert.deepEqual(row, { id: "42", name: "A B C", tasks: ["ADVERTISE"] });
  for (const bad of [null, undefined, "x", 5, {}, { id: "" }, { id: "12a" }, { id: "../x" }, { id: "1".repeat(26) }, { name: "no id" }]) assert.equal(slimPage(bad), null, JSON.stringify(bad));
  assert.equal(slimPage({ id: "1" }).name, "", "a missing name is an empty string, the screen says 'Unnamed'");
  assert.equal(slimPage({ id: "1", name: "x".repeat(500) }).name.length, 200);
  assert.deepEqual(slimPage({ id: "1", instagram_business_account: { id: "5" } }).instagram_business_account, { id: "5" }, "no username is fine");
});

test("slimPage: a picture is kept only as an https URL on facebook.com / fbcdn.net; anything else leaves the row without one", () => {
  const url = (picture) => slimPage({ id: "1", name: "A", picture }).picture;
  assert.equal(url({ data: { url: "https://scontent.xx.fbcdn.net/a.jpg" } }), "https://scontent.xx.fbcdn.net/a.jpg");
  assert.equal(url({ url: "https://www.facebook.com/a.jpg" }), "https://www.facebook.com/a.jpg", "also without the data wrapper");
  for (const bad of [{ data: { url: "http://scontent.xx.fbcdn.net/a.jpg" } }, { data: { url: "https://evil.example.com/a.png" } }, { data: { url: "https://fbcdn.net.evil.com/a.png" } },
    { data: { url: "javascript:alert(1)" } }, { data: { url: "data:image/png;base64,AAAA" } }, { data: { url: 5 } }, { data: {} }, { data: null }, "https://scontent.xx.fbcdn.net/a.jpg", [], null, 7])
    assert.equal("picture" in slimPage({ id: "1", name: "A", picture: bad }), false, JSON.stringify(bad));
  assert.ok(!("picture" in slimPage({ id: "1" })), "no field, no key");
});

test("slimPage: _skip records only the optional fields that were not asked for", () => {
  assert.deepEqual(slimPage({ id: "1" }, ["tasks", "tasks", "bogus"])._skip, ["tasks"]);
  assert.equal("_skip" in slimPage({ id: "1" }, []), false);
});

// ---------- pages found through businesses ----------
test("businessList: digits-only ids, each once, names cleaned, at most 50; `more` says some were left out", () => {
  const { list, more } = businessList([{ id: "555", name: "Nova\nMedia" }, { id: 777 }, { id: "555", name: "dup" }, { id: "x1", name: "bad" }, { id: "../2" }, null, { name: "no id" }, { id: "1".repeat(26) }]);
  assert.deepEqual(list, [{ id: "555", name: "Nova Media" }, { id: "777" }]);
  assert.equal(more, false);
  assert.deepEqual(businessList(undefined), { list: [], more: false });
  assert.deepEqual(businessList("x"), { list: [], more: false });
  const many = businessList(Array.from({ length: 60 }, (_, i) => ({ id: String(1000 + i), name: `B${i}` })));
  assert.equal(many.list.length, MAX_BUSINESSES);
  assert.equal(many.more, true, "more than 50 businesses: not all are read");
  assert.equal(businessList([{ id: "5" }], true).more, true, "Graph says there is a next page of businesses");
});

test("viaBusiness: marks a page found through a business; an owned page gets its owner when it named none; nothing else changes", () => {
  const row = slimPage({ id: "1", name: "A", instagram_business_account: { id: "17", username: "a" } });
  assert.deepEqual(viaBusiness(row, { id: "555", name: "Nova Media" }), { ...row, _viaBm: "555" }, "client page: marked, owner unknown");
  assert.deepEqual(viaBusiness(row, { id: "555", name: "Nova Media" }, true), { ...row, _viaBm: "555", business: { id: "555", name: "Nova Media" } }, "owned page: the business owns it");
  assert.deepEqual(viaBusiness(row, { id: "555" }, true).business, { id: "555" }, "no name: only the id");
  const owned = slimPage({ id: "2", name: "B", business: { id: "777", name: "Other" } });
  assert.deepEqual(viaBusiness(owned, { id: "555", name: "Nova Media" }, true).business, { id: "777", name: "Other" }, "a stated owner is never overwritten");
  assert.equal(viaBusiness(null, { id: "5" }), null, "a row that is not a page stays null");
  assert.equal(row._viaBm, undefined, "the input is not changed");
  assert.ok(Object.keys(viaBusiness(row, { id: "5" }, true)).every((k) => ROW_KEYS.includes(k)), "every key of a business row is whitelisted");
  assert.ok(!JSON.stringify(viaBusiness(slimPage({ id: "3", access_token: PAGE_TOKEN }), { id: "5", name: "x" }, true)).includes("SECRET"));
});

test("finishPages: drops non-pages and repeats of an id; the FIRST row of an id wins (the profile's own row carries the tasks)", () => {
  assert.deepEqual(finishPages([{ id: "1", name: "a" }, null, { id: "2", name: "b" }, { id: "1", name: "again" }]).map((p) => p.id), ["1", "2"]);
  const mine = { id: "1", name: "Mine", tasks: ["ADVERTISE"] }, viaOwned = { id: "1", name: "Via", _viaBm: "555" }, viaClient = { id: "2", name: "Client", _viaBm: "777" }, viaOwned2 = { id: "2", name: "Owned", _viaBm: "555" };
  const merged = finishPages([mine, viaOwned, viaOwned2, viaClient]);
  assert.deepEqual(merged, [mine, viaOwned2], "me/accounts beats a business; a page both owned and shared keeps the first (owned edges are read first)");
  assert.equal(merged[0]._viaBm, undefined);
  assert.equal(problemsOf(merged[0]).includes("noAccess"), false, "a page the profile lists with ADVERTISE is not 'No access'");
});

// ---------- field names vs Graph's complaints ----------
test("every optional key is found in its own complaint, whatever was dropped before it (business sits inside instagram_business_account)", () => {
  for (const optional of [OPTIONAL, BIZ_OPTIONAL]) {
    const keys = Object.keys(optional);
    assert.equal(keys.at(-1), "business", "the key that is a substring of another key's complaint goes last");
    for (const k of keys) {
      assert.equal(optionalFieldIn(complaint(k), optional, new Set()), k, `${k} on a clean list`);
      const others = new Set(keys.filter((x) => x !== k && !k.includes(x) && !x.includes(k)));
      assert.equal(optionalFieldIn(complaint(k), optional, others), k, `${k} after the others were dropped`);
    }
    // the only key that sits inside another one's complaint is `business`, and its complaint never contains a longer key
    const inside = keys.flatMap((a) => keys.filter((b) => a !== b && a.includes(b)).map((b) => [a, b]));
    assert.deepEqual(inside, [["instagram_business_account", "business"]]);
  }
});

test("a complaint about a field that is not ours (a base field, a permission text) names no optional key", () => {
  assert.equal(optionalFieldIn(complaint("name"), OPTIONAL, new Set()), null);
  assert.equal(optionalFieldIn({ code: 10, raw: "(#10) Application does not have permission for this action" }, OPTIONAL, new Set()), null);
});

// ---------- errors ----------
test("isPermissionError: 10, 283, 200–299, and a 100 that names no field; nothing else", () => {
  for (const code of [10, 283, 200, 210, 299]) assert.equal(isPermissionError({ code, raw: "no" }), true, String(code));
  assert.equal(isPermissionError({ code: 100, raw: "Unsupported get request. Object with ID 'me' does not exist, cannot be loaded due to missing permissions" }), true);
  assert.equal(isPermissionError(complaint("name")), false, "a 100 that names a field is not a permission problem");
  for (const e of [{ code: 1, raw: "boom" }, { code: 2 }, { code: 190 }, { code: 300 }, { code: 199 }, new Error("Network: x"), null, undefined])
    assert.equal(isPermissionError(e), false, JSON.stringify(e));
});

test("keysToDrop: a nested field blames its parents only; a permission error or an unnamed 100 gives up business, then the Instagram trio, then the rest; anything else is thrown", () => {
  const all = Object.keys(OPTIONAL), IG = ["connected_page_backed_instagram_account", "instagram_business_account", "connected_instagram_account"];
  const perm = { code: 10, raw: "(#10) permission" };
  assert.deepEqual(keysToDrop(complaint("username"), new Set()), ["instagram_business_account", "connected_instagram_account"]);
  assert.deepEqual(keysToDrop(complaint("username"), new Set(["connected_instagram_account"])), ["instagram_business_account"]);
  assert.deepEqual(keysToDrop(complaint("url"), new Set()), ["picture"], "a complaint about the url inside picture{url} blames picture");
  assert.deepEqual(keysToDrop(perm, new Set()), ["business"], "business_management is the likeliest missing permission");
  assert.deepEqual(keysToDrop(perm, new Set(["business"])), IG, "then the Instagram fields (instagram_basic)");
  const rest = all.filter((k) => k !== "business" && !IG.includes(k));
  assert.deepEqual(keysToDrop(perm, new Set(["business", ...IG])), rest, "then everything else: id and name only");
  assert.deepEqual(keysToDrop(perm, new Set(all)), [], "nothing left to give up: show the error");
  assert.deepEqual(keysToDrop({ code: 200, raw: "x" }, new Set(["business", "instagram_business_account"])), ["connected_page_backed_instagram_account", "connected_instagram_account"], "a tier is what is left of it");
  assert.deepEqual(keysToDrop({ code: 100, raw: "(#100) Invalid parameter" }, new Set()), ["business"]);
  assert.deepEqual(keysToDrop({ code: 100, raw: "(#100) something with username in a nested one" }, new Set(all)), [], "nothing left to give up");
  assert.deepEqual(keysToDrop({ code: 1, raw: "boom" }, new Set()), [], "not a field / permission error: thrown as it is");
  assert.deepEqual(keysToDrop(new Error("Network: down"), new Set()), []);
  // a loop that adds what it is told to drop always ends, in at most four passes (the first request + three drops)
  const skipped = new Set();
  let passes = 0;
  for (let i = 0; i < 20; i++) { const d = keysToDrop(perm, skipped); if (!d.length) break; d.forEach((k) => skipped.add(k)); passes++; }
  assert.equal(skipped.size, all.length);
  assert.equal(passes, 3);
});

// ---------- Instagram, ad rights, access ----------
test("igOf: real account (either field), page-backed, none only when every Instagram field was read, unknown otherwise", () => {
  assert.deepEqual(igOf({ instagram_business_account: { id: "1", username: "nova" } }), { state: "real", username: "nova" });
  assert.deepEqual(igOf({ connected_instagram_account: { id: "2", username: "old" } }), { state: "real", username: "old" });
  assert.deepEqual(igOf({ instagram_business_account: { id: "1" } }), { state: "real", username: "" });
  assert.equal(igOf({ instagram_business_account: { id: "1", username: "a" }, connected_instagram_account: { id: "2", username: "b" } }).username, "a", "business account first");
  assert.deepEqual(igOf({ connected_page_backed_instagram_account: { id: "9" } }), { state: "pbia" });
  assert.equal(igOf({ connected_page_backed_instagram_account: { id: "9" }, instagram_business_account: { id: "1", username: "x" } }).state, "real", "a real account beats the page-backed one");
  assert.deepEqual(igOf({}), { state: "none" }, "all three read, nothing there");
  assert.deepEqual(igOf({ _skip: ["tasks", "business"] }), { state: "none" }, "other refused fields do not matter");
  for (const k of ["connected_page_backed_instagram_account", "instagram_business_account", "connected_instagram_account"])
    assert.deepEqual(igOf({ _skip: [k] }), { state: "unknown" }, `${k} refused: no verdict`);
  assert.equal(igOf({ _skip: ["instagram_business_account"], connected_page_backed_instagram_account: { id: "9" } }).state, "pbia", "what WAS read still counts");
});

test("handleOf: '@handle' only for a real Instagram account with a name", () => {
  assert.equal(handleOf({ instagram_business_account: { id: "1", username: "nova.travel" } }), "@nova.travel");
  assert.equal(handleOf({ connected_instagram_account: { id: "2", username: "old" } }), "@old");
  assert.equal(handleOf({ instagram_business_account: { id: "1" } }), "", "a real account without a name: nothing");
  assert.equal(handleOf({ connected_page_backed_instagram_account: { id: "9" } }), "", "the page-backed identity has no handle");
  assert.equal(handleOf({}), "");
});

test("adRightsOf / accessOf / humanTask", () => {
  assert.equal(adRightsOf({ tasks: ["MANAGE", "ADVERTISE"] }), "ok");
  assert.equal(adRightsOf({ tasks: ["MANAGE", "ANALYZE"] }), "none");
  assert.equal(adRightsOf({ tasks: [] }), "unknown", "an empty list describes nothing");
  assert.equal(adRightsOf({}), "unknown");
  assert.deepEqual(accessOf({ tasks: ["ANALYZE", "MANAGE", "ADVERTISE", "WEIRD_TASK", "MANAGE"] }), { via: false, tasks: ["ADVERTISE", "MANAGE", "ANALYZE", "WEIRD_TASK"] }, "ADVERTISE first, the known ones in order, no repeats");
  assert.deepEqual(accessOf({ _viaBm: "555", tasks: ["ADVERTISE"] }), { via: true, tasks: [] }, "through a business: not assigned, whatever else");
  assert.deepEqual(accessOf({}), { via: false, tasks: [] });
  assert.equal(humanTask("MANAGE_JOBS"), "Manage jobs");
  assert.equal(humanTask("PROFILE_PLUS_FULL_CONTROL"), "Profile plus full control");
  assert.equal(humanTask(""), "");
});

// ---------- problems: the chips ----------
const P = (id, name, extra = {}) => ({ id, name, ...extra });
const rows = [
  P("1", "Nova Travel", { instagram_business_account: { id: "17", username: "nova" }, is_published: true, tasks: ["ADVERTISE"], promotion_eligible: true, business: { id: "555", name: "Nova Media" } }),
  P("2", "fresh page", {}),                                                                                     // nothing connected, everything read → No Instagram
  P("3", "Backed", { connected_page_backed_instagram_account: { id: "9" }, tasks: ["MANAGE"] }),                // PBIA, but no ADVERTISE → No access
  P("4", "Hidden", { is_published: false, promotion_eligible: false, promotion_ineligible_reason: "Unpublished", _skip: ["instagram_business_account"] }),   // IG unknown
  P("10", "page 10", { instagram_business_account: { id: "20", username: "ten" } }),
  P("11", "Via page", { instagram_business_account: { id: "21", username: "via" }, is_published: true, _viaBm: "555" }),   // found through a business: no tasks of mine
];
test("problemsOf / problemCounts: No access (no ADVERTISE, or only via a business), No Instagram only with a verdict; unknown is never counted", () => {
  assert.deepEqual(problemsOf(rows[0]), []);
  assert.deepEqual(problemsOf(rows[1]), ["noIg"]);
  assert.deepEqual(problemsOf(rows[2]), ["noAccess"]);
  assert.deepEqual(problemsOf(rows[3]), ["unpublished", "noAdv"], "Instagram of this row is unknown: not 'No Instagram'");
  assert.deepEqual(problemsOf(rows[4]), [], "tasks unknown: no verdict about access");
  assert.deepEqual(problemsOf(rows[5]), ["noAccess"], "seen only through a business: not assigned");
  assert.deepEqual(problemCounts(rows), { noAccess: 2, unpublished: 1, noAdv: 1, noIg: 1 });
  assert.deepEqual(problemCounts([]), { noAccess: 0, unpublished: 0, noAdv: 0, noIg: 0 });
  assert.deepEqual(Object.keys(PROBLEMS), ["noAccess", "unpublished", "noAdv", "noIg"], "the chips, in the order of the priority");
  assert.deepEqual(PRIORITY, ["noAccess", "unpublished", "noAdv", "noIg"]);
  assert.equal("noRights" in PROBLEMS, false, "'No ad rights' is merged into 'No access'");
});

test("every problem has its label in both languages", async () => {
  await import("../fb-helper/js/strings/pages.js");
  for (const lang of ["ru", "en"]) {
    await setLang(lang);
    for (const k of Object.keys(PROBLEMS)) assert.ok(has(`pages.p.${k}`), `${lang}: pages.p.${k}`);
  }
  await setLang("en");
});

// ---------- search, filter, order ----------
test("filterPages: search by name, id or owner business (case-insensitive, trimmed); chip filter; both together; no category", () => {
  const ids = (rs) => rs.map((p) => p.id);
  assert.deepEqual(ids(filterPages(rows)), ["1", "2", "3", "4", "10", "11"]);
  assert.deepEqual(ids(filterPages(rows, { q: "  NOVA " })), ["1"], "name and owner business, one row");
  assert.deepEqual(ids(filterPages(rows, { q: "page" })), ["2", "10", "11"]);
  assert.deepEqual(ids(filterPages(rows, { q: "10" })), ["10"], "by id");
  assert.deepEqual(ids(filterPages(rows, { q: "media" })), ["1"], "by owner business");
  assert.deepEqual(ids(filterPages([{ id: "5", name: "x", category: "Travel" }], { q: "travel" })), [], "the category is not part of a page any more");
  assert.deepEqual(ids(filterPages(rows, { q: "zzz" })), []);
  assert.deepEqual(ids(filterPages(rows, { problem: "noIg" })), ["2"]);
  assert.deepEqual(ids(filterPages(rows, { problem: "noAccess" })), ["3", "11"]);
  assert.deepEqual(ids(filterPages(rows, { problem: "noAdv" })), ["4"]);
  assert.deepEqual(ids(filterPages(rows, { problem: "noIg", q: "fresh" })), ["2"]);
  assert.deepEqual(ids(filterPages(rows, { problem: "noIg", q: "nova" })), []);
  assert.deepEqual(ids(filterPages(rows, { problem: "nonsense" })), [], "an unknown chip matches nothing");
});

test("sortPages: healthy pages first by name (numbers as numbers, then id), then pages with problems by their worst problem, each by name; the input is not changed", () => {
  const OKP = { is_published: true, tasks: ["ADVERTISE"], promotion_eligible: true, instagram_business_account: { id: "9", username: "x" } };
  const input = [
    P("1", "Zed noIg", { ...OKP, instagram_business_account: undefined }),
    P("2", "Beta noAdv", { ...OKP, promotion_eligible: false }),
    P("3", "Gamma unpublished", { ...OKP, is_published: false }),
    P("4", "Delta noAccess", { ...OKP, tasks: ["MANAGE"] }),
    P("5", "page 10", OKP), P("6", "Page 2", OKP), P("7", "backed", OKP), P("8", "Page 2", OKP),
    P("9", "Alpha noAccess via", { ...OKP, tasks: undefined, _viaBm: "555" }),
    P("10", "Omega noAdv + noIg", { ...OKP, promotion_eligible: false, instagram_business_account: undefined }),
  ];
  const copy = input.map((p) => p.id).join();
  assert.deepEqual(sortPages(input).map((p) => p.id), ["7", "6", "8", "5", "9", "4", "3", "2", "10", "1"],
    "backed, Page 2, Page 2 (id), page 10 | No access: Alpha, Delta | Unpublished | Can't advertise: Beta, Omega | No Instagram");
  assert.equal(input.map((p) => p.id).join(), copy);
  assert.deepEqual(sortPages([]), []);
});

// ---------- problems and their fixes ----------
// A page with nothing wrong, so each test spoils exactly one thing.
const OK = { id: "100000000000007", name: "Fine page", is_published: true, tasks: ["ADVERTISE"], promotion_eligible: true, instagram_business_account: { id: "17", username: "fine.page" } };
const withProblem = {
  noAccess: { ...OK, tasks: ["MANAGE"], business: { id: "555", name: "Owner" } },
  unpublished: { ...OK, is_published: false },
  noAdv: { ...OK, promotion_eligible: false, promotion_ineligible_reason: "Page is restricted" },
  noIg: { ...OK, instagram_business_account: undefined },
};
const FIX_URL = {
  noAccess: LINKS.bmPages("555"), unpublished: LINKS.pageSuite(OK.id), noAdv: LINKS.accountQuality(), noIg: LINKS.adsManagerHome(),
};

test("every problem has exactly one fix link, to the page that fixes it", () => {
  assert.deepEqual([...PRIORITY].sort(), Object.keys(PROBLEMS).sort(), "the priority list names every problem once");
  assert.deepEqual(Object.keys(FIXES).sort(), Object.keys(PROBLEMS).sort(), "…and so does the fix table");
  for (const key of Object.keys(PROBLEMS)) {
    const issues = issuesOf(withProblem[key]);
    assert.deepEqual(issues.map((i) => i.key), [key], key);
    assert.ok(issues[0].fix && issues[0].fix.url, `${key}: a fix`);
    assert.equal(issues[0].fix.url, FIX_URL[key], key);
    assert.equal(issues[0].tone, PROBLEMS[key]);
    assert.ok(/^https:\/\/([a-z]+\.)?facebook\.com\//.test(issues[0].fix.url), `${key}: https on facebook.com`);
  }
  assert.equal(FIX_URL.noAdv, "https://www.facebook.com/accountquality/");
  assert.equal(FIX_URL.noAccess, "https://business.facebook.com/settings/pages?business_id=555");
  assert.deepEqual(Object.fromEntries(Object.entries(FIXES).map(([k, f]) => [k, f.label])),
    { noAccess: "pages.fix.assign", unpublished: "pages.fix.publish", noAdv: "pages.fix.appeal", noIg: "pages.fix.ig" }, "Assign me · Publish · Appeal · Set «Use Facebook Page»");
});

test("fixes: 'Assign me' goes to the Pages settings of the business the page was found through, else its owner, else Business Suite; a bad id drops the link, never a half URL", () => {
  const via = { ...OK, tasks: undefined, _viaBm: "777", business: { id: "555", name: "Owner" } };
  assert.equal(issuesOf(via)[0].fix.url, LINKS.bmPages("777"), "the business I can act in comes first");
  assert.equal(issuesOf({ ...OK, tasks: undefined, _viaBm: "777" })[0].fix.url, "https://business.facebook.com/settings/pages?business_id=777");
  assert.equal(issuesOf({ ...OK, tasks: ["MANAGE"] })[0].fix.url, `https://business.facebook.com/latest/home?asset_id=${OK.id}`, "owner unknown: Business Suite");
  assert.equal(issuesOf({ ...OK, tasks: ["MANAGE"], business: { id: "x/../y" } })[0].fix.url, LINKS.pageSuite(OK.id), "a bad business id falls back");
  assert.equal(issuesOf({ ...OK, id: "not-a-number", is_published: false })[0].fix, null, "no usable id, no link");
  assert.equal(issuesOf({ ...OK, instagram_business_account: undefined })[0].fix.url, "https://adsmanager.facebook.com/adsmanager/manage/ads");
});

test("a healthy page has no problem and no fix, whether its Instagram is real, page-backed or unread", () => {
  assert.deepEqual(issuesOf(OK), []);
  const pbia = { ...OK, instagram_business_account: undefined, connected_page_backed_instagram_account: { id: "9" } };
  assert.deepEqual(issuesOf(pbia), []);
  const unread = { ...OK, instagram_business_account: undefined, _skip: ["instagram_business_account"] };
  assert.deepEqual(issuesOf(unread), [], "no verdict about Instagram: not a problem");
});

test("problems come worst first: No access > Unpublished > Can't advertise > No Instagram; the first is what the row says", () => {
  const all = { ...OK, promotion_eligible: false, is_published: false, tasks: ["MANAGE"], instagram_business_account: undefined };
  assert.deepEqual(issuesOf(all).map((i) => i.key), ["noAccess", "unpublished", "noAdv", "noIg"]);
  assert.deepEqual(PRIORITY, ["noAccess", "unpublished", "noAdv", "noIg"]);
  assert.deepEqual(issuesOf(all).map((i) => i.tone), ["warn", "warn", "bad", "warn"]);
  let p = all;
  const fixes = { noAccess: { tasks: ["ADVERTISE"] }, unpublished: { is_published: true }, noAdv: { promotion_eligible: true } };
  for (const want of ["noAccess", "unpublished", "noAdv", "noIg"]) {
    assert.equal(issuesOf(p)[0].key, want);
    p = { ...p, ...fixes[want] };
  }
  assert.deepEqual(issuesOf({ ...OK, tasks: undefined, _viaBm: "5", is_published: false }).map((i) => i.key), ["noAccess", "unpublished"], "a page found through a business can have more problems too");
});

test("tooltips: Graph's own reason for 'Can't advertise' is the tooltip text, not a line of its own; 'No access' says which kind", () => {
  const [i] = issuesOf(withProblem.noAdv);
  assert.equal(i.rawTip, "Page is restricted");
  assert.equal(i.tip, "pages.noAdvTitle", "the fallback when Graph gave no reason");
  assert.equal(issuesOf({ ...OK, promotion_eligible: false })[0].rawTip, undefined);
  assert.equal(issuesOf(withProblem.noAccess)[0].tip, "pages.noAccessTitle");
  assert.equal(issuesOf({ ...OK, tasks: undefined, _viaBm: "5" })[0].tip, "pages.noAccessViaTitle");
});

test("every label and tooltip of the problems and their fixes exists in both languages; short fix words; no slang", async () => {
  const { STRINGS } = await import("../fb-helper/js/strings/pages.js");
  const keys = new Set(["pages.ready", "pages.igPbia", "pages.igPbiaTitle", "pages.igRealTitle", "pages.igUnknownTitle", "pages.kv.ig", "pages.kv.business", "pages.kv.access",
    "pages.ig.real", "pages.ig.realNoName", "pages.ig.pbia", "pages.ig.none", "pages.ig.unknown", "pages.access.via", "pages.noAccessViaTitle",
    "pages.linkPage", "pages.linkPageTitle", "pages.linkSuite", "pages.linkSuiteTitle", "pages.linkBm", "pages.linkBmTitle", "pages.bmHint", "pages.notAllLine", "pages.found",
    "pages.task.ADVERTISE", "pages.task.MANAGE", "pages.task.CREATE_CONTENT", "pages.task.MODERATE", "pages.task.MESSAGING", "pages.task.ANALYZE"]);
  for (const p of [...Object.values(withProblem), { ...OK, tasks: undefined, _viaBm: "5" }]) for (const i of issuesOf(p)) { keys.add(i.label); keys.add(i.tip); keys.add(i.fix.label); keys.add(i.fix.tip); }
  for (const f of Object.values(FIXES)) { keys.add(f.label); keys.add(f.tip); }
  for (const l of ["ru", "en"]) assert.deepEqual([...keys].filter((k) => !STRINGS[l][k]), [], `missing in ${l}`);
  assert.deepEqual(Object.keys(STRINGS.ru).sort(), Object.keys(STRINGS.en).sort());
  // what the tab no longer says: followers, likes, category, verified, Copy IDs, "No ad rights"
  for (const gone of ["pages.followers", "pages.likes", "pages.verified", "pages.copyIds", "pages.p.noRights", "pages.count"]) assert.ok(!(gone in STRINGS.en), `${gone} is gone`);
  // the product is renamed in the store build, and "BM" is slang the interface avoids
  for (const l of ["ru", "en"]) for (const v of Object.values(STRINGS[l]).flat()) assert.ok(!/fb helper|(^|[^\p{L}])(BM|БМ)(?![\p{L}])/iu.test(v), v);
  // the words of design.md §8
  assert.deepEqual(["pages.p.noAccess", "pages.p.unpublished", "pages.p.noAdv", "pages.p.noIg"].map((k) => STRINGS.en[k]), ["No access", "Unpublished", "Can't advertise", "No Instagram"]);
  assert.deepEqual(["pages.p.noAccess", "pages.p.unpublished", "pages.p.noAdv", "pages.p.noIg"].map((k) => STRINGS.ru[k]), ["Нет доступа", "Не опубликована", "Нельзя рекламировать", "Нет Instagram"]);
  assert.deepEqual(Object.values(FIXES).map((f) => STRINGS.en[f.label]), ["Assign me", "Publish", "Appeal", "Set «Use Facebook Page»"]);
  assert.deepEqual(Object.values(FIXES).map((f) => STRINGS.ru[f.label]), ["Назначить себя", "Опубликовать", "Апелляция", "Выбрать «Use Facebook Page»"]);
  // labels of links stay short enough for a 380 px window
  for (const l of ["ru", "en"]) for (const f of Object.values(FIXES)) assert.ok(STRINGS[l][f.label].length <= 32, `${l} ${f.label}`);
  for (const part of ["«Use Facebook Page»", "Identity → Instagram account", "once", "automated launches to Instagram placements fail"]) assert.ok(STRINGS.en["pages.igNoneTitle"].includes(part), part);
});

test("slimPage: control and bidi characters leave every name (page, business, Instagram handle, ineligibility reason)", () => {
  const r = slimPage({ id: "5", name: "Nova\u202Etxt", business: { id: "9", name: "Biz\u2067" }, instagram_business_account: { id: "7", username: "@h\u202Ee" }, promotion_ineligible_reason: "no\nway\u2066" });
  assert.equal(r.name, "Novatxt"); assert.equal(r.business.name, "Biz"); assert.equal(r.instagram_business_account.username, "he"); assert.equal(r.promotion_ineligible_reason, "no way");
});
