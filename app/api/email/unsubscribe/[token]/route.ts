import { NextResponse } from "next/server";
import { unsubscribe } from "@/app/actions/optout";

// RFC 8058 one-click unsubscribe: mail providers POST "List-Unsubscribe=One-Click" to the
// List-Unsubscribe URL (https://<site>/u/<token>); middleware rewrites that POST here.
// Same opt-out as the "Opt out / Unsubscribe" link (suppression list + email history).
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await unsubscribe(token);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, blockId: r.blockId });
}
