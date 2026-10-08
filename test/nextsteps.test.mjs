// js/nextsteps.js: which Facebook page each blocked / unpaid / under-review account (or rejected ad) is sent to.
// Walks every status x reason combination and every table row. Strings come from js/strings/actions.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountSteps, adSteps, ACCOUNT_ROWS, ACTIONS, AD_ROW, ANY, SET } from "../fb-helper/js/nextsteps.js";
import { LINKS } from "../fb-helper/js/links.js";
import { STRINGS } from "../fb-helper/js/strings/actions.js";
import { LANGS, setLang, has } from "../fb-helper/js/i18n.js";

const STATUSES = [1, 2, 3, 7, 8, 9, 100, 101];
const REASONS = Array.from({ length: 16 }, (_, i) => i);                                  // 0..15 (Meta's enum)
// What Graph / a stale cache could hand over besides the enum: unknown codes, strings, nothing at all.
const ODD_STATUS = [0, 4, 5, 6, 10, 99, 102, -1, "2", "abc", null, undefined, NaN, 1.5];
const ODD_REASON = [16, 99, -1, "3", "abc", null, undefined, NaN, 2.5];
const ID = "123456789";
const FB = /^https:\/\/([a-z0-9-]+\.)*facebook\.com\//;

const steps = (account_status, disable_reason, ...rest) => accountSteps({ account_id: rest.length ? rest[0] : ID, account_status, disable_reason });   // steps(st, r, undefined) = no id
const ids = (s) => s.actions.map((a) => a.id);
const primary = (s) => s.actions.find((a) => a.primary)?.id ?? null;

function shapeOk(s, where) {
  assert.ok(s && typeof s === "object", where);
  assert.ok([null, "bad", "warn"].includes(s.tone), `${where}: tone ${s.tone}`);
  assert.ok(s.help === null || (typeof s.help === "string" && s.help.startsWith("next.help.")), `${where}: help ${s.help}`);
  assert.ok(Array.isArray(s.actions), where);
  assert.equal(s.tone === null, s.help === null, `${where}: tone and help go together`);
  if (s.tone === null) assert.equal(s.actions.length, 0, `${where}: a healthy / unknown account has no buttons`);
  assert.ok(s.actions.filter((a) => a.primary).length <= 1, `${where}: at most one primary`);
  if (s.actions.some((a) => a.primary)) assert.ok(s.actions[0].primary, `${where}: the primary button comes first`);
  assert.equal(new Set(ids(s)).size, s.actions.length, `${where}: no button twice`);
  for (const a of s.actions) {
    assert.deepEqual(Object.keys(a).sort(), ["id", "label", "primary", "url"], where);
    assert.ok(a.id in ACTIONS && a.label === ACTIONS[a.id].label, `${where}: ${a.id}`);
    assert.equal(typeof a.primary, "boolean", where);
    assert.match(a.url, FB, `${where}: ${a.id} -> ${a.url}`);
  }
}

test("every status x reason (enum, unknown, odd types) returns a valid shape", () => {
  let n = 0;
  for (const st of [...STATUSES, ...ODD_STATUS]) for (const r of [...REASONS, ...ODD_REASON]) { shapeOk(steps(st, r), `status ${st} reason ${r}`); n++; }
  assert.ok(n > 400, `only ${n} combinations`);
  for (const bad of [undefined, null, {}, { account_status: 2 }]) shapeOk(accountSteps(bad), `input ${JSON.stringify(bad)}`);
});

test("the mapping: exactly the decided buttons per status / reason", () => {
  // [status, reasons, primary, all buttons in order]
  const rows = [
    [2, [1, 2, 5, 6, 11, 12, 13, 14, 0, 16, 99], "review", ["review", "adsManager"]],       // appeal (incl. NONE / unknown reason)
    [2, [3], "review", ["review", "billing"]],                                              // payment risk
    [2, [15], "secure", ["secure", "review"]],                                              // compromised: secure the login, then appeal
    [2, [4, 7, 8, 9, 10], null, ["support", "quality"]],                                    // no self-serve appeal
    [3, [0, 1, 3], "pay", ["pay"]], [8, [0, 3], "pay", ["pay"]], [9, [0, 3], "pay", ["pay"]],
    [7, [0, 1], null, ["quality"]],
    [100, [0, 7], null, ["support"]], [101, [0, 7], null, ["support"]],
    [1, REASONS.slice(1), "review", ["review"]],                                            // restricted while active
  ];
  for (const [st, reasons, prim, all] of rows) for (const r of reasons) {
    const s = steps(st, r);
    assert.equal(primary(s), prim, `status ${st} reason ${r}: primary`);
    assert.deepEqual(ids(s), all, `status ${st} reason ${r}: buttons`);
  }
  // where they lead
  const s = steps(2, 15);
  assert.equal(s.actions[0].url, LINKS.hacked());
  assert.equal(steps(2, 3).actions[1].url, LINKS.billing(ID));
  assert.equal(steps(3, 0).actions[0].url, LINKS.billing(ID));
  assert.match(steps(3, 0).actions[0].url, new RegExp(`act=${ID}$`));
  assert.equal(steps(2, 1).actions[0].url, LINKS.accountQuality());
  assert.equal(steps(2, 1).actions[1].url, LINKS.adsManager(ID));
  assert.equal(steps(2, 4).actions[0].url, LINKS.support());
  // tones follow the status pills of the Accounts tab (2 bad, 3 / 7 / 8 / 9 warn, 100 / 101 bad)
  assert.deepEqual([2, 3, 7, 8, 9, 100, 101].map((st) => steps(st, 0).tone), ["bad", "warn", "warn", "warn", "warn", "bad", "bad"]);
  assert.equal(steps(1, 1).tone, "warn");
});

test("healthy accounts and unknown statuses: no tone, no help, no buttons", () => {
  for (const r of [0, null, undefined, "", "0", NaN]) assert.deepEqual(steps(1, r), { tone: null, help: null, actions: [] }, `active, reason ${r}`);
  for (const st of [0, 4, 5, 6, 10, 99, null, undefined, NaN, "abc"]) assert.deepEqual(steps(st, 1), { tone: null, help: null, actions: [] }, `status ${st}`);
  // every call gets its own object: a caller that edits the result must not change the next one
  const a = steps(1, 0); a.actions.push("x");
  assert.deepEqual(steps(1, 0).actions, []);
});

test("an id with anything but digits gives no buttons (the help line stays)", () => {
  for (const bad of ["12a", "act_1x", "", null, undefined, "1/../x", "1?x=2", " 1", "javascript:alert(1)", "1".repeat(26)])
    for (const [st, r] of [[2, 1], [2, 3], [2, 15], [2, 4], [3, 0], [7, 0], [101, 0], [1, 5]]) {
      const s = steps(st, r, bad);
      assert.deepEqual(s.actions, [], `id ${JSON.stringify(bad)}, status ${st}/${r}`);
      assert.ok(s.help, "the explanation does not need an id");
    }
  assert.equal(steps(2, 1, "act_555").actions[1].url, LINKS.adsManager("555"), "act_ prefix is stripped like everywhere else");
  for (const bad of ["12a", "", null, undefined]) assert.deepEqual(adSteps({ id: "9", effective_status: "DISAPPROVED" }, bad), []);
});

test("every button url is https on facebook.com and carries only the validated id", () => {
  for (const st of STATUSES) for (const r of REASONS) for (const a of steps(st, r).actions) {
    const u = new URL(a.url);
    assert.equal(u.protocol, "https:");
    assert.ok(u.hostname === "facebook.com" || u.hostname.endsWith(".facebook.com"), a.url);
    assert.equal(u.username + u.password, "", a.url);
    for (const [k, v] of u.searchParams) assert.match(v, /^\d+$/, `${a.url}: ${k}`);
    assert.ok(!a.url.includes(ID) || u.searchParams.get("act") === ID, a.url);
  }
});

test("the table: every row names known buttons and strings, none is dead, none is shadowed", () => {
  const seen = new Set();
  for (const row of ACCOUNT_ROWS) {
    assert.ok(row.status.length && row.status.every((c) => STATUSES.includes(c)), JSON.stringify(row));
    assert.ok(row.reason === ANY || row.reason === SET || (Array.isArray(row.reason) && row.reason.every((r) => REASONS.includes(r))), JSON.stringify(row));
    assert.ok(["bad", "warn"].includes(row.tone), JSON.stringify(row));
    assert.match(row.help, /^next\.help\./);
    for (const id of [row.primary, ...row.more].filter(Boolean)) assert.ok(id in ACTIONS, `${row.help}: ${id}`);
    assert.ok(row.primary === null || !row.more.includes(row.primary), `${row.help}: primary listed twice`);
    assert.ok(row.primary !== null || row.more.length, `${row.help}: a row with no button at all`);
  }
  // first match wins: a row that no combination reaches would never show
  for (const st of STATUSES) for (const r of [...REASONS, 99]) {
    const h = steps(st, r).help;
    if (h) seen.add(`${st}/${h}`);
  }
  for (const row of ACCOUNT_ROWS) assert.ok(row.status.some((st) => seen.has(`${st}/${row.help}`)), `row ${row.help} is never reached`);
  // every (status, reason) of the enum is covered by a row or is healthy (ACTIVE + NONE)
  for (const st of STATUSES) for (const r of REASONS) assert.equal(steps(st, r).tone === null, st === 1 && r === 0, `status ${st} reason ${r}`);
  assert.ok(AD_ROW.primary in ACTIONS && AD_ROW.more.every((id) => id in ACTIONS));
});

test("strings: every label and help key exists in Russian and English, nothing is orphaned, lines are short", async () => {
  assert.deepEqual(Object.keys(STRINGS.ru).sort(), Object.keys(STRINGS.en).sort());
  const used = new Set(["next.title"]);                                                // drawn by accounts.js
  for (const a of Object.values(ACTIONS)) used.add(a.label);
  for (const row of ACCOUNT_ROWS) used.add(row.help);
  for (const l of LANGS) {
    await setLang(l);
    for (const k of used) {
      assert.ok(has(k), `${k} missing in ${l}`);
      assert.ok(typeof STRINGS[l][k] === "string" && STRINGS[l][k].trim(), `${k} empty in ${l}`);
    }
  }
  assert.deepEqual([...Object.keys(STRINGS.en)].filter((k) => !used.has(k)), [], "strings nobody uses");
  for (const l of LANGS) for (const k of used) if (k.startsWith("next.help."))
    assert.ok(STRINGS[l][k].length <= 120, `${l} ${k} is ${STRINGS[l][k].length} characters`);
  // the labels fit a 24 px button
  for (const l of LANGS) for (const a of Object.values(ACTIONS)) assert.ok(STRINGS[l][a.label].length <= 24, `${l} ${a.label}`);
  await setLang("en");
});

test("ads: only DISAPPROVED / WITH_ISSUES get 'Request review' + 'Open ad'", () => {
  for (const st of ["DISAPPROVED", "WITH_ISSUES"]) {
    const s = adSteps({ id: "9001", effective_status: st }, ID);
    assert.deepEqual(ids({ actions: s }), ["review", "openAd"], st);
    assert.deepEqual(s.map((a) => a.primary), [true, false]);
    assert.equal(s[0].url, LINKS.accountQuality());
    assert.equal(s[1].url, `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${ID}&selected_ad_ids=9001`);
    for (const a of s) assert.match(a.url, FB);
  }
  for (const st of ["ACTIVE", "PAUSED", "PENDING_REVIEW", "IN_PROCESS", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PREAPPROVED", "PENDING_BILLING_INFO", "DELETED", "ARCHIVED", "", null, undefined, "disapproved"])
    assert.deepEqual(adSteps({ id: "9001", effective_status: st }, ID), [], String(st));
  for (const bad of [null, undefined, {}]) assert.deepEqual(adSteps(bad, ID), []);
  // an ad id that is not digits never goes into a URL: the button opens the account's Ads Manager instead
  for (const adId of ["a1", "9/../x", "9&act=1", "", null, undefined]) {
    const s = adSteps({ id: adId, effective_status: "DISAPPROVED" }, ID);
    assert.equal(s[1].url, LINKS.adsManager(ID), `ad id ${JSON.stringify(adId)}`);
  }
});

test("LINKS.adsManagerAd: digits only, falls back to the account page, null for a bad account", () => {
  assert.equal(LINKS.adsManagerAd("act_7", 8), "https://adsmanager.facebook.com/adsmanager/manage/ads?act=7&selected_ad_ids=8");
  assert.equal(LINKS.adsManagerAd("7", "x"), LINKS.adsManager("7"));
  assert.equal(LINKS.adsManagerAd("7"), LINKS.adsManager("7"));
  for (const bad of [null, undefined, "", "7a", "1?x=2"]) assert.equal(LINKS.adsManagerAd(bad, "8"), null);
});
