import Link from "next/link";
import { signIn } from "@/app/actions/auth";

const messages: Record<string, string> = {
  missing: "Enter your username and password.",
  credentials: "Username or password was not recognized.",
  access: "Your account is not active for this CRM. Contact an administrator.",
  configuration: "Login is temporarily unavailable. CRM authentication is not configured.",
};

export default async function UserLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="auth-layout">
      <section className="auth-card">
        <Link className="back-link" href="/">← Network Login</Link>
        <p className="eyebrow">USER LOGIN</p>
        <h1>Sign in to your<br />CRM account</h1>
        <p className="muted">Use your authorized Fast Break account.</p>
        {error && <p className="form-error" role="alert">{messages[error] ?? "Unable to sign in."}</p>}
        <form action={signIn} className="login-form">
          <label htmlFor="username">Username</label>
          <input id="username" name="username" type="text" autoComplete="username" required maxLength={120} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button className="primary-button" type="submit">Sign in</button>
        </form>
        <p className="secure-note">Your session is protected with secure, server-managed authentication.</p>
      </section>
    </main>
  );
}
