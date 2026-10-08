// Strings of the shared list row (js/row.js). Plain data + one addStrings call, so test/pure.test.mjs can load it in Node.
// Keys: "row.<what>"; the copy-ID tooltip (acc.copyId), the toast (acc.idCopied) and "What to do" (next.title) are the main
// dictionary's and strings/actions.js's.
import { addStrings } from "../i18n.js";

export const STRINGS = {
  ru: {
    "row.more": "ещё {n}", "row.moreTitle": "Ещё {n} — открой строку, чтобы увидеть все",
  },
  en: {
    "row.more": "+{n} more", "row.moreTitle": "{n} more — open the row to see them all",
  },
};
addStrings(STRINGS);
