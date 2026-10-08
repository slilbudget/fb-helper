// js/links.js: every URL the extension opens; ids from Graph are validated before they go into a URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LINKS } from "../fb-helper/js/links.js";

test("ad account links take the id with or without act_", () => {
  assert.equal(LINKS.adsManager("123"), "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123");
  assert.equal(LINKS.adsManager("act_123"), LINKS.adsManager("123"));
  assert.match(LINKS.billing(42), /act=42$/);
});
test("anything but digits gives no link", () => {
  for (const bad of [null, undefined, "", "12a", "1/../x", "javascript:alert(1)", "1?x=2", " 1", "act_", "1".repeat(26)])
    for (const fn of [LINKS.adsManager, LINKS.billing, LINKS.bmSettings, LINKS.page, LINKS.pageSuite, LINKS.bmQuality])
      assert.equal(fn(bad), null, `${fn.name || "link"}(${JSON.stringify(bad)})`);
});
test("every link is https on a facebook.com host", () => {
  for (const [k, fn] of Object.entries(LINKS)) {
    const u = new URL(fn("123"));
    assert.equal(u.protocol, "https:", k);
    assert.ok(u.hostname === "facebook.com" || u.hostname.endsWith(".facebook.com"), k);
  }
});
