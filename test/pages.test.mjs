// js/pages-model.js: the logic of the Pages tab (field list, row whitelist, Instagram state, chips, search, IDs to copy).
// Plain Node: the model has no DOM and no imports. Run: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import {
  OPTIONAL, BASE, ROW_KEYS, PROBLEMS, isPermissionError, keysToDrop, slimPage, finishPages, igOf, adRightsOf, isVerified, audienceOf,
  problemsOf, problemCounts, filterPages, sortPages, idsText, showBmHint, SHORT_LIST,
} from "../fb-helper/js/pages-model.js";
import { optionalFieldIn } from "../fb-helper/js/graph.js";
import { setLang, has } from "../fb-helper/js/i18n.js";

const PAGE_TOKEN = "EAAPageSECRET" + "q".repeat(50);
const complaint = (field) => ({ code: 100, raw: `(#100) Tried accessing nonexisting field (${field}) on node type (Page)` });

// ---------- no Page access token, ever ----------
test("fields: explicit, id + name + the optional ones, never an access token", () => {
  const fields = [...BASE, ...Object.values(OPTIONAL)].join(",");
  assert.ok(!/access_token/.test(fields), fields);
  assert.deepEqual(BASE, ["id", "name"]);
  for (const f of ["category", "followers_count", "fan_count", "is_published", "verification_status", "tasks", "promotion_eligible",
    "promotion_ineligible_reason", "connected_page_backed_instagram_account{id}", "instagram_business_account{id,username}",
    "connected_instagram_account{id,username}", "business{id,name}"]) assert.ok(Object.values(OPTIONAL).includes(f), f);
});

test("slimPage: keeps the whitelist only; access_token (top level and nested) and unknown keys are dropped", () => {
  const raw = {
    id: "1001", name: "Nova", access_token: PAGE_TOKEN, category: "Travel", followers_count: 5, fan_count: 4, is_published: true,
    verification_status: "blue_verified", tasks: ["ADVERTISE", "MANAGE"], promotion_eligible: true, promotion_ineligible_reason: "none",
    connected_page_backed_instagram_account: { id: "9", access_token: PAGE_TOKEN, extra: 1 },
    instagram_business_account: { id: "17", username: "@nova", access_token: PAGE_TOKEN, followers_count: 99 },
    connected_instagram_account: { id: "18", username: "nova2" },
    business: { id: "555", name: "Nova Media", access_token: PAGE_TOKEN, verification_status: "x" },
    category_list: [{ id: "1" }], cover: { source: "https://x" }, picture: { data: { url: "https://x" } }, link: "https://x", _skip: ["hacked"],
  };
  const row = slimPage(raw);
  assert.ok(!JSON.stringify(row).includes("SECRET") && !JSON.stringify(row).includes("access_token"), JSON.stringify(row));
  assert.ok(Object.keys(row).every((k) => ROW_KEYS.includes(k)), Object.keys(row).join());
  assert.deepEqual(row.connected_page_backed_instagram_account, { id: "9" });
  assert.deepEqual(row.instagram_business_account, { id: "17", username: "nova" }, "nested keys cut to id + username, @ stripped");
  assert.deepEqual(row.business, { id: "555", name: "Nova Media" });
  assert.equal(row._skip, undefined, "the skip list comes from the caller, not from Graph");
  assert.equal(row.category_list, undefined);
  assert.deepEqual(slimPage({ id: "7", name: "Only id and name", access_token: PAGE_TOKEN }), { id: "7", name: "Only id and name" });
});

test("slimPage: values of the wrong type are dropped, text is cleaned, a row without a numeric id is not a page", () => {
  const row = slimPage({ id: 42, name: "A\nB\u0000C", category: 5, followers_count: "12", fan_count: -1, is_published: "yes", tasks: ["ADVERTISE", 3, null], verification_status: {},
    promotion_eligible: 1, business: { id: "x1", name: "bad id" }, instagram_business_account: { id: "oops" }, connected_instagram_account: "str" });
  assert.deepEqual(row, { id: "42", name: "A B C", tasks: ["ADVERTISE"] });
  for (const bad of [null, undefined, "x", 5, {}, { id: "" }, { id: "12a" }, { id: "../x" }, { id: "1".repeat(26) }, { name: "no id" }]) assert.equal(slimPage(bad), null, JSON.stringify(bad));
  assert.equal(slimPage({ id: "1" }).name, "", "a missing name is an empty string, the screen says 'Unnamed'");
  assert.equal(slimPage({ id: "1", name: "x".repeat(500) }).name.length, 200);
  assert.deepEqual(slimPage({ id: "1", instagram_business_account: { id: "5" } }).instagram_business_account, { id: "5" }, "no username is fine");
});

test("slimPage: _skip records only the optional fields that were not asked for", () => {
  assert.deepEqual(slimPage({ id: "1" }, ["tasks", "tasks", "bogus"])._skip, ["tasks"]);
  assert.equal("_skip" in slimPage({ id: "1" }, []), false);
});

test("finishPages: drops non-pages and repeats of an id", () => {
  assert.deepEqual(finishPages([{ id: "1", name: "a" }, null, { id: "2", name: "b" }, { id: "1", name: "again" }]).map((p) => p.id), ["1", "2"]);
});

// ---------- field names vs Graph's complaints ----------
test("every optional key is found in its own complaint, whatever was dropped before it (business sits inside instagram_business_account)", () => {
  const keys = Object.keys(OPTIONAL);
  assert.equal(keys.at(-1), "business", "the key that is a substring of another key's complaint goes last");
  for (const k of keys) {
    assert.equal(optionalFieldIn(complaint(k), OPTIONAL, new Set()), k, `${k} on a clean list`);
    const others = new Set(keys.filter((x) => x !== k && !k.includes(x) && !x.includes(k)));
    assert.equal(optionalFieldIn(complaint(k), OPTIONAL, others), k, `${k} after the others were dropped`);
  }
  // the only key that sits inside another one's complaint is `business`, and its complaint never contains a longer key
  const inside = keys.flatMap((a) => keys.filter((b) => a !== b && a.includes(b)).map((b) => [a, b]));
  assert.deepEqual(inside, [["instagram_business_account", "business"]]);
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

// ---------- Instagram ----------
test("igOf: real account (either field), page-backed, none only when every Instagram field was read, unknown otherwise", () => {
  assert.deepEqual(igOf({ instagram_business_account: { id: "1", username: "nova" } }), { state: "real", username: "nova" });
  assert.deepEqual(igOf({ connected_instagram_account: { id: "2", username: "old" } }), { state: "real", username: "old" });
  assert.deepEqual(igOf({ instagram_business_account: { id: "1" } }), { state: "real", username: "" });
  assert.equal(igOf({ instagram_business_account: { id: "1", username: "a" }, connected_instagram_account: { id: "2", username: "b" } }).username, "a", "business account first");
  assert.deepEqual(igOf({ connected_page_backed_instagram_account: { id: "9" } }), { state: "pbia" });
  assert.equal(igOf({ connected_page_backed_instagram_account: { id: "9" }, instagram_business_account: { id: "1", username: "x" } }).state, "real", "a real account beats the page-backed one");
  assert.deepEqual(igOf({}), { state: "none" }, "all three read, nothing there");
  assert.deepEqual(igOf({ _skip: ["tasks", "category"] }), { state: "none" }, "other refused fields do not matter");
  for (const k of ["connected_page_backed_instagram_account", "instagram_business_account", "connected_instagram_account"])
    assert.deepEqual(igOf({ _skip: [k] }), { state: "unknown" }, `${k} refused: no verdict`);
  assert.equal(igOf({ _skip: ["instagram_business_account"], connected_page_backed_instagram_account: { id: "9" } }).state, "pbia", "what WAS read still counts");
});

test("adRightsOf / isVerified / audienceOf", () => {
  assert.equal(adRightsOf({ tasks: ["MANAGE", "ADVERTISE"] }), "ok");
  assert.equal(adRightsOf({ tasks: ["MANAGE", "ANALYZE"] }), "none");
  assert.equal(adRightsOf({ tasks: [] }), "unknown", "an empty list describes nothing");
  assert.equal(adRightsOf({}), "unknown");
  assert.equal(isVerified({ verification_status: "blue_verified" }), true);
  assert.equal(isVerified({ verification_status: "gray_verified" }), true);
  assert.equal(isVerified({ verification_status: "not_verified" }), false);
  assert.equal(isVerified({}), false);
  assert.deepEqual(audienceOf({ followers_count: 0, fan_count: 5 }), { kind: "followers", n: 0 }, "0 followers is a number, not 'unknown'");
  assert.deepEqual(audienceOf({ fan_count: 5 }), { kind: "likes", n: 5 });
  assert.equal(audienceOf({}), null);
});

// ---------- chips ----------
const P = (id, name, extra = {}) => ({ id, name, ...extra });
const rows = [
  P("1", "Nova Travel", { instagram_business_account: { id: "17", username: "nova" }, is_published: true, tasks: ["ADVERTISE"], promotion_eligible: true, category: "Travel", business: { id: "555", name: "Nova Media" } }),
  P("2", "fresh page", {}),                                                                                     // nothing connected, everything read → No Instagram
  P("3", "Backed", { connected_page_backed_instagram_account: { id: "9" }, tasks: ["MANAGE"] }),                // PBIA, but no ADVERTISE
  P("4", "Hidden", { is_published: false, promotion_eligible: false, promotion_ineligible_reason: "Unpublished", _skip: ["instagram_business_account"] }),   // IG unknown
  P("10", "page 10", { instagram_business_account: { id: "20", username: "ten" } }),
];
test("problemsOf / problemCounts: No Instagram only with a verdict; unknown is never counted", () => {
  assert.deepEqual(problemsOf(rows[0]), []);
  assert.deepEqual(problemsOf(rows[1]), ["noIg"]);
  assert.deepEqual(problemsOf(rows[2]), ["noRights"]);
  assert.deepEqual(problemsOf(rows[3]), ["unpublished", "noAdv"], "Instagram of this row is unknown: not 'No Instagram'");
  assert.deepEqual(problemCounts(rows), { noIg: 1, unpublished: 1, noAdv: 1, noRights: 1 });
  assert.deepEqual(problemCounts([]), { noIg: 0, unpublished: 0, noAdv: 0, noRights: 0 });
  assert.deepEqual(Object.keys(PROBLEMS), ["noIg", "unpublished", "noAdv", "noRights"]);
});

test("every problem has its label in both languages", async () => {
  await import("../fb-helper/js/strings/pages.js");
  for (const lang of ["ru", "en"]) {
    await setLang(lang);
    for (const k of Object.keys(PROBLEMS)) assert.ok(has(`pages.p.${k}`), `${lang}: pages.p.${k}`);
  }
  await setLang("en");
});

// ---------- search, filter, copy ----------
test("filterPages: search by name or id (case-insensitive, trimmed), also category and owner BM; chip filter; both together", () => {
  const ids = (rs) => rs.map((p) => p.id);
  assert.deepEqual(ids(filterPages(rows)), ["1", "2", "3", "4", "10"]);
  assert.deepEqual(ids(filterPages(rows, { q: "  NOVA " })), ["1"], "name and owner BM, one row");
  assert.deepEqual(ids(filterPages(rows, { q: "page" })), ["2", "10"]);
  assert.deepEqual(ids(filterPages(rows, { q: "10" })), ["10"], "by id");
  assert.deepEqual(ids(filterPages(rows, { q: "travel" })), ["1"], "by category");
  assert.deepEqual(ids(filterPages(rows, { q: "media" })), ["1"], "by owner BM");
  assert.deepEqual(ids(filterPages(rows, { q: "zzz" })), []);
  assert.deepEqual(ids(filterPages(rows, { problem: "noIg" })), ["2"]);
  assert.deepEqual(ids(filterPages(rows, { problem: "noAdv" })), ["4"]);
  assert.deepEqual(ids(filterPages(rows, { problem: "noIg", q: "fresh" })), ["2"]);
  assert.deepEqual(ids(filterPages(rows, { problem: "noIg", q: "nova" })), []);
  assert.deepEqual(ids(filterPages(rows, { problem: "nonsense" })), [], "an unknown chip matches nothing");
});

test("sortPages: by name, numbers as numbers, then id; the input is not changed", () => {
  const shuffled = [P("10", "page 10"), P("2", "Page 2"), P("3", "backed"), P("5", "Page 2")];
  const sorted = sortPages(shuffled);
  assert.deepEqual(sorted.map((p) => p.id), ["3", "2", "5", "10"]);
  assert.equal(shuffled[0].id, "10");
});

test("idsText: one id per line, in the order given; nothing for an empty list", () => {
  assert.equal(idsText(sortPages(rows)), "3\n2\n4\n1\n10", "Backed, fresh page, Hidden, Nova Travel, page 10");
  assert.equal(idsText(filterPages(rows, { problem: "noIg" })), "2");
  assert.equal(idsText([P("7", "a"), P("8", "b")]), "7\n8");
  assert.equal(idsText([]), "");
});

test("showBmHint: only for a short list", () => {
  assert.equal(showBmHint(0), true);
  assert.equal(showBmHint(SHORT_LIST - 1), true);
  assert.equal(showBmHint(SHORT_LIST), false);
});
