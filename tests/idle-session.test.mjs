import test from "node:test";
import assert from "node:assert/strict";
import { IDLE_TIMEOUT_MINUTES, IDLE_TIMEOUT_MS, SERVER_IDLE_GRACE_MS, isIdle, latestActivity, signActivityToken, verifyActivityToken } from "../lib/idle-session.ts";
import { signNetworkToken, verifyNetworkToken } from "../lib/network-gate.ts";

test("idle timeout is 30 minutes", () => {
  assert.equal(IDLE_TIMEOUT_MINUTES, 30);
  const t0 = 1_800_000_000_000;
  assert.equal(isIdle(t0, t0 + IDLE_TIMEOUT_MS - 1), false);
  assert.equal(isIdle(t0, t0 + IDLE_TIMEOUT_MS), true);
  assert.equal(isIdle(0, t0), false);
  assert.equal(isIdle(NaN, t0), false);
});

test("activity in any tab counts", () => {
  assert.equal(latestActivity(100, "200"), 200);
  assert.equal(latestActivity(300, "200"), 300);
  assert.equal(latestActivity(300, null), 300);
  assert.equal(latestActivity(300, "junk"), 300);
});

test("server activity token: fresh ok, stale rejected, not interchangeable with network token", async () => {
  const secret = "crm-network-v1|pass|x";
  const t0 = 1_800_000_000_000;
  const tok = await signActivityToken(secret, t0);
  assert.equal(await verifyActivityToken(tok, secret, t0 + IDLE_TIMEOUT_MS), true);
  assert.equal(await verifyActivityToken(tok, secret, t0 + IDLE_TIMEOUT_MS + SERVER_IDLE_GRACE_MS + 1), false);
  assert.equal(await verifyActivityToken(tok, "other", t0 + 1000), false);
  assert.equal(await verifyActivityToken(await signNetworkToken(secret, t0), secret, t0 + 1000), false);
  assert.equal(await verifyNetworkToken(tok, secret, t0 + 1000), false);
});
