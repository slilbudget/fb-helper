// Strings of the "next step" buttons and help lines (nextsteps.js names the keys, accounts.js draws them).
// Plain data + addStrings, so test/pure.test.mjs and test/nextsteps.test.mjs can load it in Node.
// Each help line: what it means in plain words + what to do, ~120 characters at most, no promises about the outcome.
// For the disable reasons whose name does not explain itself (2, 5, 6, 13, 14) Meta publishes no prose: the line says
// which review it is and sends you to Account Quality, which shows the real cause.
import { addStrings } from "../i18n.js";

export const STRINGS = {
  ru: {
    "next.title": "Что делать",
    "next.review": "Запросить проверку", "next.quality": "Account Quality", "next.adsManager": "Ads Manager", "next.billing": "Биллинг",
    "next.pay": "Оплатить баланс", "next.secure": "Защитить профиль", "next.support": "Поддержка", "next.openAd": "Открыть объявление",

    "next.help.r0": "Кабинет заблокирован, причина не названа. В Account Quality видно причину и кнопку апелляции.",
    "next.help.r1": "Нарушение правил рекламы. Подай апелляцию в Account Quality — там видно, что именно нарушено.",
    "next.help.r2": "Остановлен на проверке «Ads IP review». Что не так, видно в Account Quality — оттуда же апелляция.",
    "next.help.r3": "Платёжный риск: Meta сочла оплату подозрительной. Подай апелляцию и проверь способ оплаты в Биллинге.",
    "next.help.r5": "Остановлен на проверке «AFC review». Причину и апелляцию ищи в Account Quality.",
    "next.help.r6": "Остановлен из-за integrity бизнеса (БМ). Причину и апелляцию ищи в Account Quality.",
    "next.help.r11": "Нарушение правил на уровне БМ. В Account Quality видно, что ограничено, и оттуда подаётся апелляция.",
    "next.help.r12": "Meta считает, что данные кабинета или бизнеса искажены. Подай апелляцию в Account Quality.",
    "next.help.r13": "Остановлен: юрлицо отвязано от кабинета. Проверь данные бизнеса и подай апелляцию в Account Quality.",
    "next.help.r14": "Остановлен после проверки переписок в рекламе (thread review). Подай апелляцию в Account Quality.",
    "next.help.r15": "Кабинет скомпрометирован. Сначала защити профиль — пароль и сессии, потом подай апелляцию.",
    "next.help.noAppeal": "Обычно такой кабинет закрыт насовсем, апелляции нет. Глянь Account Quality, если пусто — пиши в поддержку.",
    "next.help.unpaid": "Баланс не оплачен: пока долг не погашен, реклама стоит или скоро встанет. Оплати в Биллинге.",
    "next.help.risk": "Meta проверяет кабинет. Жди: не создавай новые кабинеты и не меняй оплату, пока идёт проверка.",
    "next.help.closing": "Кабинет в очереди на закрытие. Если ты его не закрывал — пиши в поддержку.",
    "next.help.closed": "Кабинет закрыт, обычно насовсем. Если это ошибка — пиши в поддержку.",
    "next.help.restricted": "Кабинет активен, но Meta наложила ограничение. В Account Quality видно какое, там же можно запросить проверку.",
  },
  en: {
    "next.title": "What to do",
    "next.review": "Request review", "next.quality": "Account Quality", "next.adsManager": "Ads Manager", "next.billing": "Billing",
    "next.pay": "Pay balance", "next.secure": "Secure the profile", "next.support": "Support", "next.openAd": "Open ad",

    "next.help.r0": "The account is disabled and no reason is given. Account Quality shows the cause and the appeal button.",
    "next.help.r1": "Ads policy violation. Appeal in Account Quality — it shows what exactly was flagged.",
    "next.help.r2": "Stopped by the “Ads IP review”. Account Quality shows what is wrong and where to appeal.",
    "next.help.r3": "Payment risk: Meta flagged the payment as suspicious. Appeal and check the payment method in Billing.",
    "next.help.r5": "Stopped by the “AFC review”. Look for the cause and the appeal in Account Quality.",
    "next.help.r6": "Stopped over business integrity (BM). Look for the cause and the appeal in Account Quality.",
    "next.help.r11": "Policy violation at the Business Manager level. Account Quality shows what is restricted and takes the appeal.",
    "next.help.r12": "Meta thinks the account or business details are misrepresented. Appeal in Account Quality.",
    "next.help.r13": "Stopped: the legal entity was de-shared from the account. Check the business details, then appeal in Account Quality.",
    "next.help.r14": "Stopped after a review of ad conversations (thread review). Appeal in Account Quality.",
    "next.help.r15": "The account was compromised. Secure the profile first — password and sessions — then appeal.",
    "next.help.noAppeal": "Usually closed for good, with no self-serve appeal. Check Account Quality; if it shows nothing, contact support.",
    "next.help.unpaid": "The balance is unpaid: until it is settled, ads are stopped or about to stop. Pay it in Billing.",
    "next.help.risk": "Meta is reviewing the account. Wait: don't create new accounts or change payment settings meanwhile.",
    "next.help.closing": "The account is queued for closure. If you didn't close it, contact support.",
    "next.help.closed": "The account is closed, usually for good. If it is a mistake, contact support.",
    "next.help.restricted": "The account is active but Meta put a restriction on it. Account Quality shows which; you can request a review.",
  },
};
addStrings(STRINGS);
