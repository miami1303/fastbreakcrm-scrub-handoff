import { createHash } from "node:crypto";

export const INTAKE_RATE_LIMIT = 12;
export const INTAKE_RATE_WINDOW_MS = 60 * 60 * 1000;

const buckets = new Map<string, number[]>();

export function intakeSourceKey(ip: string): string {
  return createHash("sha256").update(`website-intake:${ip}`).digest("hex");
}

export function clearMemoryRateLimits(): void {
  buckets.clear();
}

/** In-memory fallback used when the rate-limit table is not available yet. */
export function consumeMemoryRate(
  key: string,
  now: number,
  limit = INTAKE_RATE_LIMIT,
  windowMs = INTAKE_RATE_WINDOW_MS,
): { allowed: boolean; count: number } {
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return { allowed: false, count: recent.length };
  }
  recent.push(now);
  buckets.set(key, recent);
  return { allowed: true, count: recent.length };
}

export function isOverIntakeRate(count: number, limit = INTAKE_RATE_LIMIT): boolean {
  return count >= limit;
}
