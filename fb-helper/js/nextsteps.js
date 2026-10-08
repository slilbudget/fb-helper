// "What to do next" for ad accounts and ads: which Facebook page fixes a blocked / unpaid / under-review account or a rejected
// ad, plus one plain-language line saying what it means. accountState() turns an account into what its list row says (the problem
// word, its tone, the one fix and "+N", the group it sorts into). Pure (no DOM, no chrome.*): test/nextsteps.test.mjs walks every row.
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
// (ask Meta to look again, or just check what is wrong). The labels are short verbs (Appeal, Pay, Secure, Support, Assign me): they
// sit on line 2 of a list row.
// nav = a place to look, not a step to take: it is never counted in a row's "+N" and is only the row's fix when nothing else is left
// ("In review" -> Account Quality). assign needs the business, not an ad: accountState calls ACTIONS.assign.url(account, null, business).
export const ACTIONS = {
  review:     { label: "next.review",     url: () => LINKS.accountQuality() },
  requestReview: { label: "next.requestReview", url: () => LINKS.accountQuality() },                    // an active account with a restriction: not an appeal, a request to look again
  quality:    { label: "next.quality",    url: () => LINKS.accountQuality(), nav: true },
  adsManager: { label: "next.adsManager", url: (a) => LINKS.adsManager(a), nav: true },
  billing:    { label: "next.billing",    url: (a) => LINKS.billing(a) },
  pay:        { label: "next.pay",        url: (a) => LINKS.billing(a) },
  secure:     { label: "next.secure",     url: () => LINKS.hacked() },
  support:    { label: "next.support",    url: () => LINKS.support() },
  openAd:     { label: "next.openAd",     url: (a, ad) => LINKS.adsManagerAd(a, ad), nav: true },   // falls back to the account's Ads Manager
  assign:     { label: "next.assign",     url: (_a, _ad, biz) => LINKS.bmAdAccounts(biz) },          // the business's ad accounts page, where you add yourself
};
// The help line of an account the person can only see through a business (not assigned to them).
export const HELP_NO_ACCESS = "next.help.noAccess";

// ---------- the table: first row that matches account_status AND disable_reason wins ----------
// status: codes the row covers. reason: [codes] | ANY (incl. NONE and codes nobody has heard of) | SET (any code but 0 = NONE).
// tone: "bad" | "warn" (same colours as the status pill). help: i18n key. primary: the one button to push (or null: nothing
// to appeal, so no button is pushed). more: further buttons, in this order. A button whose URL is null is dropped.
export const ANY = "*", SET = "!0";
// disable_reason codes that end the account for good: no self-serve appeal (closed, shut down, unused / reseller / umbrella accounts)
export const DEAD_REASONS = [4, 7, 8, 9, 10];
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
  { status: [2], reason: DEAD_REASONS, tone: "bad", help: "next.help.noAppeal", primary: null, more: ["support", "quality"] },   // closed for good: no self-serve appeal
  { status: [2], reason: ANY,  tone: "bad", help: "next.help.r0",  primary: "review", more: ["adsManager"] },     // NONE or a code this table does not know
  // unpaid: the account stops until the balance is paid
  { status: [3, 9], reason: ANY, tone: "warn", help: "next.help.unpaid", primary: "pay", more: [] },
  // the payment is being settled: nothing to pay, only to look at Billing if it takes long
  { status: [8], reason: ANY, tone: "warn", help: "next.help.settling", primary: "billing", more: [] },
  // Meta is looking at it: nothing to push, just wait
  { status: [7], reason: ANY, tone: "warn", help: "next.help.risk", primary: null, more: ["quality"] },
  // being closed / closed
  { status: [100], reason: ANY, tone: "bad", help: "next.help.closing", primary: null, more: ["support"] },
  { status: [101], reason: ANY, tone: "bad", help: "next.help.closed",  primary: null, more: ["support"] },
  // restricted while still active
  { status: [1], reason: SET, tone: "warn", help: "next.help.restricted", primary: "requestReview", more: [] },
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

// ---------- the row of an account ----------
// What the list row says about an account (design.md section 8). Words are i18n keys ({ key, vars? }), never translated here.
//   group   "active" (healthy: a silent row) | "problem" (something to do) | "dead" (closed for good: grey, no fix): the order inside a business
//   tone    "ok" | "warn" | "bad" | "" (grey)
//   word    what the row prints: the problem word REPLACES the status ("Ads policy", not "Disabled · Ads policy")
//   title   [status key, reason key] | null: the tooltip "Disabled: Ads policy"
//   chip    { id, key, vars?, tone }: the status chip that filters the list (one per status, not per reason)
//   help    the plain-language line of the expanded body; actions = every step (the fix first); fix = the one on line 2 (null: none);
//           more = the "+N"; unassigned = the account came only through a business of the person (acc._viaBm), not assigned to them
// "+N" counts further steps and further problems, not the places to look (Ads Manager, Account Quality, the ad): those are in the body.
// An unassigned account is "No access" with "Assign me" when nothing worse is wrong; with a worse problem the problem stays the word and
// "Assign me" becomes one more step. A dead account is not offered an assignment.
const STATUS_WORD = { 1: "status.1", 2: "status.2", 3: "status.3", 7: "status.7", 8: "status.8", 9: "status.9", 100: "status.100", 101: "status.101" };
const STATUS_TONE = { 1: "ok", 2: "bad", 3: "warn", 7: "warn", 8: "warn", 9: "warn", 100: "warn", 101: "" };
const REASON_WORDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

// The "Assign me" step: the page of the business through which the account was read (acc._bmId: for a client account that is the
// person's own business, not the owner), else the account's own business. null when no valid business id is known.
function assignAction(acc, primary) {
  const url = ACTIONS.assign.url(acc?.account_id, null, acc?._bmId ?? acc?.business?.id);
  return url ? { id: "assign", label: ACTIONS.assign.label, url, primary } : null;
}

export function accountState(acc) {
  const status = Number(acc?.account_status), reason = Number(acc?.disable_reason) || 0;
  const steps = accountSteps(acc);
  const reasonKey = REASON_WORDS.has(reason) ? `reason.${reason}` : null;
  const statusKey = STATUS_WORD[status] || null;
  let group = "problem", tone = "warn", word, title = null, chip, help = steps.help;

  if (!statusKey) {                                                    // a status code this table does not know
    const n = acc?.account_status ?? "?";
    word = { key: "status.other", vars: { n } };
    chip = { id: `s${n}`, key: "status.other", vars: { n }, tone: "warn" };
  } else if (status === 1 && !reason) {                               // healthy
    group = "active"; tone = "ok"; word = { key: statusKey };
    chip = { id: "active", key: statusKey, tone: "ok" };
  } else if (status === 1) {                                           // active, but Meta put a restriction on it
    word = { key: "status.restricted" };
    title = reasonKey ? ["status.restricted", reasonKey] : null;
    chip = { id: "restricted", key: "status.restricted", tone: "warn" };
  } else {
    group = status === 101 || (status === 2 && DEAD_REASONS.includes(reason)) ? "dead" : "problem";
    tone = group === "dead" ? "" : STATUS_TONE[status];
    // The reason replaces "Disabled" (it says more); with none (or an unknown code) it is a plain "Disabled".
    const byReason = status === 2 && reasonKey;
    word = { key: byReason ? reasonKey : statusKey };
    if (byReason) title = ["status.2", reasonKey];
    chip = { id: String(status), key: statusKey, tone: STATUS_TONE[status] };
  }

  const actions = [...steps.actions];
  const unassigned = !!acc?._viaBm;
  if (unassigned && group !== "dead") {
    const assign = assignAction(acc, !actions.length);
    if (assign) actions.push(assign);
    if (group === "active") {                                          // nothing worse: "No access" is the row's one problem
      group = "problem"; tone = "warn"; word = { key: "acc.noAccess" };
      chip = { id: "noaccess", key: "acc.noAccess", tone: "warn" };
    }
    help = help || HELP_NO_ACCESS;
  }
  const nav = (a) => !!ACTIONS[a.id]?.nav;
  const fix = group === "dead" ? null : actions.find((a) => a.primary) || actions.find((a) => !nav(a)) || actions[0] || null;
  const more = group === "dead" ? 0 : actions.filter((a) => a !== fix && !nav(a)).length;
  return { group, tone, word, title, chip, help, actions, fix, more, unassigned };
}
