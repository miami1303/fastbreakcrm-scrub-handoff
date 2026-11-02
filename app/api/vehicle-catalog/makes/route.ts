import { getStaff } from "@/lib/crm-server";
import { annotateMakes } from "@/lib/vehicle-catalog/major-makes";
import { mergeCatalogNames } from "@/lib/vehicle-catalog/names";
import { getNhtsaMakes } from "@/lib/vehicle-catalog/nhtsa";
import { listStoredCustoms } from "@/lib/vehicle-customs-store";
import { VEHICLE_TYPES } from "@/lib/vehicle-fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await getStaff().catch(() => null);
  if (!staff) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const [nhtsa, customs] = await Promise.all([
    getNhtsaMakes().catch(() => ({ ok: false, names: [] as string[] })),
    listStoredCustoms(),
  ]);
  const loaded = nhtsa.ok && nhtsa.names.length > 0;
  // Every NHTSA name stays in the payload. major marks the short default list.
  const makes = annotateMakes(loaded ? nhtsa.names : [], customs.makes);
  return Response.json({
    ok: true,
    source: loaded ? "nhtsa" : "fallback",
    makes,
    customTypes: mergeCatalogNames(customs.types).filter((type) => !VEHICLE_TYPES.some((builtIn) => builtIn.toLowerCase() === type.toLowerCase())),
  });
}
