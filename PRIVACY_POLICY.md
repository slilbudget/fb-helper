# Privacy Policy — Ads Helper

Last updated: 2026-10-08

Ads Helper is a Chrome extension that shows, for the Facebook profile you are logged in to in your own browser, the access token, the session cookies, the browser's User-Agent, the status and spend of your ad accounts, and the business portfolios and Facebook Pages linked to the profile. This policy describes exactly what the extension does with data.

**Short version:** everything happens in your browser. The developer has no server and receives no data. The only network requests the extension makes go from your browser to `graph.facebook.com` (Meta's own API), and only when you use the extension.

## What the extension handles

| Data | Where it comes from | What happens to it |
|---|---|---|
| Facebook access token | Read from the Facebook tab you have open (the page's own script variables and HTML) | Shown in the popup; kept in `chrome.storage.session`; sent to `graph.facebook.com` as an `Authorization` header to read your ad accounts, Business Managers and Pages; copied to the clipboard only when you press a copy button |
| Facebook session cookies | `chrome.cookies` for `facebook.com` | Shown in the popup; copied to the clipboard (as a header string with the User-Agent, or JSON) only when you press a copy button. The `c_user` cookie is also read to notice that you switched Facebook accounts, so cached data of the previous account is dropped |
| Browser User-Agent | `navigator.userAgent` as reported by your open Facebook tab (the value Facebook's page itself sees) | Not shown in the popup; read and copied to the clipboard (with the cookies, or with the token and cookies) only when you press a copy button. Never stored, never sent anywhere |
| Profile, app and permission data; the profile's Business Manager names and IDs | `graph.facebook.com` (`me`, `me` with its `businesses`, `app`, `me/permissions`) | Shown in the popup when you press **Check**. **Token + cookies + UA** makes one `me` read that confirms the token belongs to the logged-in user and adds the profile name and its Business Managers to the copied block; that answer is kept in `chrome.storage.session` until the browser closes |
| Business portfolios (Meta's current name for Business Managers) of the profile: picture URL, name, ID, verification status, your role in each, created date, primary page, two-factor type, and how many ad accounts each owns | `graph.facebook.com`: `me/businesses`, one read-only request (the picture URL comes from the same read) | Shown in the Businesses tab; cached in `chrome.storage.session` until the browser closes or you log in as another Facebook user. The picture itself is loaded from Meta's image CDN (see Network requests) |
| Facebook Pages of the profile and of each business portfolio (owned or client): picture URL, name, ID, category, followers or likes, published state, promotion eligibility, your tasks on each Page (ad rights), Instagram connection, owner business | `graph.facebook.com`: `me/accounts`, then each business's `owned_pages` and `client_pages`; read-only, with explicit lists of fields | Shown in the Pages tab; cached in `chrome.storage.session` until the browser closes or you log in as another Facebook user. Page access tokens are never requested and never stored (the field lists leave them out, and any that arrive are dropped). Page pictures load from Meta's image CDN |
| Ad account data: names, IDs, status, disable reason, spend, clicks, limits, payment-method label, pixels, business owner, ads with their review status, and each ad's spend, impressions and clicks | `graph.facebook.com` (`me/adaccounts`, the `owned_ad_accounts` and `client_ad_accounts` of each business from `me/businesses`, `act_<id>/ads`; accounts not assigned to you are marked) | Shown in the popup; cached in `chrome.storage.session` |
| Settings: interface language, newer Graph API version learned from Meta, last open tab and spend period | Your choices / Meta's API responses | `chrome.storage.local` (language, API version) and the popup's `localStorage` (tab, period) |

The token and cookies are authentication data. The extension treats them as such: they are never written to disk by the extension, never logged, never sent anywhere except as described above.

## Network requests

- Requests go only to `https://graph.facebook.com/` and are read-only (`GET`). The extension cannot create, change or delete anything in your ads. This is enforced by the extension's Content Security Policy (`connect-src https://graph.facebook.com`).
- Opening an account's ads sends two reads: the list of ads, then the numbers per ad (spend, impressions, clicks), so a slow or refused numbers read never costs the list.
- Requests are made when you press a button, when you open the **Ad accounts**, **Businesses** or **Pages** tab with nothing loaded yet, or after you reloaded the Facebook page the token came from. Reopening the popup or switching tabs alone sends nothing. Every request is a read-only `GET`. The Ad accounts and Pages refreshes read the profile's own list, then each business's owned and client edges, one after another in the same refresh.
- Requests are rate-limited by the extension (the businesses list at most once a minute; the Ad accounts and Pages refreshes, each including the business edges, at most once a minute; one account's ads once per 30 seconds; a 30-minute pause after a Meta rate-limit error).
- Pictures: the Pages and Businesses tabs show each row's picture. The picture URL comes from the same Graph read; the image itself is loaded from Meta's image CDN (`facebook.com` / `fbcdn.net` hosts) without a referrer, only while that row is shown.
- The next-step links on the Ad accounts tab only open Facebook pages in a new tab. The extension sends no data with them and changes nothing.
- Because the request is made from your logged-in browser, the browser attaches your Facebook cookies to it, exactly as when you use facebook.com. Meta's handling of that data is governed by Meta's own privacy policy.

## What the extension does not do

- It does not send data to the developer or to any third party. No analytics, no telemetry, no crash reports, no advertising, no tracking.
- It does not sell data, does not use or transfer it for purposes unrelated to the single purpose above, and does not use it to determine creditworthiness or for lending.
- It does not load or run remote code. All scripts are inside the extension package. Fonts are bundled, not loaded from a font service.
- It does not read pages other than Facebook pages, and it does not read your browsing history.
- Humans do not read your data: the developer never receives it.

## Storage and retention

- Token, account cache, ads cache, businesses list, Pages list (including picture URLs), rate-limit counters: `chrome.storage.session`. It lives in memory and is deleted when the browser closes or the extension is reloaded or updated. Cookies and the User-Agent are read live each time and are not stored.
- Language and Graph API version: `chrome.storage.local`, until you remove the extension.
- Last open tab and spend period: popup `localStorage`, until you remove the extension.
- Removing the extension deletes all of it. Cached accounts, businesses and Pages are also dropped when you log in to Facebook as a different user.

## Permissions

- `cookies` — read Facebook cookies to show and copy them on your request, and `c_user` to detect an account switch.
- `storage` — keep the session cache and your language choice.
- `scripting` — run a bundled function in your open Facebook tab to find the access token that Facebook's own page holds and to read the browser's User-Agent as that page sees it.
- Host access `https://*.facebook.com/*` — the tabs the token is read from, the cookies, and the Graph API (`graph.facebook.com`). No other site is accessible.

## Compliance with the Chrome Web Store User Data Policy

The use of information received from Chrome APIs and from Facebook pages adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Your control

Remove the extension to delete everything it stored. Log out of Facebook to make the extension drop the cached accounts, businesses and Pages. Revoke or change your Facebook session and tokens in Facebook itself.

## Not affiliated with Meta

Ads Helper is an independent product. It is not affiliated with, endorsed by or sponsored by Meta Platforms, Inc. Facebook and Meta are trademarks of Meta Platforms, Inc.

## Changes and contact

Changes to this policy are published in this file with a new date. The source code is open: <https://github.com/slilbudget/fb-helper>. Questions and reports: <https://github.com/slilbudget/fb-helper/issues> (security issues: Security → Report a vulnerability in the same repository).

---

# Политика конфиденциальности — Ads Helper

Обновлено: 08.10.2026

Ads Helper показывает для профиля Facebook, в который вы вошли в своём браузере, токен доступа, cookie сессии, User-Agent браузера и статус и расход рекламных кабинетов, а также бизнес-портфолио (Business Manager'ы) и Страницы Facebook, связанные с профилем. Всё происходит в вашем браузере. У разработчика нет сервера, и он не получает никаких данных.

- **Что обрабатывается:** токен (читается из открытой вкладки Facebook), cookie facebook.com, User-Agent браузера (как его видит открытая вкладка Facebook; нигде не хранится и никуда не отправляется), данные профиля, приложения и прав токена, названия и ID Business Manager'ов профиля (`me`, `app`, `me/permissions`), список бизнес-портфолио профиля (`me/businesses`: картинка, статус верификации, роль, дата создания, основная Страница, 2FA, число кабинетов), Страницы профиля и бизнес-портфолио (`me/accounts`, `owned_pages`, `client_pages`; токены Страниц не запрашиваются и не хранятся), данные кабинетов и объявлений, включая расход, показы и клики по каждому объявлению (`me/adaccounts`, `owned_ad_accounts` и `client_ad_accounts` бизнес-портфолио, `act_<id>/ads`; кабинеты, не назначенные вам, помечаются), язык интерфейса, версия Graph API, последняя открытая вкладка и период.
- **Куда уходит:** только запросы `GET` из вашего браузера на `graph.facebook.com`, только на чтение. Токен уходит туда в заголовке `Authorization`; браузер, как и на facebook.com, прикладывает ваши cookie Facebook. Запросы идут по кнопке, при первом открытии вкладок «Кабинеты», «Бизнесы» или «Страницы» без загруженных данных или после перезагрузки страницы Facebook. Повторное открытие окна и переключение вкладок ничего не отправляют. Частота ограничена самим расширением: список бизнес-портфолио не чаще раза в минуту; кабинеты и Страницы обновляются одним проходом (свой список, затем рёбра каждого бизнес-портфолио, по очереди), тоже не чаще раза в минуту.
- **Ссылки «Следующий шаг»:** открывают страницы Facebook в новой вкладке; расширение при этом ничего не отправляет и ничего не меняет.
- **Картинки:** в списках Страниц и бизнес-портфолио показываются картинки. Их адрес приходит из того же запроса, а сама картинка загружается с CDN Meta (хосты facebook.com / fbcdn.net) без referrer, только пока строка на экране.
- **В буфер обмена** токен, cookie и User-Agent попадают только когда вы сами нажали кнопку копирования.
- **Хранение:** токен, кэш кабинетов, бизнес-портфолио и Страниц (включая адреса картинок) — `chrome.storage.session` (в памяти, стираются при закрытии браузера, перезагрузке или обновлении расширения; токены Страниц не сохраняются); язык и версия API — `chrome.storage.local`; последняя вкладка и период — `localStorage` окна. Cookie и User-Agent читаются каждый раз заново и не хранятся. Удаление расширения стирает всё. Кэш кабинетов, бизнес-портфолио и Страниц сбрасывается и при входе в другой аккаунт Facebook.
- **Чего нет:** передачи данных разработчику или третьим лицам, аналитики, телеметрии, рекламы, продажи данных, удалённого кода, чтения других сайтов и истории браузера.
- **Доступы:** `cookies`, `storage`, `scripting` и только `https://*.facebook.com/*`.
- **Не связано с Meta:** Ads Helper — независимый продукт, не связан с Meta Platforms, Inc., не одобрен и не спонсируется ею. Facebook и Meta — товарные знаки Meta Platforms, Inc.
- **Связь:** <https://github.com/slilbudget/fb-helper/issues>.
