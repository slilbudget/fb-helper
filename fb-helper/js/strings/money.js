// Strings of the money lines (js/money-core.js: the tooltip and the rates note of a total that adds up several currencies).
// Plain data + one addStrings call, so test/pure.test.mjs can load it in Node. Keys: "money.<what>".
import { addStrings } from "../i18n.js";

export const STRINGS = {
  ru: {
    "money.approx": "Примерно: по дневному курсу на {d}.",
    "money.rates": "курс {d}", "money.more": "ещё {n}",
  },
  en: {
    "money.approx": "Approximate: converted at the daily rate of {d}.",
    "money.rates": "rates {d}", "money.more": "+{n} more",
  },
};
addStrings(STRINGS);
