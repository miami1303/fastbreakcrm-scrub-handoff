import "server-only";
// One poll of the Fast Break mailbox. Called by /api/cron/inbox-watch (Vercel Cron or any scheduler).
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { classifyEmail, gmailQuery, type InboxMessage } from "./classify";
import { fetchRecentMessages, gmailConfigured } from "./gmail";
import { applyClassified } from "./apply";

export const INBOX_WATCH_KEY = "inbox_watch_enabled";

export async function inboxWatchEnabled(): Promise<boolean> {
  const { data } = await createSupabaseAdminClient().from("crm_settings").select("value").eq("key", INBOX_WATCH_KEY).maybeSingle();
  return data?.value === true;
}

/** Process messages (from Gmail or an inbound-email webhook). Each message id is handled once. */
export async function processMessages(messages: InboxMessage[]) {
  const admin = createSupabaseAdminClient();
  const results: { id: string; kind: string; status: string; note: string }[] = [];
  for (const msg of messages) {
    const { data: seen } = await admin.from("inbox_watch_messages").select("message_id").eq("message_id", msg.id).maybeSingle();
    if (seen) continue;
    const c = classifyEmail(msg);
    // Claim first so two overlapping polls never double-apply.
    const claim = await admin.from("inbox_watch_messages").insert({ message_id: msg.id, kind: c.kind, subject: msg.subject.slice(0, 300), job_number: c.jobNumber || null, amount: c.amountCents ? c.amountCents / 100 : null });
    if (claim.error) { if (claim.error.code === "23505") continue; throw new Error(claim.error.message); }
    if (c.kind === "ignore") { results.push({ id: msg.id, kind: c.kind, status: "ignored", note: c.reason }); continue; }
    try {
      const r = await applyClassified(admin, msg, c);
      await admin.from("inbox_watch_messages").update({ status: r.status, estimate_id: r.estimateId, note: r.note }).eq("message_id", msg.id);
      results.push({ id: msg.id, kind: c.kind, status: r.status, note: r.note });
    } catch (e) {
      const note = e instanceof Error ? e.message : "error";
      await admin.from("inbox_watch_messages").update({ status: "error", note }).eq("message_id", msg.id);
      results.push({ id: msg.id, kind: c.kind, status: "error", note });
    }
  }
  return results;
}

export async function runInboxWatch() {
  if (!(await inboxWatchEnabled())) return { ok: true as const, skipped: "Inbox watch is OFF (Admin > Settings)." };
  if (!gmailConfigured()) return { ok: true as const, skipped: "Gmail is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_REFRESH_TOKEN)." };
  const messages = await fetchRecentMessages(gmailQuery(2), 25);
  return { ok: true as const, results: await processMessages(messages) };
}
