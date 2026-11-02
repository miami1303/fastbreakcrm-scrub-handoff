import { getStaff } from "@/lib/crm-server";
import { modelsForMake } from "@/lib/vehicle-catalog/major-makes";
import { catalogKey, mergeCatalogNames } from "@/lib/vehicle-catalog/names";
import { getNhtsaModels } from "@/lib/vehicle-catalog/nhtsa";
import { listStoredCustoms } from "@/lib/vehicle-customs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const staff = await getStaff().catch(() => null);
  if (!staff) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const url = new URL(request.url);
  const make = (url.searchParams.get("make") || "").trim().slice(0, 60);
  const year = Number(url.searchParams.get("year"));
  if (!make) return Response.json({ ok: true, source: "nhtsa", models: [] as string[] });

  const customs = await listStoredCustoms();
  const remembered = customs.models.filter((row) => row.makeKey === catalogKey(make)).map((row) => row.label);
  const hasYear = Number.isInteger(year) && year >= 1886 && year <= 2100;
  const nhtsa = hasYear ? await getNhtsaModels(make, year).catch(() => ({ ok: false, names: [] as string[] })) : { ok: true, names: [] as string[] };
  const curated = modelsForMake(make);
  return Response.json({
    ok: true,
    source: nhtsa.ok ? "nhtsa" : "unavailable",
    models: mergeCatalogNames(nhtsa.ok ? nhtsa.names : [], curated, remembered),
    customModels: mergeCatalogNames(remembered),
  });
}
