"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NETWORK_COOKIE, networkSecret } from "@/lib/network-gate";
import { ACTIVITY_COOKIE, activityCookieOptions, signActivityToken } from "@/lib/idle-session";
import { createSupabaseServerClient } from "@/lib/supabase";

/** Renew the server-side activity cookie (called by IdleSignOut only after real user input). */
export async function touchActivity(): Promise<void> {
  const secret = networkSecret();
  if (!secret) return;
  (await cookies()).set(ACTIVITY_COOKIE, await signActivityToken(secret), activityCookieOptions());
}

/** Idle timeout reached: end this browser's session only (other devices stay signed in). */
export async function signOutIdle(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  const jar = await cookies();
  jar.delete(NETWORK_COOKIE);
  jar.delete(ACTIVITY_COOKIE);
  redirect("/?error=idle");
}
