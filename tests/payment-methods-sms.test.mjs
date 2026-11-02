import test from "node:test";
import assert from "node:assert/strict";
import { paymentLinkSms, sendSms, smsMode, toE164 } from "../lib/sms.ts";
import { paymentMethodLines, stripeLinkMethods, zelleAddress } from "../lib/payment-methods.ts";
import { renderTemplate } from "../lib/templates/registry.ts";

test("SMS is off until the API keys are set (nothing sent, no network call)", async () => {
  assert.equal(smsMode({}), null);
  assert.equal(smsMode({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" }), null, "needs a From or Messaging Service");
  assert.equal(smsMode({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+13125550100" }), "twilio");
  const r = await sendSms("312-555-0142", "hi", {});
  assert.equal(r.ok, false);
  assert.match(r.error, /API pending/);
});

test("US phone -> E.164 and a short payment text", () => {
  assert.equal(toE164("(312) 555-0142"), "+13125550142");
  assert.equal(toE164("1-312-555-0142"), "+13125550142");
  assert.equal(toE164("555-0142"), null);
  const t = paymentLinkSms({ company: "Fastbreak CRM", job: "FB400001", amount: "$200.00", url: "https://checkout.stripe.com/c/pay/x", phone: "555-010-0101" });
  assert.ok(t.includes("FB400001") && t.includes("$200.00") && t.includes("https://checkout.stripe.com/c/pay/x") && /STOP/.test(t));
  assert.ok(t.length < 320);
});

test("payment methods: none built in; Stripe only with keys, Zelle only with PAY_ZELLE", () => {
  assert.deepEqual(paymentMethodLines({}), [], "no processor or payee configured = no methods");
  assert.equal(zelleAddress({}), "");
  const lines = paymentMethodLines({ STRIPE_SECRET_KEY: "sk_test_x", PAY_ZELLE: "pay@example.test" });
  assert.deepEqual(lines.filter(m => m.via === "stripe").map(m => m.method), ["Credit / debit card (Apple Pay, Google Pay)", "Cash App Pay", "PayPal", "Link"]);
  const zelle = lines.find(m => m.method === "Zelle");
  assert.equal(zelle.via, "direct");
  assert.match(zelle.detail, /pay@example\.test/);
  assert.equal(zelleAddress({ PAY_ZELLE: "other@example.test" }), "other@example.test");
  assert.deepEqual(stripeLinkMethods({}), ["card", "cashapp", "paypal", "link"]);
  assert.deepEqual(stripeLinkMethods({ STRIPE_LINK_METHODS: "cashapp,venmo" }), ["card", "cashapp"], "card always first; unknown (venmo) ignored");
  const html = renderTemplate("payment_link", {
    est: { job_number: "FB400001", customer_name: "Jane" }, vehicles: [], quote: { total_amount: 1250 }, rep: { name: "Sam Rep", email: "m@x.test", phone: "" },
    assetBaseUrl: "https://crm.example.test", paymentLink: { url: "https://x.test/p", amount: "$1.00" }, paymentMethods: lines, zelle: "pay@example.test",
  }).html;
  assert.ok(html.includes('data-payment-methods="1"') && html.includes("Ways to pay") && html.includes("Cash App Pay"));
  assert.ok(paymentLinkSms({ company: "FB", job: "FB400001", amount: "$1.00", url: "https://x", phone: "1", zelle: "pay@example.test" }).includes("Zelle pay@example.test"));
});
