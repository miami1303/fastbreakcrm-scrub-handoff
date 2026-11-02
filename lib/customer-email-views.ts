// Customer-email view decisions. Pure: no database and no mail.
// Two clocks on purpose:
//   - the existing pixel -> crm_email_events path still uses ignoreOpen (15 seconds)
//   - this module's pixel rule is about 15 seconds, and it writes the new
//     customer_email_view_events table only
// A quote landing button counts immediately unless the browser is a known scanner.
// Redeploy marker for Hobby team (author match).
import { isQuoteMessageKind } from "./crm-constants.ts";
import { clickBase, eventLabel, isPrefetchUA, viewMethod, type ViewLabel } from "./view-tracking.ts";

export const EMAIL_VIEW_GRACE_MS = 15_000;
/**
 * Two writes of the SAME hit (the pixel route stores crm_email_events and this
 * table a moment apart). A later open, such as 20 seconds then 61 seconds, stays two rows.
 */
export const DEDUPE_WINDOW_MS = 5_000;
/** Short cookie so the quote page opened right after the button does not count again. */
export const QUOTE_OPEN_COOKIE = "fb_quote_open";
export const QUOTE_OPEN_MAX_AGE = 60;

export const QUOTE_EMAIL_LINK = "Click your job number {job_number} to view your quote";
export const QUOTE_PAGE_BUTTON = "Click job number {job_number} to view your quote";
export const OTHER_JOB_LINE = "Click your job number {job_number} to view your quote";
export const CARRIER_EMAIL_LINK = "Click on job number to view carrier info";
export const CARRIER_PAGE_BUTTON = "Click on job number to view carrier info";

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Same shape as the other email tokens (24 random bytes, base64url). */
export function newEmailToken(): string {
  // Web Crypto (not node:crypto): this module is also bundled into client components via email-templates.
  const b = globalThis.crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isEmailToken(token: string | null | undefined): boolean {
  return TOKEN_RE.test(String(token || ""));
}

export type ViewDecision = {
  record: boolean;
  reason: "ok" | "bad_token" | "prefetch" | "too_soon";
  event_type: "quote_viewed" | "email_viewed" | null;
};

/**
 * Should this hit be stored?
 * Pixel: ignore a bad token, a known scanner, and anything in the first 15 seconds.
 * Button: ignore a bad token and a known scanner. A fast click still counts.
 */
export function decideEmailView(input: {
  token: string;
  sentAt?: string | null;
  at: number;
  ua?: string | null;
  source: "pixel" | "button";
}): ViewDecision {
  if (!isEmailToken(input.token)) return { record: false, reason: "bad_token", event_type: null };
  if (isPrefetchUA(input.ua)) return { record: false, reason: "prefetch", event_type: null };
  if (input.source === "pixel") {
    const sent = input.sentAt ? Date.parse(input.sentAt) : NaN;
    if (Number.isFinite(sent) && input.at - sent < EMAIL_VIEW_GRACE_MS) {
      return { record: false, reason: "too_soon", event_type: null };
    }
    return { record: true, reason: "ok", event_type: "email_viewed" };
  }
  return { record: true, reason: "ok", event_type: "quote_viewed" };
}

export type ViewRow = {
  email_id: string;
  token: string;
  estimate_id: string;
  event_type: "quote_viewed" | "email_viewed";
  created_at: string;
  user_agent: string | null;
};

/** Row for customer_email_view_events. estimate_id is the lead. */
export function buildViewRow(input: {
  emailId: string;
  token: string;
  estimateId: string;
  eventType: "quote_viewed" | "email_viewed";
  at?: string;
  userAgent?: string | null;
}): ViewRow {
  const ua = String(input.userAgent || "").slice(0, 400).trim();
  return {
    email_id: input.emailId,
    token: input.token,
    estimate_id: input.estimateId,
    event_type: input.eventType,
    created_at: input.at || new Date().toISOString(),
    user_agent: ua || null,
  };
}

/** Replace {merge_fields}. Unknown tokens are left as written so a typo stays visible. */
export function fillMerge(template: string, fields: Record<string, string | null | undefined>): string {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (raw, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) return raw;
    return String(fields[key] ?? "");
  });
}

export type EmailEventHit = {
  id: string;
  email_id: string;
  estimate_id: string;
  event: string;
  created_at: string;
  ip?: string | null;
  detail?: string | null;
};

export type TableEventHit = {
  id: string;
  email_id: string;
  estimate_id: string;
  event_type: "quote_viewed" | "email_viewed";
  created_at: string;
  user_agent?: string | null;
};

export type MergedHit = {
  id: string;
  email_id: string;
  estimate_id: string;
  created_at: string;
  ip: string | null;
  detail: string | null;
  event: string;
  /** Tracking-image hit that only the new table kept (often a mail proxy). */
  automatic: boolean;
};

export function tableHits(rows: { id: string; email_id: string; estimate_id: string; event_type: string; created_at: string; user_agent?: string | null }[] | null | undefined): TableEventHit[] {
  const out: TableEventHit[] = [];
  for (const r of rows || []) {
    if (r.event_type === "quote_viewed" || r.event_type === "email_viewed") {
      out.push({
        id: r.id, email_id: r.email_id, estimate_id: r.estimate_id,
        event_type: r.event_type, created_at: r.created_at, user_agent: r.user_agent,
      });
    }
  }
  return out;
}

/**
 * Recurring list. Keep the crm_email_events row when the new table has the same
 * email within a few seconds (a counted pixel writes both). A hit that only the
 * new table has (about 15 to 60 seconds after the send) stays, and is marked
 * automatic when it came from the pixel.
 */
export function mergeCustomerViews(emailEvents: EmailEventHit[], tableEvents: TableEventHit[], windowMs = DEDUPE_WINDOW_MS): MergedHit[] {
  const base: MergedHit[] = emailEvents.map(e => ({
    id: e.id, email_id: e.email_id, estimate_id: e.estimate_id, created_at: e.created_at,
    ip: e.ip ?? null, detail: e.detail ?? null, event: e.event, automatic: false,
  }));
  const extra: MergedHit[] = [];
  for (const row of tableEvents) {
    const t = Date.parse(row.created_at);
    const dup = base.some(e => e.email_id === row.email_id && Number.isFinite(t) && Math.abs(Date.parse(e.created_at) - t) < windowMs);
    if (dup) continue;
    extra.push({
      id: row.id, email_id: row.email_id, estimate_id: row.estimate_id, created_at: row.created_at,
      ip: null, detail: row.event_type === "quote_viewed" ? "quote_button" : null,
      event: row.event_type, automatic: row.event_type === "email_viewed",
    });
  }
  return [...base, ...extra].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function mergedLabel(kind: string | null | undefined, hit: { event: string; detail?: string | null; automatic?: boolean }): { label: ViewLabel; method: "open" | "click"; automatic: boolean } {
  if (hit.event === "quote_viewed") return { label: "Quote Viewed", method: "click", automatic: false };
  if (hit.event === "email_viewed") return { label: "Email Viewed", method: "open", automatic: true };
  return { label: eventLabel(kind, hit.event, hit.detail), method: viewMethod(hit.event), automatic: !!hit.automatic };
}

export function isPickupConfirm(kind: string | null | undefined): boolean {
  return kind === "pickup_confirmed";
}

/**
 * Links for one customer letter.
 * Only pickup confirmed uses the landing page by default. All other letters (including quote kinds)
 * use a direct job-number link to the document and a tracking pixel.
 * There is no separate reservation page; {reservation_link} is the document URL except on pickup confirmed.
 */
export function messageLinks(kind: string, origin: string, token: string, job: string | null | undefined) {
  const base = origin.replace(/\/$/, "");
  const quote = isQuoteMessageKind(kind);
  const pickup = isPickupConfirm(kind);
  const useLanding = pickup;
  const landing = `${base}/v/${token}`;
  const documentUrl = job ? `${base}/d/${encodeURIComponent(job)}/${token}` : `${base}/d/${token}`;
  return {
    quote,
    pickup,
    landing,
    documentUrl,
    reservationLink: useLanding ? landing : documentUrl,
    links: {
      jobNumberHref: documentUrl,
      quoteLandingHref: useLanding ? landing : null,
      trackingPixelUrl: useLanding ? null : `${base}/api/email/open/${token}`,
      clickBase: clickBase(base, token),
      optOutHref: `${base}/u/${token}`,
    },
  };
}
