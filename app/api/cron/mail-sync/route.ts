import { NextResponse } from "next/server";
import { syncInbox } from "@/lib/mailbox/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * info@ Inbox sync (your mail host IMAP -> mail_messages). Authorization: Bearer CRON_SECRET (Vercel Cron)
 * or Bearer MAIL_SYNC_SECRET (any external pinger, e.g. every 2–5 min). Staff pages also sync
 * themselves every ~45 s while the CRM is open, so this is the background safety net.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const secrets = [process.env.CRON_SECRET, process.env.MAIL_SYNC_SECRET].filter(Boolean) as string[];
  if (!secrets.length) return NextResponse.json({ error: "MAIL_SYNC_SECRET is not set." }, { status: 503 });
  if (!secrets.some(s => auth === `Bearer ${s}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await syncInbox(true);
  return NextResponse.json(r, { status: r.ok || r.skipped ? 200 : 500 });
}
