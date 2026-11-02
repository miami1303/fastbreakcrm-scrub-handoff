/** Turn public-catalog and typed names into one dropdown list. */

export function catalogKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function titleCaseCatalogName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return "";

  const hasLower = /[a-z]/.test(name);
  const hasUpper = /[A-Z]/.test(name);
  // "Kia" and "Sea-Doo" are already written the way they should show. All-caps
  // short names (BMW, GMC) stay uppercase below.
  if (hasLower && hasUpper) return name;

  const letterTokens = name.split(/[^A-Za-z0-9]+/).filter((part) => /[A-Za-z]/.test(part));
  const allShort = letterTokens.length > 0 && letterTokens.every((part) => part.length <= 3);
  if (allShort) return name.toUpperCase();
  if (hasLower && !hasUpper) {
    return name
      .split(/([^A-Za-z0-9]+)/)
      .map((part) => (/[A-Za-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join("");
  }

  return name
    .split(/([^A-Za-z0-9]+)/)
    .map((part) => {
      if (!/[A-Za-z]/.test(part)) return part;
      if (part.length <= 3) return part.toUpperCase();
      return part.charAt(0) + part.slice(1).toLowerCase();
    })
    .join("");
}

export function mergeCatalogNames(...groups: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const group of groups) {
    for (const item of group) {
      const label = titleCaseCatalogName(item);
      const key = catalogKey(label);
      if (!key || key.length > 60) continue;
      if (!seen.has(key)) seen.set(key, label);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "en"));
}

export function catalogHas(list: string[], value: string): boolean {
  const key = catalogKey(value);
  if (!key) return false;
  return list.some((item) => catalogKey(item) === key);
}

export function readNhtsaMakeNames(payload: unknown): string[] {
  return readNamedRows(payload, "MakeName");
}

export function readNhtsaModelNames(payload: unknown): string[] {
  return readNamedRows(payload, "Model_Name");
}

function readNamedRows(payload: unknown, field: "MakeName" | "Model_Name"): string[] {
  if (!payload || typeof payload !== "object") return [];
  const results = (payload as { Results?: unknown }).Results;
  if (!Array.isArray(results)) return [];
  const names: string[] = [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const value = (row as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim()) names.push(value);
  }
  return names;
}

export type CatalogCustomKind = "make" | "model" | "type";

export type CatalogCustomItem = {
  kind: CatalogCustomKind;
  value: string;
  make: string;
  year: number | null;
};

export type TypedVehicleNames = {
  year: string;
  make: string;
  model: string;
  type: string;
  makeOptions: string[];
  modelOptions: string[];
  typeOptions: string[];
};

/** Names typed by staff that were not already in the dropdown. */
export function customItemsToStore(vehicles: TypedVehicleNames[]): CatalogCustomItem[] {
  const items: CatalogCustomItem[] = [];
  for (const vehicle of vehicles) {
    const year = Number(vehicle.year);
    const listedYear = Number.isInteger(year) ? year : null;
    const make = vehicle.make.trim();
    const model = vehicle.model.trim();
    const type = vehicle.type.trim();
    if (make && !catalogHas(vehicle.makeOptions, make)) {
      items.push({ kind: "make", value: make, make: "", year: listedYear });
    }
    if (model && make && !catalogHas(vehicle.modelOptions, model)) {
      items.push({ kind: "model", value: model, make, year: listedYear });
    }
    if (type && !catalogHas(vehicle.typeOptions, type)) {
      items.push({ kind: "type", value: type, make: "", year: null });
    }
  }
  return items;
}

export function sanitizeCustomItem(input: unknown): CatalogCustomItem | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "make" && kind !== "model" && kind !== "type") return null;
  const value = titleCaseCatalogName(typeof record.value === "string" ? record.value : "");
  if (!value || value.length > 60 || /[\u0000-\u001F]/.test(value)) return null;
  const make = kind === "model" ? titleCaseCatalogName(typeof record.make === "string" ? record.make : "") : "";
  if (kind === "model" && (!make || make.length > 60)) return null;
  const yearNumber = typeof record.year === "number" ? record.year : Number(record.year);
  const year = Number.isInteger(yearNumber) && yearNumber >= 1900 && yearNumber <= 2100 ? yearNumber : null;
  return { kind, value, make, year };
}
