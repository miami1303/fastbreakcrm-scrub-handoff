// Extra charge lines on the quote (pure helpers, safe for client and server).
export type ExtraCharge = { description: string; amount: number };
/** Saved extra charge lines (max 3, positive amounts, description required). */
export function extraChargesFrom(value: unknown): ExtraCharge[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap(x => {
    const d = String((x as ExtraCharge)?.description ?? "").trim();
    const a = Number((x as ExtraCharge)?.amount);
    return d && Number.isFinite(a) && a > 0 ? [{ description: d.slice(0, 80), amount: Math.round(a * 100) / 100 }] : [];
  });
}
