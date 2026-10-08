// Pictures (js/pictures.js): the pictures of Pages and businesses do not depend on the list read. A list that came back without them (Graph refused
// every optional field, or simply left them out) gets ONE light read afterwards, GET /<version>/?ids=…&fields=picture{url} (pages) or
// fields=profile_picture_uri (businesses), 50 ids per request; the answer is kept in the session cache so a reopened popup draws it without
// asking; a Page that still has no URL is drawn through the Graph picture redirect (<Graph>/<version>/<id>/picture?type=small, which the CSP
// img-src allows); a failure is silent and the icons stay. The batch reads and the redirect are NOT in b.hits (harness: b.picHits, b.pictureHits).
// Graph is a mock (fictional data); the pictures come from the harness's fbcdn.net mock.
import { GRAPH, TOK, ok, boot, adsPage, popup, until, rowsAre, resetLocks, adsFb, stored, done, waitFor, settle, toastOf } from "../harness.mjs";

const CDN = (name) => `https://scontent.xx.fbcdn.net/v/t39.30808-1/${name}.jpg`;
const pathOf = (u) => u.pathname.replace(/^\/v[\d.]+\//, "/");
const topFields = (fields) => { const out = []; let depth = 0, cur = ""; for (const ch of fields) { if (ch === "{") depth++; if (ch === "}") depth--; if (ch === "," && !depth) { out.push(cur); cur = ""; } else cur += ch; } return [...out, cur].map((f) => f.replace(/\{.*$/, "")); };
const idsOf = (query) => new URLSearchParams(query).get("ids").split(",");
const fieldsOfQuery = (query) => new URLSearchParams(query).get("fields");
const permission = { status: 400, body: { error: { code: 200, message: "(#200) Requires pages_read_engagement permission" } } };

// ---------- pages ----------
const P1 = "100000000000011", P2 = "100000000000012", P3 = "100000000000013", P4 = "100000000000014";
const PAGES = [{ id: P1, name: "Alpha Page" }, { id: P2, name: "Beta Page" }, { id: P3, name: "Gamma Page" }];
// me/accounts as Graph would answer it: only the fields that were asked for; refuseAll = every extra field is refused with a permission error (so the
// tab gives them up tier by tier and ends with id,name only); listPics = the pages (by id) whose picture the list read itself brings when it is asked for.
const pagesGraph = ({ rows = PAGES, refuseAll = false, listPics = {} } = {}) => (u) => {
  const fields = u.searchParams.get("fields") || "";
  if (pathOf(u) === "/me/accounts") {
    if (refuseAll && fields !== "id,name") return permission;
    const top = topFields(fields);
    return { body: { data: rows.map((r) => ({ id: r.id, name: r.name, ...(top.includes("picture") && listPics[r.id] ? { picture: { data: { url: listPics[r.id] } } } : {}) })) } };
  }
  return { body: { data: [] } };
};
// The pictures read: what Graph answers for the ids it is asked about. known = { id: url }; the others are left out of the answer.
const picsKnown = (known, kind = "page") => (u) => ({ body: Object.fromEntries(idsOf(u.search).filter((id) => known[id]).map((id) => [id, kind === "page" ? { id, picture: { data: { url: known[id], height: 50, width: 50, is_silhouette: false } } } : { id, profile_picture_uri: known[id] }])) });
const redirectTo = (u) => ({ redirect: CDN(`redir_${/\/(\d+)\/picture$/.exec(u.pathname)[1]}`) });
// The avatar of a row (selector of the row): did it load, which src, the icon behind it.
const avOf = (p, rowSel) => p.evaluate((s) => {
  const box = document.querySelector(`${s} .lav`), img = box?.querySelector("img"), icon = box?.querySelector(".i");
  return box && { ok: box.classList.contains("ok"), src: img?.getAttribute("src") ?? null, natural: img?.naturalWidth ?? 0, loading: img?.getAttribute("loading") ?? null, icon: icon ? getComputedStyle(icon).visibility : null };
}, rowSel);
// The session cache of the pictures is exactly this (key order aside).
const picsAre = async (p, expected) => JSON.stringify(Object.entries((await stored(p, "pics")) || {}).sort()) === JSON.stringify(Object.entries(expected).sort());
const pageRow = (id) => `#pagesList .lrow[data-row="${id}"]`;
const loaded = (p, sel) => until(p, (s) => !!document.querySelector(`${s} .lav.ok`), sel);

// The list read gets NOTHING for the pictures (every extra field is refused); the pictures read finds two of the three, the third gets the redirect.
async function picPagesFlow() {
  console.log("\n# pictures: pages, Graph refuses every optional field → the batch read fills them in; the redirect for the one without; the cache");
  const known = { [P1]: CDN("pic_1"), [P2]: CDN("pic_2") };
  const b = await boot({ fb: adsFb(TOK), graph: pagesGraph({ refuseAll: true }), pics: (u, n) => ({ ...picsKnown(known)(u), delay: n === 1 ? 1500 : 0 }), picture: redirectTo });
  await adsPage(b);
  const pop = await popup(b, "pages");
  ok("the list loaded without a single picture field (4 asks, the last one id,name only)", await rowsAre(pop, "#pagesList .lrow", 3) && b.hits.filter((h) => h.startsWith("/me/accounts")).length === 4
    && !b.hits.filter((h) => h.startsWith("/me/accounts")).at(-1).includes("picture"), b.hits.join(" | "));
  ok("rows are drawn at once with their icons; while the pictures read is on its way no image request goes to the Graph picture redirect (one per row would otherwise go out at the first draw)",
    await waitFor(() => b.picHits.length === 1) && b.pictureHits.length === 0 && (await avOf(pop, pageRow(P1))).src === null && (await avOf(pop, pageRow(P1))).icon === "visible", `${b.picHits} / ${b.pictureHits}`);
  ok("…the pictures read is ONE request with the ids of all three pages and fields=picture{url} (the root of the API version, nothing else asked)",
    b.picHits.length === 1 && idsOf(b.picHits[0]).sort().join() === [P1, P2, P3].join() && fieldsOfQuery(b.picHits[0]) === "picture{url}" && !b.hits.some((h) => h.includes("ids=")), b.picHits.join(" | "));
  ok("…then the two pages it found show their pictures (a 24 px circle, loaded, the icon hidden behind)", await loaded(pop, pageRow(P1)) && await loaded(pop, pageRow(P2)));
  const [a1, a2] = [await avOf(pop, pageRow(P1)), await avOf(pop, pageRow(P2))];
  ok("…each its own URL, not lazy", a1.src === known[P1] && a2.src === known[P2] && a1.natural > 0 && a2.natural > 0 && a1.loading === null && a1.icon === "hidden", JSON.stringify([a1, a2]));
  ok("the page the read found nothing for is drawn through the Graph picture redirect: <Graph>/<version>/<id>/picture?type=small, which redirects to the picture (the CSP lets the image and its redirect through)",
    await loaded(pop, pageRow(P3)) && (await avOf(pop, pageRow(P3))).src === `${GRAPH}/v26.0/${P3}/picture?type=small` && (await avOf(pop, pageRow(P3))).natural > 0
    && b.pictureHits.join() === `/${P3}/picture?type=small` && b.images.some((x) => x.includes(`redir_${P3}`)), `${JSON.stringify(await avOf(pop, pageRow(P3)))} ${b.pictureHits} ${b.images}`);
  ok("…the pictures are in the session cache: the URLs found, and \"\" for the page with none", await picsAre(pop, { [P1]: known[P1], [P2]: known[P2], [P3]: "" }), JSON.stringify(await stored(pop, "pics")));
  ok("no toast, no console error (done() below checks the CSP too)", (await toastOf(pop)) === "");

  // reopen: the cache is drawn, nothing is asked
  const hits = b.hits.length;
  await pop.close();
  const pop2 = await popup(b, "pages");
  ok("a reopened popup draws the same pictures from the cache and sends no list read and no pictures read", await rowsAre(pop2, "#pagesList .lrow", 3) && await loaded(pop2, pageRow(P1)) && await loaded(pop2, pageRow(P2)) && await loaded(pop2, pageRow(P3))
    && b.hits.length === hits && b.picHits.length === 1, `${b.hits.length - hits} ${b.picHits.length}`);

  // a refresh asks again (the list still brings no pictures); the answer replaces what was there
  await resetLocks(pop2);
  known[P1] = CDN("pic_1_new");
  await pop2.click("#loadPages");
  ok("a refresh whose list read brings no pictures again asks once more for all three (one request), and a new URL replaces the old one",
    await waitFor(() => b.picHits.length === 2) && await until(pop2, (u) => document.querySelector(`#pagesList .lrow[data-row="${u[0]}"] .lav img`)?.getAttribute("src") === u[1], [P1, known[P1]]), `${b.picHits.length}`);
  await done(b);
}

// The list read brings some pictures itself: only the rest is asked; all of them present: no pictures read at all.
async function picPagesListFlow() {
  console.log("\n# pictures: what the list read brings is not asked again; nothing missing = no extra request; an unpublished page found through a business is not named");
  const own = { [P1]: CDN("own_1"), [P2]: CDN("own_2") };
  const b = await boot({ fb: adsFb(TOK), graph: pagesGraph({ listPics: own }), pics: picsKnown({ [P3]: CDN("pic_3") }) });
  await adsPage(b);
  const pop = await popup(b, "pages");
  ok("two pages have a picture from the list read, the third is asked for alone (one request, its id only)", await rowsAre(pop, "#pagesList .lrow", 3) && await waitFor(() => b.picHits.length === 1) && idsOf(b.picHits[0]).join() === P3, b.picHits.join(" | "));
  ok("…all three show their pictures", await loaded(pop, pageRow(P1)) && await loaded(pop, pageRow(P2)) && await loaded(pop, pageRow(P3)) && (await avOf(pop, pageRow(P1))).src === own[P1] && (await avOf(pop, pageRow(P3))).src === CDN("pic_3"));
  ok("the page whose picture was asked for and found has no redirect request", b.pictureHits.length === 0, b.pictureHits.join());
  await done(b);

  const b2 = await boot({ fb: adsFb(TOK), graph: pagesGraph({ listPics: { [P1]: CDN("own_1"), [P2]: CDN("own_2"), [P3]: CDN("own_3") } }), pics: () => { throw new Error("no pictures read expected"); } });
  await adsPage(b2);
  const pop2 = await popup(b2, "pages");
  ok("every row has its picture from the list read: no pictures read, no redirect", await rowsAre(pop2, "#pagesList .lrow", 3) && await loaded(pop2, pageRow(P3)) && (await settle(pop2)) && b2.picHits.length === 0 && b2.pictureHits.length === 0, `${b2.picHits} ${b2.pictureHits}`);
  await done(b2);

  // a page seen only through a business that is unpublished is not named in the batch (Graph answers a batch with one error when it cannot read an id)
  const BM = "555";
  const g = (u) => {
    if (pathOf(u) === "/me/accounts") return { body: { data: [{ id: P1, name: "Alpha Page" }] } };
    if (pathOf(u) === "/me/businesses") return { body: { data: [{ id: BM, name: "Nova Media" }] } };
    if (pathOf(u) === `/${BM}/owned_pages`) return { body: { data: [{ id: P3, name: "Gamma Page", is_published: true }, { id: P4, name: "Draft Page", is_published: false }] } };
    return { body: { data: [] } };
  };
  const b3 = await boot({ fb: adsFb(TOK), graph: g, pics: picsKnown({}) });
  await adsPage(b3);
  const pop3 = await popup(b3, "pages");
  ok("an unpublished page found only through a business is left out of the pictures read; the others are named", await rowsAre(pop3, "#pagesList .lrow", 3) && await waitFor(() => b3.picHits.length === 1) && idsOf(b3.picHits[0]).sort().join() === [P1, P3].join(), b3.picHits.join(" | "));
  await done(b3);
}

// ---------- businesses ----------
const BMS = [{ id: "1001", name: "Alpha Media" }, { id: "1002", name: "Beta Ads" }, { id: "1005", name: "Epsilon Digital" }];
const acc = (account_id, name, biz) => ({ account_id, name, account_status: 1, currency: "USD", timezone_name: "UTC", amount_spent: "500", ...(biz ? { business: { id: biz[0], name: biz[1] } } : {}) });
const ACCOUNTS = [acc("11", "A one", ["1001", "Alpha Media"]), acc("21", "B one", ["1002", "Beta Ads"]), acc("91", "P one", ["9999", "Partner Agency"]), acc("99", "Solo")];
const fieldError = (name) => ({ status: 400, body: { error: { code: 100, message: `(#100) Tried accessing nonexisting field (${name}) on node type (Business)` } } });
// me/businesses; logoRefused = Graph refuses profile_picture_uri; the accounts walk (id,name, limit 51) always works.
const bmsGraph = ({ logoRefused = false, accDelay = 0 } = {}) => (u) => {
  const p = pathOf(u), fields = u.searchParams.get("fields") || "";
  if (p === "/me/businesses") return logoRefused && fields.includes("profile_picture_uri") ? fieldError("profile_picture_uri") : { body: { data: BMS.map((x) => ({ ...x })) } };
  if (p === "/me/adaccounts") return { delay: accDelay, body: { data: ACCOUNTS } };
  return { body: { data: [] } };
};
const bmRow = (id) => `#bmsList .lrow[data-row="bm-${id}"]`;
const headerAv = (p, name) => p.evaluate((n) => {
  const g = [...document.querySelectorAll("#accountsList .lgroup")].find((x) => x.querySelector(".lgroup-text").textContent === n), box = g?.querySelector(".lav"), img = box?.querySelector("img");
  return g && { w: box?.offsetWidth ?? 0, ok: !!box?.classList.contains("ok"), src: img?.getAttribute("src") ?? null, natural: img?.naturalWidth ?? 0 };
}, name);

// Businesses tab: the logo field is refused by the list read; the pictures read brings the logos, also into the Ad accounts group headers.
async function picBusinessesFlow() {
  console.log("\n# pictures: businesses, Graph refuses profile_picture_uri → the batch read fills the logos (Businesses rows and Ad accounts group headers)");
  const known = { 1001: CDN("logo_1001"), 1002: CDN("logo_1002") };
  const b = await boot({ fb: adsFb(TOK), graph: bmsGraph({ logoRefused: true, accDelay: 900 }), pics: picsKnown(known, "business") });
  await adsPage(b);
  const pop = await popup(b, "bms");
  ok("the Businesses list loaded without the logo field (it was refused, then dropped)", await rowsAre(pop, "#bmsList .lrow", 4) && b.hits.filter((h) => h.startsWith("/me/businesses") && h.includes("limit=50")).length === 2, b.hits.join(" | "));
  ok("…the pictures read asks for the logos of the three listed businesses in one request: ids + fields=profile_picture_uri, nothing else",
    await waitFor(() => b.picHits.length >= 1) && idsOf(b.picHits[0]).join() === "1001,1002,1005" && fieldsOfQuery(b.picHits[0]) === "profile_picture_uri" && !b.hits.some((h) => h.includes("ids=")), b.picHits.join(" | "));
  ok("…the businesses it found show their logo (24 px rounded square), the one without keeps the building icon", await loaded(pop, bmRow("1001")) && await loaded(pop, bmRow("1002")), `${b.picHits}`);
  const [l1, l5] = [await avOf(pop, bmRow("1001")), await avOf(pop, bmRow("1005"))];
  ok("…each its own URL; Epsilon: no <img>, the icon visible", l1.src === known[1001] && l1.natural > 0 && l5.src === null && l5.icon === "visible", JSON.stringify([l1, l5]));
  ok("a business has no picture redirect (the Business node has no picture edge): no request to it", b.pictureHits.length === 0);
  // the Ad accounts tab: the group headers of the same businesses carry the logos (16 px), the client's business does not
  await pop.click('[data-tab="accounts"]');
  ok("Ad accounts group headers: Alpha and Beta show their logo, the client's Partner Agency the icon", await rowsAre(pop, "#accountsList .lrow", 4) && await until(pop, () => !!document.querySelector("#accountsList .lgroup .lav.ok")) && (await headerAv(pop, "Alpha Media")).src === known[1001]
    && (await headerAv(pop, "Beta Ads")).src === known[1002] && (await headerAv(pop, "Partner Agency")).src === null && (await headerAv(pop, "Alpha Media")).w === 16, JSON.stringify([await headerAv(pop, "Alpha Media"), await headerAv(pop, "Partner Agency")]));
  ok("…and the id of that client's business was never named in a pictures read (a business the profile cannot read would spoil the batch)", b.picHits.every((q) => !idsOf(q).includes("9999")), b.picHits.join(" | "));
  ok("…every business was asked about once or twice at most, never in a loop", b.picHits.length <= 2 && (await settle(pop)) && b.picHits.length <= 2, `${b.picHits.length}`);
  await done(b);
}

// The Ad accounts tab alone (the Businesses list is never loaded): the headers' logos come from the pictures read for the profile's own businesses.
async function picHeadersFlow() {
  console.log("\n# pictures: Ad accounts group headers without the Businesses list → one read for the profile's own businesses, not for a client's");
  const known = { 1001: CDN("logo_1001"), 1002: CDN("logo_1002"), 9999: CDN("logo_9999") };
  const b = await boot({ fb: adsFb(TOK), graph: bmsGraph(), pics: picsKnown(known, "business") });
  await adsPage(b);
  const pop = await popup(b, "accounts");
  ok("the accounts load (the walk over the profile's businesses included)", await rowsAre(pop, "#accountsList .lrow", 4));
  ok("one pictures read: the groups' businesses that me/businesses listed (1001, 1002), not the client's 9999, with fields=profile_picture_uri",
    await waitFor(() => b.picHits.length === 1) && idsOf(b.picHits[0]).sort().join() === "1001,1002" && fieldsOfQuery(b.picHits[0]) === "profile_picture_uri", b.picHits.join(" | "));
  ok("the two group headers show their logos; the client's business, the icon", await until(pop, () => document.querySelectorAll("#accountsList .lgroup .lav.ok").length === 2) && (await headerAv(pop, "Alpha Media")).src === known[1001] && (await headerAv(pop, "Beta Ads")).src === known[1002]
    && (await headerAv(pop, "Partner Agency")).src === null, JSON.stringify(await headerAv(pop, "Partner Agency")));
  ok("the Businesses list was not loaded for this (no request to it with limit=50) and nothing else was asked", !b.hits.some((h) => h.startsWith("/me/businesses") && h.includes("limit=50")));
  await done(b);
}

// A failure of the pictures read is silent.
async function picSilentFlow() {
  console.log("\n# pictures: a failed pictures read is silent — icons stay, no toast, no retry loop; a page still gets its redirect");
  for (const [name, answer] of [["an error", () => ({ status: 400, body: { error: { code: 100, message: "(#100) Object with ID '100000000000012' does not exist, cannot be loaded due to missing permissions, or does not support this operation" } } })],
    ["a server error", () => ({ status: 500, body: { error: { code: 1, message: "An unknown error occurred" } } })], ["not JSON", () => ({ status: 502, body: "<html>bad gateway</html>" })]]) {
    const b = await boot({ fb: adsFb(TOK), graph: (u) => (pathOf(u) === "/me/businesses" ? { body: { data: BMS.map((x) => ({ ...x })) } } : pathOf(u) === "/me/accounts" ? { body: { data: PAGES } } : { body: { data: [] } }), pics: answer });
    await adsPage(b);
    const pop = await popup(b, "pages");
    ok(`${name}: the pages list is there, the pictures read was made once, nothing was said, the pages draw the redirect and — nothing behind it — the icons`, await rowsAre(pop, "#pagesList .lrow", 3) && await waitFor(() => b.picHits.length === 1 && b.pictureHits.length === 3)
      && (await toastOf(pop)) === "" && (await settle(pop)) && b.picHits.length === 1, `${b.picHits.length} ${b.pictureHits.length} ${await toastOf(pop)}`);
    ok(`${name}: the redirect answered 404 (a page that is not public): no <img> is left, the icon shows, the cache says "" for each`, await until(pop, () => document.querySelectorAll("#pagesList .lrow img").length === 0 && document.querySelectorAll("#pagesList .lrow .lav.ok").length === 0)
      && (await avOf(pop, pageRow(P1))).icon === "visible" && await picsAre(pop, { [P1]: "", [P2]: "", [P3]: "" }), JSON.stringify(await stored(pop, "pics")));
    await pop.click('[data-tab="bms"]');
    ok(`${name}: the Businesses tab — the same: logos missing from the list read, one failed pictures read, icons, no toast`, await rowsAre(pop, "#bmsList .lrow", 3) && await waitFor(() => b.picHits.length === 2) && (await toastOf(pop)) === "" && (await settle(pop)) && b.picHits.length === 2 && b.pictureHits.length === 3
      && (await avOf(pop, bmRow("1001"))).icon === "visible", `${b.picHits.length} ${b.pictureHits.length}`);
    await done(b);
  }
}

export const flows = { picPages: picPagesFlow, picPagesList: picPagesListFlow, picBusinesses: picBusinessesFlow, picHeaders: picHeadersFlow, picSilent: picSilentFlow };
