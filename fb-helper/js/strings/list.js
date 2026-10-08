// Strings of the empty / error / loading states of the list tabs (js/list-state.js): the same phrases on the Businesses, Ad accounts and Pages
// tabs. Plain data + one addStrings call, so test/pure.test.mjs can load it in Node. Keys: "list.<what>". What a tab calls its things when
// there are none ("No ad accounts") is the tab's own (acc.none, bms.none, pages.none), and "no token" uses the Token tab's own reason.
import { addStrings } from "../i18n.js";

export const STRINGS = {
  ru: {
    "list.retry": "Повторить", "list.load": "Загрузить",
    "list.idle": "Пока не загружено",
    "list.error": "Не удалось загрузить",
    "list.perm": "Этим токеном список не прочитать — открой Ads Manager или Business Manager, обнови токен (кнопка обновления на вкладке «Токен») и повтори.",
  },
  en: {
    "list.retry": "Try again", "list.load": "Load",
    "list.idle": "Not loaded yet",
    "list.error": "Couldn't load",
    "list.perm": "This token can't read the list — open Ads Manager or Business Manager, refresh the token (the refresh button on the Token tab) and try again.",
  },
};
addStrings(STRINGS);
