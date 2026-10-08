// js/graph.js: every way an answer (or no answer) from Graph can come back, through a fake fetch. Plain Node: `node --test test/*.test.mjs`
// (what may be SENT, the usage header, the budget and readPaged are in modules.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { graph, pauseNote } from "../fb-helper/js/graph.js";
import { state, Stale, newGeneration } from "../fb-helper/js/state.js";
import { t, setLang } from "../fb-helper/js/i18n.js";
import { setup, fakeGraph, prime } from "./fakes.mjs";

await setup();
const tick = () => new Promise((res) => setImmediate(res));
const RLO = String.fromCharCode(0x202e);                 // a bidi control, built from its code point
const err = (code, message, extra = {}) => ({ status: 400, body: { error: { code, message, ...extra } } });

// ---------- answers that are not what Graph normally sends ----------
test("a non-JSON answer: an error status is just 'HTTP <status>' (a proxy page, a gateway), nothing of its text is shown", async () => {
  prime();
  for (const status of [500, 502, 503, 404]) {
    fakeGraph(() => ({ status, notJson: true }));
    await assert.rejects(graph("me"), (e) => e.message === `HTTP ${status}` && e.local !== true && e.code === undefined && e.session !== true, String(status));
  }
});

test("an answer that says nothing useful is 'Empty Graph response': a 200 that is not JSON, JSON null, a string, a number; an empty object is an answer", async () => {
  prime();
  const empty = t("err.empty");
  assert.equal(empty, "Empty Graph response");
  fakeGraph(() => ({ notJson: true }));
  await assert.rejects(graph("me"), (e) => e.message === empty, "200, body is not JSON");
  for (const body of [null, "text", 5, true]) {
    fakeGraph(() => ({ body }));
    await assert.rejects(graph("me"), (e) => e.message === empty, JSON.stringify(body));
  }
  fakeGraph(() => ({ body: {} })); assert.deepEqual(await graph("me"), {}, "an empty object is a valid answer (the caller decides)");
  fakeGraph(() => ({ body: [] })); assert.deepEqual(await graph("me"), []);
});

test("an error object inside a 200 answer is an error all the same; an error status with a JSON body that has no `error` is 'HTTP <status>'", async () => {
  prime();
  fakeGraph(() => ({ status: 200, body: { error: { code: 100, message: "(#100) hidden in a 200" } } }));
  await assert.rejects(graph("me"), (e) => e.code === 100 && e.message === "Graph says: (#100) hidden in a 200");
  fakeGraph(() => ({ status: 503, body: { message: "maintenance" } }));
  await assert.rejects(graph("me"), (e) => e.message === "HTTP 503");
});

// ---------- the words of an error ----------
test("error_user_msg (Meta's text for a person) wins over message (the technical one); message stays as `raw` for the code that reads it", async () => {
  prime();
  fakeGraph(() => err(1, "Technical: (#1) An unknown error occurred", { error_user_msg: "Your ad account is temporarily restricted", error_subcode: 33 }));
  await assert.rejects(graph("me"), (e) => e.message === "Graph says: Your ad account is temporarily restricted" && e.raw === "Technical: (#1) An unknown error occurred" && e.code === 1 && e.subcode === 33);
  fakeGraph(() => err(1, "Technical text", { error_user_msg: "" }));
  await assert.rejects(graph("me"), (e) => e.message === "Graph says: Technical text", "an empty user message falls back to the technical one");
  fakeGraph(() => err(1, "Only technical"));
  await assert.rejects(graph("me"), (e) => e.message === "Graph says: Only technical" && e.raw === "Only technical");
  fakeGraph(() => err(100, undefined));
  await assert.rejects(graph("me"), (e) => e.message === t("err.graph") && e.code === 100 && e.raw === "", "no words at all: the localized 'Graph error'");
});

test("Graph's words are cleaned and cut before they reach a toast: bidi / control characters out, 500 characters at most", async () => {
  prime();
  fakeGraph(() => err(1, "x", { error_user_msg: `Fake${RLO}fdp.exe\r\nline two` }));
  await assert.rejects(graph("me"), (e) => e.message === "Graph says: Fakefdp.exe line two");
  fakeGraph(() => err(1, "y".repeat(2000)));
  await assert.rejects(graph("me"), (e) => e.raw.length === 500 && e.message === `Graph says: ${"y".repeat(500)}`);
});

// ---------- the API version ----------
test("#2635 naming a newer version: asked once more on that version, which is kept for next time; never on the same version, never forever", async () => {
  const fake = prime({ apiVersion: "v26.0" });
  const urls = fakeGraph((u) => (u.pathname.startsWith("/v26.0/") ? err(2635, "(#2635) You are calling a deprecated version of the Ads API. Please update to the latest version: v27.0.") : { body: { id: "1" } }));
  assert.deepEqual(await graph("me"), { id: "1" });
  assert.deepEqual(urls.map((u) => u.pathname), ["/v26.0/me", "/v27.0/me"], "the same call, once, on the version Graph named");
  assert.equal(state.apiVersion, "v27.0");
  await tick();
  assert.deepEqual(fake.calls.localSet, [{ apiVersion: "v27.0" }], "kept in storage.local: it outlives the browser");
  await graph("me/adaccounts");
  assert.equal(urls.at(-1).pathname, "/v27.0/me/adaccounts", "the next call starts on the new version");
  // the new version is deprecated too: one retry is all a call gets
  prime({ apiVersion: "v26.0" });
  const n = fakeGraph((u) => err(2635, `(#2635) update to the latest version: ${u.pathname.startsWith("/v26.0/") ? "v27.0" : "v28.0"}.`));
  await assert.rejects(graph("me"), (e) => e.message === t("err.version", { v: "v27.0" }) && e.code === undefined && e.local !== true);
  assert.equal(n.length, 2, "26 → 27, and the second #2635 ends it (a retried call adopts nothing more: the message names the version it ran on)");
  assert.equal(state.apiVersion, "v27.0");
});

test("#2635 without a newer version (none named, the same one, an older one, an absurd one): no retry, the extension must be updated", async () => {
  for (const message of ["(#2635) You are calling a deprecated version of the Ads API.", "(#2635) update to v26.0", "(#2635) update to v25.0", "(#2635) update to v999.0", "(#2635) update to vNEXT"]) {
    const fake = prime({ apiVersion: "v26.0" });
    const urls = fakeGraph(() => err(2635, message));
    await assert.rejects(graph("me"), (e) => e.message === t("err.version", { v: "v26.0" }) && /deprecated/.test(e.message), message);
    assert.equal(urls.length, 1, `${message}: nothing was sent twice`);
    assert.equal(state.apiVersion, "v26.0", "the version did not move"); await tick();
    assert.deepEqual(fake.calls.localSet, [], "and nothing was stored");
  }
});

test("the version warning header names the version the call was upgraded to: the newest one named wins, an old or absurd one is ignored", async () => {
  const fake = prime({ apiVersion: "v26.0" });
  const urls = fakeGraph(() => ({ body: {}, headers: { "x-ad-api-version-warning": "Version v26.0 is deprecated; the call was upgraded to v28.0 (v27.0 as well)" } }));
  await graph("me");
  assert.equal(state.apiVersion, "v28.0", "the newest named, not the first"); await tick();
  assert.deepEqual(fake.calls.localSet, [{ apiVersion: "v28.0" }]);
  fakeGraph(() => ({ body: {}, headers: { "x-ad-api-version-warning": "upgraded to v27.0 and then v999.0" } }));
  await graph("me");
  assert.equal(state.apiVersion, "v28.0", "never back to an older one, never to an absurd one");
  assert.equal(urls.length, 1);
});

// ---------- no answer ----------
test("a network error is 'Can't reach Graph' with the browser's own words kept out of it; something was sent, so it is not a local refusal", async () => {
  prime();
  fakeGraph(() => ({ reject: new TypeError("Failed to fetch") }));
  await assert.rejects(graph("me"), (e) => e.message === t("err.net") && e.local !== true && !e.session && e.code === undefined);
  assert.equal(t("err.net"), "Can't reach Graph — check the network");
});

test("a timeout (the request's own 20 s timer) says so; an abort from nowhere in particular is the same words; neither starts a pause", async () => {
  prime();
  for (const name of ["TimeoutError", "AbortError"]) {
    fakeGraph(() => ({ reject: Object.assign(new Error("The operation was aborted due to timeout"), { name }) }));
    await assert.rejects(graph("me"), (e) => e.message === t("err.timeout", { n: 20 }) && e.local !== true, name);
  }
  assert.equal(t("err.timeout", { n: 20 }), "Graph did not answer in 20 s");
  assert.equal(state.cooldownUntil, 0, "a slow answer is no throttle");
});

test("a token change aborts a request that is on its way: it ends as Stale (the answer would be for the old login), and nothing is reported", async () => {
  prime();
  const urls = fakeGraph(() => ({ hang: true }));
  const pending = graph("me");
  await tick();
  assert.equal(urls.length, 1); assert.equal(urls.opts[0].signal.aborted, false);
  newGeneration();
  await assert.rejects(pending, (e) => e instanceof Stale);
  assert.equal(urls.opts[0].signal.aborted, true, "the fetch's signal was aborted");
  // a failure that arrives after the token changed is stale too, whatever it says
  prime();
  fakeGraph(() => { state.gen++; return { reject: new TypeError("Failed to fetch") }; });
  await assert.rejects(graph("me"), (e) => e instanceof Stale);
});

// ---------- the throttle ----------
test("a throttle answer starts the 30 minute pause on every tab's behalf: codes 4, 17, 32, 613, the business-use-case range 80000-80999, and HTTP 429", async () => {
  const cases = [[4, "(#4) Application request limit reached"], [17, "(#17) User request limit reached"], [32, "(#32) Page request limit reached"], [613, "(#613) Calls to this api have exceeded the rate limit"],
    [80000, "(#80000) Ads management rate limit"], [80004, "(#80004) There have been too many calls to this ad-account"], [80999, "(#80999) edge of the range"]];
  for (const [code, message] of cases) {
    const fake = prime();
    const urls = fakeGraph(() => err(code, message));
    await assert.rejects(graph("me"), (e) => e.message === t("err.limit", { c: t("err.code", { c: code }) }) && e.local !== true && e.pause !== true, String(code));
    assert.ok(state.cooldownUntil > Date.now() + 29 * 60000 && state.cooldownUntil <= Date.now() + 30 * 60000, `${code}: 30 minutes`);
    assert.equal(fake.store.cooldownUntil, state.cooldownUntil, `${code}: kept in storage.session for the next popup and the other windows`);
    assert.match(pauseNote(), /hands off for another (29|30) min/);
    await assert.rejects(graph("me"), (e) => e.local === true && e.pause === true, "the next call is refused before the network");
    assert.equal(urls.length, 1, `${code}: no retry, nothing else sent`);
  }
  prime();
  fakeGraph(() => ({ status: 429, notJson: true }));
  await assert.rejects(graph("me"), (e) => e.message === t("err.limit", { c: "HTTP 429" }), "a 429 with no body at all");
  assert.ok(state.cooldownUntil > Date.now() + 29 * 60000);
  assert.equal(t("err.limit", { c: "HTTP 429" }), "API limit (HTTP 429). Paused 30 min, do not retry");
});

test("other error codes are no throttle: no pause, the next call goes out (3, 100, 190 is a dead session, 200, 79999 and 81000 are outside the range)", async () => {
  for (const code of [1, 3, 100, 200, 368, 79999, 81000]) {
    prime();
    const urls = fakeGraph(() => err(code, `(#${code}) something`));
    await assert.rejects(graph("me"), (e) => e.code === code && e.local !== true);
    assert.equal(state.cooldownUntil, 0, String(code)); assert.equal(pauseNote(), null);
    await assert.rejects(graph("me"));
    assert.equal(urls.length, 2, `${code}: the second call was sent`);
  }
});

test("a throttle answer that arrives after a token change still starts the pause (the limit is real whoever asked) but the call ends as Stale", async () => {
  prime();
  fakeGraph(() => { state.gen++; return err(4, "(#4) limit"); });
  // the throttle check comes before the generation check: the caller gets the limit message, and the pause is on
  await assert.rejects(graph("me"), (e) => e.message === t("err.limit", { c: t("err.code", { c: 4 }) }));
  assert.ok(state.cooldownUntil > Date.now() + 29 * 60000);
});

test("a throttle answer is not made worse by the usage header it carries, and a header on an ordinary answer only moves the pill", async () => {
  prime();
  fakeGraph(() => ({ ...err(4, "(#4) limit"), headers: { "x-app-usage": JSON.stringify({ call_count: 100 }) } }));
  await assert.rejects(graph("me"), (e) => e.message.startsWith("API limit"));
  const first = state.cooldownUntil;
  assert.ok(first > 0);
  prime({ cooldownUntil: 0 });
  fakeGraph(() => ({ body: {}, headers: { "x-app-usage": JSON.stringify({ call_count: 40 }) } }));
  await graph("me");
  assert.equal(state.usage, 40); assert.equal(state.cooldownUntil, 0);
});
