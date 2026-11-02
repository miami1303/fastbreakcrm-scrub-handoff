// Run: npx -y node@22 --experimental-strip-types tests/money.test.mjs
import assert from "node:assert/strict";
import { formatCents, sumCents, toCents } from "../lib/money.ts";
import { buildCcAuthHtml, buildQuoteHtml, paymentSummary } from "../lib/quote-template.ts";

assert.equal(toCents("0.1") + toCents("0.2"), toCents("0.3"));
assert.equal(toCents("$1,250.00"), 125000);
assert.equal(toCents("-150"), -15000);
assert.equal(toCents("12.345"), null);
assert.equal(formatCents(-15000), "-$150.00");

// Owner's numbers: Deposit 200 + COD 1050 = Total 1250.
const deposit = toCents("200"), cod = toCents("1050");
assert.equal(formatCents(deposit + cod), "$1250.00");
const base = { est: { job_number: "FB400001" }, vehicles: [], quote: { total_amount: 1250 }, assetBaseUrl: "" };
assert.deepEqual(paymentSummary({ ...base, paidAmount: 200 }), { paid: "$200.00", balance: "$1050.00" });
assert.deepEqual(paymentSummary({ ...base, paidAmount: 150 }), { paid: "$150.00", balance: "$1100.00" });
assert.deepEqual(paymentSummary({ ...base, paidAmount: sumCents([200, -50]) / 100 }), { paid: "$150.00", balance: "$1100.00" });
assert.deepEqual(paymentSummary({ ...base, paidAmount: 0 }), { paid: "$0.00", balance: "$1250.00" });
assert.equal(paymentSummary({ ...base, paidAmount: null }), null, "E-Quote: total only");

const eQuote = buildQuoteHtml({ ...base, paidAmount: null });
assert.ok(eQuote.includes("$1250.00") && !eQuote.includes("Customer Payment") && !eQuote.includes("Customer Balance"));
const booked = buildQuoteHtml({ ...base, paidAmount: 200 });
assert.ok(booked.includes("Customer Payment:") && booked.includes("$200.00") && booked.includes("$1050.00"));
const cc = buildCcAuthHtml({ ...base, quote: { total_amount: 1250, card_last4: "1111" }, paidAmount: 200 });
assert.ok(cc.includes("xxxx-xxxx-xxxx-1111") && cc.includes("200.00") && !cc.includes("4111"));
console.log("money + document math: all tests passed");
