/** How a quote shows the customer, the contact, and labeled phone lines. */

import { phoneForField } from "./phone-format";

/** Phone label choices (Owner 2026-10-31). The dropdown also takes a typed custom label ("Custom…"). */
export const PHONE_LABELS = ["Cust", "Contact", "Dealership", "Auction", "Cell", "Home", "Work", "Other"] as const;

/** A typed custom phone label: trimmed, single-spaced, max 20 chars (the server keeps 20), no ":" (it separates label from number). */
export function cleanPhoneLabel(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[:\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 20);
}

export function nameLines(customer: string | null | undefined, contact: string | null | undefined): string[] {
  const lines: string[] = [];
  const who = String(customer ?? "").trim();
  const contactName = String(contact ?? "").trim();
  if (who) lines.push(who);
  // Same person as the customer (case-insensitive): customer only. Different contact: both lines.
  if (contactName && contactName.toLowerCase() !== who.toLowerCase()) lines.push(contactName);
  return lines;
}

/** "Cell: 312-555-0100", or just the number when no label was saved. Blank number → "". */
export function phoneLine(label: string | null | undefined, number: string | null | undefined): string {
  const raw = String(number ?? "").trim();
  if (!raw) return "";
  const n = phoneForField(raw);
  if (!n) return "";
  const l = String(label ?? "").replace(/\s+/g, " ").trim();
  return l ? `${l}: ${n}` : n;
}

export function phoneLines(phones: { label?: string | null; number?: string | null }[]): string[] {
  return phones.map(p => phoneLine(p.label, p.number)).filter(Boolean);
}
