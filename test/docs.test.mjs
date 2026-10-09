// What the documents promise, checked against what the extension is: the privacy policy names every origin the CSP allows, the store listing quotes
// the manifest's CSP, no text says requests go ONLY to the Graph host (the extension also fetches exchange rates and pictures), the manifest's version
// is in every place a release has to write it, the permissions are explained. Plain Node: `node --test test/*.test.mjs`

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const manifest = JSON.parse(read("fb-helper/manifest.json"));
const csp = manifest.content_security_policy.extension_pages;
const directive = (name) => (csp.split(";").map((d) => d.trim().split(/\s+/)).find(([k]) => k === name) || []).slice(1);
const hostOf = (src) => new URL(src.replace("*.", "")).hostname;
const GRAPH = hostOf(directive("connect-src")[0]);                                   // the Graph host: the first origin of connect-src (test/harness.mjs reads it from there too)
const OTHER_CONNECT = directive("connect-src").slice(1).map(hostOf);                 // the exchange-rate sources
const PICTURE_HOSTS = directive("img-src").filter((s) => s.startsWith("https:")).map(hostOf).filter((h) => h !== GRAPH);   // the Graph origin is in img-src too (the picture redirect of a page); it is GRAPH already
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DOCS = ["README.md", "PRIVACY_POLICY.md", "SECURITY.md", "chrome-web-store/STORE_LISTING.md", "chrome-web-store/RELEASE_CHECKLIST.md"];

test("the origins are what the tests below assume (a Graph host, two rate sources, two picture hosts, nothing with a wildcard in connect-src)", () => {
  assert.match(GRAPH, /^graph\./);
  assert.equal(OTHER_CONNECT.length, 2);
  assert.deepEqual(PICTURE_HOSTS.length, 2);
  assert.ok(directive("img-src").includes(directive("connect-src")[0]), "img-src names the Graph origin too (the picture redirect of a Page): the policy's Graph paragraph covers it");
  assert.ok(directive("connect-src").every((s) => !s.includes("*")));
});

test("PRIVACY_POLICY.md names every origin the CSP lets the popup talk to or load pictures from — the Graph host, the rate sources, the picture hosts — in English and in Russian", () => {
  const policy = read("PRIVACY_POLICY.md");
  const cut = policy.search(/^# Политика конфиденциальности/m);
  assert.ok(cut > 0, "the Russian half starts at its own heading");
  for (const [lang, part] of [["English", policy.slice(0, cut)], ["Russian", policy.slice(cut)]]) {
    const missing = [GRAPH, ...OTHER_CONNECT, ...PICTURE_HOSTS].filter((h) => !part.includes(h));
    assert.deepEqual(missing, [], `${lang}: origins the CSP allows that the policy never mentions`);
  }
});

test("the store listing's quote of the manifest CSP is the manifest's CSP, word for word", () => {
  const listing = read("chrome-web-store/STORE_LISTING.md");
  const quoted = /manifest CSP is `([^`]+)`/.exec(listing);
  assert.ok(quoted, "the listing quotes the CSP");
  assert.equal(quoted[1], csp);
});

test("no text says the extension's requests go ONLY to the Graph host: a sentence that names it with 'only' / 'только' must name the rate sources too (the manifest's own description, the policy, the listing, the README, SECURITY, the checklist)", () => {
  const texts = [["fb-helper/manifest.json (description)", manifest.description], ...DOCS.map((f) => [f, read(f)])];
  const claims = [];
  for (const [file, text] of texts) {
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
      if (!new RegExp(esc(GRAPH)).test(sentence)) continue;
      if (!/\b(only|solely)\b|\bтолько\b|\bединственн\p{L}*/iu.test(sentence)) continue;
      if (OTHER_CONNECT.every((h) => sentence.includes(h))) continue;            // "only to the Graph host and the two exchange-rate hosts": fine
      claims.push(`${file}: ${sentence.trim().slice(0, 140)}`);
    }
  }
  assert.deepEqual(claims, [], "these sentences say 'only' about the Graph host");
});

test("the version of the manifest is written where a release writes it: README, STORE_LISTING, RELEASE_CHECKLIST, the three art pages, the bug form's placeholder", () => {
  const v = manifest.version, bare = new RegExp(`(?<![\\d.])${esc(v)}(?![\\d.])`);
  const places = ["README.md", "chrome-web-store/STORE_LISTING.md", "chrome-web-store/RELEASE_CHECKLIST.md", "chrome-web-store/art/cover.html", "chrome-web-store/art/cover-1280x800.html",
    "chrome-web-store/art/social.html", ".github/ISSUE_TEMPLATE/bug.yml"];
  const stale = places.filter((f) => !bare.test(read(f)));
  assert.deepEqual(stale, [], `version ${v} is missing from`);
  assert.match(v, /^\d+\.\d+\.\d+$/);
});

test("no place names a version other than the manifest's as the current one (the art pages' badge, the bug form, the listing's heading, the README's heading)", () => {
  const v = manifest.version;
  const heads = [["README.md", /^# FB Helper (\S+)/m], ["chrome-web-store/STORE_LISTING.md", /^# Chrome Web Store listing — Ads Helper (\S+)/m], [".github/ISSUE_TEMPLATE/bug.yml", /placeholder: (\S+)/],
    ["chrome-web-store/art/cover.html", /<span class="v">([^<]+)<\/span>/], ["chrome-web-store/art/cover-1280x800.html", /<span class="v">([^<]+)<\/span>/], ["chrome-web-store/art/social.html", /<span class="v">([^<]+)<\/span>/]];
  for (const [file, re] of heads) assert.equal(re.exec(read(file))?.[1], v, file);
});

test("every permission of the manifest and its host pattern is explained in the privacy policy and in the store listing", () => {
  for (const f of ["PRIVACY_POLICY.md", "chrome-web-store/STORE_LISTING.md"]) {
    const text = read(f);
    for (const p of manifest.permissions) assert.ok(new RegExp("(`|\\*\\*)" + p + "(`|\\*\\*)").test(text), `${f} explains the ${p} permission (as \`${p}\` or **${p}**)`);
    for (const h of manifest.host_permissions) assert.ok(text.includes(h), `${f} names the host permission ${h}`);
  }
});

test("the release checklist runs the tests that guard a release: the unit tests, the store build's end-to-end run, and this file", () => {
  const checklist = read("chrome-web-store/RELEASE_CHECKLIST.md");
  assert.match(checklist, /node --test test\/\*\.test\.mjs/);
  assert.match(checklist, /EXT_DIR=chrome-web-store\/release\/unpacked node test\/e2e\.mjs/);
  assert.match(checklist, /node --test test\/docs\.test\.mjs/);
});
