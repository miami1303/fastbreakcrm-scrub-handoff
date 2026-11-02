// Date-range presets in America/Chicago (calendar dates via lib/calendar.ts).
import { addDays, addMonths, daysInMonth, parseYmd, todayChicago, weekRange, ymd } from "./calendar.ts";
import { chicagoToIso } from "./crm-time.ts";

export const RANGE_PRESETS = ["today", "yesterday", "tomorrow", "thisWeek", "lastWeek", "thisMonth", "lastMonth"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const RANGE_PRESET_LABEL: Record<RangePreset, string> = {
  today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow", thisWeek: "This Week (Sun-Sat)", lastWeek: "Last Week (Sun-Sat)", thisMonth: "This Month", lastMonth: "Last Month",
};

/** Inclusive calendar-date range for a preset ("YYYY-MM-DD" .. "YYYY-MM-DD"). */
export function presetRange(p: RangePreset, today = todayChicago()): { from: string; to: string } {
  const t = parseYmd(today)!;
  switch (p) {
    case "today": return { from: today, to: today };
    case "yesterday": { const d = addDays(today, -1); return { from: d, to: d }; }
    case "tomorrow": { const d = addDays(today, 1); return { from: d, to: d }; }
    case "thisWeek": return weekRange(today);
    case "lastWeek": return weekRange(addDays(today, -7));
    case "thisMonth": return { from: ymd(t.y, t.m, 1), to: ymd(t.y, t.m, daysInMonth(t.y, t.m)) };
    case "lastMonth": { const l = addMonths({ y: t.y, m: t.m }, -1); return { from: ymd(l.y, l.m, 1), to: ymd(l.y, l.m, daysInMonth(l.y, l.m)) }; }
  }
}

/** Chicago calendar-date range -> [startIso, endIsoExclusive) instants (DST-aware). */
export function rangeInstants(from: string, to: string): [string, string] {
  const a = parseYmd(from)!, b = parseYmd(addDays(to, 1))!;
  return [chicagoToIso(a.y, a.m, a.d, 0, 0), chicagoToIso(b.y, b.m, b.d, 0, 0)];
}

/** Chicago calendar date ("YYYY-MM-DD") of an instant. */
export function chicagoYmd(iso: string | null | undefined): string {
  return iso ? todayChicago(new Date(iso)) : "";
}
