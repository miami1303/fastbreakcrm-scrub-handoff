import "server-only";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type Staff = {
  userId: string;
  name: string;
  role: "admin" | "supervisor" | "salesperson";
  canViewCards: boolean;
  /** Salesman allowed to see/claim the Assign New Estimates pool (admins/supervisors always). */
  canClaimUnassigned: boolean;
};

export type EstimateAccessRow = { id: string; owner_id: string | null; status: string; job_number: string | null; customer_name: string | null };

/** The signed-in, active CRM user (checked against the session cookie), or null. */
export async function getStaff(): Promise<Staff | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("display_name, role, is_active, can_view_cards, can_claim_unassigned")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_active) return null;
  return {
    userId: user.id,
    name: profile.display_name || user.email || "",
    role: profile.role,
    canViewCards: profile.role === "admin" || !!profile.can_view_cards,
    canClaimUnassigned: profile.role === "admin" || profile.role === "supervisor" || !!profile.can_claim_unassigned,
  };
}

export function isManager(staff: Staff) {
  return staff.role === "admin" || staff.role === "supervisor";
}

/** Loads an estimate the user may work on (owner, or admin/supervisor). */
export async function getAccessibleEstimate(staff: Staff, estimateId: string): Promise<EstimateAccessRow | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("estimates")
    .select("id, owner_id, status, job_number, customer_name")
    .eq("id", estimateId)
    .maybeSingle();
  if (!data) return null;
  if (isManager(staff) || data.owner_id === staff.userId) return data as EstimateAccessRow;
  return null;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "";
}

export async function userAgent(): Promise<string> {
  const h = await headers();
  return (h.get("user-agent") || "").slice(0, 400);
}

/** Public origin for links sent to customers (NEXT_PUBLIC_SITE_URL, else the request host). */
export async function publicOrigin(): Promise<string> {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Banner notification: one row per recipient (the job's owner, an optional extra user,
 * and every active admin/supervisor), so each person dismisses their own. Never throws.
 */
export async function notify(kind: string, message: string, estimate: { id: string; owner_id: string | null } | null, extraUserId?: string | null, amount?: number | null) {
  try {
    const admin = createSupabaseAdminClient();
    const { data: managers } = await admin
      .from("user_profiles")
      .select("user_id")
      .eq("is_active", true)
      .in("role", ["admin", "supervisor"]);
    const targets = new Set<string>([estimate?.owner_id, extraUserId, ...(managers || []).map(m => m.user_id)].filter(Boolean) as string[]);
    if (!targets.size) return;
    await admin.from("crm_notifications").insert(
      [...targets].map(userId => ({ kind, message, amount: amount ?? null, estimate_id: estimate?.id ?? null, user_id: userId })),
    );
  } catch (error) {
    console.error("[crm] notification failed:", error instanceof Error ? error.message : "unknown error");
  }
}

/** One user's banner only (New Lead goes to the rep who got the lead, nobody else). */
export async function notifyUser(kind: string, message: string, estimate: { id: string } | null, userId: string | null | undefined) {
  if (!userId) return;
  try {
    await createSupabaseAdminClient().from("crm_notifications").insert({ kind, message, amount: null, estimate_id: estimate?.id ?? null, user_id: userId });
  } catch (error) {
    console.error("[crm] notification failed:", error instanceof Error ? error.message : "unknown error");
  }
}

export function jobLabel(e: { job_number?: string | null; customer_name?: string | null }) {
  return [e.job_number, e.customer_name].filter(Boolean).join(" — ");
}
