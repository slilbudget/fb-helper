// js/links.js: every URL the extension opens; ids from Graph are validated before they go into a URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LINKS, imageUrl } from "../fb-helper/js/links.js";

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

test("no link nobody opens: every LINKS entry is used by the extension (accountSettings and bmQuality were not)", () => {
  assert.ok(!("accountSettings" in LINKS) && !("bmQuality" in LINKS));
});
