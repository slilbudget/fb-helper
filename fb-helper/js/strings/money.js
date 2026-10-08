// Strings of the money lines (js/money-core.js: the tooltip and the rates note of a total that adds up several currencies).
// Plain data + one addStrings call, so test/pure.test.mjs can load it in Node. Keys: "money.<what>".
// The attribution text "Rates By Exchange Rate API" is a name, not a sentence: money-core.js appends it as it is, in both languages.
import { addStrings } from "../i18n.js";

export const STRINGS = {
  ru: {
    "money.approx": "Примерно: по дневному курсу на {d}.",
    "money.rates": "курс {d}",
  },
  en: {
    "money.approx": "Approximate: converted at the daily rate of {d}.",
    "money.rates": "rates {d}",
  },
};
addStrings(STRINGS);
