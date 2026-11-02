"use server";

import { LEAD_SOURCES_KEY, leadSourcesFrom, type LeadSourceOption } from "@/lib/lead-sources";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getStaff } from "@/lib/crm-server";
import { assertPriorityLabels, type PriorityLabel } from "@/lib/follow-up-domain";
import { readPriorityLabelRows } from "@/lib/priority-labels";
import { COMPANY_SETTING_KEYS, COMPANY_SETTING_LABELS, companyFromRows, type CompanyInfo } from "@/lib/templates/company";

async function requireAdmin() {
  const staff = await getStaff();
  if (!staff || staff.role !== "admin") throw new Error("Only an admin can change settings.");
  return staff;
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

export async function getSettings() {
  try {
    await requireAdmin();
    const admin = createSupabaseAdminClient();
    const [{ data: reps }, { data: settings }, { data: profiles }] = await Promise.all([
      admin.from("crm_reps").select("id, name, email, phone, user_id, is_active, in_rotation, sort_order, last_assigned_at").order("sort_order").order("name"),
      admin.from("crm_settings").select("key, value"),
      admin.from("user_profiles").select("user_id, display_name, role, is_active").eq("is_active", true).order("display_name"),
    ]);
    const get = (k: string) => (settings || []).find(s => s.key === k)?.value;
    return {
      ok: true as const,
      reps: reps || [],
      profiles: profiles || [],
      rotationEnabled: get("rotation_enabled") === true,
      inboxWatchEnabled: get("inbox_watch_enabled") === true,
      inboxWatchGmailReady: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN),
      leadSources: leadSourcesFrom(get(LEAD_SOURCES_KEY)),
    };
  } catch (e) { return fail(e); }
}

export async function setRotationEnabled(enabled: boolean) {
  try {
    const staff = await requireAdmin();
    await createSupabaseAdminClient().from("crm_settings").upsert({ key: "rotation_enabled", value: !!enabled, updated_at: new Date().toISOString(), updated_by: staff.userId });
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** In-CRM inbox watch (FB payments + Central Dispatch pickup/delivered). Default OFF. */
export async function setInboxWatchEnabled(enabled: boolean) {
  try {
    const staff = await requireAdmin();
    await createSupabaseAdminClient().from("crm_settings").upsert({ key: "inbox_watch_enabled", value: !!enabled, updated_at: new Date().toISOString(), updated_by: staff.userId });
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

export async function saveRep(rep: { id?: string; name: string; email: string; phone: string; user_id: string; is_active: boolean; in_rotation: boolean }) {
  try {
    await requireAdmin();
    const name = String(rep.name || "").trim().slice(0, 80);
    if (!name) return { ok: false as const, error: "Rep name is required." };
    const email = String(rep.email || "").trim().slice(0, 200) || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false as const, error: "Enter a valid email." };
    const row = {
      name, email, phone: String(rep.phone || "").trim().slice(0, 40) || null,
      user_id: rep.user_id || null, is_active: !!rep.is_active, in_rotation: !!rep.in_rotation,
    };
    const admin = createSupabaseAdminClient();
    const { error } = rep.id ? await admin.from("crm_reps").update(row).eq("id", rep.id) : await admin.from("crm_reps").insert(row);
    if (error) return { ok: false as const, error: error.message.includes("duplicate") ? "That name or login is already used by another rep." : error.message };
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** Maintenance (admin): the company's priority numbers and labels. Empty means none. */
export async function getPriorityLabels() {
  try {
    await requireAdmin();
    return { ok: true as const, ...(await readPriorityLabelRows()) };
  } catch (e) { return fail(e); }
}

export async function savePriorityLabels(rows: PriorityLabel[]) {
  try {
    const staff = await requireAdmin();
    const list = assertPriorityLabels(rows);
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    if (list.length) {
      const { error } = await admin.from("priority_labels").upsert(
        list.map(r => ({ number: r.number, label: r.label, updated_at: now, updated_by: staff.userId })),
        { onConflict: "number" },
      );
      if (error) return { ok: false as const, error: prioritySaveError(error.message) };
    }
    const { data: existing, error: readErr } = await admin.from("priority_labels").select("number");
    if (readErr) return { ok: false as const, error: prioritySaveError(readErr.message) };
    const keep = new Set(list.map(r => r.number));
    const drop = (existing || []).map(r => r.number).filter(n => !keep.has(n));
    if (drop.length) {
      const { error } = await admin.from("priority_labels").delete().in("number", drop);
      if (error) return { ok: false as const, error: prioritySaveError(error.message) };
    }
    return { ok: true as const, labels: list };
  } catch (e) { return fail(e); }
}

function prioritySaveError(message: string) {
  if (/priority_labels|schema cache|does not exist|42P01|PGRST205/i.test(message)) {
    return "Priority labels aren't in the database yet. Apply migration 20261027120000_priority_labels.sql.";
  }
  return message || "Could not save priorities.";
}

// ---- Company Settings (contact info on every customer document / email) ----
/** Maintenance (admin): add, rename or hide Lead Source options (crm_settings "lead_sources"). */
export async function saveLeadSources(options: LeadSourceOption[]) {
  try {
    const staff = await requireAdmin();
    const list = leadSourcesFrom(Array.isArray(options) ? options : []);
    if (!list.length) return { ok: false as const, error: "Keep at least one Lead Source." };
    if (!list.some(o => !o.hidden)) return { ok: false as const, error: "At least one Lead Source must be visible." };
    await createSupabaseAdminClient().from("crm_settings").upsert({ key: LEAD_SOURCES_KEY, value: list, updated_at: new Date().toISOString(), updated_by: staff.userId });
    return { ok: true as const, leadSources: list };
  } catch (e) { return fail(e); }
}

export async function getCompanySettings() {
  try {
    await requireAdmin();
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("company_settings").select("key, value, updated_at");
    if (error) throw new Error("Company settings table is missing. Apply the company_settings migration.");
    return { ok: true as const, company: companyFromRows(data), updatedAt: (data || []).reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "") };
  } catch (e) { return fail(e); }
}

export async function saveCompanySettings(values: Partial<Record<keyof CompanyInfo, string>>) {
  try {
    const staff = await requireAdmin();
    const rows: { key: string; value: string; updated_at: string; updated_by: string }[] = [];
    const now = new Date().toISOString();
    for (const [field, key] of Object.entries(COMPANY_SETTING_KEYS) as [keyof CompanyInfo, string][]) {
      if (!(field in values)) continue;
      const isPolicy = field === "policyQuote" || field === "policyBooked";
      const max = isPolicy ? 50000 : 200;
      const v = String(values[field] ?? "").trim().slice(0, max);
      if (!v && ["mainPhone", "companyEmail", "website", "quoteCompanyName", "ccCompanyName", "emailFromName"].includes(field)) {
        throw new Error(`${COMPANY_SETTING_LABELS[field]} can't be blank.`);
      }
      if (field === "emailSendAs" && !["company", "rep"].includes(v)) throw new Error("Send emails as must be the company email or the rep's email.");
      if (field === "companyEmail" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error("Company email doesn't look like an email address.");
      rows.push({ key, value: v, updated_at: now, updated_by: staff.userId });
    }
    const { error } = await createSupabaseAdminClient().from("company_settings").upsert(rows, { onConflict: "key" });
    if (error) throw new Error("Could not save company settings.");
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
