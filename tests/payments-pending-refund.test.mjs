import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pendingPayments, isPendingRow } from "../lib/payments/pending.ts";
import { chargeState, firstChargedAt } from "../lib/ops-status.ts";

const layout = readFileSync(new URL("../app/estimates/[id]/layout.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/estimates/[id]/payments-panel.tsx", import.meta.url), "utf8");
const owesBox = readFileSync(new URL("../app/components/CarrierOwesBox.tsx", import.meta.url), "utf8");

test("FB400012: card on file + $50 deposit not charged -> pending $50, balance after $450", () => {
  const r = pendingPayments({ payments: [], cards: [{ brand: "visa", last4: "9630" }], depositDue: 50, depositPaidC: 0, totalAmount: 500, customerPaidC: 0 });
  assert.equal(r.pendingC, 5000);
  assert.equal(r.balanceAfterC, 45000);
  assert.equal(r.lines[0].source, "card");
  assert.match(r.lines[0].label, /••••9630 · not charged yet/);
});

test("no card on file -> nothing pending; deposit already paid -> nothing pending", () => {
  assert.equal(pendingPayments({ payments: [], cards: [], depositDue: 50, depositPaidC: 0, totalAmount: 500, customerPaidC: 0 }).pendingC, 0);
  assert.equal(pendingPayments({ payments: [], cards: [{ last4: "1" }], depositDue: 50, depositPaidC: 5000, totalAmount: 500, customerPaidC: 5000 }).pendingC, 0);
});

test("held / waiting rows are pending; succeeded / voided / failed are not", () => {
  assert.equal(isPendingRow({ amount: 50, charge_status: "auto_charge_waiting" }), true);
  assert.equal(isPendingRow({ amount: 50, charge_status: "processing" }), true);
  assert.equal(isPendingRow({ amount: 50, charge_status: "succeeded" }), false);
  assert.equal(isPendingRow({ amount: 50, charge_status: "failed" }), false);
  assert.equal(isPendingRow({ amount: 50, charge_status: "pending", voided_at: "x" }), false);
  const r = pendingPayments({ payments: [{ amount: 120, charge_status: "auto_charge_waiting", card_last4: "4242" }], cards: [{ last4: "4242" }], depositDue: 50, depositPaidC: 0, totalAmount: 500, customerPaidC: 0 });
  assert.equal(r.pendingC, 12000); // row wins; card-on-file deposit not double counted
  assert.equal(r.lines.length, 1);
});

test("Charged pill: green only after a real charge, never for pending / held / failed", () => {
  assert.equal(chargeState([{ created_at: "a", amount: 50, charge_status: "auto_charge_waiting" }]).state, "none");
  assert.equal(chargeState([{ created_at: "a", amount: 50, charge_status: "failed" }]).state, "none");
  assert.equal(chargeState([{ created_at: "a", amount: 50, charge_status: "succeeded" }]).state, "charged");
  assert.equal(firstChargedAt([{ created_at: "a", amount: 50, charge_status: "processing" }]), null);
});

test("Refund pill: only on full refund", () => {
  assert.equal(chargeState([{ created_at: "a", amount: 50, charge_status: "succeeded" }, { created_at: "b", amount: -20, charge_status: "succeeded" }]).state, "charged");
  assert.equal(chargeState([{ created_at: "a", amount: 50, charge_status: "succeeded" }, { created_at: "b", amount: -50, charge_status: "succeeded" }]).state, "refund");
  assert.match(layout, /charge\.state === "refund" && <button[^>]*data-testid="ops-refund"/);
  assert.doesNotMatch(layout, /charge\.state === "refund" \? "Refund"/); // Charged pill no longer morphs
});

test("UI wiring: pending in summary + records; carrier button is an action, not a status", () => {
  assert.match(panel, /data-testid="sum-pending"/);
  assert.match(panel, /data-testid="pending-row"/);
  assert.match(owesBox, /Mark carrier paid \(/);
});

test("customer document: pending line + balance after pending, Customer Payment untouched", async () => {
  const { pendingSummary } = await import("../lib/quote-template.ts");
  const p = pendingSummary({ est: {}, vehicles: [], quote: { total_amount: 500 }, paidAmount: null, pendingAmount: 50, pendingLabel: "Visa ••••9630" });
  assert.deepEqual(p, { pending: "$50.00", balanceAfter: "$450.00", label: "Visa ••••9630" });
  assert.equal(pendingSummary({ est: {}, vehicles: [], quote: { total_amount: 500 }, pendingAmount: 0 }), null);
});

test("carrier owes settlement $300 / $1,100 / $100: before and after carrier pays (staff only)", async () => {
  const { carrierSettlement, customerMoney } = await import("../lib/carrier-owes.ts");
  const before = carrierSettlement({ deposit: 300, cod: 1100, carrier_owes_amount: 100 });
  assert.equal(before.fbDepositNowC, 30000); assert.equal(before.stillOwesC, 10000); assert.equal(before.carrierCodNowC, 110000);
  assert.equal(before.fbDepositAfterC, 40000); assert.equal(before.carrierCodAfterC, 100000);
  const after = carrierSettlement({ deposit: 300, cod: 1100, carrier_owes_amount: 100, carrier_owes_paid_at: "2026-11-01" });
  assert.equal(after.fbDepositNowC, 40000); assert.equal(after.carrierCodNowC, 100000); assert.equal(after.stillOwesC, 0);
  // Customer math ignores carrier owes entirely: Total = Deposit + COD.
  const cust = customerMoney({ deposit: 300, cod: 1100, paid: 300 });
  assert.equal(cust.totalC, 140000); assert.equal(cust.paidC, 30000); assert.equal(cust.balanceC, 110000);
});

test("customer documents never mention carrier owes / settlement", () => {
  for (const f of ["../lib/quote-template.ts", "../lib/lead-data.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /carrier_owes|carrierSettlement|Carrier owes/i);
  }
  assert.match(panel, /data-testid="pay-settlement"/);
});
