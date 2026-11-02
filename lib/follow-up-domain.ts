/**
 * Follow-up priority for a lead/estimate.
 * The number on the lead is estimates.priority (blank, or an integer already stored).
 * The names are per company, in priority_labels. A company with no rows has no names,
 * and a new lead's priority is blank. Labels are not hard-coded here.
 */

export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 9;

/** Omitted on create. A lead starts with no priority. */
export const DEFAULT_PRIORITY = null;

export type PriorityLabel = { number: number; label: string };

/**
 * Seed rows for this Fast Break database (migration 20261027120000_priority_labels.sql).
 * They are editable data, not a fallback when the table is empty.
 */
export const DEFAULT_PRIORITY_SEED: readonly PriorityLabel[] = [
  { number: 1, label: "Quoted" },
  { number: 3, label: "Not interested" },
  { number: 8, label: "Wrong number / bad / discard" },
];

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

/** Rows read from the database. Blank, duplicate, and out-of-range rows are dropped. */
export function priorityLabelsFrom(value: unknown): PriorityLabel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const out: PriorityLabel[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const raw = (row as { number?: unknown }).number;
    const number = typeof raw === "number" ? raw : typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? parseInt(raw.trim(), 10) : NaN;
    const label = clean((row as { label?: unknown }).label);
    if (!Number.isInteger(number) || number < PRIORITY_MIN || number > PRIORITY_MAX || !label || seen.has(number)) continue;
    seen.add(number);
    out.push({ number, label });
  }
  return out.sort((a, b) => a.number - b.number);
}

/** Admin save. Empty is allowed (the company removed every label). Invalid rows throw. */
export function assertPriorityLabels(value: unknown): PriorityLabel[] {
  if (!Array.isArray(value)) throw new Error("Priority list is invalid.");
  const seen = new Set<number>();
  const out: PriorityLabel[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") throw new Error("Each priority needs a number and a label.");
    const raw = (row as { number?: unknown }).number;
    const number = typeof raw === "number" ? raw : typeof raw === "string" && /^-?\d+$/.test(String(raw).trim()) ? parseInt(String(raw).trim(), 10) : NaN;
    if (!Number.isInteger(number) || number < PRIORITY_MIN || number > PRIORITY_MAX) {
      throw new Error(`Priority numbers are ${PRIORITY_MIN}–${PRIORITY_MAX}.`);
    }
    if (seen.has(number)) throw new Error(`Priority ${number} is listed twice.`);
    seen.add(number);
    const label = clean((row as { label?: unknown }).label);
    if (!label) throw new Error(`Priority ${number} needs a label.`);
    out.push({ number, label });
  }
  return out.sort((a, b) => a.number - b.number);
}

/**
 * Blank (null, omitted, or empty text) is unset.
 * A number must be one of this company's labels, or the number already stored on the lead
 * (so an older value with no label can be kept).
 */
export function validatePriority(value: unknown, labels: readonly PriorityLabel[], current?: number | null): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return DEFAULT_PRIORITY;
  let text: string;
  if (typeof value === "string") text = value.trim();
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else throw new Error("Priority must be a number or blank.");
  if (!/^-?\d+$/.test(text)) throw new Error("Priority must be a whole number or blank.");
  const number = parseInt(text, 10);
  if (current !== null && current !== undefined && number === current) return number;
  if (!labels.some(l => l.number === number)) {
    throw new Error("That priority isn't in this company's list. Add it in Maintenance, or leave it blank.");
  }
  return number;
}

export type PriorityStyle = "chip" | "status" | "table" | "menu";

/** Known label, bare number when the company has no name for it, or "No Priority" when blank. */
export function formatPriority(labels: readonly PriorityLabel[], value: number | null | undefined, style: PriorityStyle = "chip"): string {
  if (value === null || value === undefined) return "—";
  const label = labels.find(l => l.number === value)?.label;
  if (style === "table") return label ? `Prior: ${value} · ${label}` : `Prior: ${value}`;
  if (style === "status") return label ? `Priority ${value} · ${label}` : `Priority ${value}`;
  if (style === "menu") return label ? `P${value} — ${label}` : `P${value}`;
  return label ? `P${value} · ${label}` : `P${value}`;
}

export type PriorityChoice = { value: number | null; text: string };

/** The company's labels, plus the lead's current number when it has no label. No "No Priority"
 *  choice (Owner 2026-10-31: removed from the job Priority dropdown). */
export function priorityChoices(labels: readonly PriorityLabel[], current: number | null | undefined): PriorityChoice[] {
  const numbers = labels.map(l => l.number);
  if (typeof current === "number" && Number.isInteger(current) && !numbers.includes(current)) numbers.push(current);
  numbers.sort((a, b) => a - b);
  return numbers.map(n => ({ value: n, text: formatPriority(labels, n, "menu") }));
}

/** Circles: every configured number, plus any number already stored on a lead. */
export function priorityCircleNumbers(labels: readonly PriorityLabel[], values: readonly (number | null | undefined)[]): number[] {
  const set = new Set<number>(labels.map(l => l.number));
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value)) set.add(value);
  }
  return [...set].sort((a, b) => a - b);
}
