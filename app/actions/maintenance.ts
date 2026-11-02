"use server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getStaff } from "@/lib/crm-server";
import { createMember, deleteMember, inviteMember, parseMember, setUsername, USERNAME_RE } from "@/lib/team-admin";
import { revalidatePath } from "next/cache";

// Maintenance (Admin menu, admins only): manage users. Supervisors have no access.
import type { UserType } from "@/lib/crm-constants";

async function requireAdmin() {
  const staff = await getStaff();
  if (!staff || staff.role !== "admin") throw new Error("Maintenance is for admins only.");
  return staff;
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

export type MaintUser = {
  user_id: string; display_name: string; username: string; login_email: string; role: UserType; is_active: boolean;
  can_claim_unassigned: boolean; can_view_cards: boolean; invite_pending: boolean; rep_id: string | null; phone: string; email: string; in_rotation: boolean;
};

export async function listUsers() {
  try {
    await requireAdmin();
    const admin = createSupabaseAdminClient();
    const [{ data: profiles, error }, { data: ids }, { data: reps }, authRes] = await Promise.all([
      admin.from("user_profiles").select("user_id, display_name, role, is_active, can_claim_unassigned, can_view_cards, phone").order("display_name"),
      admin.from("user_identities").select("user_id, username"),
      admin.from("crm_reps").select("id, user_id, email, phone, in_rotation"),
      admin.auth.admin.listUsers({ page: 1, perPage: 500 }).catch(() => ({ data: { users: [] } })),
    ]);
    if (error) throw new Error("Could not load users.");
    const uname = new Map((ids || []).map(i => [i.user_id, i.username]));
    const rep = new Map((reps || []).filter(r => r.user_id).map(r => [r.user_id as string, r]));
    const authUsers = (authRes as { data?: { users?: { id: string; email?: string; last_sign_in_at?: string | null }[] } }).data?.users || [];
    const mail = new Map(authUsers.map(u => [u.id, u.email || ""]));
    const pending = new Set(authUsers.filter(u => !u.last_sign_in_at).map(u => u.id));
    const users: MaintUser[] = (profiles || []).map(p => {
      const r = rep.get(p.user_id);
      return {
        user_id: p.user_id, display_name: p.display_name || "", username: uname.get(p.user_id) || "", login_email: mail.get(p.user_id) || "",
        role: p.role, is_active: p.is_active, can_claim_unassigned: !!p.can_claim_unassigned,
        can_view_cards: !!p.can_view_cards, invite_pending: pending.has(p.user_id),
        rep_id: r?.id || null, phone: r?.phone || p.phone || "", email: r?.email || "", in_rotation: !!r?.in_rotation,
      };
    });
    return { ok: true as const, users };
  } catch (e) { return fail(e); }
}

export async function saveUser(userId: string, v: { display_name: string; phone: string; email: string; role: UserType; is_active: boolean; in_rotation: boolean; can_claim_unassigned: boolean; can_view_cards?: boolean; username?: string; login_email?: string; new_password?: string }) {
  try {
    const staff = await requireAdmin();
    const name = String(v.display_name || "").trim().slice(0, 120);
    if (!name) throw new Error("Display name is required.");
    if (!["salesperson", "supervisor", "admin"].includes(v.role)) throw new Error("Pick a user type: Salesman, Supervisor or Admin.");
    const email = String(v.email || "").trim().slice(0, 200);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email doesn't look like an email address.");
    const phone = String(v.phone || "").trim().slice(0, 40);
    if (userId === staff.userId && (v.role !== "admin" || !v.is_active)) throw new Error("You can't remove your own Admin type or deactivate yourself.");
    const admin = createSupabaseAdminClient();
    const username = String(v.username ?? "").trim();
    if (username) {
      if (!USERNAME_RE.test(username)) throw new Error("Username must be 3–80 characters: letters, numbers, . _ - + @ (no spaces).");
      const uErr = await setUsername(admin, userId, username);
      if (uErr) throw new Error(uErr);
    }
    const loginEmail = String(v.login_email ?? "").trim().toLowerCase();
    const newPassword = String(v.new_password ?? "");
    if (newPassword && (newPassword.length < 8 || newPassword.length > 72)) throw new Error("New password must be 8–72 characters.");
    if (loginEmail || newPassword) {
      if (loginEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(loginEmail)) throw new Error("Login email doesn't look like an email address.");
      const { data: cur } = await admin.auth.admin.getUserById(userId);
      const patch: { email?: string; email_confirm?: boolean; password?: string } = {};
      if (loginEmail && (cur?.user?.email ?? "").toLowerCase() !== loginEmail) { patch.email = loginEmail; patch.email_confirm = true; }
      if (newPassword) patch.password = newPassword;
      if (Object.keys(patch).length) {
        const { error: aErr } = await admin.auth.admin.updateUserById(userId, patch);
        if (aErr) throw new Error(aErr.message.toLowerCase().includes("already") ? "That login email is already used by another account." : "Could not update the login email/password.");
      }
    }
    const { error } = await admin.from("user_profiles")
      .update({ display_name: name, role: v.role, is_active: !!v.is_active, can_claim_unassigned: !!v.can_claim_unassigned, can_view_cards: !!v.can_view_cards, phone: phone || null })
      .eq("user_id", userId);
    if (error) throw new Error("Could not save the user.");
    // Phone / email / rotation live on the rep record (shown on that rep's customer documents).
    const repFields = { name, email: email || null, phone: phone || null, in_rotation: !!v.in_rotation && !!v.is_active, is_active: !!v.is_active };
    const { data: existing } = await admin.from("crm_reps").select("id").eq("user_id", userId).maybeSingle();
    const { error: repErr } = existing
      ? await admin.from("crm_reps").update(repFields).eq("id", existing.id)
      : await admin.from("crm_reps").insert({ ...repFields, user_id: userId });
    if (repErr) throw new Error("Saved the user, but could not save phone/email/rotation.");
    revalidatePath("/admin-menu/maintenance");
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

export type NewUserInput = {
  display_name: string; email: string; username?: string; phone?: string; role: UserType;
  can_view_cards: boolean; can_claim_unassigned: boolean; is_active?: boolean;
};

/** Add User (manual): Auth login + user_profiles + username + rep record. */
export async function addUser(v: NewUserInput & { password: string; send_welcome: boolean }) {
  try {
    await requireAdmin();
    const p = parseMember(v);
    if (!p.ok) throw new Error(p.error);
    const admin = createSupabaseAdminClient();
    const r = await createMember(admin, p.m, String(v.password ?? ""), !!v.send_welcome);
    if (!r.ok) throw new Error(r.error);
    if (v.is_active === false) {
      await admin.from("user_profiles").update({ is_active: false }).eq("user_id", r.userId);
      await admin.from("crm_reps").update({ is_active: false, in_rotation: false }).eq("user_id", r.userId);
    }
    revalidatePath("/admin-menu/maintenance");
    return { ok: true as const, mailed: r.mailed };
  } catch (e) { return fail(e); }
}

/** Invite: CRM welcome email with CRM URL + Network ID/Password + password/username setup link. */
export async function inviteUser(v: NewUserInput) {
  try {
    await requireAdmin();
    const p = parseMember(v);
    if (!p.ok) throw new Error(p.error);
    const r = await inviteMember(createSupabaseAdminClient(), p.m);
    if (!r.ok) throw new Error(r.error);
    revalidatePath("/admin-menu/maintenance");
    return { ok: true as const, mailed: r.mailed };
  } catch (e) { return fail(e); }
}

/** Hard delete (Auth + profile + username). Blocks self; users with CRM history must be disabled instead. */
export async function deleteUser(userId: string) {
  try {
    const staff = await requireAdmin();
    const r = await deleteMember(createSupabaseAdminClient(), staff.userId, userId);
    if (!r.ok) throw new Error(r.error);
    revalidatePath("/admin-menu/maintenance");
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
