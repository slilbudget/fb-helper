// Every Facebook page the extension opens, in one place: when Meta moves a page, one line changes here.
// Pure (no DOM, no chrome.*): test/links.test.mjs runs it in Node.
//
// Ids come from Graph, so they are checked before they go into a URL: only digits pass (an ad account id without
// "act_"), anything else gives null and the caller shows no link. Every link opens in a new tab
// (target=_blank rel="noopener noreferrer"); none of them changes anything by being opened.
//
// VERIFIED marks a URL that was opened in a logged-in browser and landed on the right page. As of 2026-10-08 only the
// Ads Manager one is (it was already in use); the rest come from Meta help pages / third-party guides and are pending
// a live click-through (.notes/index.md, "In progress").

const digits = (id) => (/^\d{1,25}$/.test(String(id ?? "")) ? String(id) : null);
const actId = (id) => digits(String(id ?? "").replace(/^act_/, ""));
const make = (fn) => (...ids) => { const ok = ids.map(digits); return ok.every(Boolean) ? fn(...ok) : null; };
const makeAct = (fn) => (id) => { const a = actId(id); return a ? fn(a) : null; };

export const LINKS = {
  // ---- ad account ----
  adsManager: makeAct((a) => `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${a}`),   // VERIFIED
  billing: makeAct((a) => `https://adsmanager.facebook.com/ads/manager/account_settings/account_billing/?act=${a}`),
  accountSettings: makeAct((a) => `https://adsmanager.facebook.com/ads/manager/account_settings/information/?act=${a}`),
  // One ad in Ads Manager (the ads tab with that ad selected). UNVERIFIED like the rest. Both ids are digits-only; a bad or
  // missing ad id falls back to the account's own Ads Manager page (never to a half-built URL), a bad account id gives null.
  adsManagerAd: (acc, ad) => {
    const a = actId(acc), d = digits(ad);
    return a ? (d ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${a}&selected_ad_ids=${d}` : LINKS.adsManager(a)) : null;
  },
  // Account Quality: where Meta lists restrictions of the profile, its BMs, ad accounts and pages, with "Request review".
  accountQuality: () => "https://www.facebook.com/accountquality/",
  // ---- business manager ----
  bmSettings: make((b) => `https://business.facebook.com/settings/?business_id=${b}`),
  bmAdAccounts: make((b) => `https://business.facebook.com/settings/ad-accounts?business_id=${b}`),
  bmPages: make((b) => `https://business.facebook.com/settings/pages?business_id=${b}`),
  bmSecurity: make((b) => `https://business.facebook.com/settings/security?business_id=${b}`),   // business verification lives here
  bmQuality: make((b) => `https://business.facebook.com/business-support-home/?business_id=${b}`),
  // ---- page ----
  page: make((p) => `https://www.facebook.com/${p}`),
  pageSuite: make((p) => `https://business.facebook.com/latest/home?asset_id=${p}`),
  // ---- profile / help ----
  hacked: () => "https://www.facebook.com/hacked",
  support: () => "https://www.facebook.com/business/help/support",
};
