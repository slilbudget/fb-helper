# FB Helper 2.4.1

[![CI](https://github.com/slilbudget/fb-helper/actions/workflows/ci.yml/badge.svg)](https://github.com/slilbudget/fb-helper/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/slilbudget/fb-helper)](https://github.com/slilbudget/fb-helper/releases/latest) [![License: MIT](https://img.shields.io/github/license/slilbudget/fb-helper)](LICENSE)

![FB Helper — token, cookies and ad accounts](docs/cover.png)

Chrome extension (MV3): Facebook access token, session cookies, ad account status, Business Managers and Pages in one popup. Read-only — it never changes anything in your ads.

## Install

1. Download `fb-helper-2.4.1.zip` from [Releases](https://github.com/slilbudget/fb-helper/releases/latest) and unpack (or `git clone` and use the `fb-helper/` folder)
2. `chrome://extensions` → enable **Developer mode**
3. **Load unpacked** → pick the unpacked folder (from a clone: `fb-helper/`; keep the folder after installing)

Chrome 121+. A Facebook tab must be open in the same profile; the ads token (EAAB) comes from `adsmanager.facebook.com`.

## Features

- **Language** — English and Russian, `RU · EN` toggle in the header. The first run follows the browser's UI language; after that the choice is yours, stored in `chrome.storage.local`, and survives a browser restart. English account statuses and disable reasons use the Marketing API names (`Unsettled`, `Ads integrity policy`, …), the same as Ads Manager.
- **Tabs** — Token, Cookies, Businesses, Ad accounts and Pages, all five in one row.
- **Token** — reads the token from the open FB tab and shows its type: EAAB (Ads Manager), EAAG (Business Manager), EAAd (Events Manager), EAAH (Commerce Manager), EAAI (Automated Rules). Each type links to the page where that token lives. **Check** shows the profile, the app and the permissions behind the token. The refresh button next to the field re-reads the token from the FB tab (and lets you retry a token that was reported dead).
- **Cookies** — **Copy cookies + UA** (cookie string, blank line, the profile's User-Agent; no Graph request) or JSON with attributes for importing into a browser profile; **Token + cookies + UA** (Token tab) copies them in one block — token, blank line, cookie string, blank line, User-Agent, blank line, then `Profile: <name> (<id>)` and `BM: <name> (<id>), …` in English — after one `/me` read confirms the token belongs to the logged-in user (`c_user`) and brings the profile name and its Business Managers (`BM: not available` for tokens without `business_management`, e.g. EAAd / EAAH). A token from another account is not copied, and neither is a block without a readable User-Agent. The User-Agent is not shown in the popup; it is read, when a copy button needs it, from the open Facebook tab, so it is the one the page sees (an antidetect profile's spoofed value, not the popup's own).
- **Ad accounts** — status, disable reason, spend per period (today / yesterday / 7 / 30 days / all time — the larger of Meta's own total, which lags behind, and the last 30 days + today), clicks and CPC, daily limit, billing threshold, payment method, pixels, business owner; ads with statuses, rejection reasons (every reason with the placement it applies to; disapproved ads first) and, for the selected period, each ad's spend, impressions, clicks and CPC (a second read after the list; switching the period sends nothing; "All time" is Meta's `maximum`, at most 37 months). The refresh button at the top of the tab re-reads the account list only; each account's ads have their own refresh icon in the ads card (so the ads cost nothing unless you ask). The loaded list and ads are kept until the browser closes and survive FB tab or token changes; logging in as another FB user drops them. The list also includes the ad accounts each business portfolio owns or is a client of (merged, no duplicates); accounts not assigned to you are marked. These extra reads run in the same refresh, one list refresh per minute.
- **Next step** — on the Ad accounts tab, a blocked, unpaid or under-review account and a rejected ad get a link to the Facebook page where you act on it (Account Quality for a review request or a restriction, billing for an unpaid balance, the hacked-profile page for a compromised account, support for a closed one), with one plain-language line on what it means. Links only: each opens in a new tab and the extension changes nothing.
- **Businesses** — the profile's business portfolios (Meta's current name for Business Managers): picture, name, ID, verification status, your role, created date, primary page, 2FA type, and how many ad accounts each owns (active / disabled, counted from the loaded Ad accounts list). A click filters the Ad accounts tab to that business; links go to its settings, ad accounts, security and quality pages. One read-only request for the list (`me/businesses`) when the tab first opens with nothing loaded; after that only the refresh button sends it.
- **Pages** — the profile's Facebook Pages, plus the Pages each business portfolio owns or is a client of (merged, no duplicates; Pages not assigned to you are marked): picture, name, ID, category, followers, published or not, whether it can be promoted, your tasks on it (ad rights), Instagram state (a connected account, a page-backed one from «Use Facebook Page», or none) and owner business. Problem filters, search, copy IDs, links. Read-only GETs with an explicit field list (`me/accounts`, then each business's `owned_pages` and `client_pages`); Page access tokens are never requested or stored. Same refresh rules as the Ad accounts tab.

## Safety and limits

- Requests go only to `graph.facebook.com`: on a button press, or when the **Ad accounts**, **Businesses** or **Pages** tab opens with nothing loaded yet or after you reloaded the Facebook page the token came from (so the list is there without looking for the refresh button). Reopening the popup or switching tabs alone sends nothing. The token is shown only while an open Facebook tab has it and is never stored beyond the browser session. Page access tokens are never requested or stored. Next-step links only open Facebook pages in a new tab.
- The account list refreshes at most once a minute (that slot is shared by the automatic load, the refresh button and every open popup; the automatic load is skipped during an API pause and with a dead session; open Facebook tabs are read in parallel, so a frozen or busy tab doesn't hold the popup), one account's ads at most once per 30 s. The businesses list has its own slot, at most once a minute. The Ad accounts and Pages lists are read in one sequential refresh (own list, then each business's owned and client edges), at most once a minute. Pictures of Pages and businesses are loaded from Meta's image CDN (facebook.com / fbcdn.net hosts, no referrer) only when those rows are shown. On an API rate-limit error all requests stop for 30 min. On a dead session (error 190 or 102) requests with that token stop until Facebook hands out a new one or you press the refresh button next to the token.
- Graph API version: `v26.0`. When Meta retires it, the extension switches to the newer version Graph names.

## Layout

| Folder | What it is |
|---|---|
| `fb-helper/` | The extension (FB Helper): `manifest.json`, `popup.html`, `css`, `js`, `fonts`, `images` |
| `chrome-web-store/` | The Chrome Web Store version (Ads Helper: other name and logo): build script, listing texts, checklist, artwork |
| `test/` | Unit and end-to-end tests |
| `docs/` | Images for this README |

## Build the archive

```
git archive --format=zip -o fb-helper-2.4.1.zip HEAD:fb-helper && zip -qj fb-helper-2.4.1.zip LICENSE
```

Only committed files go in: anything else lying in the local `fb-helper/` folder stays out.

The Chrome Web Store package (`chrome-web-store/release/ads-helper-<version>.zip`) comes from `chrome-web-store/build.sh`.

## Tests

```
node --test test/*.test.mjs   # unit tests, no browser
node test/e2e.mjs             # real Chromium + the unpacked extension, Facebook and Graph mocked; needs playwright-core (CI runs it too)
```

Icons: Lucide (ISC). Font: Golos Text (SIL OFL 1.1). Licenses sit next to the files.

[MIT](LICENSE) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)
