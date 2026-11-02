import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountingSummary, actionButtons, carrierCodAddedCents, carrierReturnedCents, cleanStripeAccount,
  cleanZelleRecipient, isCustomerRefund, nextReturnMode, zelleToSend,
} from "../lib/payments/returns.ts";

const panel = readFileSync(new URL("../app/estimates/[id]/payments-panel.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("../app/actions/carrier-payouts.ts", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../lib/payments/stripe-gateway.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261031170000_carrier_payouts.sql", import.meta.url), "utf8");

test("Return to customer / Return to carrier checkboxes sit next to Payment Deposit", () => {
  const row = panel.slice(panel.indexOf('data-testid="deposit-return-row"'), panel.indexOf('data-testid="deposit-return-row"') + 2500);
  assert.match(row, /data-testid="pay-deposit"/);
  assert.match(row, /data-testid="return-cust-check"/);
  assert.match(row, /data-testid="return-carrier-check"/);
  assert.match(row, /From deposit/);
  assert.match(row, /Add to COD/);
});

test("only one return at a time", () => {
  assert.equal(nextReturnMode("none", "customer", true), "customer");
  assert.equal(nextReturnMode("customer", "carrier", true), "carrier");
  assert.equal(nextReturnMode("carrier", "carrier", false), "none");
  assert.equal(nextReturnMode("customer", "carrier", false), "customer");
});

test("checked return turns Charge Now / Update Payment red Refund Now", () => {
  assert.deepEqual(actionButtons("none", { cardLabel: "visa ••••4242" }).chargeLabel, "Charge Now · visa ••••4242");
  const c = actionButtons("customer", { cardLabel: "••••4242" });
  assert.equal(c.refund, true); assert.equal(c.saveLabel, "Refund Now"); assert.match(c.className, /btn-refund-now/);
  assert.match(actionButtons("carrier", { carrierMethod: "Zelle" }).chargeLabel, /Zelle to carrier \(from deposit\)/);
  assert.match(actionButtons("carrier", { carrierMethod: "Cash App" }).chargeLabel, /Cash App \(Stripe\)/);
  assert.match(actionButtons("carrier", { carrierSource: "cod" }).chargeLabel, /add to carrier COD/);
  assert.match(panel, /if \(returnMode !== "none"\) \{ await refundNow\(\); return; \}/);
  assert.match(panel, /disabled=\{!stripeOn \|\| !extras\?\.schemaReady \|\| saving \|\| returnMode !== "none"\}/);
});

test("carrier Zelle / Stripe account validation", () => {
  assert.equal(cleanZelleRecipient("Carrier@Example.com"), "carrier@example.com");
  assert.equal(cleanZelleRecipient("+1 (312) 555-0199"), "(312) 555-0199");
  assert.equal(cleanZelleRecipient("12345"), null);
  assert.equal(cleanStripeAccount("acct_1AbCdEfGhIjK"), "acct_1AbCdEfGhIjK");
  assert.equal(cleanStripeAccount("$cashtag"), null);
});

test("Zelle never goes through Stripe; Cash App to carrier uses a Stripe Connect transfer", () => {
  const zelle = actions.slice(actions.indexOf('if (method === "Zelle") {'), actions.indexOf("// Cash App -> through Stripe"));
  assert.match(zelle, /status: "zelle_to_send"/);
  assert.doesNotMatch(zelle, /transferToCarrier|getStripe/);
  assert.match(actions, /transferToCarrier\(/);
  assert.match(gateway, /stripe\.transfers\.create/);
  assert.match(actions, /export async function markZelleSent/);
  assert.match(actions, /isManager\(staff\)/);
});

test("accounting keeps refunds and carrier returns visible and applied", () => {
  const payments = [
    { amount: 500, is_deposit: true, charge_status: "succeeded", confirmation_no: "pi_1" },
    { amount: -100, charge_status: "succeeded", confirmation_no: "re_1", remark: "Return to customer re_1" },
    { amount: 50, charge_status: "failed" },
    { amount: 999, charge_status: "succeeded", voided_at: "2026-10-31" },
  ];
  const carrier = [
    { amount: 75, source: "deposit", status: "zelle_to_send" },
    { amount: 25, source: "deposit", status: "sent" },
    { amount: 40, source: "deposit", status: "failed" },
    { amount: 60, source: "cod", status: "added_to_cod" },
    { amount: 10, source: "cod", status: "cancelled" },
  ];
  assert.equal(isCustomerRefund(payments[1]), true);
  assert.equal(carrierReturnedCents(carrier), 10000);
  assert.equal(carrierCodAddedCents(carrier), 6000);
  assert.equal(zelleToSend(carrier).length, 1);
  const a = accountingSummary({ payments, carrier, totalAmount: 1500, codAmount: 1000 });
  assert.equal(a.customerPaidC, 40000);   // refund applied to Customer Payments
  assert.equal(a.refundedC, 10000);       // and still shown
  assert.equal(a.depositPaidC, 50000);
  assert.equal(a.carrierFromDepositC, 10000);
  assert.equal(a.depositKeptC, 40000);
  assert.equal(a.codAddedC, 6000);
  assert.equal(a.carrierCodC, 106000);
  assert.equal(a.balanceC, 110000);       // carrier returns never touch the customer's balance
  assert.match(panel, /data-testid="carrier-row"/);
  assert.match(panel, /Refund to cust · /);
});

test("migration: own table, two modes, locked down", () => {
  assert.match(migration, /create table if not exists public\.carrier_payouts/);
  assert.match(migration, /source in \('deposit', 'cod'\)/);
  assert.match(migration, /'added_to_cod'/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.carrier_payouts from anon, authenticated/);
});
