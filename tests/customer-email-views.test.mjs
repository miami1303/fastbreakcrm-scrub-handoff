import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUOTE_BUTTON_DETAIL, eventLabel, ignoreOpen } from "../lib/view-tracking.ts";
import { isQuoteMessageKind } from "../lib/crm-constants.ts";
import {
  DEDUPE_WINDOW_MS, EMAIL_VIEW_GRACE_MS, OTHER_JOB_LINE, QUOTE_EMAIL_LINK, QUOTE_PAGE_BUTTON, CARRIER_EMAIL_LINK,
  buildViewRow, decideEmailView, fillMerge, isEmailToken, mergeCustomerViews, mergedLabel, messageLinks, newEmailToken,
} from "../lib/customer-email-views.ts";
import { DEFAULT_REP_TITLE, letterFields, placeLine, stateCode } from "../lib/templates/customer-messages.ts";
import { renderTemplate } from "../lib/templates/registry.ts";
import { DEFAULT_COMPANY } from "../lib/templates/company.ts";

const sent = "2026-10-26T15:00:00.000Z";
const t = Date.parse(sent);
const token = "abcdefghijklmnopqrstuv";
const browser = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const scanner = "Mozilla/5.0 (compatible; Barracuda Sentinel)";

test("email tokens: generated tokens validate, bad tokens do not", () => {
  const a = newEmailToken();
  const b = newEmailToken();
  assert.notEqual(a, b);
  assert.equal(isEmailToken(a), true);
  assert.equal(isEmailToken(token), true);
  for (const bad of ["", "short", "has space", "bad.token", "../etc/passwd", "a".repeat(200), "menu cc token!!"]) {
    assert.equal(isEmailToken(bad), false, bad);
    assert.equal(decideEmailView({ token: bad, sentAt: sent, at: t + 60_000, ua: browser, source: "pixel" }).reason, "bad_token");
  }
});

test("pixel hits: about 15 seconds and known scanners are ignored; a later normal hit is Email viewed", () => {
  const early = decideEmailView({ token, sentAt: sent, at: t + 14_000, ua: browser, source: "pixel" });
  assert.deepEqual(early, { record: false, reason: "too_soon", event_type: null });
  const edge = decideEmailView({ token, sentAt: sent, at: t + EMAIL_VIEW_GRACE_MS, ua: browser, source: "pixel" });
  assert.equal(edge.record, true);
  assert.equal(edge.event_type, "email_viewed");
  assert.equal(decideEmailView({ token, sentAt: sent, at: t + 16_000, ua: scanner, source: "pixel" }).reason, "prefetch");
  const gmail = "Mozilla/5.0 Chrome/130 Safari/537.36 via ggpht.com GoogleImageProxy";
  assert.equal(decideEmailView({ token, sentAt: sent, at: t + 16_000, ua: gmail, source: "pixel" }).record, true);
  // Pixel clock: 14 seconds is still ignored, 16 seconds counts.
  assert.equal(ignoreOpen(sent, t + 14_000, browser), true);
  assert.equal(ignoreOpen(sent, t + 16_000, browser), false);
});

test("quote button: a real click counts immediately; a scanner does not", () => {
  const click = decideEmailView({ token, sentAt: sent, at: t + 2_000, ua: browser, source: "button" });
  assert.deepEqual(click, { record: true, reason: "ok", event_type: "quote_viewed" });
  assert.equal(decideEmailView({ token, sentAt: sent, at: t + 2_000, ua: scanner, source: "button" }).reason, "prefetch");
  assert.equal(decideEmailView({ token, sentAt: sent, at: t + 2_000, ua: "Proofpoint URL Defense", source: "button" }).record, false);
});

test("view row stores email, token, lead, type, time, and user agent", () => {
  const row = buildViewRow({
    emailId: "email-1", token, estimateId: "lead-1", eventType: "quote_viewed",
    at: sent, userAgent: `${"Mozilla/5.0 ".repeat(80)}tail`,
  });
  assert.deepEqual(Object.keys(row).sort(), ["created_at", "email_id", "estimate_id", "event_type", "token", "user_agent"]);
  assert.equal(row.email_id, "email-1");
  assert.equal(row.token, token);
  assert.equal(row.estimate_id, "lead-1");
  assert.equal(row.event_type, "quote_viewed");
  assert.equal(row.created_at, sent);
  assert.ok(row.user_agent.length <= 400);
  assert.equal(row.user_agent.endsWith("tail"), false);
  assert.equal(buildViewRow({ emailId: "e", token, estimateId: "l", eventType: "email_viewed", userAgent: "  " }).user_agent, null);
});

test("recurring merge: the same hit is one row; a 15-second pixel stays and is marked automatic", () => {
  const email = [{ id: "e1", email_id: "m1", estimate_id: "l1", event: "opened", created_at: new Date(t + 61_000).toISOString(), detail: null }];
  const table = [
    { id: "t-same", email_id: "m1", estimate_id: "l1", event_type: "email_viewed", created_at: new Date(t + 61_000).toISOString() },
    { id: "t-early", email_id: "m1", estimate_id: "l1", event_type: "email_viewed", created_at: new Date(t + 15_000).toISOString() },
    { id: "t-other", email_id: "m2", estimate_id: "l2", event_type: "quote_viewed", created_at: new Date(t + 61_000).toISOString() },
  ];
  const merged = mergeCustomerViews(email, table);
  assert.deepEqual(merged.map(r => r.id).sort(), ["e1", "t-early", "t-other"]);
  assert.equal(merged.some(r => r.id === "t-same"), false);
  const early = merged.find(r => r.id === "t-early");
  assert.equal(early.automatic, true);
  assert.deepEqual(mergedLabel("company_intro", early), { label: "Email Viewed", method: "open", automatic: true });
  assert.deepEqual(mergedLabel("ready_to_book", merged.find(r => r.id === "t-other")), { label: "Quote Viewed", method: "click", automatic: false });
  const apart = mergeCustomerViews(
    [{ id: "e", email_id: "m", estimate_id: "l", event: "opened", created_at: new Date(t).toISOString() }],
    [{ id: "t", email_id: "m", estimate_id: "l", event_type: "email_viewed", created_at: new Date(t + DEDUPE_WINDOW_MS).toISOString() }],
  );
  assert.equal(apart.length, 2, "a later open stays its own view");
  const close = mergeCustomerViews(
    [{ id: "e", email_id: "m", estimate_id: "l", event: "opened", created_at: new Date(t).toISOString() }],
    [{ id: "t", email_id: "m", estimate_id: "l", event_type: "email_viewed", created_at: new Date(t + DEDUPE_WINDOW_MS - 1).toISOString() }],
  );
  assert.deepEqual(close.map(r => r.id), ["e"]);
});

test("only pickup confirmed uses landing; all other letters including quote kinds use direct link and pixel", () => {
  assert.equal(isQuoteMessageKind("ready_to_book"), true);
  assert.equal(isQuoteMessageKind("hi_lets_chat"), true);
  assert.equal(isQuoteMessageKind("flex_pricing"), false);
  assert.equal(isQuoteMessageKind("e_quote"), false);
  const quote = messageLinks("ready_to_book", "https://crm.example.test/", token, "FB400001");
  assert.equal(quote.links.trackingPixelUrl, `https://crm.example.test/api/email/open/${token}`);
  assert.equal(quote.links.quoteLandingHref, null);
  assert.equal(quote.reservationLink, quote.documentUrl);
  const other = messageLinks("flex_pricing", "https://crm.example.test", token, "FB400001");
  assert.equal(other.links.quoteLandingHref, null);
  assert.equal(other.links.trackingPixelUrl, `https://crm.example.test/api/email/open/${token}`);
  const pickup = messageLinks("pickup_confirmed", "https://crm.example.test", token, "FB400001");
  assert.equal(pickup.links.trackingPixelUrl, null);
  assert.equal(pickup.links.quoteLandingHref, `https://crm.example.test/v/${token}`);
  assert.equal(eventLabel("ready_to_book", "opened"), "Email Viewed");
  assert.equal(eventLabel("ready_to_book", "viewed", QUOTE_BUTTON_DETAIL), "Quote Viewed");
  assert.equal(eventLabel("ready_to_book", "viewed", "link:https://example.test"), "Email Viewed");
  assert.equal(eventLabel("company_intro", "opened"), "Email Viewed");
});

test("merge fields and address lines", () => {
  assert.equal(fillMerge("Hi {customer_name} job {job_number} {missing}", { customer_name: "Ann", job_number: "FB1" }), "Hi Ann job FB1 {missing}");
  assert.equal(placeLine("233 S Wacker Dr, Chicago, IL 60601", "60601"), "Chicago, IL 60601");
  assert.equal(placeLine("Chicago, IL 60601"), "Chicago, IL 60601");
  assert.equal(stateCode("233 S Wacker Dr, Chicago, IL 60601"), "IL");
  const fields = letterFields({
    est: {
      job_number: "FB400001", customer_name: "Jane Rivera",
      pickup_address: "1 Main St, Austin, TX 78701", delivery_address: "9 Oak Ave, Denver, CO 80202",
      primary_date: "2026-11-01",
    },
    vehicles: [], quote: null, assetBaseUrl: "https://crm.example.test",
    rep: { name: "Sam Rep", email: "rep@example.test", phone: "303-555-0101" },
    links: { quoteLandingHref: "https://crm.example.test/v/tok", jobNumberHref: "https://crm.example.test/d/FB400001/tok" },
  });
  assert.equal(fields.rep_title, DEFAULT_REP_TITLE);
  assert.equal(fields.rep_direct_line, "303-555-0101");
  assert.equal(fields.reservation_link, "https://crm.example.test/v/tok");
  assert.equal(fields.pickup_city_state_zip, "Austin, TX 78701");
  assert.equal(fields.delivery_state, "CO");
  assert.equal(fields.pickup_date, "11/01/2026");
  assert.equal(fields.office_phone, DEFAULT_COMPANY.mainPhone);
});

const sample = (extra = {}) => ({
  est: {
    job_number: "FB400001", customer_name: "Jane Rivera", customer_phone: "312-555-0142", created_at: "2026-10-23T12:00:00Z",
    pickup_address: "1 Main St, Austin, TX 78701", delivery_address: "9 Oak Ave, Denver, CO 80202", primary_date: "2026-11-01",
  },
  vehicles: [],
  quote: null,
  rep: { name: "Sam Rep", email: "rep@example.test", phone: "303-555-0101" },
  assetBaseUrl: "https://crm.example.test",
  ...extra,
});

test("regular and quote letters link directly to the document and keep the pixel; pickup uses landing", () => {
  const links = {
    quoteLandingHref: `https://crm.example.test/v/${token}`,
    jobNumberHref: `https://crm.example.test/d/FB400001/${token}`,
    trackingPixelUrl: `https://crm.example.test/api/email/open/${token}`,
    clickBase: `https://crm.example.test/api/email/click/${token}`,
    optOutHref: `https://crm.example.test/u/${token}`,
  };
  const quote = renderTemplate("ready_to_book", sample({ links: { ...links, quoteLandingHref: null } })).html;
  assert.ok(quote.includes(`href="https://crm.example.test/d/FB400001/${token}"`), "direct document link");
  assert.ok(quote.includes("Click your job number FB400001 to view your quote"));
  assert.ok(quote.includes(`/api/email/open/${token}`), "quote letters keep the pixel");
  const other = renderTemplate("flex_pricing", sample({ links: { ...links, quoteLandingHref: null } })).html;
  assert.ok(other.includes(`/api/email/open/${token}`), "other letters keep the pixel");
  assert.ok(!other.includes(`/v/${token}`), "other letters have no landing link");
  assert.ok(other.includes(OTHER_JOB_LINE.replace("{job_number}", "FB400001")));
  const chat = renderTemplate("hi_lets_chat", sample({ links: { ...links, quoteLandingHref: null } })).html;
  assert.match(renderTemplate("hi_lets_chat", sample({ links: { ...links, quoteLandingHref: null } })).subject, /^Hi, let's chat!/);
  assert.ok(chat.includes(`href="https://crm.example.test/d/FB400001/${token}"`));
});

test("letters use company settings, the repo logo, and the draft fax", () => {
  const company = { ...DEFAULT_COMPANY, mainPhone: "555-000-1111", companyEmail: "new@example.test", website: "example.test", address: "Denver, CO" };
  for (const key of ["request_received", "company_intro", "ready_to_book", "flex_pricing", "honest_followup", "booked_scheduled", "pickup_confirmed", "hi_lets_chat"]) {
    const html = renderTemplate(key, sample({ company, rep: { name: "Sam Rep", email: "", phone: "" } })).html;
    assert.ok(html.includes("https://crm.example.test/brand/fastbreak-logo.png"), `${key}: logo`);
    assert.ok(html.includes("555-000-1111") && !html.includes("555-010-0101") && !html.includes("866-240-7648"), `${key}: office phone from settings`);
    assert.ok(html.includes("new@example.test"), `${key}: email from settings`);
    assert.ok(!html.includes("555-017-9916") && !html.includes("Fax:"), `${key}: no old fax`);
    assert.ok(html.includes(DEFAULT_REP_TITLE), `${key}: placeholder title`);
    assert.ok(html.includes('data-rep-signature="1"'), `${key}: rep signature`);
  }
  assert.equal(QUOTE_PAGE_BUTTON, "Click job number {job_number} to view your quote");
});

test("the view-events migration is additive", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261026220000_customer_email_view_events.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.customer_email_view_events/);
  assert.match(sql, /event_type in \('quote_viewed', 'email_viewed'\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.customer_email_view_events from public, anon, authenticated/);
  assert.match(sql, /grant select, insert on table public\.customer_email_view_events to service_role/);
  assert.match(sql, /'ready_to_book'/);
  assert.match(sql, /'e_quote'/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /delete from/i);
});

test("pickup confirmation: job number is a real <a href> to the landing page for carrier info", async () => {
  const { renderTemplate } = await import("../lib/templates/registry.ts");
  const { messageLinks } = await import("../lib/customer-email-views.ts");
  const m = messageLinks("pickup_confirmed", "https://crm.example.com", "tok123", "FB400010");
  const out = renderTemplate("pickup_confirmed", { est: { job_number: "FB400010", customer_name: "Owner", status: "booked", primary_date: "2026-11-10" }, vehicles: [], quote: null, assetBaseUrl: "https://crm.example.com", links: m.links });
  assert.match(out.bodyHtml, /<a href="https:\/\/crm\.example\.com\/v\/tok123"[^>]*>Click on job number to view carrier info/);
});
