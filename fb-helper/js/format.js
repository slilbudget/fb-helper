// Number, date and timezone formatting (amounts of money are money-core.js). No DOM, no chrome.*; the UI language comes from i18n.js.

import { t, locale, getLang } from "./i18n.js";

// Meta currencies without a minor-unit offset (amounts are whole units).
const NO_OFFSET = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
export const major = (minor, cur) => Number(minor) / (NO_OFFSET.has(cur) ? 1 : 100);
// Intl formatters are costly to build and run per row on every render (search, sort): one per zone / UI locale, so a language switch
// just starts filling new entries. (Money is money-core.js fmtMoney.)
const dayFmts = new Map(), numFmts = new Map();
export const numFmt = () => { const l = locale(); if (!numFmts.has(l)) numFmts.set(l, new Intl.NumberFormat(l)); return numFmts.get(l); };
export function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? t("ago.now") : m < 60 ? t("ago.min", { n: m }) : t("ago.h", { n: Math.round(m / 60) });
}
// "04.03.2025" in Russian, "Mar 4, 2025" in English (d = YYYY-MM-DD from Graph).
export const fullDate = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(d || "")) return "";
  if (getLang() === "ru") return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
};
// Was ts still today in this timezone? Cached numbers of an earlier day must not pass for today's.
export const sameDay = (tz, ts) => dayIn(tz, ts) === dayIn(tz, Date.now());
function dayIn(tz, ts) {
  let f = dayFmts.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined }); }
    catch { f = new Intl.DateTimeFormat("en-CA"); }
    dayFmts.set(tz, f);
  }
  return f.format(ts);
}
// "29.08" in Russian, "Aug 29" in English (d = YYYY-MM-DD from Graph).
export const shortDate = (d) => {
  if (!d) return "";
  if (getLang() === "ru") return `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
};
// One format for every account timezone: "UTC+3 Kiev", "UTC−3". Meta stores some as city names
// (Europe/Kiev) and some as Etc/GMT±N, whose sign is inverted (Etc/GMT+3 = UTC−3); Intl resolves both.
const tzLabels = new Map();
export function tzLabel(tz) {
  if (!tz) return "";
  if (!tzLabels.has(tz)) tzLabels.set(tz, tzLabelOf(tz));
  return tzLabels.get(tz);
}
function tzLabelOf(tz) {
  let off;
  try {
    off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(Date.now()).find((p) => p.type === "timeZoneName")?.value;
  } catch { return tz; }
  off = (off || "GMT").replace("GMT", "UTC").replace("-", "−");
  off = off.replace(/^UTC\+0$/, "UTC");
  const city = tz.includes("/") && !tz.startsWith("Etc/") ? tz.split("/").pop().replace(/_/g, " ") : "";
  return city ? `${off} ${city}` : off;
}
