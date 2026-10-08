// js/pictures.js: the separate, silent read of pictures (GET /<version>/?ids=…&fields=…) that fills in what a list read left without a picture.
// Plain Node with a fake chrome.storage and a fake fetch: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { state, loadState, newGeneration } from "../fb-helper/js/state.js";
import { on, emit } from "../fb-helper/js/bus.js";
import { setGraphUrl } from "../fb-helper/js/config.js";
import { sortPages } from "../fb-helper/js/pages-model.js";
import { readPictures, picturelessPages, picturelessBusinesses, groupLogoIds, picturesOf, IDS_PER_READ, MAX_READS } from "../fb-helper/js/pictures.js";
import { setup, fakeGraph, prime } from "./fakes.mjs";

await setup();
const CDN = (n) => `https://scontent.xx.fbcdn.net/v/t39.30808-1/${n}.jpg`;
const ids = (n, from = 0) => Array.from({ length: n }, (_, i) => String(100000000000000 + from + i));
const idsOf = (u) => u.searchParams.get("ids").split(",");
// A Graph that knows every id it is asked about: a page's wrapped picture, or a business's profile_picture_uri.
const knows = (kind, pick = () => true) => (u) => ({ body: Object.fromEntries(idsOf(u).filter(pick).map((id) => [id, kind === "page" ? { id, picture: { data: { url: CDN(id), height: 50, width: 50, is_silhouette: false } } } : { id, profile_picture_uri: CDN(id) }])) });
const reset = (over = {}) => { const fake = prime(over); state.pics = {}; return fake; };
const pictureEvents = () => { const seen = []; const off = on("pictures", () => seen.push(1)); return { seen, off }; };

test("pages: the ids go in one batch with fields=picture{url}; the URL is read from picture.data.url, kept in state.pics and saved in storage.session; the redraw event goes out", async () => {
  const fake = reset(); const ev = pictureEvents();
  const urls = fakeGraph(knows("page"));
  await readPictures("page", ids(3), state.gen);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, "/v26.0/"); assert.equal(urls[0].searchParams.get("fields"), "picture{url}"); assert.deepEqual(idsOf(urls[0]), ids(3));
  assert.deepEqual(state.pics, Object.fromEntries(ids(3).map((id) => [id, CDN(id)])));
  assert.deepEqual(fake.store.pics, state.pics, "saved next to the lists");
  assert.equal(ev.seen.length, 1); ev.off();
});

test("businesses: fields=profile_picture_uri, the URL is the string itself", async () => {
  reset();
  const urls = fakeGraph(knows("business"));
  await readPictures("business", ids(2), state.gen);
  assert.equal(urls[0].searchParams.get("fields"), "profile_picture_uri");
  assert.deepEqual(state.pics, Object.fromEntries(ids(2).map((id) => [id, CDN(id)])));
});

test("at most 50 ids per request and 4 requests per load; every id that was named is settled (a URL, or \"\" for none), also the ones past the cap", async () => {
  reset();
  const urls = fakeGraph(knows("business", (id) => Number(id) % 2 === 0));
  await readPictures("business", ids(230), state.gen);
  assert.equal(IDS_PER_READ, 50); assert.equal(MAX_READS, 4);
  assert.deepEqual(urls.map((u) => idsOf(u).length), [50, 50, 50, 50], "4 reads of 50, the last 30 are not asked");
  assert.equal(Object.keys(state.pics).length, 230);
  const [a, b] = ids(2);
  assert.equal(state.pics[a], CDN(a)); assert.equal(state.pics[b], "", "asked, nothing found");
  assert.equal(state.pics[ids(230)[229]], "", "past the cap: no URL, and not asked");
});

test("the answer is checked like every picture URL: a host that is not Meta's, http, junk and a missing node are all \"\" (no picture), never kept", async () => {
  reset();
  const [a, b, c, d, e] = ids(5);
  fakeGraph(() => ({ body: { [a]: { picture: { data: { url: "https://evil.example.com/t.png" } } }, [b]: { picture: { data: { url: "http://scontent.xx.fbcdn.net/a.jpg" } } }, [c]: { picture: "https://scontent.xx.fbcdn.net/a.jpg" }, [d]: { id: d }, [e]: { picture: { data: { url: CDN("ok") } } } } }));
  await readPictures("page", [a, b, c, d, e, ids(1, 9)[0]], state.gen);
  assert.deepEqual(state.pics, { [a]: "", [b]: "", [c]: "", [d]: "", [e]: CDN("ok"), [ids(1, 9)[0]]: "" });
});

test("only digit-only ids are asked, each once; nothing to ask = no request", async () => {
  reset();
  const urls = fakeGraph(knows("page"));
  await readPictures("page", ["1001", "1001", "x2", "../3", "", null, undefined, 1002, "1".repeat(26)], state.gen);
  assert.deepEqual(idsOf(urls[0]), ["1001", "1002"]);
  await readPictures("page", [], state.gen); await readPictures("page", ["x"], state.gen); await readPictures("page", undefined, state.gen);
  assert.equal(urls.length, 1);
});

test("a failed read is silent: every answer Graph can give leaves the ids settled as \"\" (the icon, or a page's redirect), nothing is thrown, no retry", async () => {
  for (const out of [{ status: 400, body: { error: { code: 100, message: "(#100) Object with ID '5' does not exist, cannot be loaded due to missing permissions" } } }, { status: 400, body: { error: { code: 100, message: "(#100) Tried accessing nonexisting field (picture)" } } },
    { status: 500, notJson: true }, { reject: new TypeError("Failed to fetch") }, { body: null }, { body: [] }]) {
    const fake = reset();
    const urls = fakeGraph(() => out);
    await readPictures("page", ids(3), state.gen);
    assert.equal(urls.length, 1, `one request, no retry: ${JSON.stringify(out).slice(0, 60)}`);
    assert.deepEqual(state.pics, Object.fromEntries(ids(3).map((id) => [id, ""])));
    assert.deepEqual(fake.store.pics, state.pics);
  }
});

test("one chunk that fails spoils only its own 50: the next chunk is still asked", async () => {
  reset();
  const urls = fakeGraph((u, n) => (n === 1 ? { status: 400, body: { error: { code: 100, message: "(#100) Object with ID does not exist" } } } : knows("business")(u)));
  await readPictures("business", ids(120), state.gen);
  assert.equal(urls.length, 3);
  assert.equal(state.pics[ids(1)[0]], "", "the first 50: refused"); assert.equal(state.pics[ids(1, 60)[0]], CDN(ids(1, 60)[0]), "the next ones: found");
});

test("a throttle answer starts the API pause and the remaining chunks are not asked (nothing goes out during the pause); everything is still settled", async () => {
  reset();
  const urls = fakeGraph((u, n) => (n === 2 ? { status: 429, body: { error: { code: 4, message: "limit" } } } : knows("business")(u)));
  await readPictures("business", ids(160), state.gen);
  assert.equal(urls.length, 2, "the third chunk is held back by the pause");
  assert.ok(state.cooldownUntil > Date.now());
  assert.equal(Object.keys(state.pics).length, 160);
  assert.equal(state.pics[ids(1)[0]], CDN(ids(1)[0])); assert.equal(state.pics[ids(1, 55)[0]], "");
});

test("a dead session, an API pause and a spent budget send nothing at all (the ids are settled: a page draws its redirect, a business its icon)", async () => {
  const stops = { dead: () => { state.dead = [{ token: state.token, code: "190" }]; }, pause: () => { state.cooldownUntil = Date.now() + 60000; }, budget: () => { state.budget = [[Date.now(), 600]]; } };
  for (const [name, stop] of Object.entries(stops)) {
    reset(); stop();
    const urls = fakeGraph(knows("page"));
    await readPictures("page", ids(2), state.gen);
    assert.equal(urls.length, 0, name);
    assert.deepEqual(state.pics, Object.fromEntries(ids(2).map((id) => [id, ""])), name);
  }
});

test("a token change while the answer is on its way drops it: nothing is written, nothing is announced", async () => {
  const fake = reset(); const ev = pictureEvents();
  fakeGraph((u) => { newGeneration(); return knows("page")(u); });
  await readPictures("page", ids(2), state.gen);
  assert.deepEqual(state.pics, {}); assert.equal(fake.store.pics, undefined); assert.equal(ev.seen.length, 0);
  ev.off();
  reset();
  const urls = fakeGraph(knows("page"));
  await readPictures("page", ids(2), state.gen - 1);          // the load started in an older generation
  assert.equal(urls.length, 0, "an old generation sends nothing");
  assert.deepEqual(state.pics, {}, "and writes nothing");
});

test("an id a read is already under way for is not asked twice (the Businesses and Accounts tabs finish at the same time); afterwards it can be asked again", async () => {
  reset();
  const urls = fakeGraph(knows("business"));
  await Promise.all([readPictures("business", ids(3), state.gen), readPictures("business", ids(5), state.gen)]);
  assert.deepEqual(urls.map(idsOf), [ids(3), ids(2, 3)], "the second call asked only for the two the first one did not have");
  await readPictures("business", ids(2), state.gen);
  assert.equal(urls.length, 3, "a later load asks again (a list refresh)");
});

test("a URL known from before is kept when a later read finds none; a new URL replaces it", async () => {
  reset();
  const [a, b] = ids(2);
  state.pics = { [a]: CDN("old-a"), [b]: CDN("old-b") };
  fakeGraph(() => ({ body: { [b]: { profile_picture_uri: CDN("new-b") } } }));
  await readPictures("business", [a, b], state.gen);
  assert.deepEqual(state.pics, { [a]: CDN("old-a"), [b]: CDN("new-b") });
});

test("state.pics is read back at start (junk and foreign hosts cut) and follows another window's write, without announcing our own", async () => {
  const fake = reset({});
  const [a, b, c] = ids(3);
  fake.store.pics = { [a]: CDN("a"), [b]: "", [c]: "https://evil.example.com/x.png", "x1": CDN("x"), "../2": CDN("y") };
  await loadState();
  assert.deepEqual(state.pics, { [a]: CDN("a"), [b]: "" });
  fake.store.pics = "junk"; await loadState();
  assert.deepEqual(state.pics, {});
  const ev = pictureEvents();
  emit("session", { pics: { newValue: { [a]: CDN("w"), [c]: "javascript:alert(1)" } } });
  assert.deepEqual(state.pics, { [a]: CDN("w") }); assert.equal(ev.seen.length, 1);
  emit("session", { pics: { newValue: { [a]: CDN("w") } } });
  assert.equal(ev.seen.length, 1, "the same content again: no redraw");
  emit("session", { pics: {} });
  assert.deepEqual(state.pics, {}); assert.equal(ev.seen.length, 2);
  ev.off();
});

// ---------- which rows ----------
test("picturelessPages: pages without a URL in the order the tab shows them; an unpublished page seen only through a business is left out (it could spoil the batch)", () => {
  const pages = [
    { id: "3", name: "C", picture: CDN("c") }, { id: "2", name: "B", is_published: true, tasks: ["ADVERTISE"] }, { id: "1", name: "A" },
    { id: "4", name: "D", is_published: false, _viaBm: "9" }, { id: "5", name: "E", is_published: false }, { id: "6", name: "F", _viaBm: "9" },
  ];
  const got = picturelessPages(pages);
  assert.deepEqual(got, sortPages(pages).map((p) => p.id).filter((id) => id !== "3" && id !== "4"), "the tab's own order, without the page that has a URL and the unpublished one found only through a business");
  assert.deepEqual([...got].sort(), ["1", "2", "5", "6"]);
  assert.deepEqual(picturelessPages(undefined), []);
});

test("picturelessBusinesses: the rows of the list without a logo URL", () => {
  assert.deepEqual(picturelessBusinesses([{ id: "1", profile_picture_uri: CDN("a") }, { id: "2" }, null, { id: "3", name: "x" }]), ["2", "3"]);
  assert.deepEqual(picturelessBusinesses(undefined), []);
});

test("groupLogoIds: the businesses of the groups that are the profile's own, not on the Businesses list, not asked before", () => {
  const acc = (biz) => ({ account_id: "a", business: biz ? { id: biz, name: "n" } : undefined });
  const accounts = [acc("11"), acc("12"), acc("13"), acc("14"), acc("11"), acc(null), acc("15")];
  assert.deepEqual(groupLogoIds(accounts, ["11", "12", "13", "99"], [{ id: "12" }], { 13: "" }), ["11"], "12 is on the Businesses list, 13 was asked, 14 and 15 are not the profile's own (a client's business may not be readable)");
  assert.deepEqual(groupLogoIds(accounts, [], [], {}), [], "no business of the profile known: no request");
  assert.deepEqual(groupLogoIds(accounts, ["11"], undefined, { 11: CDN("x") }), []);
});

// ---------- what the screen draws ----------
test("picturesOf: the list's URL, then the one found by the picture read; a page adds the Graph picture redirect once it has a URL or has been asked about; a business never does", () => {
  setGraphUrl("https://graph.test/");
  try {
    state.apiVersion = "v26.0"; state.pics = { 1: CDN("got"), 2: "" };
    assert.deepEqual(picturesOf("business", "1", CDN("own")), [CDN("own"), CDN("got")]);
    assert.deepEqual(picturesOf("business", "2", undefined), [], "asked, nothing: the icon");
    assert.deepEqual(picturesOf("business", "3", undefined), []);
    assert.deepEqual(picturesOf("page", "1", CDN("own")), [CDN("own"), CDN("got"), "https://graph.test/v26.0/1/picture?type=small"]);
    assert.deepEqual(picturesOf("page", "2", undefined), ["https://graph.test/v26.0/2/picture?type=small"], "asked, nothing found: the redirect");
    assert.deepEqual(picturesOf("page", "3", undefined), [], "never asked about: no image request yet, one per row would go out at the first draw");
    assert.deepEqual(picturesOf("page", "4", CDN("own")), [CDN("own"), "https://graph.test/v26.0/4/picture?type=small"], "a list URL that fails to load has the redirect behind it");
    state.apiVersion = "v27.0";
    assert.equal(picturesOf("page", "2", undefined)[0], "https://graph.test/v27.0/2/picture?type=small", "the version Graph moved us to");
  } finally { setGraphUrl("https://graph.test/"); state.apiVersion = "v26.0"; state.pics = {}; }
});
