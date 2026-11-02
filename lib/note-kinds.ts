// Append-only note sections on a lead (estimate_notes.kind). Owner 2026-10-31: the stack sits under
// Vehicles on Charges in this order. Carrier Info is new (what used to be pasted into Rep Remarks
// + Extra Stop / Notes after assigning on Central Dispatch).
export const NOTE_KINDS = ["rep", "customer", "carrier", "operations", "policy"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const isNoteKind = (k: unknown): k is NoteKind => (NOTE_KINDS as readonly string[]).includes(String(k));

/** Owner's order under Vehicles: Rep, Customer, Carrier, Operation / directions, Company policy. */
export const NOTE_STACK_ORDER: readonly NoteKind[] = NOTE_KINDS;

/** Add-box rows: rep keeps its big box, customer is small, carrier is large enough to read without scrolling. */
export const NOTE_INPUT_ROWS: Record<NoteKind, number> = { rep: 8, customer: 2, carrier: 6, operations: 3, policy: 3 };

/** Latest entries listed under the box. Rep + carrier show the newest one; the rest show ~3. */
export const NOTE_LATEST_LIMIT: Record<NoteKind, number> = { rep: 3, customer: 3, carrier: 1, operations: 3, policy: 3 };
export const latestLimit = (kind: string): number => NOTE_LATEST_LIMIT[kind as NoteKind] ?? 3;

/** "View all notes" appears only when the section has MORE THAN ONE note. */
export const showViewAll = (count: number): boolean => count > 1;

/** Newest-first carrier notes + newest customer remark from estimate_notes rows (any order). */
export function splitSharedNotes(rows: { body: string; kind: string; created_at: string }[]): {
  carrierNotes: { body: string; created_at: string }[]; latestCustomerRemark: string | null;
} {
  const sorted = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const carrierNotes = sorted.filter(r => r.kind === "carrier" && String(r.body || "").trim()).map(r => ({ body: r.body, created_at: r.created_at }));
  const cust = sorted.find(r => r.kind === "customer" && String(r.body || "").trim());
  return { carrierNotes, latestCustomerRemark: cust ? cust.body.trim() : null };
}
