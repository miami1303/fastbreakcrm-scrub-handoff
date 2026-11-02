// Lead Source options (rep-side only; never printed on customer documents). Admins add,
// rename or hide options in Maintenance; stored in crm_settings key "lead_sources" as
// [{ label, hidden? }]. The lead keeps the chosen label in estimates.lead_source.
export type LeadSourceOption = { label: string; hidden?: boolean };

export const LEAD_SOURCES_KEY = "lead_sources";
/** Website intake leads are set to this source automatically. */
export const WEB_LEAD_SOURCE = "Web Lead";
export const DEFAULT_LEAD_SOURCES: LeadSourceOption[] = [
  "BBB", "Web Lead", "Referral", "Repeat Customer (used us before)", "Google", "Phone Call", "Social Media", "Purchased Lead", "Other",
].map(label => ({ label }));

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

/** Saved options (or the defaults when nothing is saved). Duplicate / blank labels dropped. */
export function leadSourcesFrom(value: unknown): LeadSourceOption[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_LEAD_SOURCES.map(o => ({ ...o }));
  const seen = new Set<string>();
  return value.flatMap(v => {
    const label = clean(typeof v === "string" ? v : (v as LeadSourceOption)?.label);
    const k = label.toLowerCase();
    if (!label || seen.has(k)) return [];
    seen.add(k);
    return [{ label, ...(typeof v === "object" && (v as LeadSourceOption)?.hidden ? { hidden: true } : {}) }];
  }).slice(0, 50);
}

/** Options a rep can pick: visible ones, plus the lead's current value if it was hidden/renamed. */
export function pickableLeadSources(options: LeadSourceOption[], current?: string | null): string[] {
  const list = options.filter(o => !o.hidden).map(o => o.label);
  const cur = clean(current);
  return cur && !list.some(l => l.toLowerCase() === cur.toLowerCase()) ? [cur, ...list] : list;
}

/** Case-insensitive filter for the type-to-filter dropdown. */
export const filterLeadSources = (list: string[], q: string) => {
  const t = q.trim().toLowerCase();
  return t ? list.filter(l => l.toLowerCase().includes(t)) : list;
};

/** Assign New Estimates portal: which panel an unassigned lead belongs to (by Lead Source). */
export const BOUGHT_LEAD_SOURCE = "Purchased Lead";
export type AssignPanel = "web" | "bought" | "other";
export function assignPanelFor(source: string | null | undefined): AssignPanel {
  const s = String(source || "").trim().toLowerCase();
  if (s === WEB_LEAD_SOURCE.toLowerCase()) return "web";
  if (s === BOUGHT_LEAD_SOURCE.toLowerCase()) return "bought";
  return "other";
}
