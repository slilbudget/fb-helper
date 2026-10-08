// Unit tests for fb-helper/js/pure.js — plain Node, no browser: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { isSessionError, sessionLabel, verNum, latestVersion, adRank, reviewLines, ownerVerdict, profileBlock, isUserAgent, lifetimeSpend, spendFloor, insightRow, cleanText, digitsId, isPermError, humanEnum } from "../fb-helper/js/pure.js";

test("session errors: code 190 (any subcode) and 102; subcodes alone are not enough", () => {
  for (const c of [190, "190", 102]) assert.ok(isSessionError(c), String(c));
  for (const c of [1, 10, 100, 17, 2635, 459, 463, undefined, null]) assert.ok(!isSessionError(c), String(c));
  assert.equal(sessionLabel(190, 463), "190/463");
  assert.equal(sessionLabel(190), "190");
});

test("latestVersion: the newest named, not the first", () => {
  assert.equal(latestVersion("v26.0 is deprecated, the call was upgraded to v27.0"), "v27.0");
  assert.equal(latestVersion("upgraded to v28.0 as v27.0 has been deprecated"), "v28.0");
  assert.equal(latestVersion("update to the latest version: v27.0."), "v27.0");
  assert.equal(latestVersion("v9.0 and v26.1 and v26.0"), "v26.1");
  assert.equal(latestVersion("no version here"), null);
  assert.equal(latestVersion("stray v999.0 in user data; update to the latest version: v27.0", verNum("v26.0") + 500), "v27.0", "cap hides absurd versions");
  assert.equal(latestVersion("only v999.0", verNum("v26.0") + 500), null);
  assert.equal(latestVersion(null), null);
  assert.equal(latestVersion("dev12.3 or v1.2x"), null, "must be a whole word");
  assert.ok(verNum("v26.0") > verNum("v25.9"));
  assert.equal(verNum("garbage"), 0);
});

test("reviewLines: reasons with their keys, per placement, plus issues_info", () => {
  const ad = {
    ad_review_feedback: {
      global: { "Personal attributes": "Your ad implies knowledge of personal traits" },
      placement_specific: { instagram: { "Misleading claims": "The ad makes unrealistic claims" }, audience_network: { Sensational: "" } },
    },
    effective_status: "WITH_ISSUES",
    issues_info: [{ error_summary: "Ad set has no budget", error_message: "Set a budget to deliver" }],
  };
  assert.deepEqual(reviewLines(ad), [
    "Personal attributes — Your ad implies knowledge of personal traits",
    "Instagram: Misleading claims — The ad makes unrealistic claims",
    "Audience network: Sensational",
    "Ad set has no budget — Set a budget to deliver",
  ]);
});

test("reviewLines: a placement-only rejection is not empty (the old code returned '')", () => {
  const ad = { ad_review_feedback: { placement_specific: { instagram: { "Misleading claims": "…" } } } };
  assert.deepEqual(reviewLines(ad), ["Instagram: Misleading claims — …"]);
});

test("reviewLines: odd shapes never throw, duplicates collapse", () => {
  assert.deepEqual(reviewLines(undefined), []);
  assert.deepEqual(reviewLines({}), []);
  assert.deepEqual(reviewLines({ ad_review_feedback: null, issues_info: "x" }), []);
  assert.deepEqual(reviewLines({ ad_review_feedback: { global: ["A", "A", "B"], placement_specific: [1] } }), ["A", "B"]);
  assert.deepEqual(reviewLines({ ad_review_feedback: { global: { k: { nested: 1 } } } }), ['k — {"nested":1}']);
  assert.deepEqual(reviewLines({ effective_status: "WITH_ISSUES", issues_info: [null, {}, { error_summary: "S" }] }), ["S"]);
});

test("reviewLines: issues_info of a healthy ad is not shown (no red text on ACTIVE rows)", () => {
  const info = [{ error_summary: "Ad set has no budget", error_message: "Set a budget" }];
  for (const st of ["ACTIVE", "PAUSED", "PENDING_REVIEW", undefined]) assert.deepEqual(reviewLines({ effective_status: st, issues_info: info }), [], String(st));
  assert.equal(reviewLines({ effective_status: "DISAPPROVED", issues_info: info }).length, 1);
});

test("adRank puts disapproved / with-issues first and keeps the rest stable", () => {
  const ads = ["ACTIVE", "PAUSED", "DISAPPROVED", "PENDING_REVIEW", "WITH_ISSUES"].map((s, i) => ({ s, i }));
  const sorted = [...ads].sort((a, b) => adRank(a.s) - adRank(b.s)).map((a) => a.s);
  assert.deepEqual(sorted, ["DISAPPROVED", "WITH_ISSUES", "ACTIVE", "PAUSED", "PENDING_REVIEW"]);
});

test("ownerVerdict: mismatch only for first-party tokens", () => {
  assert.equal(ownerVerdict(true, "1001", "1001"), "ok");
  assert.equal(ownerVerdict(true, 1001, "1001"), "ok");
  assert.equal(ownerVerdict(true, "999", "1001"), "mismatch");
  assert.equal(ownerVerdict(false, "122190171494905792", "1001"), "unknown", "app-scoped id of a custom app");
  assert.equal(ownerVerdict(true, null, "1001"), "unknown");
  assert.equal(ownerVerdict(true, "1001", null), "unknown");
});

test("lifetimeSpend: amount_spent that lags is lifted to the proven floor, never lowered", () => {
  assert.equal(spendFloor(3, 0), 3);
  assert.equal(spendFloor(3, 20), 23);
  assert.equal(spendFloor(NaN, undefined), 0, "missing insights rows count as 0");
  assert.equal(lifetimeSpend(0, spendFloor(3, 0)), 3, "new account: Meta says 0, today already $3");
  assert.equal(lifetimeSpend(100, spendFloor(3, 20)), 100, "Meta's total is bigger: keep it");
  assert.equal(lifetimeSpend(5, spendFloor(3, 50)), 53, "total was reset below the last 30 days");
  assert.equal(lifetimeSpend(5, undefined), 5, "no insights read: Meta's number as is");
  assert.equal(lifetimeSpend(undefined, undefined), 0);
  assert.equal(lifetimeSpend("12.5", 1), 12.5);
});

test("insightRow: one nested insights period -> numbers; no key = a real 0; a bad spend = unknown", () => {
  assert.deepEqual(insightRow({ data: [{ spend: "12.40", impressions: "3100", inline_link_clicks: "48", date_start: "2026-09-30", date_stop: "2026-09-30" }] }),
    { spend: 12.4, imp: 3100, clicks: 48, from: "2026-09-30", to: "2026-09-30" });
  assert.deepEqual(insightRow(undefined), { spend: 0, imp: 0, clicks: 0 });
  assert.deepEqual(insightRow({ data: [] }), { spend: 0, imp: 0, clicks: 0 });
  assert.equal(insightRow({ data: [{ spend: "n/a" }] }), null);
  assert.deepEqual(insightRow({ data: [{ spend: "5" }] }), { spend: 5, imp: 0, clicks: 0, from: undefined, to: undefined }, "missing counters are 0");
});

test("isUserAgent: printable ASCII, 8..512 characters, nothing else", () => {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  assert.ok(isUserAgent(ua));
  assert.ok(isUserAgent("x".repeat(8)) && !isUserAgent("x".repeat(7)), "lower bound 8");
  assert.ok(isUserAgent("x".repeat(512)) && !isUserAgent("x".repeat(513)), "upper bound 512");
  assert.ok(isUserAgent("Mozilla/5.0 <b>x</b>"), "markup-shaped text is fine as text: the popup never uses innerHTML");
  for (const bad of ["Mozilla/5.0\n(X11)", "Mozilla/5.0\r\n(X11)", "Mozilla/5.0\t(X11)", "Mozilla/5.0\x7f(X11)", "Mozilla/5.0 (Ü)", "Mozilla/5.0 \u2028 (X11)", ""]) assert.ok(!isUserAgent(bad), JSON.stringify(bad));
  for (const bad of [5, null, undefined, {}, ["Mozilla/5.0 (X11)"], true]) assert.ok(!isUserAgent(bad), String(bad));
});

test("profileBlock: English, name (id), BMs with ids; none / not available / more; no forged lines", () => {
  const bms = [{ id: "111", name: "Nova Media" }, { id: "222", name: "Lumen Traffic" }];
  assert.equal(profileBlock({ name: "Alex Carter", id: "1001", businesses: bms }),
    "Profile: Alex Carter (1001)\nBM: Nova Media (111), Lumen Traffic (222)");
  assert.equal(profileBlock({ name: "Alex", id: "1001", businesses: bms, more: true }), "Profile: Alex (1001)\nBM: Nova Media (111), Lumen Traffic (222), …");
  assert.equal(profileBlock({ name: "Alex", id: "1001", businesses: [] }), "Profile: Alex (1001)\nBM: none");
  assert.equal(profileBlock({ name: "Alex", id: "1001", businesses: null }), "Profile: Alex (1001)\nBM: not available");
  assert.equal(profileBlock({ name: "Alex", id: null, businesses: null }), "Profile: Alex\nBM: not available", "unverified: no app-scoped id");
  assert.equal(profileBlock({ name: null, id: "1001", businesses: [] }), "Profile: 1001\nBM: none");
  const forged = profileBlock({ name: "A\n\nB", id: "1", businesses: [{ id: "9", name: "X\r\nY" }, { name: "no id" }] });
  assert.equal(forged, "Profile: A B (1)\nBM: X Y (9)");
  assert.equal(forged.split("\n").length, 2);
});

// Scans EVERY file under fb-helper/js (modules and strings files alike) plus popup.html. Feature modules keep their own
// strings in js/strings/<feature>.js: `export const STRINGS = { ru: {…}, en: {…} }; addStrings(STRINGS);` — plain data,
// importable here in Node (the modules that use them touch `document` / `chrome` and cannot be). Loading such a file registers
// its strings, so the coverage check below sees them like the ones in i18n.js.
test("i18n: every key the popup uses exists in both languages (all js files; strings added by feature modules included)", async () => {
  const fs = await import("node:fs");
  const { LANGS, setLang, has } = await import("../fb-helper/js/i18n.js");
  const dir = new URL("../fb-helper/", import.meta.url);
  const files = fs.readdirSync(new URL("js/", dir), { recursive: true }).map((f) => f.replaceAll("\\", "/")).filter((f) => f.endsWith(".js")).sort();
  assert.ok(files.length >= 10, `found only ${files.length} js files`);
  const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(new URL(`js/${f}`, dir), "utf8")]));

  for (const f of files.filter((f) => f.startsWith("strings/"))) {
    const mod = await import(new URL(`js/${f}`, dir));
    assert.ok(mod.STRINGS?.ru && mod.STRINGS?.en, `${f} must export STRINGS = { ru, en }`);
    assert.deepEqual(Object.keys(mod.STRINGS.ru).sort(), Object.keys(mod.STRINGS.en).sort(), `${f}: ru and en must have the same keys`);
    for (const k of Object.keys(mod.STRINGS.ru)) assert.ok(has(k), `${f} never called addStrings (${k} is unknown)`);
    assert.ok(files.some((g) => g !== f && src[g].includes(f)), `${f} is not imported by any module, so its strings never load`);
  }

  const html = fs.readFileSync(new URL("popup.html", dir), "utf8");
  const code = Object.values(src).join("\n");
  const keys = new Set([
    ...[...code.matchAll(/\bt\("([\w.]+)"/g)].map((m) => m[1]),
    ...[...code.matchAll(/\btn\([^,]+,\s*"([\w.]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="([\w.]+)"/g)].map((m) => m[1]),
  ]);
  assert.ok(keys.size > 50, `found only ${keys.size} keys`);
  for (const l of LANGS) {
    await setLang(l);
    const missing = [...keys].filter((k) => !has(k));
    assert.deepEqual(missing, [], `missing in ${l}`);
  }
});

// "BM" / "БМ" is slang: the interface says "бизнес-портфолио" / "business portfolio" (full term) or "бизнесы" / "businesses" (short).
// The one place it stays is the copied "Token + cookies + UA" block (its "BM:" line), which other tools parse.
test("i18n: the business wording is the full term or 'Businesses'; the rows have no 'BM' prefix", async () => {
  const { setLang, t, has } = await import("../fb-helper/js/i18n.js");
  await import("../fb-helper/js/strings/actions.js");
  for (const [lang, tab, accounts] of [["ru", "Бизнесы", "Кабинеты"], ["en", "Businesses", "Accounts"]]) {
    await setLang(lang);
    assert.equal(t("tab.bms"), tab);
    assert.equal(t("tab.accounts"), accounts);
    for (const k of ["tab.bms", "acc.bmFilterClear", "acc.personal", "acc.noAccess", "surface.bm", "reason.6", "reason.11", "next.help.r6", "next.help.r11", "next.help.noAccess"])
      assert.ok(has(k) && !/(^|[^\p{L}])(BM|БМ)(?![\p{L}])/u.test(t(k, { n: "X", id: "1" })), `${lang} ${k}: ${t(k)}`);
    assert.ok(!has("acc.bm") && !has("acc.bmPrefix") && !has("acc.inBm") && !has("acc.noBm"), "the prefix and owner-line strings are gone (the group header names the business)");
  }
  await setLang("en");
});

// The short words of an ad account's row (design.md section 8): the status and the disable reason are one word each, no "(N)" code, no "/ Integrity".
test("i18n: status and reason words of an ad account are short, in both languages, with the decided wording", async () => {
  const { setLang, t, has } = await import("../fb-helper/js/i18n.js");
  const en = { "status.1": "Active", "status.2": "Disabled", "status.3": "Unpaid", "status.7": "In review", "status.8": "Settling", "status.9": "Grace period",
    "status.100": "Closing", "status.101": "Closed", "status.restricted": "Restricted", "acc.noAccess": "No access",
    "reason.1": "Ads policy", "reason.2": "IP rights review", "reason.3": "Payment risk", "reason.4": "Shut down", "reason.5": "AFC review", "reason.6": "Business integrity",
    "reason.7": "Closed for good", "reason.8": "Unused", "reason.9": "Unused", "reason.10": "Unused", "reason.11": "Business integrity", "reason.12": "Misrepresented",
    "reason.13": "Entity unshared", "reason.14": "Thread review", "reason.15": "Compromised" };
  const ru = { "status.1": "Активен", "status.2": "Заблокирован", "status.3": "Долг", "status.7": "На проверке", "status.8": "Оплата идёт", "status.9": "Отсрочка",
    "status.100": "Закрывается", "status.101": "Закрыт", "status.restricted": "Ограничен", "acc.noAccess": "Нет доступа",
    "reason.1": "Правила рекламы", "reason.2": "Проверка прав (IP)", "reason.3": "Платёжный риск", "reason.4": "Закрыт", "reason.5": "AFC-проверка", "reason.6": "Правила бизнеса",
    "reason.7": "Закрыт навсегда", "reason.8": "Не используется", "reason.9": "Не используется", "reason.10": "Не используется", "reason.11": "Правила бизнеса",
    "reason.12": "Искажение данных", "reason.13": "Юрлицо отвязано", "reason.14": "Проверка переписки", "reason.15": "Взлом" };
  for (const [lang, words] of [["en", en], ["ru", ru]]) {
    await setLang(lang);
    for (const [k, v] of Object.entries(words)) {
      assert.equal(t(k), v, `${lang} ${k}`);
      assert.ok(!/\(\d+\)|\//.test(t(k)) && t(k).length <= 20, `${lang} ${k}: one short word, no numeric code`);
    }
  }
  assert.ok(!has("reason.other"), "no generic 'Reason' word: an unknown code is a plain Disabled");
  await setLang("en");
});

// ---------- text and ids from Graph ----------
const RLO = "\u202E", LRE = "\u202A", PDF = "\u202C", LRI = "\u2066", PDI = "\u2069";
test("cleanText: bidi controls U+202A-202E and U+2066-2069 are dropped, control characters become spaces, the text is cut and trimmed", () => {
  assert.equal(cleanText(`Invoice ${RLO}fdp.exe`), "Invoice fdp.exe");
  assert.equal(cleanText(`${LRE}a${PDF}${LRI}b${PDI}`), "ab");
  for (let c = 0x202A; c <= 0x202E; c++) assert.equal(cleanText(`x${String.fromCharCode(c)}y`), "xy", c.toString(16));
  for (let c = 0x2066; c <= 0x2069; c++) assert.equal(cleanText(`x${String.fromCharCode(c)}y`), "xy", c.toString(16));
  assert.equal(cleanText("two\nlines\r\n\tand a tab\u0000x\u2028y"), "two lines and a tab x y");
  assert.equal(cleanText("  padded  "), "padded");
  assert.equal(cleanText("abcdef", 3), "abc");
  assert.equal(cleanText("Кириллица и 日本語 stay"), "Кириллица и 日本語 stay");
  for (const bad of [null, undefined, 5, {}, ["a"], true]) assert.equal(cleanText(bad), "", String(bad));
});
test("digitsId: 1-25 digits (string or number) or null; nothing that could add a path segment", () => {
  assert.equal(digitsId("123"), "123"); assert.equal(digitsId(123), "123"); assert.equal(digitsId("1".repeat(25)), "1".repeat(25));
  for (const bad of [null, undefined, "", "act_1", "1/2", "1?x", "../1", " 1", "1 ", "1.5", -1, "1".repeat(26), {}, [1]]) assert.equal(digitsId(bad), null, JSON.stringify(bad));
});
test("reviewLines and profileBlock clean Graph's text of bidi controls too", () => {
  assert.deepEqual(reviewLines({ ad_review_feedback: { global: { [`Rule ${RLO}x`]: `desc${LRI}` } } }), ["Rule x — desc"]);
  assert.equal(profileBlock({ name: `Alex${RLO}`, id: "1", businesses: [{ id: "2", name: `Nova${LRE}` }] }), "Profile: Alex (1)\nBM: Nova (2)");
});

// ---------- review round 1, Fix B ----------
test("isPermError: one rule for every list tab — #10, #283, #200–299 and a #100 that names no field; field complaints, throttle, session and plain failures are not", () => {
  const e = (code, raw) => ({ code, raw });
  for (const code of [10, 283, 200, 210, 299]) assert.equal(isPermError(e(code, "no")), true, String(code));
  assert.equal(isPermError(e(100, "Unsupported get request. Object with ID 'me' does not exist, cannot be loaded due to missing permissions")), true);
  assert.equal(isPermError(e(100, "Tried accessing nonexisting field (insights) on node type (AdAccount)")), false, "a field complaint is not about permissions");
  for (const code of [1, 4, 17, 190, 199, 300, 2635, undefined]) assert.equal(isPermError(e(code, "x")), false, String(code));
  assert.equal(isPermError(new Error("plain")), false); assert.equal(isPermError(null), false);
});

test("humanEnum: an enum no string covers is shown as plain words, never as a raw constant", () => {
  assert.equal(humanEnum("PENDING_BILLING_INFO"), "Pending billing info");
  assert.equal(humanEnum("MANAGE_JOBS"), "Manage jobs");
  assert.equal(humanEnum("WITH__ISSUES"), "With issues", "doubled underscores are one space");
  assert.equal(humanEnum("x"), "X");
  for (const v of ["", "___", null, undefined]) assert.equal(humanEnum(v), "");
});

test("tnPlus: the count word of 'at least n' (written '10+') is the many / plural form, never the singular", async () => {
  const { setLang, tnPlus, tn, addStrings } = await import("../fb-helper/js/i18n.js");
  addStrings({ ru: { "t.thing": ["кабинет", "кабинета", "кабинетов"] }, en: { "t.thing": ["ad account", "ad accounts"] } });
  try {
    await setLang("ru");
    assert.deepEqual([1, 2, 5, 21].map((n) => tn(n, "t.thing")), ["кабинет", "кабинета", "кабинетов", "кабинет"]);
    assert.deepEqual([1, 2, 5, 21].map((n) => tnPlus(n, "t.thing", true)), ["кабинетов", "кабинетов", "кабинетов", "кабинетов"], "'1+ кабинетов', '2+ кабинетов'");
    assert.deepEqual([1, 2].map((n) => tnPlus(n, "t.thing", false)), ["кабинет", "кабинета"], "without the plus nothing changes");
    await setLang("en");
    assert.deepEqual([1, 3].map((n) => tnPlus(n, "t.thing", true)), ["ad accounts", "ad accounts"], "'1+ ad accounts'");
    assert.equal(tnPlus(1, "t.thing", false), "ad account");
  } finally { await setLang("en"); }
});

test("format: fullDate and tzLabel — the muted facts line of an account body ('UTC+3 Kyiv · US · created 04.03.2025')", async () => {
  const { setLang } = await import("../fb-helper/js/i18n.js");
  const { fullDate, tzLabel } = await import("../fb-helper/js/format.js");
  try {
    await setLang("ru"); assert.equal(fullDate("2025-03-04T10:00:00+0000"), "04.03.2025"); assert.equal(fullDate("2025-03-04"), "04.03.2025");
    await setLang("en"); assert.equal(fullDate("2025-03-04T10:00:00+0000"), "Mar 4, 2025");
  } finally { await setLang("en"); }
  for (const bad of [undefined, null, "", "yesterday", "2025-3-4"]) assert.equal(fullDate(bad), "", String(bad));
  assert.match(tzLabel("Europe/Kiev"), /^UTC\+[23] \S/, "offset, a space, the city: no dot between them (the line has its own dots)");
  assert.equal(tzLabel("Etc/GMT+3"), "UTC−3", "Etc/GMT+N is UTC−N");
  assert.equal(tzLabel("UTC"), "UTC"); assert.equal(tzLabel(""), "");
});
