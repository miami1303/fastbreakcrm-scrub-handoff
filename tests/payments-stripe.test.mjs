import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { PAYMENT_METHODS } from "../lib/crm-constants.ts";
import {
  STAFF_PAYMENT_METHODS,
  assertSafeToCallStripe,
  bothEsignsComplete,
  classifyCustomerMatches,
  countsAsPaid,
  decidePayment,
  detectStripeMode,
  interpretStripeEvent,
  isOnlineBooking,
  legacyLedgerKind,
  matchReasons,
  runWithStripeGuard,
  safeLast4,
  scrubSecrets,
  stripeCallFor,
} from "../lib/payments/decide.ts";
import { verifyStripeWebhook } from "../lib/payments/webhook-verify.ts";

const KEY = "11111111-1111-4111-8111-111111111111";
const ESTIMATE = "22222222-2222-4222-8222-222222222222";

function cardInput(overrides = {}) {
  return {
    amountCents: 2500,
    autoCharge: false,
    bothEsignsComplete: false,
    stripeConnected: true,
    savedPaymentMethod: false,
    purpose: "card",
    idempotencyKey: KEY,
    existingCharge: null,
    ...overrides,
  };
}

test("staff methods are only the four payment choices", () => {
  assert.deepEqual([...STAFF_PAYMENT_METHODS], ["Credit Card", "Zelle", "Cash App", "PayPal"]);
  assert.deepEqual([...PAYMENT_METHODS], [...STAFF_PAYMENT_METHODS]);
});

test("stripe mode stays disconnected unless both keys match, and messages hide the keys", () => {
  const missing = detectStripeMode("", "");
  assert.equal(missing.connected, false);
  assert.equal(missing.publishableKey, null);
  const mismatch = detectStripeMode("sk_test_SECRETVALUE123", "pk_live_OTHERSECRET456");
  assert.equal(mismatch.connected, false);
  assert.equal(mismatch.mode, "mismatch");
  assert.equal(mismatch.publishableKey, null);
  assert.equal(mismatch.message.includes("SECRETVALUE"), false);
  assert.equal(mismatch.message.includes("sk_test"), false);
  assert.equal(mismatch.message.includes("pk_live"), false);
  const testMode = detectStripeMode("sk_test_SECRETVALUE123", "pk_test_PUBLISH789");
  assert.equal(testMode.connected, true);
  assert.equal(testMode.mode, "test");
  assert.equal(testMode.publishableKey, "pk_test_PUBLISH789");
  assert.equal(testMode.message.includes("SECRETVALUE"), false);
  const live = detectStripeMode("sk_live_SECRETVALUE123", "pk_live_PUBLISH789");
  assert.equal(live.mode, "live");
  assert.equal(live.message.includes("SECRETVALUE"), false);
  assert.equal(scrubSecrets("failed sk_test_SECRETVALUE123 whsec_ABC pk_live_ZZ").includes("SECRET"), false);
});

test("a negative amount never charges, even with auto-charge, both e-signs, a saved card, and Stripe connected", async () => {
  const decision = decidePayment(cardInput({
    amountCents: -500,
    autoCharge: true,
    bothEsignsComplete: true,
    savedPaymentMethod: true,
  }));
  assert.equal(decision.action, "reject");
  assert.equal(decision.reason, "negative_amount");
  assert.equal(decision.movesMoney, false);
  assert.equal(stripeCallFor(decision), "none");
  let called = false;
  const guarded = await runWithStripeGuard(decision, true, async () => { called = true; return "charged"; });
  assert.equal(guarded.called, false);
  assert.equal(called, false);
});

test("no Stripe call when keys are missing", async () => {
  const decision = decidePayment(cardInput({ stripeConnected: false, amountCents: 5000 }));
  assert.equal(decision.action, "reject");
  assert.equal(decision.reason, "stripe_not_connected");
  assert.equal(decision.movesMoney, false);
  let called = false;
  const guarded = await runWithStripeGuard(decision, false, async () => { called = true; return "nope"; });
  assert.equal(guarded.called, false);
  assert.equal(called, false);
});

test("Zelle, Cash App, and PayPal are ledger entries and never a Stripe call", () => {
  for (const method of ["Zelle", "Cash App", "PayPal"]) {
    const ledger = legacyLedgerKind({ method, amountCents: 4000, stripeConnected: true });
    assert.equal(ledger.action, "log_manual");
    assert.equal(ledger.movesMoney, false);
  }
  const unknown = legacyLedgerKind({ method: "ACH", amountCents: 4000, stripeConnected: false });
  assert.equal(unknown.action, "reject");
  assert.equal(unknown.movesMoney, false);
});

test("legacy ledger never moves money, including a negative bookkeeping correction", () => {
  const book = legacyLedgerKind({ method: "Credit Card", amountCents: -100, stripeConnected: false });
  assert.equal(book.action, "bookkeeping");
  assert.equal(book.movesMoney, false);
  const card = legacyLedgerKind({ method: "Credit Card", amountCents: 100, stripeConnected: false });
  assert.equal(card.action, "legacy_card_record");
  assert.equal(card.movesMoney, false);
  const connected = legacyLedgerKind({ method: "Credit Card", amountCents: 100, stripeConnected: true });
  assert.equal(connected.action, "log_manual");
  assert.equal(connected.movesMoney, false);
  assert.equal(legacyLedgerKind({ method: "Credit Card", amountCents: 0, stripeConnected: false }).movesMoney, false);
});

test("auto-charge waits until both e-signs, then charges a saved card", () => {
  assert.equal(bothEsignsComplete({ contractSigned: true, ccFormSigned: false }), false);
  assert.equal(bothEsignsComplete({ contractSigned: false, ccFormSigned: true }), false);
  assert.equal(bothEsignsComplete({ contractSigned: true, ccFormSigned: true }), true);
  const waiting = decidePayment(cardInput({ autoCharge: true, savedPaymentMethod: true, bothEsignsComplete: false }));
  assert.equal(waiting.action, "save_card_for_later");
  assert.equal(waiting.movesMoney, false);
  assert.equal(stripeCallFor(waiting), "none");
  const ready = decidePayment(cardInput({ autoCharge: true, savedPaymentMethod: true, bothEsignsComplete: true }));
  assert.equal(ready.action, "charge_saved");
  assert.equal(ready.movesMoney, true);
  const oneSignature = decidePayment(cardInput({ autoCharge: true, savedPaymentMethod: false, bothEsignsComplete: false }));
  assert.equal(oneSignature.action, "save_card_for_later");
  if (oneSignature.action === "save_card_for_later") assert.equal(oneSignature.needsSetup, true);
  assert.equal(stripeCallFor(oneSignature), "setup_intent");
});

test("the same payment is not charged twice", async () => {
  const duplicate = decidePayment(cardInput({
    existingCharge: { status: "succeeded", stripePaymentIntentId: "pi_123" },
  }));
  assert.equal(duplicate.action, "duplicate");
  assert.equal(duplicate.movesMoney, false);
  let called = false;
  const guarded = await runWithStripeGuard(duplicate, true, async () => { called = true; return "again"; });
  assert.equal(called, false);
  assert.equal(guarded.called, false);
  const failed = decidePayment(cardInput({ existingCharge: { status: "failed", stripePaymentIntentId: "pi_123" } }));
  assert.equal(failed.action, "duplicate");
});

test("a hand-built negative charge is refused before the Stripe function runs", async () => {
  const bad = { action: "charge_new_card", amountCents: -1, movesMoney: true };
  const gate = assertSafeToCallStripe(bad, true);
  assert.equal(gate.ok, false);
  let called = false;
  const guarded = await runWithStripeGuard(bad, true, async () => { called = true; return "no"; });
  assert.equal(called, false);
  assert.equal(guarded.called, false);
  const off = await runWithStripeGuard({ action: "charge_saved", amountCents: 500, movesMoney: true }, false, async () => "no");
  assert.equal(off.called, false);
});

test("customer match is one, many, or none, and blanks do not match", () => {
  const ann = { displayName: "Ann Lee", email: "ann@example.com", phone: "3125551212" };
  const same = { displayName: "ann  lee", email: "other@example.com", phone: "" };
  const email = { displayName: "Someone", email: "ANN@example.com", phone: "" };
  assert.deepEqual(classifyCustomerMatches(ann, [same]).kind, "one");
  assert.deepEqual(classifyCustomerMatches(ann, [same, email]).kind, "many");
  assert.equal(classifyCustomerMatches({ displayName: " ", email: "", phone: "" }, [{ displayName: " ", email: "", phone: "" }]).kind, "none");
  assert.deepEqual(matchReasons({ displayName: "", email: "", phone: "1 (312) 555-1212" }, { displayName: "", email: "", phone: "312-555-1212" }), ["phone"]);
  assert.deepEqual(matchReasons({ displayName: "", email: "", phone: "555-1212" }, { displayName: "", email: "", phone: "555-1212" }), []);
});

test("last 4 is only four digits", () => {
  assert.equal(safeLast4("4242"), "4242");
  assert.equal(safeLast4("4242424242424242"), null);
  assert.equal(safeLast4("424"), null);
});

test("paid rows are the confirmed ones, and online booking is recognized", () => {
  assert.equal(countsAsPaid(null), true);
  assert.equal(countsAsPaid(undefined), true);
  assert.equal(countsAsPaid("succeeded"), true);
  assert.equal(countsAsPaid("bookkeeping_adjustment"), true);
  assert.equal(countsAsPaid("logged_manual"), true);
  assert.equal(countsAsPaid("recorded"), true);
  assert.equal(countsAsPaid("processing"), false);
  assert.equal(countsAsPaid("failed"), false);
  assert.equal(countsAsPaid("pending"), false);
  assert.equal(countsAsPaid("auto_charge_waiting"), false);
  assert.equal(countsAsPaid("superseded"), false);
  assert.equal(isOnlineBooking("Web Lead"), true);
  assert.equal(isOnlineBooking("Phone"), false);
});

test("webhook interpretation ignores refunds, unpaid checkouts, and non-positive amounts", () => {
  assert.equal(interpretStripeEvent({ type: "charge.refunded", data: { object: { id: "ch_1", amount: 500 } } }).kind, "ignore");
  assert.equal(interpretStripeEvent({ type: "refund.updated", data: { object: { id: "re_1" } } }).kind, "ignore");
  const unpaid = interpretStripeEvent({
    type: "checkout.session.completed",
    data: { object: { id: "cs_1", payment_status: "unpaid", amount_total: 500, currency: "usd", metadata: { estimate_id: ESTIMATE } } },
  });
  assert.equal(unpaid.kind, "ignore");
  const zero = interpretStripeEvent({
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_1", amount: 0, currency: "usd", metadata: { estimate_id: ESTIMATE } } },
  });
  assert.equal(zero.kind, "ignore");
  const negative = interpretStripeEvent({
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_1", amount: -100, currency: "usd", metadata: { estimate_id: ESTIMATE } } },
  });
  assert.equal(negative.kind, "ignore");
  const paid = interpretStripeEvent({
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_1", amount: 2500, currency: "usd", metadata: { estimate_id: ESTIMATE, crm_payment_id: KEY } } },
  });
  assert.equal(paid.kind, "payment_intent");
  if (paid.kind === "payment_intent") {
    assert.equal(paid.succeeded, true);
    assert.equal(paid.amountCents, 2500);
  }
});

test("webhook verification refuses a missing secret and a bad signature, and accepts Stripe's test header", () => {
  const payload = JSON.stringify({ id: "evt_test", object: "event", type: "payment_intent.succeeded", data: { object: { id: "pi_1" } } });
  assert.equal(verifyStripeWebhook(payload, "t=1,v1=abc", "").reason, "missing_secret");
  assert.equal(verifyStripeWebhook(payload, null, "whsec_test").reason, "missing_signature");
  assert.equal(verifyStripeWebhook(payload, "t=1,v1=not-a-real-signature", "whsec_test").reason, "bad_signature");
  const secret = "whsec_test_secret_value";
  const stripe = new Stripe("sk_test_signature_check_only", { maxNetworkRetries: 0 });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const verified = verifyStripeWebhook(payload, header, secret);
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(verified.event.type, "payment_intent.succeeded");
  assert.equal(JSON.stringify(verified).includes("sk_test_signature_check_only"), false);
});
