import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendMail, sender } from "@/lib/mailer";
import { crmUrl, isEmail, isTeamRole, normalizeTeamPhone, welcomeEmail, type TeamRole, type WelcomeInput } from "@/lib/team-invite";

/**
 * Shared user administration (Maintenance → Users is the primary UI).
 * All functions assume the caller already verified the actor is an active admin.
 */
export type MemberInput = {
  email: string; displayName: string; role: TeamRole; phone: string | null;
  can_view_cards: boolean; can_claim_unassigned: boolean; username: string;
};
export type AdminResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const USERNAME_RE = /^[A-Za-z0-9._@+-]{3,80}$/;

export function parseMember(raw: { email?: unknown; display_name?: unknown; role?: unknown; phone?: unknown; can_view_cards?: unknown; can_claim_unassigned?: unknown; username?: unknown }): AdminResult<{ m: MemberInput }> {
  const email = String(raw.email ?? "").trim().toLowerCase();
  const displayName = String(raw.display_name ?? "").trim();
  const role = String(raw.role ?? "salesperson");
  const phone = normalizeTeamPhone(String(raw.phone ?? ""));
  const username = String(raw.username ?? "").trim() || email;
  if (!isEmail(email)) return { ok: false, error: "Enter a valid email address." };
  if (!displayName || displayName.length > 120) return { ok: false, error: "Display name is required (max 120 characters)." };
  if (!isTeamRole(role)) return { ok: false, error: "Pick a user type: Admin, Supervisor or Salesman." };
  if (phone === null) return { ok: false, error: "Phone must be 10 digits (or leave it blank)." };
  if (!USERNAME_RE.test(username)) return { ok: false, error: "Username must be 3–80 characters: letters, numbers, . _ - + @ (no spaces)." };
  const flag = (v: unknown) => v === true || v === "on" || v === "true";
  return { ok: true, m: { email, displayName, role, phone: phone || null, username, can_view_cards: flag(raw.can_view_cards), can_claim_unassigned: flag(raw.can_claim_unassigned) } };
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const already = (msg?: string) => (msg ?? "").toLowerCase().includes("already");

function networkDetails() {
  return { networkId: process.env.NETWORK_ID?.trim() || null, networkPassword: process.env.NETWORK_PASSWORD || null };
}

async function sendWelcome(to: string, input: WelcomeInput) {
  const mail = welcomeEmail(input);
  const from = sender({}, null);
  const res = await sendMail({ from: { name: from.name, address: from.address }, replyTo: from.replyTo, to, ...mail }).catch(() => null);
  return !!res?.ok;
}

/** Username → user_identities (login uses it). Returns an error string on conflict. */
export async function setUsername(admin: Admin, userId: string, username: string): Promise<string | null> {
  const { data: taken } = await admin.from("user_identities").select("user_id").eq("username", username).maybeSingle();
  if (taken && taken.user_id !== userId) return "That username is already taken.";
  if (taken) return null;
  const { data: mine } = await admin.from("user_identities").select("id").eq("user_id", userId).maybeSingle();
  const { error } = mine
    ? await admin.from("user_identities").update({ username }).eq("id", mine.id)
    : await admin.from("user_identities").insert({ user_id: userId, username });
  return error ? "Could not save the username." : null;
}

/** Rep record (phone/email shown on customer docs, rotation). */
export async function syncRep(admin: Admin, userId: string, f: { name: string; email: string | null; phone: string | null; is_active: boolean; in_rotation?: boolean }) {
  const { data: existing } = await admin.from("crm_reps").select("id, in_rotation").eq("user_id", userId).maybeSingle();
  const fields = { name: f.name, email: f.email, phone: f.phone, is_active: f.is_active, in_rotation: f.is_active && (f.in_rotation ?? !!existing?.in_rotation) };
  const { error } = existing
    ? await admin.from("crm_reps").update(fields).eq("id", existing.id)
    : await admin.from("crm_reps").insert({ ...fields, user_id: userId });
  return !error;
}

async function insertProfile(admin: Admin, userId: string, m: MemberInput): Promise<string | null> {
  const { error } = await admin.from("user_profiles").insert({
    user_id: userId, display_name: m.displayName, role: m.role, is_active: true,
    phone: m.phone, can_view_cards: m.can_view_cards, can_claim_unassigned: m.can_claim_unassigned,
  });
  if (error) return "The CRM profile could not be saved.";
  const uErr = await setUsername(admin, userId, m.username);
  if (uErr) { await admin.from("user_profiles").delete().eq("user_id", userId); return uErr; }
  await syncRep(admin, userId, { name: m.displayName, email: m.email, phone: m.phone, is_active: true, in_rotation: false });
  return null;
}

/** Invite: generate the invite link and send ONE CRM welcome email (CRM URL + Network ID/Password + setup link). */
export async function inviteMember(admin: Admin, m: MemberInput): Promise<AdminResult<{ userId: string; mailed: boolean }>> {
  const { data: clash } = await admin.from("user_identities").select("user_id").eq("username", m.username).maybeSingle();
  if (clash) return { ok: false, error: "That username is already taken." };
  const url = crmUrl();
  const redirectTo = `${url}/auth/callback?next=/set-password`;
  let userId: string | undefined, mailed = false;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "invite", email: m.email, options: { redirectTo, data: { display_name: m.displayName } } });
  if (!linkErr && link?.user && link.properties?.action_link) {
    userId = link.user.id;
    mailed = await sendWelcome(m.email, { displayName: m.displayName, email: m.email, url, ...networkDetails(), setupLink: link.properties.action_link });
    if (!mailed) { await admin.auth.admin.deleteUser(userId); userId = undefined; }
  } else if (already(linkErr?.message)) {
    return { ok: false, error: "That email already has an account." };
  }
  if (!userId) {
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(m.email, { redirectTo, data: { display_name: m.displayName } });
    if (error || !invited.user) return { ok: false, error: already(error?.message) ? "That email already has an account." : "The invitation could not be sent. Check Supabase Auth email settings and redirect URLs." };
    userId = invited.user.id;
    mailed = await sendWelcome(m.email, { displayName: m.displayName, email: m.email, url, ...networkDetails(), setupLink: null, tempPassword: null });
  }
  const pErr = await insertProfile(admin, userId, m);
  if (pErr) { await admin.auth.admin.deleteUser(userId); return { ok: false, error: `${pErr} The incomplete invite was removed; try again.` }; }
  return { ok: true, userId, mailed };
}

/** Manual add: login works immediately with username (or email) + password. */
export async function createMember(admin: Admin, m: MemberInput, password: string, welcome: boolean): Promise<AdminResult<{ userId: string; mailed: boolean }>> {
  if (password.length < 8 || password.length > 72) return { ok: false, error: "Password must be 8–72 characters." };
  const { data: clash } = await admin.from("user_identities").select("user_id").eq("username", m.username).maybeSingle();
  if (clash) return { ok: false, error: "That username is already taken." };
  const { data: created, error } = await admin.auth.admin.createUser({ email: m.email, password, email_confirm: true, user_metadata: { display_name: m.displayName } });
  if (error || !created.user) return { ok: false, error: already(error?.message) ? "That email already has an account." : "The user could not be created." };
  const pErr = await insertProfile(admin, created.user.id, m);
  if (pErr) { await admin.auth.admin.deleteUser(created.user.id); return { ok: false, error: pErr }; }
  let mailed = false;
  if (welcome) mailed = await sendWelcome(m.email, { displayName: m.displayName, email: m.email, url: crmUrl(), ...networkDetails(), tempPassword: password, username: m.username });
  return { ok: true, userId: created.user.id, mailed };
}

/** Hard delete: Auth user (profile + username cascade). Fails if the user owns CRM history → disable instead. */
export async function deleteMember(admin: Admin, actorId: string, userId: string): Promise<AdminResult> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { ok: false, error: "Unknown user." };
  if (userId === actorId) return { ok: false, error: "You can't delete yourself." };
  const { data: rep } = await admin.from("crm_reps").select("id").eq("user_id", userId).maybeSingle();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return { ok: false, error: "This user can't be deleted because they have CRM history (leads, notes, payments…). Disable them instead — they won't be able to sign in." };
  }
  if (rep) await admin.from("crm_reps").update({ is_active: false, in_rotation: false }).eq("id", rep.id);
  return { ok: true };
}
