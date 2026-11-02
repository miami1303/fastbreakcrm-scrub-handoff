// Google Maps links (free, no API key): driving route + one link per address (pickup / delivery).
// Place strings (Owner 2026-10-31):
//   1. Full address (street + city/state or ZIP): "Street, City, ST ZIP" exactly as entered.
//      No ", USA" is appended: it can make Google re-interpret a correct address.
//   2. No street, City + ST: "City, ST ZIP".
//   3. ZIP only: "lat,lon" from the ZIP lookup when we have it, else "ZIP, USA" (a bare
//      5-digit ZIP alone can land in the wrong place, so only this case gets the country).
//   4. Nothing: null -> the button still opens Google Maps (new tab) so the rep can search.
// Every link opens in a NEW browser tab (target=_blank), never a popup window.

export type Place = { street?: string | null; city?: string | null; state?: string | null; zip?: string | null; lat?: number | null; lon?: number | null };

export const GOOGLE_MAPS_HOME = "https://www.google.com/maps";

export function mapsPlace(p: Place): string | null {
  const street = (p.street || "").trim();
  const city = (p.city || "").trim();
  const state = (p.state || "").trim().toUpperCase();
  const zip = (p.zip || "").trim();
  const cityState = city && state ? `${city}, ${state}${zip ? ` ${zip}` : ""}` : city || state ? [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : zip;
  if (street && cityState) return `${street}, ${cityState}`;
  if (city && state) return cityState;
  if (typeof p.lat === "number" && typeof p.lon === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
    return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  }
  if (/^\d{5}(-\d{4})?$/.test(zip)) return `${zip}, USA`;
  if (street) return street;
  return null;
}

/** Driving route. Both places known: directions. One known: that place. None: Google Maps home. */
export function googleMapsDirectionsUrl(origin: Place, destination: Place): string {
  const o = mapsPlace(origin), d = mapsPlace(destination);
  if (o && d) {
    const q = new URLSearchParams({ api: "1", origin: o, destination: d, travelmode: "driving" });
    return `https://www.google.com/maps/dir/?${q.toString()}`;
  }
  return googleMapsSearchUrl(o ? origin : destination);
}

/** One address (pickup or delivery) as a Google Maps search; Google Maps home when empty. */
export function googleMapsSearchUrl(p: Place): string {
  const q = mapsPlace(p);
  if (!q) return GOOGLE_MAPS_HOME;
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: q }).toString()}`;
}
