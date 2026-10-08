// manifest.json: the Content-Security-Policy is the second lock under the code's own checks (imageUrl, the Graph host in popup.js, the two
// rate-table URLs in money.js). Plain Node: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL(`../fb-helper/${f}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const csp = Object.fromEntries(manifest.content_security_policy.extension_pages.split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));

test("CSP: scripts only from the extension, no plugins, no <base>, no form posts, no unsafe-* anywhere", () => {
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'none'"]);
  assert.deepEqual(csp["form-action"], ["'none'"]);
  assert.ok(!/unsafe-|\*\s|data:|blob:/.test(manifest.content_security_policy.extension_pages.replace(/https:\/\/\*\.(fbcdn\.net|fbsbx\.com)/g, "")), "no unsafe-inline / unsafe-eval / data: / blob: / bare wildcard");
});

test("CSP: pictures only from the extension itself, Meta's two picture hosts (the same two imageUrl accepts) and the Graph origin (the picture redirect of a page, links.js graphPicture)", () => {
  assert.deepEqual(csp["img-src"], ["'self'", csp["connect-src"][0], "https://*.fbcdn.net", "https://*.fbsbx.com"]);
  assert.ok(!csp["img-src"][1].includes("*") && new URL(csp["img-src"][1]).pathname === "/", "an origin: no path, no wildcard");
});

test("CSP connect-src: the Graph origin FIRST (test/harness.mjs reads it from there), then the two exact rate-table URLs of money.js and nothing else", () => {
  const [graph, ...fx] = csp["connect-src"];
  assert.match(graph, /^https:\/\/[a-z.]+$/, "an origin without a path or a wildcard");
  assert.ok(new URL(graph).hostname.startsWith("graph."));
  const urls = [...read("js/money.js").matchAll(/url: "(https:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.equal(urls.length, 2, "money.js lists exactly two sources");
  assert.deepEqual([...fx].sort(), [...urls].sort(), "the CSP names the very URLs money.js fetches, with their paths");
  for (const u of fx) assert.ok(new URL(u).pathname.length > 1, `${u} is pinned to its path`);
  assert.ok(!csp["connect-src"].some((s) => s.includes("*")), "no wildcard");
});

test("manifest: no permission beyond cookies, storage, scripting; hosts are *.facebook.com only", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["cookies", "scripting", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://*.facebook.com/*"]);
});
