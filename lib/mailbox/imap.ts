import "server-only";
// support@fastbreakcrm.test Inbox over your mail host IMAP (imap.example.test:993). The CRM is a
// second client of the same mailbox: your mail host webmail keeps working, nothing is removed from the
// server except an explicit Delete (moved to Trash, like webmail).
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { imapConfig, isOwnAddress, snippetOf } from "./parse.ts";

export const INBOX = "INBOX";
const FIRST_SYNC_MAX = 60;       // first run: only the newest messages
const BATCH_MAX = 60;            // per sync run (Vercel function time)
export const MIN_SYNC_GAP_MS = 45_000; // staff page polls; IMAP at most ~once per 45 s

export function inboxConfigured() { return !!imapConfig(); }

async function withClient<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const cfg = imapConfig();
  if (!cfg) throw new Error("Inbox not configured (IMAP_USER/IMAP_PASS or SMTP_USER/SMTP_PASS).");
  const client = new ImapFlow({ ...cfg, logger: false, socketTimeout: 25_000, connectionTimeout: 15_000, greetingTimeout: 10_000 } as ConstructorParameters<typeof ImapFlow>[0]);
  await client.connect();
  try { return await fn(client); } finally { await client.logout().catch(() => client.close()); }
}

const addrText = (a: AddressObject | AddressObject[] | undefined) => (Array.isArray(a) ? a.map(x => x.text).join(", ") : a?.text) || "";

function rowFromParsed(p: ParsedMail, uid: number, uidvalidity: number, internalDate?: Date) {
  const from = p.from?.value?.[0];
  return {
    folder: INBOX, uid, uidvalidity,
    message_id: p.messageId || null,
    in_reply_to: p.inReplyTo || null,
    references_header: Array.isArray(p.references) ? p.references.join(" ") : p.references || null,
    from_name: from?.name || null,
    from_address: (from?.address || "").toLowerCase() || null,
    to_text: addrText(p.to), cc_text: addrText(p.cc), reply_to: p.replyTo?.value?.[0]?.address || null,
    subject: p.subject || "(no subject)",
    sent_at: (p.date || internalDate || new Date()).toISOString(),
    snippet: snippetOf(p.text),
    text_body: (p.text || "").slice(0, 200_000),
    html_body: typeof p.html === "string" ? p.html.slice(0, 400_000) : null,
    attachments: (p.attachments || []).filter(a => a.contentDisposition !== "inline" || !a.cid).map(a => ({ filename: a.filename || "attachment", size: a.size, contentType: a.contentType })),
  };
}

/** Match a sender to the newest lead with that customer email. */
async function matchLeads(admin: ReturnType<typeof createSupabaseAdminClient>, addrs: string[]) {
  const map = new Map<string, string>();
  const uniq = [...new Set(addrs.filter(Boolean))];
  if (!uniq.length) return map;
  const { data } = await admin.from("estimates").select("id, customer_email, created_at").in("customer_email", uniq).order("created_at", { ascending: false });
  for (const r of data || []) { const k = String(r.customer_email).toLowerCase(); if (!map.has(k)) map.set(k, r.id); }
  return map;
}

export type SyncResult = { ok: boolean; skipped?: string; added: number; removed: number; error?: string };

/**
 * Pull new INBOX messages into mail_messages. A short DB lock (locked_until) keeps the staff
 * polls + cron from running two IMAP sessions at once. `force` skips the 45 s throttle (Refresh).
 * Messages removed in webmail are hidden here too (deleted_at), so both views agree.
 */
export async function syncInbox(force = false): Promise<SyncResult> {
  if (!inboxConfigured()) return { ok: false, skipped: "not_configured", added: 0, removed: 0 };
  const admin = createSupabaseAdminClient();
  const now = Date.now();
  const { data: st } = await admin.from("mail_sync_state").select("*").eq("folder", INBOX).maybeSingle();
  if (!force && st?.synced_at && now - Date.parse(st.synced_at) < MIN_SYNC_GAP_MS) return { ok: true, skipped: "recent", added: 0, removed: 0 };
  if (st?.locked_until && Date.parse(st.locked_until) > now) return { ok: true, skipped: "locked", added: 0, removed: 0 };
  const lockUntil = new Date(now + 55_000).toISOString();
  if (!st) {
    const { error } = await admin.from("mail_sync_state").insert({ folder: INBOX, locked_until: lockUntil });
    if (error) return { ok: true, skipped: "locked", added: 0, removed: 0 };
  } else {
    let q = admin.from("mail_sync_state").update({ locked_until: lockUntil }).eq("folder", INBOX);
    q = st.locked_until ? q.eq("locked_until", st.locked_until) : q.is("locked_until", null);
    const { data: got } = await q.select("folder");
    if (!got?.length) return { ok: true, skipped: "locked", added: 0, removed: 0 };
  }
  let added = 0, removed = 0;
  try {
    await withClient(async c => {
      const lock = await c.getMailboxLock(INBOX);
      try {
        const box = c.mailbox as { uidValidity: bigint | number; uidNext?: number };
        const uidvalidity = Number(box.uidValidity);
        const firstRun = !st?.uidvalidity || Number(st.uidvalidity) !== uidvalidity;
        const lastUid = firstRun ? 0 : Number(st!.last_uid || 0);
        const all = ((await c.search({ all: true }, { uid: true })) || []) as number[];
        let fresh = all.filter(u => u > lastUid).sort((a, b) => a - b);
        // First run: only the newest messages (marked checked) and the cursor jumps to the top, so older
        // mail is never imported later as "new". Later runs: oldest-first in batches.
        fresh = firstRun ? fresh.slice(-FIRST_SYNC_MAX) : fresh.slice(0, BATCH_MAX);
        const rows: ReturnType<typeof rowFromParsed>[] = [];
        if (fresh.length) {
          for await (const msg of c.fetch(fresh.join(","), { uid: true, source: true, internalDate: true }, { uid: true })) {
            if (!msg.source) continue;
            const parsed = await simpleParser(msg.source);
            rows.push(rowFromParsed(parsed, msg.uid, uidvalidity, msg.internalDate instanceof Date ? msg.internalDate : undefined));
          }
        }
        if (rows.length) {
          const leads = await matchLeads(admin, rows.map(r => r.from_address || ""));
          const own = (process.env.IMAP_USER || process.env.SMTP_USER || "").trim();
          const stamp = new Date().toISOString();
          const insert = rows.map(r => ({
            ...r, estimate_id: leads.get(r.from_address || "") || null,
            // First import = existing mail, already "checked" (no banner flood); our own copies never alert.
            opened_at: firstRun || isOwnAddress(r.from_address, own) ? stamp : null,
          }));
          const { error } = await admin.from("mail_messages").upsert(insert, { onConflict: "folder,uidvalidity,uid", ignoreDuplicates: true });
          if (error) throw new Error(error.message);
          added = insert.length;
        }
        // Gone from the server (deleted/moved in webmail): hide here too.
        if (!firstRun) {
          const present = new Set(all);
          const { data: live } = await admin.from("mail_messages").select("id, uid").eq("folder", INBOX).eq("uidvalidity", uidvalidity).is("deleted_at", null);
          const gone = (live || []).filter(r => !present.has(Number(r.uid))).map(r => r.id);
          if (gone.length) { await admin.from("mail_messages").update({ deleted_at: new Date().toISOString() }).in("id", gone); removed = gone.length; }
        }
        const maxUid = Math.max(lastUid, ...rows.map(r => r.uid), firstRun ? Math.max(0, ...all) : 0);
        await admin.from("mail_sync_state").update({ uidvalidity, last_uid: maxUid, synced_at: new Date().toISOString(), locked_until: null, last_error: null, updated_at: new Date().toISOString() }).eq("folder", INBOX);
      } finally { lock.release(); }
    });
    return { ok: true, added, removed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "IMAP sync failed";
    await admin.from("mail_sync_state").update({ locked_until: null, last_error: msg.slice(0, 500), synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("folder", INBOX);
    console.error("[crm] inbox sync failed:", msg);
    return { ok: false, added, removed, error: msg };
  }
}

async function trashPath(c: ImapFlow) {
  const list = await c.list();
  return list.find(b => b.specialUse === "\\Trash")?.path
    || list.find(b => /^(inbox[./])?trash$/i.test(b.path))?.path
    || list.find(b => /deleted/i.test(b.path))?.path || null;
}

/** Delete = move to the mailbox Trash (webmail can still restore it). */
export async function imapMoveToTrash(uid: number, uidvalidity: number) {
  return withClient(async c => {
    const trash = await trashPath(c);
    const lock = await c.getMailboxLock(INBOX);
    try {
      if (Number((c.mailbox as { uidValidity: bigint }).uidValidity) !== uidvalidity) return false;
      if (trash) await c.messageMove(String(uid), trash, { uid: true });
      else await c.messageDelete(String(uid), { uid: true });
      return true;
    } finally { lock.release(); }
  });
}

/** Opened in the CRM -> \Seen in webmail too. Best effort. */
export async function imapMarkSeen(uid: number) {
  try {
    await withClient(async c => {
      const lock = await c.getMailboxLock(INBOX);
      try { await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } finally { lock.release(); }
    });
  } catch (e) { console.error("[crm] inbox mark seen failed:", e instanceof Error ? e.message : "unknown"); }
}

/** Original attachments for Forward (re-read from the server, never stored in the DB). */
export async function imapAttachments(uid: number) {
  return withClient(async c => {
    const lock = await c.getMailboxLock(INBOX);
    try {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) return [];
      const p = await simpleParser(msg.source);
      return (p.attachments || []).filter(a => a.contentDisposition !== "inline" || !a.cid).map(a => ({ filename: a.filename || "attachment", content: a.content, contentType: a.contentType }));
    } finally { lock.release(); }
  });
}
