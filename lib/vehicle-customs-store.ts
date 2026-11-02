import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { catalogKey, sanitizeCustomItem, type CatalogCustomItem } from "@/lib/vehicle-catalog/names";

export type StoredCustoms = {
  makes: string[];
  models: { makeKey: string; label: string }[];
  types: string[];
};

const EMPTY: StoredCustoms = { makes: [], models: [], types: [] };

/** Office-typed names. Empty when the table is not there yet. Never throws. */
export async function listStoredCustoms(): Promise<StoredCustoms> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("intake_vehicle_customs").select("kind, make_key, value_label").limit(5000);
    if (error || !data) {
      if (error) console.error("[vehicle-catalog] custom names could not be read", error.message);
      return EMPTY;
    }
    const out: StoredCustoms = { makes: [], models: [], types: [] };
    for (const row of data) {
      const label = String(row.value_label || "").trim();
      if (!label) continue;
      if (row.kind === "make") out.makes.push(label);
      else if (row.kind === "type") out.types.push(label);
      else if (row.kind === "model") out.models.push({ makeKey: String(row.make_key || ""), label });
    }
    return out;
  } catch (error) {
    console.error("[vehicle-catalog] custom names could not be read", error instanceof Error ? error.message : "error");
    return EMPTY;
  }
}

/** Remember names a staff member typed. A database miss does not throw. */
export async function storeCustomItems(items: unknown[]): Promise<boolean> {
  const rows = items.slice(0, 20).map(sanitizeCustomItem).filter((item): item is CatalogCustomItem => !!item);
  if (!rows.length) return true;
  try {
    const admin = createSupabaseAdminClient();
    let saved = true;
    for (const item of rows) {
      const { error } = await admin.from("intake_vehicle_customs").insert({
        kind: item.kind,
        make_label: item.make,
        value_label: item.value,
        make_key: catalogKey(item.make),
        value_key: catalogKey(item.value),
        year: item.year,
      });
      if (error && error.code !== "23505") {
        saved = false;
        console.error("[vehicle-catalog] custom name was not saved", error.message);
      }
    }
    return saved;
  } catch (error) {
    console.error("[vehicle-catalog] custom name was not saved", error instanceof Error ? error.message : "error");
    return false;
  }
}
