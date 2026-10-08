// What popup.js needs to know about the feature modules without importing them by name. A module registers itself
// when it is imported (tab, redraw callbacks, start-up hooks); popup.js only walks these lists. No DOM here: the
// registry is plain data and works in plain Node (test/modules.test.mjs).

const tabs = new Map(), renders = [], inits = [], starts = [];

// A tab. Its button (data-tab) and panel (#tab-<name>) are in popup.html; this adds what the code needs to know:
//   onShow  runs every time the tab is shown AFTER start-up, and once at start-up when the popup opens on it.
//           Guard it yourself when it must only act the first time (the Accounts auto-load does).
// Every registered name is a valid "last tab" to restore. (Every tab has the same height: css body min-height.)
export function registerTab(name, { onShow } = {}) {
  if (tabs.has(name)) throw new Error(`tab "${name}" is already registered`);
  tabs.set(name, { onShow });
}
export const tabInfo = (name) => tabs.get(name);
export const tabNames = () => [...tabs.keys()];

// Redraw-from-state callbacks. lang: after a RU/EN switch (strings are already applied to the static markup);
// tick: every 30 s while the popup is open (relative times, buttons whose lock ran out).
export const registerRender = (fn, { lang = true, tick = false } = {}) => { renders.push({ fn, lang, tick }); };

// Start-up hooks, in this order (popup.js):
//   init   language and saved state are loaded: attach your listeners, read your saved view (localStorage), no network.
//   start  the cache of another FB login has been dropped: first paint and the reads that need no click.
export const registerInit = (fn) => { inits.push(fn); };
export const registerStart = (fn) => { starts.push(fn); };

// One failing module must not stop the rest of the popup from starting.
const run = (fns) => { for (const fn of fns) { try { fn(); } catch (e) { console.error(e); } } };
export const runInit = () => run(inits);
export const runStart = () => run(starts);
export const runRenders = (when) => run(renders.filter((r) => r[when]).map((r) => r.fn));
