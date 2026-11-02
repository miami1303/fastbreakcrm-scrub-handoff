"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NETWORK_COOKIE, networkSecret } from "@/lib/network-gate";
import { ACTIVITY_COOKIE, activityCookieOptions, signActivityToken } from "@/lib/idle-session";
import { createSupabaseServerClient } from "@/lib/supabase";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { USERNAME_RE, setUsername } from "@/lib/team-admin";

export async function signIn(formData: FormData) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    redirect("/user-login?error=configuration");
  }

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) redirect("/user-login?error=missing");

  // Resolve username to Supabase Auth user email via user_identities table
  let authEmail: string | null = null;
  let userId: string | null = null;

  try {
    const admin = createSupabaseAdminClient();
    // Usernames are CASE-SENSITIVE and compared exactly ("Sam" works, "mark" does not).
    // Only surrounding spaces are trimmed (above); nothing is lowercased.
    const { data: match, error } = await admin
      .from("user_identities")
      .select("user_id")
      .eq("username", username)
      .maybeSingle();

    let matchId = match?.user_id as string | undefined;
    // Fallback: invited users may sign in with their email as username (matched case-insensitively
    // against the profile's login email).
    if (!error && !matchId && username.includes("@")) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const hit = (list?.users ?? []).find(u => (u.email ?? "").toLowerCase() === username.toLowerCase());
      if (hit) {
        const { data: prof } = await admin.from("user_profiles").select("user_id").eq("user_id", hit.id).maybeSingle();
        if (prof) matchId = hit.id;
      }
    }
    if (error || !matchId) {
      redirect("/user-login?error=credentials");
    }

    userId = matchId;

    // Look the auth user up by ID (secure service-role only lookup)
    const { data: authData, error: authError } = await admin.auth.admin.getUserById(matchId);
    if (authError || !authData.user?.email) {
      redirect("/user-login?error=credentials");
    }

    authEmail = authData.user.email;
  } catch (error) {
    redirect("/user-login?error=credentials");
  }

  // Now authenticate with Supabase using the resolved email and provided password
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
  if (error) redirect("/user-login?error=credentials");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/user-login?error=credentials");

  // Verify user profile exists and is active
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active) {
    await supabase.auth.signOut();
    redirect("/user-login?error=access");
  }

  // Admins, supervisors and reps all land on the main menu hub.
  if (["admin", "supervisor", "salesperson"].includes(profile.role)) { await markActive(); redirect("/user-menu"); }

  await supabase.auth.signOut();
  redirect("/user-login?error=access");
}

export async function setInitialPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirm_password") ?? "");
  if (password.length < 12 || password.length > 128) redirect("/set-password?error=missing");
  if (password !== confirmation) redirect("/set-password?error=mismatch");

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/user-login?error=access");

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active) {
    await supabase.auth.signOut();
    redirect("/user-login?error=access");
  }

  const username = String(formData.get("username") ?? "").trim();
  if (username) {
    if (!USERNAME_RE.test(username)) redirect("/set-password?error=username");
    const taken = await setUsername(createSupabaseAdminClient(), user.id, username).catch(() => "err");
    if (taken) redirect("/set-password?error=username_taken");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/set-password?error=save");

  if (["admin", "supervisor", "salesperson"].includes(profile.role)) { await markActive(); redirect("/user-menu"); }
  await supabase.auth.signOut();
  redirect("/user-login?error=access");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  // Log Out starts over at the Network Login.
  (await cookies()).delete(NETWORK_COOKIE);
  (await cookies()).delete(ACTIVITY_COOKIE);
  redirect("/");
}

/** Fresh sign-in counts as activity (starts the idle timer; see lib/idle-session.ts). */
async function markActive() {
  const secret = networkSecret();
  if (secret) (await cookies()).set(ACTIVITY_COOKIE, await signActivityToken(secret), activityCookieOptions());
}
