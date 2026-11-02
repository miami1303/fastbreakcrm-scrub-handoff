import { NextResponse } from "next/server";
import { runNeedsCarrier } from "@/lib/needs-carrier-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Raises / clears "Needs carrier" banners (2 days after the pickup window, no carrier). Needs CRON_SECRET. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runNeedsCarrier());
  } catch (e) {
    console.error("[crm] needs carrier scan failed:", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ ok: false, error: "Needs carrier scan failed." }, { status: 500 });
  }
}
