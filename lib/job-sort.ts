// Sort orders for the menu result tables (pure; client and server).
type Sortable = { job_number: string | null; primary_date: string | null; total: number | null; follow_up_at: string | null; priority: number | null; created_at?: string | null };
export type SortKey = "job" | "jobAsc" | "pickup" | "total" | "followUp" | "priority";
export function rowSorter(sort: string) {
  const s = (a: string | null | undefined) => a || "\uffff";
  return (a: Sortable, b: Sortable) => {
    switch (sort) {
      case "pickup": return s(a.primary_date).localeCompare(s(b.primary_date));
      case "total": return (b.total ?? -1) - (a.total ?? -1);
      // Dated first (soonest first); undated after them, by priority (0 first, No Priority last),
      // then newest first.
      case "followUp": return s(a.follow_up_at).localeCompare(s(b.follow_up_at)) || (a.priority ?? 99) - (b.priority ?? 99)
        || (b.created_at || "").localeCompare(a.created_at || "") || s(b.job_number).localeCompare(s(a.job_number), undefined, { numeric: true });
      // Oldest first (job numbers are issued in date order): the priority bubbles use this.
      case "jobAsc": return s(a.job_number).localeCompare(s(b.job_number), undefined, { numeric: true });
      case "priority": return (a.priority ?? 99) - (b.priority ?? 99);
      default: return s(b.job_number).localeCompare(s(a.job_number), undefined, { numeric: true });
    }
  };
}

