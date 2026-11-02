import BrandLogo from "@/app/components/BrandLogo";
import { enterNetwork } from "@/app/actions/network";

const messages: Record<string, string> = {
  missing: "Enter the Network ID and Password.",
  credentials: "Network ID or password is incorrect.",
  locked: "Too many attempts. Wait a few minutes and try again.",
  configuration: "Network login is not configured. Contact an administrator.",
  idle: "You were signed out due to inactivity. Sign in again to continue.",
};

// Network Login: the company login. Network ID + Network Password (checked server-side), then
// User Login. Never auto-forwards (see middleware.ts / lib/network-gate.ts).
export default async function NetworkLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="auth-layout">
      <section className="auth-card" data-testid="network-login">
        <BrandLogo height={64} />
        <p className="eyebrow">NETWORK LOGIN</p>
        <h1>Fast Break<br />Auto Trans CRM</h1>
        <p className="muted">Enter your company Network ID and Password to continue.</p>
        {error && <p className="form-error" role="alert" data-testid="network-error">{messages[error] ?? "Unable to continue."}</p>}
        <form action={enterNetwork} className="login-form" data-testid="network-form">
          <label htmlFor="network_id">Network ID</label>
          <input id="network_id" name="network_id" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={200} data-testid="network-id" />
          <label htmlFor="network_password">Password</label>
          <input id="network_password" name="network_password" type="password" autoComplete="current-password" required maxLength={500} data-testid="network-password" />
          <button className="primary-button" type="submit" data-testid="network-choice">Continue</button>
        </form>
        <p className="secure-note">Authorized team members only</p>
      </section>
    </main>
  );
}
