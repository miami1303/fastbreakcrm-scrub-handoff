import { createClient } from "@supabase/supabase-js";

/**
 * Secure, server-only helper to resolve a username to its Supabase Auth user.
 * This function is not exported to the client and must only run on the server.
 * Requires SUPABASE_SERVICE_ROLE_KEY environment variable.
 */
export async function resolveUsernameToAuth(username: string): Promise<{ userId: string; email: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  try {
    const admin = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    // Look up the username in the user_identities table
    const { data, error } = await admin
      .from("user_identities")
      .select("user_id")
      .eq("username", username.trim()) // exact, case-sensitive
      .maybeSingle();

    const match = data;
    if (error || !match) {
      return null;
    }

    // Retrieve the Auth user by ID to get their email
    const { data: authUsers, error: authError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 500,
    });

    if (authError || !authUsers) {
      return null;
    }

    const authUser = authUsers.users.find((u) => u.id === match.user_id);
    if (!authUser?.email) {
      return null;
    }

    return {
      userId: match.user_id,
      email: authUser.email,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Server-only helper to create a username identity mapping.
 * Requires the user to already exist in Supabase Auth and public.user_profiles.
 * Idempotent: safe to call multiple times with the same username.
 * Requires SUPABASE_SERVICE_ROLE_KEY environment variable.
 */
export async function createUsernameMapping(
  userId: string,
  username: string
): Promise<{ success: boolean; error?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return { success: false, error: "Service configuration missing" };
  }

  try {
    const admin = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    // Check if the mapping already exists
    const { data: existing } = await admin
      .from("user_identities")
      .select("id")
      .eq("username", username.trim())
      .maybeSingle();

    if (existing) {
      // Idempotent: mapping already exists, return success
      return { success: true };
    }

    // Verify the user exists in auth.users
    const { data: authUsers, error: authError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 500,
    });

    if (authError || !authUsers) {
      return { success: false, error: "Unable to verify user in auth" };
    }

    const authUser = authUsers.users.find((u) => u.id === userId);
    if (!authUser) {
      return { success: false, error: "User not found in Supabase Auth" };
    }

    // Verify the user exists in user_profiles
    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError || !profile) {
      return { success: false, error: "User profile not found" };
    }

    // Create the username mapping
    const { error: insertError } = await admin.from("user_identities").insert({
      user_id: userId,
      username: username,
    });

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
