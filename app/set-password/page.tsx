import { setInitialPassword } from "@/app/actions/auth";
import BrandLogo from "@/app/components/BrandLogo";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  let current = "";
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from("user_identities").select("username").eq("user_id", user.id).maybeSingle();
      current = data?.username || user.email || "";
    }
  } catch { /* page still renders */ }
  const messages: Record<string, string> = {
    missing: "Enter a password at least 12 characters long and confirm it.",
    mismatch: "The passwords do not match.",
    access: "This invitation is no longer active. Contact your administrator for a new invitation.",
    username: "Usernames are 3–80 characters: letters, numbers, . _ - + @ (no spaces).",
    username_taken: "That username is already taken. Pick another one.",
    save: "The password could not be saved. Please try again.",
  };
  return (
    <main className="auth-layout">
      <section className="auth-card">
        <BrandLogo height={64} />
        <p className="eyebrow">ACCOUNT SETUP</p>
        <h1>Choose your<br />username &amp; password</h1>
        <p className="muted">Pick the username you&apos;ll type at User Login (case-sensitive) and a password with at least 12 characters.</p>
        {error && <p className="form-error" role="alert">{messages[error] ?? "Account setup could not be completed."}</p>}
        <form action={setInitialPassword} className="login-form">
          <label htmlFor="username">Username</label>
          <input id="username" name="username" type="text" autoComplete="username" minLength={3} maxLength={80} pattern="[A-Za-z0-9._@+\-]{3,80}" defaultValue={current} required />
          <label htmlFor="password">New password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
          <label htmlFor="confirm_password">Confirm password</label>
          <input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
          <button className="primary-button" type="submit">Set password and continue</button>
        </form>
      </section>
    </main>
  );
}
