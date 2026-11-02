// Run: npx -y node@22 --experimental-strip-types tests/card-crypto.test.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cardKeyFromEnv, decryptCardSecret, encryptCardSecret, luhnValid } from "../lib/card-crypto.ts";

const key = randomBytes(32);
const secret = { number: "4111111111111111", cvv: "123" };
const enc = encryptCardSecret(secret, key);
assert.ok(enc.startsWith("v1:"));
assert.ok(!enc.includes("4111111111111111"), "ciphertext must not contain the card number");
assert.notEqual(enc, encryptCardSecret(secret, key), "random IV per encryption");
assert.deepEqual(decryptCardSecret(enc, key), secret);
assert.throws(() => decryptCardSecret(enc, randomBytes(32)), "wrong key fails");
const parts = enc.split(":"); parts[3] = Buffer.from("tampered").toString("base64");
assert.throws(() => decryptCardSecret(parts.join(":"), key), "tampering fails");
assert.equal(cardKeyFromEnv(""), null);
assert.equal(cardKeyFromEnv("short"), null);
assert.equal(cardKeyFromEnv(key.toString("base64"))?.length, 32);
assert.equal(cardKeyFromEnv(key.toString("hex"))?.length, 32);
assert.equal(luhnValid("4111111111111111"), true);
assert.equal(luhnValid("4111111111111112"), false);
console.log("card-crypto: all tests passed");
