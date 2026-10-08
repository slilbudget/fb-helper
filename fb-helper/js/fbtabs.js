// Which Facebook tabs the popup can read (the token, the User-Agent), best first, and how long it waits for them.

export const TAB_READ_MS = 2500;                    // a slow FB tab ahead of one that already gave a token is waited this long…
export const TAB_WAIT_MS = 12 * 1000;               // …and this long in all when none has a token yet (busy machine, heavy page)

export function isFacebookUrl(url) {
  try { const h = new URL(url).hostname; return h === "facebook.com" || h.endsWith(".facebook.com"); }
  catch { return false; }
}
// FB tabs to read, best first: the active tab (if it's FB), then Ads Manager tabs, then the most recent.
export async function facebookTabs() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isFb = (tab) => tab?.url && isFacebookUrl(tab.url) && !tab.discarded;
  const tabs = (await chrome.tabs.query({ url: ["https://*.facebook.com/*"] })).filter((tab) => isFb(tab) && tab.id !== active?.id);
  // Frozen tabs (Chrome's memory saver) run no scripts until activated: asked last, and only with a time limit.
  tabs.sort((a, b) => (!!a.frozen - !!b.frozen) || (/adsmanager/.test(b.url) - /adsmanager/.test(a.url)) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
  return isFb(active) ? [active, ...tabs] : tabs;
}
