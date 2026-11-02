// Shared names/labels for the CRM UI (single place to rename things).
export const RECURRING_TAB = "Recurring"; // Quote Viewed + Email Viewed activity tab

/** Priority names live in priority_labels (per company). These colors are only for the chip and circles. */

export const BANNERS = {
  followUp: { label: "Follow Up", color: "#dc2626" },
  quoteViewed: { label: "Quote Viewed", color: "#7c3aed" },
  emailViewed: { label: "Email Viewed", color: "#0f766e" },
  assign: { label: "Assign New Estimate", color: "#2563eb" },
  newLead: { label: "New Lead", color: "#ea580c" },
  esignContract: { label: "E-sign", color: "#15803d" },
  esignCc: { label: "CC E-sign", color: "#65a30d" },
  /** Carrier assigned on a booked job. Keeps scrolling until someone opens that lead. */
  jobAssigned: { label: "Job Assigned", color: "#0369a1" },
  /** Vehicle delivered and the carrier still owes us. Keeps scrolling until the carrier's payment is entered. */
  carrierOwes: { label: "Carrier owes us money", color: "#b45309" },
  /** Inbox watch: a Fast Break payment email (customer or carrier) arrived. */
  paymentReceived: { label: "Payment received", color: "#16a34a" },
  /** Central Dispatch: vehicle picked up (message carries the job number). */
  customerPickup: { label: "Customer pickup", color: "#1d4ed8" },
  /** Central Dispatch: vehicle delivered (message carries the job number). */
  customerDelivered: { label: "Customer delivered", color: "#9333ea" },
  /** Booked job, still no carrier 2 days after the pickup window ended. Stays until a carrier is assigned or the pickup dates change. */
  needsCarrier: { label: "Needs carrier", color: "#be123c" },
  /** Carrier paid what it owed (manual "Carrier paid" or inbox watch). Every admin/supervisor; clears per admin on view. */
  carrierPaid: { label: "Carrier paid", color: "#047857" },
  chargeback: { label: "Chargeback", color: "#b91c1c" },
} as const;

export type BannerKey = keyof typeof BANNERS;

/** Each banner crosses once in about 7 seconds and stops in the center. It does not loop. */
export const BANNER_TRAVEL_MS = 7000;

/** Follow Up and New Lead come from the right. Assign comes from the left. The two e-sign greens travel opposite ways. */
export const BANNER_DIRECTION: Record<BannerKey, "ltr" | "rtl"> = {
  followUp: "rtl",
  quoteViewed: "ltr",
  emailViewed: "rtl",
  assign: "ltr",
  newLead: "rtl",
  esignContract: "ltr",
  esignCc: "rtl",
  jobAssigned: "ltr",
  carrierOwes: "rtl",
  paymentReceived: "ltr",
  customerPickup: "ltr",
  customerDelivered: "rtl",
  needsCarrier: "ltr",
  carrierPaid: "ltr",
  chargeback: "ltr",
};

export function bannerCountLabel(text: string, n: number): string {
  return `${text} (${n})`;
}

/** Notification kinds written to crm_notifications -> banner they belong to. */
export const KIND_TO_BANNER: Record<string, BannerKey> = {
  quote_viewed: "quoteViewed",
  email_viewed: "emailViewed",
  new_lead: "newLead",
  unassigned_lead: "assign",
  contract_signed: "esignContract",
  cc_signed: "esignCc",
  job_assigned: "jobAssigned",
  carrier_owes: "carrierOwes",
  payment_received: "paymentReceived",
  customer_pickup: "customerPickup",
  customer_delivered: "customerDelivered",
  needs_carrier: "needsCarrier",
  carrier_paid: "carrierPaid",
  chargeback: "chargeback",
};
/** Banners that keep scrolling (loop) until the lead itself is opened, not when the panel opens. */
export const UNTIL_LEAD_OPENED: ReadonlySet<BannerKey> = new Set<BannerKey>(["jobAssigned"]);
/**
 * Banners that clear for EACH admin when that admin views them (opens the banner panel or opens the
 * lead). Each admin has their own row, so one admin viewing never clears it for another (Owner 2026-10-31).
 * Carrier owes also clears for everyone once the carrier's payment is entered.
 */
export const CLEAR_ON_VIEW: ReadonlySet<BannerKey> = new Set<BannerKey>(["paymentReceived", "customerPickup", "customerDelivered", "carrierOwes", "carrierPaid"]);
/** Kept for older imports: no banner waits only for the carrier's payment any more (carrierOwes clears on view). */
export const UNTIL_CARRIER_PAID: ReadonlySet<BannerKey> = new Set<BannerKey>();
/** Never clears on view: only when a carrier is assigned or the pickup window dates change (server dismisses). */
export const UNTIL_CARRIER_OR_DATES: ReadonlySet<BannerKey> = new Set<BannerKey>(["needsCarrier"]);
/** Opening the panel never clears these. */
export const STICKY_BANNERS: ReadonlySet<BannerKey> = new Set<BannerKey>([...UNTIL_LEAD_OPENED, ...UNTIL_CARRIER_OR_DATES]);
/** Notification kinds where a manager on a lead page keeps their OWN rows (so their view clears their row). */
export const PER_VIEWER_KINDS: ReadonlySet<string> = new Set(["job_assigned", "payment_received", "customer_pickup", "customer_delivered", "carrier_owes", "needs_carrier", "carrier_paid", "chargeback"]);
/** Opening a lead clears that lead's rows for these banners (in addition to the panel for CLEAR_ON_VIEW). */
export const CLEAR_ON_LEAD_OPEN: ReadonlySet<BannerKey> = new Set<BannerKey>([...UNTIL_LEAD_OPENED, ...CLEAR_ON_VIEW]);

export const RANGES = ["today", "yesterday", "this_week", "last_week", "this_month"] as const;
export type RangeKey = (typeof RANGES)[number];
export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today", yesterday: "Yesterday", this_week: "This Week", last_week: "Last Week", this_month: "This Month",
};

/** [start, end) of a range in the viewer's local time. Weeks start on Sunday. */
export function rangeBounds(range: RangeKey, now = new Date()): [Date, Date] {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const weekStart = add(day, -day.getDay());
  switch (range) {
    case "today": return [day, add(day, 1)];
    case "yesterday": return [add(day, -1), day];
    case "this_week": return [weekStart, add(weekStart, 7)];
    case "last_week": return [add(weekStart, -7), weekStart];
    case "this_month": return [new Date(day.getFullYear(), day.getMonth(), 1), new Date(day.getFullYear(), day.getMonth() + 1, 1)];
  }
}

/** Real Date math: day 0 of next month = last day of this month (handles leap years). */
export { daysInMonth } from "./calendar.ts";

export function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export type EmailKind = "cc_form" | "e_quote" | "booked_esign" | "free_text" | "carrier_confirm";
export const EMAIL_KIND_LABEL: Record<EmailKind, string> = {
  /** Carrier Confirmation: tracked job-number link (time/date/IP), no e-sign. Reports "Email Viewed". */
  carrier_confirm: "Carrier Confirmation",
  cc_form: "CC Form",
  e_quote: "E-Quote",
  booked_esign: "Booked E-Sign",
  free_text: "Free Text",
};

/**
 * Customer letters (draft wording, not yet approved). Quote letters open a landing page;
 * the others are tracked with a pixel. These are not added to EmailKind so the document
 * send (CC form / E-Quote / E-Sign) stays the original three.
 */
export const CUSTOMER_MESSAGE_KINDS = [
  "request_received", "company_intro", "ready_to_book", "flex_pricing",
  "honest_followup", "booked_scheduled", "pickup_confirmed", "hi_lets_chat",
] as const;
export type CustomerMessageKind = (typeof CUSTOMER_MESSAGE_KINDS)[number];
/** Letters that contain the quote. The job-number button, not the pixel, is "Quote viewed". */
export const QUOTE_MESSAGE_KINDS = ["ready_to_book", "hi_lets_chat", "custom_quote"] as const;
export const CUSTOMER_MESSAGE_LABEL: Record<CustomerMessageKind, string> = {
  request_received: "Request received",
  company_intro: "Company intro",
  ready_to_book: "Ready to book",
  flex_pricing: "FLEX pricing",
  honest_followup: "Honest quote follow-up",
  booked_scheduled: "Booked — you're scheduled",
  pickup_confirmed: "Pickup confirmed",
  hi_lets_chat: "Hi, let's chat!",
};

export function isCustomerMessageKind(kind: string | null | undefined): kind is CustomerMessageKind {
  return (CUSTOMER_MESSAGE_KINDS as readonly string[]).includes(String(kind));
}
export function isQuoteMessageKind(kind: string | null | undefined): boolean {
  return (QUOTE_MESSAGE_KINDS as readonly string[]).includes(String(kind));
}
/**
 * Emails sent from other screens (not the Email Center buttons) that are still logged in
 * crm_emails, so they show in the Email Center's Previous Emails with tracking.
 * payment_link: the Stripe payment link emailed from the Payments tab.
 */
export const OTHER_EMAIL_KIND_LABEL: Record<string, string> = { payment_link: "Payment Link", custom_letter: "Email template", custom_quote: "Email template (quote)" };
export function emailKindLabel(kind: string | null | undefined): string {
  const k = String(kind || "");
  return EMAIL_KIND_LABEL[k as EmailKind] || CUSTOMER_MESSAGE_LABEL[k as CustomerMessageKind] || OTHER_EMAIL_KIND_LABEL[k] || k;
}

/** User types (Maintenance). DB role 'salesperson' is shown as "Salesman". */
export type UserType = "salesperson" | "supervisor" | "admin";
export const USER_TYPE_LABEL: Record<UserType, string> = { salesperson: "Salesman", supervisor: "Supervisor", admin: "Admin" };

/** Colors for a stored priority number (chip and Follow-Up circles). null = "No Priority". */
export const PRIORITY_COLORS = ["#26446E", "#B12E39", "#D9822B", "#B8961E", "#6B7280", "#2E7D4F", "#6B4FA0", "#0E7490", "#9D174D"] as const;
export const NO_PRIORITY_COLOR = "#9AA0A6";
export function priorityColor(n: number | null | undefined): string {
  if (n === null || n === undefined) return NO_PRIORITY_COLOR;
  return PRIORITY_COLORS[n] ?? "#374151";
}

/** Methods staff can enter on the Payments tab. Older ACH, Cash, Check, and Other rows still open in the record. */
export const PAYMENT_METHODS = ["Credit Card", "Zelle", "Cash App", "PayPal"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
