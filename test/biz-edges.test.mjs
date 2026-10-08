// js/biz-edges.js: the walk over the edges of the profile's businesses that the Ad accounts and Pages tabs share. Plain Node with a fake
// chrome.storage and a fake fetch: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../fb-helper/js/i18n.js";
import { setGraphUrl } from "../fb-helper/js/config.js";
import { state, Stale } from "../fb-helper/js/state.js";
import { readPaged } from "../fb-helper/js/graph.js";
import { businessList, readBusinessEdges, MAX_BUSINESSES } from "../fb-helper/js/biz-edges.js";

Object.defineProperty(globalThis, "navigator", { value: { locks: { request: (_n, fn) => fn() } }, configurable: true, writable: true });
setGraphUrl("https://graph.test/");
await setLang("en");

const prime = () => {
  globalThis.chrome = { storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} }, local: { get: async () => ({}), set: async () => {} } } };
  Object.assign(state, { token: "EAAB" + "x".repeat(70), dead: [], cooldownUntil: 0, budget: [], gen: state.gen, skip: new Set() });
};
// A fake Graph: handler(url) → { status, body }; every url is recorded.
function fakeGraph(handler) {
  const urls = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url); urls.push(u);
    const out = handler(u, urls.length) || {};
    return { ok: (out.status || 200) < 400, status: out.status || 200, headers: new Headers(), json: async () => out.body };
  };
  return urls;
}
const isBms = (u) => u.pathname.endsWith("/me/businesses");
const bms = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ id: String(1000 + from + i), name: `Biz ${from + i}` }));
const edgeOf = (u) => (/\/(\d+)\/(\w+)$/.exec(u.pathname) || []).slice(1);
// readEdge as a tab writes it: one readPaged of the edge, rows tagged with the business.
const reader = (opts = {}) => (path, bm, edge) => readPaged(path, { base: ["id"], limit: 50, maxPages: 3, map: (r) => ({ ...r, bm: bm.id, edge }), ...opts });

test("businessList: digits-only ids, each once, names cleaned, at most 50; `more` says some were left out", () => {
  const { list, more } = businessList([{ id: "555", name: "Nova\nMedia" }, { id: 777 }, { id: "555", name: "dup" }, { id: "x1", name: "bad" }, { id: "../2" }, null, { name: "no id" }]);
  assert.deepEqual(list, [{ id: "555", name: "Nova Media" }, { id: "777" }]); assert.equal(more, false);
  assert.deepEqual(businessList(undefined), { list: [], more: false });
  const many = businessList(Array.from({ length: 60 }, (_, i) => ({ id: String(1000 + i), name: `B${i}` })));
  assert.equal(many.list.length, MAX_BUSINESSES); assert.equal(many.more, true);
  assert.equal(businessList([{ id: "5" }], true).more, true, "Graph says there is a next page");
});

test("readBusinessEdges: the business list is asked with limit 51 (one over the cap), then every owned edge, then every client edge, in order", async () => {
  prime();
  const urls = fakeGraph((u) => (isBms(u) ? { body: { data: bms(2) } } : { body: { data: [{ id: edgeOf(u).join("-") }] } }));
  const r = await readBusinessEdges({ gen: state.gen, edges: ["owned", "client"], readEdge: reader() });
  assert.equal(urls[0].searchParams.get("limit"), "51"); assert.equal(urls[0].searchParams.get("fields"), "id,name");
  assert.deepEqual(urls.slice(1).map((u) => edgeOf(u).join("/")), ["1001/owned", "1002/owned", "1001/client", "1002/client"], "owned edges of every business first");
  assert.deepEqual(r.rows.map((x) => x.id), ["1001-owned", "1002-owned", "1001-client", "1002-client"]);
  assert.deepEqual([r.truncated, r.failed], [false, false]);
  assert.deepEqual(r.rows.map((x) => [x.bm, x.edge]), [["1001", "owned"], ["1002", "owned"], ["1001", "client"], ["1002", "client"]], "the tab's map saw the business and the edge");
});

test("readBusinessEdges: more than 50 businesses (the 51st is seen, or paging.next) → only 50 walked and the answer is truncated", async () => {
  prime();
  let urls = fakeGraph((u) => (isBms(u) ? { body: { data: bms(51) } } : { body: { data: [] } }));
  let r = await readBusinessEdges({ gen: state.gen, edges: ["owned", "client"], readEdge: reader() });
  assert.equal(urls.length - 1, 100, "50 businesses × 2 edges"); assert.equal(r.truncated, true); assert.equal(r.failed, false);
  assert.ok(!urls.some((u) => !isBms(u) && u.pathname.includes("/1051/")), "the 51st business is not read");
  urls = fakeGraph((u) => (isBms(u) ? { body: { data: bms(3), paging: { next: "x", cursors: { after: "c" } } } } : { body: { data: [] } }));
  r = await readBusinessEdges({ gen: state.gen, edges: ["owned"], readEdge: reader() });
  assert.equal(r.truncated, true, "paging.next alone is enough"); assert.equal(urls.length, 4);
});

test("readBusinessEdges: an edge that hits its page limit makes the answer truncated; an edge that errors is skipped, the rest stays, failed = true", async () => {
  prime();
  const urls = fakeGraph((u) => {
    if (isBms(u)) return { body: { data: bms(3) } };
    const [bm] = edgeOf(u);
    if (bm === "1001") return { body: { data: [{ id: `${bm}-${u.searchParams.get("after") || "p1"}` }], paging: { next: "x", cursors: { after: `c${urls.length}` } } } };   // endless
    if (bm === "1002") return { status: 400, body: { error: { code: 200, message: "(#200) no" } } };
    return { body: { data: [{ id: "ok" }] } };
  });
  const r = await readBusinessEdges({ gen: state.gen, edges: ["owned"], readEdge: reader({ maxPages: 3 }) });
  assert.equal(urls.filter((u) => edgeOf(u)?.[0] === "1001" && !isBms(u)).length, 3, "3 pages of the endless edge, then it stops");
  assert.equal(r.truncated, true); assert.equal(r.failed, true);
  assert.deepEqual(r.rows.map((x) => x.id).filter((x) => x === "ok"), ["ok"], "the business after the failing one was still read");
});

test("readBusinessEdges: the business list itself failing is a failed, empty answer — never an error and never a complete one", async () => {
  prime();
  fakeGraph(() => ({ status: 400, body: { error: { code: 200, message: "(#200) business_management" } } }));
  assert.deepEqual(await readBusinessEdges({ gen: state.gen, edges: ["owned"], readEdge: reader() }), { rows: [], truncated: false, failed: true });
  fakeGraph(() => ({ status: 500, body: { error: { code: 1, message: "boom" } } }));
  assert.equal((await readBusinessEdges({ gen: state.gen, edges: ["owned"], readEdge: reader() })).failed, true);
});

test("readBusinessEdges: the walk ends as soon as the session is dead, the API pause starts or the budget is spent (the rest counts as failed)", async () => {
  prime();
  let urls = fakeGraph((u) => (isBms(u) ? { body: { data: bms(4) } } : edgeOf(u)[0] === "1002" ? { status: 400, body: { error: { code: 190, message: "expired" } } } : { body: { data: [] } }));
  let r = await readBusinessEdges({ gen: state.gen, edges: ["owned", "client"], readEdge: reader() });
  assert.equal(urls.filter((u) => !isBms(u)).length, 2, "1001 read, 1002 answered 190 (dead): nothing after it is sent");
  assert.equal(r.failed, true);
  prime();
  urls = fakeGraph((u) => (isBms(u) ? { body: { data: bms(4) } } : edgeOf(u)[0] === "1002" ? { status: 429, body: { error: { code: 4, message: "limit" } } } : { body: { data: [] } }));
  r = await readBusinessEdges({ gen: state.gen, edges: ["owned"], readEdge: reader() });
  assert.equal(urls.filter((u) => !isBms(u)).length, 2, "a throttle answer starts the pause: the last two businesses are not asked");
  assert.equal(r.failed, true);
  prime(); state.budget = [[Date.now(), 599]];
  urls = fakeGraph((u) => (isBms(u) ? { body: { data: bms(4) } } : { body: { data: [] } }));
  r = await readBusinessEdges({ gen: state.gen, edges: ["owned"], readEdge: reader() });   // the list read is the 600th request
  assert.equal(urls.length, 1, "the budget is spent after the business list: no edge is sent"); assert.equal(r.failed, true);
});

test("readBusinessEdges: a token change ends the walk with Stale, checked before every edge; nothing else is ever thrown", async () => {
  prime();
  const urls = fakeGraph((u) => { if (!isBms(u) && edgeOf(u)[0] === "1001") state.gen++; return isBms(u) ? { body: { data: bms(3) } } : { body: { data: [] } }; });
  await assert.rejects(readBusinessEdges({ gen: state.gen, edges: ["owned"], readEdge: reader() }), (e) => e instanceof Stale);
  assert.equal(urls.filter((u) => !isBms(u)).length, 1, "the second business is not asked");
});

test("readBusinessEdges: one skip set shared by the walk is what the tab's readEdge decides — a field refused on the first edge is not asked again", async () => {
  prime();
  const skip = new Set();
  const OPT = { insights: "insights{spend}" };
  const urls = fakeGraph((u) => {
    if (isBms(u)) return { body: { data: bms(3) } };
    return (u.searchParams.get("fields") || "").includes("insights") ? { status: 400, body: { error: { code: 100, message: "(#100) Tried accessing nonexisting field (insights) on node type (AdAccount)" } } } : { body: { data: [{ id: "x" }] } };
  });
  const r = await readBusinessEdges({ gen: state.gen, edges: ["owned"], readEdge: (path) => readPaged(path, { base: ["id"], optional: OPT, skip }) });
  const edge = urls.filter((u) => !isBms(u));
  assert.equal(edge.length, 4, "first edge twice (refused, then without), the other two once");
  assert.equal(edge.filter((u) => u.searchParams.get("fields").includes("insights")).length, 1);
  assert.deepEqual([r.failed, r.truncated, r.rows.length], [false, false, 3]);
});
