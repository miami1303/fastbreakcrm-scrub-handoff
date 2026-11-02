// Session rules (Owner 2026-11-01):
// - Stay logged in indefinitely while the CRM is open during the day.
// - All users are signed out at midnight America/Chicago so they re-login the next day if needed.
// The old 30-minute idle timer is turned off.
import { signNetworkToken, verifyNetworkToken } from "./network-gate";

export const IDLE_TIMEOUT_MINUTES = 24 * 60; // effectively disabled for normal use
export const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60_000;
export const SERVER_IDLE_GRACE_MS = 60 * 60_000;
export const ACTIVITY_COOKIE = "crm_active";
export const LAST_ACTIVITY_KEY = "crm:last-activity";
export const ACTIVITY_PING_MS = 5 * 60_000; // renew less often; not tied to logout

export function isIdle(_lastActivity: number, _now: number, _timeoutMs = IDLE_TIMEOUT_MS): boolean {
  return false; // daytime idle logout disabled
}

export function latestActivity(local: number, shared: string | null | undefined): number {
  const s = Number(shared);
  return Number.isFinite(s) && s > local ? s : local;
}

const activitySecret = (secret: string) => `${secret}|activity-v1`;

export function signActivityToken(secret: string, at = Date.now()): Promise<string> {
  return signNetworkToken(activitySecret(secret), at);
}

export function verifyActivityToken(token: string | null | undefined, secret: string | null, now = Date.now(), maxAgeMs = 36 * 60 * 60_000): Promise<boolean> {
  return verifyNetworkToken(token, secret ? activitySecret(secret) : null, now, maxAgeMs);
}

export const activityCookieOptions = () => ({
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/",
  maxAge: 36 * 60 * 60,
});
