"use server";

// Maintenance > Email Center (admins): add / change / delete customer email templates.
// Reps read the active list in the hover Email Center. Falls back to the code seeds when the
// table is empty or the migration has not been applied yet.
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getStaff, publicOrigin } from "@/lib/crm-server";
import { getCompanyInfo } from "@/lib/company-settings";
import { activeTemplates, cleanEsign, cleanTemplateBody, esignKindFor, type TemplateEsign, rowTemplate, SEED_TEMPLATES, slugKey, unknownMergeFields, type EmailTemplateRow } from "@/lib/templates/email-templates";
import { renderTemplateDef } from "@/lib/templates/registry";
import { messageLinks } from "@/lib/customer-email-views";
import { ESIGN_LINK_TEXT, type QuoteInput } from "@/lib/quote-template";

import { TEMPLATE_COLS as COLS, loadTemplateRows } from "@/lib/email-templates-server";
type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

async function requireAdmin() {
  const staff = await getStaff();
  if (!staff || staff.role !== "admin") throw new Error("Maintenance is for admins only.");
  return staff;
}

/** Hover Email Center list: active templates, menu order. */
export async function listActiveTemplates(): Promise<R<{ templates: Pick<EmailTemplateRow, "id" | "key" | "name">[]; seeded: boolean }>> {
  try {
    if (!(await getStaff())) return { ok: false, error: "Your session expired. Please sign in again." };
    const rows = await loadTemplateRows();
    return { ok: true, seeded: !rows || !rows.length, templates: activeTemplates(rows).map(({ id, key, name }) => ({ id, key, name })) };
  } catch (e) { return fail(e); }
}

export async function listTemplatesAdmin(): Promise<R<{ templates: EmailTemplateRow[]; migrated: boolean }>> {
  try {
    await requireAdmin();
    const rows = await loadTemplateRows();
    return { ok: true, migrated: rows !== null, templates: rows && rows.length ? rows : SEED_TEMPLATES };
  } catch (e) { return fail(e); }
}

export type TemplateDraft = { id?: string | null; name: string; subject: string; body_html: string; is_active: boolean; sort_order: number; opens_quote: boolean; esign?: TemplateEsign };

function cleanDraft(d: TemplateDraft) {
  const name = String(d.name || "").trim().slice(0, 120);
  const subject = String(d.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const body_html = cleanTemplateBody(d.body_html);
  if (!name) throw new Error("Give the template a name.");
  if (!subject) throw new Error("Enter a subject.");
  if (!body_html.replace(/<[^>]*>|&nbsp;|\s/g, "")) throw new Error("The template body is empty.");
  const bad = unknownMergeFields(subject, body_html);
  if (bad.length) throw new Error(`Unknown merge field${bad.length > 1 ? "s" : ""}: ${bad.map(b => `{${b}}`).join(", ")}. Use the chips above the editor.`);
  const sort_order = Math.max(0, Math.min(9999, Math.round(Number(d.sort_order) || 100)));
  return { name, subject, body_html, is_active: !!d.is_active, sort_order, opens_quote: !!d.opens_quote, esign: cleanEsign(d.esign) };
}

export async function saveTemplate(d: TemplateDraft): Promise<R<{ template: EmailTemplateRow }>> {
  try {
    const staff = await requireAdmin();
    const v = cleanDraft(d);
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    if (d.id && !String(d.id).startsWith("seed:")) {
      const { data, error } = await admin.from("email_templates").update({ ...v, updated_by: staff.userId, updated_at: now }).eq("id", d.id).select(COLS).single();
      if (error) throw new Error(error.message);
      revalidatePath("/admin-menu/maintenance");
      return { ok: true, template: data as EmailTemplateRow };
    }
    // New row (or a seed being saved before the table had it): unique key from the name / seed key.
    const seedKey = d.id?.startsWith("seed:") ? d.id.slice(5) : null;
    let key = seedKey || slugKey(v.name);
    const { data: taken } = await admin.from("email_templates").select("key").like("key", `${key}%`);
    const used = new Set((taken || []).map(t => t.key));
    if (!seedKey) for (let i = 2; used.has(key); i++) key = `${slugKey(v.name).slice(0, 55)}_${i}`;
    const { data, error } = await admin.from("email_templates")
      .upsert({ key, kind: "letter", ...v, created_by: staff.userId, updated_by: staff.userId, updated_at: now }, { onConflict: "key" })
      .select(COLS).single();
    if (error) throw new Error(/email_templates/.test(error.message) && /exist|schema cache/.test(error.message) ? "Email templates need the new database migration first." : error.message);
    revalidatePath("/admin-menu/maintenance");
    return { ok: true, template: data as EmailTemplateRow };
  } catch (e) { return fail(e); }
}

/** Email Center table: change one setting on one, several, or all templates without opening the editor. */
export async function setTemplateOptions(ids: string[], patch: { opens_quote?: boolean; esign?: TemplateEsign }): Promise<R<{ updated: number }>> {
  try {
    const staff = await requireAdmin();
    const v: { opens_quote?: boolean; esign?: TemplateEsign } = {};
    if (typeof patch.opens_quote === "boolean") v.opens_quote = patch.opens_quote;
    if (patch.esign !== undefined) v.esign = cleanEsign(patch.esign);
    if (!Object.keys(v).length) return { ok: true, updated: 0 };
    const list = (ids || []).map(String).filter(Boolean).slice(0, 500);
    if (!list.length) return { ok: false, error: "Select at least one template." };
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    // Built-in letters not saved yet (seed:<key>): save the seed row first, then update it.
    const seeds = list.filter(id => id.startsWith("seed:"));
    const real = list.filter(id => !id.startsWith("seed:"));
    let updated = 0;
    for (const id of seeds) {
      const seed = SEED_TEMPLATES.find(t => t.id === id);
      if (!seed) continue;
      const row: Partial<EmailTemplateRow> = { ...seed }; delete row.id;
      const { error } = await admin.from("email_templates").upsert({ ...row, ...v, created_by: staff.userId, updated_by: staff.userId, updated_at: now }, { onConflict: "key" });
      if (error) throw new Error(error.message);
      updated++;
    }
    if (real.length) {
      const { data, error } = await admin.from("email_templates").update({ ...v, updated_by: staff.userId, updated_at: now }).in("id", real).select("id");
      if (error) throw new Error(error.message);
      updated += (data || []).length;
    }
    revalidatePath("/admin-menu/maintenance");
    return { ok: true, updated };
  } catch (e) { return fail(e); }
}

/** Delete a template. Emails already sent keep their snapshot (crm_emails.template_id is set null). */
export async function deleteTemplate(id: string): Promise<R> {
  try {
    await requireAdmin();
    if (!id || id.startsWith("seed:")) return { ok: false, error: "This built-in letter is not saved yet; uncheck Active and Save to hide it instead." };
    const { error } = await createSupabaseAdminClient().from("email_templates").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/admin-menu/maintenance");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Sample lead used by the Maintenance preview (nothing is sent; links go nowhere). */
function sampleInput(company: QuoteInput["company"], origin: string, staffName: string, opensQuote: boolean, esign: TemplateEsign = "none"): QuoteInput {
  const tracked = messageLinks(opensQuote ? "custom_quote" : "custom_letter", origin, "preview", "FB000000");
  const ek = esignKindFor(esign);
  const links = { ...tracked.links, letterEsign: ek ? { href: `${origin.replace(/\/$/, "")}/d/FB000000/preview#esign`, text: ek === "cc_form" ? ESIGN_LINK_TEXT.cc : ESIGN_LINK_TEXT.quote } : null };
  return {
    est: { job_number: "FB000000", customer_name: "Jane Sample", customer_email: "jane@example.com", pickup_address: "100 Main St, Miami, FL 33101", pickup_zip: "33101",
      delivery_address: "200 Oak Ave, Austin, TX 78701", delivery_zip: "78701", created_at: new Date().toISOString() } as QuoteInput["est"],
    vehicles: [], quote: null, company, assetBaseUrl: origin,
    rep: { name: staffName || "Assigned Rep", email: company?.companyEmail || "", phone: "", title: null },
    links,
  };
}

export async function previewTemplateDraft(d: TemplateDraft): Promise<R<{ html: string; subject: string }>> {
  try {
    const staff = await requireAdmin();
    const v = cleanDraft(d);
    const origin = await publicOrigin();
    const company = await getCompanyInfo();
    const row: EmailTemplateRow = { id: "preview", key: "preview", kind: "letter", ...v };
    const { html, subject } = renderTemplateDef(rowTemplate(row), sampleInput(company, origin, staff.name, v.opens_quote, v.esign));
    return { ok: true, html, subject };
  } catch (e) { return fail(e); }
}
