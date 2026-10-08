// js/bms-model.js: the Businesses tab's logic without a DOM (what a business row keeps, how rows are built from the business list
// and the Ad accounts list, spend / status / problems per business, search, order, copied IDs, which errors are "this token can't
// read businesses"). Plain Node: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import {
  BM_BASE, BM_OPTIONAL, VERIFY_BAD, STATUS, PROBLEMS, markerOf, slimBm, badVerification, countAccounts, statusOf, buildRows, issuesOf,
  matchRow, filterRows, sortRows, totalOf, idsOf, isPermError,
} from "../fb-helper/js/bms-model.js";
import { LINKS } from "../fb-helper/js/links.js";

// ---------- request shape ----------
test("the read asks for id + name always and two extras as optional fields (the key is what Graph's complaint is matched against)", () => {
  assert.deepEqual(BM_BASE, ["id", "name"]);
  assert.deepEqual(Object.keys(BM_OPTIONAL), ["verification_status", "profile_picture_uri"]);
  for (const expr of Object.values(BM_OPTIONAL)) assert.ok(!/access_token/.test(expr), "never a token field");
});

// ---------- rows from Graph ----------
test("markerOf: _no + the camel-cased Graph field", () => {
  assert.equal(markerOf("verification_status"), "_noVerificationStatus");
  assert.equal(markerOf("profile_picture_uri"), "_noProfilePictureUri");
});

test("slimBm keeps only the whitelisted keys; strings are cut, wrong shapes dropped", () => {
  const raw = {
    id: "1001", name: "Alpha", verification_status: "verified", profile_picture_uri: "https://scontent.xx.fbcdn.net/v/t1/a.jpg",
    access_token: "EAAB-secret", permitted_roles: ["ADMIN"], created_time: "2026-08-29T10:00:00+0000", primary_page: { id: "555", name: "P" }, two_factor_type: "all_required",
  };
  assert.deepEqual(slimBm(raw), { id: "1001", name: "Alpha", verification_status: "verified", profile_picture_uri: "https://scontent.xx.fbcdn.net/v/t1/a.jpg" });
  assert.equal(JSON.stringify(slimBm(raw)).includes("EAAB-secret"), false);
  assert.deepEqual(slimBm({ id: 1002 }), { id: "1002", name: "" }, "numeric id becomes a string; absent extras are absent, not undefined");
  assert.equal(slimBm({ id: "8", name: "x".repeat(500) }).name.length, 200);
  assert.deepEqual(slimBm({ id: "9", name: "N", verification_status: 5, profile_picture_uri: { url: "x" } }), { id: "9", name: "N" });
});

test("slimBm: a logo URL is kept only as https on facebook.com / fbcdn.net; anything else leaves the row without one", () => {
  for (const bad of ["http://scontent.xx.fbcdn.net/a.jpg", "https://evil.example.com/a.png", "https://fbcdn.net.evil.com/a.png", "javascript:alert(1)", "data:image/png;base64,AA", "", "  ", 5, null, {}])
    assert.equal("profile_picture_uri" in slimBm({ id: "1", name: "A", profile_picture_uri: bad }), false, JSON.stringify(bad));
  assert.equal(slimBm({ id: "1", profile_picture_uri: "https://scontent-fra5-2.xx.fbcdn.net/v/a.png?x=1&y=2" }).profile_picture_uri, "https://scontent-fra5-2.xx.fbcdn.net/v/a.png?x=1&y=2");
});

test("slimBm: a row without a numeric id is no business (null)", () => {
  for (const bad of [null, undefined, "x", 5, {}, { name: "no id" }, { id: "" }, { id: "12a" }, { id: "../1" }, { id: "1".repeat(26) }, { account_id: "111" }])
    assert.equal(slimBm(bad), null, JSON.stringify(bad));
});

test("slimBm: a refused field gets its marker (and no value) so the UI never reads 'unknown' as 'none'", () => {
  const row = slimBm({ id: "1", name: "A", verification_status: "revoked", profile_picture_uri: "https://fbcdn.net/a.png" }, new Set(["verification_status", "profile_picture_uri"]));
  assert.deepEqual(row, { id: "1", name: "A", _noVerificationStatus: true, _noProfilePictureUri: true });
  assert.equal(badVerification(row), null, "refused: no verdict, so no problem");
  assert.deepEqual(slimBm({ id: "1", name: "A" }, new Set()), { id: "1", name: "A" }, "nothing refused: no markers");
  assert.deepEqual(JSON.parse(JSON.stringify(row)), row, "the marker survives a JSON round trip (storage.session)");
});

// ---------- verification ----------
test("only a verification that went wrong is a problem: failed / rejected / revoked / expired (any case); pending, none, verified are not", () => {
  assert.deepEqual(VERIFY_BAD, ["failed", "rejected", "revoked", "expired"]);
  for (const s of VERIFY_BAD) assert.equal(badVerification({ verification_status: s }), s);
  assert.equal(badVerification({ verification_status: " Revoked " }), "revoked");
  for (const s of ["verified", "pending", "pending_need_more_info", "pending_submission", "not_verified", "ineligible", "weird", "", undefined, 7]) assert.equal(badVerification({ verification_status: s }), null, String(s));
  assert.equal(badVerification(null), null);
});

// ---------- counts and status ----------
test("countAccounts: total / active (1) / disabled (2); other statuses only in the total", () => {
  const acc = (st) => ({ account_status: st });
  assert.deepEqual(countAccounts([acc(1), acc(1), acc(2), acc(101), acc(3), acc(100), acc(7)]), { total: 7, active: 2, disabled: 1 });
  assert.deepEqual(countAccounts([]), { total: 0, active: 0, disabled: 0 });
});

test("statusOf: active (ok) / no active ad accounts (bad) / no ad accounts (warn); no verdict before the Ad accounts list is loaded; none is no verdict when that list is partial", () => {
  const loaded = { loaded: true };
  assert.deepEqual(statusOf({ total: 3, active: 1, disabled: 2 }, loaded), { key: "active", tone: "ok" });
  assert.deepEqual(statusOf({ total: 2, active: 0, disabled: 2 }, loaded), { key: "noActive", tone: "bad" });
  assert.deepEqual(statusOf({ total: 1, active: 0, disabled: 0 }, loaded), { key: "noActive", tone: "bad" }, "closed or unsettled is not active either");
  assert.deepEqual(statusOf({ total: 0, active: 0, disabled: 0 }, loaded), { key: "none", tone: "warn" });
  for (const c of [{ total: 3, active: 1, disabled: 0 }, { total: 0, active: 0, disabled: 0 }]) assert.equal(statusOf(c, { loaded: false }), null);
  assert.equal(statusOf({ total: 0, active: 0, disabled: 0 }, { loaded: true, truncated: true }), null, "it may own accounts that were not read");
  assert.equal(statusOf({ total: 2, active: 0, disabled: 2 }, { loaded: true, truncated: true }).key, "noActive", "what WAS read is still a fact");
  assert.deepEqual(STATUS, { active: "ok", noActive: "bad", none: "warn" });
});

// ---------- the rows ----------
const BMS = [
  slimBm({ id: "1001", name: "Alpha Media", verification_status: "verified", profile_picture_uri: "https://scontent.xx.fbcdn.net/a.jpg" }),
  slimBm({ id: "1002", name: "Beta Ads", verification_status: "failed" }),
  slimBm({ id: "1003", name: "Gamma Group", verification_status: "not_verified" }),
  slimBm({ id: "1004", name: "Delta Co", verification_status: "pending" }),
];
const A = (id, bm, st, cur = "USD") => ({ account_id: id, account_status: st, currency: cur, ...(bm ? { business: { id: bm, name: `Name of ${bm}` } } : {}) });
const ACCOUNTS = [
  A("1", "1001", 1), A("2", "1001", 2), A("3", "1001", 1, "EUR"),
  A("4", "1002", 2),
  A("5", "1004", 1),                                              // spend unknown
  A("6", "9999", 1),                                              // a business the profile does not manage
  A("7", null, 1), A("8", undefined, 3),                          // no business at all
];
const SPEND = { 1: 100, 2: 0, 3: 50, 4: 10, 5: null, 6: 7, 7: 1000, 8: 5 };
const stats = (a) => (SPEND[a.account_id] === null ? null : { spend: SPEND[a.account_id] });
const build = (over = {}) => buildRows({ bms: BMS, accounts: ACCOUNTS, loaded: true, stats, ...over });
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test("buildRows: a row per business of the profile and per business an account names; accounts without a business belong to no row", () => {
  const rows = build();
  assert.deepEqual(rows.map((r) => r.id).sort(), ["1001", "1002", "1003", "1004", "9999"]);
  assert.ok(rows.every((r) => r.id && r.key === r.id), "every row is a business: no personal row");
  assert.equal(rows.flatMap((r) => r.accounts).length, 6, "7 and 8 (no business) are in no row");
  const r = byId(rows);
  assert.equal(r["1001"].name, "Alpha Media"); assert.equal(r["1001"].known, true); assert.equal(r["1001"].picture, "https://scontent.xx.fbcdn.net/a.jpg");
  assert.equal(r["9999"].name, "Name of 9999", "named from its account"); assert.equal(r["9999"].known, false); assert.equal(r["9999"].picture, undefined);
  assert.equal(r["9999"].bm, null);
});

test("buildRows: counts, status, spend per business (per currency), unknown spend flagged", () => {
  const r = byId(build());
  assert.deepEqual(r["1001"].counts, { total: 3, active: 2, disabled: 1 });
  assert.deepEqual(r["1001"].status, { key: "active", tone: "ok" });
  assert.deepEqual(r["1001"].spend, { totals: { USD: 100, EUR: 50 }, unknown: false, sort: 150 });
  assert.deepEqual(r["1002"].status, { key: "noActive", tone: "bad" });
  assert.deepEqual(r["1002"].spend, { totals: { USD: 10 }, unknown: false, sort: 10 });
  assert.deepEqual(r["1003"].counts, { total: 0, active: 0, disabled: 0 });
  assert.deepEqual(r["1003"].status, { key: "none", tone: "warn" });
  assert.deepEqual(r["1003"].spend, { totals: {}, unknown: false, sort: -1 });
  assert.deepEqual(r["1004"].spend, { totals: {}, unknown: true, sort: -1 }, "its one account has no number for the period");
  assert.deepEqual(r["9999"].spend.totals, { USD: 7 });
});

test("buildRows: before the Ad accounts list is loaded there is no status and no problem about accounts (only a failed verification shows)", () => {
  const rows = buildRows({ bms: BMS, accounts: [], loaded: false, stats });
  assert.deepEqual(rows.map((r) => r.id), ["1001", "1002", "1003", "1004"]);
  assert.ok(rows.every((r) => r.status === null && r.counts.total === 0));
  assert.deepEqual(rows.map((r) => r.issues.map((i) => i.id)), [[], ["verification"], [], []]);
});

test("totalOf: the sum of the rows shown (businesses only: the accounts of no business are not in it); a search narrows it", () => {
  const rows = build();
  assert.deepEqual(totalOf(rows), { totals: { USD: 117, EUR: 50 }, unknown: true, sort: 167 }, "100 + 0 + 10 + 7 USD, 50 EUR; 1000 and 5 belong to no business");
  const per = rows.map((r) => r.spend);
  assert.deepEqual(totalOf(rows).totals, per.reduce((t, s) => { for (const [c, v] of Object.entries(s.totals)) t[c] = (t[c] || 0) + v; return t; }, {}), "= the rows added up");
  assert.deepEqual(totalOf(filterRows(rows, "alpha")).totals, { USD: 100, EUR: 50 });
  assert.deepEqual(totalOf([]), { totals: {}, unknown: false, sort: -1 });
});

test("sortRows: most spend first, an unknown or missing spend last, then more active accounts, then name, then id; the input is not changed", () => {
  const rows = build();
  const before = rows.map((r) => r.id).join();
  assert.deepEqual(sortRows(rows).map((r) => r.id), ["1001", "1002", "9999", "1004", "1003"], "150, 10, 7; then Delta (1 active) before Gamma (0)");
  assert.equal(rows.map((r) => r.id).join(), before);
  const same = (id, name, active) => ({ id, name, spend: { sort: 5 }, counts: { active } });
  assert.deepEqual(sortRows([same("2", "b", 1), same("1", "b", 1), same("3", "a", 1), same("4", "z", 2)]).map((r) => r.id), ["4", "3", "1", "2"]);
  // a different period gives a different order from the same accounts
  const other = buildRows({ bms: BMS, accounts: ACCOUNTS, loaded: true, stats: (a) => ({ spend: { 4: 900 }[a.account_id] ?? 1 }) });
  assert.equal(sortRows(other)[0].id, "1002");
});

test("search: name or id, case-insensitive, trimmed; copied IDs: one per line in the order shown", () => {
  const rows = build();
  assert.deepEqual(filterRows(rows, " ALPHA ").map((r) => r.id), ["1001"]);
  assert.deepEqual(filterRows(rows, "1002").map((r) => r.id), ["1002"]);
  assert.deepEqual(filterRows(rows, "name of 99").map((r) => r.id), ["9999"], "a derived row is found by the name its account gave");
  assert.deepEqual(filterRows(rows, "zzz"), []);
  assert.equal(filterRows(rows, "   ").length, 5);
  assert.equal(matchRow({ id: "5", name: undefined }, "5"), true, "a nameless business is found by id");
  assert.equal(idsOf(sortRows(rows)), "1001\n1002\n9999\n1004\n1003");
  assert.equal(idsOf(filterRows(rows, "beta")), "1002");
  assert.equal(idsOf([]), "");
});

// ---------- problems and their fixes ----------
const ROWS = (bm, accounts, over = {}) => buildRows({ bms: [slimBm({ id: "1001", name: "X", ...bm })], accounts, loaded: true, stats, ...over })[0];
const ACTIVE = [A("1", "1001", 1)];
const FIX = {
  verification: LINKS.bmSecurity("1001"), noActive: LINKS.bmAdAccounts("1001"), none: LINKS.bmAdAccounts("1001"),
};

test("every problem has exactly one fix link, to the right page of Business Settings", () => {
  assert.deepEqual(PROBLEMS.map((p) => p.id), ["verification", "noActive", "none"], "worst first");
  for (const status of VERIFY_BAD) {
    const issues = ROWS({ verification_status: status }, ACTIVE).issues;
    assert.deepEqual(issues.map((i) => i.id), ["verification"], status);
    assert.equal(issues[0].label, `bms.p.ver.${status}`);
    assert.equal(issues[0].tone, "bad");
    assert.equal(issues[0].fix.url, FIX.verification);
  }
  const noActive = ROWS({ verification_status: "verified" }, [A("1", "1001", 2)]).issues;
  assert.deepEqual(noActive.map((i) => [i.id, i.label, i.tone, i.fix.url, i.fix.label]), [["noActive", "bms.st.noActive", "bad", FIX.noActive, "bms.fix.accounts"]]);
  const none = ROWS({ verification_status: "verified" }, []).issues;
  assert.deepEqual(none.map((i) => [i.id, i.label, i.tone, i.fix.url, i.fix.label]), [["none", "bms.st.none", "warn", FIX.none, "bms.fix.create"]]);
  assert.equal(FIX.verification, "https://business.facebook.com/settings/security?business_id=1001");
  assert.equal(FIX.none, "https://business.facebook.com/settings/ad-accounts?business_id=1001");
  for (const i of [...noActive, ...none]) assert.ok(i.fix && Object.keys(i).filter((k) => k === "fix").length === 1);
});

test("problems come in order of severity; a failed verification and no active accounts are both listed, each with its own fix", () => {
  const issues = ROWS({ verification_status: "revoked" }, [A("1", "1001", 2)]).issues;
  assert.deepEqual(issues.map((i) => i.id), ["verification", "noActive"]);
  assert.deepEqual(issues.map((i) => i.fix.label), ["bms.fix.verify", "bms.fix.accounts"]);
});

test("a healthy business has no problem and no fix; neither has a pending, unverified or unread verification", () => {
  assert.deepEqual(ROWS({ verification_status: "verified" }, ACTIVE).issues, []);
  for (const s of ["pending", "pending_need_more_info", "pending_submission", "not_verified", "ineligible"]) assert.deepEqual(ROWS({ verification_status: s }, ACTIVE).issues, [], s);
  assert.deepEqual(buildRows({ bms: [slimBm({ id: "1001", name: "X", verification_status: "failed" }, new Set(["verification_status"]))], accounts: ACTIVE, loaded: true, stats })[0].issues, [], "refused field");
  assert.deepEqual(ROWS({}, ACTIVE).issues, [], "no verification field at all");
});

test("a business of someone else (only named by an account) has no problem line: its settings are not the profile's to open", () => {
  const rows = buildRows({ bms: [], accounts: [A("1", "777", 2)], loaded: true, stats });
  assert.equal(rows[0].status.key, "noActive");
  assert.deepEqual(rows[0].issues, []);
  assert.deepEqual(issuesOf({ known: false, verification: "failed", status: { key: "none" }, id: "5" }), []);
});

test("a link links.js rejects is dropped, never half-built", () => {
  const [i] = issuesOf({ known: true, verification: "failed", status: null, id: "not-digits" });
  assert.equal(i.id, "verification"); assert.equal(i.fix, null);
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
test("every key the tab can draw exists in both languages (the dynamic ones: status, verification problems, fixes); no slang, no product name", async () => {
  const { STRINGS } = await import("../fb-helper/js/strings/bms.js");
  const keys = new Set([
    ...Object.keys(STATUS).flatMap((k) => [`bms.st.${k}`, `bms.st.${k}.title`]),
    ...VERIFY_BAD.map((s) => `bms.p.ver.${s}`), "bms.verTitle",
    "bms.spend", "bms.noSpend", "bms.openSettings", "bms.count", "bms.accCount", "bms.search.aria", "bms.copyIds", "bms.copyIds.title", "bms.refresh",
  ]);
  for (const p of PROBLEMS) { keys.add(p.tip); keys.add(p.fix.label); keys.add(p.fix.tip); }
  for (const l of ["ru", "en"]) assert.deepEqual([...keys].filter((k) => !STRINGS[l][k]), [], `missing in ${l}`);
  assert.deepEqual(Object.keys(STRINGS.ru).sort(), Object.keys(STRINGS.en).sort());
  assert.equal(STRINGS.ru["bms.count"].length, 3); assert.equal(STRINGS.en["bms.count"].length, 2);
  assert.equal(STRINGS.ru["bms.accCount"].length, 3); assert.equal(STRINGS.en["bms.accCount"].length, 2);
  for (const l of ["ru", "en"]) for (const v of Object.values(STRINGS[l]).flat()) assert.ok(!/fb helper|(^|[^\p{L}])(BM|БМ)(?![\p{L}])/iu.test(v), v);
  for (const l of ["ru", "en"]) for (const p of PROBLEMS) assert.ok(STRINGS[l][p.fix.label].length <= 32, `${l} ${p.fix.label}`);
});
