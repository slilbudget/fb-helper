// The one loader of the list tabs (Ad accounts, Businesses, Pages). Every list tab has the same life: read when nothing is cached or the
// refresh button is pressed, one rate slot, a dead session or an API pause respected, one load at a time, a cache that belongs to the FB
// user and follows another popup window. It used to be written three times and the copies drifted; this is the single implementation, and
// a tab only says WHAT it reads (`read`), WHERE it puts it (`commit`) and what it draws while loading (`loading`).
//
// The order of a load, which is the point of having one:
//   1. wait for a token read that is under way, grab one if there is none (an automatic load stays silent about why it cannot);
//   2. refuse, before the rate slot is touched, when the session is dead or the API pause / hourly budget is on (graph.js pauseNote):
//      a refusal must not burn the slot, and nothing is written as "the list was tried" (accounts: autoPage);
//   3. claim the slot (claimSlot, Web Locks: popups in several windows share it) — the attempt counts even if it fails;
//   4. button disabled + aria-busy, the tab's loading state, `data-loading` on its panel (an idle marker for tests and scripts);
//   5. `read` (the requests; a token change makes it throw Stale), then the generation is checked;
//   6. the cache's owner is checked (checkOwner) BEFORE anything is written under the current FB user: a list of another login left in
//      another tab's cache is dropped, so no cache is ever stamped as belonging to a user it does not;
//   7. `commit` puts the result in state and storage and returns the toast text (null = say nothing);
//   8. whatever happened, the button and the loading state are put back (finally), and `sent` runs when a request really went out.
// An error shows as a toast unless the tab handles it (`fail`, e.g. "this token cannot read it" as a calm note in the list).
//
// A tab's cache is registered here (registerCache), and when another window of the extension loads or drops the list (its `atKey` changes
// in storage.session) this window takes the saved list over through the very same `load` the popup start-up uses.

import { t } from "./i18n.js";
import { toast } from "./dom.js";
import { state, Stale, fbUser, checkOwner, claimSlot, registerCache, isDead, deadCode } from "./state.js";
import { pauseNote, requestsSent } from "./graph.js";
import { settledGrab, grabToken, tokenReady } from "./token.js";
import { on, emit } from "./bus.js";

const TOKEN_WAIT_MS = 15 * 1000;                 // the silent token read of the popup start may take long on a busy machine; not forever

// cfg:
//   name        the rate slot key ("accounts", "bms", "pages"); the panel is #tab-<name> unless `panel` says otherwise
//   button      selector of the refresh button (disabled + aria-busy while a load runs)
//   slotMs      one attempt per this many ms (failed attempts count); waitKey = i18n key of "refresh available in {n} s"
//   keys, reset, load, has     the cache (state.js registerCache); load(ses, { live }) restores state from storage.session values, live = a
//                              change made by another window (not the popup start-up)
//   atKey, at   the storage key that changes when another window loads or drops the list, and this window's own value of it
//   followed    redraw after another window's list was taken over
//   loading     loading(on): set the tab's loading flag and redraw
//   empty       nothing to show yet: the "Loading…" placeholder is drawn at once on an automatic load
//   due         the automatic load is wanted (nothing cached; accounts: also an old list on a new FB page load)
//   read        async ({ gen, auto }) → result; throws what graph() throws (Stale for a token change)
//   commit      async (result, { gen, auto, owner }) → toast text | null
//   fail        optional, (error) → true when the tab shows the error itself
//   sent        optional, ({ gen }) a request went out (also when it failed)
export function listLoader(cfg) {
  const panel = cfg.panel || `#tab-${cfg.name}`;
  let busy = false, tried = false;

  registerCache(cfg.keys, cfg.reset, { load: cfg.load, has: cfg.has });

  // Another window loaded or dropped this list: show the same one.
  on("session", (ch) => {
    const c = ch[cfg.atKey];
    if (!c || (c.newValue || 0) === cfg.at()) return;                // our own write finds nothing new: state is set before the save
    chrome.storage.session.get([...cfg.keys, "owner"]).then((ses) => {
      cfg.load(ses, { live: true });
      state.owner = ses.owner || null;
      cfg.followed?.();
    });
  });

  const mark = () => {
    const p = document.querySelector(panel);
    if (p) { if (busy) p.dataset.loading = "true"; else delete p.dataset.loading; }
  };

  // → undefined, or { wait: seconds } when the rate slot was taken (the caller may say so in its own words).
  async function load({ auto = false } = {}) {
    if (busy) return undefined;                                      // one load at a time: a click during a load is a no-op
    busy = true; mark();
    try { return await run(auto); } finally { busy = false; mark(); }
  }
  async function run(auto) {
    const say = (msg) => { if (!auto) toast(msg, true); };           // an automatic load never complains: the empty list explains itself
    await settledGrab();
    if (!state.token && !(await grabToken({ toClipboard: false, silent: auto }))) return undefined;   // no token: grabToken says why
    if (isDead()) return say(t("err.session", { c: deadCode() }));
    const pause = pauseNote();
    if (pause) return say(pause);                                    // before the slot: costs nothing
    const gen = state.gen;                                           // fixed before waiting for the lock
    let wait;
    try { wait = await claimSlot(cfg.name, cfg.slotMs); }            // before sending: a failed attempt counts too
    catch (e) { return say(t("err.slot", { m: e.message })); }
    if (gen !== state.gen) return undefined;                         // new token while waiting
    if (wait > 0) {
      const n = Math.ceil(wait / 1000);
      say(t(cfg.waitKey, { n }));
      return { wait: n };
    }
    const btn = document.querySelector(cfg.button), before = requestsSent();
    try {
      if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
      cfg.loading(true);
      try {
        const result = await cfg.read({ gen, auto });
        if (gen !== state.gen) return undefined;
        if (await checkOwner()) emit("cache-dropped");               // another login's lists are gone before this one is stamped with the user
        const owner = await fbUser();
        if (gen !== state.gen) return undefined;
        const msg = await cfg.commit(result, { gen, auto, owner });
        if (msg) toast(msg);
      } catch (e) {
        if (e instanceof Stale) return undefined;
        if (!cfg.fail?.(e)) toast(e.message, true);
      } finally {
        if (requestsSent() > before) cfg.sent?.({ gen });
      }
    } finally {
      if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); }
      cfg.loading(false);
    }
    return undefined;
  }

  // The tab loads by itself when it is shown and cfg.due() says so. Reopening the popup or switching tabs alone never sends a request once
  // there is a list. At most one try per popup open, with a click's limits (slot, API pause, dead session); a try that found no token does
  // not count (an FB tab may be opened later), nor does one that was cut short by the loading placeholder.
  async function ensure() {
    if (tried) return;
    tried = true;
    const placeholder = cfg.empty();                                 // "Loading…" at once, not "press refresh" and then "Loading…"
    if (placeholder) cfg.loading(true);
    try {
      // Without the silent token read the request could go out with a stale token. Not forever, though.
      await new Promise((resolve) => { const timer = setTimeout(resolve, TOKEN_WAIT_MS); tokenReady.then(() => { clearTimeout(timer); resolve(); }); });
      if (!state.token) { tried = false; return; }
      if (isDead() || pauseNote() || !cfg.due()) return;
      await load({ auto: true });
    } finally {
      if (placeholder && !busy) cfg.loading(false);
    }
  }

  return { load, ensure, busy: () => busy };
}
