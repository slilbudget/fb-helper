// "Everything of every business of the profile": the one reader of a business edge that the Ad accounts tab (owned_ad_accounts +
// client_ad_accounts) and the Pages tab (owned_pages + client_pages) share. It reads me/businesses once, then one edge of each business,
// one after the other, and says how complete the answer is. What an edge row is and how it is read (fields, paging, skip set) stays with
// the caller (`readEdge`); this file owns the walk and its limits:
//   - at most MAX_BUSINESSES businesses (50; the read asks for 51 to see whether there are more), ids digits-only and each once (an id from Graph never goes into a path unchecked);
//   - every edge of every business is best effort: one that cannot be read is skipped, the rest stays, and the answer says `failed`;
//   - the walk ends as soon as nothing more could go out (dead session, API pause, hourly budget): the unread edges count as failed;
//   - a token change in between ends it (Stale), like an aborted request does, checked before every edge;
//   - owned edges are read before client edges, so a row that is both owned and shared keeps its owner (the caller keeps the first row of an id).
// The answer says how complete it is, per kind of gap:
//   `truncated`  there were more businesses than were read (me/businesses has a next page, or a cap was hit) or an edge hit its page limit:
//                the list is cut for everyone;
//   `listFailed` the business list itself could not be read: nothing was walked, so no business can be judged;
//   `failedBms`  the ids of the businesses with an edge that was not read (an error, or the walk ended before it): only THEIR accounts / pages
//                may be missing, so a caller withholds its verdict for these and for no other business;
//   `failed`     any of the above reads failed (what the Pages tab's one muted hint says).

import { digitsId, cleanText } from "./pure.js";
import { state, Stale, isDead } from "./state.js";
import { graph, pauseNote } from "./graph.js";

export const MAX_BUSINESSES = 50;

// me/businesses answer → { list: [{ id, name? }], more }: ids digits-only (anything else could not go into a URL), each once, at most
// MAX_BUSINESSES; more = there were further businesses that were not read.
export function businessList(rows, more = false) {
  const seen = new Set(), all = [];
  for (const b of Array.isArray(rows) ? rows : []) {
    const id = digitsId(b?.id);
    if (id && !seen.has(id)) { seen.add(id); const name = cleanText(b.name, 200); all.push(name ? { id, name } : { id }); }
  }
  return { list: all.slice(0, MAX_BUSINESSES), more: !!more || all.length > MAX_BUSINESSES };
}

// edges: ["owned_pages", "client_pages"]; readEdge(path, bm, edge) → { rows, truncated } (throws what graph() throws); gen = the generation
// the load started in.
// → { rows, truncated, failed, failedBms, listFailed } with every edge's rows in one list, owned edges first. Throws Stale (a token change),
// never anything else.
export async function readBusinessEdges({ gen, edges, readEdge }) {
  let bms;
  try {
    // One more than the cap: a 51st business is SEEN, so "more than we read" is known from this one answer (paging.next says it too).
    const r = await graph("me/businesses", { fields: "id,name", limit: String(MAX_BUSINESSES + 1) });
    bms = businessList(r.data, !!r.paging?.next);
  } catch (e) {
    if (e instanceof Stale) throw e;
    return { rows: [], truncated: false, failed: true, failedBms: [], listFailed: true };   // no list of businesses: nothing to walk, and the answer says it is not whole
  }
  const rows = [], unread = new Set();
  let truncated = bms.more, failed = false;
  // Everything from edge `e`, business `i` on was not read (the walk ended): those businesses have a gap.
  const markRest = (e, i) => { for (let k = e; k < edges.length; k++) for (let j = k === e ? i : 0; j < bms.list.length; j++) unread.add(bms.list[j].id); };
  walk: for (let e = 0; e < edges.length; e++) {
    for (let i = 0; i < bms.list.length; i++) {
      const bm = bms.list[i];
      if (gen !== state.gen) throw new Stale();
      if (isDead() || pauseNote()) { failed = true; markRest(e, i); break walk; }   // nothing more would go out: the rest is unread
      try {
        const r = await readEdge(`${bm.id}/${edges[e]}`, bm, edges[e]);
        rows.push(...r.rows);
        truncated ||= r.truncated;
      } catch (err) {
        if (err instanceof Stale) throw err;
        failed = true; unread.add(bm.id);
      }
    }
  }
  return { rows, truncated, failed, failedBms: bms.list.map((b) => b.id).filter((id) => unread.has(id)), listFailed: false };   // in the order of the business list
}
