/**
 * US phone entry: 303-555-1234 as the user types.
 * Digits only, 10 max. A leading country code 1 is removed
 * (1-303-555-1234, +1 303…, 13035551234). A finished 10-digit
 * value is left intact so an older saved number is not shortened.
 */

/** Digits to keep (max 10), with one leading country-code 1 removed. */
export function phoneDigits(input: string | null | undefined): string {
  let d = String(input ?? "").replace(/\D/g, "");
  const country = d.startsWith("1") && (d.length === 11 || d.length > 11 || (d.length > 0 && d.length < 10));
  if (country) d = d.slice(1);
  return d.slice(0, 10);
}

/** Format whatever the user typed or pasted. Empty when nothing but a country code remains. */
export function formatPhone(input: string | null | undefined): string {
  const d = phoneDigits(input);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Value to show and to save. A number becomes 303-555-1234.
 * Text with no digits (an old note in the phone column) is kept so it still displays and saves.
 */
export function phoneForField(input: string | null | undefined): string {
  const raw = String(input ?? "").trim();
  const formatted = formatPhone(raw);
  if (formatted) return formatted;
  if (/[A-Za-z]/.test(raw) && !/\d/.test(raw)) return raw;
  return "";
}

/** Caret sits just after this many digits in a formatted number. */
export function phoneCaret(formatted: string, keptDigitsBefore: number): number {
  if (keptDigitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    const c = formatted.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      seen++;
      if (seen === keptDigitsBefore) return i + 1;
    }
  }
  return formatted.length;
}

/** How many kept digits sit before the caret in the raw input (after the country-code rule). */
export function keptDigitsBeforeCaret(raw: string, caret: number): number {
  const all = String(raw ?? "").replace(/\D/g, "");
  const kept = phoneDigits(raw);
  const prefix = String(raw ?? "").slice(0, Math.max(0, caret)).replace(/\D/g, "");
  const dropsLeading = all.startsWith("1") && (all.length === 11 || all.length > 11 || (all.length > 0 && all.length < 10));
  const keptPrefix = dropsLeading && prefix.startsWith("1") ? prefix.slice(1) : prefix;
  return Math.min(keptPrefix.length, kept.length);
}

/** Next input value and caret after a keystroke, paste, or backspace. */
export function formatPhoneEdit(raw: string, caret: number): { value: string; caret: number } {
  const value = formatPhone(raw);
  return { value, caret: phoneCaret(value, keptDigitsBeforeCaret(raw, caret)) };
}
