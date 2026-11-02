import test from "node:test";
import assert from "node:assert/strict";
import { linkJobNumbers } from "../lib/templates/job-link.ts";
import { renderTemplate } from "../lib/templates/registry.ts";

test("plain job numbers become links; existing anchors/attrs untouched", () => {
  const out = linkJobNumbers('<p>Job FB400123 ok</p><a href="/d/FB400123/x">FB400123</a><img alt="FB400123">', "FB400123", "https://c/d/FB400123/t");
  assert.equal((out.match(/data-job-link/g) || []).length, 1);
  assert.ok(out.includes('<a href="/d/FB400123/x">FB400123</a>'));
  assert.ok(out.includes('alt="FB400123"'));
  assert.equal(linkJobNumbers("<p>FB1</p>", "FB1", null), "<p>FB1</p>");
});
test("payment link email: job number is clickable to the order", () => {
  const r = renderTemplate("payment_link", { est: { job_number: "FB400777", customer_name: "Pat" }, vehicles: [], quote: { total_amount: 100, deposit_amount: 10 }, rep: { name: "Sam", email: "m@x.test", phone: "" }, assetBaseUrl: "https://crm.x", links: { jobNumberHref: "https://crm.x/d/FB400777/tok" }, paymentLink: { url: "https://pay", amount: "$10" } });
  assert.match(r.bodyHtml, /<a href="[^"]*FB400777[^"]*"[^>]*data-job-link="1"[^>]*>FB400777<\/a>/);
});
