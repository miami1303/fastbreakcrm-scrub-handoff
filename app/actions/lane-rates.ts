"use server";

// Lane $/mi learning (Owner, 2026-10-31). Read-only: every booked job in the last year is a
// sample of what a carrier accepted (COD + any money already sent to the carrier) / miles.
// See lib/lane-rates.ts for the ZIP corridor buckets and the fallback ladder.
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getStaff } from "@/lib/crm-server";
import { laneRate, type LaneRate, type LaneSample } from "@/lib/lane-rates";

const SENT = new Set(["sent", "processing", "zelle_to_send"]);

export async function recentLaneRate(estimateId: string, pickupZip: string, deliveryZip: string): Promise<{ ok: true; rate: LaneRate | null } | { ok: false; error: string }> {
  const staff = await getStaff();
  if (!staff) return { ok: false, error: "Your session expired." };
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data, error } = await admin.from("estimates")
    .select("id, pickup_zip, delivery_zip, cod_amount, miles, booked_at")
    .eq("status", "booked").is("deleted_at", null).gte("booked_at", since)
    .not("miles", "is", null).not("cod_amount", "is", null).neq("id", estimateId)
    .order("booked_at", { ascending: false }).limit(2000);
  if (error) return { ok: false, error: "Could not read recent jobs." };
  const rows = data || [];
  // Money sent to a carrier out of the deposit is part of what the carrier was paid.
  const extra = new Map<string, number>();
  if (rows.length) {
    const { data: pays, error: pe } = await admin.from("carrier_payouts").select("estimate_id, amount, source, status").in("estimate_id", rows.map(r => r.id));
    if (!pe) for (const p of pays || []) if (p.source === "deposit" && SENT.has(p.status)) extra.set(p.estimate_id, (extra.get(p.estimate_id) || 0) + Number(p.amount || 0));
  }
  const samples: LaneSample[] = rows.map(r => ({
    pickup_zip: r.pickup_zip, delivery_zip: r.delivery_zip, miles: Number(r.miles),
    carrier_pay: Number(r.cod_amount) + (extra.get(r.id) || 0), at: r.booked_at,
  }));
  return { ok: true, rate: laneRate(pickupZip, deliveryZip, samples) };
}
