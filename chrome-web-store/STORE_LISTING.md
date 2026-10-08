# Chrome Web Store listing — Ads Helper 2.4.1

Copy each block into the Developer Dashboard. Every statement below matches the code of this version.

## Store listing tab

**Name** (shown from the manifest, max 75): `Ads Helper`

**Summary** (comes from the manifest `description`, max 132 chars; 123 used):
```
Facebook token, cookies, and the spend and problems of your ad accounts, businesses and Pages. Read-only, with rate limits.
```

**Category:** Tools (alternative: Workflow & Planning)

**Language:** English (the popup itself is English and Russian; add a Russian description below if you want a Russian listing)

**Detailed description (English):**
```
Ads Helper shows what is going on with the Facebook profile you are logged in to in this browser: its access token and session cookies, and the spend, problems and fixes of its ad accounts, businesses and Facebook Pages. It is read-only: it never creates, edits or deletes anything in your ads.

WHAT IT DOES
• Token: reads the access token from a Facebook tab you already have open and shows its type (EAAB Ads Manager, EAAG Business Manager, EAAd Events Manager, EAAH Commerce Manager, EAAI Automated Rules). "Check" shows the profile, the app and the permissions behind the token. One click copies it.
• Cookies: the Facebook session cookies of this browser profile, copied together with the User-Agent ("Copy cookies + UA") or as JSON. "Token + cookies + UA" copies the token, the cookies and the browser profile's User-Agent (as the Facebook page sees it) in one block, followed by the profile name and its Business Managers with IDs, after confirming the token belongs to the logged-in user.
• Businesses: every business (business portfolio, Meta's current name for Business Manager) of the profile, with its logo, the spend for the period you pick (today, yesterday, 7 days, 30 days, all time), a total across businesses and how many ad accounts it has (active, disabled). A problem (a failed business verification, no active ad account, no ad account) comes with a link to the page where you fix it. One click lists the ad accounts of that business.
• Accounts: every ad account the token can see: the profile's own and those of its businesses (owned and client, merged without duplicates; an account not assigned to you is marked "No access" with an "Assign me" link). Grouped by business with a subtotal, the spend of the period on each row, and a problem (disabled and why, unpaid, in review, restricted) with one link to where you act on it. Open a row for clicks and CPC, balance, billing threshold, daily limit, spend cap, payment method and pixels. Search, status filters; one button copies the IDs of the active accounts assigned to you.
• Ads: the ads of an account with their statuses and review results, every rejection reason with the placement it applies to, disapproved ads first, and each ad's spend, impressions, clicks and CPC for the selected period, including all time.
• Pages: every Facebook Page the token can see (the profile's own and those its businesses own or use as a client), with its picture and whether it is alive for advertising: dead (Meta does not allow promoting it), hidden (unpublished) or without your access. Each problem has a link to the page where you fix it; Alive / Dead / Hidden / No access filters and search. An open row also shows Meta's reason for a dead Page and the Page's Instagram state.
• Next steps: a problem on a list, and a rejected ad, get a link to the Facebook page where you act on it (request a review in Account Quality, pay the balance, secure a hacked profile, assign yourself in Business Settings, publish in Business Suite, contact support), with a plain explanation. The links only open pages in a new tab; the extension changes nothing.
• Money: each row shows its spend in the account's own currency. A total across several currencies is converted to USD at the daily rate ("≈ $1,727") with the breakdown under it.
• English and Russian interface.

PRIVACY AND SAFETY
• Everything happens in your browser. There is no developer server, no analytics, no ads, no tracking. Nothing is sent to the developer.
• Network: read-only GET requests to Meta's Graph API with your own token; pictures of businesses and Pages from Meta's image CDN (no referrer; a Page without a picture URL asks Meta's Graph address for its public picture, which redirects to the CDN); and, while a total adds up two or more currencies, one public exchange-rate file per day from open.er-api.com (cdn.jsdelivr.net if that fails), with nothing about you in the request. Those servers see your IP address, like any website. Opening the popup again or switching tabs sends nothing.
• Built-in limits protect your token: each list (businesses, accounts, Pages) refreshes at most once a minute, one account's ads at most once per 30 seconds, at most 600 requests an hour, and after a Meta rate-limit error every request pauses for 30 minutes. A dead session stops all requests with that token.
• The token and the loaded lists stay in the browser's session storage and disappear when the browser closes; Page access tokens are never requested or stored; cookies and the User-Agent are read live and never stored. The token, cookies and User-Agent reach the clipboard only when you press a copy button.
• No remote code. The source code is open: https://github.com/slilbudget/fb-helper

IMPORTANT
The token and cookies are the keys to your Facebook session. Copy them only to places you trust, and never share them with anyone you do not trust with your account.

Ads Helper is an independent product. It is not affiliated with, endorsed by or sponsored by Meta Platforms, Inc. Facebook and Meta are trademarks of Meta Platforms, Inc.
```

**Detailed description (Russian, optional):**
```
Ads Helper показывает, что происходит с профилем Facebook, в который вы вошли в этом браузере: его токен доступа и cookie сессии, а также расход, проблемы и способы их исправить у его рекламных кабинетов, бизнесов и Страниц Facebook. Только чтение: ничего не создаёт, не меняет и не удаляет в вашей рекламе.

ЧТО УМЕЕТ
• Токен: читает токен из уже открытой вкладки Facebook и показывает его тип (EAAB, EAAI, EAAG, EAAH, EAAd). «Проверить» показывает профиль, приложение и права токена. Копируется одним кликом.
• Cookie: cookie сессии Facebook этого профиля браузера вместе с User-Agent («Скопировать cookie + UA») или JSON. «Токен + cookie + UA» копирует токен, cookie и User-Agent профиля браузера (как его видит страница Facebook) одним блоком, а в конце — имя профиля и его Business Manager'ы с ID, предварительно убедившись, что токен принадлежит вошедшему пользователю.
• Бизнесы: бизнес-портфолио профиля (Meta называет их Business Manager'ами): логотип, расход за выбранный период (сегодня, вчера, 7 дней, 30 дней, всё время), общая сумма по бизнесам и число кабинетов (активных и заблокированных). Проблема (не пройдена верификация бизнеса, нет активных кабинетов, нет кабинетов) идёт со ссылкой на страницу, где её исправляют. Клик показывает кабинеты этого бизнеса.
• Кабинеты: все рекламные кабинеты, которые видит токен: свои и кабинеты бизнесов (владельческие и клиентские, без дублей; не назначенный вам кабинет помечается «Нет доступа» со ссылкой «Назначить себя»). Группы по бизнесам с подытогом, расход за период в каждой строке и проблема (заблокирован и почему, долг, на проверке, ограничен) с одной ссылкой, где это решается. В открытой строке: клики и CPC, баланс, порог оплаты, дневной лимит, лимит трат, способ оплаты и пиксели. Поиск, фильтры по статусу; одна кнопка копирует ID активных кабинетов, назначенных вам.
• Объявления: объявления кабинета со статусами и результатом проверки, каждая причина отклонения с плейсментом, отклонённые сверху, и расход, показы, клики и CPC по каждому объявлению за выбранный период, включая всё время.
• Страницы: все Страницы Facebook, которые видит токен (свои и те, что есть у бизнесов профиля как владельческие или клиентские), с картинкой и тем, жива ли она для рекламы: мёртвая (Meta не разрешает её рекламировать), скрытая (не опубликована) или без вашего доступа. У каждой проблемы ссылка на страницу, где её исправляют; фильтры «Живые / Мёртвые / Скрытые / Без доступа» и поиск. В открытой строке ещё причина от Meta для мёртвой Страницы и состояние её Instagram.
• Следующие шаги: проблема в списке и отклонённое объявление получают ссылку на страницу Facebook, где это решается (запрос проверки в Account Quality, оплата баланса, защита взломанного профиля, назначение себя в Business Settings, публикация в Business Suite, поддержка), и короткое пояснение. Ссылки только открывают страницы в новой вкладке; расширение ничего не меняет.
• Деньги: в каждой строке расход в валюте кабинета. Общая сумма по нескольким валютам пересчитывается в доллары по дневному курсу («≈ 1 727 $») с разбивкой под ней.
• Интерфейс на русском и английском.

КОНФИДЕНЦИАЛЬНОСТЬ
• Всё происходит в вашем браузере. Нет сервера разработчика, аналитики, рекламы и трекинга. Разработчику ничего не отправляется.
• Сеть: запросы на чтение (GET) к Graph API Meta с вашим токеном; картинки бизнесов и Страниц с CDN Meta (без referrer); и, пока сумма складывает две и более валюты, один публичный файл с курсами в сутки с open.er-api.com (с cdn.jsdelivr.net, если не вышло), без каких-либо данных о вас в запросе. Эти серверы видят ваш IP-адрес, как любой сайт. Повторное открытие окна и переключение вкладок ничего не отправляют.
• Встроенные лимиты берегут токен: каждый список (бизнесы, кабинеты, Страницы) обновляется не чаще раза в минуту, объявления кабинета — не чаще раза в 30 секунд, не больше 600 запросов в час, а после ошибки лимита Meta все запросы стоят 30 минут. Закрытая сессия останавливает запросы с этим токеном.
• Токен и загруженные списки лежат в session storage браузера и исчезают при закрытии; токены Страниц не запрашиваются и не сохраняются; cookie и User-Agent читаются каждый раз заново и нигде не хранятся. В буфер обмена токен, cookie и User-Agent попадают только по вашей кнопке копирования.
• Удалённого кода нет. Исходный код открыт: https://github.com/slilbudget/fb-helper

ВАЖНО
Токен и cookie — ключи от вашей сессии Facebook. Копируйте их только туда, где доверяете, и не передавайте тем, кому не доверили бы аккаунт.

Ads Helper — независимый продукт, не связан с Meta Platforms, Inc., не одобрен и не спонсируется ею. Facebook и Meta — товарные знаки Meta Platforms, Inc.
```

**Official URL / Homepage / Support URL:** `https://github.com/slilbudget/fb-helper` (issues: `.../issues`)

**Privacy policy URL:** `https://github.com/slilbudget/fb-helper/blob/main/PRIVACY_POLICY.md` (the file must be pushed to `main` first)

---

## Privacy practices tab

**Single purpose description:**
```
View the status, spend and problems of the ad accounts, businesses and Facebook Pages of the Facebook profile the user is logged in to, with a link to the Facebook page that fixes each problem, in one read-only popup. The popup uses the session already open in the browser: it also shows the profile's access token and session cookies and can copy them on request.
```

### Permission justifications

**cookies**
```
Reads the user's own facebook.com cookies to show them in the popup and to copy them when the user presses a button. The c_user cookie also tells the extension that another account logged in, so the previous account's cached data is dropped. Cookies go nowhere except to Facebook itself, attached by the browser to requests to graph.facebook.com.
```

**storage**
```
Keeps the token, the loaded ad account, business and Page lists and the rate-limit counters in session storage until the browser closes, and the interface language, a newer Graph API version learned from Meta and the cached public exchange-rate table in local storage (the last open tab and the spend period stay in the popup's own localStorage).
```

**scripting**
```
Runs a function packaged in the extension in the user's open Facebook tab to find the access token that the page already holds and to read the browser's User-Agent as the page sees it. No remote code. Runs only on Facebook tabs.
```

### Host permission justification (`https://*.facebook.com/*`)
```
Facebook's own domain: the open Facebook tabs the token is read from, Facebook cookies, and GET requests (Meta's Graph API) to graph.facebook.com for the user's profile, ad accounts, ads, businesses and Pages. The permission covers no other site and no <all_urls>; the exchange-rate files and the pictures come from public servers this extension has no host permission for.
```

### Remote code
**Are you using remote code?** No, I am not using remote code.
(No `<script>` or module from outside the package, no `eval`, no `new Function`; fonts and icons are bundled. The manifest CSP is `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src 'self' https://graph.facebook.com https://*.fbcdn.net https://*.fbsbx.com; connect-src https://graph.facebook.com https://open.er-api.com/v6/latest/USD https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json`. Network use, all named in that CSP: Meta's Graph API (GET requests, `connect-src`), Meta's image CDN for pictures (`img-src`; also the Graph address of a Page's public picture, which redirects to the CDN), and two public exchange-rate files (data parsed as JSON and used as numbers, never code), at most one download per day and only while a total adds up two or more currencies.)

### Data usage
Tick these:

| Category | Why |
|---|---|
| Authentication information | Facebook access token and session cookies are read, shown and copied on request |
| Personally identifiable information | The profile name and user ID (Check, c_user), the names and IDs of the profile's businesses and Pages and the names of ad accounts and ads are shown; the profile name and Business Managers are also copied with "Token + cookies + UA" |
| Financial and payment information | Ad account spend, balance, billing threshold, spend cap and the payment-method label are shown |

Leave unticked: Health information, Personal communications, Location, Web history, User activity. Website content is not collected: the Facebook page is scanned only to find the token, nothing else from it is kept (tick it too only if you want to be maximally conservative).

Certifications: tick all three (does not sell user data; does not use or transfer it for unrelated purposes; does not use it for creditworthiness or lending). All three are true: no data about the user leaves the browser except the read requests to Meta's own API. The exchange-rate files and the pictures are public downloads that carry no user data; those servers see an IP address, like any website.

### Disclaimer text (also used at the end of the description)
```
Ads Helper is an independent product. It is not affiliated with, endorsed by or sponsored by Meta Platforms, Inc. Facebook and Meta are trademarks of Meta Platforms, Inc.
```

---

## Distribution tab
- Visibility: Public (or Unlisted for a first run — unlisted still goes through the same review)
- Regions: all regions
- Trader declaration: choose honestly. A free extension without commercial activity is normally a non-trader; if you sell services around it, declare trader.
