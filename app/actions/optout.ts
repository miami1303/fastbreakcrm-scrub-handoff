"use server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { clientIp, getAccessibleEstimate, getStaff, userAgent } from "@/lib/crm-server";
import { activeBlock } from "@/lib/suppression";

/**
 * Customer clicked "Unsubscribe" in an email / on a document page. Public (token-gated):
 * adds the address the email was sent to onto the suppression list and logs it in the
 * email history. Idempotent: an existing active block is returned as-is.
 */
export async function unsubscribe(token: string): Promise<{ ok: true; blockId: number } | { ok: false; error: string }> {
  const t = String(token || "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return { ok: false, error: "This link is not valid." };
  const admin = createSupabaseAdminClient();
  const { data: em } = await admin.from("crm_emails").select("id, estimate_id, sent_to").eq("token", t).maybeSingle();
  if (!em?.sent_to) return { ok: false, error: "This link is not valid." };
  const ip = await clientIp();
  let block = await activeBlock(em.sent_to);
  if (!block) {
    const { data, error } = await admin.from("crm_suppressions")
      .insert({ email: em.sent_to.trim().toLowerCase(), ip, user_agent: await userAgent(), source_email_id: em.id })
      .select("id, block_id, email, created_at, source_email_id").single();
    if (error) block = await activeBlock(em.sent_to); // lost a race with another click
    else block = data;
    if (!block) return { ok: false, error: "Something went wrong. Please try again." };
    await admin.from("crm_email_events").insert({ email_id: em.id, estimate_id: em.estimate_id, event: "unsubscribed", ip, user_agent: await userAgent(), block_id: block.block_id });
  }
  return { ok: true, blockId: block.block_id };
}

/** Any signed-in rep/admin removes the opt-out block for the lead's customer email (Owner: click the
 *  Block ID). The record is cleared (removed_at/by, kept for audit), logged in the email history,
 *  and a note is added to the lead: "Email removed from opt-out list by <rep>". */
export async function removeBlock(estimateId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const staff = await getStaff();
    if (!staff) return { ok: false, error: "Your session expired. Please sign in again." };
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false, error: "Estimate not found." };
    const admin = createSupabaseAdminClient();
    const { data: est } = await admin.from("estimates").select("customer_email").eq("id", estimateId).maybeSingle();
    const block = await activeBlock(est?.customer_email);
    if (!block) return { ok: false, error: "This email isn't blocked." };
    await admin.from("crm_suppressions").update({ removed_at: new Date().toISOString(), removed_by: staff.userId, removed_by_name: staff.name }).eq("id", block.id);
    const { data: lastEmail } = await admin.from("crm_emails").select("id").eq("estimate_id", estimateId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const emailId = block.source_email_id || lastEmail?.id;
    if (emailId) await admin.from("crm_email_events").insert({ email_id: emailId, estimate_id: estimateId, event: "block_removed", ip: await clientIp(), block_id: block.block_id, actor_name: staff.name });
    await admin.from("estimate_notes").insert({ estimate_id: estimateId, kind: "rep", created_by: staff.userId, author_name: staff.name, body: `Email removed from opt-out list by ${staff.name}` });
    return { ok: true };
  } catch { return { ok: false, error: "Could not remove the block." }; }
}
