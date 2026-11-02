// Vehicle Year / Type pickers (Owner, 2026-10-23). Pure helpers shared by the UI and tests.
//   Year: newest first from (current Chicago year + 1) down to 1950, plus "Other / older" to type
//         any year (e.g. 1932). Stored as-is in the existing integer year column.
//   Type: Sedan, SUV, Pickup, Van, Trailer, ATV, Golf Cart, plus "Other" to type anything
//         (motorcycle, boat…). Stored as free text in the existing vehicle_type column.
export const OLDEST_LISTED_YEAR = 1950;
export const OTHER = "__other";

/** Top of the list = current year + 1 (2026 -> 2027; bumps itself every January). */
export function topYear(todayYmd: string): number {
  return Number(todayYmd.slice(0, 4)) + 1;
}
export function yearOptions(todayYmd: string): string[] {
  const top = topYear(todayYmd);
  return Array.from({ length: top - OLDEST_LISTED_YEAR + 1 }, (_, i) => String(top - i));
}
/** A typed year: 4 digits, 1886 (first car) up to the top of the list. */
export function validTypedYear(text: string, todayYmd: string): boolean {
  if (!/^\d{4}$/.test(text)) return false;
  const y = Number(text);
  return y >= 1886 && y <= topYear(todayYmd);
}
/** Which choice the Year select shows for a saved value ("" | a listed year | OTHER). */
export function yearChoice(year: string, todayYmd: string): string {
  if (!year) return "";
  return yearOptions(todayYmd).includes(year) ? year : OTHER;
}

export const VEHICLE_TYPES = ["Sedan", "SUV", "Pickup", "Van", "Trailer", "ATV", "Golf Cart"] as const;
/** Which choice the Type select shows: a built-in type (case-insensitive) or OTHER for typed text. */
export function typeChoice(type: string): string {
  const t = type.trim();
  if (!t) return "Sedan";
  return VEHICLE_TYPES.find(x => x.toLowerCase() === t.toLowerCase()) ?? OTHER;
}
