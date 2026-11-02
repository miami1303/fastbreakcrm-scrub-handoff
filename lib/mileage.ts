// Pickup -> delivery mileage from FREE, keyless sources only:
//   1. ZIP lat/lon from api.zippopotam.us (cached in zip_geo by the server helper).
//   2. Driving distance from the public OSRM demo server (router.project-osrm.org), short timeout.
//   3. If OSRM fails / is rate-limited: straight-line (haversine) x 1.2, marked "(est.)".
// Whole miles.

export type LatLon = { lat: number; lon: number };
export type Miles = { miles: number; source: "osrm" | "estimate" };

const EARTH_MILES = 3958.7613;
export const ROAD_FACTOR = 1.2;

export function haversineMiles(a: LatLon, b: LatLon): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function osrmMiles(a: LatLon, b: LatLon, timeoutMs = 3500, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
    const res = await fetchImpl(url, { signal: controller.signal, headers: { "user-agent": "FastBreakCRM/1.0 (mileage)" } });
    if (!res.ok) return null; // 429 rate limit, 5xx, ...
    const data = await res.json();
    const meters = data?.code === "Ok" ? Number(data.routes?.[0]?.distance) : NaN;
    return Number.isFinite(meters) && meters > 0 ? meters / 1609.344 : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function routeMiles(a: LatLon, b: LatLon, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<Miles> {
  const road = await osrmMiles(a, b, opts.timeoutMs, opts.fetchImpl);
  if (road !== null) return { miles: Math.round(road), source: "osrm" };
  return { miles: Math.round(haversineMiles(a, b) * ROAD_FACTOR), source: "estimate" };
}

export const milesLabel = (miles: number | null | undefined, source?: string | null) =>
  miles === null || miles === undefined ? "" : `${miles.toLocaleString("en-US")} Miles${source === "estimate" ? " (est.)" : ""}`;
