import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type ActiveBlock = { id: string; block_id: number; email: string; created_at: string; source_email_id: string | null };

/** The active opt-out block for an email address, if any (case-insensitive). */
export async function activeBlock(email: string | null | undefined): Promise<ActiveBlock | null> {
  const e = String(email || "").trim();
  if (!e) return null;
  const { data } = await createSupabaseAdminClient().from("crm_suppressions")
    .select("id, block_id, email, created_at, source_email_id")
    .ilike("email", e.replace(/[%_\\]/g, "\\$&")).is("removed_at", null).limit(1).maybeSingle();
  return data || null;
}

export const blockedMessage = (b: ActiveBlock) =>
  `This email is on the removal list (Block ID: ${b.block_id}). The customer opted out on ${new Date(b.created_at).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}, so nothing more can be sent to this address. An admin can remove the block.`;
