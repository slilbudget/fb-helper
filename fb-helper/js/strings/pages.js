// Strings of the Pages tab. Plain data plus one addStrings call, so the key-coverage test (test/pure.test.mjs) can load it in Node.
// Keys are "pages.<what>". The generic ones ("search", "refresh", "copied", acc.copyId, next.title) come from i18n.js and
// strings/actions.js and are not repeated here. Wording (design.md §8): the tab asks one thing, is the page alive for advertising, so a row says
// Dead / Hidden / No access and nothing else; the fix verbs are Appeal / Publish / Assign me, and Set up for an Instagram account that is not there.
// The chips (Alive · Dead · Hidden · No access) are plural in Russian, the words of a row are not, hence two families: pages.chip.* and pages.p.*.
// Quotes: «…» in Russian, “…” in English. Menu paths use the English names of Facebook's own interface (Ads Manager → Ad → Identity → Instagram account).
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

    "pages.alive": "Живая",
    "pages.linkPage": "Страница", "pages.linkPageTitle": "Открыть страницу на Facebook",
    "pages.linkSuite": "Business Suite", "pages.linkSuiteTitle": "Открыть в Meta Business Suite",

    "pages.kv.reason": "Причина", "pages.kv.ig": "Instagram", "pages.kv.business": "Бизнес",
    "pages.ig.realNoName": "аккаунт", "pages.ig.pbia": "от имени страницы", "pages.ig.none": "нет", "pages.ig.unknown": "неизвестно",

    "pages.chip.alive": "Живые", "pages.chip.dead": "Мёртвые", "pages.chip.hidden": "Скрытые", "pages.chip.noAccess": "Без доступа",
    "pages.p.dead": "Мёртвая", "pages.p.hidden": "Скрыта", "pages.p.noAccess": "Нет доступа",
    "pages.deadTitle": "Meta не разрешает рекламировать эту страницу",
    "pages.hiddenTitle": "Страница не опубликована (is_published = false)",
    "pages.noAccessTitle": "В твоём доступе к странице нет задачи «Реклама» (ADVERTISE)",
    "pages.noAccessViaTitle": "Страница видна через бизнес-портфолио, но тебя на неё не назначили — рекламу от её имени не запустить",
    "pages.igPbiaTitle": "Один раз выбран «Use Facebook Page»: Instagram-плейсменты идут от имени страницы",
    "pages.igRealTitle": "К странице подключён аккаунт Instagram",
    "pages.igNoneTitle": "У страницы нет аккаунта Instagram. Один раз выбери «Use Facebook Page» в рекламе этой страницы (Ads Manager → Ad → Identity → Instagram account), иначе автозапуски в плейсменты Instagram упадут.",
    "pages.igUnknownTitle": "Graph не отдал Instagram-поля для этого токена — про Instagram ничего не известно",
    "pages.fix.assign": "Назначить себя", "pages.fix.assignTitle": "Business Settings → Pages: назначь свой профиль на эту страницу с задачей «Реклама» (если бизнес неизвестен — Business Suite)",
    "pages.fix.publish": "Опубликовать", "pages.fix.publishTitle": "Открыть страницу в Meta Business Suite и опубликовать её там",
    "pages.fix.appeal": "Апелляция", "pages.fix.appealTitle": "Account Quality: ограничения профиля, бизнеса и страниц — апелляцию подают там",
    "pages.fix.ig": "Выбрать",
  },
  en: {
    "pages.searchAria": "Search pages",
    "pages.wait": "Refresh available in {n} s", "pages.loaded": "Pages: {n}", "pages.truncated": " (not all — load limit)",
    "pages.found": "{n} of {all} found", "pages.notAll": " (not all)", "pages.notAllLine": "Not all pages are shown",
    "pages.updated": "updated {t}",
    "pages.loading": "Loading pages…",
    "pages.none": "No pages", "pages.noMatch": "Nothing found", "pages.noName": "Unnamed",
    "pages.bmHint": "Some businesses couldn't be read, so pages that are only in them may be missing",

    "pages.alive": "Alive",
    "pages.linkPage": "Page", "pages.linkPageTitle": "Open the page on Facebook",
    "pages.linkSuite": "Business Suite", "pages.linkSuiteTitle": "Open in Meta Business Suite",

    "pages.kv.reason": "Reason", "pages.kv.ig": "Instagram", "pages.kv.business": "Business",
    "pages.ig.realNoName": "account", "pages.ig.pbia": "runs as the Page", "pages.ig.none": "none", "pages.ig.unknown": "unknown",

    "pages.chip.alive": "Alive", "pages.chip.dead": "Dead", "pages.chip.hidden": "Hidden", "pages.chip.noAccess": "No access",
    "pages.p.dead": "Dead", "pages.p.hidden": "Hidden", "pages.p.noAccess": "No access",
    "pages.deadTitle": "Meta does not allow advertising this page",
    "pages.hiddenTitle": "The page is unpublished (is_published = false)",
    "pages.noAccessTitle": "Your access to this page has no Advertise task (ADVERTISE)",
    "pages.noAccessViaTitle": "The page is visible through a business portfolio, but you are not assigned to it — you can't run ads as this page",
    "pages.igPbiaTitle": "“Use Facebook Page” was chosen once: Instagram placements run as the Page",
    "pages.igRealTitle": "An Instagram account is connected to this page",
    "pages.igNoneTitle": "This page has no Instagram account. Choose “Use Facebook Page” once in an ad of this page (Ads Manager → Ad → Identity → Instagram account) — otherwise automated launches to Instagram placements fail.",
    "pages.igUnknownTitle": "Graph did not return the Instagram fields for this token — nothing is known about Instagram",
    "pages.fix.assign": "Assign me", "pages.fix.assignTitle": "Business Settings → Pages: assign your profile to this page with the Advertise task (Business Suite if the business is unknown)",
    "pages.fix.publish": "Publish", "pages.fix.publishTitle": "Open the page in Meta Business Suite and publish it there",
    "pages.fix.appeal": "Appeal", "pages.fix.appealTitle": "Account Quality: restrictions of your profile, businesses and pages — appeal there",
    "pages.fix.ig": "Set up",
  },
};
addStrings(STRINGS);
