// Shared calendar math for every date picker and the Operations Calendar.
// Pure calendar dates ("YYYY-MM-DD"), never Date objects with a time zone, so a picked day
// saves as exactly that day. "Today" is the America/Chicago wall-clock date.
import { CRM_TZ } from "./crm-time.ts";

export type YM = { y: number; m: number }; // m is 0-based (0 = January)
export type Cell = { ymd: string; y: number; m: number; d: number; inMonth: boolean; dow: number };

const pad = (n: number) => String(n).padStart(2, "0");

/** Gregorian rule: every 4th year, except centuries, except every 400th (2000 yes, 2100 no). */
export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function daysInMonth(y: number, m: number): number {
  const n = norm({ y, m });
  return n.m === 1 && isLeapYear(n.y) ? 29 : DAYS[n.m];
}

/** Normalizes any month offset (e.g. m = -1 or 14) into a real year/month. */
export function norm({ y, m }: YM): YM {
  const t = y * 12 + m;
  const yy = Math.floor(t / 12);
  return { y: yy, m: t - yy * 12 };
}
/** Unlimited paging: any number of months forward or back, across year boundaries. */
export const addMonths = (ym: YM, n: number): YM => norm({ y: ym.y, m: ym.m + n });

export const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${pad(m + 1)}-${pad(d)}`;

/** "2028-02-29" -> {y, m, d}; null for anything that is not a real calendar date (e.g. 2027-02-29). */
export function parseYmd(s: string | null | undefined): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  if (!r) return null;
  const y = +r[1], m = +r[2] - 1, d = +r[3];
  if (m < 0 || m > 11 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}
export const isValidYmd = (s: string) => parseYmd(s) !== null;

/** Day of week (0 = Sunday) for a calendar date, by Zeller-style arithmetic (no time zones). */
export function dayOfWeek(y: number, m: number, d: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 2 ? y - 1 : y;
  return (((yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m] + d) % 7) + 7) % 7;
}

/** Days since 1970-01-01 for a calendar date (for adding days without Date/time-zone drift). */
export function dayNumber(y: number, m: number, d: number): number {
  const yy = m < 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 10) % 12; // m is 0-based: March = 0 ... February = 11
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
export function fromDayNumber(n: number): { y: number; m: number; d: number } {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 2 : mp - 10;
  return { y: yoe + era * 400 + (m < 2 ? 1 : 0), m, d };
}
export function addDays(s: string, n: number): string {
  const p = parseYmd(s);
  if (!p) return s;
  const r = fromDayNumber(dayNumber(p.y, p.m, p.d) + n);
  return ymd(r.y, r.m, r.d);
}

/** Month grid, Sun-Sat rows; leading/trailing cells belong to the neighbor months. */
export function monthGrid(ym: YM): Cell[][] {
  const { y, m } = norm(ym);
  const first = dayOfWeek(y, m, 1);
  const start = dayNumber(y, m, 1) - first;
  const total = Math.ceil((first + daysInMonth(y, m)) / 7) * 7;
  const weeks: Cell[][] = [];
  for (let i = 0; i < total; i++) {
    const c = fromDayNumber(start + i);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ ymd: ymd(c.y, c.m, c.d), y: c.y, m: c.m, d: c.d, inMonth: c.m === m && c.y === y, dow: i % 7 });
  }
  return weeks;
}

/** Sunday..Saturday week containing the date. */
export function weekRange(s: string): { from: string; to: string } {
  const p = parseYmd(s)!;
  const from = addDays(s, -dayOfWeek(p.y, p.m, p.d));
  return { from, to: addDays(from, 6) };
}

const todayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: CRM_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** Today's date in America/Chicago as "YYYY-MM-DD". */
export function todayChicago(now: number | Date = Date.now()): string {
  return todayFmt.format(new Date(now));
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = ({ y, m }: YM) => `${MONTH_NAMES[norm({ y, m }).m]} ${norm({ y, m }).y}`;
