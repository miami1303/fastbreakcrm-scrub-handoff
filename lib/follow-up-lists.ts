// Follow-Up Menu lists + sorts, shared by the menu (/follow-up) and its results page
// (/follow-up/results).
import type { JobRow } from "@/app/actions/lists";
import { chicagoYmd, presetRange } from "@/lib/date-ranges";
import { isFollowUpDue } from "@/lib/follow-up-rule";
import type { SortKey } from "@/lib/job-sort";

// Owner's order (do not reorder).
export const LISTS = [
  { key: "untouched", label: "New Estimates - Untouched" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "This Week (Sun-Sat)" },
  { key: "lastWeek", label: "Last Week (Sun-Sat)" },
  { key: "all", label: "All Follow-Up Estimates" },
  { key: "past", label: "Update Past Follow-Up Date" },
] as const;
export type ListKey = (typeof LISTS)[number]["key"];
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "followUp", label: "Follow-Up Date" }, { key: "pickup", label: "Pickup Date" }, { key: "job", label: "Job No" }, { key: "total", label: "Total" }, { key: "priority", label: "Priority" },
];

export function inList(key: ListKey, r: JobRow, today: string, now: number): boolean {
  const fu = chicagoYmd(r.follow_up_at);
  const within = (p: Parameters<typeof presetRange>[0]) => { const g = presetRange(p, today); return !!fu && fu >= g.from && fu <= g.to; };
  switch (key) {
    case "untouched": return !r.last_touched_at;
    case "today": return within("today");
    case "tomorrow": return within("tomorrow");
    case "yesterday": return within("yesterday");
    case "thisWeek": return within("thisWeek");
    case "lastWeek": return within("lastWeek");
    case "all": return true;
    case "past": return isFollowUpDue(r.follow_up_at, r.last_touched_at, now);
  }
}

