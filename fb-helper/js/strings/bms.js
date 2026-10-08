// Strings of the Businesses tab (js/bms.js). Plain data + one addStrings call, so test/pure.test.mjs can load it in Node and check
// that every key used anywhere exists in both languages. Keys: "bms.<what>"; the generic ones (copied, ago.*, err.*, search,
// acc.copyId / acc.idCopied / acc.spend / acc.noPeriod / acc.notAllTitle, period.*, next.title) come from the main dictionary.
// Wording (design.md §7 + §8): short words, one word per idea; "бизнес-портфолио" / "business portfolio" is Meta's name for the thing
// and stays in tooltips, where a short word is needed (tab, counts, buttons) it is "бизнесы" / "businesses". "BM" / "БМ" is slang and
// is not used in the interface.
import { addStrings } from "../i18n.js";

export const STRINGS = {
  ru: {
    "bms.search.aria": "Поиск бизнесов",
    "bms.refresh": "Обновить бизнесы и спенд",
    "bms.found": "найдено {n} из {all}", "bms.notAll": " (не все)",
    "bms.loaded": "Бизнесов: {n}", "bms.truncated": " (не все — лимит 4 страницы)", "bms.wait": "Обновить можно через {n} с",
    "bms.accWait": "Кабинеты: обновить можно через {n} с — спенд пока старый",
    "bms.empty": "Бизнесы не загружены — нажми кнопку обновления сверху", "bms.loading": "Загрузка бизнесов…",
    "bms.none": "На этом профиле нет бизнес-портфолио", "bms.noMatch": "Ничего не найдено",
    "bms.noPerm": "Этот токен не читает бизнес-портфолио. Открой вкладку Business Manager или Ads Manager, обнови токен (⟳ на вкладке «Токен») и нажми обновить.",
    "bms.noName": "Без названия", "bms.noSpend": "Спенд берётся из списка кабинетов — он ещё не загружен",
    "bms.settings": "Настройки бизнеса", "bms.openSettings": "Открыть этот бизнес в Business Settings",
    // line 2 of a row: the problem word (the status), the context
    "bms.st.active": "Активен",
    "bms.st.noActive": "Нет активных", "bms.st.noActive.title": "В этом бизнесе есть кабинеты, но ни один не активен (статус Active)",
    "bms.st.none": "Нет кабинетов", "bms.st.none.title": "Среди загруженных на вкладке «Кабинеты» нет кабинетов этого бизнеса",
    "bms.st.unverified": "Не верифицирован", "bms.verTitle": "Верификация бизнеса",
    "bms.accCount": ["кабинет", "кабинета", "кабинетов"], "bms.disabledWord": ["заблокирован", "заблокированы", "заблокированы"],
    "bms.accsPartial": "Список кабинетов загружен не полностью — их может быть больше",
    "bms.unread": "Не удалось прочитать кабинеты этого бизнеса — список может быть неполным",
    // the expanded row
    "bms.kv.accounts": "Кабинеты", "bms.kv.verification": "Верификация", "bms.activeWord": ["активен", "активны", "активны"],
    "bms.show": "Показать кабинеты →", "bms.showTitle": "Открыть вкладку «Кабинеты» с фильтром по этому бизнесу (список загрузится сам)",
    "bms.ver.verified": "Пройдена", "bms.ver.not_verified": "Не пройдена", "bms.ver.pending": "На проверке", "bms.ver.pending_need_more_info": "Нужны данные",
    "bms.ver.pending_submission": "Не отправлена", "bms.ver.ineligible": "Недоступна", "bms.ver.failed": "Не удалась", "bms.ver.rejected": "Отклонена",
    "bms.ver.revoked": "Отозвана", "bms.ver.expired": "Истекла",
    "bms.help.verification": "Причина — в Business Settings → Безопасность. Пройди верификацию бизнеса заново.",
    "bms.help.noActive": "Проверь, почему кабинеты не активны, или добавь новый.",
    "bms.help.none": "Создай кабинет или попроси админа бизнеса дать доступ к существующему.",
    "bms.fix.verify": "Верификация", "bms.fix.verifyTitle": "Business Settings → Безопасность: верификация этого бизнеса",
    "bms.fix.accounts": "Управление кабинетами", "bms.fix.accountsTitle": "Рекламные кабинеты этого бизнеса в Business Settings",
    "bms.fix.create": "Создать кабинет", "bms.fix.createTitle": "Business Settings → Рекламные кабинеты → Добавить: создай рекламный кабинет в этом бизнесе",
  },
  en: {
    "bms.search.aria": "Search businesses",
    "bms.refresh": "Refresh businesses and spend",
    "bms.found": "{n} of {all} found", "bms.notAll": " (not all)",
    "bms.loaded": "Businesses: {n}", "bms.truncated": " (not all — 4-page limit)", "bms.wait": "Refresh available in {n} s",
    "bms.accWait": "Ad accounts: refresh available in {n} s — the spend is still the old one",
    "bms.empty": "Businesses not loaded — press the refresh button above", "bms.loading": "Loading businesses…",
    "bms.none": "No business portfolios on this profile", "bms.noMatch": "Nothing found",
    "bms.noPerm": "This token can't read business portfolios. Open a Business Manager or Ads Manager tab, refresh the token (⟳ on the Token tab) and press refresh.",
    "bms.noName": "No name", "bms.noSpend": "Spend comes from the Ad accounts list, which is not loaded yet",
    "bms.settings": "Business settings", "bms.openSettings": "Open this business in Business Settings",
    // line 2 of a row: the problem word (the status), the context
    "bms.st.active": "Active",
    "bms.st.noActive": "None active", "bms.st.noActive.title": "This business has ad accounts, but none is active (status Active)",
    "bms.st.none": "No ad accounts", "bms.st.none.title": "None of the ad accounts loaded in the Ad accounts tab belongs to this business",
    "bms.st.unverified": "Unverified", "bms.verTitle": "Business verification",
    "bms.accCount": ["ad account", "ad accounts"], "bms.disabledWord": ["disabled", "disabled"],
    "bms.accsPartial": "The ad account list is not complete — there may be more",
    "bms.unread": "Couldn't read the ad accounts of this business — the list may be incomplete",
    // the expanded row
    "bms.kv.accounts": "Ad accounts", "bms.kv.verification": "Verification", "bms.activeWord": ["active", "active"],
    "bms.show": "Show ad accounts →", "bms.showTitle": "Open the Ad accounts tab filtered by this business (the list loads by itself)",
    "bms.ver.verified": "Verified", "bms.ver.not_verified": "Not verified", "bms.ver.pending": "In review", "bms.ver.pending_need_more_info": "More info needed",
    "bms.ver.pending_submission": "Not submitted", "bms.ver.ineligible": "Not eligible", "bms.ver.failed": "Failed", "bms.ver.rejected": "Rejected",
    "bms.ver.revoked": "Revoked", "bms.ver.expired": "Expired",
    "bms.help.verification": "The reason is in Business Settings → Security. Verify the business again.",
    "bms.help.noActive": "Check why the ad accounts are not active, or add a new one.",
    "bms.help.none": "Create an ad account, or ask a business admin to give you access to an existing one.",
    "bms.fix.verify": "Verify", "bms.fix.verifyTitle": "Business Settings → Security: verification of this business",
    "bms.fix.accounts": "Manage ad accounts", "bms.fix.accountsTitle": "Ad accounts of this business in Business Settings",
    "bms.fix.create": "Create account", "bms.fix.createTitle": "Business Settings → Ad accounts → Add: create an ad account in this business",
  },
};
addStrings(STRINGS);
