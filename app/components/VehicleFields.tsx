"use client";

// Year and Vehicle Type. Both are the shared combobox: type to jump to a match, or type a value that is not listed.
import { filterByPrefix } from "@/lib/vehicle-catalog/major-makes";
import { todayChicago } from "@/lib/calendar";
import { VEHICLE_TYPES, validTypedYear, yearOptions } from "@/lib/vehicle-fields";
import { CatalogCombobox } from "./CatalogCombobox";

export function YearSelect({ value, onChange, testId = "veh-year" }: { value: string; onChange: (v: string) => void; testId?: string }) {
  const today = todayChicago();
  const years = yearOptions(today);
  const bad = value.length === 4 && !validTypedYear(value, today);
  return (
    <CatalogCombobox value={value} onChange={next => onChange(next.replace(/\D/g, "").slice(0, 4))}
      getOptions={query => filterByPrefix(years, query.replace(/\D/g, ""))}
      ariaLabel="Year" testId={testId} inputMode="numeric" maxLength={4} invalid={bad}
      title="Pick a year, or type an older one (for example 1932)." />
  );
}

export function TypeSelect({ value, onChange, testId = "veh-type", extraTypes = [], onCustomValue }: {
  value: string; onChange: (v: string) => void; testId?: string;
  /** Types the office typed before. Built-in types stay as they are. */
  extraTypes?: string[];
  onCustomValue?: (value: string) => void;
}) {
  const seen = new Set<string>(VEHICLE_TYPES.map(type => type.toLowerCase()));
  const options: string[] = [...VEHICLE_TYPES];
  for (const extra of extraTypes) {
    const name = extra.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    options.push(name);
  }
  return (
    <CatalogCombobox value={value} onChange={onChange} getOptions={query => filterByPrefix(options, query)}
      ariaLabel="Type" testId={testId} maxLength={60}
      title="Type a type if it is not listed. It is saved for next time."
      onFinished={typed => onCustomValue?.(typed)} />
  );
}
