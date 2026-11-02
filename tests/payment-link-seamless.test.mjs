import test from "node:test";
import assert from "node:assert/strict";
import { paymentLinkChoices } from "../lib/payment-link-amounts.ts";
import { renderTemplate } from "../lib/templates/registry.ts";

test("payment link offers Deposit until it is paid, then the Balance (no counting)", () => {
  const none = paymentLinkChoices({ totalAmount: 1250, depositAmount: 200, payments: [] });
  assert.deepEqual(none.map(c => [c.key, c.cents, c.isDeposit]), [["deposit", 20000, true], ["balance", 125000, false]]);
  const paid = paymentLinkChoices({ totalAmount: 1250, depositAmount: 200, payments: [{ amount: 200, is_deposit: true, charge_status: "succeeded" }] });
  assert.deepEqual(paid.map(c => [c.key, c.cents]), [["balance", 105000]]);
  const voided = paymentLinkChoices({ totalAmount: 1250, depositAmount: 200, payments: [{ amount: 200, is_deposit: true, voided_at: "x" }, { amount: 50, charge_status: "failed" }] });
  assert.equal(voided[0].key, "deposit");
  assert.deepEqual(paymentLinkChoices({ totalAmount: 100, depositAmount: 0, payments: [{ amount: 100 }] }), []);
  assert.deepEqual(paymentLinkChoices({ totalAmount: 200, depositAmount: 200, payments: [] }).map(c => c.key), ["deposit"], "no duplicate chip when deposit = balance");
});

test("payment link email shows the same Total / Payment / Balance block, 8px margins", () => {
  const base = {
    est: { job_number: "FB400001", customer_name: "Jane" }, vehicles: [], quote: { total_amount: 1250, deposit_amount: 200 },
    rep: { name: "Sam Rep", email: "m@x.test", phone: "" }, assetBaseUrl: "https://crm.example.test",
    paymentLink: { url: "https://checkout.stripe.com/c/pay/x", amount: "$1050.00" },
  };
  const html = renderTemplate("payment_link", { ...base, paidAmount: 200 }).html;
  assert.ok(html.includes('data-payment-summary="1"') && html.includes("Customer Balance:") && html.includes("$1050.00"));
  assert.ok(html.includes("padding:2px 8px 0 8px") && html.includes("padding:8px 8px 2px 8px"));
  assert.ok(!renderTemplate("payment_link", { ...base, paidAmount: null }).html.includes('data-payment-summary="1"'));
});
