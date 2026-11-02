/** Status shown on the lead (Follow-Up while open, JOB BOOKED once booked). */
export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case "booked": return "Booked - Operations";
    case "cancelled": return "CANCELLED";
    case "unassigned": return "Unassigned";
    default: return "Follow-Up";
  }
}
