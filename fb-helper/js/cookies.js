// The Cookies tab: the FB session cookies and the profile's User-Agent, read live and never stored. No Graph request.

import { t, tn, locale } from "./i18n.js";
import { isUserAgent } from "./pure.js";
import { $, el, fill, pill, numEl, toast, copy } from "./dom.js";
import { getGraphUrl } from "./config.js";
import { state } from "./state.js";
import { facebookTabs, TAB_WAIT_MS } from "./fbtabs.js";
import { registerTab, registerRender, registerInit, registerStart } from "./registry.js";

Object.assign(state, { cookies: [], ua: null, uaHint: "" });
const SESSION_COOKIES = ["c_user", "xs", "datr", "fr", "sb"];   // must-haves, listed first

// ---------- cookies ----------
// Exactly the cookies Chrome would send to the Graph host (URL-matched by Chrome itself),
// one per name. The cookie box, the header string, the token + cookies + UA block and the JSON all use this set.
export async function readCookies() {
  const all = await chrome.cookies.getAll({ url: getGraphUrl() });
  const byName = {};
  for (const c of all) if (!byName[c.name] || c.domain === ".facebook.com") byName[c.name] = c;
  const rank = (n) => { const i = SESSION_COOKIES.indexOf(n); return i < 0 ? 99 : i; };
  state.cookies = Object.values(byName).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  renderCookies();
}
export const cookieMap = () => Object.fromEntries(state.cookies.map((c) => [c.name, c]));
export const hasSession = () => { const m = cookieMap(); return !!(m.c_user && m.xs); };
function renderCookies() {
  const byName = cookieMap();
  for (const id of ["#copyCookiesUa", "#copyCookieJson"]) if (!$(id).hasAttribute("aria-busy")) $(id).disabled = !state.cookies.length;
  // The whole cookie string, one colour like the token, in a short scrollable box;
  // the status line under it says whether the profile is logged in and how many cookies go out.
  const n = state.cookies.length;
  const box = $("#cookieBox");
  box.classList.toggle("filled", !!n);
  if (n) fill(box, el("div", { class: "ck-scroll" }, state.cookies.map((c) => `${c.name}=${c.value}`).join("; ")));
  else box.textContent = t("ck.none");
  const xs = byName.xs;
  const until = xs?.expirationDate ? new Date(xs.expirationDate * 1000).toLocaleDateString(locale()) : null;
  fill($("#cookieStatus"), hasSession()
    ? [pill(t("ck.loggedIn"), "ok"), el("span", {}, until ? t("ck.until") : t("ck.untilClose"),
        until ? numEl(until) : null, " · ", numEl(n), ` ${tn(n, "ck.count")}`)]
    : [pill(t("ck.loggedOut"), "bad")]);
}
export const cookieHeader = () => state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
function cookiesJson() {
  return JSON.stringify(state.cookies.map((c) => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
    sameSite: c.sameSite, hostOnly: c.hostOnly, session: c.session, storeId: c.storeId,
    ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
  })), null, 2);
}
async function copyCookieJson() {
  await readCookies();
  if (!hasSession()) return toast(t("ck.noSession"), true);
  copy(cookiesJson(), t("ck.jsonCopied"));
}
// ---------- user agent ----------
// The User-Agent of this browser profile, as the Facebook page itself sees it. Read from a live FB tab in the MAIN
// world, like the token: an antidetect profile spoofs it for pages, and the popup's own navigator may not be spoofed —
// a UA copied from there could differ from the one Facebook has been seeing. Without a readable FB tab there is no UA.
// Not shown in the popup: it is read only when a copy button needs it.
function uaInPage() { return navigator.userAgent; }
export async function readUa() {
  const tabs = (await facebookTabs()).slice(0, 5);
  if (!tabs.length) { Object.assign(state, { ua: null, uaHint: t("grab.noTab") }); return null; }
  const ask = async (tab) => {
    const u = (await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: uaInPage }))?.[0]?.result;
    if (isUserAgent(u)) return u;
    throw new Error("no UA");
  };
  // Every tab of the profile reports the same UA: the first valid answer wins, a frozen tab can't stall the rest.
  let timer;
  const ua = await Promise.race([Promise.any(tabs.map(ask)).catch(() => null), new Promise((r) => { timer = setTimeout(r, TAB_WAIT_MS, null); })]);
  clearTimeout(timer);
  Object.assign(state, { ua, uaHint: ua ? "" : t("grab.noAccess") });
  return ua;
}
// The Cookies tab's main button. Cookie string, blank line, User-Agent: both read live (the UA from the FB tab,
// alongside the cookies). No Graph request. Without a readable UA nothing is copied (an incomplete set).
async function copyCookiesUa() {
  const btn = $("#copyCookiesUa");
  if (btn.disabled) return;
  btn.disabled = true; btn.setAttribute("aria-busy", "true");
  try {
    const [ua] = await Promise.all([readUa().catch(() => null), readCookies()]);
    if (!hasSession()) return toast(t("ck.noSession"), true);
    if (!ua) return toast(state.uaHint || t("grab.noAccess"), true);
    copy(`${cookieHeader()}\n\n${ua}`, t("ckUa.copied"));
  } finally { btn.disabled = !state.cookies.length; btn.removeAttribute("aria-busy"); }
}

registerTab("cookies");
registerRender(renderCookies);
registerInit(() => {
  $("#copyCookiesUa").addEventListener("click", copyCookiesUa);
  $("#copyCookieJson").addEventListener("click", copyCookieJson);
});
registerStart(readCookies);
