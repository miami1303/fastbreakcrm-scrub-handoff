// Money as integer cents to avoid floating-point errors (0.1 + 0.2 !== 0.3).
export function toCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).replace(/[$,\s]/g, "");
  if (raw === "") return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(raw) || raw === "-" || raw === ".") return null;
  const negative = raw.startsWith("-");
  const [whole, frac = ""] = raw.replace("-", "").split(".");
  const cents = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -cents : cents;
}

export function centsToNumber(cents: number): number {
  return cents / 100;
}

/** 125000 -> "$1250.00" (template style, no thousands separator). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumCents(values: unknown[]): number {
  return values.reduce<number>((total, v) => total + (toCents(v) ?? 0), 0);
}

/** $1,295.00 (thousands separators) for on-screen prices. */
export function formatCentsComma(cents: number): string {
  return formatCents(cents).replace(/^(-?\$)(\d+)/, (_, a: string, d: string) => a + d.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
}
