// Card type from the card NUMBER PREFIX only (deterministic; never a guess).
//   Visa        4                              13, 16 or 19 digits, CVV 3
//   Mastercard  51-55, 2221-2720               16 digits,           CVV 3
//   Amex        34, 37                         15 digits,           CVV 4
//   Discover    6011, 65, 644-649              16 digits,           CVV 3
export const CARD_TYPE_OPTIONS = ["Visa", "Mastercard", "Amex", "Discover"] as const;
export type CardType = (typeof CARD_TYPE_OPTIONS)[number];

export const CARD_RULES: Record<CardType, { lengths: number[]; cvv: number }> = {
  Visa: { lengths: [13, 16, 19], cvv: 3 },
  Mastercard: { lengths: [16], cvv: 3 },
  Amex: { lengths: [15], cvv: 4 },
  Discover: { lengths: [16], cvv: 3 },
};

const digitsOnly = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export function detectCardType(number: unknown): CardType | null {
  const n = digitsOnly(number);
  if (!n) return null;
  if (/^4/.test(n)) return "Visa";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^5[1-5]/.test(n)) return "Mastercard";
  const p4 = Number(n.slice(0, 4));
  if (n.length >= 4 && p4 >= 2221 && p4 <= 2720) return "Mastercard";
  if (/^6011/.test(n) || /^65/.test(n)) return "Discover";
  const p3 = Number(n.slice(0, 3));
  if (n.length >= 3 && p3 >= 644 && p3 <= 649) return "Discover";
  return null;
}

/** Normalizes stored/legacy values ("VISA", "MasterCard", "AMEX") to the option list; blank -> null. */
export function normalizeCardType(v: unknown): CardType | null {
  const s = String(v ?? "").trim().toLowerCase();
  return CARD_TYPE_OPTIONS.find(t => t.toLowerCase() === s) || (s === "american express" ? "Amex" : null);
}

/** Soft warnings only (never block saving). Uses the rep's type if set, else the detected one. */
export function cardWarnings(number: unknown, cvv: unknown, selected?: unknown): string[] {
  const n = digitsOnly(number), c = digitsOnly(cvv);
  const type = normalizeCardType(selected) || detectCardType(n);
  if (!type) return [];
  const rule = CARD_RULES[type];
  const out: string[] = [];
  if (n && !rule.lengths.includes(n.length)) out.push(`${type} numbers are usually ${rule.lengths.join(", ")} digits (this one has ${n.length}).`);
  if (c && c.length !== rule.cvv) out.push(`${type} CVV is usually ${rule.cvv} digits (this one has ${c.length}).`);
  const detected = detectCardType(n);
  if (n && detected && normalizeCardType(selected) && detected !== normalizeCardType(selected)) out.push(`The number looks like ${detected}, but ${normalizeCardType(selected)} is selected.`);
  return out;
}

/** Detected type only when the prefix AND the length match a rule (confident); else null. */
export function confidentCardType(number: unknown): CardType | null {
  const n = digitsOnly(number);
  const t = detectCardType(n);
  return t && CARD_RULES[t].lengths.includes(n.length) ? t : null;
}

/**
 * What gets stored (and printed on the CC Auth form):
 *   rep picked a type        -> that type, source "rep" (always wins)
 *   blank + confident match  -> detected type, source "auto"
 *   otherwise                -> blank (null), never a guess
 */
export function resolveCardType(selected: unknown, number: unknown): { type: CardType | null; source: "rep" | "auto" | null } {
  const rep = normalizeCardType(selected);
  if (rep) return { type: rep, source: "rep" };
  const auto = confidentCardType(number);
  return auto ? { type: auto, source: "auto" } : { type: null, source: null };
}
