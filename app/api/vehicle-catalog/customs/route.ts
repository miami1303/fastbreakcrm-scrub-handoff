import { getStaff } from "@/lib/crm-server";
import { storeCustomItems } from "@/lib/vehicle-customs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff typed a make, model, or type that was not in the list. Saving it must never block the estimate. */
export async function POST(request: Request) {
  const staff = await getStaff().catch(() => null);
  if (!staff) return Response.json({ ok: false, saved: false }, { status: 401 });
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, saved: false });
  }
  const items = body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)
    ? (body as { items: unknown[] }).items
    : [];
  const saved = await storeCustomItems(items);
  return Response.json({ ok: true, saved });
}
