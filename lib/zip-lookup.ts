// ZIP -> city/state (+ lat/lon for mileage) lookup used by the New Estimate form and the payment billing ZIP.
// Source: api.zippopotam.us (free, keyless, CORS-enabled). If the lookup fails or times out
// the caller falls back to whatever city/state was typed in manually.

export type ZipPlace = { city: string; state: string; lat?: number; lon?: number };

export function isUsZip(zip: unknown): zip is string {
  return typeof zip === "string" && /^\d{5}$/.test(zip.trim());
}

export async function lookupZip(zip: string, timeoutMs = 4000): Promise<ZipPlace | null> {
  if (!isUsZip(zip)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip.trim()}`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const place = data?.places?.[0];
    if (!place) return null;
    const city = String(place["place name"] || "").trim();
    const state = String(place["state abbreviation"] || "").trim();
    const lat = Number(place.latitude), lon = Number(place.longitude);
    return city && state ? { city, state, ...(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : {}) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "123 Main St", "Fort Lauderdale", "FL", "33313" -> "123 Main St, Fort Lauderdale, FL 33313" */
export function composeAddress(street: string, city: string, state: string, zip: string): string {
  const cityState = [city.trim(), state.trim()].filter(Boolean).join(", ");
  const tail = [cityState, zip.trim()].filter(Boolean).join(" ");
  return [street.trim(), tail].filter(Boolean).join(", ");
}
