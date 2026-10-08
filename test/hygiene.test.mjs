// Dead weight in the extension, found by reading it: exports nobody imports, strings nobody shows, CSS classes nothing produces, files nothing loads,
// links nothing opens. Plain Node: `node --test test/*.test.mjs`. Each check fails with the list of what to delete (or, if it is meant to stay, what to
// put in the allow-list next to the check, with the reason).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(root, "fb-helper"), JS = path.join(EXT, "js");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (f) => path.relative(root, f);
const read = (f) => fs.readFileSync(f, "utf8");

// Source without its comments, strings kept (a name mentioned in a comment is not a use). Understands '…', "…", `…${…}…` and /…/ well enough for this code base.
function stripComments(src) {
  let out = "", i = 0;
  const n = src.length;
  const skipString = (q) => { const start = i; i++; while (i < n && src[i] !== q) { if (src[i] === "\\") i++; else if (q === "`" && src[i] === "$" && src[i + 1] === "{") { i += 2; let d = 1; while (i < n && d) { if (src[i] === "{") d++; else if (src[i] === "}") d--; else if (src[i] === "`" || src[i] === '"' || src[i] === "'") { skipString(src[i]); continue; } i++; } continue; } i++; } i++; return src.slice(start, i); };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") { out += skipString(c); continue; }
    if (c === "/" && /[(,=:\[!&|?{};]\s*$/.test(out.slice(-4))) {                  // a regex literal: copy it whole (it may hold quotes or //)
      let j = i + 1, cls = false;
      while (j < n && (src[j] !== "/" || cls) && src[j] !== "\n") { if (src[j] === "\\") j++; else if (src[j] === "[") cls = true; else if (src[j] === "]") cls = false; j++; }
      if (src[j] === "/") { out += src.slice(i, j + 1); i = j + 1; continue; }
    }
    out += c; i++;
  }
  return out;
}

const jsFiles = walk(JS).filter((f) => f.endsWith(".js"));
const code = Object.fromEntries(jsFiles.map((f) => [f, stripComments(read(f))]));
const html = read(path.join(EXT, "popup.html"));
const testFiles = walk(path.join(root, "test")).filter((f) => f.endsWith(".mjs"));
const testCode = Object.fromEntries(testFiles.map((f) => [f, stripComments(read(f))]));
const csses = walk(path.join(EXT, "css")).filter((f) => f.endsWith(".css"));
const resolveImport = (from, spec) => (spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null);

// ---------- who imports what ----------
// → Map: absolute file → { named: Set, side: boolean (imported for its effects), star: boolean }. `import { a as b }` counts `a`; `export { a } from` too (a re-export is a use).
function importsIn(f, src) {
  const found = [];
  for (const m of src.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) found.push([m[2], m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)]);
  for (const m of src.matchAll(/\bexport\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) found.push([m[2], m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)]);
  for (const m of src.matchAll(/\bimport\s+["']([^"']+)["']/g)) found.push([m[1], []]);
  for (const m of src.matchAll(/\bimport\s+\*\s+as\s+\w+\s+from\s+["']([^"']+)["']/g)) found.push([m[1], ["*"]]);
  // page-side, in the end-to-end flows: const { a, b } = await import(chrome.runtime.getURL("js/x.js")), and a static path of a test
  for (const m of src.matchAll(/\{([^}]*)\}\s*=\s*await\s+import\(\s*chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)\s*\)/g)) found.push([path.join(JS, "..", m[2]), m[1].split(",").map((x) => x.trim().split(/\s*:\s*/)[0]).filter(Boolean)]);
  return found.map(([spec, names]) => [path.isAbsolute(spec) ? spec : resolveImport(f, spec), names]).filter(([target]) => target);
}
const users = new Map();                                                                // file → name → Set of importers (production first)
const note = (target, name, by) => { const m = users.get(target) ?? users.set(target, new Map()).get(target); (m.get(name) ?? m.set(name, new Set()).get(name)).add(by); };
for (const [f, src] of [...Object.entries(code), ...Object.entries(testCode)]) for (const [target, names] of importsIn(f, src)) { note(target, "", f); for (const n of names) note(target, n, f); }
const isProd = (f) => f.startsWith(JS);

// ---------- exports ----------
const exportedNames = (src) => {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}(?!\s*from)/gm)) m[1].split(",").forEach((x) => { const n = x.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); });
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}\s*from/gm)) m[1].split(",").forEach((x) => { const n = x.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); });
  return [...names];
};
// Exported on purpose although no file imports it. Say why.
// Every strings file exports its STRINGS, the one name the same in all of them (the data a tool or a test may read without parsing the source).
const KEEP_EXPORTS = (file, name) => name === "STRINGS" && file.includes(`${path.sep}strings${path.sep}`);

test("every export of the extension is imported by something: another module, or a test (a test-only export is a seam, listed by name below)", () => {
  const dead = [], testOnly = [];
  for (const f of jsFiles) {
    for (const name of exportedNames(code[f])) {
      if (KEEP_EXPORTS(f, name)) continue;
      const by = [...(users.get(f)?.get(name) ?? [])];
      if (!by.length) dead.push(`${rel(f)}: ${name}`);
      else if (!by.some(isProd)) testOnly.push(`${rel(f)}: ${name}`);
    }
  }
  assert.deepEqual(dead, [], "exported, imported by nobody (not even a test): delete it, or stop exporting it");
  assert.ok(testOnly.length < 80, `${testOnly.length} exports are used only by tests (seams for the pure units): ${testOnly.length >= 80 ? "too many, is a module meant to be internal?" : ""}`);
});

// ---------- files ----------
test("every JS file of the extension is loaded by something: reachable from the module the popup page loads, through imports", () => {
  const entry = path.join(EXT, /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)[1]);
  assert.ok(fs.existsSync(entry), "the entry module exists");
  const seen = new Set([entry]), todo = [entry];
  while (todo.length) {
    const f = todo.pop();
    for (const [target] of importsIn(f, code[f] ?? "")) if (isProd(target) && !seen.has(target)) { seen.add(target); todo.push(target); }
  }
  const unreachable = jsFiles.filter((f) => !seen.has(f)).map(rel);
  assert.deepEqual(unreachable, [], "JS files nothing imports (and the popup page does not load)");
  assert.ok(!fs.existsSync(path.join(JS, "rows.js")), "the old row module stays deleted");
});

test("every stylesheet and picture of the package is referenced: by popup.html, a stylesheet, a script or the manifest", () => {
  const manifest = read(path.join(EXT, "manifest.json"));
  const haystack = [html, manifest, ...Object.values(code), ...csses.map(read)].join("\n");
  const assets = walk(EXT).filter((f) => /\.(css|svg|png|webp|woff2)$/.test(f) && !/LICENSE/.test(f));
  const unused = assets.filter((f) => !haystack.includes(path.basename(f))).map((f) => path.relative(EXT, f));
  assert.deepEqual(unused, [], "files in the package that nothing names");
});

// ---------- strings ----------
test("every UI string is shown by something: a literal t(\"key\"), a data-i18n attribute, or a family built with a prefix (`reason.${code}`) that has a key defined", () => {
  const defs = new Map();                                                              // key → file; the Russian half of each dictionary (English has the same keys: the coverage test)
  for (const f of jsFiles) {
    if (!/\/strings\/|\/i18n\.js$/.test(f)) continue;
    const src = code[f];
    const ru = src.slice(src.search(/\bru:\s*\{/), src.search(/\ben:\s*\{/));
    for (const m of ru.matchAll(/"([A-Za-z0-9_.]+)"\s*:/g)) defs.set(m[1], rel(f));
  }
  assert.ok(defs.size > 300, `found ${defs.size} strings`);
  const usage = Object.entries(code).map(([f, src]) => (/\/strings\/|\/i18n\.js$/.test(f) ? src.replace(/"[A-Za-z0-9_.]+"\s*:/g, "") : src)).join("\n") + "\n" + html;
  const prefixes = new Set([...usage.matchAll(/`([A-Za-z0-9_.]+\.)\$\{/g)].map((m) => m[1]));
  const unused = [];
  for (const [key, file] of defs) {
    if (new RegExp(`["'\`]${key.replace(/\./g, "\\.")}["'\`]`).test(usage)) continue;
    if (new RegExp(`data-i18n[a-z-]*="${key.replace(/\./g, "\\.")}"`).test(usage)) continue;
    if ([...prefixes].some((p) => key.startsWith(p) && key.length > p.length)) continue;
    unused.push(`${key}  (${file})`);
  }
  assert.deepEqual(unused, [], "strings nothing refers to (in both languages): delete them");
});

test("a family of strings is exactly the codes its table knows: bms.ver.<state> = VERIFY_KNOWN, ad.<STATUS> = AD_STATUS, pages.p.<problem> = PRIORITY, pages.chip.<chip> = CHIPS (a string no code can ask for is dead, a code without a string would print its key)", async () => {
  const { VERIFY_KNOWN } = await import("../fb-helper/js/bms-model.js"), { AD_STATUS } = await import("../fb-helper/js/accounts-model.js"), { PRIORITY, CHIPS } = await import("../fb-helper/js/pages-model.js");
  const keys = new Set();
  for (const f of jsFiles) if (/\/strings\/|\/i18n\.js$/.test(f)) { const src = code[f], ru = src.slice(src.search(/\bru:\s*\{/), src.search(/\ben:\s*\{/)); for (const m of ru.matchAll(/"([A-Za-z0-9_.]+)"\s*:/g)) keys.add(m[1]); }
  const family = (prefix) => [...keys].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).sort();
  assert.deepEqual(family("bms.ver."), [...VERIFY_KNOWN].sort());
  assert.deepEqual(family("ad."), Object.keys(AD_STATUS).sort());
  assert.deepEqual(family("pages.p."), [...PRIORITY].sort());
  assert.deepEqual(family("pages.chip."), Object.keys(CHIPS).sort());
});

// ---------- CSS ----------
test("every CSS class is produced by something: a class: attribute, classList / className, popup.html, a family built with a prefix (`i-${icon}`), or a state word that is added as a quoted token", () => {
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const defined = new Map();
  for (const f of csses) for (const m of strip(read(f)).matchAll(/\.([A-Za-z_][\w-]*)/g)) if (!/^(svg|woff2|webp|png)$/.test(m[1]) && !defined.has(m[1])) defined.set(m[1], path.basename(f));
  const all = Object.values(code).join("\n") + "\n" + html;
  const produced = new Set(), prefixes = new Set();
  const add = (s) => { for (const tok of s.split(/\s+/)) { if (!tok) continue; if (tok.includes("${")) { const pre = tok.split("${")[0]; if (pre.length > 1) prefixes.add(pre); const post = tok.split("}").pop(); if (post && !post.includes("${")) produced.add(post); } else produced.add(tok); } };
  for (const m of all.matchAll(/class\s*:\s*(`([^`]*)`|"([^"]*)"|'([^']*)')/g)) add(m[2] ?? m[3] ?? m[4]);
  for (const m of all.matchAll(/(?:classList\.(?:add|remove|toggle|replace|contains)|className\s*=)\s*\(?\s*(?:`([^`]*)`|"([^"]*)"|'([^']*)')(?:\s*,\s*(?:"([^"]*)"|'([^']*)'))?/g)) for (const g of m.slice(1)) if (g) add(g);
  for (const m of html.matchAll(/class="([^"]*)"/g)) add(m[1]);
  for (const m of all.matchAll(/["'`] ?([a-z][\w-]*(?: [a-z][\w-]*)*)["'`]/g)) add(m[1]);                       // a class named in any string: a state word, a tone, an argument of a helper
  for (const m of all.matchAll(/[ "'`]([a-z][\w-]*)\$\{/g)) prefixes.add(m[1]);
  for (const m of all.matchAll(/["'`]([a-z][\w-]*-)["'`]\s*\+/g)) prefixes.add(m[1]);
  for (const m of all.matchAll(/querySelector(?:All)?\(\s*["'`]([^"'`]*)["'`]/g)) for (const c of m[1].matchAll(/\.([A-Za-z_][\w-]*)/g)) produced.add(c[1]);
  const dead = [...defined].filter(([c]) => !produced.has(c) && ![...prefixes].some((p) => c.startsWith(p) && p.length > 1)).map(([c, f]) => `.${c} (${f})`);
  assert.deepEqual(dead, [], "classes the stylesheets define and nothing adds to an element");
});

// ---------- links ----------
test("every link of links.js is opened by something: LINKS.<name> in the extension (a link only a test mentions is not one)", () => {
  const src = read(path.join(JS, "links.js"));
  const bare = stripComments(src);
  const names = [...new Set([...bare.slice(bare.indexOf("export const LINKS"), bare.indexOf("};", bare.indexOf("export const LINKS"))).matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]))];
  assert.ok(names.length >= 10, `found ${names.length} links`);
  const used = Object.entries(code).filter(([f]) => !f.endsWith("links.js")).map(([, s]) => s).join("\n");
  const unused = names.filter((n) => !new RegExp(`LINKS\\.${n}\\b|LINKS\\["${n}"\\]|\\b${n}\\b\\s*\\}\\s*=\\s*LINKS`).test(used));
  assert.deepEqual(unused, [], "links nothing opens");
});
