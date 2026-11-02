// App-level encryption for full card details (number + CVV).
// AES-256-GCM with a 32-byte key from CARD_ENCRYPTION_KEY (base64 or 64 hex chars).
// The key lives only in the server environment (Vercel env var), never in the database,
// the repo, or logs. Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Stored format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>".
// Server-only: import this from server actions / route handlers only.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type AchSecret = { bank: string; routing: string; account: string };
/** number/cvv for a card; ach for a bank account; country = billing country (not a DB column). */
export type CardSecret = { number: string; cvv: string; ach?: AchSecret; country?: string };

export function cardKeyFromEnv(raw = process.env.CARD_ENCRYPTION_KEY): Buffer | null {
  const value = (raw || "").trim();
  if (!value) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

export function encryptCardSecret(secret: CardSecret, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptCardSecret(payload: string, key: Buffer): CardSecret {
  const [version, iv, tag, ct] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported card payload");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(pt);
  const ach = parsed.ach && typeof parsed.ach === "object"
    ? { bank: String(parsed.ach.bank || ""), routing: String(parsed.ach.routing || ""), account: String(parsed.ach.account || "") }
    : undefined;
  return { number: String(parsed.number || ""), cvv: String(parsed.cvv || ""), ...(ach ? { ach } : {}), ...(parsed.country ? { country: String(parsed.country) } : {}) };
}

export function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Luhn checksum, used to catch typos in the card number before saving. */
export function luhnValid(number: string): boolean {
  if (!/^\d{12,19}$/.test(number)) return false;
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let d = number.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
