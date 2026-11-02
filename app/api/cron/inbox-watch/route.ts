import { NextResponse } from "next/server";
import { runInboxWatch } from "@/lib/inbox-watch/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Polls the connected Gmail inbox for FB payments + Central Dispatch pickup/delivered. Needs CRON_SECRET. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runInboxWatch());
  } catch (e) {
    console.error("[crm] inbox watch failed:", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ ok: false, error: "Inbox watch failed." }, { status: 500 });
  }
}
