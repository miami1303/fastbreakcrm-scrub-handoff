import test from "node:test";
import assert from "node:assert/strict";
import { networkSecret, signNetworkToken, verifyNetworkToken, NETWORK_MAX_AGE_MS } from "../lib/network-gate.ts";
import { checkNetworkCredentials, rateLimited, recordFailure, clearFailures } from "../lib/network-auth.ts";

const env = { NETWORK_ID: "FastBreak", NETWORK_PASSWORD: "S3cret-Pass" };

test("network credentials: ID trimmed + case-insensitive, password exact, fail closed", () => {
  assert.equal(checkNetworkCredentials("FastBreak", "S3cret-Pass", env), "ok");
  assert.equal(checkNetworkCredentials("  fastbreak ", "S3cret-Pass", env), "ok");
  assert.equal(checkNetworkCredentials("FastBreak", "s3cret-pass", env), "bad");
  assert.equal(checkNetworkCredentials("FastBreak", "S3cret-Pass ", env), "bad");
  assert.equal(checkNetworkCredentials("Other", "S3cret-Pass", env), "bad");
  assert.equal(checkNetworkCredentials("", "", env), "bad");
  assert.equal(checkNetworkCredentials("FastBreak", "S3cret-Pass", {}), "not_configured");
  assert.equal(checkNetworkCredentials("FastBreak", "S3cret-Pass", { NETWORK_ID: "FastBreak" }), "not_configured");
  assert.equal(checkNetworkCredentials("x", "", { NETWORK_PASSWORD: "S3cret-Pass" }), "not_configured");
});

test("network cookie: HMAC-signed token, forged / old / other-secret tokens rejected", async () => {
  const secret = networkSecret({ ...env, CARD_ENCRYPTION_KEY: "k".repeat(44) });
  const now = Date.now();
  const tok = await signNetworkToken(secret, now);
  assert.match(tok, /^v1\.\d+\.[\w-]+$/);
  assert.equal(await verifyNetworkToken(tok, secret, now), true);
  assert.equal(await verifyNetworkToken("fastbreak", secret, now), false);
  assert.equal(await verifyNetworkToken(tok.replace(/.$/, c => (c === "A" ? "B" : "A")), secret, now), false);
  assert.equal(await verifyNetworkToken(tok.replace(`v1.${now}.`, `v1.${now + 1}.`), secret, now), false);
  assert.equal(await verifyNetworkToken(tok, networkSecret({ NETWORK_SESSION_SECRET: "other" }), now), false);
  assert.equal(await verifyNetworkToken(tok, secret, now + NETWORK_MAX_AGE_MS + 1), false, "expires after a day");
  assert.equal(await verifyNetworkToken(tok, null, now), false);
  assert.equal(await verifyNetworkToken(undefined, secret, now), false);
});

test("network secret: NETWORK_SESSION_SECRET, else CARD_ENCRYPTION_KEY, else NETWORK_PASSWORD, else none", () => {
  assert.match(networkSecret({ NETWORK_SESSION_SECRET: "a", CARD_ENCRYPTION_KEY: "b", NETWORK_PASSWORD: "c" }), /session\|a$/);
  assert.match(networkSecret({ CARD_ENCRYPTION_KEY: "b", NETWORK_PASSWORD: "c" }), /card\|b$/);
  assert.match(networkSecret({ NETWORK_PASSWORD: "c" }), /pass\|c$/);
  assert.equal(networkSecret({}), null);
});

test("rate limit: 8 failures per IP in 15 minutes", () => {
  const ip = "203.0.113.9", t = 1_000_000;
  clearFailures(ip);
  for (let i = 0; i < 8; i++) { assert.equal(rateLimited(ip, t), false); recordFailure(ip, t); }
  assert.equal(rateLimited(ip, t), true);
  assert.equal(rateLimited(ip, t + 15 * 60 * 1000 + 1), false, "window passes");
  clearFailures(ip);
});
