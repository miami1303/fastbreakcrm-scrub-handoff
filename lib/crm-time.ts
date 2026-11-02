/** Every banner/list timestamp is shown in the company time zone, with its label (CDT/CST). */
export const CRM_TZ = "America/Chicago";

const stamp = new Intl.DateTimeFormat("en-US", {
  timeZone: CRM_TZ, month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
});

/** "10/23/2026 02:10 PM CDT" */
export function crmStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(stamp.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}

/** "2026-11-04" -> "11/04/2026" (calendar date, no time zone shift). */
export function crmDate(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** "233 S Wacker Dr, Chicago, IL 60601" -> "Chicago, IL". */
export function cityState(address: string | null | undefined): string {
  const parts = String(address || "").split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  const st = /^([A-Za-z]{2})\b/.exec(parts[parts.length - 1])?.[1]?.toUpperCase() || "";
  const city = parts[parts.length - 2];
  return st ? `${city}, ${st}` : parts.slice(-2).join(", ");
}

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CRM_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Wall-clock parts of an instant in America/Chicago (month is 0-based). */
export function chicagoParts(instant: string | number | Date): { y: number; m: number; d: number; h: number; mi: number } {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(instant)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month - 1, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

/** A date + time typed as America/Chicago wall-clock time -> ISO instant (DST-aware). */
export function chicagoToIso(y: number, m: number, d: number, h: number, mi: number): string {
  const want = Date.UTC(y, m, d, h, mi);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = chicagoParts(t);
    const diff = want - Date.UTC(p.y, p.m, p.d, p.h, p.mi);
    if (!diff) break;
    t += diff;
  }
  return new Date(t).toISOString();
}

const remarkFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
/** Remarks table: MM/DD/YYYY hh:mm:ss AM/PM (America/Chicago). */
export function remarkStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(remarkFmt.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute}:${p.second} ${String(p.dayPeriod).toUpperCase()}`;
}
