import "server-only";
import { NHTSA_MAKE_TYPE_SLUGS } from "./constants";
import { mergeCatalogNames, readNhtsaMakeNames, readNhtsaModelNames } from "./names";

const NHTSA_ROOT = "https://vpic.nhtsa.dot.gov/api/vehicles";
const DAY_MS = 24 * 60 * 60 * 1000;
const FAILURE_MS = 60 * 1000;

type CacheEntry = { at: number; names: string[]; ok: boolean };

let makesCache: CacheEntry | null = null;
const modelsCache = new Map<string, CacheEntry>();

export type NhtsaList = { ok: boolean; names: string[] };

/**
 * All manufacturers NHTSA publishes for cars, trucks, SUVs, motorcycles, buses,
 * and low-speed vehicles. The list is not narrowed by year: NHTSA has no single
 * feed of "every make that existed in this year." Models are year-specific.
 * A failed lookup returns an empty list and never throws.
 */
export async function getNhtsaMakes(now = Date.now()): Promise<NhtsaList> {
  if (makesCache && fresh(makesCache, now)) return { ok: makesCache.ok, names: makesCache.names };

  const payloads = await Promise.all(
    NHTSA_MAKE_TYPE_SLUGS.map((slug) =>
      nhtsaJson(`/GetMakesForVehicleType/${encodeURIComponent(slug)}?format=json`),
    ),
  );
  const names = mergeCatalogNames(...payloads.map((payload) => (payload ? readNhtsaMakeNames(payload) : [])));
  const ok = payloads.some((payload) => payload !== null) && names.length > 0;
  makesCache = { at: now, names: ok ? names : [], ok };
  return { ok, names: ok ? names : [] };
}

/** Models NHTSA has for one make and model year. Empty is a normal answer for older years. */
export async function getNhtsaModels(make: string, year: number, now = Date.now()): Promise<NhtsaList> {
  const cleanMake = make.trim();
  if (!cleanMake || !Number.isInteger(year)) return { ok: true, names: [] };
  const key = `${year}|${cleanMake.toLowerCase()}`;
  const cached = modelsCache.get(key);
  if (cached && fresh(cached, now)) return { ok: cached.ok, names: cached.names };

  const payload = await nhtsaJson(
    `/GetModelsForMakeYear/make/${encodeURIComponent(cleanMake)}/modelyear/${year}?format=json`,
  );
  if (!payload) {
    const missed = { at: now, names: [], ok: false };
    modelsCache.set(key, missed);
    return { ok: false, names: [] };
  }
  const names = mergeCatalogNames(readNhtsaModelNames(payload));
  const hit = { at: now, names, ok: true };
  modelsCache.set(key, hit);
  return { ok: true, names };
}

function fresh(entry: CacheEntry, now: number): boolean {
  const ttl = entry.ok ? DAY_MS : FAILURE_MS;
  return now - entry.at < ttl;
}

async function nhtsaJson(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${NHTSA_ROOT}${path}`, {
      signal: AbortSignal.timeout(12000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      console.error("[vehicle-catalog] NHTSA returned", response.status, "for", path);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error("[vehicle-catalog] NHTSA lookup failed", path, error instanceof Error ? error.message : "error");
    return null;
  }
}
