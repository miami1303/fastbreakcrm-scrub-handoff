// Network Login gate (Owner, 2026-10-23): the COMPANY login. / asks for the Network ID and
// Network Password (env NETWORK_ID / NETWORK_PASSWORD, checked server-side in
// app/actions/network.ts). On success the browser gets a session cookie holding an HMAC-signed
// token; middleware verifies the signature (Web Crypto, edge-safe) before /user-login or any CRM
// page, so the cookie can't be made by hand. Log Out clears it.
export const NETWORK_COOKIE = "crm_network";
const SUBJECT = "fastbreak";
/** A network sign-in is good for one working day even if the browser stays open. */
export const NETWORK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Signing secret: NETWORK_SESSION_SECRET, else derived from CARD_ENCRYPTION_KEY, else from NETWORK_PASSWORD. */
export function networkSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.NETWORK_SESSION_SECRET?.trim();
  if (s) return `crm-network-v1|session|${s}`;
  const k = env.CARD_ENCRYPTION_KEY?.trim();
  if (k) return `crm-network-v1|card|${k}`;
  const p = env.NETWORK_PASSWORD;
  if (p) return `crm-network-v1|pass|${p}`;
  return null;
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => {
  let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
const hmacKey = (secret: string) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

/** v1.<issuedAtMs>.<HMAC-SHA256("fastbreak.<issuedAtMs>")> */
export async function signNetworkToken(secret: string, issuedAt = Date.now()): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${SUBJECT}.${issuedAt}`));
  return `v1.${issuedAt}.${b64url(sig)}`;
}

/** Signature check (constant-time inside subtle.verify) + not older than NETWORK_MAX_AGE_MS. */
export async function verifyNetworkToken(token: string | null | undefined, secret: string | null, now = Date.now(), maxAgeMs = NETWORK_MAX_AGE_MS): Promise<boolean> {
  if (!token || !secret) return false;
  const m = /^v1\.(\d{10,16})\.([A-Za-z0-9_-]{20,})$/.exec(token);
  if (!m) return false;
  const iat = Number(m[1]);
  if (!(iat <= now + 60_000 && now - iat < maxAgeMs)) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(m[2]), enc.encode(`${SUBJECT}.${iat}`));
  } catch {
    return false;
  }
}
