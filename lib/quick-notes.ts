// Quick Notes (Owner, 2026-10-23): one flat list. Picking one INSERTS it into the remarks box so
// the rep can edit it (e.g. add a follow-up day); clicking Add saves it as a normal note (which
// clears the Follow Up banner like any note).
export const QUICK_NOTES = [
  "Left VM", "Left VM, sent email & text", "No answer, sent email & text", "Disconnected / Wrong Number",
  "Quoted", "Quoted - Follow Up", "Customer checking other options", "Need to confirm with spouse",
  "Not interested", "Awaiting E-sign", "Sent E-sign reminder", "Booked",
] as const;

/** The list shown in every Quick Notes dropdown (exactly QUICK_NOTES). */
export function quickNotesFrom(_saved?: unknown): string[] {
  void _saved;
  return [...QUICK_NOTES];
}

/** Insert a quick note into whatever the rep already typed (own line, no duplicate spacing). */
export function insertQuickNote(current: string, note: string): string {
  const t = current.replace(/\s+$/, "");
  return t ? `${t}\n${note}` : note;
}
