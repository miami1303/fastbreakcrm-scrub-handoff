import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chargebackOpen, chargebackEmail } from "../lib/chargeback.ts";
import { interpretStripeEvent } from "../lib/payments/decide.ts";

test("Chargeback pill only while a dispute is open", () => {
  for (const s of ["needs_response", "under_review", "warning_needs_response", "warning_under_review"]) assert.equal(chargebackOpen(s), true);
  for (const s of ["won", "lost", "warning_closed", "closed", null, undefined, ""]) assert.equal(chargebackOpen(s), false);
  const ui = readFileSync(new URL("../app/estimates/[id]/layout.tsx", import.meta.url), "utf8");
  assert.match(ui, /chargebackOpen\(ex\.chargeback_status\) && <button[^>]*className="ops-pill chargeback"/);
  assert.match(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"), /\.ops-pill\.chargeback[^{]*\{ background: #b91c1c/);
});

test("webhook interprets charge.dispute.* events", () => {
  const e = interpretStripeEvent({ type: "charge.dispute.created", data: { object: { id: "dp_1", payment_intent: "pi_1", charge: "ch_1", status: "needs_response", reason: "fraudulent", amount: 50000 } } });
  assert.equal(e.kind, "dispute"); assert.equal(e.paymentIntentId, "pi_1"); assert.equal(e.created, true); assert.equal(e.amountCents, 50000);
  const c = interpretStripeEvent({ type: "charge.dispute.closed", data: { object: { id: "dp_1", payment_intent: "pi_1", status: "won", amount: 50000 } } });
  assert.equal(c.kind, "dispute"); assert.equal(c.created, false); assert.equal(chargebackOpen(c.status), false);
});

test("ATTN Ops chargeback email to OPS_ALERT_EMAIL", () => {
  const m = chargebackEmail({ job: "1001", customer: "Jo", amount: "$500.00", reason: "fraudulent", status: "needs_response", openedAt: "x", disputeId: "dp_1", url: "u" });
  assert.match(m.subject, /^ATTN Ops chargeback: \$500\.00 — Job #1001 — Jo/);
  const alert = readFileSync(new URL("../lib/carrier-owes-alert.ts", import.meta.url), "utf8");
  assert.match(alert, /CARRIER_OWES_EMAIL_TO = process.env.OPS_ALERT_EMAIL/);
  assert.match(alert, /export async function alertChargeback/);
});
