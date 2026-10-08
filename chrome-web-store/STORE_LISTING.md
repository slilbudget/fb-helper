# Chrome Web Store listing — Ads Helper 2.4.1

Copy each block into the Developer Dashboard. Every statement below matches the code of this version.

## Store listing tab

**Name** (shown from the manifest, max 75): `Ads Helper`

**Summary** (comes from the manifest `description`, max 132 chars; 121 used):
```
Facebook token, session cookies and ad account status. Requests go only to graph.facebook.com, with built-in rate limits.
```

**Category:** Tools (alternative: Workflow & Planning)

**Language:** English (the popup itself is English and Russian; add a Russian description below if you want a Russian listing)

**Detailed description (English):**
```
Ads Helper shows five things about the Facebook profile you are logged in to in this browser: the access token, the session cookies, the status and spend of your ad accounts, its business portfolios (Business Managers) and its Facebook Pages. It is read-only: it never creates, edits or deletes anything in your ads.

WHAT IT DOES
• Token: reads the access token from a Facebook tab you already have open and shows its type (EAAB Ads Manager, EAAG Business Manager, EAAd Events Manager, EAAH Commerce Manager, EAAI Automated Rules). "Check" shows the profile, the app and the permissions behind the token. One click copies it.
• Cookies: the Facebook session cookies of this browser profile, copied together with the User-Agent ("Copy cookies + UA") or as JSON. "Token + cookies + UA" copies the token, the cookies and the browser profile's User-Agent (as the Facebook page sees it) in one block, followed by the profile name and its Business Managers with IDs, after confirming the token belongs to the logged-in user.
• Businesses: the profile's business portfolios (Meta's current name for Business Managers) with picture, verification status, your role, created date, primary page, 2FA type and the number of ad accounts each owns (active and disabled). A click shows those accounts.
• Ad accounts: every ad account the token can see, the profile's own and those of its business portfolios (owned and client, merged; accounts not assigned to you are marked), with status, disable reason, spend for today / yesterday / 7 / 30 days / all time, clicks and CPC, daily limit, billing threshold, payment method label, pixels and business owner. Search; active accounts first, then by spend; one button copies the IDs of all active accounts.
• Ads: the ads of an account with their statuses and review results, every rejection reason with the placement it applies to, disapproved ads first, and each ad's spend, impressions, clicks and CPC for the selected period, including all time.
• Next steps: a blocked, unpaid or under-review account, and a rejected ad, get a link to the Facebook page where you act on it (request a review in Account Quality, pay the balance, secure a hacked profile, contact support), with a plain explanation. The links only open pages in a new tab; the extension changes nothing.
• Pages: the profile's Facebook Pages and those of its business portfolios, with picture, category, followers, published state, promotion eligibility, your ad rights on each, Instagram state and owner business; filters for problems, search, copy IDs, links.
• English and Russian interface.

PRIVACY AND SAFETY
• Everything happens in your browser. There is no developer server, no analytics, no ads, no tracking. Nothing is sent to the developer.
• The only network requests go from your browser to graph.facebook.com (Meta's own API), read-only, and only when you use the extension: on a button press, when you open the Ad accounts, Businesses or Pages tab with nothing loaded yet, or after you reloaded the Facebook page. Opening the popup again or switching tabs sends nothing. Pictures of Pages and businesses are loaded from Meta's image CDN (facebook.com / fbcdn.net, no referrer) only while those rows are shown.
• Built-in limits protect your token: the account, business and Page lists each refresh at most once a minute, one account's ads at most once per 30 seconds, and after a Meta rate-limit error every request pauses for 30 minutes. A dead session stops all requests with that token.
• The token and the cached accounts, businesses and Pages stay in the browser's session storage and disappear when the browser closes; Page access tokens are never requested or stored; cookies and the User-Agent are read live and never stored. The token, cookies and User-Agent reach the clipboard only when you press a copy button.
• No remote code. The source code is open: https://github.com/slilbudget/fb-helper

IMPORTANT
The token and cookies are the keys to your Facebook session. Copy them only to places you trust, and never share them with anyone you do not trust with your account.

Ads Helper is an independent product. It is not affiliated with, endorsed by or sponsored by Meta Platforms, Inc. Facebook and Meta are trademarks of Meta Platforms, Inc.
```

**Detailed description (Russian, optional):**
```
Ads Helper показывает о профиле Facebook, в который вы вошли в этом браузере: токен доступа, cookie сессии, статус и расход рекламных кабинетов, бизнес-портфолио (Business Manager'ы) и Страницы Facebook. Только чтение: ничего не создаёт, не меняет и не удаляет в вашей рекламе.

ЧТО УМЕЕТ
• Токен: читает токен из уже открытой вкладки Facebook и показывает его тип (EAAB, EAAI, EAAG, EAAH, EAAd). «Проверить» показывает профиль, приложение и права токена. Копируется одним кликом.
• Cookie: cookie сессии Facebook этого профиля браузера вместе с User-Agent («Скопировать cookie + UA») или JSON. «Токен + cookie + UA» копирует токен, cookie и User-Agent профиля браузера (как его видит страница Facebook) одним блоком, а в конце — имя профиля и его Business Manager'ы с ID, предварительно убедившись, что токен принадлежит вошедшему пользователю.
• Бизнесы: бизнес-портфолио профиля (Meta называет их Business Manager'ами): картинка, название, ID, статус верификации, ваша роль, дата создания, основная Страница, 2FA и число кабинетов каждого (активных и отключённых). Клик показывает эти кабинеты.
• Кабинеты: все рекламные кабинеты профиля, которые видит токен: свои и кабинеты бизнес-портфолио (владельческие и клиентские, без дублей; не назначенные вам помечаются) со статусом, причиной блокировки, расходом за сегодня / вчера / 7 / 30 дней / всё время, кликами и CPC, дневным лимитом, порогом оплаты, способом оплаты, пикселями и владельцем БМ. Поиск; сначала активные, затем по расходу; одна кнопка копирует ID всех активных кабинетов.
• Объявления: объявления кабинета со статусами и результатом проверки, каждая причина отклонения с плейсментом, отклонённые сверху, и расход, показы, клики и CPC по каждому объявлению за выбранный период, включая всё время.
• Следующие шаги: заблокированный, неоплаченный или проверяемый кабинет и отклонённое объявление получают ссылку на страницу Facebook, где это решается (запрос проверки в Account Quality, оплата баланса, защита взломанного профиля, поддержка), и короткое пояснение. Ссылки только открывают страницы в новой вкладке; расширение ничего не меняет.
• Страницы: Страницы Facebook профиля и его бизнес-портфолио с картинкой, категорией, подписчиками, статусом публикации, возможностью продвижения, вашими правами на рекламу, состоянием Instagram и владельцем; фильтры проблем, поиск, копирование ID, ссылки.
• Интерфейс на русском и английском.

КОНФИДЕНЦИАЛЬНОСТЬ
• Всё происходит в вашем браузере. Нет сервера разработчика, аналитики, рекламы и трекинга. Разработчику ничего не отправляется.
• Единственные запросы идут из браузера на graph.facebook.com (API самой Meta), только на чтение и только когда вы пользуетесь расширением: по кнопке, при открытии вкладок «Кабинеты», «Бизнесы» или «Страницы» без загруженных данных или после перезагрузки страницы Facebook. Повторное открытие окна и переключение вкладок ничего не отправляют. Картинки Страниц и бизнес-портфолио грузятся с CDN Meta (facebook.com / fbcdn.net) без referrer, пока строка на экране.
• Встроенные лимиты берегут токен: список кабинетов, бизнес-портфолио и Страниц — каждый не чаще раза в минуту, объявления кабинета не чаще раза в 30 секунд, после ошибки лимита Meta все запросы стоят 30 минут. Закрытая сессия останавливает запросы с этим токеном.
• Токен, кэш кабинетов, бизнес-портфолио и Страниц лежат в session storage браузера и исчезают при закрытии; токены Страниц не запрашиваются и не сохраняются; cookie и User-Agent читаются каждый раз заново и нигде не хранятся. В буфер обмена токен, cookie и User-Agent попадают только по вашей кнопке копирования.
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
View the status and spend of the ad accounts, and the business portfolios and Facebook Pages, of the Facebook profile the user is logged in to, in one read-only popup. The popup uses the session already open in the browser: it also shows the profile's access token and session cookies and can copy them on request.
```

### Permission justifications

**cookies**
```
Reads the user's own facebook.com cookies to show them in the popup and to copy them when the user presses a button. The c_user cookie also tells the extension that another account logged in, so the previous account's cached data is dropped. Cookies go nowhere except to Facebook itself, attached by the browser to requests to graph.facebook.com.
```

**storage**
```
Keeps the loaded ad account, business and Page lists and the token in session storage until the browser closes, and the interface language and a newer Graph API version learned from Meta in local storage (the last open tab and the spend period stay in the popup's own localStorage).
```

**scripting**
```
Runs a function packaged in the extension in the user's open Facebook tab to find the access token that the page already holds and to read the browser's User-Agent as the page sees it. No remote code. Runs only on Facebook tabs.
```

### Host permission justification (`https://*.facebook.com/*`)
```
Facebook's own domain only: the open Facebook tabs the token is read from, Facebook cookies, and read-only requests to graph.facebook.com for the user's profile, ad accounts, ads, business portfolios and Pages. No other site, no <all_urls>.
```

### Remote code
**Are you using remote code?** No, I am not using remote code.
(No `<script>` or module from outside the package, no `eval`, no `new Function`; fonts and icons are bundled. The manifest CSP is `script-src 'self'; object-src 'none'; connect-src https://graph.facebook.com`.)

### Data usage
Tick these:

| Category | Why |
|---|---|
| Authentication information | Facebook access token and session cookies are read, shown and copied on request |
| Personally identifiable information | The profile name and user ID (Check, c_user), the profile's business portfolio and Page names and IDs, and ad account names are shown; the profile name and Business Managers are also copied with "Token + cookies + UA" |
| Financial and payment information | Ad account spend, billing threshold and the payment-method label are shown |

Leave unticked: Health information, Personal communications, Location, Web history, User activity. Website content is not collected: the Facebook page is scanned only to find the token, nothing else from it is kept (tick it too only if you want to be maximally conservative).

Certifications: tick all three (does not sell user data; does not use or transfer it for unrelated purposes; does not use it for creditworthiness or lending). All three are true: nothing leaves the browser except read requests to Meta's own API.

### Disclaimer text (also used at the end of the description)
```
Ads Helper is an independent product. It is not affiliated with, endorsed by or sponsored by Meta Platforms, Inc. Facebook and Meta are trademarks of Meta Platforms, Inc.
```

---

## Distribution tab
- Visibility: Public (or Unlisted for a first run — unlisted still goes through the same review)
- Regions: all regions
- Trader declaration: choose honestly. A free extension without commercial activity is normally a non-trader; if you sell services around it, declare trader.
