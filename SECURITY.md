# Security

Report vulnerabilities privately: **Security → Report a vulnerability** on this repository. Do not open a public issue.

Expect a reply within 7 days.

Scope: the extension code in this repository. The extension's network destinations are exactly the origins in the `connect-src` and `img-src` of `fb-helper/manifest.json`:

- Meta's Graph API: `GET` requests only, to paths of word segments (`me`, `me/adaccounts`, `act_<id>/ads`), with the token in an `Authorization` header. Nothing is created, changed or deleted.
- Meta's image CDN (`fbcdn.net`, `fbsbx.com`): pictures of businesses and Pages, over https, without a referrer.
- Two public exchange-rate files (`open.er-api.com`, fallback `cdn.jsdelivr.net`): at most one download per day, and only while a total adds up two or more currencies; no cookies, no referrer, nothing about the user in the request.

Storage: the token, the loaded lists and the rate-limit counters live in `chrome.storage.session` (memory, gone when the browser closes); the language, the Graph API version and the cached exchange rates in `chrome.storage.local`; the last open tab and the spend period in the popup's `localStorage`. Cookies and the User-Agent are read live and never stored. A Page access token is never requested or stored.

Anything that breaks this is a vulnerability: a request to another host or with another method, a path or picture URL built from unchecked data, a token or cookie that is stored or sent anywhere beyond the above, a Page access token that is kept.
