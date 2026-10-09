// Strings of the Businesses tab (js/bms.js). Plain data + one addStrings call, so test/pure.test.mjs can load it in Node and check
// that every key used anywhere exists in both languages. Keys: "bms.<what>"; the generic ones (copied, ago.*, err.*, search,
// acc.copyId / acc.idCopied / acc.spend / acc.noPeriod / acc.notAllTitle, period.*, next.title) come from the main dictionary.
// Wording (design.md §7 + §8, review round 1): short words, one word per idea; the thing is "бизнес" / "business" everywhere on screen
// ("бизнес-портфолио" / "business portfolio" is Meta's long name and appears only in a tooltip). "BM" / "БМ" is slang and is not used in the
// interface. Menu paths use the English names of Facebook's own interface (Business Settings → Security): that is what the person sees there.
// The second tab is "Accounts" (EN) / "Кабинеты" (RU).
import { addStrings } from "../i18n.js";

export const STRINGS = {
  ru: {
    "bms.search.aria": "Поиск бизнесов",
    "bms.refresh": "Обновить бизнесы и спенд",
    "bms.found": "найдено {n} из {all}", "bms.notAll": " (не все)",
    "bms.loaded": "Бизнесов: {n}", "bms.truncated": " (не все — лимит загрузки)", "bms.wait": "Обновить можно через {n} с",
    "bms.accWait": "Кабинеты: обновить можно через {n} с — спенд пока не обновлён",
    "bms.loading": "Загрузка бизнесов…",
    "bms.none": "Бизнесов нет", "bms.noMatch": "Ничего не найдено",
    "bms.totalTitle": "Без личных кабинетов",
    "bms.noName": "Без названия", "bms.noSpend": "Спенд берётся из списка кабинетов — он ещё не загружен",
    "bms.settings": "Настройки бизнеса", "bms.openSettings": "Открыть этот бизнес в Business Settings",
    // line 2 of a row: the problem word (the status), the context
    "bms.st.active": "Активен",
    "bms.st.noActive": "Нет активных", "bms.st.noActive.title": "В этом бизнесе есть кабинеты, но ни один не активен (статус Active)",
    "bms.st.none": "Нет кабинетов", "bms.st.none.title": "Среди загруженных на вкладке «Кабинеты» нет кабинетов этого бизнеса",
    "bms.st.unverified": "Не верифицирован", "bms.verTitle": "Верификация бизнеса",
    "bms.st.restricted": "Ограничен", "bms.st.restricted.title": "Meta ограничила этот бизнес: его кабинет отключён с причиной «Правила бизнеса» (BUSINESS_INTEGRITY_RAR)",
    "bms.accCount": ["кабинет", "кабинета", "кабинетов"], "bms.disabledWord": ["заблокирован", "заблокированы", "заблокированы"],
    "bms.accsPartial": "Список кабинетов загружен не полностью — их может быть больше",
    "bms.unread": "Не удалось прочитать кабинеты этого бизнеса — список может быть неполным",
    // the expanded row
    "bms.activeWord": ["активен", "активны", "активны"],
    "bms.show": "Кабинеты →", "bms.showTitle": "Открыть вкладку «Кабинеты» с фильтром по этому бизнесу (список загрузится сам)",
    "bms.ver.verified": "Пройдена", "bms.ver.not_verified": "Не пройдена", "bms.ver.pending": "На проверке", "bms.ver.pending_need_more_info": "Нужны данные",
    "bms.ver.pending_submission": "Не отправлена", "bms.ver.ineligible": "Недоступна", "bms.ver.failed": "Не удалась", "bms.ver.rejected": "Отклонена",
    "bms.ver.revoked": "Отозвана", "bms.ver.expired": "Истекла",
    "bms.help.verification": "Причина — в Business Settings → Security. Пройди верификацию бизнеса заново.",
    "bms.help.restricted": "Реклама в этом бизнесе остановлена. Причина и апелляция — в Account Quality.",
    "bms.help.noActive": "Проверь, почему кабинеты не активны, или добавь новый.",
    "bms.help.none": "Создай кабинет или попроси админа бизнеса дать доступ к существующему.",
    "bms.fix.verify": "Верификация", "bms.fix.verifyTitle": "Business Settings → Security: верификация этого бизнеса",
    "bms.fix.review": "Апелляция", "bms.fix.reviewTitle": "Account Quality: ограничения бизнеса и кнопка «Запросить проверку»",
    "bms.fix.accounts": "Управление кабинетами", "bms.fix.accountsTitle": "Рекламные кабинеты этого бизнеса: Business Settings → Ad accounts",
    "bms.fix.create": "Создать кабинет", "bms.fix.createTitle": "Business Settings → Ad accounts → Add: создай рекламный кабинет в этом бизнесе",
  },
  en: {
    "bms.search.aria": "Search businesses",
    "bms.refresh": "Refresh businesses and spend",
    "bms.found": "{n} of {all} found", "bms.notAll": " (not all)",
    "bms.loaded": "Businesses: {n}", "bms.truncated": " (not all — load limit)", "bms.wait": "Refresh available in {n} s",
    "bms.accWait": "Accounts: refresh available in {n} s — spend not updated yet",
    "bms.loading": "Loading businesses…",
    "bms.none": "No businesses", "bms.noMatch": "Nothing found",
    "bms.totalTitle": "Without personal ad accounts",
    "bms.noName": "No name", "bms.noSpend": "Spend comes from the Accounts list, which is not loaded yet",
    "bms.settings": "Business settings", "bms.openSettings": "Open this business in Business Settings",
    // line 2 of a row: the problem word (the status), the context
    "bms.st.active": "Active",
    "bms.st.noActive": "None active", "bms.st.noActive.title": "This business has ad accounts, but none is active (status Active)",
    "bms.st.none": "No ad accounts", "bms.st.none.title": "None of the ad accounts loaded in the Accounts tab belongs to this business",
    "bms.st.unverified": "Unverified", "bms.verTitle": "Business verification",
    "bms.st.restricted": "Restricted", "bms.st.restricted.title": "Meta restricted this business: an ad account of it is disabled for “Business integrity” (BUSINESS_INTEGRITY_RAR)",
    "bms.accCount": ["ad account", "ad accounts"], "bms.disabledWord": ["disabled", "disabled"],
    "bms.accsPartial": "The ad account list is not complete — there may be more",
    "bms.unread": "Couldn't read the ad accounts of this business — the list may be incomplete",
    // the expanded row
    "bms.activeWord": ["active", "active"],
    "bms.show": "Ad accounts →", "bms.showTitle": "Open the Accounts tab filtered by this business (the list loads by itself)",
    "bms.ver.verified": "Verified", "bms.ver.not_verified": "Not verified", "bms.ver.pending": "In review", "bms.ver.pending_need_more_info": "More info needed",
    "bms.ver.pending_submission": "Not submitted", "bms.ver.ineligible": "Not eligible", "bms.ver.failed": "Failed", "bms.ver.rejected": "Rejected",
    "bms.ver.revoked": "Revoked", "bms.ver.expired": "Expired",
    "bms.help.verification": "The reason is in Business Settings → Security. Verify the business again.",
    "bms.help.restricted": "Ads in this business are stopped. The cause and the appeal are in Account Quality.",
    "bms.help.noActive": "Check why the ad accounts are not active, or add a new one.",
    "bms.help.none": "Create an ad account, or ask a business admin to give you access to an existing one.",
    "bms.fix.verify": "Verify", "bms.fix.verifyTitle": "Business Settings → Security: verification of this business",
    "bms.fix.review": "Appeal", "bms.fix.reviewTitle": "Account Quality: the restrictions of the business and “Request review”",
    "bms.fix.accounts": "Manage ad accounts", "bms.fix.accountsTitle": "Ad accounts of this business: Business Settings → Ad accounts",
    "bms.fix.create": "Create account", "bms.fix.createTitle": "Business Settings → Ad accounts → Add: create an ad account in this business",
  },
};
addStrings(STRINGS);
