// js/links.js: every URL the extension opens; ids from Graph are validated before they go into a URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LINKS, imageUrl, graphPicture } from "../fb-helper/js/links.js";
import { setGraphUrl } from "../fb-helper/js/config.js";

test("ad account links take the id with or without act_", () => {
  assert.equal(LINKS.adsManager("123"), "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123");
  assert.equal(LINKS.adsManager("act_123"), LINKS.adsManager("123"));
  assert.match(LINKS.billing(42), /act=42$/);
});
test("anything but digits gives no link", () => {
  for (const bad of [null, undefined, "", "12a", "1/../x", "javascript:alert(1)", "1?x=2", " 1", "act_", "1".repeat(26)])
    for (const fn of [LINKS.adsManager, LINKS.billing, LINKS.bmSettings, LINKS.page, LINKS.pageSuite])
      assert.equal(fn(bad), null, `${fn.name || "link"}(${JSON.stringify(bad)})`);
});
test("every link is https on a facebook.com host", () => {
  for (const [k, fn] of Object.entries(LINKS)) {
    const u = new URL(fn("123"));
    assert.equal(u.protocol, "https:", k);
    assert.ok(u.hostname === "facebook.com" || u.hostname.endsWith(".facebook.com"), k);
  }
});

test("Ads Manager home (where «Use Facebook Page» is chosen) has no account in it", () => {
  assert.equal(LINKS.adsManagerHome(), "https://adsmanager.facebook.com/adsmanager/manage/ads");
});

// ---------- pictures ----------
test("imageUrl: only https on fbcdn.net / fbsbx.com (and their subdomains); the normalised URL comes back", () => {
  for (const ok of [
    "https://scontent.xx.fbcdn.net/v/t39.30808-1/123_n.jpg?stp=dst-jpg_s50x50&_nc_cat=1",
    "https://scontent-fra5-2.xx.fbcdn.net/v/t1.0-1/p50x50/a.jpg", "https://fbcdn.net/a.png", "https://platform-lookaside.fbsbx.com/platform/profilepic/?asid=1&hash=x", "https://FBSBX.com/x.png",
  ]) assert.equal(typeof imageUrl(ok), "string", ok);
  assert.equal(imageUrl("https://FBSBX.com/x.png"), "https://fbsbx.com/x.png");
});
test("imageUrl: facebook.com is not a picture host any more (P5: the manifest's img-src does not list it either)", () => {
  for (const bad of ["https://www.facebook.com/photo.jpg", "https://FACEBOOK.com/x.png", "https://static.xx.facebook.com/a.png"]) assert.equal(imageUrl(bad), null, bad);
});
test("imageUrl: anything else gives null (http, other hosts, look-alikes, credentials, ports, scripts, data URLs, junk)", () => {
  for (const bad of [
    "http://scontent.xx.fbcdn.net/a.jpg", "https://evil.example.com/a.png", "https://fbcdn.net.evil.com/a.png", "https://evilfbcdn.net/a.png", "https://notfacebook.com/a.png", "https://fbsbx.com.evil.com/a.png", "https://evilfbsbx.com/a.png",
    "https://facebook.com@evil.com/a.png", "https://user:pw@scontent.xx.fbcdn.net/a.jpg", "https://scontent.xx.fbcdn.net:8443/a.jpg",
    "javascript:alert(1)", "data:image/png;base64,AAAA", "//scontent.xx.fbcdn.net/a.jpg", "scontent.xx.fbcdn.net/a.jpg", "https://scontent.xx.fbcdn.net/a b.jpg",
    "https://scontent.xx.fbcdn.net/a.jpg\n", " https://scontent.xx.fbcdn.net/a.jpg", "", "   ", null, undefined, 5, {}, ["https://fbcdn.net/a.png"],
    `https://scontent.xx.fbcdn.net/${"a".repeat(2001)}`,
  ]) assert.equal(imageUrl(bad), null, JSON.stringify(bad));
});

test("imageUrl: the Graph picture redirect is accepted in its exact shape only (the Graph origin, /vNN.N/<digits>/picture, no query or ?type=small|normal|square|large)", () => {
  setGraphUrl("https://graph.test/");
  try {
    for (const ok of ["https://graph.test/v26.0/123/picture", "https://graph.test/v26.0/123/picture?type=small", "https://graph.test/v9.0/1234567890123456/picture?type=square", "https://GRAPH.test/v26.0/5/picture?type=large"])
      assert.equal(typeof imageUrl(ok), "string", ok);
    for (const bad of [
      "https://graph.evil.test/v26.0/123/picture", "https://graph.test.evil.com/v26.0/123/picture", "http://graph.test/v26.0/123/picture", "https://graph.test:8443/v26.0/123/picture", "https://u:p@graph.test/v26.0/123/picture",
      "https://graph.test/v26.0/me/picture", "https://graph.test/v26.0/12a/picture", "https://graph.test/v26/123/picture", "https://graph.test/123/picture", "https://graph.test/v26.0/123/picture/x", "https://graph.test/v26.0/123/picture/",
      "https://graph.test/v26.0/123", "https://graph.test/v26.0/123/photos", "https://graph.test/v26.0/me/adaccounts", "https://graph.test/v26.0/?ids=1", "https://graph.test/", "https://graph.test/v26.0/1234567890123456789012345678/picture",
      "https://graph.test/v26.0/123/picture?access_token=x", "https://graph.test/v26.0/123/picture?type=small&access_token=x", "https://graph.test/v26.0/123/picture?type=evil", "https://graph.test/v26.0/123/picture?redirect=0", "https://graph.test/v26.0/123/picture#x",
    ]) assert.equal(imageUrl(bad), null, bad);
    setGraphUrl("");
    assert.equal(imageUrl("https://graph.test/v26.0/123/picture"), null, "no Graph origin set: nothing but the two CDN hosts");
  } finally { setGraphUrl(""); }
});

test("graphPicture: <Graph origin>/<version>/<id>/picture?type=small for a digits-only id and a vNN.N version; anything else gives null; imageUrl accepts what it builds", () => {
  setGraphUrl("https://graph.test/");
  try {
    assert.equal(graphPicture("123", "v26.0"), "https://graph.test/v26.0/123/picture?type=small");
    assert.equal(graphPicture(123, "v9.0"), "https://graph.test/v9.0/123/picture?type=small");
    assert.equal(imageUrl(graphPicture("123", "v26.0")), "https://graph.test/v26.0/123/picture?type=small");
    for (const id of [null, undefined, "", "12a", "1/../x", "me", "act_1", " 1", "1".repeat(26)]) assert.equal(graphPicture(id, "v26.0"), null, JSON.stringify(id));
    for (const v of [undefined, "", "26.0", "v26", "v26.0/", "../v26.0", "v26.0?x=1"]) assert.equal(graphPicture("1", v), null, JSON.stringify(v));
    setGraphUrl("");
    assert.equal(graphPicture("1", "v26.0"), null, "no Graph origin set");
  } finally { setGraphUrl(""); }
});

test("no link nobody opens: every LINKS entry is used by the extension (accountSettings and bmQuality were not)", () => {
  assert.ok(!("accountSettings" in LINKS) && !("bmQuality" in LINKS));
});
