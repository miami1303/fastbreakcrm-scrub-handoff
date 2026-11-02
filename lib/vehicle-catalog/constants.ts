/**
 * Vehicle year, make, model, and type lookup.
 *
 * This folder is meant to be copied into another CRM later. It does not know
 * about Fast Break leads, payments, or staff accounts. Callers pass in
 * whatever extra names an office has typed, and merge them with the public list.
 */

export const VEHICLE_YEAR_MIN = 1950;

/** NHTSA vehicle-type feeds used to build the manufacturer list. */
export const NHTSA_MAKE_TYPE_SLUGS = [
  "car",
  "truck",
  "multipurpose passenger vehicle",
  "motorcycle",
  "bus",
  "low speed vehicle",
] as const;

/**
 * NHTSA also publishes a trailer-builder feed of roughly ten thousand names.
 * Loading that feed would bury cars and trucks, so it is intentionally absent.
 * A trailer make that is missing can be typed and is then remembered.
 */

export const VEHICLE_TYPES = [
  "Sedan",
  "Large Sedan",
  "Convertible",
  "Coupe",
  "Classic",
  "Crossover",
  "SUV",
  "Small SUV",
  "Large SUV",
  "Extra LG SUV",
  "Van",
  "Mini-Van",
  "Tall Van",
  "Extra Large Van",
  "Pickup",
  "Small Pickup",
  "Large Pickup",
  "Extra LG Pickup",
  "RV",
  "Travel Trailer",
  "Camper Van",
  "Golf Cart",
  "ATV",
  "S. Wagon",
  "Truck",
  "Ambulance",
  "Trike",
  "Motorcycle",
  "Boat",
  "Jet Ski",
  "Armored",
  "Heavy Equipment",
] as const;

/**
 * Shown when the public manufacturer list cannot be loaded.
 * These are the curated passenger makes (see major-makes.ts). The short
 * default list is a subset; the rest appear when their names are typed.
 */
export { MAJOR_MAKE_NAMES as FALLBACK_MAKES } from "./major-makes";

export function vehicleYearMax(now = new Date()): number {
  return now.getFullYear() + 1;
}

export function vehicleYearOptions(now = new Date()): number[] {
  const years: number[] = [];
  for (let year = vehicleYearMax(now); year >= VEHICLE_YEAR_MIN; year -= 1) years.push(year);
  return years;
}

export function isListedVehicleYear(value: number, now = new Date()): boolean {
  return Number.isInteger(value) && value >= VEHICLE_YEAR_MIN && value <= vehicleYearMax(now);
}
