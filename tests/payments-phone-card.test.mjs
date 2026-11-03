import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../app/estimates/[id]/payments-panel.tsx", import.meta.url), "utf8");
const box = readFileSync(new URL("../app/estimates/[id]/stripe-card-box.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("../app/actions/stripe-payments.ts", import.meta.url), "utf8");

test("Stripe on: reps type card number, exp, CVV by phone into Stripe's own fields", () => {
  for (const el of ["CardNumberElement", "CardExpiryElement", "CardCvcElement"]) assert.match(box, new RegExp(`<${el}`));
  assert.match(box, /confirmCardSetup/);
  assert.match(box, /confirmCardPayment/);
  assert.match(box, /data-testid="save-card"/);
  assert.match(panel, /<StripeCardBox[\s\S]*prepare=\{prepareCard\}/);
  // No plaintext card inputs in the form while Stripe is on (Stripe fields are iframes, no name=).
  assert.doesNotMatch(box, /name="card_number"|name="cvv"/);
});

test("the old green 'New charge' bar is gone; saved cards are recalled with exp and saved stamp", () => {
  assert.doesNotMatch(panel, /new-charge-bar/);
  assert.match(panel, /Cards on file/);
  assert.match(panel, /saved \$\{crmStamp\(card\.savedAt\)\}/);
});

test("saved cards can be found by phone (any format), name, or email across leads", () => {
  assert.match(actions, /ilike\("phone_digits", digitLike\)/);
  assert.match(actions, /export async function startCardSave/);
  assert.match(actions, /export async function finishCardSave/);
  assert.match(actions, /purpose !== "crm_save_card"/);
  assert.match(panel, /Find a saved card by phone, name, or email/);
});

test("a payment amount can be entered with no method (ledger only, never a charge)", async () => {
  const { legacyLedgerKind } = await import("../lib/payments/decide.ts");
  for (const method of ["", "Not specified"]) {
    const r = legacyLedgerKind({ method, amountCents: 5000, stripeConnected: true });
    assert.equal(r.action, "log_manual");
    assert.equal(r.movesMoney, false);
  }
  assert.match(panel, /— No method —/);
});

test("E-Quote shows Customer Payment / Balance once a payment is entered, Total only before", async () => {
  const { renderTemplate } = await import("../lib/templates/registry.ts");
  const base = { est: { job_number: "FB1", customer_name: "Jane" }, vehicles: [], quote: { total_amount: 795, deposit_amount: 295 }, rep: null, assetBaseUrl: "https://x.test" };
  const before = renderTemplate("e_quote", { ...base, paidAmount: null }).html;
  assert.ok(!before.includes("Customer Payment"));
  const after = renderTemplate("e_quote", { ...base, paidAmount: 100 }).html;
  assert.ok(after.includes("Customer Payment") && after.includes("$100.00") && after.includes("$695.00"));
});

test("FB400009: a Credit Card deposit typed in Payment Info is recorded while Stripe is live (ledger only, no card stored, no charge)", async () => {
  const { legacyLedgerKind, countsAsPaid } = await import("../lib/payments/decide.ts");
  const r = legacyLedgerKind({ method: "Credit Card", amountCents: 25000, stripeConnected: true });
  assert.equal(r.action, "log_manual");
  assert.equal(r.movesMoney, false);
  assert.equal(countsAsPaid("logged_manual"), true);
  // A Stripe row that never got a card stays "processing" and does not count.
  assert.equal(countsAsPaid("processing"), false);
});

test("Enclosed chip reads ENC/OPEN; Expedited sits with ASAP/INOP; chips are compact and only on multi-vehicle rows", async () => {
  const fs = await import("node:fs");
  const view = fs.readFileSync(new URL("../app/estimates/[id]/charges-view.tsx", import.meta.url), "utf8");
  const rows = fs.readFileSync(new URL("../app/components/VehiclePrices.tsx", import.meta.url), "utf8");
  assert.match(rows, /is_enclosed \? "ENC" : "OPEN"/);
  assert.match(rows, /label="EXPEDITED" size="sm"/);
  // One vehicle: no flag chips on Charges (Owner 2026-10-31).
  assert.doesNotMatch(view, /charge-flags/);
  assert.doesNotMatch(view, /<Toggle /);
  const { vehicleRemarkCell } = await import("../lib/quote-template.ts");
  assert.equal(vehicleRemarkCell("", false, false, false, true), "EXPEDITED");
});
