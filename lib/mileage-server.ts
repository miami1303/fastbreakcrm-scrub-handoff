import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isUsZip, lookupZip } from "@/lib/zip-lookup";
import { routeMiles, type LatLon } from "@/lib/mileage";

export type ZipGeo = LatLon & { city: string | null; state: string | null; zip: string };

/** ZIP -> City, ST + lat/lon, cached in zip_geo (filled from the free zippopotam.us lookup). */
export async function geoForZip(zip: string | null | undefined): Promise<ZipGeo | null> {
  if (!isUsZip(zip)) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("zip_geo").select("lat, lon, city, state").eq("zip", zip).maybeSingle();
  if (data) return { lat: data.lat, lon: data.lon, city: data.city, state: data.state, zip };
  const place = await lookupZip(zip, 3000);
  if (!place || place.lat === undefined || place.lon === undefined) return null;
  await admin.from("zip_geo").upsert({ zip, city: place.city, state: place.state, lat: place.lat, lon: place.lon });
  return { lat: place.lat, lon: place.lon, city: place.city, state: place.state, zip };
}

/** Miles for a pickup/delivery ZIP pair, or null when either ZIP can't be located. */
export async function milesForZips(pickupZip: string | null | undefined, deliveryZip: string | null | undefined) {
  if (!isUsZip(pickupZip) || !isUsZip(deliveryZip)) return null;
  const [a, b] = await Promise.all([geoForZip(pickupZip), geoForZip(deliveryZip)]);
  if (!a || !b) return null;
  const r = await routeMiles(a, b, { timeoutMs: 3500 });
  return { miles: r.miles, miles_source: r.source, miles_zips: `${pickupZip}-${deliveryZip}` };
}
