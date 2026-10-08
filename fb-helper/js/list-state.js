// What a list tab (Businesses, Ad accounts, Pages) shows when it has no rows: the same calm states, the same phrases, on every tab.
//   loading     one plain line "Loading…" (no placeholder shapes, no motion)
//   no token    the Token tab's own reason ("Open Facebook in this profile") + one button
//   dead        the session message + one button
//   permission  "This token can't read the list …" (Graph codes 10 / 283 / 200–299, pure.js isPermError) + one button
//   error       "Couldn't load" + Graph's words, muted + one button
//   not loaded  "Not loaded yet" + "Load" (an automatic load was paused or never started)
//   none        the tab's own "No ad accounts" + "Refresh"
// A muted Lucide icon above one line of text above ONE button; no red, no toast needed to understand it. The controls that only make sense
// with rows (the period, the total, "Active IDs") are hidden by the tab while this is on screen.
// DOM only. Styles: css/rows.css (.lempty, .lsk).

import { t } from "./i18n.js";
import "./strings/list.js";
import { el } from "./dom.js";
import { state, isDead, deadCode } from "./state.js";

// While a list is being read: one muted line (screen readers hear it through role=status).
function skeleton(label) {
  return el("div", { class: "lsk-list", role: "status", "aria-busy": "true" }, label);
}

const view = ({ icon, text, detail, action, onAction, kind }) => el("div", { class: "lempty", "data-state": kind },
  el("i", { class: `i i-${icon}`, "aria-hidden": "true" }),
  el("p", { class: "lempty-text" }, text),
  detail ? el("p", { class: "lempty-detail" }, detail) : null,
  action ? el("button", { type: "button", class: "btn", "data-focus": `lempty:${kind}`, onclick: onAction }, action) : null);

// tab = "accounts" | "bms" | "pages" (state.listErr key); loaded = the list has been read once (even if it was empty); loading = a read is under way;
// none = the tab's text for "nothing there"; loadingText = the screen-reader text of the skeleton; retry() = load again (list-loader.js retry:
// a token that is missing or dead is read again first).
export function emptyView({ tab, loaded, loading, none, loadingText, retry }) {
  if (loading) return skeleton(loadingText);
  const again = t("list.retry");
  if (!state.token) return view({ kind: "notoken", icon: "key-round", text: state.tokenHint || t("err.noToken"), action: again, onAction: retry });
  if (isDead()) return view({ kind: "dead", icon: "lock", text: t("err.session", { c: deadCode() }), action: again, onAction: retry });
  const e = state.listErr?.[tab];
  if (e?.perm) return view({ kind: "perm", icon: "lock", text: t("list.perm"), action: again, onAction: retry });
  if (e) return view({ kind: "error", icon: "cloud-off", text: t("list.error"), detail: e.msg, action: again, onAction: retry });
  if (!loaded) return view({ kind: "idle", icon: "inbox", text: t("list.idle"), action: t("list.load"), onAction: retry });
  return view({ kind: "none", icon: "inbox", text: none, action: t("refresh"), onAction: retry });
}

// Above rows that are already there: the last refresh was refused as a permission problem, so the rows are old (the toast would be gone by
// the time anybody looks). Other failures say themselves in a toast. null when there is nothing to say.
export const listNote = (tab, cls = "") => (state.listErr?.[tab]?.perm ? el("div", { class: `hint list-note ${cls}`.trim() }, t("list.perm")) : null);
