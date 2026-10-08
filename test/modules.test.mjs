// Unit tests of the shared building blocks a new tab uses (bus, registry, addStrings, state caches and rate slots, readPaged).
// Plain Node: these modules touch neither the DOM nor chrome.* while they load; the few chrome / fetch / navigator.locks calls
// are replaced by small fakes here. Run: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { on, emit } from "../fb-helper/js/bus.js";
import { registerTab, tabInfo, tabNames, registerRender, registerInit, registerStart, runInit, runStart, runRenders } from "../fb-helper/js/registry.js";
import { addStrings, setLang, t, tn, has } from "../fb-helper/js/i18n.js";
import { setGraphUrl } from "../fb-helper/js/config.js";
import { state, Stale, loadState, onLoad, registerCache, cacheKeys, dropCache, checkOwner, claimSlot, slotLeft, newGeneration, markDead, saveSession } from "../fb-helper/js/state.js";
import { graph, readPaged, optionalFieldIn, pauseNote, budgetLeft } from "../fb-helper/js/graph.js";
import { toastMs } from "../fb-helper/js/dom.js";

// ---------- fakes ----------
function fakeChrome({ session = {}, cookies = {} } = {}) {
  const store = structuredClone(session), calls = { get: [], set: [], remove: [], cookie: 0 };
  const keysOf = (k) => (typeof k === "string" ? [k] : Array.isArray(k) ? k : Object.keys(k || store));
  globalThis.chrome = {
    storage: {
      session: {
        get: async (keys) => { calls.get.push(keys); return Object.fromEntries(keysOf(keys).filter((k) => k in store).map((k) => [k, structuredClone(store[k])])); },
        set: async (patch) => { calls.set.push(patch); Object.assign(store, structuredClone(patch)); },
        remove: async (keys) => { calls.remove.push(keys); for (const k of keysOf(keys)) delete store[k]; },
      },
      local: { get: async () => ({}), set: async () => {} },
    },
    cookies: { get: async ({ name }) => { calls.cookie++; return name in cookies ? { value: cookies[name] } : null; } },
  };
  return { store, calls, cookies };
}
// Web Locks stand-in: runs the callback (one at a time is enough for these tests).
Object.defineProperty(globalThis, "navigator", { value: { locks: { request: (_name, fn) => fn() } }, configurable: true, writable: true });
setGraphUrl("https://graph.test/");
await setLang("en");                                      // messages asserted below are English

// ---------- bus ----------
test("bus: handlers run in subscription order, can unsubscribe, and one that throws does not stop the others", () => {
  const seen = [];
  const off = on("t.order", (p) => seen.push(`a${p}`));
  on("t.order", () => { throw new Error("boom"); });
  on("t.order", (p) => seen.push(`c${p}`));
  const log = console.error; console.error = () => {};
  try { emit("t.order", 1); } finally { console.error = log; }
  assert.deepEqual(seen, ["a1", "c1"]);
  off(); emit("t.order", 2);
  assert.deepEqual(seen, ["a1", "c1", "c2"], "unsubscribed handler is gone");
  emit("t.nobody", 1);                                    // no subscribers: nothing happens
});

// ---------- toast ----------
test("toastMs: 2.6 s for a short text, 60 ms a character for a long one (an error nobody had time to read helps nobody)", () => {
  assert.equal(toastMs("Copied"), 2600);
  assert.equal(toastMs("x".repeat(43)), 2600, "43 characters = 2580 ms: still the minimum");
  assert.equal(toastMs("x".repeat(44)), 2640);
  assert.equal(toastMs("x".repeat(100)), 6000);
  assert.equal(toastMs(""), 2600); assert.equal(toastMs(undefined), 2600); assert.equal(toastMs(null), 2600);
});

// ---------- registry ----------
test("registry: tabs (names, onShow, no duplicates), render filters, init / start order, a failing hook does not stop the rest", () => {
  const onShow = () => {};
  registerTab("t.plain");
  registerTab("t.shown", { onShow });
  assert.deepEqual(tabNames().filter((n) => n.startsWith("t.")), ["t.plain", "t.shown"]);
  assert.equal(tabInfo("t.shown").onShow, onShow);
  assert.equal(tabInfo("t.plain").onShow, undefined);
  assert.ok(!("tall" in tabInfo("t.plain")), "every tab has the same height: nothing to register");
  assert.equal(tabInfo("t.missing"), undefined);
  assert.throws(() => registerTab("t.plain"), /already registered/);

  const seen = [];
  registerRender(() => seen.push("lang"));                                    // default: language only
  registerRender(() => seen.push("tick"), { lang: false, tick: true });
  registerRender(() => seen.push("both"), { lang: true, tick: true });
  runRenders("lang"); runRenders("tick");
  assert.deepEqual(seen, ["lang", "both", "tick", "both"]);

  const order = [];
  registerInit(() => order.push("init1"));
  registerInit(() => { throw new Error("broken module"); });
  registerInit(() => order.push("init2"));
  registerStart(() => order.push("start1"));
  const log = console.error; console.error = () => {};
  try { runInit(); runStart(); } finally { console.error = log; }
  assert.deepEqual(order, ["init1", "init2", "start1"]);
});

// ---------- i18n.addStrings ----------
test("addStrings: merges both languages into the dictionary; a duplicate key throws and merges nothing; a typo'd language throws", async () => {
  addStrings({ ru: { "zt.hello": "Привет, {n}", "zt.count": ["штука", "штуки", "штук"] }, en: { "zt.hello": "Hello, {n}", "zt.count": ["thing", "things"] } });
  await setLang("en");
  assert.ok(has("zt.hello"));
  assert.equal(t("zt.hello", { n: "Bob" }), "Hello, Bob");
  assert.equal(tn(1, "zt.count"), "thing"); assert.equal(tn(2, "zt.count"), "things");
  await setLang("ru");
  assert.equal(t("zt.hello", { n: "Боб" }), "Привет, Боб");
  assert.equal(tn(5, "zt.count"), "штук");
  // existing strings are where they were: a key of the main dictionary cannot be taken over
  assert.throws(() => addStrings({ ru: { "zt.new": "x", "tab.token": "again" }, en: { "zt.new": "x" } }), /duplicate key "tab.token"/);
  assert.ok(!has("zt.new"), "nothing of a rejected call is merged");
  assert.throws(() => addStrings({ ru: { "zt.hello": "second" }, en: {} }), /duplicate key "zt.hello"/);
  assert.throws(() => addStrings({ de: { "zt.de": "Hallo" } }), /unknown language "de"/);
  addStrings({}); addStrings(undefined);                  // nothing to add is fine
  await setLang("en");
});

// ---------- state: caches per FB user ----------
test("registerCache: keys are reserved once; dropCache resets every registered cache and removes all their keys", async () => {
  const fake = fakeChrome({ session: { owner: "1001", ka: [1], kb: [2], other: "keep" } });
  const reset = [];
  registerCache(["ka"], () => reset.push("a"));
  registerCache(["kb", "kc"], () => reset.push("b"));
  assert.throws(() => registerCache(["kc"], () => {}), /already registered/);
  assert.throws(() => registerCache(["owner"], () => {}), /already registered/, "owner is the shared FB-user key");
  assert.ok(["owner", "ka", "kb", "kc"].every((k) => cacheKeys().includes(k)));
  state.owner = "1001";
  await dropCache();
  assert.deepEqual(reset, ["a", "b"]);
  assert.equal(state.owner, null);
  assert.deepEqual(Object.keys(fake.store), ["other"], "only cache keys are removed");
});

test("loadState: one storage read with every registered key; onLoad and registerCache loaders get the session object", async () => {
  const fake = fakeChrome({ session: { token: "EAABtok", dead: [{ token: "x", code: "190" }], owner: "7", kd: "cached", zz: 5, locks: { slots: { a: 1 } } } });
  const loaded = [];
  registerCache(["kd"], () => {}, { load: (ses) => loaded.push(["cache", ses.kd]) });
  onLoad(["zz"], async (ses) => { await null; loaded.push(["onLoad", ses.zz]); });
  await loadState();
  assert.equal(fake.calls.get.length, 1, "a single storage.session.get");
  assert.ok(["token", "tokenSource", "dead", "checked", "owner", "locks", "kd", "zz"].every((k) => fake.calls.get[0].includes(k)));
  assert.deepEqual(loaded, [["cache", "cached"], ["onLoad", 5]]);
  assert.equal(state.token, "EAABtok"); assert.equal(state.owner, "7");
  assert.deepEqual(state.dead, [{ token: "x", code: "190" }]);
  assert.deepEqual(state.locks, { slots: { a: 1 } });
});

test("checkOwner: only compares the FB user while some cache holds data; a foreign owner drops everything", async () => {
  const fake = fakeChrome({ session: { owner: "1001", kh: [1] }, cookies: { c_user: "1001" } });
  const held = { v: false };
  registerCache(["kh"], () => { held.v = false; }, { has: () => held.v });
  state.owner = "1001";
  assert.equal(await checkOwner(), false); assert.equal(fake.calls.cookie, 0, "no data cached: the cookie is not even read");
  held.v = true;
  assert.equal(await checkOwner(), false, "same user"); assert.equal(fake.calls.cookie, 1);
  fake.cookies.c_user = "2002";
  assert.equal(await checkOwner(), true, "another user: dropped");
  assert.equal(held.v, false, "the cache's reset ran");
  assert.equal(state.owner, null);
  assert.ok(!("kh" in fake.store) && !("owner" in fake.store));
  held.v = true; state.owner = "1001"; delete fake.cookies.c_user;
  assert.equal(await checkOwner(), true, "logged out counts as another user");
});

// ---------- state: rate slots ----------
test("claimSlot: each key has its own interval; a denied claim returns the time left; expired slots free themselves; the old locks shape frees everything", async () => {
  const fake = fakeChrome();
  assert.equal(await claimSlot("bms", 5000), 0, "first claim is granted");
  const left = await claimSlot("bms", 5000);
  assert.ok(left > 4000 && left <= 5000, `denied with ${left} ms left`);
  assert.equal(await claimSlot("pages", 1000), 0, "another key is independent");
  assert.equal(await claimSlot("accounts", 60000), 0); assert.equal(await claimSlot("ads:111", 30000), 0);
  assert.ok((await claimSlot("accounts", 60000)) > 59000);
  assert.ok(slotLeft("accounts") > 59000 && slotLeft("ads:222") === 0, "slotLeft reads state.locks");
  assert.deepEqual(Object.keys(fake.store.locks.slots).sort(), ["accounts", "ads:111", "bms", "pages"]);
  // a slot whose time ran out is granted again and its stale entry is not kept
  fake.store.locks.slots.pages = Date.now() - 1;
  assert.equal(await claimSlot("pages", 1000), 0);
  // the shape older tests (and older popups) write still reads as "nothing taken"
  fake.store.locks = { accountsAt: Date.now(), ads: { 111: Date.now() + 99999 } };
  assert.equal(await claimSlot("accounts", 60000), 0); assert.equal(await claimSlot("bms", 5000), 0);
  fake.store.locks = { accountsAt: 0, ads: {} };
  assert.equal(await claimSlot("bms", 5000), 0);
});

// ---------- state: events ----------
test("newGeneration and markDead announce themselves on the bus instead of calling the UI", () => {
  fakeChrome();
  const seen = [];
  on("generation", () => seen.push("generation")); on("token-dead", () => seen.push("token-dead"));
  const gen = state.gen, ctl = state.ctl, skip = state.skip;
  newGeneration();
  assert.equal(state.gen, gen + 1); assert.ok(ctl.signal.aborted); assert.notEqual(state.ctl, ctl); assert.notEqual(state.skip, skip);
  state.dead = [];
  markDead("EAAB1", "190/463");
  assert.deepEqual(state.dead, [{ token: "EAAB1", code: "190/463" }]);
  assert.deepEqual(seen, ["generation", "token-dead"]);
  for (let i = 0; i < 7; i++) markDead(`EAAB-more-${i}`, "190");
  assert.equal(state.dead.length, 5, "at most 5 dead marks are kept");
});

// ---------- graph.readPaged ----------
// A fake Graph: handler(url) → { status, body }; every url is recorded.
function fakeGraph(handler) {
  const urls = [];
  urls.opts = [];                                          // the second argument of every fetch, same order
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url); urls.push(u); urls.opts.push(opts);
    const out = handler(u, urls.length) || {};
    return { ok: (out.status || 200) < 400, status: out.status || 200, headers: new Headers(out.headers || {}), json: async () => out.body };
  };
  return urls;
}
const fieldErr = (name) => ({ status: 400, body: { error: { code: 100, message: `(#100) Tried accessing nonexisting field (${name}) on node type (Page)` } } });
const prime = () => { fakeChrome(); Object.assign(state, { token: "EAAB" + "x".repeat(70), dead: [], cooldownUntil: 0, budget: [], gen: state.gen, skip: new Set() }); };
// key = the field name Graph complains about; value = what goes into `fields`
const OPT = { picture: "picture{url}", about: "about", fan_count: "fan_count" };

test("readPaged: a field error drops only that field and asks the SAME page again; the drop is remembered for the next pages", async () => {
  prime();
  const urls = fakeGraph((u, n) => {
    if (n === 1) return fieldErr("picture");
    if (n === 2) return { body: { data: [{ id: "1" }, { id: "2" }], paging: { next: "next-url", cursors: { after: "c1" } } } };
    return { body: { data: [{ id: "3" }] } };
  });
  const { rows, truncated } = await readPaged("me/pages", { base: ["id", "name"], optional: OPT, skip: state.skip, limit: 2 });
  assert.deepEqual(rows.map((r) => r.id), ["1", "2", "3"]);
  assert.equal(truncated, false);
  assert.equal(urls.length, 3);
  assert.equal(urls[0].searchParams.get("fields"), "id,name,picture{url},about,fan_count");
  assert.equal(urls[1].searchParams.get("fields"), "id,name,about,fan_count", "same page, without the refused field only");
  assert.equal(urls[1].searchParams.get("after"), null, "the retry is the same (first) page");
  assert.equal(urls[2].searchParams.get("fields"), "id,name,about,fan_count", "later pages keep skipping it");
  assert.equal(urls[2].searchParams.get("after"), "c1");
  assert.equal(urls[0].searchParams.get("limit"), "2");
  assert.deepEqual([...state.skip], ["picture"]);
});

test("readPaged: several optional fields are dropped one at a time; an error about a required field or a non-field error is thrown", async () => {
  prime();
  const urls = fakeGraph((u, n) => (n === 1 ? fieldErr("about") : n === 2 ? fieldErr("fan_count") : { body: { data: [{ id: "1" }] } }));
  const { rows } = await readPaged("me/pages", { base: ["id"], optional: OPT, skip: state.skip });
  assert.equal(rows.length, 1);
  assert.deepEqual(urls.map((u) => u.searchParams.get("fields")), ["id,picture{url},about,fan_count", "id,picture{url},fan_count", "id,picture{url}"]);
  prime();
  fakeGraph(() => fieldErr("name"));                      // "name" is a base field, not an optional one
  await assert.rejects(readPaged("me/pages", { base: ["id", "name"], optional: OPT, skip: state.skip }), /nonexisting field \(name\)/);
  prime();
  fakeGraph(() => ({ status: 500, body: { error: { code: 1, message: "boom" } } }));
  await assert.rejects(readPaged("me/pages", { base: ["id"], optional: OPT, skip: state.skip }), /boom/);
  prime();
  fakeGraph(() => ({ body: { nope: true } }));
  await assert.rejects(readPaged("me/pages", { base: ["id"] }), /no data/);
});

test("readPaged: maxPages cuts the walk and says truncated; params ride on every page; map sees the skip state of its own page", async () => {
  prime();
  const urls = fakeGraph((u, n) => ({ body: { data: [{ id: `r${n}` }], paging: { next: "more", cursors: { after: `c${n}` } } } }));
  const { rows, truncated } = await readPaged("me/pages", { base: ["id"], params: { filter: "x" }, maxPages: 3 });
  assert.equal(urls.length, 3); assert.equal(truncated, true); assert.equal(rows.length, 3);
  assert.ok(urls.every((u) => u.searchParams.get("filter") === "x"));
  assert.deepEqual(urls.map((u) => u.searchParams.get("after")), [null, "c1", "c2"]);

  prime();
  fakeGraph((u, n) => (n === 2 ? fieldErr("about") : n === 1 ? { body: { data: [{ id: "p1" }], paging: { next: "more", cursors: { after: "c1" } } } } : { body: { data: [{ id: "p2" }] } }));
  const sk = new Set();
  const out = await readPaged("me/pages", { base: ["id"], optional: OPT, skip: sk, map: (r) => ({ ...r, noAbout: sk.has("about") }) });
  assert.deepEqual(out.rows, [{ id: "p1", noAbout: false }, { id: "p2", noAbout: true }]);
});

test("readPaged: skip may be a function (the set is swapped on a token change); Stale is never mistaken for a field error", async () => {
  prime();
  let current = new Set();
  const urls = fakeGraph((u, n) => (n === 1 ? fieldErr("picture") : { body: { data: [] } }));
  await readPaged("me/pages", { base: ["id"], optional: OPT, skip: () => current });
  assert.deepEqual([...current], ["picture"]); assert.equal(urls.length, 2);

  prime();
  const urls2 = fakeGraph(() => { state.gen++; return fieldErr("picture"); });   // the token changes while the answer is on its way
  await assert.rejects(readPaged("me/pages", { base: ["id"], optional: OPT, skip: state.skip }), (e) => e instanceof Stale);
  assert.equal(urls2.length, 1, "no retry for a stale answer"); assert.equal(state.skip.size, 0);
});

test("optionalFieldIn: only a field complaint that names a not-yet-dropped optional key counts", () => {
  const e = (code, msg, raw) => Object.assign(new Error(msg), { code, raw: raw ?? msg });
  assert.equal(optionalFieldIn(e(100, "(#100) nonexisting field (about)"), OPT, new Set()), "about");
  assert.equal(optionalFieldIn(e(100, "(#100) nonexisting field (about)"), OPT, new Set(["about"])), null, "already dropped");
  assert.equal(optionalFieldIn(e(1, "Unknown field about"), OPT, new Set()), "about", "any error that talks about a field");
  assert.equal(optionalFieldIn(e(1, "boom about"), OPT, new Set()), null, "not a field error");
  assert.equal(optionalFieldIn(e(100, "(#100) something else"), OPT, new Set()), null, "names no optional key");
});

// ---------- graph(): what may go out ----------
test("graph(): every request is an explicit GET with the token as a header and the cookies riding along, nothing else", async () => {
  prime();
  const urls = fakeGraph(() => ({ body: { id: "1" } }));
  await graph("me", { fields: "id" });
  assert.equal(urls.opts[0].method, "GET");
  assert.equal(urls.opts[0].body, undefined);
  assert.equal(urls.opts[0].credentials, "include");
  assert.match(urls.opts[0].headers.Authorization, /^Bearer EAAB/);
  assert.ok(!urls[0].search.includes("access_token"), "the token is never a query parameter");
});

test("graph(): only word segments are a path; anything else is refused before the network (an id from Graph cannot add '/', '?', '..')", async () => {
  prime();
  const urls = fakeGraph(() => ({ body: {} }));
  for (const good of ["me", "me/adaccounts", "act_123/ads", "123/owned_ad_accounts"]) await graph(good);
  assert.equal(urls.length, 4);
  for (const bad of ["", "/me", "me/", "me//x", "../me", "me/../x", "act_1/ads?x=1", "1 2/ads", "me/ads#x", "act_1/ads\n", "https://evil.test/x", "a-b", "me/adaccounts/", "%2e%2e/x", "é/x"]) {
    await assert.rejects(graph(bad), (e) => e.local === true && /invalid path/.test(e.message), JSON.stringify(bad));
  }
  assert.equal(urls.length, 4, "nothing of the refused ones was sent");
});

test("graph(): the usage header at 95 % starts the same 30 minute pause as a throttle answer; below it only the pill moves", async () => {
  prime(); state.usage = null;
  fakeGraph(() => ({ body: { data: [] }, headers: { "x-app-usage": JSON.stringify({ call_count: 94, total_time: 12 }) } }));
  await graph("me");
  assert.equal(state.usage, 94); assert.equal(state.cooldownUntil, 0, "94 % is no pause");
  fakeGraph(() => ({ body: { data: [] }, headers: { "x-business-use-case-usage": JSON.stringify({ 1001: [{ call_count: 20, total_cputime: 96 }] }) } }));
  await graph("me");
  assert.equal(state.usage, 96);
  assert.ok(state.cooldownUntil > Date.now() + 29 * 60000 && state.cooldownUntil <= Date.now() + 30 * 60000, "30 min pause");
  const urls = fakeGraph(() => ({ body: {} }));
  await assert.rejects(graph("me"), (e) => e.local === true && e.pause === true && /another 30 min|hands off/.test(e.message));
  assert.equal(urls.length, 0, "during the pause nothing goes out");
  assert.match(pauseNote(), /hands off for another (29|30) min/);
});

test("graph(): the soft hourly budget (600) counts every request per 10-minute bucket, persists it, and stops with a calm pause message", async () => {
  const fake = fakeChrome(); Object.assign(state, { token: "EAAB" + "x".repeat(70), dead: [], cooldownUntil: 0, budget: [], skip: new Set() });
  const urls = fakeGraph(() => ({ body: {} }));
  for (let i = 0; i < 3; i++) await graph("me");
  assert.equal(state.budget.reduce((n, [, c]) => n + c, 0), 3);
  assert.deepEqual(fake.store.budget, state.budget, "written to storage.session");
  assert.equal(budgetLeft(), 0);
  // 600 requests within the last hour: the oldest bucket decides when there is room again
  const now = Date.now();
  state.budget = [[now - 50 * 60000, 400], [now - 5 * 60000, 200]];
  const left = budgetLeft(now);
  assert.ok(left > 9 * 60000 && left <= 10 * 60000, `room again in ${left} ms (the 50-minute-old bucket leaves in 10 minutes)`);
  const before = urls.length;
  await assert.rejects(graph("me/adaccounts"), (e) => e.local === true && e.pause === true && /600 requests.*(9|10) min/.test(e.message), "calm message with the minutes");
  assert.equal(urls.length, before, "nothing sent past the budget");
  assert.match(pauseNote(), /600 requests/);
  // buckets older than an hour do not count
  state.budget = [[now - 61 * 60000, 600]];
  assert.equal(budgetLeft(now), 0);
  await graph("me");
  assert.equal(state.budget.length, 1, "the old bucket is dropped when a new request is counted");
  // a reopened popup reads the budget back (loadState), another window's count is followed
  const f2 = fakeChrome({ session: { budget: [[now, 599], ["x", 1], null] } });
  await loadState();
  assert.deepEqual(state.budget, [[now, 599]], "junk entries are dropped");
  emit("session", { budget: { newValue: [[now, 600]] } });
  assert.ok(budgetLeft(now) > 0);
  assert.ok(f2);
});

test("graph(): a refusal before the network says so (local); a Graph error answer does not", async () => {
  prime();
  state.token = null;
  await assert.rejects(graph("me"), (e) => e.local === true);
  prime();
  state.dead = [{ token: state.token, code: "190" }];
  await assert.rejects(graph("me"), (e) => e.local === true && e.session === true);
  prime();
  fakeGraph(() => ({ status: 400, body: { error: { code: 100, message: "(#100) bad" } } }));
  await assert.rejects(graph("me"), (e) => e.local !== true && e.code === 100);
  fakeGraph(() => ({ status: 400, body: { error: { code: 190, message: "expired" } } }));
  await assert.rejects(graph("me"), (e) => e.session === true && e.local !== true, "a session error from Graph went out");
});

test("graph(): Graph's own words are cleaned like a name (bidi and control characters)", async () => {
  prime();
  fakeGraph(() => ({ status: 400, body: { error: { code: 1, message: "Bad \u202Eexe.pdf\nsecond line" } } }));
  await assert.rejects(graph("me"), (e) => e.message === "Graph says: Bad exe.pdf second line" && e.raw === "Bad exe.pdf second line" && !/[\u202A-\u202E]/.test(e.raw));
});

test("graph(): Graph's words come with a lead in the UI language (English text, Russian lead); an answer with no words is the localized 'Graph error'", async () => {
  prime();
  fakeGraph(() => ({ status: 400, body: { error: { code: 1, message: "Invalid parameter" } } }));
  await setLang("ru");
  try {
    await assert.rejects(graph("me"), (e) => e.message === "Ответ Graph: Invalid parameter" && e.raw === "Invalid parameter");
    fakeGraph(() => ({ status: 400, body: { error: { code: 1 } } }));
    await assert.rejects(graph("me"), (e) => e.message === "Ошибка Graph");
  } finally { await setLang("en"); }
});

test("saveSession never rejects: a refused write resolves false (nobody leaves an unhandled rejection behind)", async () => {
  fakeChrome();
  chrome.storage.session.set = async () => { throw new Error("QUOTA_BYTES quota exceeded"); };
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await saveSession({ a: 1 }), false); } finally { console.warn = warn; }
  fakeChrome();
  assert.equal(await saveSession({ a: 1 }), true);
});
