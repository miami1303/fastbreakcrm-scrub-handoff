// Server-only reads of public.email_templates (not a server action: no client entry point).
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { activeTemplates, cleanEsign, type EmailTemplateRow } from "@/lib/templates/email-templates";

export const TEMPLATE_COLS = "id, key, name, subject, body_html, kind, is_active, sort_order, opens_quote, esign";

/** All rows (server side). null = table missing / unreachable. */
export async function loadTemplateRows(): Promise<EmailTemplateRow[] | null> {
  const { data, error } = await createSupabaseAdminClient().from("email_templates").select(TEMPLATE_COLS).order("sort_order").order("name");
  if (error) { console.error("[crm] email_templates:", error.message); return null; }
  return ((data || []) as EmailTemplateRow[]).map(r => ({ ...r, esign: cleanEsign(r.esign) }));
}

/** One active template by key or id, else the code seed with that key. */
export async function findActiveTemplate(keyOrId: string): Promise<EmailTemplateRow | null> {
  const rows = await loadTemplateRows();
  return activeTemplates(rows).find(r => r.key === keyOrId || r.id === keyOrId) || null;
}

