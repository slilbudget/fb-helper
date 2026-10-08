// The pictures of businesses and pages, read APART from the lists. A list read asks for its picture field as one optional extra, and an
// optional field is the first thing given up when Graph refuses something (pages-model keysToDrop, bms-model bmKeysToDrop): a refused
// field, a permission it lacks, a nested `url` it dislikes, and every row comes back without a picture. So after a list is loaded the rows
// that have no picture URL are asked again here, in one light request per 50 of them that asks for nothing else:
//   GET /<version>/?ids=1,2,3&fields=picture{url}          pages
//   GET /<version>/?ids=1,2,3&fields=profile_picture_uri   businesses
// (graph.js lets the empty path through for exactly this: `ids` = 1-50 digit-only ids). The answer is { "<id>": { … } } and is kept in
// state.pics (id → picture URL, "" = asked and there is none), which is saved in storage.session next to the lists, so a reopened popup
// draws the pictures without asking again. The read is silent: whatever goes wrong (refused field, one unreadable id, throttle, dead session,
// budget, token change) leaves the icons as they were; nothing is shown, nothing is retried.
//
// Limits, so this can never be a loop: it runs once per list load (the tab's commit), never from a redraw or a tab switch; at most 50 ids per
// request and 4 requests (200 rows) per load; an id that a read is already under way for (another tab's) is not asked twice; it goes through
// graph() like every read: the dead-session / API-pause / hourly-budget checks, and the generation (a token change drops the answer).
//
// What the screen draws for a row is picturesOf(): the URL of the list read, the one found here, and for a PAGE the Graph picture redirect
// (links.js graphPicture) once the page has been through this read: it needs no read of ours at all and works for public pages. The
// Business node has no picture edge, so a business without a URL keeps its icon.

import { digitsId } from "./pure.js";
import { state, Stale, saveSession, registerCache, isDead } from "./state.js";
import { graph, pauseNote } from "./graph.js";
import { imageUrl, graphPicture } from "./links.js";
import { groupByBusiness } from "./spend.js";
import { sortPages } from "./pages-model.js";
import { on, emit } from "./bus.js";

export const IDS_PER_READ = 50, MAX_READS = 4;     // 200 rows at most per list load
const MAX_PICS = 1500;                             // a cache: past this the surplus is dropped
const FIELD = { page: "picture{url}", business: "profile_picture_uri" };

// id → picture URL ("" = asked, nothing found). Public data, but registered with the other caches: dropped with them, read back at start.
Object.assign(state, { pics: {} });
const cleanPics = (v) => Object.fromEntries(Object.entries(v && typeof v === "object" ? v : {}).filter(([id, u]) => digitsId(id) && (u === "" || imageUrl(u))));
registerCache(["pics"], () => { state.pics = {}; }, { load: (ses) => { state.pics = cleanPics(ses.pics); } });
// Another window read pictures: take them over.
on("session", (ch) => {
  if (!ch.pics) return;
  const next = cleanPics(ch.pics.newValue), keys = Object.keys(next);
  if (keys.length === Object.keys(state.pics).length && keys.every((k) => next[k] === state.pics[k])) return;   // our own write comes back as a change
  state.pics = next;
  emit("pictures");
});
const asking = new Set();                          // ids a read is under way for
on("generation", () => asking.clear());

// ---------- reading ----------
// A node of the answer → its picture URL as imageUrl() accepts it, else "". A page's is wrapped (picture.data.url).
const pictureIn = (kind, node) => imageUrl(kind === "page" ? node?.picture?.data?.url ?? node?.picture?.url : node?.profile_picture_uri) ?? "";

// kind "page" | "business"; ids = what to ask for, in the order the rows show; gen = the generation the list load started in. Resolves when the
// read is over (callers do not wait for it); never rejects, never says anything.
export async function readPictures(kind, ids, gen) {
  const want = [...new Set((ids || []).map(digitsId).filter((id) => id && !asking.has(id)))];
  if (!want.length) return;
  for (const id of want) asking.add(id);
  const found = {};
  try {
    for (let i = 0, reads = 0; i < want.length && reads < MAX_READS; i += IDS_PER_READ, reads++) {
      if (gen !== state.gen || isDead() || pauseNote()) break;               // nothing more may go out: the icons stay (a page may still use the redirect)
      const chunk = want.slice(i, i + IDS_PER_READ);
      try {
        const r = await graph("", { ids: chunk.join(","), fields: FIELD[kind] });
        for (const id of chunk) { const url = pictureIn(kind, r[id]); if (url) found[id] = url; }
      } catch (e) {
        if (e instanceof Stale) return;
        // anything else is silent: this chunk keeps its icons, the next one is still asked (one unreadable id spoils only its own request)
      }
    }
  } finally {
    for (const id of want) asking.delete(id);
  }
  if (gen !== state.gen) return;
  const next = { ...state.pics };
  for (const id of want) next[id] = found[id] || next[id] || "";            // a URL known from before is kept when this read found none
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PICS))) delete next[k];
  state.pics = next;
  saveSession({ pics: next });
  emit("pictures");
}

// ---------- which rows ----------
// Pages without a URL from the list read, in the order the Pages tab shows them. A page seen only through a business and not published is left
// out: Graph answers a batch with an error when it cannot read one of the ids, and a page nobody here may see would spoil the other 49.
export const picturelessPages = (pages) => sortPages(pages || []).filter((p) => !p.picture && !(p._viaBm && p.is_published === false)).map((p) => p.id);
// Businesses of the Businesses list without a logo URL from the list read.
export const picturelessBusinesses = (bms) => (bms || []).filter((b) => b && !b.profile_picture_uri).map((b) => b.id);
// The businesses of the Ad accounts groups whose logo is not known anywhere, without the Businesses list being read: only businesses of the profile
// (`mine` = the ids me/businesses listed during the accounts read: a client's business may not be readable, and one such id would spoil the batch),
// not on the Businesses list (that tab asks for its own), not asked before.
export function groupLogoIds(accounts, mine, bms = state.bms, pics = state.pics) {
  const listed = new Set((bms || []).map((b) => b?.id)), own = new Set(mine || []);
  return groupByBusiness(accounts).map((g) => g.id).filter((id) => id && own.has(id) && !listed.has(id) && pics[id] === undefined);
}

// ---------- drawing ----------
// The candidates for one avatar, best first (row.js avatarEl tries them in order and keeps the icon when none loads): the URL the list read gave
// (`own`), the one the picture read found, and for a page the Graph picture redirect, but only once the page has a URL to fall back from or has
// been through the picture read: a page that nobody has asked about yet must not send one image request per row to Graph at the first draw.
export function picturesOf(kind, id, own) {
  const got = state.pics[id];
  const list = [own, got];
  if (kind === "page" && (own || got !== undefined)) list.push(graphPicture(id, state.apiVersion));
  return list.filter(Boolean);
}
