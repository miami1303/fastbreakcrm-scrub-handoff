// Pure helpers for Team Management: welcome email body + input validation.
export type TeamRole = "admin" | "supervisor" | "salesperson";
export const TEAM_ROLES: TeamRole[] = ["admin", "supervisor", "salesperson"];
export const isTeamRole = (v: string): v is TeamRole => TEAM_ROLES.includes(v as TeamRole);
export const isEmail = (v: string) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function crmUrl(env: Record<string, string | undefined> = process.env) {
  return (env.NEXT_PUBLIC_SITE_URL || "https://crm.fastbreakcrm.test").trim().replace(/\/$/, "");
}

/** Normalizes a US phone to 555-010-0103 style; returns "" for blank, null for invalid. */
export function normalizeTeamPhone(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export type WelcomeInput = {
  displayName: string; email: string; url: string;
  networkId?: string | null; networkPassword?: string | null;
  /** Supabase password-setup link (invite). Omit when the admin set a password manually. */
  setupLink?: string | null;
  /** Manual add: the admin-chosen temporary password. */
  tempPassword?: string | null;
  /** CRM username for User Login (defaults to the email). */
  username?: string | null;
};

export function welcomeEmail(i: WelcomeInput) {
  const login = i.username && i.username !== i.email ? `username "${i.username}" (or your email ${i.email})` : `your email (${i.email})`;
  const net = i.networkId ? `Network ID: ${i.networkId}\nNetwork Password: ${i.networkPassword || "(ask your administrator)"}` : "Network ID / Password: ask your administrator";
  const step2 = i.setupLink
    ? `2. Set your password using this secure link (one-time): ${i.setupLink}\n3. You'll also pick your username there. Then sign in at User Login with that username (or your email ${i.email}) and password.`
    : `2. User Login: sign in with ${login}${i.tempPassword ? ` and temporary password: ${i.tempPassword}` : " and the password your administrator gave you"}.\n3. Change your password from your user menu after the first sign-in.`;
  const text = `Hi ${i.displayName},\n\nWelcome to the Fast Break Team! You've been added to the Fastbreak CRM.\n\nCRM: ${i.url}\n${net}\n\nHow to sign in:\n1. Network Login comes first: open ${i.url} and enter the Network ID and Network Password above.\n${step2}\n\nFastbreak CRM`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5"><img src="${esc(i.url)}/brand/fastbreak-logo.png" alt="Fastbreak CRM" height="64" style="display:block;margin:0 0 16px"><h2 style="margin:0 0 12px">Welcome to the Fast Break Team!</h2>` +
    esc(text).split("\n").map(l => l.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')).join("<br>") + `</div>`;
  return { subject: "Welcome to the Fast Break Team — your CRM access", text, html };
}
