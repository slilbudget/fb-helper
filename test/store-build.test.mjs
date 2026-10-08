// The Chrome Web Store build (chrome-web-store/build.sh): the repo's extension is "FB Helper" with the original logo; the store package is "Ads Helper"
// with the neutral logo, and NOTHING else differs. Builds into a temporary folder (RELEASE_DIR), so a release already built is left alone.
// Needs bash, python3, perl, zip and unzip (every runner of the CI and a Mac has them). Plain Node: `node --test test/*.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "fb-helper"), ICONS = path.join(root, "chrome-web-store/icons");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ads-helper-build-"));
const out = path.join(tmp, "unpacked");
const NAME = "Ads Helper", SRC_NAME = "FB Helper";
const buildLog = execFileSync("bash", [path.join(root, "chrome-web-store/build.sh")], { env: { ...process.env, RELEASE_DIR: tmp }, encoding: "utf8" });   // throws (and the file fails) if the build fails, e.g. an old name left in the package

const read = (p) => fs.readFileSync(p);
const text = (p) => fs.readFileSync(p, "utf8");
const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])).sort();
const srcManifest = JSON.parse(text(path.join(SRC, "manifest.json"))), built = JSON.parse(text(path.join(out, "manifest.json")));
const zipPath = path.join(tmp, `ads-helper-${srcManifest.version}.zip`);
// The entry file is the one popup.html loads; build.sh renames line 1 of it. Found here the way the browser finds it.
const entry = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(text(path.join(SRC, "popup.html")))[1];
const PICTURES = ["icon_128.png", "icon_48.png", "toolbar_32.png", "toolbar_16.png", "logo.webp"];       // the neutral logo (build.sh copies them over the originals)
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("the build ran and made the package named after the manifest's version", () => {
  assert.match(buildLog, new RegExp(`built .*ads-helper-${srcManifest.version.replace(/\./g, "\\.")}\\.zip \\(\\d+ files\\)`));
  assert.ok(fs.statSync(zipPath).size > 10_000, "a real archive");
  assert.match(srcManifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(execFileSync("unzip", ["-tq", zipPath], { encoding: "utf8" }), /^No errors detected in compressed data of /, "the archive is intact");
});

test("manifest: the name and the toolbar tooltip are 'Ads Helper'; version, description, CSP, permissions, hosts, icons — every other key — are the source's", () => {
  assert.equal(srcManifest.name, SRC_NAME);
  assert.equal(built.name, NAME); assert.equal(built.action.default_title, NAME);
  const expected = structuredClone(srcManifest); expected.name = NAME; expected.action.default_title = NAME;
  assert.deepEqual(built, expected, "nothing but those two strings differs");
  for (const k of ["version", "content_security_policy", "permissions", "host_permissions", "icons", "description", "manifest_version"]) assert.deepEqual(built[k], srcManifest[k], k);
  assert.equal(built.version, srcManifest.version);
  assert.deepEqual([...built.permissions].sort(), ["cookies", "scripting", "storage"]);
});

test("the archive: manifest.json at its root, the same files as the unpacked folder, nothing that does not belong in a store package", () => {
  const listed = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).split("\n").filter((l) => l && !l.endsWith("/")).sort();
  assert.ok(listed.includes("manifest.json"), "manifest.json is in the root of the archive, not in a folder");
  assert.ok(!listed.some((f) => /^(fb-helper|chrome-web-store|release|unpacked)\//.test(f)), "no wrapping folder");
  assert.deepEqual(listed, walk(out), "the archive is the unpacked folder");
  for (const f of ["popup.html", "LICENSE", "manifest.json", entry, "css/popup.css", "fonts/golostext-latin.woff2", ...PICTURES.map((p) => `images/${p}`)]) assert.ok(listed.includes(f), f);
  const junk = listed.filter((f) => /(^|\/)(\.DS_Store|__MACOSX|node_modules|\.git|test|docs)(\/|$)|\.(zip|map|mjs|md|log|bak|orig|swp)$|~$/i.test(f));
  assert.deepEqual(junk, [], "no stray files (an older release zip once lay inside fb-helper/)");
  assert.deepEqual([...new Set(listed.map((f) => f.split("/")[0]))].sort(), ["LICENSE", "css", "fonts", "images", "js", "manifest.json", "popup.html"], "exactly what build.sh copies");
});

test("'FB Helper' is nowhere in the package: not in a text file, not in the title, the header, the first line of the entry file (build.sh stops on it, this checks it again)", () => {
  const files = walk(out);
  const hits = files.filter((f) => !/\.(png|webp|woff2)$/i.test(f) && /fb helper/i.test(text(path.join(out, f))));
  assert.deepEqual(hits, [], "the old name left in the package");
  const html = text(path.join(out, "popup.html"));
  assert.match(html, /<title>Ads Helper<\/title>/);
  assert.match(html, /<h1 class="brand">[^]*?>Ads Helper<\/h1>/, "the one h1 carries the store name");
  assert.ok(text(path.join(out, entry)).startsWith(`// ${NAME}`), "the entry file's first line names the store build");
  assert.ok(text(path.join(SRC, entry)).startsWith(`// ${SRC_NAME}`), "…and in the repo it says FB Helper: build.sh renames that line, so it must stay the first line");
});

test("only the name and the logo differ from the source: every file is byte for byte the source's, except manifest.json, popup.html, line 1 of the entry file and the five pictures", () => {
  const srcFiles = walk(SRC);
  const missing = srcFiles.filter((f) => !fs.existsSync(path.join(out, f)));
  assert.deepEqual(missing, [], "every file of the extension is in the package");
  const extra = walk(out).filter((f) => !srcFiles.includes(f));
  assert.deepEqual(extra, ["LICENSE"], "the package has the licence and nothing else of its own");
  const differing = srcFiles.filter((f) => !read(path.join(SRC, f)).equals(read(path.join(out, f)))).sort();
  assert.deepEqual(differing, [entry, "manifest.json", "popup.html", ...PICTURES.map((p) => `images/${p}`)].sort());
  // …and what differs differs only in the name
  const html = (p) => text(p);
  assert.equal(html(path.join(out, "popup.html")), html(path.join(SRC, "popup.html")).replace(`<title>${SRC_NAME}</title>`, `<title>${NAME}</title>`).replace(`>${SRC_NAME}</h1>`, `>${NAME}</h1>`));
  const [first, ...rest] = text(path.join(SRC, entry)).split("\n"), [builtFirst, ...builtRest] = text(path.join(out, entry)).split("\n");
  assert.deepEqual(builtRest, rest, "the entry file is the source from line 2 on");
  assert.equal(builtFirst, first.replace(`// ${SRC_NAME}`, `// ${NAME}`));
  assert.equal(text(path.join(out, "LICENSE")), text(path.join(root, "LICENSE")));
});

test("the logo is the neutral one: the five pictures are the store's icons, not the Facebook-style originals", () => {
  for (const p of PICTURES) {
    assert.ok(read(path.join(out, "images", p)).equals(read(path.join(ICONS, p))), `${p} is chrome-web-store/icons/${p}`);
    assert.ok(!read(path.join(out, "images", p)).equals(read(path.join(SRC, "images", p))), `${p} is not the original`);
  }
});
