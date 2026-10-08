// Every Facebook page the extension opens, in one place: when Meta moves a page, one line changes here. The same file
// decides which picture URLs from Graph may be shown (imageUrl, at the bottom).
// Pure (no DOM, no chrome.*): test/links.test.mjs runs it in Node.
//
import { digitsId } from "./pure.js";
import { getGraphUrl } from "./config.js";

// Ids come from Graph, so they are checked before they go into a URL: only digits pass (an ad account id without
// "act_"), anything else gives null and the caller shows no link. Every link opens in a new tab
// (target=_blank rel="noopener noreferrer"); none of them changes anything by being opened.
//
// VERIFIED marks a URL that was opened in a logged-in browser and landed on the right page. As of 2026-10-08 only the
// Ads Manager one is (it was already in use); the rest come from Meta help pages / third-party guides and are pending
// a live click-through (.notes/index.md, "In progress").

const digits = digitsId;
const actId = (id) => digits(String(id ?? "").replace(/^act_/, ""));
const make = (fn) => (...ids) => { const ok = ids.map(digits); return ok.every(Boolean) ? fn(...ok) : null; };
const makeAct = (fn) => (id) => { const a = actId(id); return a ? fn(a) : null; };

export const LINKS = {
  // ---- ad account ----
  adsManager: makeAct((a) => `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${a}`),   // VERIFIED
  billing: makeAct((a) => `https://adsmanager.facebook.com/ads/manager/account_settings/account_billing/?act=${a}`),
  // One ad in Ads Manager (the ads tab with that ad selected). UNVERIFIED like the rest. Both ids are digits-only; a bad or
  // missing ad id falls back to the account's own Ads Manager page (never to a half-built URL), a bad account id gives null.
  adsManagerAd: (acc, ad) => {
    const a = actId(acc), d = digits(ad);
    return a ? (d ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${a}&selected_ad_ids=${d}` : LINKS.adsManager(a)) : null;
  },
  // Account Quality: where Meta lists restrictions of the profile, its BMs, ad accounts and pages, with "Request review".
  accountQuality: () => "https://www.facebook.com/accountquality/",
  // The ads view of Ads Manager without an account in the URL (Ads Manager opens the last-used one). Where "Use Facebook Page" is
  // chosen: open any ad, Identity → Instagram account. UNVERIFIED like the rest.
  adsManagerHome: () => "https://adsmanager.facebook.com/adsmanager/manage/ads",
  // ---- business manager ----
  bmSettings: make((b) => `https://business.facebook.com/settings/?business_id=${b}`),
  bmAdAccounts: make((b) => `https://business.facebook.com/settings/ad-accounts?business_id=${b}`),
  bmPages: make((b) => `https://business.facebook.com/settings/pages?business_id=${b}`),
  bmSecurity: make((b) => `https://business.facebook.com/settings/security?business_id=${b}`),   // business verification lives here
  // ---- page ----
  page: make((p) => `https://www.facebook.com/${p}`),
  pageSuite: make((p) => `https://business.facebook.com/latest/home?asset_id=${p}`),
  // ---- profile / help ----
  hacked: () => "https://www.facebook.com/hacked",
  support: () => "https://www.facebook.com/business/help/support",
};

// ---------- pictures ----------
// A picture URL from Graph (a page's picture, a business's logo) goes into an <img>, so it is checked like an id is: https only,
// no credentials or port, and a host Meta serves its pictures from: fbcdn.net (profile and logo pictures, any subdomain: scontent-xxx.xx,
// static.xx, …) or fbsbx.com (platform-lookaside, the page picture's own host). Not facebook.com: that host serves pages and scripts, never a
// picture an <img> should fetch from an answer we did not write. These are the same two hosts as the manifest's img-src (the CSP is the second
// lock). Anything else gives null and the caller draws the placeholder. Returns the normalised URL.
// One more address is let through, and only in its exact shape: the Graph picture redirect <Graph origin>/vNN.N/<digits>/picture (the one
// the CSP names in img-src too), which answers with a redirect to the picture itself (graphPicture below builds it).
const IMAGE_HOSTS = ["fbcdn.net", "fbsbx.com"];
const GRAPH_PICTURE_PATH = /^\/v\d+\.\d+\/\d{1,25}\/picture$/, GRAPH_PICTURE_QUERY = /^(\?type=(small|normal|square|large))?$/;
const graphOrigin = () => { try { return new URL(getGraphUrl()).origin; } catch { return ""; } };
export function imageUrl(v) {
  if (typeof v !== "string" || v.length > 2000 || /[\u0000-\u0020\u007f]/.test(v)) return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (IMAGE_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return u.href;
  const g = graphOrigin();
  return g && u.origin === g && GRAPH_PICTURE_PATH.test(u.pathname) && GRAPH_PICTURE_QUERY.test(u.search) && !u.hash ? u.href : null;
}
// A public page's picture without any Graph read: <Graph origin>/<version>/<id>/picture?type=small answers with a redirect to the image (no
// token in it; the page has to be public). Pages only: the Business node has no picture edge (its docs list the `profile_picture_uri` field and
// no edge of that name, checked 2026-10-08). null for an id that is not digits or a version that is not "vNN.N".
export function graphPicture(id, version) {
  const i = digitsId(id), g = graphOrigin();
  return i && g && /^v\d+\.\d+$/.test(version) ? `${g}/${version}/${i}/picture?type=small` : null;
}
