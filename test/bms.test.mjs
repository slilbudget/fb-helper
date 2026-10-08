// js/bms-model.js: the BM tab's logic without a DOM (what a row keeps, verification tone, role, ad account counts, search,
// chips, order, copied IDs, which errors are "this token can't read BMs"). Plain Node: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import {
  BM_BASE, BM_OPTIONAL, VERIFICATION, markerOf, slimBm, verificationOf, isVerified, humanize, roleOf, isoDay,
  adCounts, matchBm, filterBms, sortBms, statusChips, idsOf, isPermError,
} from "../fb-helper/js/bms-model.js";

// ---------- request shape ----------
test("the read asks for id + name always and the five extras as optional fields (the key is what Graph's complaint is matched against)", () => {
  assert.deepEqual(BM_BASE, ["id", "name"]);
  assert.deepEqual(Object.keys(BM_OPTIONAL), ["verification_status", "permitted_roles", "created_time", "primary_page", "two_factor_type"]);
  assert.equal(BM_OPTIONAL.primary_page, "primary_page{id,name}");
  for (const expr of Object.values(BM_OPTIONAL)) assert.ok(!/access_token/.test(expr), "never a token field");
});

// ---------- verification ----------
test("verification tone: verified ok, pending family warn, failed family bad, not_verified / ineligible neutral", () => {
  const tone = (s) => verificationOf({ verification_status: s }).tone;
  assert.equal(tone("verified"), "ok");
  for (const s of ["pending", "pending_need_more_info", "pending_submission"]) assert.equal(tone(s), "warn", s);
  for (const s of ["failed", "rejected", "revoked", "expired"]) assert.equal(tone(s), "bad", s);
  for (const s of ["not_verified", "ineligible"]) { assert.equal(tone(s), "", s); assert.equal(verificationOf({ verification_status: s }).state, "known"); }
  assert.deepEqual(Object.keys(VERIFICATION).sort(), ["expired", "failed", "ineligible", "not_verified", "pending", "pending_need_more_info", "pending_submission", "rejected", "revoked", "verified"]);
});

test("verification: case and spaces are normalised; an unknown value keeps its text and no tone; missing / refused is not a status at all", () => {
  assert.deepEqual(verificationOf({ verification_status: " VERIFIED " }), { state: "known", status: "verified", tone: "ok" });
  assert.deepEqual(verificationOf({ verification_status: "brand_new_state" }), { state: "other", status: "brand_new_state", tone: "" });
  assert.deepEqual(verificationOf({}), { state: "unknown", status: "", tone: "" });
  assert.deepEqual(verificationOf({ verification_status: 5 }), { state: "unknown", status: "", tone: "" }, "not a string");
  assert.deepEqual(verificationOf({ verification_status: "verified", _noVerificationStatus: true }), { state: "refused", status: "", tone: "" }, "the marker wins");
  assert.equal(isVerified({ verification_status: "verified" }), true);
  assert.equal(isVerified({ verification_status: "pending" }), false);
  assert.equal(isVerified({}), false, "unknown is not verified: the security link stays");
  assert.equal(humanize("pending_need_more_info"), "Pending need more info");
  assert.equal(humanize("FINANCE_EDITOR"), "Finance editor");
  assert.equal(humanize(undefined), "");
});

// ---------- role ----------
test("role: ADMIN wins over everything, then EMPLOYEE, another role keeps its name, none = unknown, refused = refused", () => {
  assert.deepEqual(roleOf({ permitted_roles: ["EMPLOYEE", "ADMIN"] }), { state: "admin", name: "ADMIN" });
  assert.deepEqual(roleOf({ permitted_roles: ["admin"] }), { state: "admin", name: "ADMIN" }, "case");
  assert.deepEqual(roleOf({ permitted_roles: ["FINANCE_EDITOR", "EMPLOYEE"] }), { state: "employee", name: "EMPLOYEE" });
  assert.deepEqual(roleOf({ permitted_roles: ["FINANCE_EDITOR"] }), { state: "other", name: "FINANCE_EDITOR" });
  assert.equal(roleOf({ permitted_roles: [] }).state, "unknown");
  assert.equal(roleOf({ permitted_roles: ["", "  ", 7] }).state, "unknown", "junk entries are ignored");
  assert.equal(roleOf({}).state, "unknown");
  assert.equal(roleOf({ permitted_roles: "ADMIN" }).state, "unknown", "not an array");
  assert.equal(roleOf({ permitted_roles: ["ADMIN"], _noPermittedRoles: true }).state, "refused");
});

// ---------- rows ----------
test("markerOf: _no + the camel-cased Graph field", () => {
  assert.equal(markerOf("verification_status"), "_noVerificationStatus");
  assert.equal(markerOf("permitted_roles"), "_noPermittedRoles");
  assert.equal(markerOf("created_time"), "_noCreatedTime");
  assert.equal(markerOf("primary_page"), "_noPrimaryPage");
  assert.equal(markerOf("two_factor_type"), "_noTwoFactorType");
});

test("slimBm keeps only the whitelisted keys; strings are cut, wrong shapes dropped", () => {
  const raw = {
    id: "1001", name: "Alpha", verification_status: "verified", permitted_roles: ["ADMIN", 3, "EMPLOYEE"], created_time: "2026-08-29T10:00:00+0000",
    primary_page: { id: "555", name: "Alpha Page", access_token: "EAAB-secret", fan_count: 9 }, two_factor_type: "all_required",
    access_token: "EAAB-secret", extra: "x", business_users: [{ id: "1" }],
  };
  assert.deepEqual(slimBm(raw), {
    id: "1001", name: "Alpha", verification_status: "verified", permitted_roles: ["ADMIN", "EMPLOYEE"], created_time: "2026-08-29T10:00:00+0000",
    primary_page: { id: "555", name: "Alpha Page" }, two_factor_type: "all_required",
  });
  assert.equal(JSON.stringify(slimBm(raw)).includes("EAAB-secret"), false);
  assert.deepEqual(slimBm({ id: 1002 }), { id: "1002", name: "" }, "numeric id becomes a string; absent extras are absent, not undefined");
  assert.equal(Object.keys(slimBm({ id: "7", name: "N" })).sort().join(), "id,name");
  assert.equal(slimBm({ id: "8", name: "x".repeat(500) }).name.length, 200);
  assert.deepEqual(slimBm({ id: "9", name: "N", primary_page: "oops", permitted_roles: "ADMIN", created_time: 5 }), { id: "9", name: "N" });
  assert.deepEqual(slimBm({ id: "9", name: "N", primary_page: { id: "../x", name: "bad id" } }), { id: "9", name: "N" }, "a page id that is not digits is dropped");
});

test("slimBm: a row without a numeric id is no BM (null)", () => {
  for (const bad of [null, undefined, "x", 5, {}, { name: "no id" }, { id: "" }, { id: "12a" }, { id: "../1" }, { id: "1".repeat(26) }, { account_id: "111" }])
    assert.equal(slimBm(bad), null, JSON.stringify(bad));
});

test("slimBm: a refused field gets its marker (and no value) so the UI shows a dash instead of a wrong value", () => {
  const skip = new Set(["verification_status", "primary_page"]);
  const row = slimBm({ id: "1", name: "A", permitted_roles: ["ADMIN"], verification_status: "verified" }, skip);
  assert.deepEqual(row, { id: "1", name: "A", permitted_roles: ["ADMIN"], _noVerificationStatus: true, _noPrimaryPage: true });
  assert.equal(verificationOf(row).state, "refused");
  assert.deepEqual(slimBm({ id: "1", name: "A" }, new Set()), { id: "1", name: "A" }, "nothing refused: no markers");
  // the marker survives a JSON round trip (storage.session)
  assert.deepEqual(JSON.parse(JSON.stringify(row)), row);
});

// ---------- ad accounts per BM ----------
test("adCounts: per owning BM, total / active (1) / disabled (2); other statuses only in the total; no BM = not counted", () => {
  const acc = (id, bm, st) => ({ account_id: id, account_status: st, ...(bm ? { business: { id: bm, name: `BM ${bm}` } } : {}) });
  const c = adCounts([acc("1", "100", 1), acc("2", "100", 1), acc("3", "100", 2), acc("4", "100", 101), acc("5", "100", 3), acc("6", "200", 2), acc("7", null, 1), acc("8", 300, 1)]);
  assert.deepEqual(c.get("100"), { total: 5, active: 2, disabled: 1 });
  assert.deepEqual(c.get("200"), { total: 1, active: 0, disabled: 1 });
  assert.deepEqual(c.get("300"), { total: 1, active: 1, disabled: 0 }, "a numeric id matches its string");
  assert.equal(c.size, 3);
  assert.equal(c.get("999"), undefined);
  assert.equal(adCounts(undefined).size, 0); assert.equal(adCounts([null, {}, { business: {} }]).size, 0);
});

// ---------- search, chips, order, IDs ----------
const BMS = [
  { id: "1001", name: "Alpha Media", verification_status: "verified", created_time: "2026-03-01T00:00:00+0000" },
  { id: "1002", name: "beta ads", verification_status: "pending", created_time: "2026-09-10T00:00:00+0000" },
  { id: "2003", name: "Gamma", verification_status: "not_verified" },
  { id: "1004", name: "Delta", created_time: "2026-09-10T00:00:00+0000" },
  { id: "1005", name: "Epsilon", verification_status: "verified", created_time: "2025-01-01T00:00:00+0000" },
];
test("search: name or id, case-insensitive, trimmed; the verification chip narrows by raw status", () => {
  const names = (rows) => rows.map((b) => b.name);
  assert.deepEqual(names(filterBms(BMS, { q: "ALPHA" })), ["Alpha Media"]);
  assert.deepEqual(names(filterBms(BMS, { q: " beta " })), ["beta ads"]);
  assert.deepEqual(names(filterBms(BMS, { q: "100" })), ["Alpha Media", "beta ads", "Delta", "Epsilon"], "by id (2003 is not in it)");
  assert.deepEqual(names(filterBms(BMS, { q: "2003" })), ["Gamma"]);
  assert.deepEqual(names(filterBms(BMS, { q: "zzz" })), []);
  assert.equal(filterBms(BMS, {}).length, 5);
  assert.deepEqual(names(filterBms(BMS, { status: "verified" })), ["Alpha Media", "Epsilon"]);
  assert.deepEqual(names(filterBms(BMS, { status: "verified", q: "eps" })), ["Epsilon"]);
  assert.deepEqual(names(filterBms(BMS, { status: "failed" })), [], "a status nobody has");
  assert.equal(matchBm({ id: "5", name: undefined }, "5"), true, "a nameless BM is found by id");
  assert.equal(matchBm({ id: "5", name: "x" }, "   "), true);
});

test("sortBms: newest created first, no date last, then name, then id; the input is not changed", () => {
  const before = BMS.map((b) => b.id).join();
  assert.deepEqual(sortBms(BMS).map((b) => b.id), ["1002", "1004", "1001", "1005", "2003"], "same day: by name (beta < Delta); 2003 has no date");
  assert.equal(BMS.map((b) => b.id).join(), before);
  assert.deepEqual(sortBms([{ id: "2", name: "same" }, { id: "1", name: "same" }]).map((b) => b.id), ["1", "2"]);
  assert.deepEqual(sortBms([{ id: "1", name: "B" }, { id: "2", name: "A", created_time: "garbage" }]).map((b) => b.name), ["A", "B"], "an unreadable date counts as none");
});

test("statusChips: only when two or more statuses differ; rows without a status are in no chip; fixed order", () => {
  assert.deepEqual(statusChips(BMS), [["verified", 2], ["pending", 1], ["not_verified", 1]]);
  assert.deepEqual(statusChips([{ id: "1", verification_status: "verified" }, { id: "2", verification_status: "verified" }]), [], "one distinct status: no chips");
  assert.deepEqual(statusChips([{ id: "1", verification_status: "verified" }, { id: "2" }, { id: "3", _noVerificationStatus: true }]), [], "the rest have no status");
  assert.deepEqual(statusChips([]), []);
  assert.deepEqual(statusChips([{ id: "1", verification_status: "weird" }, { id: "2", verification_status: "failed" }, { id: "3", verification_status: "verified" }]),
    [["verified", 1], ["failed", 1], ["weird", 1]], "unknown statuses come last");
});

test("idsOf: one id per line in the order given (the visible rows)", () => {
  assert.equal(idsOf(sortBms(filterBms(BMS, { q: "100" }))), "1002\n1004\n1001\n1005");
  assert.equal(idsOf([]), "");
  assert.equal(idsOf([{ id: "5" }]), "5");
});

test("isoDay: the date part of Graph's timestamp, null for anything else", () => {
  assert.equal(isoDay("2026-08-29T10:00:00+0000"), "2026-08-29");
  assert.equal(isoDay("2026-08-29"), "2026-08-29");
  for (const bad of [undefined, null, "", "yesterday", "29.08.2026", 20260829]) assert.equal(isoDay(bad), null, String(bad));
});

// ---------- errors ----------
test("isPermError: #10, #200-299 and a #100 that names no field; field errors, throttle and plain failures are not", () => {
  const e = (code, msg) => Object.assign(new Error(msg), { code, raw: msg });
  assert.equal(isPermError(e(10, "(#10) Application does not have permission for this action")), true);
  assert.equal(isPermError(e(200, "(#200) Requires business_management permission")), true);
  assert.equal(isPermError(e(299, "(#299) x")), true);
  assert.equal(isPermError(e(100, "(#100) Unsupported get request. Object does not exist, cannot be loaded due to missing permissions")), true);
  assert.equal(isPermError(e(100, "(#100) Tried accessing nonexisting field (name) on node type (Business)")), false, "a field complaint is not a permission error");
  assert.equal(isPermError(e(199, "x")), false);
  assert.equal(isPermError(e(300, "x")), false);
  assert.equal(isPermError(e(1, "An unknown error occurred")), false);
  assert.equal(isPermError(e(undefined, "network")), false);
  assert.equal(isPermError(new Error("plain")), false);
  assert.equal(isPermError(null), false);
});

// ---------- strings ----------
test("every key the tab can draw exists in both languages (the dynamic ones: verification, links, 2FA)", async () => {
  const { STRINGS } = await import("../fb-helper/js/strings/bms.js");
  const { setLang, has } = await import("../fb-helper/js/i18n.js");
  const keys = [
    ...Object.keys(VERIFICATION).map((s) => `bms.ver.${s}`),
    ...["settings", "accounts", "security", "quality"].flatMap((k) => [`bms.link.${k}`, `bms.link.${k}.title`]),
    ...["none", "admin_required", "all_required"].map((v) => `bms.tfa.${v}`),
    "bms.role.admin", "bms.role.employee", "bms.search.aria", "bms.copyIds", "bms.copyIds.title", "bms.refresh", "search", "acc.copyId", "acc.idCopied",
  ];
  for (const l of ["ru", "en"]) {
    await setLang(l);
    assert.deepEqual(keys.filter((k) => !has(k)), [], `missing in ${l}`);
  }
  await setLang("en");
  assert.deepEqual(Object.keys(STRINGS.ru).sort(), Object.keys(STRINGS.en).sort());
  // plural words are arrays with the right number of forms
  assert.equal(STRINGS.ru["bms.accCount"].length, 3); assert.equal(STRINGS.en["bms.accCount"].length, 2);
  // the store build renames the product: no string may name it
  for (const l of ["ru", "en"]) for (const v of Object.values(STRINGS[l]).flat()) assert.ok(!/fb helper/i.test(v), v);
});
