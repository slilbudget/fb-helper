// js/bms-model.js: the Businesses tab's logic without a DOM (what a business row keeps, how rows are built from the business list and the
// Ad accounts list through groupByBusiness, state / spend / problems per business, the amount of a row, search, order by USD equivalent,
// which errors are "this token can't read businesses"). Plain Node: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../fb-helper/js/i18n.js";
import {
  BM_BASE, BM_OPTIONAL, VERIFY_BAD, VERIFY_KNOWN, PROBLEMS, markerOf, slimBm, badVerification, verificationOf, countAccounts, stateOf, buildRows, issuesOf, spendOf,
  matchRow, filterRows, sortRows, totalOf, isPermError, bmKeysToDrop,
} from "../fb-helper/js/bms-model.js";
import { groupByBusiness } from "../fb-helper/js/spend.js";
import { LINKS } from "../fb-helper/js/links.js";

await setLang("en");
const flat = (s) => String(s).replace(/\s/g, " ");                 // Intl uses no-break and narrow spaces

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

test("slimBm: a logo URL is kept only as https on fbcdn.net / fbsbx.com; anything else (facebook.com too) leaves the row without one", () => {
  for (const bad of ["http://scontent.xx.fbcdn.net/a.jpg", "https://www.facebook.com/a.png", "https://evil.example.com/a.png", "https://fbcdn.net.evil.com/a.png", "javascript:alert(1)", "data:image/png;base64,AA", "", "  ", 5, null, {}])
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
  assert.equal(verificationOf(row), null, "refused: the exact state is not known either");
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

test("verificationOf: the exact state (lower case) when known, null when not sent or refused; the expanded row tells it, the line 2 does not", () => {
  assert.equal(verificationOf({ verification_status: " Pending_Need_More_Info " }), "pending_need_more_info");
  assert.equal(verificationOf({ verification_status: "verified" }), "verified");
  for (const b of [null, {}, { verification_status: "" }, { verification_status: 5 }, { verification_status: "failed", _noVerificationStatus: true }]) assert.equal(verificationOf(b), null);
  for (const s of VERIFY_BAD) assert.ok(VERIFY_KNOWN.includes(s));
});

// ---------- counts and state ----------
test("countAccounts: total / active (1) / disabled (2); other statuses only in the total", () => {
  const acc = (st) => ({ account_status: st });
  assert.deepEqual(countAccounts([acc(1), acc(1), acc(2), acc(101), acc(3), acc(100), acc(7)]), { total: 7, active: 2, disabled: 1 });
  assert.deepEqual(countAccounts([]), { total: 0, active: 0, disabled: 0 });
});

test("stateOf: active / noActive / none; no verdict before the Ad accounts list is loaded; when that list is partial only 'active' is still a fact", () => {
  const loaded = { loaded: true };
  assert.equal(stateOf({ total: 3, active: 1, disabled: 2 }, loaded), "active");
  assert.equal(stateOf({ total: 2, active: 0, disabled: 2 }, loaded), "noActive");
  assert.equal(stateOf({ total: 1, active: 0, disabled: 0 }, loaded), "noActive", "closed or unsettled is not active either");
  assert.equal(stateOf({ total: 0, active: 0, disabled: 0 }, loaded), "none");
  for (const c of [{ total: 3, active: 1, disabled: 0 }, { total: 0, active: 0, disabled: 0 }]) assert.equal(stateOf(c, { loaded: false }), null);
  const partial = { loaded: true, truncated: true };
  assert.equal(stateOf({ total: 0, active: 0, disabled: 0 }, partial), null, "it may own accounts that were not read");
  assert.equal(stateOf({ total: 2, active: 0, disabled: 2 }, partial), null, "…and one of them may be active");
  assert.equal(stateOf({ total: 2, active: 1, disabled: 1 }, partial), "active", "what WAS read is still a fact");
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

test("buildRows: one row per business of groupByBusiness(accounts) joined with the profile's businesses; accounts without a business belong to no row (no personal row)", () => {
  const rows = build();
  assert.deepEqual(rows.map((r) => r.id).sort(), ["1001", "1002", "1003", "1004", "9999"]);
  assert.ok(rows.every((r) => r.id && r.key === r.id), "every row is a business");
  assert.equal(rows.flatMap((r) => r.accounts).length, 6, "7 and 8 (no business) are in no row");
  // the very same grouping the Ad accounts tab uses: a business shows the same accounts on both tabs
  const groups = Object.fromEntries(groupByBusiness(ACCOUNTS).filter((g) => g.id).map((g) => [g.id, g.accounts.map((a) => a.account_id)]));
  const r = byId(rows);
  for (const [id, ids] of Object.entries(groups)) assert.deepEqual(r[id].accounts.map((a) => a.account_id), ids, id);
  assert.equal(r["1001"].name, "Alpha Media"); assert.equal(r["1001"].known, true); assert.equal(r["1001"].picture, "https://scontent.xx.fbcdn.net/a.jpg");
  assert.equal(r["9999"].name, "Name of 9999", "named from its account"); assert.equal(r["9999"].known, false); assert.equal(r["9999"].picture, undefined);
  assert.deepEqual(rows.map((x) => x.id).slice(0, 4), ["1001", "1002", "1003", "1004"], "the profile's businesses first, in their order, then the ones only accounts name");
});

test("buildRows: a name from the business list wins; an account supplies it when the list has none; duplicates collapse", () => {
  const rows = buildRows({ bms: [slimBm({ id: "5", name: "" }), slimBm({ id: "5", name: "Again" }), slimBm({ id: "6", name: "Six" })], accounts: [A("1", "5", 1), A("2", "6", 1)], loaded: true, stats });
  assert.deepEqual(rows.map((r) => [r.id, r.name]), [["5", "Name of 5"], ["6", "Six"]]);
});

test("buildRows: counts, state, spend per business (per currency), unknown spend flagged", () => {
  const r = byId(build());
  assert.deepEqual(r["1001"].counts, { total: 3, active: 2, disabled: 1 });
  assert.equal(r["1001"].state, "active");
  assert.deepEqual(r["1001"].spend, { totals: { USD: 100, EUR: 50 }, unknown: false, sort: 150 });
  assert.equal(r["1002"].state, "noActive");
  assert.deepEqual(r["1002"].spend, { totals: { USD: 10 }, unknown: false, sort: 10 });
  assert.deepEqual(r["1003"].counts, { total: 0, active: 0, disabled: 0 });
  assert.equal(r["1003"].state, "none");
  assert.deepEqual(r["1003"].spend, { totals: {}, unknown: false, sort: -1 });
  assert.deepEqual(r["1004"].spend, { totals: {}, unknown: true, sort: -1 }, "its one account has no number for the period");
  assert.deepEqual(r["9999"].spend.totals, { USD: 7 });
  assert.equal(r["1001"].verificationState, "verified"); assert.equal(r["1002"].verification, "failed"); assert.equal(r["9999"].verificationState, null);
});

test("buildRows: before the Ad accounts list is loaded there is no state and no problem about accounts (only a failed verification shows)", () => {
  const rows = buildRows({ bms: BMS, accounts: [], loaded: false, stats });
  assert.deepEqual(rows.map((r) => r.id), ["1001", "1002", "1003", "1004"]);
  assert.ok(rows.every((r) => r.state === null && r.counts.total === 0));
  assert.deepEqual(rows.map((r) => r.issues.map((i) => i.id)), [[], ["verification"], [], []]);
  assert.ok(rows.every((r) => spendOf(r, { loaded: false }).kind === "unloaded"), "no spend either: a dash, never a $0");
});

test("buildRows: a partial Ad accounts list (page limit) says 'at least' and never claims 'no ad accounts' or 'none active'", () => {
  const rows = byId(build({ truncated: true }));
  assert.equal(rows["1001"].partial, true);
  assert.equal(rows["1001"].state, "active");
  assert.equal(rows["1003"].state, null); assert.deepEqual(rows["1003"].issues, []);
  assert.equal(rows["1002"].state, null, "its disabled account is not proof: another one may not have been read");
  assert.deepEqual(rows["1002"].issues.map((i) => i.id), ["verification"], "only what does not depend on the accounts");
  assert.equal(byId(build())["1001"].partial, false);
});

test("totalOf: the sum of the rows shown (businesses only: the accounts of no business are not in it); a search narrows it", () => {
  const rows = build();
  assert.deepEqual(totalOf(rows), { totals: { USD: 117, EUR: 50 }, unknown: true, sort: 167 }, "100 + 0 + 10 + 7 USD, 50 EUR; 1000 and 5 belong to no business");
  const per = rows.map((r) => r.spend);
  assert.deepEqual(totalOf(rows).totals, per.reduce((t, s) => { for (const [c, v] of Object.entries(s.totals)) t[c] = (t[c] || 0) + v; return t; }, {}), "= the rows added up");
  assert.deepEqual(totalOf(filterRows(rows, "alpha")).totals, { USD: 100, EUR: 50 });
  assert.deepEqual(totalOf([]), { totals: {}, unknown: false, sort: -1 });
});

// ---------- the amount of a row ----------
const RATES = { rates: { USD: 1, EUR: 0.8, VND: 25000 }, date: "2026-10-08", source: "exchangerate-api" };
const rowWith = (items) => buildRows({ bms: [slimBm({ id: "1", name: "X" })], accounts: items.map(([cur, spend], i) => A(String(i + 1), "1", 1, cur)), loaded: true, stats: (a) => ({ spend: items[Number(a.account_id) - 1][1] }) })[0];

test("spendOf: one currency exact, two 'a + b' exact, three or more '≈ USD' (rates) with the breakdown in the tooltip; '≈' never on fewer than three", () => {
  const one = spendOf(rowWith([["USD", 1695.7]]), { loaded: true, rates: RATES });
  assert.deepEqual([one.kind, one.text, one.title], ["exact", "$1,696", ""]);
  const two = spendOf(rowWith([["USD", 55.2], ["EUR", 20]]), { loaded: true, rates: RATES });
  assert.deepEqual([two.kind, flat(two.text), two.title], ["exact", "$55.20 + €20.00", ""]);
  assert.ok(!two.text.includes("≈") && !spendOf(rowWith([["USD", 55.2], ["EUR", 20]]), { loaded: true, rates: null }).text.includes("≈"));
  const three = spendOf(rowWith([["USD", 25], ["EUR", 10], ["VND", 250000]]), { loaded: true, rates: RATES });
  assert.deepEqual([three.kind, three.text], ["approx", "≈ $47.50"], "25 + 10 / 0.8 + 250 000 / 25 000");
  assert.equal(flat(three.full), "$25.00 + €10.00 + VND 250,000");
  assert.match(three.title.replace(/[\u00a0\u202f]/g, " "), /^\$25\.00 \+ €10\.00 \+ VND 250,000\nApproximate: converted at the daily rate of /);
});

test("spendOf: three currencies without rates stay exact and short (the first two + '+N'), never a '≈' and never a line as wide as three amounts", () => {
  for (const rates of [null, { rates: { USD: 1, EUR: 0.8 }, date: "2026-10-08", source: "exchangerate-api" }]) {   // no table at all, or no rate for VND
    const s = spendOf(rowWith([["USD", 25], ["EUR", 10], ["VND", 250000]]), { loaded: true, rates });
    assert.equal(s.kind, "exact");
    assert.equal(flat(s.text), "$25.00 + €10.00 +1");
    assert.equal(flat(s.title), "$25.00 + €10.00 + VND 250,000", "the whole truth is the tooltip");
    assert.ok(!s.text.includes("≈"));
  }
});

test("spendOf: dashes and zeros — unloaded, no ad account, no number for the period, every spend 0 (a zero of its own currency), partial", () => {
  const empty = buildRows({ bms: [slimBm({ id: "1", name: "X" })], accounts: [], loaded: true, stats })[0];
  assert.equal(spendOf(empty, { loaded: true }).kind, "none");
  assert.equal(spendOf(empty, { loaded: false }).kind, "unloaded");
  assert.equal(spendOf(rowWith([["EUR", 0], ["EUR", 0]]), { loaded: true }).kind, "zero");
  assert.equal(spendOf(rowWith([["EUR", 0]]), { loaded: true }).cur, "EUR");
  assert.equal(spendOf(build().find((r) => r.id === "1004"), { loaded: true }).kind, "unknown", "its only account has no number");
  const part = spendOf(build().find((r) => r.id === "1001"), { loaded: true });
  assert.equal(part.notAll, false);
  const some = buildRows({ bms: BMS, accounts: [A("1", "1001", 1), A("2", "1001", 1)], loaded: true, stats: (a) => (a.account_id === "1" ? { spend: 5 } : null) })[0];
  const sp = spendOf(some, { loaded: true });
  assert.deepEqual([sp.kind, sp.notAll, flat(sp.text)], ["exact", true, "$5.00"], "some accounts have no number: the amount is a part, and says so");
});

// ---------- the order ----------
test("sortRows: most spend first by USD equivalent (rates) — a currency with huge numbers does not outrank a bigger dollar spend; an unknown spend last; then more active accounts, name, id; the input is not changed", () => {
  const rows = [rowWith([["VND", 250000]]), rowWith([["USD", 50]])].map((r, i) => ({ ...r, id: String(i + 1), name: `R${i + 1}` }));
  assert.deepEqual(sortRows(rows, RATES).map((r) => r.id), ["2", "1"], "$50 outranks 250 000 dong ($10)");
  assert.deepEqual(sortRows(rows, null).map((r) => r.id), ["1", "2"], "without rates: dong and dollars are not set against each other, the name decides (R1 < R2)");
  const named = [rowWith([["VND", 250000]]), rowWith([["USD", 50]]), rowWith([["USD", 80]]), rowWith([])].map((r, i) => ({ ...r, id: String(i + 1), name: ["Zeta", "Alpha", "Mid", "Nothing"][i] }));
  assert.deepEqual(sortRows(named.filter((r) => r.name !== "Zeta"), null).map((r) => r.name), ["Mid", "Alpha", "Nothing"], "the same currency by amount ($80 before $50), nothing known last");
  assert.deepEqual(sortRows(named.filter((r) => r.name === "Zeta" || r.name === "Nothing"), null).map((r) => r.name), ["Zeta", "Nothing"], "nothing known (no ad accounts) after any spend");
  const all = build();
  const before = all.map((r) => r.id).join();
  assert.deepEqual(sortRows(all).map((r) => r.id), ["1001", "1002", "9999", "1004", "1003"], "150, 10, 7; then Delta (1 active) before Gamma (0)");
  assert.equal(all.map((r) => r.id).join(), before);
  const same = (id, name, active) => ({ id, name, spend: { totals: {}, unknown: false, sort: 5 }, counts: { active } });
  assert.deepEqual(sortRows([same("2", "b", 1), same("1", "b", 1), same("3", "a", 1), same("4", "z", 2)]).map((r) => r.id), ["4", "3", "1", "2"]);
  // a different period gives a different order from the same accounts
  const other = buildRows({ bms: BMS, accounts: ACCOUNTS, loaded: true, stats: (a) => ({ spend: { 4: 900 }[a.account_id] ?? 1 }) });
  assert.equal(sortRows(other, RATES)[0].id, "1002");
});

test("search: name or id, case-insensitive, trimmed", () => {
  const rows = build();
  assert.deepEqual(filterRows(rows, " ALPHA ").map((r) => r.id), ["1001"]);
  assert.deepEqual(filterRows(rows, "1002").map((r) => r.id), ["1002"]);
  assert.deepEqual(filterRows(rows, "name of 99").map((r) => r.id), ["9999"], "a derived row is found by the name its account gave");
  assert.deepEqual(filterRows(rows, "zzz"), []);
  assert.equal(filterRows(rows, "   ").length, 5);
  assert.equal(matchRow({ id: "5", name: undefined }, "5"), true, "a nameless business is found by id");
});

// ---------- problems and their fixes ----------
const ROWS = (bm, accounts, over = {}) => buildRows({ bms: [slimBm({ id: "1001", name: "X", ...bm })], accounts, loaded: true, stats, ...over })[0];
const ACTIVE = [A("1", "1001", 1)];
const FIX = { verification: LINKS.bmSecurity("1001"), noActive: LINKS.bmAdAccounts("1001"), none: LINKS.bmAdAccounts("1001") };

test("every problem has exactly one fix link, to the right page of Business Settings", () => {
  assert.deepEqual(PROBLEMS.map((p) => p.id), ["verification", "noActive", "none"], "worst first");
  for (const status of VERIFY_BAD) {
    const issues = ROWS({ verification_status: status }, ACTIVE).issues;
    assert.deepEqual(issues.map((i) => i.id), ["verification"], status);
    assert.equal(issues[0].label, "bms.st.unverified");
    assert.equal(issues[0].tone, "bad");
    assert.equal(issues[0].fix.url, FIX.verification);
    assert.equal(issues[0].fix.label, "bms.fix.verify");
    assert.equal(issues[0].line, true, "its fix is on line 2");
  }
  const noActive = ROWS({ verification_status: "verified" }, [A("1", "1001", 2)]).issues;
  assert.deepEqual(noActive.map((i) => [i.id, i.label, i.tone, i.fix.url, i.fix.label, i.line]), [["noActive", "bms.st.noActive", "bad", FIX.noActive, "bms.fix.accounts", false]], "no fix on line 2: it waits in the body");
  const none = ROWS({ verification_status: "verified" }, []).issues;
  assert.deepEqual(none.map((i) => [i.id, i.label, i.tone, i.fix.url, i.fix.label, i.line]), [["none", "bms.st.none", "warn", FIX.none, "bms.fix.create", true]]);
  assert.equal(FIX.verification, "https://business.facebook.com/settings/security?business_id=1001");
  assert.equal(FIX.none, "https://business.facebook.com/settings/ad-accounts?business_id=1001");
  for (const p of PROBLEMS) assert.ok(p.help && p.tip && p.fix.tip, p.id);
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

test("a business of someone else (only named by an account) has its state but no fix: its settings are not the profile's to open", () => {
  const rows = buildRows({ bms: [], accounts: [A("1", "777", 2)], loaded: true, stats });
  assert.equal(rows[0].state, "noActive");
  assert.deepEqual(rows[0].issues.map((i) => [i.id, i.fix]), [["noActive", null]]);
  assert.deepEqual(issuesOf({ known: false, verification: "failed", state: "none", id: "5" }).map((i) => i.fix), [null, null]);
});

test("a link links.js rejects is dropped, never half-built", () => {
  const [i] = issuesOf({ known: true, verification: "failed", state: null, id: "not-digits" });
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
test("every key the tab can draw exists in both languages (the dynamic ones: problems, verification states, fixes); no slang, no product name, no Copy IDs", async () => {
  const { STRINGS } = await import("../fb-helper/js/strings/bms.js");
  const keys = new Set([
    "bms.st.active", "bms.verTitle", "bms.noSpend", "bms.openSettings", "bms.settings", "bms.accCount", "bms.disabledWord", "bms.activeWord", "bms.search.aria", "bms.refresh",
    "bms.kv.accounts", "bms.kv.verification", "bms.show", "bms.showTitle", "bms.accsPartial",
    ...VERIFY_KNOWN.map((s) => `bms.ver.${s}`),
  ]);
  for (const p of PROBLEMS) { keys.add(p.label); keys.add(p.tip); keys.add(p.help); keys.add(p.fix.label); keys.add(p.fix.tip); }
  for (const l of ["ru", "en"]) assert.deepEqual([...keys].filter((k) => !STRINGS[l][k]), [], `missing in ${l}`);
  assert.deepEqual(Object.keys(STRINGS.ru).sort(), Object.keys(STRINGS.en).sort());
  for (const k of ["bms.accCount", "bms.disabledWord", "bms.activeWord"]) { assert.equal(STRINGS.ru[k].length, 3, k); assert.equal(STRINGS.en[k].length, 2, k); }
  for (const l of ["ru", "en"]) for (const v of Object.values(STRINGS[l]).flat()) assert.ok(!/fb helper|(^|[^\p{L}])(BM|БМ)(?![\p{L}])/iu.test(v), v);
  for (const l of ["ru", "en"]) for (const p of PROBLEMS) assert.ok(STRINGS[l][p.fix.label].length <= 32, `${l} ${p.fix.label}`);
  for (const l of ["ru", "en"]) assert.ok(!Object.keys(STRINGS[l]).some((k) => /copyIds|idsCopied/.test(k)), "Copy IDs is gone");
  // the words of design.md §8
  assert.deepEqual([STRINGS.en["bms.st.noActive"], STRINGS.en["bms.st.none"], STRINGS.en["bms.st.unverified"], STRINGS.en["bms.fix.create"], STRINGS.en["bms.fix.verify"]], ["None active", "No ad accounts", "Unverified", "Create account", "Verify"]);
  assert.deepEqual([STRINGS.ru["bms.st.noActive"], STRINGS.ru["bms.st.none"], STRINGS.ru["bms.st.unverified"], STRINGS.ru["bms.fix.create"], STRINGS.ru["bms.fix.verify"]], ["Нет активных", "Нет кабинетов", "Не верифицирован", "Создать кабинет", "Верификация"]);
});

test("the plural words: 3 кабинета · 1 заблокирован / 3 ad accounts · 1 disabled", async () => {
  const { tn, setLang: set } = await import("../fb-helper/js/i18n.js");
  await import("../fb-helper/js/strings/bms.js");
  try {
    await set("ru");
    assert.deepEqual([1, 2, 3, 5, 11, 21].map((n) => `${n} ${tn(n, "bms.accCount")}`), ["1 кабинет", "2 кабинета", "3 кабинета", "5 кабинетов", "11 кабинетов", "21 кабинет"]);
    assert.deepEqual([1, 2, 5, 21].map((n) => tn(n, "bms.disabledWord")), ["заблокирован", "заблокированы", "заблокированы", "заблокирован"]);
    await set("en");
    assert.deepEqual([1, 3].map((n) => `${n} ${tn(n, "bms.accCount")}`), ["1 ad account", "3 ad accounts"]);
    assert.deepEqual([1, 3].map((n) => tn(n, "bms.disabledWord")), ["disabled", "disabled"]);
  } finally { await set("en"); }
});

test("slimBm: control and bidi characters leave the name (it is drawn, searched and stored)", () => {
  const r = slimBm({ id: "5", name: "Nova\u202E fdp\nMedia\u2066" });
  assert.equal(r.name, "Nova fdp Media");
});

test("buildRows: counts and state use the members (owner OR read-through business), spend only the owner's group", () => {
  const acc = (id, status, biz, via, cur = "USD") => ({ account_id: id, account_status: status, currency: cur, business: { id: biz, name: `Owner ${biz}` }, ...(via ? { _viaBm: true, _bmId: via, _bmName: `Through ${via}` } : {}) });
  const accounts = [acc("1", 1, "10"), acc("2", 1, "20", "10"), acc("3", 2, "20", "10"), acc("4", 1, "30", "40")];   // 2 and 3: owned by 20, shared with 10; 4: owned by 30, read through the (unlisted) business 40
  const stats = (a) => ({ spend: { 1: 5, 2: 7, 3: 3, 4: 1 }[a.account_id] });
  const rows = buildRows({ bms: [slimBm({ id: "10", name: "Mine" }), slimBm({ id: "11", name: "Empty" })], accounts, loaded: true, stats });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(rows.map((r) => r.id), ["10", "11", "20", "30", "40"], "profile's businesses first, then owners and read-through businesses of the accounts");
  assert.deepEqual(by["10"].counts, { total: 3, active: 2, disabled: 1 }, "Mine: its own account and the two shared with it");
  assert.equal(by["10"].state, "active"); assert.deepEqual(by["10"].issues, []);
  assert.deepEqual(by["10"].spend.totals, { USD: 5 }, "spend: only the account Mine owns (the shared ones are in 20's group)");
  assert.deepEqual(by["20"].counts, { total: 2, active: 1, disabled: 1 }); assert.deepEqual(by["20"].spend.totals, { USD: 10 });
  assert.deepEqual(by["11"].counts, { total: 0, active: 0, disabled: 0 }); assert.equal(by["11"].state, "none");
  assert.equal(by["40"].name, "Through 40", "a business known only as the read-through side takes its name from the account"); assert.equal(by["40"].known, false);
  assert.deepEqual(by["40"].counts, { total: 1, active: 1, disabled: 0 }); assert.deepEqual(by["40"].spend.totals, {}, "it owns nothing: its spend is 0, the account's $1 is Owner 30's");
  assert.deepEqual(by["30"].spend.totals, { USD: 1 });
  const sum = (key) => Object.values(rows.reduce((t, r) => ({ ...t, ...Object.fromEntries(Object.entries(r.spend.totals).map(([c, v]) => [c, (t[c] || 0) + v])) }), {}))[0];
  assert.equal(sum(), 16, "the rows' spend adds up to the list's total once: 5 + 7 + 3 + 1");
});
test("buildRows: a business whose accounts are all shared with it is not 'No ad accounts' (C2) and the problems follow the members", () => {
  const accounts = [{ account_id: "2", account_status: 2, currency: "USD", business: { id: "20", name: "O" }, _viaBm: true, _bmId: "10" }];
  const [row] = buildRows({ bms: [slimBm({ id: "10", name: "Mine" })], accounts, loaded: true, stats: () => ({ spend: 0 }) }).filter((r) => r.id === "10");
  assert.equal(row.state, "noActive", "it has an account, none active");
  assert.deepEqual(row.issues.map((i) => i.id), ["noActive"]);
});

test("bmKeysToDrop (C8): a permission error gives the extra fields up one tier at a time — verification first, then the logo — and then nothing is left; other errors give nothing up", () => {
  const perm = (code, raw = "") => ({ code, raw, message: raw });
  const skipped = new Set();
  assert.deepEqual(bmKeysToDrop(perm(10), skipped), ["verification_status"]);
  skipped.add("verification_status");
  assert.deepEqual(bmKeysToDrop(perm(200, "(#200) Requires business_management"), skipped), ["profile_picture_uri"]);
  skipped.add("profile_picture_uri");
  assert.deepEqual(bmKeysToDrop(perm(10), skipped), [], "id and name only: a token that fails even that cannot read businesses");
  assert.deepEqual(bmKeysToDrop(perm(100, "(#100) Unsupported get request, missing permissions"), new Set()), ["verification_status"], "a #100 that names no field is a permission error too");
  for (const e of [perm(1, "boom"), perm(2, "temporary"), perm(100, "(#100) Tried accessing nonexisting field (x)"), perm(undefined, "network down"), null, undefined])
    assert.deepEqual(bmKeysToDrop(e, new Set()), [], JSON.stringify(e));
});
