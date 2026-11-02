import { NextResponse } from "next/server";
import { inboxWatchEnabled, processMessages } from "@/lib/inbox-watch/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Optional push path (alternative to the Gmail poll): a forwarding service (Cloudflare Email Routing worker,
 * Postmark/SendGrid inbound, a Gmail filter forward) POSTs JSON { id, from, to, subject, text, labels? }.
 * Auth: header "authorization: Bearer $INBOUND_EMAIL_SECRET". Same filters (crystal ignored, FB only).
 */
export async function POST(request: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return NextResponse.json({ error: "INBOUND_EMAIL_SECRET is not set." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await inboxWatchEnabled())) return NextResponse.json({ ok: true, skipped: "Inbox watch is OFF." });
  const b = await request.json().catch(() => null);
  if (!b || !b.id || !b.from) return NextResponse.json({ error: "Need id, from, subject, text." }, { status: 400 });
  const msg = { id: `inbound:${String(b.id).slice(0, 200)}`, from: String(b.from), to: String(b.to || ""), subject: String(b.subject || ""), body: String(b.text || b.body || "").slice(0, 20000), labels: Array.isArray(b.labels) ? b.labels.map(String) : [] };
  try { return NextResponse.json({ ok: true, results: await processMessages([msg]) }); }
  catch (e) { console.error("[crm] inbound email failed:", e instanceof Error ? e.message : "unknown"); return NextResponse.json({ ok: false }, { status: 500 }); }
}
