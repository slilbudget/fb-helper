# Release checklist — Ads Helper (Chrome Web Store)

The repo and GitHub stay **FB Helper** (`fb-helper/`). Only the store build is **Ads Helper** with the neutral logo (`chrome-web-store/icons/logo-source.png`, `chrome-web-store/icons/`).

## 1. Build
- [ ] `chrome-web-store/build.sh` → `chrome-web-store/release/unpacked/` (exact ZIP contents) and `chrome-web-store/release/ads-helper-2.5.0.zip`
- [ ] `node --test test/*.test.mjs` passes
- [ ] `node --test test/docs.test.mjs` passes (the docs say what the extension does: every CSP origin in the privacy policy, English and Russian, no "only to the Graph host" claim, the CSP quoted in the listing is the manifest's; while `pending()` is still in that file the default run reports these checks as TODO)
- [ ] `EXT_DIR=chrome-web-store/release/unpacked node test/e2e.mjs` passes (runs the store build, not the repo)
- [ ] `manifest.json` is at the ZIP root (`unzip -l chrome-web-store/release/ads-helper-2.5.0.zip | grep -x '.*manifest.json'`), no comments in it
- [ ] Version is higher than any previously uploaded version (2.1.0 and 2.2.0 are already in the store; every upload needs a bump — this one is 2.5.0)
- [ ] No `FB Helper`, no Facebook "f" logo in the package (the build script fails if the old name is left; icons come from `chrome-web-store/icons/`)

## 2. Manual test of the unpacked store build
- [ ] `chrome://extensions` → Developer mode → Load unpacked → `chrome-web-store/release/unpacked/`
- [ ] Toolbar icon and tooltip say "Ads Helper"; popup header shows the new logo
- [ ] With a Facebook tab open: token appears, type badge correct, **Check** works, **Copy token** works
- [ ] Cookies tab: **Copy cookies + UA** copies two paragraphs (cookie string, the FB tab's UA) and refuses without a readable UA; **JSON** copies the cookies with attributes
- [ ] **Token + cookies + UA** copies token, cookies, UA, then `Profile: <name> (<id>)` / `BM: <name> (<id>), …` (check the BM list against Business Settings on a profile that has BMs); with another account's token, or with no readable UA, it refuses
- [ ] Businesses, Accounts, Pages: the first open of each tab with nothing loaded loads once; reopening the popup and switching tabs send nothing (DevTools → Network on the popup); the refresh button works once a minute and says how long to wait otherwise
- [ ] Network tab of the popup (DevTools of the popup) shows GET requests to Meta's Graph API, pictures from `fbcdn.net` / `fbsbx.com` (and, for a Page without a picture URL, the picture redirect of the Graph host: `/<version>/<id>/picture?type=small`), and — with a multi-currency total on screen and no fresh cached rate table — one file from `cdn.jsdelivr.net` (fallback `latest.currency-api.pages.dev`). No other host, no POST
- [ ] No errors in `chrome://extensions` → Errors, no console errors in the popup
- [ ] Language switch RU/EN persists

## 3. Store-readiness checks
- [ ] Permissions are exactly `cookies`, `storage`, `scripting`; host `https://*.facebook.com/*`; no `<all_urls>`, no `tabs`, no background/service worker, no content scripts (none are used)
- [ ] No `eval`, `new Function`, remote `<script>`, remote CSS/fonts (verified by grep on the build); the two exchange-rate files are data (parsed as JSON), never code
- [ ] `description` ≤ 132 chars (123), `name` ≤ 75 chars (10); the listing's summary is the manifest's text
- [ ] `PRIVACY_POLICY.md` is pushed to `main` and the URL opens without login
- [ ] Listing text has the "not affiliated with Meta" line; no "FB"/"Facebook" in the name or the icon
- [ ] Screenshots and promo tiles do not show the Facebook logo or the name "FB Helper" (`chrome-web-store/art/out/*` are clean; `docs/cover.png` is not — do not reuse it)

## 4. Developer account
- [ ] Developer account registered (one-time registration fee; amount is on the register page)
- [ ] 2-Step Verification enabled on the Google account (required to publish)
- [ ] Publisher name and contact email set and the email verified in the Dashboard (use an address you are fine to show publicly if you choose a public contact)
- [ ] Trader / non-trader status declared honestly (Dashboard → Account)

## 5. Dashboard (copy from `STORE_LISTING.md`)
- [ ] Package: upload `chrome-web-store/release/ads-helper-2.5.0.zip`
- [ ] Store listing: description, category, language, store icon `chrome-web-store/icons/icon_128.png`, screenshots, small promo tile
- [ ] Privacy: single purpose, justification for `cookies`, `storage`, `scripting`, host permission, remote code = **No**, data usage boxes (Authentication information, PII, Financial and payment information), three certifications, privacy policy URL
- [ ] Distribution: visibility and regions
- [ ] Submit for review, then watch the developer email for questions

## 6. After submit
- [ ] Expect a longer review: the extension asks for `cookies` + a Facebook host pattern and reads authentication data. Reviews normally take days, sometimes weeks; write to support after 3 weeks
- [ ] If rejected, read the violation ID in the email and answer in the Dashboard; do not resubmit the same package unchanged
- [ ] After approval you have 30 days to publish
- [ ] Every code change: bump `version` in `manifest.json`, rerun sections 1–2, rebuild, upload

## 7. Images (generated by `chrome-web-store/art/shots.mjs` into `chrome-web-store/art/out/`; fictional data, no Facebook logo)

| Image | Size | Required | Notes |
|---|---|---|---|
| Store icon | 128×128 PNG | yes | **Done:** `chrome-web-store/icons/icon_128.png` — 96×96 artwork inside 16 px transparent padding per side |
| Extension icons in the package | 16, 32, 48, 128 PNG | yes | **Done** (built into the ZIP from `chrome-web-store/icons/`) |
| Screenshots | 1280×800, JPEG or 24-bit PNG without alpha (as the Dashboard form states), 1 to 5 per language | at least 1 | **Done for 2.5.0** (regenerated 2026-10-10, fictional data, generated pictures): two sets of five, one popup view per tab: English `chrome-web-store/art/out/screenshots/en/01-businesses, 02-accounts, 03-pages, 04-token, 05-cookies.png`, Russian `…/screenshots/ru/…` (same names). The Dashboard takes five, so the Ads view of an opened account is not in the sets and the overview `chrome-web-store/art/out/store-screenshot-1280x800.png` (token, cookies, accounts side by side) is not a sixth: swap it in for one of the five if you want it (`cover.png` is 2100×1182 and is rejected by the form) |
| Small promo tile | 440×280, JPEG or 24-bit PNG without alpha | yes | **Done:** `chrome-web-store/art/out/promo-tile-440x280.png` |
| Marquee promo tile | 1400×560 | optional | Not made; needed only to be featured |
| Global promo video | YouTube URL | optional in the Dashboard form | Skip |

Rules from the Chrome docs: avoid text in promo images, fill the whole area, make the edges clear, no Facebook logo.

## 8. Known rejection risks (not fixable by paperwork)
1. **Cookie and token export.** The extension reads Facebook session cookies and the access token and copies them to the clipboard (including a JSON form for importing a session into another browser profile). Reviewers may treat that as credential handling or as facilitating access to an account. The listing describes it plainly; that is the honest position, but the risk of rejection or a long in-depth review is real. The lowest-risk variant would drop the cookie JSON and **Token + cookies + UA** buttons (a code change, not done).
2. **Broad Facebook host access plus `cookies` plus code injection into the page** (`scripting`, MAIN world) trigger the longer review the docs describe.
3. **Prominent disclosure.** The Chrome FAQ says a disclosure of sensitive data handling must be shown in the product before use and not only in the policy. The popup already shows the token and cookies openly, but has no first-run notice. Adding a one-line notice under the tabs is the cheap fix if a reviewer asks.
4. **Brand.** The store build carries no "FB"/"Facebook" in the name or the icon. The homepage/privacy URL still points at the repo called `fb-helper` with the FB Helper name; a reviewer who clicks through sees it. Renaming the repo or hosting the policy on a neutral URL removes the mismatch.
5. **Meta's rules.** Meta's developer brand rules forbid "FB", "Facebook" and "for Facebook" in names. The description uses "Facebook" only to say what the extension works with, which the rules allow.
6. **More network destinations than "one API".** Besides Meta's Graph API the extension fetches pictures from Meta's image CDN and one public exchange-rate file a day. All three are in the manifest CSP, in the privacy policy (English and Russian) and in the listing, and the rate files are data, never code; a reviewer who expects a single host will still see them in the Network tab.
7. **"antidetect" in the popup.** The tooltip of the JSON cookie button (`copyJson.title` in `fb-helper/js/i18n.js`, both languages) says the JSON is for import into an antidetect browser. The listing and the policy do not use the word; the popup does (a code change to drop it, not done).

## 9. Release 2.5.0 (Businesses, Accounts and Pages as list tabs, next-step links, daily exchange rates)
The docs pass is done: README, privacy policy, SECURITY, the listing and this checklist say what 2.5.0 does. What is left is the release step and the things only a live account can show.

Release step
- [x] Bump 2.4.1 → 2.5.0 in one commit: `fb-helper/manifest.json`, README (heading and the two zip names), the heading of `chrome-web-store/STORE_LISTING.md`, the zip names in this file, `chrome-web-store/art/{cover,cover-1280x800,social}.html`, the placeholder of `.github/ISSUE_TEMPLATE/bug.yml`. `test/docs.test.mjs` fails until every place agrees. The manifest `description` already has the 2.5.0 text (123 chars) and the listing's summary is the same string
- [ ] `node --test test/*.test.mjs` passes, and every docs check in it counts (the docs name every CSP origin in English and Russian, the listing quotes the manifest's CSP, no sentence says the extension talks "only" to the Graph host)
- [x] Take `pending()` out of `test/docs.test.mjs` (and the "known to fail" wording of the CI step) so these three checks always count
- [ ] `node test/e2e.mjs` and `EXT_DIR=chrome-web-store/release/unpacked node test/e2e.mjs` pass
- [ ] `chrome-web-store/build.sh`, then sections 1–3 above on the unpacked store build

Live checks (a real account, nothing here is covered by the mocks)
- [ ] Click through every URL in `fb-helper/js/links.js` in a logged-in browser: each one lands on the intended page. Only the Ads Manager link is verified; every other one is unverified. Mark each `VERIFIED` in that file after it passes, and fix or drop the ones that do not land
- [ ] Businesses (`me/businesses` with `verification_status` and `profile_picture_uri`), Accounts (`me/adaccounts` and the business edges) and Pages (`me/accounts`, `owned_pages`, `client_pages`) with a real token of each type that can read them, EAAB and EAAG: each list loads, an optional field a token cannot read drops out without losing the list, and no Page access token appears in `chrome.storage.session` (`pages`)
- [ ] Business edges (`owned_ad_accounts`, `client_ad_accounts`, `owned_pages`, `client_pages`) per business: rows merged without duplicates, accounts and Pages not assigned to the profile marked "No access", a business whose edge fails gets the muted note and no verdict while the others are unaffected
- [ ] Spend per business on the Businesses tab equals the sum of its accounts on the Accounts tab for each period; counts and "Ad accounts →" list the same accounts
- [ ] Pictures: business logos and Page pictures load from `fbcdn.net` / `fbsbx.com` only, with no referrer, loaded at once (24 px, not lazy); the CSP `img-src` names those two hosts and the Graph origin (test/manifest.test.mjs), and `imageUrl` lets the Graph origin through only as `/<version>/<digits>/picture`. With a real token: after each list load the rows without a picture get ONE read `GET /<version>/?ids=…&fields=picture{url}` (pages) or `fields=profile_picture_uri` (businesses) per 50 rows, and it is the only request to the Graph root; check that the real answer is `{ "<id>": { … } }` and that one unreadable ID does not spoil it. If a real picture comes from another Meta host it shows the placeholder: then add the host to `imageUrl` (`links.js`) and to `img-src` together, and to the policy
- [ ] Exchange rates with a profile that has two or more currencies: the first view of the total makes one request to `cdn.jsdelivr.net`; a second view the same day makes none (`fx` in `chrome.storage.local`); with that host blocked the fallback `latest.currency-api.pages.dev` answers; with both blocked the total stays a per-currency sum and nothing is retried for 20 minutes; the request carries no cookies and no referrer
- [ ] Limits: a second refresh within a minute is refused with the wait time, the pill shows a pause after a throttle answer, and the Network tab shows no request while it lasts
- [ ] Tab order is Token · Cookies · Businesses · Accounts · Pages, and "BM" appears nowhere in the UI (EN "Businesses", RU "Бизнесы"; the copied block keeps its `BM:` line)

Store
- [x] Regenerate the store art with the build of this version: `chrome-web-store/build.sh && node chrome-web-store/art/shots.mjs` (fictional data, no Facebook logo, no "FB Helper" name, no real pictures); Russian and English. Done 2026-10-10 against 2.5.0: Businesses and Pages captures added to `shots.mjs`, `ART_DEV=1` run for `docs/cover.png`
- [ ] Privacy policy URL in the form points to `PRIVACY_POLICY.md` on `main` (push to `main` first); the page carries the date 2026-10-10
- [ ] Listing text (`STORE_LISTING.md`, English and Russian), single purpose, the four justifications, the CSP quote in "Remote code" and the data-usage answers pasted into the Dashboard; the summary equals the manifest's `description`
