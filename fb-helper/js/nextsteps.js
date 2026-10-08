// "What to do next" for ad accounts and ads: which Facebook page fixes a blocked / unpaid / under-review account or a rejected
// ad, plus one plain-language line saying what it means. Pure (no DOM, no chrome.*): test/nextsteps.test.mjs walks every row.
//
// Links only. The extension stays read-only: it never appeals, pays or changes anything, it opens the page where YOU do.
// Every URL comes from LINKS (links.js), which checks the ids, so an odd id from Graph gives no button instead of a bad URL.
// The strings are in strings/actions.js (keys next.*); this file only names them.
//
// Meta's codes (AdAccount reference, checked 2026-10-08):
//   account_status  1 ACTIVE, 2 DISABLED, 3 UNSETTLED, 7 PENDING_RISK_REVIEW, 8 PENDING_SETTLEMENT, 9 IN_GRACE_PERIOD, 100 PENDING_CLOSURE, 101 CLOSED
//   disable_reason  0 NONE, 1 ADS_INTEGRITY_POLICY, 2 ADS_IP_REVIEW, 3 RISK_PAYMENT, 4 GRAY_ACCOUNT_SHUT_DOWN, 5 ADS_AFC_REVIEW,
//                   6 BUSINESS_INTEGRITY_RAR, 7 PERMANENT_CLOSE, 8 UNUSED_RESELLER_ACCOUNT, 9 UNUSED_ACCOUNT, 10 UMBRELLA_AD_ACCOUNT,
//                   11 BUSINESS_MANAGER_INTEGRITY_POLICY, 12 MISREPRESENTED_AD_ACCOUNT, 13 AOAB_DESHARE_LEGAL_ENTITY,
//                   14 CTX_THREAD_REVIEW, 15 COMPROMISED_AD_ACCOUNT
// Meta gives no per-code prose, so the help lines for the codes whose name does not explain itself (2, 5, 6, 13, 14) say so and
// point to Account Quality instead of guessing.

import { LINKS } from "./links.js";
import { AD_PROBLEMS } from "./pure.js";

// ---------- the buttons: id → label (i18n key) + where it goes ----------
// url(accountId, adId) → https URL or null (null = the button is dropped). To retarget a button change one line here.
// "review" and "quality" open the same page; they are two buttons because the label says what you do there
// (ask Meta to look again, or just check what is wrong).
export const ACTIONS = {
  review:     { label: "next.review",     url: () => LINKS.accountQuality() },
  quality:    { label: "next.quality",    url: () => LINKS.accountQuality() },
  adsManager: { label: "next.adsManager", url: (a) => LINKS.adsManager(a) },
  billing:    { label: "next.billing",    url: (a) => LINKS.billing(a) },
  pay:        { label: "next.pay",        url: (a) => LINKS.billing(a) },
  secure:     { label: "next.secure",     url: () => LINKS.hacked() },
  support:    { label: "next.support",    url: () => LINKS.support() },
  openAd:     { label: "next.openAd",     url: (a, ad) => LINKS.adsManagerAd(a, ad) },   // falls back to the account's Ads Manager
};

// ---------- the table: first row that matches account_status AND disable_reason wins ----------
// status: codes the row covers. reason: [codes] | ANY (incl. NONE and codes nobody has heard of) | SET (any code but 0 = NONE).
// tone: "bad" | "warn" (same colours as the status pill). help: i18n key. primary: the one button to push (or null: nothing
// to appeal, so no button is pushed). more: further buttons, in this order. A button whose URL is null is dropped.
export const ANY = "*", SET = "!0";
export const ACCOUNT_ROWS = [
  // DISABLED: appeal in Account Quality; Ads Manager next to it to see what is left of the account
  { status: [2], reason: [1],  tone: "bad", help: "next.help.r1",  primary: "review", more: ["adsManager"] },
  { status: [2], reason: [2],  tone: "bad", help: "next.help.r2",  primary: "review", more: ["adsManager"] },
  { status: [2], reason: [5],  tone: "bad", help: "next.help.r5",  primary: "review", more: ["adsManager"] },
  { status: [2], reason: [6],  tone: "bad", help: "next.help.r6",  primary: "review", more: ["adsManager"] },
  { status: [2], reason: [11], tone: "bad", help: "next.help.r11", primary: "review", more: ["adsManager"] },
  { status: [2], reason: [12], tone: "bad", help: "next.help.r12", primary: "review", more: ["adsManager"] },
  { status: [2], reason: [13], tone: "bad", help: "next.help.r13", primary: "review", more: ["adsManager"] },
  { status: [2], reason: [14], tone: "bad", help: "next.help.r14", primary: "review", more: ["adsManager"] },
  { status: [2], reason: [3],  tone: "bad", help: "next.help.r3",  primary: "review", more: ["billing"] },       // payment risk: the payment method matters too
  { status: [2], reason: [15], tone: "bad", help: "next.help.r15", primary: "secure", more: ["review"] },        // compromised: secure the login first, then appeal
  { status: [2], reason: [4, 7, 8, 9, 10], tone: "bad", help: "next.help.noAppeal", primary: null, more: ["support", "quality"] },   // closed for good: no self-serve appeal
  { status: [2], reason: ANY,  tone: "bad", help: "next.help.r0",  primary: "review", more: ["adsManager"] },     // NONE or a code this table does not know
  // unpaid: the account stops until the balance is paid
  { status: [3, 8, 9], reason: ANY, tone: "warn", help: "next.help.unpaid", primary: "pay", more: [] },
  // Meta is looking at it: nothing to push, just wait
  { status: [7], reason: ANY, tone: "warn", help: "next.help.risk", primary: null, more: ["quality"] },
  // being closed / closed
  { status: [100], reason: ANY, tone: "bad", help: "next.help.closing", primary: null, more: ["support"] },
  { status: [101], reason: ANY, tone: "bad", help: "next.help.closed",  primary: null, more: ["support"] },
  // restricted while still active
  { status: [1], reason: SET, tone: "warn", help: "next.help.restricted", primary: "review", more: [] },
];
// Ads in AD_PROBLEMS (DISAPPROVED, WITH_ISSUES): ask for a review, or look at the ad itself.
export const AD_ROW = { primary: "review", more: ["openAd"] };

const reasonMatches = (spec, reason) => (spec === ANY ? true : spec === SET ? reason !== 0 : spec.includes(reason));

// The buttons of a row for one account (and ad). An id that is not plain digits gives no buttons at all: the row is garbage,
// and "Account Quality" has no id of its own to check, so it would otherwise slip through.
function buildActions(row, accountId, adId) {
  if (!LINKS.adsManager(accountId)) return [];
  return [row.primary, ...row.more].filter(Boolean)
    .map((id) => ({ id, label: ACTIONS[id].label, url: ACTIONS[id].url(accountId, adId), primary: id === row.primary }))
    .filter((a) => a.url);
}

const NOTHING = { tone: null, help: null, actions: [] };
// { account_id, account_status, disable_reason } → { tone, help, actions: [{ id, label, url, primary }] }
// A healthy account (ACTIVE, no reason) and a status this table does not know give NOTHING: no guessing at unknown codes.
export function accountSteps(acc) {
  const status = Number(acc?.account_status), reason = Number(acc?.disable_reason) || 0;
  const row = ACCOUNT_ROWS.find((r) => r.status.includes(status) && reasonMatches(r.reason, reason));
  return row ? { tone: row.tone, help: row.help, actions: buildActions(row, acc.account_id) } : { ...NOTHING, actions: [] };
}

// Buttons for one ad of the account: only for a rejected / with-issues ad, otherwise none.
export function adSteps(ad, accountId) {
  return AD_PROBLEMS.includes(ad?.effective_status) ? buildActions(AD_ROW, accountId, ad.id) : [];
}
