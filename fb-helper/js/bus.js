// Tiny event bus. A low module (state.js, graph.js) announces what happened without importing the modules that react
// to it, so the dependency graph stays acyclic and a new tab can listen without anyone editing the emitter.
// Handlers run synchronously, in subscription order (= module evaluation order). A handler that throws is logged and
// does not stop the others, so one broken tab cannot freeze the token card.
//
// Events in use (payload in brackets):
//   "usage"          the API-usage figure or the throttle pause changed        -> header.js redraws the pill
//   "token-dead"     the list of dead tokens changed (markDead / another window) -> token.js redraws the token card
//   "generation"     the token changed, in-flight requests were cancelled       -> modules reset their per-token sets
//   "cache-dropped"  the cached lists belonged to another FB user and are gone  -> modules redraw their lists
//   "locks"          the rate-limit slots changed (this or another popup window) -> modules refresh disabled buttons
//   "session"        chrome.storage.session changed [changes object]            -> modules follow another popup window
//   "show-tab"       open another tab [tab name]                                 -> popup.js switches to it
//   "filter-bm"      show the ad accounts of one BM [{ id, name } or null]       -> accounts.js filters its list

const handlers = new Map();

// Returns an unsubscribe function.
export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(fn);
  return () => { const list = handlers.get(name); const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
}

export function emit(name, payload) {
  for (const fn of [...(handlers.get(name) || [])]) {
    try { fn(payload); } catch (e) { console.error(e); }
  }
}
