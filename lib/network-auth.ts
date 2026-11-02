// Server-only Network ID / Network Password check (Node crypto).
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest(); // equal-length buffers

export type NetworkCheck = "ok" | "bad" | "not_configured";

/** Network ID: trimmed, case-insensitive. Password: exact. Missing env -> fail closed. */
export function checkNetworkCredentials(id: string, password: string, env: Record<string, string | undefined> = process.env): NetworkCheck {
  const wantId = env.NETWORK_ID?.trim();
  const wantPass = env.NETWORK_PASSWORD;
  if (!wantId || !wantPass) return "not_configured";
  const idOk = timingSafeEqual(digest(String(id || "").trim().toLowerCase()), digest(wantId.toLowerCase()));
  const passOk = timingSafeEqual(digest(String(password || "")), digest(wantPass));
  return idOk && passOk ? "ok" : "bad";
}

// Simple per-IP limiter (in memory, per server instance): 8 failures per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 8;
const fails = new Map<string, number[]>();
export function rateLimited(ip: string, now = Date.now()): boolean {
  const list = (fails.get(ip) || []).filter(t => now - t < WINDOW_MS);
  fails.set(ip, list);
  return list.length >= MAX_FAILS;
}
export function recordFailure(ip: string, now = Date.now()) {
  const list = (fails.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  fails.set(ip, list);
  if (fails.size > 5000) fails.clear();
}
export function clearFailures(ip: string) { fails.delete(ip); }
