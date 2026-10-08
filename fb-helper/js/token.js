// The Token tab: reading the token from the FB tabs, its card, the "Check" read, the owner check, and the
// "Token + cookies + UA" block.

import { t } from "./i18n.js";
import { ownerVerdict, profileBlock } from "./pure.js";
import { $, el, fill, pill, errText, numEl, toast, copy } from "./dom.js";
import { state, Stale, saveSession, checkOwner, newGeneration, isDead, deadCode, clearDead } from "./state.js";
import { graph } from "./graph.js";
import { facebookTabs, TAB_READ_MS, TAB_WAIT_MS } from "./fbtabs.js";
import { readCookies, readUa, cookieMap, cookieHeader, hasSession } from "./cookies.js";
import { on, emit } from "./bus.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";

// A token is "EAA" + 62+ alphanumerics. grabInPage (runs in the page) repeats this pattern; keep them equal.
// The page's answer is re-checked here: the MAIN world is the page's own JS and can return anything.
const TOKEN_RE = /^EAA[A-Za-z0-9]{62,}$/;
// First-party token prefixes: each is a different Meta app with its own fixed scope set.
// app = the Meta app behind the prefix; what it can do = t("kind.<prefix>") (live-checked 2026-09-27 on one profile).
// ads: does this token actually launch/edit ads (ads_management)? live-checked per prefix.
// false → show the "not an ads token · open Ads Manager" hint; true → hide it.
export const TOKEN_KIND = {
  EAAB: { app: "Ads Manager", tone: "ok", ads: true },
  EAAG: { app: "Business Manager", tone: "info", ads: true },
  EAAd: { app: "Events Manager", tone: "info", ads: false },
  EAAH: { app: "Commerce Manager", tone: "info", ads: false },
  EAAI: { app: "Automated Rules", tone: "info", ads: true },
};
// Every grabbed value already matched the token regex, so it IS a token — just from an app we didn't
// hardcode. "Check" reads the real app from Graph, so keep this calm, not "this is not a token".
const UNKNOWN_KIND = { tone: "info" };                  // app / use come from t("kind.unknown.*")
// Friendly names for the first-party apps behind the tokens (shown after "Check").
export const KNOWN_APPS = {
  "119211728144504": "Ads Manager", "436761779744620": "Business Manager",
  "515496645328243": "Commerce Manager", "2094176354154603": "Events Manager",
  "624541620938530": "Automated Rules",
};
const ADS_MANAGER_URL = "https://adsmanager.facebook.com/adsmanager/manage/campaigns";
// Which FB surface the tab is on, from host + path. App names as-is; the two translated ones are t() keys.
export function surfaceOf(host = "", path = "") {
  if (host.startsWith("adsmanager.")) return "Ads Manager";
  if (/account_billing|\/billing/.test(path)) return "surface.billing";
  if (host.startsWith("business.")) {
    if (path.startsWith("/commerce")) return "Commerce Manager";
    if (path.startsWith("/events_manager")) return "Events Manager";
    if (path.startsWith("/settings") || path.startsWith("/latest/settings")) return "surface.bm";
    if (path.includes("/adsmanager")) return "Ads Manager (Business Suite)";
    return "Business Suite";
  }
  return "Facebook";
}

// ---------- token ----------
function grabInPage() {
  // Runs in the page (MAIN world). Returns candidates only; nothing is sent anywhere.
  // It is serialized into the page, so it can't see TOKEN_RE: the patterns below repeat it.
  // loadId changes on every reload of the page: the Accounts tab refreshes by itself once per FB page load.
  const base = { host: location.hostname, path: location.pathname, loadId: Math.round(performance.timeOrigin) };
  // The page's own token for the surface you're on (Ads Manager → EAAB, Commerce → EAAH, …).
  // Preferred over anything scraped, so switching pages shows the CURRENT token — and no scan is needed.
  try {
    const w = window.__accessToken;
    if (typeof w === "string" && /^EAA[A-Za-z0-9]{62,}$/.test(w)) return { ...base, primary: w, tokens: [] };
  } catch { /* */ }
  // A token stands alone (quotes around it). Inline base64 images also contain "EAA…" runs,
  // e.g. the JPEG Huffman table "EAACAQMDAg…": they are glued to other base64 chars (+ / =).
  const re = /(?<![A-Za-z0-9+/])EAA[A-Za-z0-9]{62,}(?![A-Za-z0-9+/=])/g;
  const out = new Set();
  const scan = (text) => { re.lastIndex = 0; let m; while (out.size < 20 && (m = re.exec(text))) out.add(m[0]); };
  // Inline scripts first: that's where the page embeds its tokens, and it's far cheaper than serializing
  // the whole DOM (megabytes on Ads Manager). The full HTML only if the scripts had none.
  for (const sc of document.scripts) if (!sc.src) scan(sc.textContent);
  // The rendered DOM is the last resort. On feed / profile / group pages it is other people's text (a comment can
  // contain anything shaped like a token), so there it is read only on ads and billing pages.
  const ugcHost = /^(www|web|m|mbasic)\.facebook\.com$|^facebook\.com$/.test(location.hostname);
  const adsPath = /^\/(ads|adsmanager|billing[\w-]*)(\/|$)/.test(location.pathname);   // path PREFIX, not any "billing" inside a slug
  if (!out.size && (!ugcHost || adsPath)) scan(document.documentElement.innerHTML);
  return { ...base, primary: null, tokens: [...out] };
}
// Best token from one page's answer: the page's own token (matches its surface), then the EAAB heuristic,
// then anything. Every candidate is re-checked against TOKEN_RE — the MAIN world could return anything.
function pickToken(r) {
  const valid = (s) => typeof s === "string" && TOKEN_RE.test(s);
  if (valid(r?.primary)) return r.primary;
  const tokens = Array.isArray(r?.tokens) ? r.tokens.filter(valid) : [];
  return tokens.find((s) => s.startsWith("EAAB")) || tokens[0] || null;
}
// Reads a fresh token from the FB tabs. Returns it, or null after showing why — never the old cached one.
// The field only ever shows a token some open FB tab has right now: with no FB tab, or none with a token,
// the old one is dropped (it couldn't be copied anyway — copying always re-reads the tab).
// silent: on popup open — no clipboard, no toasts; the reason goes into the token field.
// A request started while a grab is still reading the tabs waits for it: it must go out with the token being read now.
let grabbing = Promise.resolve();
export const settledGrab = () => grabbing;
export function grabToken(opts) {
  const p = grabTokenNow(opts);
  grabbing = p.catch(() => null);
  return p;
}
async function grabTokenNow({ toClipboard = true, silent = false } = {}) {
  const op = ++state.grabOp;
  let gen = state.gen;
  const current = () => op === state.grabOp && gen === state.gen;
  const none = async (msg) => {
    if (state.token) {
      newGeneration();                                 // also cancels requests still running on the old token
      gen = state.gen;                                 // our own bump, not a token change from elsewhere
      Object.assign(state, { token: null, tokenSource: null });
      await chrome.storage.session.remove(["token", "tokenSource"]);
      if (!current()) return null;
    }
    if (await checkOwner() && current()) emit("cache-dropped");
    renderToken(msg);
    if (!silent) toast(msg, true);
    return null;
  };
  const tabs = await facebookTabs();
  if (!current()) return null;
  if (!tabs.length) return none(t("grab.noTab"));
  // Up to 5 tabs at once, so one frozen or busy tab can't stall the popup. Of the tabs that answered, the first in the
  // order above that has a token wins: the active FB tab may be a page without one (feed, still loading).
  const picked = tabs.slice(0, 5);
  const answers = picked.map(() => null);              // null = no answer (yet): no access, frozen, still busy
  const done = picked.map(() => false);
  let wake = null;
  picked.forEach((tab, i) => chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: grabInPage })
    .then((res) => { answers[i] = res?.[0]?.result ?? null; }, () => {})
    .finally(() => { done[i] = true; wake?.(); }));
  // Stop as soon as the answer can't change: every tab ahead of the first one with a token has answered. A slow tab
  // ahead of it is waited for TAB_READ_MS; with no token anywhere yet, up to TAB_WAIT_MS (a busy machine is not
  // "no access").
  const t0 = Date.now();
  for (;;) {
    const first = answers.findIndex((r) => r && pickToken(r));
    if (done.every(Boolean) || (first >= 0 && done.slice(0, first).every(Boolean))) break;
    const left = (first >= 0 ? TAB_READ_MS : TAB_WAIT_MS) - (Date.now() - t0);
    if (left <= 0) break;
    await new Promise((resolve) => { wake = resolve; setTimeout(resolve, left); });
  }
  wake = null;
  if (!current()) return null;                         // a newer grab happened meanwhile
  let pick = null, src = null, srcTab = null;
  const read = answers.filter(Boolean);
  for (const [i, r] of answers.entries()) {
    const p = r && pickToken(r);
    if (p) { pick = p; src = r; srcTab = picked[i]; break; }
  }
  if (!read.length) return none(t("grab.noAccess"));
  if (!pick) return none(t("grab.notFound", { where: read.length === 1 ? String(read[0].host || t("grab.thisTab")) : t("grab.openTabs") }));
  if (pick !== state.token) {
    newGeneration();
    gen = state.gen;                                   // our own bump, not a token change from elsewhere
    state.token = pick;
  }
  if (await checkOwner() && current()) emit("cache-dropped");
  if (!current()) return null;
  state.token = pick;
  // page = this tab + this load of it (see autoLoadAccounts).
  const loadId = Number.isFinite(src.loadId) ? src.loadId : null;
  state.tokenSource = { surface: surfaceOf(String(src.host || ""), String(src.path || "")), page: loadId ? `${srcTab.id}:${loadId}` : null };
  await saveSession({ token: pick, tokenSource: state.tokenSource });
  // A token change during the write above (this window or another) supersedes us; if it happened, don't report success.
  if (!current()) return null;
  renderToken();
  if (toClipboard) {
    const ok = await copy(pick, t("grab.copied"));
    // Only warn for a token we know can't launch ads (EAAH/EAAd); ads-capable and unknown stay quiet.
    if (ok && TOKEN_KIND[pick.slice(0, 4)]?.ads === false) toast(t("grab.notAds", { k: pick.slice(0, 4) }));
  }
  return pick;
}
export function renderToken(hint) {
  const tok = state.token;
  // Full token, one line; the field clips whatever runs past its right edge.
  $("#tokenBox").textContent = tok || hint || "—";
  $("#tokenBox").classList.toggle("filled", !!tok);
  $("#checkToken").disabled = !tok;
  // Card under the field: the current token's badge/app/use. For a token that can't launch ads we add
  // the "not an ads token · open Ads Manager" hint; ads-capable tokens (EAAB/EAAG/EAAI) don't get it.
  // With no token grabbed we still show a bare Ads Manager link — that's where the ads token lives.
  const card = $("#kindCard");
  const adsLink = (lead) => el("div", { class: "kind-ads" }, lead || null,
    el("a", { href: ADS_MANAGER_URL, target: "_blank", rel: "noopener noreferrer" }, t("kind.goAds"), el("i", { class: "i i-external" })));
  card.classList.remove("hidden");
  if (!tok) { card.className = "kind"; card.title = ""; return fill(card, adsLink()); }
  const kind = tok.slice(0, 4);
  const k = TOKEN_KIND[kind] || UNKNOWN_KIND;
  card.className = `kind ${k.tone}`;
  const surf = state.tokenSource?.surface;
  card.title = surf ? t("kind.from", { s: surf.startsWith("surface.") ? t(surf) : surf }) : "";
  fill(card,
    el("div", { class: "kind-head" }, el("span", { class: "kind-badge" }, kind), el("span", { class: "kind-app" }, k.app || t("kind.unknown.app"))),
    el("div", { class: "kind-use" }, k.app ? t(`kind.${kind}`) : t("kind.unknown.use")),
    isDead() ? el("div", { class: "err-text" }, t("kind.dead", { c: deadCode() })) : null,
    // ads-capable → nothing; known non-ads → "not an ads token" + link; unknown → bare link only.
    k.ads === true ? null : adsLink(k.ads === false ? t("kind.notAds") : null),
  );
}
async function checkToken() {
  const box = $("#tokenInfo");
  const btn = $("#checkToken");
  box.classList.remove("hidden");
  fill(box, el("dt", {}, t("check.checking")), el("dd", {}, "…"));
  btn.disabled = true;
  try {
    await settledGrab();
    const me = await graph("me", { fields: "id,name" });
    // Sequential on purpose: three small reads, never in parallel.
    // A failed step is shown as "couldn't check"; a Stale one aborts the chain before the next request.
    const soft = (p) => p.then((v) => ({ v }), (err) => { if (err instanceof Stale) throw err; return { err }; });
    const app = await soft(graph("app", { fields: "id,name" }));
    const perms = await soft(graph("me/permissions"));
    const need = ["ads_read", "ads_management", "business_management"];
    let permsDd, grantedCount = null;
    // A reply without a data array is "couldn't check", not "no permissions".
    if (!perms.err && !Array.isArray(perms.v?.data)) perms.err = new Error(t("check.badPerms"));
    // Events / Commerce Manager tokens can't read their own /me/permissions (#10). That's the token
    // type, not an error — say so plainly instead of a red failure.
    if (perms.err && perms.err.code === 10)
      permsDd = el("span", { class: "hint" }, t("check.noPerms"));
    else if (perms.err) permsDd = errText(t("check.failed", { m: perms.err.message }));
    else {
      // Every granted scope (the set is fixed by the Meta app the token came from), plus the
      // ads scopes that are missing in red. Green = granted.
      const granted = perms.v.data.filter((p) => p.status === "granted").map((p) => p.permission).sort();
      grantedCount = granted.length;
      const missing = need.filter((p) => !granted.includes(p));
      // Collapsed by default: the three ads scopes as pills, the full list (often 80+) behind a toggle.
      permsDd = el("div", { class: "perms" },
        el("div", { class: "chips" }, need.map((p) => pill(missing.includes(p) ? t("check.missing", { p }) : p, missing.includes(p) ? "bad" : "ok"))),
        granted.length ? el("details", { class: "more" },
          el("summary", {}, el("i", { class: "i i-chevron" }),
            el("span", { class: "when-closed" }, t("check.allPerms", { n: granted.length })), el("span", { class: "when-open" }, t("check.collapse"))),
          el("div", { class: "perm-list" }, granted.join(" · "))) : null);
    }
    fill(box,
      el("dt", {}, t("check.profile")), el("dd", {}, me.name ? `${me.name} · ` : "", numEl(me.id ?? "—")),
      el("dt", {}, t("check.app")), el("dd", {}, app.err ? errText(t("check.failed", { m: app.err.message }))
        : [`${app.v.name} · `, numEl(app.v.id), KNOWN_APPS[app.v.id] ? ` (${KNOWN_APPS[app.v.id]})` : ""]),
      el("dt", {}, grantedCount === null ? t("check.perms") : t("check.permsN", { n: grantedCount })), el("dd", {}, permsDd),
    );
  } catch (e) {
    if (e instanceof Stale) return;
    fill(box, el("dt", {}, t("check.error")), el("dd", {}, errText(e.message)));
  } finally { btn.disabled = !state.token; }
}

// ---------- token + cookies + UA block ----------
// Whose token is it — the logged-in user's (c_user)? One /me read, remembered per token + login.
// An open FB tab can keep a token from before the profile switched accounts; exporting it next to the new
// cookies would hand out a pair that never worked. Throws Stale / a dead-session error; any other failure
// (network, API pause) is "unknown" and does not block the export.
// The same read brings the profile name and its BMs for the block's last paragraph. A token without
// business_management (Events / Commerce Manager) is refused the BMs: then once more with id,name only.
const PERMISSION_CODES = (c) => c === 10 || c === 100 || (c >= 200 && c <= 299);
export async function ownerCheck(token) {
  const user = cookieMap().c_user?.value || null;
  if (state.checked?.token === token && state.checked.user === user) return state.checked;
  let meId = null, name = null, businesses = null, more = false, verdict = "unknown";
  try {
    let me, withBm = true;
    try { me = await graph("me", { fields: "id,name,businesses.limit(100){id,name}" }); }
    catch (e) {
      if (!PERMISSION_CODES(e.code)) throw e;
      withBm = false;
      me = await graph("me", { fields: "id,name" });
    }
    meId = me.id; name = me.name || null;
    // Graph leaves out an empty edge entirely: no "businesses" key on a read that asked for it = no BMs.
    if (withBm) { businesses = Array.isArray(me.businesses?.data) ? me.businesses.data : []; more = !!me.businesses?.paging?.next; }
    verdict = ownerVerdict(!!TOKEN_KIND[token.slice(0, 4)], meId, user);
  } catch (e) {
    if (e instanceof Stale || e.session) throw e;
  }
  const res = { token, user, verdict, meId, name, businesses, more };
  // Kept in storage.session, so reopening the popup doesn't cost another /me before the next export.
  if (verdict !== "unknown") { state.checked = res; saveSession({ checked: res }); }
  return res;
}
// The button greys out at once: the reads below take a moment (FB tabs, then /me the first time per token).
async function copyEnv() {
  const btn = $("#copyEnv");
  if (btn.disabled) return;
  btn.disabled = true; btn.setAttribute("aria-busy", "true");
  try { await copyEnvNow(); } finally { btn.disabled = false; btn.removeAttribute("aria-busy"); }
}
async function copyEnvNow() {
  // Always a fresh token + a cookie snapshot taken right after it; nothing from the old cache.
  // The UA is read from the FB tabs alongside the token, not after it.
  const uaRead = readUa().catch(() => null);
  const token = await grabToken({ toClipboard: false });
  if (!token) return;
  const gen = state.gen;
  // The block is what you hand to whoever connects with this token: without the UA it would be an incomplete set.
  const ua = await uaRead;
  if (gen !== state.gen || state.token !== token) return;
  if (!ua) return toast(state.uaHint || t("grab.noAccess"), true);
  await readCookies();
  if (gen !== state.gen || state.token !== token) return;
  if (!hasSession()) return toast(t("ck.noSession"), true);
  if (isDead()) return toast(t("err.session", { c: deadCode() }), true);   // even when the owner check is cached
  const cookies = cookieHeader();                       // frozen here: the owner check below reads the same snapshot's c_user
  let own;
  try { own = await ownerCheck(token); }
  catch (e) { if (!(e instanceof Stale)) toast(e.message, true); return; }
  if (gen !== state.gen || state.token !== token) return;
  if (own.verdict === "mismatch") return toast(t("env.mismatch", { a: own.meId, b: own.user }), true);
  // token, blank line, cookie header, blank line, User-Agent, then (when /me answered) profile + BMs in English.
  // The id is printed only when it is the logged-in user's: a custom app's /me id is app-scoped.
  const info = own.meId ? `\n\n${profileBlock({ name: own.name, id: own.verdict === "ok" ? own.meId : null, businesses: own.businesses, more: own.more })}` : "";
  copy(`${token}\n\n${cookies}\n\n${ua}${info}`, own.verdict === "ok" ? t("env.copied") : t("env.unverified"));
}

// The ⟳ next to the token: read it again from the open FB tabs (no clipboard, no request to Graph).
// It is also the deliberate way to try a token Graph called dead: the mark is cleared first, so the next
// request with it goes out once. The account cache stays; rate locks and the throttle pause are not touched.
async function refreshToken() {
  const btn = $("#refreshToken");
  btn.disabled = true; btn.setAttribute("aria-busy", "true");
  const was = state.token, wasDead = isDead();
  clearDead(was);
  state.checked = null;                                 // the owner is verified again on the next export
  chrome.storage.session.remove("checked");
  try {
    const got = await grabToken({ toClipboard: false });   // no token: grabToken toasts why
    if (got) toast(wasDead && got === was ? t("token.retry") : t("token.refreshed"));
  } finally { btn.disabled = false; btn.removeAttribute("aria-busy"); }
}

// ---------- wiring ----------
// The silent token read on open has finished (with a token, or with the reason there is none). Whatever would send
// a request on open waits for it (the Accounts auto-load), so it cannot go out with a stale token.
let tokenReadyDone;
export const tokenReady = new Promise((resolve) => { tokenReadyDone = resolve; });

// Graph called a token dead (here or in another window): redraw the card.
on("token-dead", () => renderToken());
// The token changed: the "Check" result belonged to the old one.
on("generation", () => $("#tokenInfo").classList.add("hidden"));
on("session", (ch) => {
  // Token dropped or replaced in another window of this extension: drop ours too.
  if (ch.token && (ch.token.newValue || null) !== state.token) {
    newGeneration(); state.grabOp++;
    state.token = ch.token.newValue || null;
    state.tokenSource = ch.tokenSource?.newValue || null;
    renderToken();
  }
});

registerTab("token");
// RU · EN: the token field is re-read from the FB tab (local), the "Check" result is hidden (its text came from Graph
// in the old language — press again).
registerRender(() => {
  $("#tokenInfo").classList.add("hidden");
  renderToken();
  grabToken({ toClipboard: false, silent: true });
});
registerInit(() => {
  $("#grabToken").addEventListener("click", () => grabToken());
  $("#checkToken").addEventListener("click", checkToken);
  $("#copyEnv").addEventListener("click", copyEnv);
  $("#refreshToken").addEventListener("click", refreshToken);
});
registerStart(() => {
  renderToken();
  // Show the token right away: read it from the open FB tab (local page read, no network request).
  grabToken({ toClipboard: false, silent: true }).catch(console.error).finally(tokenReadyDone);
});
