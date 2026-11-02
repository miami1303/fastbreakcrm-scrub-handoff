"use server";
// info@ Inbox (your mail host IMAP) for admins/supervisors. Mail stays on the server until Delete.
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getStaff, isManager, type Staff } from "@/lib/crm-server";
import { getCompanyInfo } from "@/lib/company-settings";
import { sendMail, sender } from "@/lib/mailer";
import { crmStamp } from "@/lib/crm-time";
import { imapAttachments, imapMarkSeen, imapMoveToTrash, inboxConfigured, syncInbox } from "@/lib/mailbox/imap";
import { composeBody, forwardSubject, parseRecipients, replyReferences, replySubject } from "@/lib/mailbox/parse";

type R<T> = ({ ok: true } & T) | { ok: false; error: string };
export type InboxRow = { id: string; from_name: string | null; from_address: string | null; subject: string | null; snippet: string | null; sent_at: string | null; opened_at: string | null; replied_at: string | null; forwarded_at: string | null; estimate_id: string | null; has_attachments: boolean; job_number?: string | null };
export type InboxMessage = InboxRow & { to_text: string | null; cc_text: string | null; reply_to: string | null; text_body: string | null; html_body: string | null; attachments: { filename: string; size: number; contentType: string }[] };

/** Who may use the shared info@ inbox (company mail): admins + supervisors. */
async function inboxStaff(): Promise<Staff | null> {
  const s = await getStaff();
  return s && isManager(s) ? s : null;
}

const LIST_COLS = "id, from_name, from_address, subject, snippet, sent_at, opened_at, replied_at, forwarded_at, estimate_id, attachments";

export async function listInbox(opts: { refresh?: boolean; q?: string; unreadOnly?: boolean } = {}): Promise<R<{ rows: InboxRow[]; configured: boolean; syncedAt: string | null; syncError: string | null }>> {
  const staff = await inboxStaff();
  if (!staff) return { ok: false, error: "Only administrators and supervisors can open the info@ inbox." };
  const configured = inboxConfigured();
  if (configured) await syncInbox(!!opts.refresh);
  const admin = createSupabaseAdminClient();
  let q = admin.from("mail_messages").select(LIST_COLS).is("deleted_at", null).order("sent_at", { ascending: false }).limit(200);
  if (opts.unreadOnly) q = q.is("opened_at", null);
  const term = (opts.q || "").trim().replace(/[%,()]/g, " ");
  if (term) q = q.or(`subject.ilike.%${term}%,from_address.ilike.%${term}%,from_name.ilike.%${term}%,snippet.ilike.%${term}%`);
  const [{ data, error }, { data: st }] = await Promise.all([q, admin.from("mail_sync_state").select("synced_at, last_error").eq("folder", "INBOX").maybeSingle()]);
  if (error) return { ok: false, error: error.message };
  const ids = [...new Set((data || []).map(r => r.estimate_id).filter(Boolean))] as string[];
  const jobs = new Map<string, string>();
  if (ids.length) { const { data: e } = await admin.from("estimates").select("id, job_number").in("id", ids); for (const x of e || []) jobs.set(x.id, x.job_number || ""); }
  const rows = (data || []).map(r => ({ ...r, has_attachments: Array.isArray(r.attachments) && r.attachments.length > 0, attachments: undefined, job_number: r.estimate_id ? jobs.get(r.estimate_id) || null : null })) as InboxRow[];
  return { ok: true, rows, configured, syncedAt: st?.synced_at || null, syncError: st?.last_error || null };
}

/** Header banner: unread (not yet opened in the CRM) count. Also the cheap staff-side poll that keeps the inbox synced. */
export async function inboxUnread(): Promise<{ ok: boolean; count: number; latest: { from: string; subject: string } | null }> {
  const staff = await inboxStaff();
  if (!staff || !inboxConfigured()) return { ok: false, count: 0, latest: null };
  await syncInbox(false);
  const { data, count } = await createSupabaseAdminClient().from("mail_messages").select("from_name, from_address, subject", { count: "exact" })
    .is("deleted_at", null).is("opened_at", null).order("sent_at", { ascending: false }).limit(1);
  const l = data?.[0];
  return { ok: true, count: count || 0, latest: l ? { from: l.from_name || l.from_address || "", subject: l.subject || "" } : null };
}

/** Open = checked: clears the banner for everyone and marks it read in webmail. */
export async function openMessage(id: string): Promise<R<{ message: InboxMessage }>> {
  const staff = await inboxStaff();
  if (!staff) return { ok: false, error: "Not allowed." };
  const admin = createSupabaseAdminClient();
  const { data: m } = await admin.from("mail_messages").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!m) return { ok: false, error: "Message not found (deleted?)." };
  if (!m.opened_at) {
    const now = new Date().toISOString();
    await admin.from("mail_messages").update({ opened_at: now, opened_by: staff.userId }).eq("id", id).is("opened_at", null);
    m.opened_at = now;
    await imapMarkSeen(Number(m.uid));
  }
  let job: string | null = null;
  if (m.estimate_id) { const { data: e } = await admin.from("estimates").select("job_number").eq("id", m.estimate_id).maybeSingle(); job = e?.job_number || null; }
  return { ok: true, message: { ...m, job_number: job, has_attachments: (m.attachments || []).length > 0 } as InboxMessage };
}

export async function markAllChecked(): Promise<R<{ count: number }>> {
  const staff = await inboxStaff();
  if (!staff) return { ok: false, error: "Not allowed." };
  const { data } = await createSupabaseAdminClient().from("mail_messages").update({ opened_at: new Date().toISOString(), opened_by: staff.userId }).is("opened_at", null).is("deleted_at", null).select("id");
  return { ok: true, count: data?.length || 0 };
}

export async function deleteMessage(id: string): Promise<R<object>> {
  const staff = await inboxStaff();
  if (!staff) return { ok: false, error: "Not allowed." };
  const admin = createSupabaseAdminClient();
  const { data: m } = await admin.from("mail_messages").select("id, uid, uidvalidity").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!m) return { ok: false, error: "Already deleted." };
  try {
    const moved = await imapMoveToTrash(Number(m.uid), Number(m.uidvalidity));
    if (!moved) return { ok: false, error: "Mailbox changed on the server; press Refresh and try again." };
  } catch (e) {
    return { ok: false, error: `Could not delete on the mail server: ${e instanceof Error ? e.message : "error"}` };
  }
  await admin.from("mail_messages").update({ deleted_at: new Date().toISOString(), deleted_by: staff.userId, opened_at: new Date().toISOString() }).eq("id", id);
  return { ok: true };
}

/** Reply / Reply all / Forward through the same your mail host SMTP as every CRM email (From info@). */
export async function sendInboxMail(id: string, f: { mode: "reply" | "replyAll" | "forward"; to: string; cc?: string; body: string }): Promise<R<{ to: string }>> {
  const staff = await inboxStaff();
  if (!staff) return { ok: false, error: "Not allowed." };
  const body = (f.body || "").trim();
  if (!body && f.mode !== "forward") return { ok: false, error: "Type a message first." };
  const to = parseRecipients(f.to);
  if (!to.ok) return { ok: false, error: to.bad.length ? `Not a valid email: ${to.bad.join(", ")}` : "Add a recipient." };
  const cc = f.cc?.trim() ? parseRecipients(f.cc) : null;
  if (cc && !cc.ok) return { ok: false, error: `Not a valid CC email: ${cc.bad.join(", ")}` };
  const admin = createSupabaseAdminClient();
  const { data: m } = await admin.from("mail_messages").select("*").eq("id", id).maybeSingle();
  if (!m) return { ok: false, error: "Message not found." };
  const company = await getCompanyInfo();
  const from = sender(company);
  const forward = f.mode === "forward";
  const content = composeBody(forward ? "forward" : "reply", body, m, crmStamp(m.sent_at));
  let attachments: { filename: string; content: Buffer; contentType?: string }[] = [];
  if (forward && (m.attachments || []).length) {
    try { attachments = await imapAttachments(Number(m.uid)); } catch { return { ok: false, error: "Could not load the original attachments from the mail server. Try again." }; }
  }
  const r = await sendMail({
    from: { name: from.name, address: from.address }, to: to.emails.join(", "), cc: cc?.emails.join(", ") || null, replyTo: from.replyTo,
    subject: forward ? forwardSubject(m.subject) : replySubject(m.subject), html: content.html, text: content.text,
    inReplyTo: forward ? null : m.message_id, references: forward ? null : replyReferences(m.references_header, m.message_id), attachments,
  });
  if (!r) return { ok: false, error: "Email sending is not configured (SMTP)." };
  if (!r.ok) return { ok: false, error: r.error };
  await admin.from("mail_messages").update(forward ? { forwarded_at: new Date().toISOString() } : { replied_at: new Date().toISOString() }).eq("id", id);
  return { ok: true, to: to.emails.join(", ") };
}
