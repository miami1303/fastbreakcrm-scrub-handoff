import test from "node:test";
import assert from "node:assert/strict";
import { nameLines, phoneLine, phoneLines } from "../lib/contact-display.ts";
import { buildQuoteBody, buildQuoteText } from "../lib/quote-template.ts";

const base = {
  vehicles: [],
  quote: { total_amount: 1000 },
  assetBaseUrl: "https://crm.example.test",
  rep: { name: "Sam Rep", email: "m@example.test", phone: "" },
};

test("names: customer first, contact on the next line only when it was filled", () => {
  assert.deepEqual(nameLines("Alex Demo", ""), ["Alex Demo"]);
  assert.deepEqual(nameLines("Alex Demo", "   "), ["Alex Demo"]);
  assert.deepEqual(nameLines("Alex Demo", "Jane at the dock"), ["Alex Demo", "Jane at the dock"]);
  assert.deepEqual(nameLines("", "Jane at the dock"), ["Jane at the dock"]);
  assert.deepEqual(nameLines("", ""), []);
});

test("phones: label when one was saved, number alone when it was not, skip a blank number", () => {
  assert.equal(phoneLine("Cell", "(312) 555-0142"), "Cell: 312-555-0142");
  assert.equal(phoneLine("", "(312) 555-0142"), "312-555-0142");
  assert.equal(phoneLine("Home", "   "), "");
  assert.equal(phoneLine("Other", "call the dock"), "Other: call the dock");
  assert.deepEqual(phoneLines([
    { label: "Work", number: "312-555-0100" },
    { label: "", number: "" },
    { number: "305-555-0199" },
    { label: "Other", number: "   " },
  ]), ["Work: 312-555-0100", "305-555-0199"]);
});

test("quote: pickup and delivery show the customer, then the contact, then labeled phones", () => {
  const est = {
    customer_name: "Alex Demo",
    customer_email: "owner@example.test",
    customer_phone: "555-010-0109",
    pickup_contact: "Warehouse Jane",
    pickup_phone1: "555-010-0102",
    pickup_phone1_label: "Cell",
    pickup_phone2: "954-555-0100",
    pickup_phone2_label: "Work",
    pickup_phone3: "8165550199",
    pickup_phone3_label: "Other",
    delivery_contact: "Luis Rivera",
    delivery_phone1: "305-555-0199",
    delivery_phone1_label: "Cell",
    delivery_phone2: "305-555-0100",
    delivery_phone2_label: "Home",
    pickup_address: "7900 N Lister Ave, Kansas City, MO 64119",
    pickup_zip: "64119",
    delivery_address: "100 Biscayne Blvd, Miami, FL 33101",
    delivery_zip: "33101",
  };
  const text = buildQuoteText({ ...base, est });
  const pickup = text.slice(text.indexOf("Vehicle Pick-Up From"), text.indexOf("Vehicle Shipping To"));
  const delivery = text.slice(text.indexOf("Vehicle Shipping To"), text.indexOf("Vehicles"));
  assert.ok(pickup.indexOf("Alex Demo") < pickup.indexOf("Warehouse Jane"), "pickup customer before contact");
  assert.ok(pickup.includes("Cell: 555-010-0102"));
  assert.ok(pickup.includes("Work: 954-555-0100"));
  assert.ok(pickup.includes("Other: 816-555-0199"));
  assert.ok(!pickup.includes("(H)") && !pickup.includes("(W)"));
  assert.ok(delivery.indexOf("Alex Demo") < delivery.indexOf("Luis Rivera"));
  assert.ok(delivery.includes("Cell: 305-555-0199"));
  assert.ok(delivery.includes("Home: 305-555-0100"));
  assert.ok(!delivery.includes("816-555-0199"), "an empty delivery phone 3 is not printed");
  const html = buildQuoteBody({ ...base, est });
  const owner = html.indexOf("Alex Demo");
  const jane = html.indexOf("Warehouse Jane");
  const luis = html.indexOf("Luis Rivera");
  assert.ok(owner >= 0 && owner < jane && jane < luis, "customer, then pickup contact, then delivery contact");
  assert.ok(html.includes("Cell: 555-010-0102") && html.includes("Home: 305-555-0100") && html.includes("Other: 816-555-0199"));
});

test("quote: a blank contact adds no empty line, and an unlabeled phone is just the number", () => {
  const est = {
    customer_name: "Alex Demo",
    customer_phone: "5550100102",
    pickup_phone1: "5550100102",
    pickup_phone2: "816-555-0102",
    pickup_phone3: "",
    pickup_phone3_label: "Other",
    delivery_phone1: "305-555-0199",
    delivery_phone3: "   ",
  };
  const text = buildQuoteText({ ...base, est });
  const pickup = text.slice(text.indexOf("Vehicle Pick-Up From"), text.indexOf("Vehicle Shipping To"));
  const delivery = text.slice(text.indexOf("Vehicle Shipping To"), text.indexOf("Vehicles"));
  assert.equal((pickup.match(/Alex Demo/g) || []).length, 1);
  assert.ok(!pickup.includes("\n\nAddress"), "no blank line where the contact would be");
  assert.ok(pickup.includes("555-010-0102"));
  assert.ok(pickup.includes("816-555-0102"));
  assert.ok(!pickup.includes("Other:"), "a label with no third number is not printed");
  assert.ok(!pickup.includes("Cell:") && !pickup.includes("(H)") && !pickup.includes("(W)"));
  assert.equal((delivery.match(/Alex Demo/g) || []).length, 1);
  assert.ok(delivery.includes("305-555-0199"));
  assert.ok(!delivery.includes("Phone:"));
  const html = buildQuoteBody({ ...base, est });
  assert.equal((html.match(/Alex Demo/g) || []).length, 2, "once on pickup and once on delivery");
  assert.ok(!html.includes("<b></b>"));
  assert.ok(!html.includes("(H)") && !html.includes("Cell:"));
});

test("Owner 2026-10-31: contact same as customer (any case) shows customer only; different shows both", () => {
  assert.deepEqual(nameLines("Sam Rep", "SAM REP "), ["Sam Rep"]);
  assert.deepEqual(nameLines("Sam Rep", "Joe at Copart"), ["Sam Rep", "Joe at Copart"]);
  assert.ok(!nameLines("Sam Rep", "sam rep").some(l => /contact:/i.test(l)));
});

test("phone labels include Cust / Contact / Dealership / Auction and keep Cell / Home", async () => {
  const { PHONE_LABELS, cleanPhoneLabel } = await import("../lib/contact-display.ts");
  for (const l of ["Cust", "Contact", "Dealership", "Auction", "Cell", "Home"]) assert.ok(PHONE_LABELS.includes(l), l);
  assert.equal(cleanPhoneLabel("  Body  shop: "), "Body shop");
  assert.equal(cleanPhoneLabel("x".repeat(40)).length, 20);
  assert.equal(phoneLine("Auction", "3125550100"), "Auction: 312-555-0100");
});
