// View tracking (Owner, 2026-10-23). Every send is a crm_emails row with its own token:
//   - tracking pixel  /api/email/open/<token>  -> event 'opened'  (open)
//   - tracked link    /d/<job>/<token>          -> event 'viewed'  (click; opens the document
//                                                  directly, no job-number prompt)
// Quotes (E-Quote, Booked E-Sign) report "Quote Viewed"; every other email "Email Viewed".
// Customer quote letters (ready_to_book, hi_lets_chat) are NOT in QUOTE_KINDS: a pixel open
// stays "Email Viewed". "Quote Viewed" for those letters is the job-number button
// (detail QUOTE_BUTTON_DETAIL), which is a real click. The 15-second pixel rule below
// is unchanged.
import { isQuoteMessageKind } from "./crm-constants.ts";

export type ViewLabel = "Quote Viewed" | "Email Viewed";
export const QUOTE_KINDS = new Set(["e_quote", "booked_esign"]);
/** crm_email_events.detail when the customer presses the quote landing button. */
export const QUOTE_BUTTON_DETAIL = "quote_button";
export const viewLabel = (kind: string | null | undefined): ViewLabel => (QUOTE_KINDS.has(String(kind)) ? "Quote Viewed" : "Email Viewed");
export const viewMethod = (event: string): "open" | "click" => (event === "opened" ? "open" : "click");
export const notifyKindFor = (kind: string | null | undefined) => (QUOTE_KINDS.has(String(kind)) ? "quote_viewed" : "email_viewed");

/** crm_email_events.detail for a click through /api/email/click/<token>. */
export const LINK_DETAIL = "link:";
export const clickBase = (origin: string, token: string) => `${origin.replace(/\/$/, "")}/api/email/click/${token}`;

/** Opens this soon after the send are usually the mail server / proxy fetching the pixel. */
export const MIN_OPEN_DELAY_MS = 15_000;
// Link scanners / prefetchers that announce themselves. (Gmail's GoogleImageProxy only fetches
// when the message is opened, so it counts; Apple Mail Privacy Protection can't be detected.)
const PREFETCH_UA = /(bot\b|crawler|spider|preview|prefetch|proofpoint|mimecast|barracuda|safelinks|urldefense|scanner)/i;
export function isPrefetchUA(ua: string | null | undefined): boolean {
  return PREFETCH_UA.test(String(ua || ""));
}
/** Should a pixel open be ignored? (too soon after the send, or a known prefetcher). */
export function ignoreOpen(sentAt: string | null | undefined, at: number, ua: string | null | undefined): boolean {
  if (isPrefetchUA(ua)) return true;
  const sent = sentAt ? Date.parse(sentAt) : NaN;
  return Number.isFinite(sent) && at - sent < MIN_OPEN_DELAY_MS;
}

/** Label for one event: a click on a Free Text email's "View your quote" link shows the quote. */
export function eventLabel(kind: string | null | undefined, event: string, detail?: string | null): ViewLabel {
  // A click on any other tracked link (website, images…) is an Email Viewed for non-quote emails.
  if (String(detail || "").startsWith(LINK_DETAIL)) return viewLabel(kind);
  // The quote landing button is a real click. A pixel open of the same letter is not.
  if (event === "viewed" && (detail === QUOTE_BUTTON_DETAIL || isQuoteMessageKind(kind))) return "Quote Viewed";
  return event === "viewed" && kind === "free_text" ? "Quote Viewed" : viewLabel(kind);
}
