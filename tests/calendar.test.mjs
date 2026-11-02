import test from "node:test";
import assert from "node:assert/strict";
import { addDays, addMonths, dayOfWeek, daysInMonth, isLeapYear, monthGrid, monthLabel, parseYmd, todayChicago, weekRange } from "../lib/calendar.ts";

// Operations Calendar and every popup date picker use this one module (lib/calendar.ts).
const cellOf = (grid, ymd) => { for (const [w, row] of grid.entries()) for (const c of row) if (c.ymd === ymd) return { w, c }; return null; };

test("calendar: Feb 2028 has 29 days (leap year)", () => {
  assert.equal(isLeapYear(2028), true);
  assert.equal(daysInMonth(2028, 1), 29);
});
test("calendar: Feb 2027 has 28 days", () => {
  assert.equal(isLeapYear(2027), false);
  assert.equal(daysInMonth(2027, 1), 28);
});
test("calendar: Feb 2100 has 28 days (century, not divisible by 400)", () => {
  assert.equal(isLeapYear(2100), false);
  assert.equal(daysInMonth(2100, 1), 28);
});
test("calendar: Feb 2000 has 29 days (divisible by 400)", () => {
  assert.equal(isLeapYear(2000), true);
  assert.equal(daysInMonth(2000, 1), 29);
});
test("calendar: Dec 2026 -> Jan 2027 rollover (Next Month) and back (Previous Month)", () => {
  assert.deepEqual(addMonths({ y: 2026, m: 11 }, 1), { y: 2027, m: 0 });
  assert.deepEqual(addMonths({ y: 2027, m: 0 }, -1), { y: 2026, m: 11 });
  assert.equal(monthLabel(addMonths({ y: 2026, m: 11 }, 1)), "January 2027");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
test("calendar: paging 30 months forward one click at a time, no limit, grids stay Sun-Sat", () => {
  let ym = { y: 2026, m: 9 };
  for (let i = 1; i <= 30; i++) {
    ym = addMonths(ym, 1);
    const grid = monthGrid(ym);
    assert.ok(grid.length >= 4 && grid.length <= 6);
    for (const row of grid) { assert.equal(row.length, 7); assert.equal(row[0].dow, 0); assert.equal(row[6].dow, 6); }
    assert.equal(grid.flat().filter(c => c.inMonth).length, daysInMonth(ym.y, ym.m));
  }
  assert.deepEqual(ym, { y: 2029, m: 3 }); // Oct 2026 + 30 = Apr 2029
  // and far beyond: 100 years forward and back
  assert.deepEqual(addMonths({ y: 2026, m: 9 }, 1200), { y: 2126, m: 9 });
  assert.deepEqual(addMonths({ y: 2026, m: 9 }, -1200), { y: 1926, m: 9 });
});
test("calendar: leap-day pickup 2028-02-29 lands on the right cell (Tuesday, last week of Feb 2028)", () => {
  const grid = monthGrid({ y: 2028, m: 1 });
  const hit = cellOf(grid, "2028-02-29");
  assert.ok(hit, "cell exists");
  assert.equal(hit.c.inMonth, true);
  assert.equal(hit.c.d, 29);
  assert.equal(hit.c.dow, 2); // Tuesday
  assert.equal(dayOfWeek(2028, 1, 29), 2);
  assert.equal(grid[0][2].ymd, "2028-02-01"); // Feb 1 2028 is a Tuesday
  assert.equal(hit.w, 4);
  // Feb 2027 has no 29th: the cell after Feb 28 2027 is Mar 1 (outside the month)
  const g27 = monthGrid({ y: 2027, m: 1 });
  assert.equal(cellOf(g27, "2027-02-29"), null);
  assert.equal(cellOf(g27, "2027-03-01").c.inMonth, false);
});
test("calendar: weekday math matches known dates (Sun-Sat alignment)", () => {
  assert.equal(dayOfWeek(2026, 9, 23), 5); // Fri Oct 23 2026
  assert.equal(dayOfWeek(2000, 0, 1), 6); // Sat Jan 1 2000
  assert.equal(dayOfWeek(2100, 2, 1), 1); // Mon Mar 1 2100
  assert.deepEqual(weekRange("2026-10-23"), { from: "2026-10-18", to: "2026-10-24" });
  assert.deepEqual(weekRange("2027-01-01"), { from: "2026-12-27", to: "2027-01-02" });
});
test("calendar: today is the America/Chicago calendar date", () => {
  // 2026-10-24 03:30 UTC is still Oct 23 in Chicago (CDT, UTC-5)
  assert.equal(todayChicago(Date.UTC(2026, 9, 24, 3, 30)), "2026-10-23");
  // 2027-01-01 05:59 UTC is Dec 31 in Chicago (CST, UTC-6)
  assert.equal(todayChicago(Date.UTC(2027, 0, 1, 5, 59)), "2026-12-31");
});

// --- popup date picker (app/components/DatePopup.tsx renders monthGrid/addMonths cells with
// data-date = the exact YYYY-MM-DD it saves) ---
test("picker: selecting 2028-02-29 saves 2028-02-29; 2027-02-29 is impossible", () => {
  const cell = cellOf(monthGrid({ y: 2028, m: 1 }), "2028-02-29");
  assert.equal(cell.c.ymd, "2028-02-29");
  assert.deepEqual(parseYmd("2028-02-29"), { y: 2028, m: 1, d: 29 });
  assert.equal(parseYmd("2027-02-29"), null);
  assert.equal(parseYmd("2100-02-29"), null);
  assert.ok(parseYmd("2000-02-29"));
});
test("picker: paging from Dec 2026 to Jan 2027 shows Jan 1 2027 on a Friday", () => {
  const jan = monthGrid(addMonths({ y: 2026, m: 11 }, 1));
  assert.equal(cellOf(jan, "2027-01-01").c.dow, 5);
  assert.equal(jan.flat().filter(c => c.inMonth).length, 31);
});
test("picker: paging 24+ months forward reaches Oct 2028 and still offers valid dates", () => {
  let ym = { y: 2026, m: 9 };
  for (let i = 0; i < 26; i++) ym = addMonths(ym, 1);
  assert.deepEqual(ym, { y: 2028, m: 11 });
  const cells = monthGrid(ym).flat().filter(c => c.inMonth);
  assert.equal(cells[0].ymd, "2028-12-01");
  assert.equal(cells.at(-1).ymd, "2028-12-31");
});

test("calendar: day numbers round-trip every day from 1999 to 2101 (no drift)", async () => {
  const { dayNumber, fromDayNumber } = await import("../lib/calendar.ts");
  assert.equal(dayNumber(1970, 0, 1), 0);
  const start = dayNumber(1999, 0, 1), end = dayNumber(2101, 11, 31);
  let prev = null;
  for (let n = start; n <= end; n++) {
    const c = fromDayNumber(n);
    assert.equal(dayNumber(c.y, c.m, c.d), n);
    if (prev) assert.ok(c.d === prev.d + 1 || (c.d === 1 && prev.d === daysInMonth(prev.y, prev.m)));
    prev = c;
  }
});
