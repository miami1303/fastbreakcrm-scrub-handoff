import test from "node:test";
import assert from "node:assert/strict";
import { eventLabel, ignoreOpen, isPrefetchUA, notifyKindFor, viewLabel, viewMethod } from "../lib/view-tracking.ts";

test("view tracking: quotes report Quote Viewed, every other email Email Viewed", () => {
  assert.equal(viewLabel("e_quote"), "Quote Viewed");
  assert.equal(viewLabel("booked_esign"), "Quote Viewed");
  assert.equal(viewLabel("cc_form"), "Email Viewed");
  assert.equal(viewLabel("free_text"), "Email Viewed");
  assert.equal(eventLabel("free_text", "opened"), "Email Viewed");
  assert.equal(eventLabel("free_text", "viewed"), "Quote Viewed", "clicking 'View your quote' in a Free Text email opens the quote");
  assert.equal(eventLabel("cc_form", "viewed"), "Email Viewed");
  assert.equal(notifyKindFor("e_quote"), "quote_viewed");
  assert.equal(notifyKindFor("cc_form"), "email_viewed");
  assert.equal(viewMethod("opened"), "open");
  assert.equal(viewMethod("viewed"), "click");
});
test("view tracking: opens within 15 s of the send and known prefetchers are ignored", () => {
  const sent = "2026-10-23T20:00:00.000Z";
  const t = Date.parse(sent);
  assert.equal(ignoreOpen(sent, t + 14_000, "Mozilla/5.0"), true, "14 s after send");
  assert.equal(ignoreOpen(sent, t + 16_000, "Mozilla/5.0"), false, "16 s after send counts");
  assert.equal(ignoreOpen(sent, t + 3_600_000, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 via ggpht.com GoogleImageProxy"), false, "Gmail image proxy only fetches on open: counts");
  for (const ua of ["Mozilla/5.0 (compatible; Barracuda Sentinel)", "Microsoft Office SafeLinks", "Proofpoint URL Defense", "Mimecast", "Googlebot/2.1"]) assert.equal(isPrefetchUA(ua), true, ua);
  assert.equal(isPrefetchUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), false);
});
