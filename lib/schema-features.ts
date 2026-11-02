// Optional columns from migration 20261023200000_lead_tabs_priority_extras.sql. Until it is
// applied, the app hides those fields instead of failing. Probed once a minute per server.
import { createSupabaseAdminClient } from "./supabase-admin";

export type SchemaFeatures = { pickupTime: boolean; extraCharges: boolean; vehicleExtras: boolean; priority08: boolean; vehicleFlex: boolean; phoneLabels: boolean; phone3: boolean; vehiclePricing: boolean; autoCharge: boolean; vehicleExpedited?: boolean; vehicleCharges?: boolean; paymentVehicle?: boolean };
let cache: { at: number; value: SchemaFeatures } | null = null;

export async function schemaFeatures(): Promise<SchemaFeatures> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const admin = createSupabaseAdminClient();
  const [a, b, c, d, e, f, g, h, x, vc, pv] = await Promise.all([
    admin.from("estimates").select("pickup_time").limit(1),
    admin.from("quotes").select("extra_charges").limit(1),
    admin.from("vehicles").select("color, engine, qty, price").limit(1),
    admin.from("vehicles").select("flex").limit(1), // migration 20261024010000_vehicle_flex.sql
    admin.from("estimates").select("pickup_phone1_label").limit(1), // migration 20261026210000_phone_labels.sql
    admin.from("estimates").select("pickup_phone3").limit(1), // migration 20261026230000_phone3.sql
    admin.from("vehicles").select("deposit_amount, cod_amount, total_amount, asap").limit(1), // migration 20261027010000_vehicle_deposit_cod_asap.sql
    admin.from("estimates").select("auto_charge").limit(1), // migration 20261027020000_estimate_auto_charge.sql
    admin.from("vehicles").select("expedited").limit(1), // migration 20261031150000_vehicle_expedited.sql
    admin.from("vehicles").select("extra_charges, discount_amount").limit(1), // migration 20261031190000_vehicle_charges_discount.sql
    admin.from("payments").select("vehicle_index").limit(1), // same migration
  ]);
  // The pickup_time and extra_charges columns ship in the same migration as the 0-8 priorities.
  const value = { pickupTime: !a.error, extraCharges: !b.error, vehicleExtras: !c.error, priority08: !a.error && !b.error, vehicleFlex: !d.error, phoneLabels: !e.error, phone3: !f.error, vehiclePricing: !g.error, autoCharge: !h.error, vehicleExpedited: !x.error, vehicleCharges: !vc.error && !g.error, paymentVehicle: !pv.error };
  cache = { at: Date.now(), value };
  return value;
}

export { extraChargesFrom, type ExtraCharge } from "./extra-charges";
