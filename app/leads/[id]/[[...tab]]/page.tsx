import { redirect } from "next/navigation";

const TABS = new Set(["entry", "charges", "payments", "estimate", "emails", "vehicles"]);

/** /leads/<id>/<tab> is an alias of /estimates/<id>/<tab> (Charges is the default). */
export default async function LeadAlias({ params }: { params: Promise<{ id: string; tab?: string[] }> }) {
  const { id, tab } = await params;
  const t = tab?.[0];
  redirect(`/estimates/${encodeURIComponent(id)}${t && TABS.has(t) && t !== "charges" ? `/${t}` : ""}`);
}
