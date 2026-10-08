// Strings of the Pages tab. Plain data plus one addStrings call, so the key-coverage test (test/pure.test.mjs) can load it in Node.
// Keys are "pages.<what>". The generic ones ("search", "refresh", "copied", acc.copyId, next.title) come from i18n.js and
// strings/actions.js and are not repeated here. Wording (design.md §8, review round 1): one short word per idea, "No access" is both a missing
// Advertise task and a page seen only through a business; the fix verbs are Assign me / Publish / Appeal / Set “Use Facebook Page”. Quotes:
// «…» in Russian, “…” in English. Menu paths use the English names of Facebook's own interface (Ads Manager → Ad → Identity → Instagram account).
import { addStrings } from "../i18n.js";

export const STRINGS = {
  ru: {
    "pages.searchAria": "Поиск страниц",
    "pages.wait": "Обновить можно через {n} с", "pages.loaded": "Страниц: {n}", "pages.truncated": " (не все — лимит загрузки)",
    "pages.found": "найдено {n} из {all}", "pages.notAll": " (не все)", "pages.notAllLine": "Показаны не все страницы",
    "pages.updated": "обновлено {t}",
    "pages.loading": "Загрузка страниц…",
    "pages.none": "Страниц нет", "pages.noMatch": "Ничего не найдено", "pages.noName": "Без имени",
    "pages.bmHint": "Часть бизнесов не удалось прочитать — страницы, которые есть только в них, могут не показываться",

    "pages.ready": "Готова",
    "pages.linkPage": "Страница", "pages.linkPageTitle": "Открыть страницу на Facebook",
    "pages.linkSuite": "Business Suite", "pages.linkSuiteTitle": "Открыть в Meta Business Suite",
    "pages.linkBm": "Страницы бизнеса", "pages.linkBmTitle": "Страницы бизнес-портфолио: Business Settings → Pages",

    "pages.kv.ig": "Instagram", "pages.kv.business": "Бизнес", "pages.kv.access": "Твой доступ",
    "pages.ig.real": "Аккаунт @{u}", "pages.ig.realNoName": "Аккаунт", "pages.ig.pbia": "От имени страницы («Use Facebook Page»)", "pages.ig.none": "Нет", "pages.ig.unknown": "Неизвестно",
    "pages.access.via": "Через бизнес — не назначена на тебя", "pages.access.viaUnsure": "Через бизнес — назначение неизвестно",
    "pages.task.ADVERTISE": "Реклама", "pages.task.MANAGE": "Управление", "pages.task.CREATE_CONTENT": "Контент", "pages.task.MODERATE": "Модерация",
    "pages.task.MESSAGING": "Сообщения", "pages.task.ANALYZE": "Аналитика",

    "pages.p.noAccess": "Нет доступа", "pages.p.unpublished": "Не опубликована", "pages.p.noAdv": "Нельзя рекламировать", "pages.p.noIg": "Нет Instagram",
    "pages.noAccessTitle": "В твоём доступе к странице нет задачи «Реклама» (ADVERTISE)",
    "pages.noAccessViaTitle": "Страница видна через бизнес-портфолио, но тебя на неё не назначили — рекламу от её имени не запустить",
    "pages.unpublishedTitle": "Страница не опубликована (is_published = false)",
    "pages.noAdvTitle": "Graph: страницу нельзя продвигать (promotion_eligible = false)",
    "pages.igPbia": "IG от страницы", "pages.igPbiaTitle": "«Use Facebook Page» выбран — Instagram-плейсменты пойдут от имени страницы",
    "pages.igRealTitle": "К странице подключён аккаунт Instagram",
    "pages.igNoneTitle": "У страницы нет аккаунта Instagram. Один раз выбери «Use Facebook Page» в рекламе этой страницы (Ads Manager → Ad → Identity → Instagram account), иначе автозапуски в плейсменты Instagram упадут.",
    "pages.igFix": "Как исправить: в рекламе каждой из этих страниц один раз выбери «Use Facebook Page» (Ads Manager → Ad → Identity → Instagram account), иначе автозапуски в плейсменты Instagram упадут.",
    "pages.igUnknownTitle": "Graph не отдал Instagram-поля для этого токена — про Instagram ничего не известно",
    "pages.fix.assign": "Назначить себя", "pages.fix.assignTitle": "Business Settings → Pages: назначь свой профиль на эту страницу с задачей «Реклама» (если бизнес неизвестен — Business Suite)",
    "pages.fix.publish": "Опубликовать", "pages.fix.publishTitle": "Открыть страницу в Meta Business Suite и опубликовать её там",
    "pages.fix.appeal": "Апелляция", "pages.fix.appealTitle": "Account Quality: ограничения профиля, бизнеса и страниц — апелляцию подают там",
    "pages.fix.ig": "Выбрать «Use Facebook Page»",
  },
  en: {
    "pages.searchAria": "Search pages",
    "pages.wait": "Refresh available in {n} s", "pages.loaded": "Pages: {n}", "pages.truncated": " (not all — load limit)",
    "pages.found": "{n} of {all} found", "pages.notAll": " (not all)", "pages.notAllLine": "Not all pages are shown",
    "pages.updated": "updated {t}",
    "pages.loading": "Loading pages…",
    "pages.none": "No pages", "pages.noMatch": "Nothing found", "pages.noName": "Unnamed",
    "pages.bmHint": "Some businesses couldn't be read, so pages that are only in them may be missing",

    "pages.ready": "Ready",
    "pages.linkPage": "Page", "pages.linkPageTitle": "Open the page on Facebook",
    "pages.linkSuite": "Business Suite", "pages.linkSuiteTitle": "Open in Meta Business Suite",
    "pages.linkBm": "Business pages", "pages.linkBmTitle": "Pages of the business portfolio: Business Settings → Pages",

    "pages.kv.ig": "Instagram", "pages.kv.business": "Business", "pages.kv.access": "Your access",
    "pages.ig.real": "Account @{u}", "pages.ig.realNoName": "Account", "pages.ig.pbia": "Page identity (“Use Facebook Page”)", "pages.ig.none": "None", "pages.ig.unknown": "Unknown",
    "pages.access.via": "Via business — not assigned", "pages.access.viaUnsure": "Via business — assignment unknown",
    "pages.task.ADVERTISE": "Advertise", "pages.task.MANAGE": "Manage", "pages.task.CREATE_CONTENT": "Content", "pages.task.MODERATE": "Moderate",
    "pages.task.MESSAGING": "Messages", "pages.task.ANALYZE": "Insights",

    "pages.p.noAccess": "No access", "pages.p.unpublished": "Unpublished", "pages.p.noAdv": "Can't advertise", "pages.p.noIg": "No Instagram",
    "pages.noAccessTitle": "Your access to this page has no Advertise task (ADVERTISE)",
    "pages.noAccessViaTitle": "The page is visible through a business portfolio, but you are not assigned to it — you can't run ads as this page",
    "pages.unpublishedTitle": "The page is unpublished (is_published = false)",
    "pages.noAdvTitle": "Graph says the page cannot be promoted (promotion_eligible = false)",
    "pages.igPbia": "IG via page", "pages.igPbiaTitle": "“Use Facebook Page” is set — Instagram placements will run as the page",
    "pages.igRealTitle": "An Instagram account is connected to this page",
    "pages.igNoneTitle": "This page has no Instagram account. Choose “Use Facebook Page” once in an ad of this page (Ads Manager → Ad → Identity → Instagram account) — otherwise automated launches to Instagram placements fail.",
    "pages.igFix": "To fix: in an ad of each of these pages choose “Use Facebook Page” once (Ads Manager → Ad → Identity → Instagram account) — otherwise automated launches to Instagram placements fail.",
    "pages.igUnknownTitle": "Graph did not return the Instagram fields for this token — nothing is known about Instagram",
    "pages.fix.assign": "Assign me", "pages.fix.assignTitle": "Business Settings → Pages: assign your profile to this page with the Advertise task (Business Suite if the business is unknown)",
    "pages.fix.publish": "Publish", "pages.fix.publishTitle": "Open the page in Meta Business Suite and publish it there",
    "pages.fix.appeal": "Appeal", "pages.fix.appealTitle": "Account Quality: restrictions of your profile, businesses and pages — appeal there",
    "pages.fix.ig": "Set “Use Facebook Page”",
  },
};
addStrings(STRINGS);
