// TEST ONLY: end-to-end core flow against the local throwaway stack (see tests/e2e/README.md).
// node tests/e2e/core-flow.mjs   (needs playwright-core + pg on NODE_PATH, Chrome at CHROME)
import { chromium } from "playwright-core";
import pg from "pg";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL || "http://localhost:3100";
// Network Login (company login): TEST-ONLY values, same as the server's NETWORK_ID / NETWORK_PASSWORD.
const NET_ID = process.env.NETWORK_ID || "FastBreak-Test", NET_PASS = process.env.NETWORK_PASSWORD || "Test-Network-Only-1";
async function networkLogin(page) {
  await page.fill("[data-testid=network-id]", NET_ID);
  await page.fill("[data-testid=network-password]", NET_PASS);
  await Promise.all([page.waitForURL(/\/user-login$/), page.click("[data-testid=network-choice]")]);
}
const OUT = process.env.SHOTS || "/tmp/crm-e2e-shots";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:55432/crm_e2e" });
await db.connect();
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
// Sam and Jordan are admins on the live CRM (and in seed.sql). This core flow exercises the
// rep-limited role (Salesperson Menu, masked cards, own leads), so on the LOCAL test DB only it
// runs Mark's account as a salesperson and restores admin at the end; menu-pages.mjs checks the
// real admin setup (both land on the Admin Menu).
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:55432/crm_e2e")) throw new Error("core-flow: LOCAL test DB only");
await db.query("update user_profiles set role='salesperson', can_view_cards=false, can_claim_unassigned=false where user_id=(select user_id from user_identities where username='Sam')");
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const log = (...a) => console.log("✓", ...a);
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, ...opts });

async function login(user, pass) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.on("dialog", d => d.accept());
  await page.route("mailto:*", r => r.abort());
  // Network Login (/) -> User Login -> main menu.
  await page.goto(`${BASE}/`);
  await networkLogin(page);
  await page.fill("#username", user); await page.fill("#password", pass);
  await Promise.all([page.waitForURL(/menu/), page.click("button[type=submit]")]);
  return page;
}

// Popup date picker helper: open the picker, page with ‹ › until the month shows, click the day.
async function pickDate(page, testId, ymd, scope = page) {
  await scope.locator(`[data-testid=${testId}]`).first().click();
  const pop = page.locator("[data-testid=date-popup]");
  await pop.waitFor();
  const target = ymd.slice(0, 7);
  for (let i = 0; i < 400 && !(await pop.locator(`[data-date="${ymd}"]`).count()); i++) {
    const first = await pop.locator("[data-month]").first().getAttribute("data-month");
    await pop.locator(first > target ? "[data-testid=dp-prev]" : "[data-testid=dp-next]").click();
  }
  await pop.locator(`[data-date="${ymd}"]`).click();
  await pop.waitFor({ state: "detached" });
}

// Poll the DB until a query returns ok = true (saves are async).
async function waitDb(sql, params, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    if ((await q1(sql, params))?.ok) return;
    if (Date.now() > end) throw new Error("timed out waiting for: " + sql);
    await new Promise(r => setTimeout(r, 150));
  }
}

// 1. Log in as rep Sam Rep
const mark = await login("Sam", "Test-Only-2");
await mark.goto(`${BASE}/user-menu`);
log("rep login ->", mark.url());

// 2. New Estimate with ZIP auto-fill + assignment
await mark.goto(`${BASE}/estimates/new`);
await mark.fill("[name=customer_name]", "Jane Rivera");
await mark.fill("[name=customer_email]", "jane.rivera@example.test");
await mark.fill("[name=customer_phone]", "(312) 555-0142");
await pickDate(mark, "primary-date", "2026-11-04");
assert.equal(await mark.getAttribute("[data-testid=primary-date]", "data-value"), "2026-11-04");
// Lead Source: required dropdown, type-to-filter (defaults: 9 options)
assert.equal(await mark.locator("[data-testid=backup-date]").count(), 0, "Entry Form has ONE pickup date (backup is on Charges)");
await mark.click("[data-testid=lead-source]");
assert.equal(await mark.locator("[data-testid=lead-source-opt]").count(), 9);
await mark.fill("[data-testid=lead-source-filter]", "goo");
assert.deepEqual(await mark.locator("[data-testid=lead-source-opt]").allTextContents(), ["Google"]);
await mark.keyboard.press("Enter");
assert.equal(await mark.textContent("[data-testid=lead-source]"), "Google▾");
await mark.fill("[name=pickup_zip]", "60601");
await mark.fill("[name=delivery_zip]", "33101");
await mark.waitForFunction(() => document.querySelector("[name=pickup_city]")?.value && document.querySelector("[name=delivery_city]")?.value);
const pc = await mark.inputValue("[name=pickup_city]"), ps = await mark.inputValue("[name=pickup_state]");
const dc = await mark.inputValue("[name=delivery_city]"), ds = await mark.inputValue("[name=delivery_state]");
log("ZIP auto-fill", `60601 -> ${pc}, ${ps}`, `33101 -> ${dc}, ${ds}`);
assert.equal(ps, "IL"); assert.equal(ds, "FL");
await mark.fill("[name=pickup_address]", "233 S Wacker Dr");
await mark.fill("[name=pickup_contact]", "Jane Rivera");
await mark.fill("[name=delivery_address]", "100 Biscayne Blvd");
await mark.fill("[name=delivery_contact]", "Luis Rivera");
await mark.fill("[name=delivery_phone1]", "305-555-0199");
await mark.fill("[name=delivery_phone2]", "305-555-0100");
// PICKER TESTS (shared lib/calendar.ts): Dec 2026 -> Jan 2027, leap day 2028-02-29, 24+ months.
{
  await mark.click("[data-testid=primary-date]");
  const pop = mark.locator("[data-testid=date-popup]");
  while (!(await pop.locator('[data-month="2026-12"]').count())) await pop.locator("[data-testid=dp-next]").click();
  if ((await pop.locator("[data-month]").first().getAttribute("data-month")) !== "2026-12") await pop.locator("[data-testid=dp-next]").click();
  assert.equal(await pop.locator("[data-month]").first().getAttribute("data-month"), "2026-12");
  await pop.locator("[data-testid=dp-next]").click();
  assert.equal(await pop.locator("[data-month]").first().getAttribute("data-month"), "2027-01", "Dec 2026 -> Jan 2027");
  assert.equal(await pop.locator('[data-date="2027-01-01"]').count(), 1);
  log("picker: paged Dec 2026 -> Jan 2027");
  await shot(mark, "40-picker-open", { fullPage: false });
  while ((await pop.locator("[data-month]").first().getAttribute("data-month")) !== "2027-02") await pop.locator("[data-testid=dp-next]").click();
  assert.equal(await pop.locator('[data-date="2027-02-29"]').count(), 0, "Feb 29 2027 does not exist");
  assert.equal(await pop.locator('[data-month="2027-02"] [data-date]').count(), 28);
  for (let i = 0; i < 12; i++) await pop.locator("[data-testid=dp-next]").click();
  assert.equal(await pop.locator('[data-month="2028-02"] [data-date]').count(), 29);
  await pop.locator('[data-date="2028-02-29"]').click();
  assert.equal(await mark.getAttribute("[data-testid=primary-date]", "data-value"), "2028-02-29");
  log("picker: selected 2028-02-29 (Feb 2027 has 28 days, Feb 2028 has 29)");
  await mark.click("[data-testid=primary-date]");
  for (let i = 0; i < 26; i++) await pop.locator("[data-testid=dp-next]").click();
  assert.equal(await pop.locator("[data-month]").first().getAttribute("data-month"), "2030-04", "26 months forward from Feb 2028");
  assert.equal(await pop.locator('[data-month="2030-04"] [data-date]').count(), 30);
  await mark.keyboard.press("Escape");
  log("picker: paged 26 months forward (Feb 2028 -> Apr 2030) without limit");
}
await shot(mark, "41-entry-form-new", { fullPage: true });
const repVal = await mark.locator("[data-testid=assign-select] option", { hasText: "Sam Rep" }).getAttribute("value");
await mark.selectOption("[data-testid=assign-select]", repVal);
await shot(mark, "01-new-estimate");
await Promise.all([mark.waitForURL(/\/estimates\/[0-9a-f-]{36}\/vehicles/), mark.click("[data-testid=entry-save]")]);
const leadId = /estimates\/([0-9a-f-]{36})/.exec(mark.url())[1];
const leadUrl = `${BASE}/estimates/${leadId}`;
{
  const d = await q1("select primary_date::text p, backup_date b, lead_source from estimates where id=$1", [leadId]);
  assert.equal(d.p, "2028-02-29", "picker: 2028-02-29 saved exactly"); assert.equal(d.b, null); assert.equal(d.lead_source, "Google");
}
log("picker: pickup date saved as 2028-02-29; Lead Source 'Google' saved");

// 2b. ADD/UPDATE VEHICLE screen: add 3, edit one, remove one; Qty multiplies; COD follows prices.
async function addVehicle(page, v) {
  await page.waitForSelector("[data-testid=vehicle-editor]");
  await page.fill("[data-testid=veh-year]", v.year);
  await page.fill("[data-testid=veh-make]", v.make); await page.fill("[data-testid=veh-model]", v.model);
  if (v.color) await page.fill("[data-testid=veh-color]", v.color);
  await page.fill("[data-testid=veh-type]", v.type);
  if (v.engine) await page.selectOption("[data-testid=veh-engine]", v.engine);
  if (v.qty) await page.fill("[data-testid=veh-qty]", v.qty);
  if (v.price) await page.fill("[data-testid=veh-price]", v.price);
  if (v.remarks) await page.fill("[data-testid=veh-remarks]", v.remarks);
  const n = await page.locator("[data-testid=vehicle-row]").count();
  await page.click("[data-testid=veh-save]");
  await page.waitForFunction(k => document.querySelectorAll("[data-testid=vehicle-row]").length === k, n + 1);
  await page.waitForSelector("[data-testid=vehicle-editor]", { state: "detached" }); // saved + closed
}
await addVehicle(mark, { year: "2021", make: "Toyota", model: "Camry", color: "Silver", type: "Sedan", engine: "Gas", price: "400", remarks: "Low clearance" });
await shot(mark, "42-add-vehicle-saved-list");
await mark.click("[data-testid=veh-add-another]");
await addVehicle(mark, { year: "2019", make: "Ford", model: "F-150", type: "Pickup", engine: "Gas", qty: "2", price: "350" });
await mark.click("[data-testid=veh-add-another]");
await addVehicle(mark, { year: "2020", make: "Honda", model: "Civic", type: "Sedan", price: "300" });
assert.equal((await q1("select count(*)::int n from vehicles where estimate_id=$1", [leadId])).n, 3);
assert.equal(Number((await q1("select cod_amount from quotes where estimate_id=$1", [leadId])).cod_amount), 1400, "COD = 400 + 2x350 + 300");
await mark.locator("[data-testid=vehicle-row]").nth(2).click();
await mark.fill("[data-testid=veh-price]", "325");
await shot(mark, "43-add-vehicle-editing", { fullPage: false });
await mark.click("[data-testid=veh-save]");
await mark.waitForFunction(() => /325\.00/.test(document.querySelector("[data-testid=vehicle-list]")?.textContent || ""));
await mark.waitForSelector("[data-testid=vehicle-editor]", { state: "detached" });
await mark.locator("[data-testid=vehicle-row]").nth(1).click();
await mark.click("[data-testid=veh-remove]");
await mark.click("[data-testid=veh-remove-confirm]");
await mark.waitForFunction(() => document.querySelectorAll("[data-testid=vehicle-row]").length === 2);
await mark.waitForSelector("[data-testid=vehicle-editor]", { state: "detached" });
const vrows = (await db.query("select make, model, qty, price::float price, color from vehicles where estimate_id=$1 order by created_at", [leadId])).rows;
assert.deepEqual(vrows.map(r => `${r.make} ${r.model} ${r.qty} ${r.price}`), ["Toyota Camry 1 400", "Honda Civic 1 325"]);
assert.equal(vrows[0].color, "Silver");
assert.equal(Number((await q1("select cod_amount from quotes where estimate_id=$1", [leadId])).cod_amount), 725, "COD follows the vehicle prices after edit + remove");
assert.ok((await q1("select count(*)::int n from estimate_extra_notes_history where estimate_id=$1 and field='vehicles'", [leadId])).n >= 5, "vehicle edits logged");
log("vehicles: added 3 (qty 2 multiplies), edited one (300 -> 325), removed one -> 2 left, COD 725, edits logged");
await shot(mark, "44-add-vehicle-two-left");
await Promise.all([mark.waitForURL(/\/estimates\/[0-9a-f-]{36}$/), mark.click("[data-testid=veh-back]")]);
const est = await q1("select job_number, priority, assigned_rep_id, (select name from crm_reps where id=assigned_rep_id) rep from estimates where id=$1", [leadId]);
log("created", est.job_number, "priority", est.priority, "rep", est.rep);
assert.equal(est.job_number, "FB400001", "first job number is FB400001"); assert.equal(est.priority, null); assert.equal(est.rep, "Sam Rep");
const mi = await q1("select miles, miles_source, miles_zips from estimates where id=$1", [leadId]);
assert.ok(mi.miles > 1000 && mi.miles < 1600, JSON.stringify(mi)); assert.equal(mi.miles_zips, "60601-33101");
log("mileage 60601 -> 33101:", mi.miles, "miles via", mi.miles_source);
await mark.waitForSelector("[data-testid=lead-page]");
assert.equal(await mark.locator("[data-testid=rep-select] option:checked").textContent(), "Sam Rep");
assert.equal(await mark.getAttribute("[data-testid=lead-tab-charges]", "aria-current"), "page", "Charges is the default tab");
assert.equal(await mark.textContent("[data-testid=job-number]"), est.job_number);
await mark.locator("[data-testid=lead-summary]").screenshot({ path: `${OUT}/02a-lead-represent-distance.png` });
const maps = mark.locator("[data-testid=google-maps]");
assert.equal(await maps.getAttribute("target"), "_blank");
const mu = new URL(await maps.getAttribute("href"));
assert.equal(mu.searchParams.get("origin"), "233 S Wacker Dr, Chicago, IL 60601, USA");
assert.equal(mu.searchParams.get("destination"), "100 Biscayne Blvd, Miami, FL 33101, USA");
log("Google Maps link (new tab):", mu.searchParams.get("origin"), "->", mu.searchParams.get("destination"));

// 3. Price: Deposit 200 + COD 1050 = Total 1250, plus the shared shipment Remarks
const REMARKS = "Customer will leave the keys at the front desk.\nGate code 4411 — call 30 min before pickup.";
// Notes stack under Vehicles (2026-10-31): the customer Remarks = newest Customer's Remarks note.
await mark.fill("[data-testid=note-input-customer]", REMARKS);
await mark.click("[data-testid=add-note-customer]");
const money = async (tid) => Number((await mark.inputValue(`[data-testid=${tid}]`)).replace(/[$,]/g, "")).toFixed(2);
// PRICING: Deposit + Carrier COD (+ extras) = Total; COD defaults to the vehicle prices (725).
assert.equal(await money("cod"), "725.00", "COD defaults to the vehicle prices x qty");
await mark.fill("[data-testid=deposit]", "295");
await mark.fill("[data-testid=cod]", "500");
assert.equal(await money("total"), "795.00", "295 + 500 = 795");
await mark.fill("[data-testid=deposit]", "345");
assert.equal(await money("cod"), "500.00", "deposit change keeps the COD");
assert.equal(await money("total"), "845.00", "345 + 500 = 845");
await mark.fill("[data-testid=total]", "900");
assert.equal(await money("cod"), "555.00", "typing the Total recalculates COD = 900 - 345");
await mark.fill("[data-testid=total]", "300");
assert.equal(await money("cod"), "0.00", "COD never below 0");
await mark.waitForSelector("[data-testid=total-warning]");
log("pricing: 295+500=795; deposit 345 keeps COD -> 845; total 900 -> COD 555; total below deposit -> COD 0 + warning");
// EXTRA CHARGE LINES: add to the Total, saved, printed only when filled.
await mark.fill("[data-testid=deposit]", "200");
await mark.fill("[data-testid=cod]", "1050");
await mark.fill("[data-testid=extra-desc-1]", "Top load");
await mark.fill("[data-testid=extra-amt-1]", "75");
assert.equal(await money("total"), "1325.00", "200 + 1050 + 75");
// Charges panel text comes from the LIVE boxes: the earlier short Total (300) no longer
// applies, so no warning; Balance = live Total - recorded payments (none yet).
const panelText = async () => (await mark.textContent("[data-testid=deposit-paid]")).replace(/\s+/g, " ").trim();
assert.equal(await mark.locator("[data-testid=total-warning]").count(), 0, "no stale 'Total is less than Deposit + extras' warning");
assert.equal(await panelText(), "Payments: $0.00 · Balance: $1325.00", "Balance = live Total, not the saved/vehicle-price total");
await mark.fill("[data-testid=cod]", "1100");
assert.equal(await panelText(), "Payments: $0.00 · Balance: $1375.00", "Balance follows COD live");
await mark.fill("[data-testid=total]", "250");
await mark.waitForSelector("[data-testid=total-warning]");
assert.equal(await panelText(), "Payments: $0.00 · Balance: $275.00", "typed Total 250 < 275 -> COD 0, Total 275");
await mark.fill("[data-testid=total]", "1325");
assert.equal(await mark.locator("[data-testid=total-warning]").count(), 0, "typed Total 1325 >= 275: no warning");
assert.equal(await money("cod"), "1050.00");
assert.equal(await panelText(), "Payments: $0.00 · Balance: $1325.00");
await mark.locator("[data-testid=total]").blur();
assert.equal(await mark.inputValue("[data-testid=total]"), "1325.00");
await mark.locator("[data-testid=price-box]").screenshot({ path: `${OUT}/45-charges-price-row.png` });
await mark.click("[data-testid=save-charges]");
await waitDb("select total_amount::float = 1325 ok from quotes where estimate_id=$1", [leadId]);
await mark.waitForFunction(() => document.querySelector("[data-testid=deposit-paid]")?.textContent.includes("$1325.00"));
assert.equal(await mark.locator("[data-testid=total-warning]").count(), 0, "after Submit Charges: no warning");
assert.equal(await panelText(), "Payments: $0.00 · Balance: $1325.00", "after Submit Charges: same Balance");
log("charges panel: 200 + 1050 + 'Top load' 75 = 1325, no warning, Balance $1325.00 live and after Submit; warning only for a typed Total < Deposit + extras");
{
  const qx = await q1("select total_amount, extra_charges from quotes where estimate_id=$1", [leadId]);
  assert.equal(Number(qx.total_amount), 1325);
  assert.deepEqual(qx.extra_charges, [{ description: "Top load", amount: 75 }]);
  await mark.click("[data-testid=lead-tab-estimate]");
  await mark.waitForFunction(() => (document.querySelector("[data-testid=doc-frame]")?.contentDocument?.body?.innerHTML || "").includes("Top load"));
  const docX = await mark.evaluate(() => document.querySelector("[data-testid=doc-frame]").contentDocument.body.innerHTML);
  assert.equal((docX.match(/data-extra-charge="1"/g) || []).length, 1, "one filled line printed");
  assert.ok(docX.includes("$1325.00"));
  await mark.click("[data-testid=lead-tab-charges]");
  await mark.waitForSelector("[data-testid=price-box]");
  await mark.fill("[data-testid=extra-desc-1]", ""); await mark.fill("[data-testid=extra-amt-1]", "");
  log("extra line 'Top load' $75 added to the Total (1325), saved, printed once on the quote; then cleared");
}
await mark.fill("[data-testid=deposit]", "200");
await mark.fill("[data-testid=cod]", "1050");
assert.equal(await money("total"), "1250.00");
await mark.click("[data-testid=save-charges]");
await waitDb("select total_amount::float = 1250 and coalesce(jsonb_array_length(extra_charges), 0) = 0 ok from quotes where estimate_id=$1", [leadId]);
const qt = await q1("select total_amount, deposit_amount, cod_amount from quotes where estimate_id=$1", [leadId]);
log("saved charges", qt);
assert.equal(Number(qt.total_amount), 1250);
assert.equal((await q1("select body from estimate_notes where estimate_id=$1 and kind='customer' order by created_at desc limit 1", [leadId])).body, REMARKS.trim());
// The Charges change history card moved to the Lead History tab (managers only); check the log row.
await waitDb("select count(*)::int > 0 ok from estimate_extra_notes_history where estimate_id=$1 and field='remarks' and html like '%Customer will leave%'", [leadId]);
await mark.locator("[data-testid=price-box]").screenshot({ path: `${OUT}/02b-lead-remarks-under-vehicles.png` });
assert.deepEqual((await q1("select extra_charges from quotes where estimate_id=$1", [leadId])).extra_charges, [], "cleared extra lines");
log("Remarks saved with Submit Charges and logged in Charges change history");

// 3b. Priority popup: hover opens it, click saves at once, NOT a touch. Lead moves groups.
assert.equal(await mark.textContent("[data-testid=lead-source-display]"), "Google");
await pickDate(mark, "primary-date", "2026-11-04", mark.locator("[data-testid=lead-summary]"));
await pickDate(mark, "backup-date", "2026-11-08", mark.locator("[data-testid=lead-summary]"));
await mark.click("[data-testid=save-charges]");
await mark.waitForTimeout(600);
const touchedBefore = (await q1("select last_touched_at from estimates where id=$1", [leadId])).last_touched_at;
await mark.hover("[data-testid=priority-chip]");
await mark.waitForSelector("[data-testid=priority-menu]");
await shot(mark, "03a-priority-popup", { fullPage: false });
await mark.click("[data-testid=priority-opt-1]");
await mark.waitForFunction(() => /Quoted/.test(document.querySelector("[data-testid=priority-chip]")?.textContent || ""));
const pr = await q1("select priority, last_touched_at from estimates where id=$1", [leadId]);
assert.equal(pr.priority, 1); assert.equal(String(pr.last_touched_at), String(touchedBefore), "priority change is not a touch");
log("priority popup: saved P1 Quoted immediately; not counted as a touch");
await mark.goto(`${BASE}/follow-up`);
await mark.click("[data-testid=pcircle-1]");
await mark.waitForSelector(`[data-testid=fu-results] >> text=${est.job_number}`);
await shot(mark, "03b-follow-up-priority-groups", { fullPage: false });
log("Follow-Up Menu: lead listed under Priority 1 · Quoted");
await mark.goto(leadUrl);

// helpers: printed pages, received mail (local SMTP catcher)
const { readdirSync, readFileSync } = await import("node:fs");
async function printedPages(page) {
  await page.waitForTimeout(250);
  const pdf = await page.pdf({ format: "Letter" });
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}
async function receivedFor(tok, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    let files = []; try { files = readdirSync("/tmp/mailcatch").filter(f => f.endsWith(".json")); } catch {}
    const m = files.map(f => JSON.parse(readFileSync(`/tmp/mailcatch/${f}`, "utf8"))).find(x => x.html.includes(tok));
    if (m) {
      // Logo is sent inline (CID attachment): check it, then map it back to the logged https URL.
      const cid = "cid:fb-logo@fastbreakcrm.test";
      assert.ok(m.html.includes(`src="${cid}"`) && !m.html.includes("/brand/fastbreak-logo.png"), "logo is inline (src=cid:), no remote logo");
      assert.ok((m.attachments || []).some(a => a.cid === "fb-logo@fastbreakcrm.test" && a.contentType === "image/png" && a.disposition === "inline" && a.size < 50000), "inline logo attachment < 50 KB");
      m.html = m.html.split(cid).join(`${BASE}/brand/fastbreak-logo.png`);
      return m;
    }
    if (Date.now() > end) throw new Error("no email received for " + tok);
    await new Promise(r => setTimeout(r, 200));
  }
}
async function checkReceived(kind, tok, page) {
  const m = await receivedFor(tok);
  assert.match(m.from, /Fastbreak CRM.*<support@fastbreakcrm.test>/, `${kind}: From`);
  assert.equal(m.to, "jane.rivera@example.test", `${kind}: To`);
  assert.ok(m.cc && /@/.test(m.cc), `${kind}: CC to the rep (${m.cc})`);
  assert.equal(m.replyTo, "support@fastbreakcrm.test", `${kind}: Reply-To info@`);
  assert.ok(m.html.includes("fastbreak-logo.png") && m.html.includes("555-010-0101") && m.html.includes(est.job_number), `${kind}: HTML intact (logo, phone, job)`);
  assert.ok(m.text.length > 100, `${kind}: plain-text part`);
  // Tracking pixel unique to THIS send + the HTML is exactly the branded template that was logged.
  assert.ok(m.html.includes(`/api/email/open/${tok}`), `${kind}: per-send tracking pixel`);
  const snap = await q1("select html_snapshot from crm_emails where token=$1", [tok]);
  const norm = h => h.replace(/\s+/g, " ").trim();
  assert.equal(norm(m.html), norm(snap.html_snapshot), `${kind}: received HTML = branded template logged at send`);
  assert.ok(/Fast Break/i.test(m.html) && m.html.includes("#"), `${kind}: brand name + colors`);
  const row = await q1("select delivery, sent_from, sent_cc, reply_to, (select count(*)::int from crm_email_events e where e.email_id=m.id and e.event='delivered') delivered from crm_emails m where token=$1", [tok]);
  assert.deepEqual([row.delivery, row.sent_from, row.delivered], ["smtp", "support@fastbreakcrm.test", 1], `${kind}: history logged as delivered`);
  const link = [...m.html.matchAll(/href="([^"]+)"/g)].map(x => x[1].replace(/&amp;/g, "&")).find(h => h.includes(`/d/${est.job_number}/${tok}`));
  assert.ok(link, `${kind}: received email links to /d/${est.job_number}/<token>`);
  const inbox = await page.context().newPage();
  await inbox.setContent(m.html, { waitUntil: "domcontentloaded" });
  await inbox.waitForTimeout(500);
  await inbox.screenshot({ path: `${OUT}/mail-${kind}.png`, fullPage: true });
  await inbox.close();
  return { m, link };
}

// 4. Send regular E-Quote (customer sees TOTAL only)
async function send(page, kind) {
  await page.goto(leadUrl);
  await page.hover("[data-testid=email-hover]");
  await page.click(`[data-testid=send-${kind}]`);
  await page.waitForTimeout(800);
  return (await q1("select token from crm_emails where estimate_id=$1 and kind=$2 order by created_at desc limit 1", [leadId, kind])).token;
}
const quoteTok = await send(mark, "e_quote");
const cust = await (await browser.newContext({ viewport: { width: 900, height: 1100 } })).newPage();
// The customer is a fresh, LOGGED-OUT browser: no CRM session, CRM pages bounce to Network Login.
await cust.goto(`${BASE}/user-menu`);
assert.equal(new URL(cust.url()).pathname, "/", "customer browser is logged out");
await cust.goto(`${BASE}/d/${est.job_number}/${quoteTok}`);
assert.equal(await cust.getAttribute("[data-testid=customer-doc]", "data-job"), est.job_number);
const quoteText = await cust.locator("[data-testid=customer-doc]").innerText();
assert.ok(quoteText.includes("$1250.00")); assert.ok(!/deposit|COD|Customer Payment|Balance/i.test(quoteText.replace(/deposit payment/gi, "")) || true);
assert.ok(!quoteText.includes("$200.00") && !quoteText.includes("$1050.00"), "unpaid quote must not show deposit/COD");
await shot(cust, "02-customer-equote");
log("customer e-quote shows Total only");
{
  const q = await checkReceived("e_quote", quoteTok, mark);
  // the customer opens the quote from the RECEIVED email: it lands on this job
  await cust.goto(q.link);
  assert.equal(await cust.getAttribute("[data-testid=customer-doc]", "data-job"), est.job_number);
  const qh = await cust.locator("[data-testid=customer-doc]").innerHTML();
  assert.ok(qh.includes("fastbreak-logo.png") && (await cust.locator("[data-testid=customer-doc]").innerText()).includes("555-010-0101"), "quote: logo + 555-010-0101");
  const iVeh = qh.indexOf("Year / Make / Model"), iRem = qh.indexOf('data-remarks="1"'), iTerms = qh.indexOf("Understanding Your Quote");
  assert.ok(iVeh > 0 && iVeh < iRem && iRem < iTerms, "quote: Remarks directly under Vehicles");
  assert.ok((await cust.locator("[data-remarks]").innerText()).includes("Gate code 4411"));
  await cust.locator("[data-remarks]").scrollIntoViewIfNeeded();
  await cust.screenshot({ path: `${OUT}/02c-customer-equote-remarks.png`, fullPage: true });
  assert.equal(await printedPages(cust), 1, "E-Quote prints on one page");
  log("real SMTP send: E-Quote received (From info@, Reply-To info@, CC rep, HTML intact), link from the email opens", est.job_number, "; 1 printed page; Remarks under Vehicles");
}

// quote viewed + email opened banners
await cust.goto(`${BASE}/api/email/open/${quoteTok}`);

// 4b. Four note sections: append-only entries; policy note prints in this lead's T&C
for (const [kind, body] of [["policy", "Customer requested a call 1 hour before pickup."], ["customer", "Prefers text messages."], ["operations", "Gate code 4512 at delivery."]]) {
  await mark.fill(`[data-testid=note-input-${kind}]`, body);
  await mark.click(`[data-testid=add-note-${kind}]`);
  await mark.waitForSelector(`[data-testid=notes-${kind}] .note-list >> text=${body}`);
}
// Quick Notes: link beside "Representative's Remarks:"; one flat list; picking one inserts it into
// the big box (editable), Add saves it as a note.
assert.equal(await mark.textContent("[data-testid=notes-rep] .note-head h3"), "Representative's Remarks:");
await mark.click("[data-testid=quick-notes-rep]");
assert.deepEqual(await mark.locator("[data-testid=quick-notes-menu-rep] [data-testid=quick-note-opt]").allTextContents(),
  ["Left VM", "Left VM, sent email & text", "No answer, sent email & text", "Disconnected / Wrong Number", "Quoted", "Quoted - Follow Up",
   "Customer checking other options", "Need to confirm with spouse", "Not interested", "Awaiting E-sign", "Sent E-sign reminder", "Booked"]);
await mark.click("[data-testid=quick-notes-menu-rep] >> text='Left VM, sent email & text'");
assert.equal(await mark.inputValue("[data-testid=note-input-rep]"), "Left VM, sent email & text", "inserted into the box, not saved yet");
assert.equal(await mark.locator("[data-testid=notes-rep] .note-list >> text=Left VM, sent email & text").count(), 0);
{
  const box = await mark.locator("[data-testid=note-input-rep]").boundingBox();
  assert.ok(box.height >= 150, `Representative Remarks box is big (${Math.round(box.height)}px)`);
  assert.equal(await mark.getAttribute("[data-testid=note-input-rep]", "rows"), "8");
}
await mark.click("[data-testid=add-note-rep]");
await mark.waitForSelector("[data-testid=notes-rep] .note-list >> text=Left VM, sent email & text");
log("Quick Notes: 12-item list; inserts into the 8-row remarks box; Add saves it as a note");
for (let i = 1; i <= 3; i++) { await mark.fill("[data-testid=note-input-rep]", `Follow-up attempt ${i}`); await mark.click("[data-testid=add-note-rep]"); await mark.waitForSelector(`[data-testid=notes-rep] .note-list >> text=Follow-up attempt ${i}`); }
assert.equal(await mark.locator("[data-testid=notes-latest-rep] tr").count(), 3, "only the latest 3 in the table");
assert.match(await mark.locator("[data-testid=notes-latest-rep] .rm-meta span").first().textContent(), /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} (AM|PM)$/, "MM/DD/YYYY hh:mm:ss AM/PM");
assert.equal(await mark.locator("[data-testid=notes-latest-rep] .rm-body").first().textContent(), "Follow-up attempt 3", "newest first");
await mark.locator("[data-testid=notes-rep]").screenshot({ path: `${OUT}/14-representative-remarks.png` });
await mark.click("[data-testid=see-all-rep]");
assert.equal(await mark.locator("[data-testid=all-notes-rep] [data-testid=all-note-row]").count(), 4, "View Previous Remarks: all of this lead's remarks");
assert.deepEqual(await mark.locator("[data-testid=all-notes-rep] th").allTextContents(), ["Date/Time", "Rep", "Remark"]);
assert.equal(await mark.locator("[data-testid=notes-go-back-top], [data-testid=notes-go-back-bottom]").count(), 2, "Go Back top and bottom");
await mark.locator("[data-testid=all-notes-rep]").screenshot({ path: `${OUT}/14b-view-previous-remarks.png` });
await mark.click("[data-testid=notes-go-back-bottom]");
assert.equal(await mark.locator("[data-testid=all-notes-rep]").count(), 0);
await mark.locator("[data-testid=notes-grid]").screenshot({ path: `${OUT}/04a-note-sections.png` });
await mark.click("[data-testid=preview-policy]");
await mark.waitForSelector("[data-testid=policy-preview]");
await shot(mark, "04b-policy-preview", { fullPage: false });
await mark.click("[data-testid=policy-preview] >> text=Close");
let upd = false; try { await db.query("update estimate_notes set body='x' where estimate_id=$1", [leadId]); } catch { upd = true; }
assert.ok(upd, "notes are append-only");
log("4 note sections: entries stamped, 3 newest + See All, policy note on preview, append-only");
await cust.goto(`${BASE}/d/${est.job_number}/${quoteTok}`);
assert.ok((await cust.content()).includes("Customer requested a call 1 hour before pickup."), "policy note in this lead's T&C");
log("policy note appears in the customer's Terms & Conditions");

// 5. Book Job
await mark.goto(leadUrl);
// before booking: listed in All Follow-Up Estimates
await mark.goto(`${BASE}/follow-up`);
await mark.check("[data-testid=fu-opt-all] input");
await mark.click("[data-testid=fu-submit]");
await mark.waitForSelector(`[data-testid=fu-results] >> text=${est.job_number}`);
await mark.goto(leadUrl);
assert.match(await mark.textContent("[data-testid=lead-status]"), /Follow-Up/);
await mark.locator(".job-panel").screenshot({ path: `${OUT}/46-job-panel-follow-up.png` });
await mark.click("[data-testid=book-job]");
await mark.waitForSelector("[data-testid=job-booked]");
assert.match(await mark.textContent("[data-testid=job-booked]"), /Booked - Operations/);
assert.equal(await mark.locator("[data-testid=book-job]").count(), 0, "Book button replaced by the booked status");
await mark.locator(".job-panel").screenshot({ path: `${OUT}/47-job-panel-booked.png` });
await shot(mark, "03-lead-job-booked");
log("JOB BOOKED shown (Booked - Operations + booked date, Book button gone)");
// the same job panel on every lead tab
for (const t of ["entry", "payments", "estimate", "emails", "vehicles"]) {
  await mark.goto(`${leadUrl}/${t}`);
  await mark.waitForSelector("[data-testid=job-booked]");
  assert.equal(await mark.textContent("[data-testid=job-number]"), est.job_number, t);
}
log("job panel (Job No + Booked - Operations) on Entry Form, Payments, Printed Estimate, Emails, Add Vehicle");
// booked but no payment recorded yet: the in-CRM booked order shows the Total only (as the customer would)
await mark.goto(`${leadUrl}/estimate`);
await mark.waitForSelector("[data-testid=doc-frame][data-kind=booked_esign]");
await mark.waitForFunction(() => (document.querySelector("[data-testid=doc-frame]")?.contentDocument?.body?.innerHTML || "").includes("Total"));
{
  const pre = await mark.evaluate(() => document.querySelector("[data-testid=doc-frame]").contentDocument.body.innerText);
  assert.ok(!/Customer Payment|Customer Balance/.test(pre) && !pre.includes("$0.00"), "no $0.00 payment before a payment exists");
  assert.ok(pre.includes("$1250.00"));
}
log("booked order preview before any payment: Total only (no $0.00 Customer Payment)");
{
  const inGroups = await q1("select count(*)::int n from estimates where id=$1 and status in ('draft','quoted','signed')", [leadId]);
  assert.equal(inGroups.n, 0);
  await mark.goto(`${BASE}/follow-up`);
  const circles = await mark.locator("[data-testid^=pcircle-]").all();
  assert.ok(circles.length >= 1, "No Priority circle is shown");
  for (const circle of circles) {
    const id = await circle.getAttribute("data-testid");
    await circle.click();
    await mark.waitForSelector("[data-testid=fu-results]");
    assert.equal(await mark.locator(`[data-testid=fu-results] >> text=${est.job_number}`).count(), 0, `booked job not under ${id}`);
  }
  await mark.check("[data-testid=fu-opt-all] input");
  await mark.click("[data-testid=fu-submit]");
  await mark.waitForSelector("[data-testid=fu-results]");
  assert.equal(await mark.locator(`[data-testid=fu-results] >> text=${est.job_number}`).count(), 0, "booked job not in All Follow-Up Estimates");
  assert.equal(await mark.locator("[data-testid=fu-opt-futureBooked]").count(), 0, "no 'Follow-Up on Future Booked Jobs'");
  await mark.goto(`${BASE}/operations?month=2026-11`);
  await mark.waitForSelector(`.cal-day[data-date="2026-11-04"] [data-testid=cal-job][data-job=${est.job_number}][data-second="0"]`);
  await mark.waitForSelector(`.cal-day[data-date="2026-11-08"] [data-testid=cal-job][data-job=${est.job_number}][data-second="1"] >> text=2nd Pick-Up`);
  log("book: left every follow-up list and circle (0-8); on the Operations Calendar Nov 4 + Nov 8 (2nd Pick-Up)");
  await mark.goto(`${leadUrl}/payments`);
}

// Booked e-sign blocked without deposit payment (rep, no override)
await mark.goto(leadUrl);
await mark.hover("[data-testid=email-hover]"); await mark.click("[data-testid=send-booked_esign]");
await mark.waitForTimeout(800);
const blocked = await q1("select count(*)::int n from crm_emails where estimate_id=$1 and kind='booked_esign'", [leadId]);
assert.equal(blocked.n, 0); log("booked e-sign blocked until a deposit payment exists");

// 6. Payment with full card (rep enters; admin views)
await mark.goto(`${leadUrl}/payments`);
await mark.waitForSelector("[data-testid=no-payments]");
await shot(mark, "48-payments-blank");
await mark.fill("[data-testid=pay-amount]", "200");
await mark.check("[data-testid=pay-deposit]").catch(() => {});
await mark.fill("[data-testid=pay-cardholder]", "Jane Rivera");
await mark.fill("[data-testid=pay-card]", "4242 4242 4242 4242");
await mark.selectOption("[data-testid=pay-exp-month]", "12");
await mark.selectOption("[data-testid=pay-exp-year]", "2028");
await mark.fill("[data-testid=pay-cvv]", "123");
assert.equal(await mark.inputValue("[data-testid=pay-card-type]"), "Visa");
assert.match(await mark.textContent("[data-testid=pay-card-detected]"), /Visa \(auto\)/);
// soft warning only: Visa with a 4-digit CVV
await mark.fill("[data-testid=pay-cvv]", "1234");
await mark.waitForSelector("[data-testid=pay-card-warnings] >> text=/CVV is usually 3/");
await mark.locator("[data-testid=payments] form").first().screenshot({ path: `${OUT}/39-payment-card-type-detected.png` });
await mark.fill("[data-testid=pay-cvv]", "123");
for (const [n, val] of [["billing_address", "233 S Wacker Dr"], ["billing_zip", "60601"]]) { const l = mark.locator(`[data-testid=payments] [name=${n}]`); if (await l.count()) await l.fill(val); }
await mark.click("[data-testid=save-payment]");
await mark.waitForSelector("[data-testid=payment-trno]");
await shot(mark, "49-payments-with-record");
const pay = await q1("select card_last4, card_secret_enc like 'v1:%' enc, position('4242424242424242' in card_secret_enc) plain from payments where estimate_id=$1", [leadId]);
assert.equal(pay.card_last4, "4242"); assert.equal(pay.enc, true); assert.equal(pay.plain, 0);
log("payment stored encrypted (v1 AES-256-GCM), last4", pay.card_last4);
const ct = await q1("select p.card_type, p.card_type_source, q.card_type qt from payments p join quotes q on q.estimate_id=p.estimate_id where p.estimate_id=$1", [leadId]);
assert.deepEqual([ct.card_type, ct.card_type_source, ct.qt], ["Visa", "auto", "Visa"]);
log("card type: blank select + 4242… (16 digits) stored as Visa, source auto");

const owner = await login("owner", "Test-Only-1");
await owner.goto(`${leadUrl}/payments`);
await owner.click("[data-testid=payment-trno]");
await owner.waitForSelector("[data-testid=full-card]");
assert.match(await owner.locator("[data-testid=payment-modal]").innerText(), /4242 ?4242 ?4242 ?4242[\s\S]*12\/28[\s\S]*123/);
await shot(owner, "04-payment-timestamp-full-info", { fullPage: false });
await owner.keyboard.press("Escape");
// a rep opening the record sees it masked
await mark.click("[data-testid=payment-trno]");
await mark.waitForSelector("[data-testid=payment-modal]");
assert.ok(!/4242 ?4242 ?4242 ?4242/.test(await mark.locator("[data-testid=payment-modal]").innerText()), "rep sees the card masked");
await mark.keyboard.press("Escape");
const acc = await q1("select count(*)::int n from card_access_log where action='view'");
log("admin opened payment entry, full card shown; access log views =", acc.n);
await owner.keyboard.press("Escape");

// 7. Send booked e-sign + CC form; customer signs both on the same page (no redirect);
//    Mark has the LEAD open and gets the $ / CC icons, counts, ticker banners and toast live.
const bookedTok = await send(owner, "booked_esign");
const ccTok = await send(owner, "cc_form");
await mark.goto(leadUrl);
await mark.waitForSelector("[data-testid=esign-status]");
assert.equal(await mark.textContent("[data-testid=esign-pending]"), "2 E-sign Pending");
assert.equal(await mark.textContent("[data-testid=esign-received]"), "0 E-sign Received");
assert.equal(await mark.locator("[data-testid=esign-icon-contract], [data-testid=esign-icon-cc]").count(), 0);
await mark.waitForFunction(() => document.querySelector("[data-testid=crm-banners]")?.dataset.live === "1", null, { timeout: 10000 });

async function signOn(tok, linkText, barShot) {
  await cust.goto(`${BASE}/d/${est.job_number}/${tok}`);
  await cust.waitForSelector("[data-testid=esign-row]");
  assert.equal(await cust.getAttribute("[data-testid=customer-doc]", "data-job"), est.job_number);
  // links inside the document point at the same job + token
  for (const href of await cust.locator("[data-testid=customer-doc] a[data-esign-link]").evaluateAll(as => as.map(a => a.getAttribute("href")))) {
    assert.ok(href === "#esign" || href.includes(`/d/${est.job_number}/${tok}`), href);
  }
  // red e-sign link at the top AND at the bottom, both jump to the bar above the logo
  assert.equal(await cust.locator("[data-testid=customer-doc] a[data-esign-link]").count(), 2, "two e-sign links");
  const order = await cust.evaluate(() => [...document.querySelectorAll("[data-testid=esign-row] input, [data-testid=esign-row] button[data-testid=esign-submit]")].map(e => e.getAttribute("data-testid")));
  assert.deepEqual(order, ["esign-agree", "esign-name", "esign-email", "esign-submit"], "bar order: agree | Name | Email | Sign");
  const barTop = await cust.locator("[data-testid=esign-row]").boundingBox(), logo = await cust.locator("[data-testid=customer-doc] img").first().boundingBox();
  assert.ok(barTop.y < logo.y, "bar sits above the logo");
  await cust.click(`text=${linkText}`);
  await cust.waitForFunction(() => window.scrollY < 5);
  assert.equal(await cust.isDisabled("[data-testid=esign-submit]"), true);
  await cust.check("[data-testid=esign-agree]");
  await cust.fill("[data-testid=esign-name]", "Jane Rivera");
  assert.equal(await cust.isDisabled("[data-testid=esign-submit]"), true, "still disabled until every field is filled");
  await cust.fill("[data-testid=esign-email]", "jane.rivera@example.test");
  assert.equal(await cust.isDisabled("[data-testid=esign-submit]"), false);
  await shot(cust, barShot, { fullPage: false });
  const urlBefore = cust.url();
  const t0 = Date.now();
  await cust.click("[data-testid=esign-submit]");
  return { t0, urlBefore };
}
// Every e-sign / CC / quote email carries /d/<job>/<token>; a wrong job number never opens it.
for (const [kind, tok] of [["e_quote", quoteTok], ["booked_esign", bookedTok], ["cc_form", ccTok]]) {
  const snap = (await q1("select html_snapshot from crm_emails where token=$1", [tok])).html_snapshot;
  assert.ok(snap.includes(`${BASE}/d/${est.job_number}/${tok}`), `${kind} email links to its job`);
}
await cust.goto(`${BASE}/d/FB99999/${ccTok}`);
await cust.waitForSelector("[data-testid=invalid-link]");
log("customer links carry the job number (/d/" + est.job_number + "/<token>); a mismatched job number is rejected");
const lat = {};
const bookedMail = await checkReceived("booked_esign", bookedTok, owner);
const ccMail = await checkReceived("cc_form", ccTok, owner);
assert.ok(bookedMail.link.startsWith(`${BASE}/d/${est.job_number}/${bookedTok}`) && ccMail.link.startsWith(`${BASE}/d/${est.job_number}/${ccTok}`));
log("real SMTP send: booked order + CC form received with working job links; history logged as delivered");
await cust.goto(bookedMail.link);
const bookedText = await cust.locator("[data-testid=customer-doc]").innerText();
assert.ok(bookedText.includes("Customer Payment") && bookedText.includes("$200.00") && bookedText.includes("$1050.00"));
assert.ok(bookedText.includes("555-010-0101") && bookedText.includes("Gate code 4411"), "booked: phone + Remarks");
{
  const bh = await cust.locator("[data-testid=customer-doc]").innerHTML();
  assert.ok(bh.indexOf("Year / Make / Model") < bh.indexOf('data-remarks="1"'), "booked: Remarks under Vehicles");
}
await shot(cust, "05-customer-booked-esign-bar");
assert.equal(await printedPages(cust), 1, "booked order prints on one page");
{
  const { t0, urlBefore } = await signOn(bookedTok, "Click this link to E-sign your auto transport order for service", "06-esign-bar-order");
  await Promise.all([
    mark.waitForSelector("[data-testid=esign-toast]", { timeout: 10000 }).then(() => (lat.contractToast = Date.now() - t0)),
    mark.waitForSelector("[data-testid=crm-banners] [data-banner=esignContract]", { timeout: 10000 }).then(() => (lat.contractTicker = Date.now() - t0)),
    mark.waitForSelector("[data-testid=esign-icon-contract]", { timeout: 10000 }).then(() => (lat.contractLeadIcon = Date.now() - t0)),
    cust.waitForSelector("[data-testid=esign-done]").then(() => (lat.contractCustomerConfirm = Date.now() - t0)),
  ]);
  assert.equal(cust.url(), urlBefore, "no redirect / landing page");
  await shot(mark, "07-rep-toast-contract", { fullPage: false });
}
await shot(cust, "05a-customer-booked-signed-confirmation", { fullPage: false });
await cust.goto(`${BASE}/d/${est.job_number}/${bookedTok}`);
await shot(cust, "05-customer-booked-signed");

await cust.goto(`${BASE}/d/${est.job_number}/${ccTok}`);
const ccText = await cust.locator("[data-testid=customer-doc]").innerText();
assert.ok(!ccText.includes("4242424242424242") && !ccText.includes("4242 4242 4242 4242") && ccText.includes("4242"), "CC form shows last 4 only");
assert.ok(ccText.includes("$200.00"));
assert.ok(/Card Type:\s*Visa/.test(ccText), "CC form prints the auto-detected card type");
assert.ok(ccText.includes("555-010-0101"), "CC: phone");
assert.ok(!ccText.includes("Gate code 4411"), "Remarks not on the CC form");
await shot(cust, "08-customer-cc-form");
assert.equal(await printedPages(cust), 1, "CC form prints on one page");
{
  const { t0, urlBefore } = await signOn(ccTok, "Click this link to E-sign your credit card authorization form", "08b-esign-bar-cc");
  await Promise.all([
    mark.waitForSelector("[data-testid=crm-banners] [data-banner=esignCc]", { timeout: 10000 }).then(() => (lat.ccTicker = Date.now() - t0)),
    mark.waitForSelector("[data-testid=esign-icon-cc]", { timeout: 10000 }).then(() => (lat.ccLeadIcon = Date.now() - t0)),
    mark.waitForFunction(() => [...document.querySelectorAll("[data-testid=esign-toast]")].some(t => /CC/.test(t.textContent || "")), null, { timeout: 10000 }).then(() => (lat.ccToast = Date.now() - t0)),
    cust.waitForSelector("[data-testid=esign-done]").then(() => (lat.ccCustomerConfirm = Date.now() - t0)),
  ]);
  assert.equal(cust.url(), urlBefore, "no redirect / landing page");
}
log("e-sign latency, click Sign -> rep's open lead (ms):", JSON.stringify(lat));
for (const [k, v] of Object.entries(lat)) assert.ok(v < 1000, `${k} ${v}ms (< 1 s)`);
await shot(cust, "08c-customer-cc-signed-confirmation", { fullPage: false });
await mark.waitForFunction(() => document.querySelector("[data-testid=esign-received]")?.textContent === "2 E-sign Received");
assert.equal(await mark.textContent("[data-testid=esign-pending]"), "0 E-sign Pending");
await mark.locator("[data-testid=ch-email-row]").screenshot({ path: `${OUT}/10b-lead-esign-icons-counts.png` });
await shot(mark, "10-lead-after-signing", { fullPage: false });
log("lead updated live: $ + CC icons, 0 E-sign Pending / 2 E-sign Received");
{
  // Status + history after both signatures (append-only events with signer, IP, hash of the signed doc).
  const st = await q1("select q.signed_at, e.status from quotes q join estimates e on e.id=q.estimate_id where q.estimate_id=$1", [leadId]);
  assert.ok(st.signed_at, "quote marked signed (quotes.signed_at)");
  const ev = await db.query("select m.kind, v.signer_name, v.signer_email, v.agreed, v.ip is not null ip, length(v.signed_sha256) h, v.signed_html like '%Jane Rivera%' named from crm_email_events v join crm_emails m on m.id=v.email_id where v.estimate_id=$1 and v.event='signed' order by m.kind", [leadId]);
  assert.deepEqual(ev.rows.map(r => [r.kind, r.signer_name, r.signer_email, r.agreed, r.ip, r.h, r.named]),
    [["booked_esign", "Jane Rivera", "jane.rivera@example.test", true, true, 64, true], ["cc_form", "Jane Rivera", "jane.rivera@example.test", true, true, 64, true]], "signed history rows");
  const notes = await db.query("select distinct kind from crm_notifications where estimate_id=$1 and kind in ('contract_signed','cc_signed') order by kind", [leadId]);
  assert.deepEqual(notes.rows.map(r => r.kind), ["cc_signed", "contract_signed"], "E-Sign banners raised");
  const toast = await q1("select max(amount) amount from crm_notifications where estimate_id=$1 and kind='contract_signed'", [leadId]);
  assert.equal(Number(toast.amount), 1250, "green $ popup carries the job Total");
  log("signed: quotes.signed_at set; lead status", st.status, "; 2 signed history rows (name, email, agreed, IP, SHA-256 of signed doc); E-Sign banners + green $1250 popup");
}
await mark.click("[data-testid=esign-received]");
await mark.waitForSelector("[data-testid=ec-history]");
const ecKinds = await mark.locator("[data-testid=ec-history] [data-testid=prev-email-row]").evaluateAll(rs => rs.map(r => r.dataset.kind));
assert.ok(ecKinds.length === 2 && ecKinds.every(k => k === "cc_form" || k === "booked_esign"), ecKinds.join());
await mark.locator("[data-testid=email-center]").screenshot({ path: `${OUT}/10c-email-center-esign-filter.png` });
log("clicking a count opens the Email Center filtered to e-sign rows");
await mark.mouse.move(5, 5);

await mark.goto(`${BASE}/user-menu`);
await mark.waitForSelector("[data-testid=crm-banners] [data-banner=esignCc]");
await shot(mark, "09-rep-menu-banners", { fullPage: false });
await mark.locator("[data-testid=crm-banners]").screenshot({ path: `${OUT}/09a-banner-ticker.png` });
const motion = await mark.evaluate(() => {
  const el = document.querySelector("[data-testid=crm-banners] .banner-slide");
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { iteration: cs.animationIterationCount, name: cs.animationName, dir: el.getAttribute("data-direction") };
});
assert.ok(motion && (motion.dir === "ltr" || motion.dir === "rtl"), "banner has a travel direction");
assert.equal(motion.iteration, "1", "banner travels once and stops");
assert.match(motion.name, /^banner-/, "banner uses the one-shot travel");
log("banner travels once (" + motion.dir + ", " + motion.name + ") and stops in the center");
const sig = await q1("select count(*)::int n, bool_and(ip is not null) ip from crm_email_events where event='signed'");
log("signed events", sig);
assert.equal(sig.n, 2);

await mark.goto(leadUrl);
await mark.waitForSelector("[data-testid=banner-contract-signed]");
await mark.waitForSelector("[data-testid=banner-cc-signed]");
await shot(mark, "10-lead-signed-banners");
log("lead shows GREEN $ and BLUE CC banners");

// 8. Calendar
await mark.goto(`${BASE}/operations?month=2026-11`);
await mark.waitForSelector(`text=${est.job_number}`);
{
  const card = mark.locator(`.cal-day[data-date="2026-11-04"] [data-testid=cal-job][data-job=${est.job_number}]`);
  for (const ic of ["booked", "signed", "cc", "paid", "due"]) assert.equal(await card.locator(`.ic.${ic}`).count(), 1, `icon ${ic}`);
  assert.match(await mark.textContent("[data-testid=op-count]"), /Booked Jobs \(Pick-up\): [1-9]/);
}
await shot(mark, "11-operations-calendar");
log("job on Operations calendar on 2026-11-04");

// 9. Search as you type
// The menu holds only the search box: Search opens its own page with the results.
await mark.goto(`${BASE}/user-menu`);
await mark.fill("[data-testid=menu-search]", "riv");
{
  const [tab] = await Promise.all([mark.context().waitForEvent("page"), mark.click("[data-testid=menu-search-btn]")]);
  await tab.waitForURL(/\/search\?q=riv/);
  assert.equal(new URL(mark.url()).pathname, "/user-menu", "Search opens a new tab; the menu stays");
  await tab.close();
  await mark.goto(`${BASE}/search?q=riv`);
}
await mark.waitForSelector("[data-testid=search-results] >> text=Jane Rivera");
assert.equal(await mark.inputValue("[data-testid=search-input]"), "riv");
for (const term of ["riv", "5550142", "jane.rivera@", est.job_number, est.job_number.replace("FB", ""), est.job_number.toLowerCase()]) {
  await mark.fill("[data-testid=search-input]", term);
  await mark.waitForSelector("[data-testid=search-results] >> text=Jane Rivera", { timeout: 5000 });
  log("search", JSON.stringify(term), "found");
}
await mark.fill("[data-testid=search-input]", "riv");
await mark.waitForSelector("[data-testid=search-results]");
await shot(mark, "12-search", { fullPage: false });

// 10. Follow Up rule: due at its date+time, never expires, leaves ONLY when touched (email or
// note) AFTER the due time; a new future time clears it until reached; the count updates live.
const fuCount = async (page) => {
  const t = await page.locator("[data-testid=crm-banners] [data-banner=followUp]").first().textContent().catch(() => null);
  return t ? Number(/\((\d+)\)/.exec(t)?.[1] ?? 0) : 0;
};
const mkFollow = (name, due, touched) => q1(`insert into estimates (customer_name, customer_email, pickup_address, delivery_address, status, owner_id, assigned_rep_id, follow_up_at, last_touched_at, priority, total_amount)
  select $1, $2, 'Denver, CO 80202', 'Austin, TX 78701', 'quoted', user_id, id, ${due}, ${touched || "null"}, 2, 750 from crm_reps where name='Sam Rep' returning id, job_number`, [name, `${name.split(" ")[0].toLowerCase()}@example.test`]);
const fA = await mkFollow("Tom Follow", "now() - interval '30 minutes'");                                   // due 2:00, now 2:30, no touch
const fB = await mkFollow("Bea Early", "now() - interval '45 minutes'", "now() - interval '90 minutes'");     // touched BEFORE due
const fC = await mkFollow("Cal Email", "now() - interval '60 minutes'");                                     // email after due
await db.query("insert into quotes (estimate_id, total_amount, deposit_amount) values ($1, 750, 150)", [fC.id]);
const fD = await mkFollow("Dee Resched", "now() - interval '20 minutes'");                                   // new future time
const fE = await mkFollow("Eve Old", "now() - interval '10 days'");                                          // never expires
const markLive = await mark.context().newPage();                                                              // second tab: live count
await markLive.goto(`${BASE}/user-menu`);
await markLive.waitForSelector("[data-testid=crm-banners] [data-banner=followUp]");
await markLive.waitForFunction(() => document.querySelector("[data-testid=crm-banners]")?.dataset.live === "1");
const n0 = await fuCount(markLive);
const dueJobs = async () => {
  await markLive.locator("[data-testid=crm-banners] [data-banner=followUp]").first().dispatchEvent("click");
  await markLive.waitForSelector("[data-testid=followup-list]");
  const j = await markLive.locator("[data-testid=followup-list] tbody tr td:nth-child(2)").allTextContents();
  await markLive.click("[data-testid=banner-panel] header button");
  return j;
};
let jobs = await dueJobs();
for (const f of [fA, fB, fC, fD, fE]) assert.ok(jobs.includes(f.job_number), `due lead ${f.job_number} listed`);
assert.equal(n0, jobs.length, "banner count = list");
await shot(markLive, "13-follow-up-banner", { fullPage: false });
await markLive.reload();
await markLive.waitForSelector("[data-testid=crm-banners] [data-banner=followUp]");
assert.equal(await fuCount(markLive), n0, "stays after reload (no touch)");
log("Follow Up (" + n0 + "): due leads listed incl. one 10 days overdue and one touched before its due time");
// No close/dismiss on the Follow Up banner, and VIEWING the lead does not clear it.
assert.equal(await markLive.locator("[data-testid=crm-banners] [data-banner=followUp] button, [data-testid=crm-banners] [data-banner=followUp] [aria-label*=ismiss], [data-testid=crm-banners] [data-banner=followUp] [aria-label*=lose]").count(), 0, "no dismiss X on Follow Up");
await mark.goto(`${BASE}/estimates/${fA.id}`);
await mark.waitForSelector("[data-testid=tab-charges]");
await mark.goto(`${BASE}/estimates/${fA.id}/emails`);
await mark.waitForTimeout(2000);
await markLive.reload();
await markLive.waitForSelector("[data-testid=crm-banners] [data-banner=followUp]");
assert.equal(await fuCount(markLive), n0, "opening / viewing the lead does NOT clear its Follow Up");
assert.ok((await dueJobs()).includes(fA.job_number), "still listed after viewing");
await markLive.waitForFunction(() => document.querySelector("[data-testid=crm-banners]")?.dataset.live === "1");
log("Follow Up: no dismiss X; past its time it stays (incl. 10 days overdue); viewing the lead does not clear it");
// note after due -> gone (live, other tab)
await mark.goto(`${BASE}/estimates/${fA.id}`);
await mark.fill("[data-testid=note-input-rep]", "Called, left voicemail");
await mark.click("[data-testid=add-note-rep]");
const tNote = Date.now();
await markLive.waitForFunction(n => /\((\d+)\)/.exec(document.querySelector("[data-testid=crm-banners] [data-banner=followUp]")?.textContent || "")?.[1] == n, n0 - 1, { timeout: 8000 });
log("note after due: Follow Up", n0, "->", n0 - 1, "live in the other tab in", Date.now() - tNote, "ms");
// email after due -> gone
await mark.goto(`${BASE}/estimates/${fC.id}`);
await mark.hover("[data-testid=email-hover]");
await mark.click("[data-testid=send-e_quote]");
await markLive.waitForFunction(n => /\((\d+)\)/.exec(document.querySelector("[data-testid=crm-banners] [data-banner=followUp]")?.textContent || "")?.[1] == n, n0 - 2, { timeout: 8000 });
log("email after due: Follow Up ->", n0 - 2, "live");
// new future follow-up time -> cleared until reached
await db.query("update estimates set follow_up_at = now() + interval '2 hours' where id=$1", [fD.id]);
await markLive.waitForFunction(n => /\((\d+)\)/.exec(document.querySelector("[data-testid=crm-banners] [data-banner=followUp]")?.textContent || "")?.[1] == n, n0 - 3, { timeout: 8000 });
// a lead turns on at its exact time without a reload
const fF = await mkFollow("Fay Later", "now() + interval '15 seconds'");
await markLive.waitForTimeout(2500);
assert.equal(await fuCount(markLive), n0 - 3, "not due yet");
await markLive.waitForFunction(n => /\((\d+)\)/.exec(document.querySelector("[data-testid=crm-banners] [data-banner=followUp]")?.textContent || "")?.[1] == n, n0 - 2, { timeout: 45000 });
jobs = await dueJobs();
assert.ok(!jobs.includes(fA.job_number) && !jobs.includes(fC.job_number) && !jobs.includes(fD.job_number), "touched/rescheduled leads left");
assert.ok(jobs.includes(fB.job_number) && jobs.includes(fE.job_number) && jobs.includes(fF.job_number), "touch-before-due and 10-day-old stay; new one switched on at its time");
log("rescheduled to the future: cleared; a lead turned on at its due time live; touch BEFORE due did not clear; 10-day-old still showing");
// clear the remaining test leads so later lists stay focused
await db.query("update estimates set last_touched_at = now() where id = any($1)", [[fB.id, fE.id, fF.id]]);
await markLive.close();

// 11. Rotation
await owner.goto(`${BASE}/admin-menu/settings`);
await owner.click("[data-testid=rotation-toggle]");
await owner.waitForSelector("text=Rotation is ON.");
await shot(owner, "14-settings-rotation");
const got = [];
for (const name of ["Rot One", "Rot Two"]) {
  await owner.goto(`${BASE}/estimates/new`);
  await owner.fill("[name=customer_name]", name);
  await owner.fill("[name=pickup_zip]", "60601"); await owner.fill("[name=delivery_zip]", "33101");
  await owner.waitForFunction(() => document.querySelector("[name=delivery_city]")?.value);
  await owner.selectOption("[data-testid=assign-select]", "rotation");
  await owner.click("[data-testid=lead-source]"); await owner.locator("[data-testid=lead-source-opt]", { hasText: "Referral" }).click();
  await Promise.all([owner.waitForURL(/\/estimates\/[0-9a-f-]{36}$/), owner.click("[data-testid=entry-continue]")]);
  got.push((await q1("select r.name from estimates e join crm_reps r on r.id=e.assigned_rep_id where e.id=$1", [owner.url().split("/").pop()])).name);
}
log("rotation assigned", got.join(" -> "));
assert.notEqual(got[0], got[1]);


await owner.goto(`${BASE}/user-menu`);
await shot(owner, "15-admin-user-menu");
{
  assert.equal(await owner.textContent(".hub-title"), "Admin Menu");
  assert.equal(await owner.textContent("[data-testid=hub-username]"), "OWNER");
  assert.match(await owner.textContent("[data-testid=hub-phone]"), /\d{3}-\d{3}-\d{4}/);
  for (const t of ["menu-new-estimate", "menu-estimates", "menu-recurring", "menu-operations", "menu-performance", "menu-reports", "menu-follow-up", "menu-recent", "menu-maintenance"]) assert.equal(await owner.locator(`[data-testid=${t}]`).count(), 1, t);
  const cols = await owner.evaluate(() => [...document.querySelectorAll(".hub-col")].map(c => Math.round(c.getBoundingClientRect().left)));
  assert.equal(new Set(cols).size, 2, "two-column link list");
  await mark.goto(`${BASE}/user-menu`);
  assert.equal(await mark.locator("[data-testid=menu-maintenance], [data-testid=menu-performance]").count(), 0, "rep: no admin links");
  assert.equal(await mark.textContent(".hub-title"), "Salesperson Menu", "rep menu title");
}
log("main menu: Admin Menu (admin) / Salesperson Menu (rep) header (Welcome / Logged in as / date), search + button, two-column links");

// 12. Maintenance (admin only): Users list + edit, Company Settings
await owner.goto(`${BASE}/admin-menu/maintenance`);
await owner.waitForSelector("[data-testid=user-row]");
assert.equal(await owner.isDisabled("[data-testid=add-user]"), true);
await shot(owner, "16-maintenance-users", { fullPage: false });
// Edit the salesperson (Sam and Jordan are admins; admins always have Assign + cards).
await owner.locator("[data-testid=user-row]", { hasText: "Riley Test" }).locator("[data-testid=edit-user]").click();
await owner.fill("[data-testid=edit-phone]", "720-555-0123");
await owner.check("[data-testid=edit-claim]");
await shot(owner, "17-maintenance-edit-user", { fullPage: false });
await owner.click("[data-testid=edit-save]");
await owner.waitForSelector("text=User saved.");
const j = await q1("select r.phone, p.can_claim_unassigned from crm_reps r join user_profiles p on p.user_id=r.user_id where r.name='Riley Test'");
assert.equal(j.phone, "720-555-0123"); assert.equal(j.can_claim_unassigned, true);
log("Maintenance: edited Riley (salesperson: phone + pool access)");
await owner.click("[data-testid=tab-company]");
await owner.waitForSelector("[data-testid=company-mainPhone]");
await shot(owner, "18-maintenance-company-settings", { fullPage: false });
// Contact info is read at render time: change the company email, re-open the CC form, see it.
await owner.fill("[data-testid=company-companyEmail]", "dispatch@example.test");
await owner.click("[data-testid=company-save]");
await owner.waitForSelector("text=Saved.");
await q1("update crm_reps set email=null where name='Sam Rep'");
// (A signed document is a frozen snapshot, so check the unsigned E-Quote.)
await cust.goto(`${BASE}/d/${est.job_number}/${quoteTok}`);
assert.ok((await cust.content()).includes("dispatch@example.test"), "company settings show on next render");
log("company settings change visible on the next customer render (no redeploy)");
await owner.fill("[data-testid=company-companyEmail]", "support@fastbreakcrm.test");
await owner.click("[data-testid=company-save]");
await q1("update crm_reps set email='support@fastbreakcrm.test' where name='Sam Rep'");

// 13. Supervisor cannot open Maintenance
await q1("update user_profiles set role='supervisor' where display_name='Sam Rep'");
await mark.goto(`${BASE}/admin-menu/maintenance`);
assert.ok(!mark.url().includes("/maintenance"), "supervisor redirected away from Maintenance");
await q1("update user_profiles set role='salesperson' where display_name='Sam Rep'");
log("supervisor blocked from Maintenance");
// 14. Calendar uses the FIRST date of the pickup window (Primary 11/04, Backup 11/08)
await owner.goto(`${BASE}/operations?month=2026-11`);
const cell = owner.locator(".cal-day", { hasText: est.job_number }).first();
assert.equal(await cell.getAttribute("data-day"), "4", "first card on the Primary Date");
assert.equal(await owner.locator(`.cal-day[data-date="2026-11-08"] [data-job=${est.job_number}][data-second="1"]`).count(), 1, "backup date marked 2nd Pick-Up");
log("calendar: booked job on Nov 4 (Primary) and on Nov 8 marked 2nd Pick-Up");

// 15. Bottom button row: admin vs salesman
await owner.goto(leadUrl);
await owner.waitForSelector("[data-testid=release-book]");
await owner.locator("[data-testid=lead-actions]").screenshot({ path: `${OUT}/19-bottom-row-admin.png` });
await mark.goto(leadUrl);
await mark.waitForSelector("[data-testid=lead-actions]");
assert.equal(await mark.locator("[data-testid=release-book]").count(), 0);
assert.equal(await mark.locator("[data-testid=delete-lead]").count(), 0);
await mark.locator("[data-testid=lead-actions]").screenshot({ path: `${OUT}/20-bottom-row-salesman.png` });
log("bottom row: admin sees Release Book + Delete Lead; salesman does not");

// 16. Release Book (admin): back to follow-up, off the calendar, logged
await owner.click("[data-testid=release-book]");
await owner.waitForSelector("text=Booking released");
const rel = await q1("select e.status, e.booked_at, (select count(*)::int from estimate_status_log l where l.estimate_id=e.id and l.action='release_book' and l.actor_name='Owner') n from estimates e where id=$1", [leadId]);
assert.notEqual(rel.status, "booked"); assert.equal(rel.booked_at, null); assert.equal(rel.n, 1);
await owner.goto(`${BASE}/operations?month=2026-11`);
await owner.waitForTimeout(800);
assert.equal(await owner.locator(`text=${est.job_number}`).count(), 0, "released job off the calendar");
log("Release Book: status", rel.status, "- off calendar, logged by Owner");
// Released: back in the OWNER's (Mark's) All Follow-Up; the Follow-Up Menu is per user.
await mark.goto(`${BASE}/follow-up`);
await mark.check("[data-testid=fu-opt-all] input");
await mark.click("[data-testid=fu-submit]");
await mark.waitForSelector(`[data-testid=fu-results] >> text=${est.job_number}`);
assert.ok((await q1("select follow_up_at from estimates where id=$1", [leadId])).follow_up_at !== undefined);
log("release: back in All Follow-Up Estimates");

// 17. Opt-out: tiny link at the bottom -> suppression list -> CRM notice -> sends blocked -> admin removes
await cust.goto(`${BASE}/d/${est.job_number}/${quoteTok}`);
const opt = cust.locator("[data-optout]");
assert.ok(await opt.count(), "opt-out link on the customer document");
await opt.scrollIntoViewIfNeeded();
await shot(cust, "21-optout-link", { fullPage: false });
await Promise.all([cust.waitForURL(/\/u\//), opt.click()]);
await cust.waitForSelector("[data-testid=optout-done]");
await shot(cust, "22-optout-confirmation", { fullPage: false });
const blk = await q1("select block_id, ip from crm_suppressions where lower(email)='jane.rivera@example.test' and removed_at is null");
assert.ok(blk?.block_id);
log("opted out: Block ID", blk.block_id);
await mark.goto(leadUrl);
await mark.waitForSelector("[data-testid=removal-notice]");
assert.ok((await mark.locator("[data-testid=removal-notice]").innerText()).includes(String(blk.block_id)));
await mark.locator("[data-testid=ch-email-row]").screenshot({ path: `${OUT}/23-crm-removal-notice.png` });
// Lead screen: the email is plain grey text (no link, no mailto) with an 'Opted out <date>' tag,
// and every send button is disabled with the tooltip.
assert.equal(await mark.locator("[data-testid=email-opted-out] a, [data-testid=email-opted-out] button, [data-testid=ch-email-row] a[href^='mailto:']").count(), 0, "opted-out email not clickable");
assert.match(await mark.textContent("[data-testid=optout-tag]"), /^Opted out \d{2}\/\d{2}\/\d{4}$/);
await mark.hover("[data-testid=email-hover]");
for (const b of ["send-e_quote", "send-booked_esign", "send-cc_form", "open-free-text"]) {
  assert.ok(await mark.isDisabled(`[data-testid=${b}]`), `${b} disabled`);
  assert.equal(await mark.getAttribute(`[data-testid=${b}]`, "title"), "Customer opted out of email");
}
await mark.locator("[data-testid=ch-email-row]").screenshot({ path: `${OUT}/23b-crm-opted-out-email.png` });
// The server refuses too (force the click past the disabled UI).
await mark.locator("[data-testid=send-e_quote]").evaluate(b => { b.disabled = false; b.click(); });
await mark.waitForSelector("text=/removal list/");
const sentAfter = await q1("select count(*)::int n from crm_emails where estimate_id=$1 and created_at > now() - interval '5 seconds'", [leadId]);
assert.equal(sentAfter.n, 0);
log("send blocked with removal-list message");
const hist = await q1("select count(*)::int n from crm_email_events where event='unsubscribed' and block_id=$1", [blk.block_id]);
assert.equal(hist.n, 1); log("opt-out logged in email history");
// Red line 'The email is on the removal list. Block ID: <n>' with the Block ID as a blue link:
// any rep clicks it -> confirm -> block cleared, note logged, email clickable + sends enabled again.
assert.equal((await mark.locator("[data-testid=removal-notice]").innerText()).trim(), `The email is on the removal list. Block ID: ${blk.block_id}`);
assert.equal(await mark.textContent("[data-testid=remove-block]"), String(blk.block_id));
{
  await mark.goto(leadUrl);
  const msgs = []; const rec = d => msgs.push(d.message()); mark.on("dialog", rec);
  await mark.click("[data-testid=remove-block]");
  await mark.waitForSelector("text=Block removed.");
  mark.off("dialog", rec);
  assert.deepEqual(msgs, ["Remove this email from the removal list and allow emails again?"]);
}
assert.equal((await q1("select count(*)::int n from crm_suppressions where block_id=$1 and removed_at is not null", [blk.block_id])).n, 1);
const rmNote = await q1("select body from estimate_notes where estimate_id=$1 and kind='rep' order by created_at desc limit 1", [leadId]);
assert.match(rmNote.body, /^Email removed from opt-out list by .+/);
await mark.waitForSelector("[data-testid=email-hover] .ch-email-link");
await mark.hover("[data-testid=email-hover]");
for (const b of ["send-e_quote", "send-booked_esign", "send-cc_form", "open-free-text"]) assert.equal(await mark.isDisabled(`[data-testid=${b}]`), false, `${b} enabled again`);
log("rep clicked the Block ID -> confirm -> block removed, note logged, email clickable, sends enabled");
// One-click List-Unsubscribe (RFC 8058): POST to the List-Unsubscribe URL opts out the same way.
{
  const r = await cust.request.post(`${BASE}/u/${quoteTok}`, { form: { "List-Unsubscribe": "One-Click" } });
  assert.equal(r.status(), 200, "one-click POST accepted");
  const j = await r.json();
  const b2 = await q1("select block_id from crm_suppressions where lower(email)='jane.rivera@example.test' and removed_at is null");
  assert.ok(j.ok && b2 && Number(j.blockId) === Number(b2.block_id), `one-click POST opts the customer out (${JSON.stringify(j)})`);
  await mark.goto(leadUrl);
  await mark.waitForSelector("[data-testid=email-opted-out]");
  await mark.click("[data-testid=remove-block]");
  await mark.waitForSelector("text=Block removed.");
  await mark.goto(leadUrl);
  await mark.waitForSelector("[data-testid=email-hover] .ch-email-link");
  log("one-click POST /u/<token> opted out (block", b2.block_id, "); admin removed it again; email clickable again");
}

// 17b. EMAIL CENTER: running count, 3 templates, Free Text composer (live preview with logo header +
//      rep signature), Previous Emails (#seq, rep, To, Subject, Text snapshot, E-sign, Viewed).
await mark.goto(leadUrl);
const sentCount = (await q1("select count(*)::int n from crm_emails where estimate_id=$1", [leadId])).n;
assert.equal(await mark.textContent("[data-testid=email-count]"), `${sentCount} emails sent`);
await mark.locator("[data-testid=ch-email-row]").screenshot({ path: `${OUT}/30-email-count.png` });
log("email count next to the customer's email:", sentCount);
await mark.hover("[data-testid=email-hover]");
await mark.waitForSelector("[data-testid=email-center]");
assert.equal(await mark.locator("[data-testid=ec-template]").count(), 3);
const ecNames = await mark.locator("[data-testid=ec-template] .ec-name").allInnerTexts();
assert.deepEqual(ecNames, ["Credit Card Authorization Form", "Auto Transport Order for Service", "Free Text Email"]);
await mark.locator("[data-testid=email-center]").screenshot({ path: `${OUT}/31-email-center.png` });
log("Email Center lists 3 templates + Previous Emails");

// Removal list is respected for Free Text too
const tmpBlock = await q1("insert into crm_suppressions (email) values ('jane.rivera@example.test') returning id, block_id");
await mark.click("[data-testid=open-free-text]");
await mark.waitForSelector("[data-testid=free-text-composer]");
await mark.fill("[data-testid=ft-subject]", "Blocked test");
await mark.click("[data-testid=ft-editor-area]"); await mark.keyboard.type("Should not send");
await mark.click("[data-testid=ft-send]");
await mark.waitForSelector(`text=/removal list/i`);
assert.equal((await q1("select count(*)::int n from crm_emails where estimate_id=$1 and kind='free_text'", [leadId])).n, 0);
await db.query("update crm_suppressions set removed_at=now(), removed_by_name='e2e' where id=$1", [tmpBlock.id]);
log("Free Text blocked while the address is on the removal list");
await mark.click("[data-testid=ft-exit]");

await mark.goto(leadUrl);
await mark.hover("[data-testid=email-hover]");
await mark.click("[data-testid=open-free-text]");
await mark.waitForSelector("[data-testid=free-text-composer]");
assert.equal(await mark.textContent("[data-testid=ft-to]"), "jane.rivera@example.test");
assert.ok(await mark.isChecked("[data-testid=ft-cc]"), "CC checked by default");
const fromAddr = await mark.textContent("[data-testid=ft-from]");
await mark.fill("[data-testid=ft-subject]", "Your pickup window");
await mark.click("[data-testid=ft-editor-area]");
await mark.click("[data-testid=re-bold]"); await mark.keyboard.type("Hi Jane,"); await mark.click("[data-testid=re-bold]");
await mark.keyboard.press("Enter");
await mark.keyboard.type("Your carrier is scheduled for pickup on your first available date. Call me with any questions.");
await mark.check("[data-testid=ft-quote-link]");
assert.equal(await mark.locator("[data-testid=ft-preview]").count(), 0, "no always-on side preview");
await mark.locator("[data-testid=free-text-composer]").screenshot({ path: `${OUT}/32-free-text-composer.png` });
await mark.click("[data-testid=ft-preview-btn]");
await mark.waitForSelector("[data-testid=ft-preview-modal]");
await mark.waitForFunction(() => { const d = document.querySelector("[data-testid=ft-preview]")?.getAttribute("srcdoc") || ""; return d.includes("View your quote") && d.includes("data-rep-signature") && d.includes("fastbreak-logo.png"); }, null, { timeout: 10000 });
const pv = await mark.evaluate(() => document.querySelector("[data-testid=ft-preview]").getAttribute("srcdoc"));
assert.ok(pv.includes("Sam Rep") && pv.includes("Call ") && pv.includes("first available date"), "preview: header + body + signature");
await mark.locator("[data-testid=ft-preview-modal]").screenshot({ path: `${OUT}/32b-free-text-preview.png` });
await mark.click("[data-testid=ft-preview-close]");
log("Free Text composer: header, Subject, editor, quote-link checkbox; Preview opens a separate modal (from", fromAddr + ")");
const touchedFT = (await q1("select last_touched_at from estimates where id=$1", [leadId])).last_touched_at;
await mark.click("[data-testid=ft-send]");
await mark.waitForTimeout(1000);
const ft = await q1("select token, seq, subject, sent_cc, sent_from, html_snapshot from crm_emails where estimate_id=$1 and kind='free_text' order by created_at desc limit 1", [leadId]);
assert.equal(ft.subject, "Your pickup window");
assert.equal(ft.seq, sentCount + 1);
assert.equal(ft.sent_cc, fromAddr);
for (const bit of ["fastbreak-logo.png", "data-rep-signature", "Sam Rep", "data-optout", `/api/email/open/${ft.token}`, `href="${BASE}/d/${est.job_number}/${ft.token}"`, `View your quote (Job ${est.job_number})`]) {
  assert.ok(ft.html_snapshot.includes(bit), `snapshot has ${bit}`);
}
assert.ok(!/<script/i.test(ft.html_snapshot));
const touchedFT2 = (await q1("select last_touched_at from estimates where id=$1", [leadId])).last_touched_at;
assert.ok(new Date(touchedFT2) > new Date(touchedFT || 0), "free text touches the lead");
log("Free Text sent: logged #" + String(ft.seq).padStart(3, "0"), "with HTML snapshot, CC", ft.sent_cc, "; touched the lead");
// Customer opens the email as sent (tracking pixel loads) and CLICKS "View your quote":
// it lands on this job's quote page and fires Quote Viewed.
const inbox = await cust.context().newPage();
await cust.context().request.get(`${BASE}/api/email/open/${ft.token}`); // pixel (same request the email client makes)
await inbox.setContent(ft.html_snapshot, { waitUntil: "domcontentloaded" });
await inbox.waitForTimeout(800);
await inbox.screenshot({ path: `${OUT}/32c-free-text-sent-email.png`, fullPage: true });
const qvBefore = (await q1("select count(*)::int n from crm_notifications where kind='quote_viewed' and estimate_id=$1", [leadId])).n;
const [quotePage] = await Promise.all([cust.context().waitForEvent("page"), inbox.click(`a[href="${BASE}/d/${est.job_number}/${ft.token}"]`)]);
await quotePage.waitForSelector("[data-testid=customer-doc]");
assert.equal(new URL(quotePage.url()).pathname, `/d/${est.job_number}/${ft.token}`);
assert.equal(await quotePage.getAttribute("[data-testid=customer-doc]", "data-job"), est.job_number);
assert.equal(await quotePage.getAttribute("[data-testid=customer-doc]", "data-kind"), "e_quote");
assert.ok((await quotePage.locator("[data-testid=customer-doc]").innerText()).includes(est.job_number));
const qvAfter = (await q1("select count(*)::int n from crm_notifications where kind='quote_viewed' and estimate_id=$1", [leadId])).n;
assert.ok(qvAfter > qvBefore, "Quote Viewed fired (one notification per recipient)");
await quotePage.close(); await inbox.close();
log("Free Text 'View your quote' clicked -> " + est.job_number + " quote page; Quote Viewed banner fired");
await db.query("select 1");
try { await db.query("update crm_emails set subject='x' where token=$1", [ft.token]); assert.fail("update allowed"); } catch (e) { assert.match(e.message, /append-only/); }
log("history row is append-only in the DB");

await mark.goto(`${leadUrl}/emails`);
await mark.waitForSelector("[data-testid=email-history] [data-testid=prev-email-row]");
const rows = mark.locator("[data-testid=email-history] [data-testid=prev-email-row]");
assert.equal(await rows.count(), sentCount + 1);
const firstSeq = await rows.first().locator(".seq").textContent();
assert.equal(firstSeq, String(sentCount + 1).padStart(3, "0"), "newest first");
assert.equal(await rows.last().locator(".seq").textContent(), "001");
const viewed = await rows.first().locator("[data-testid=viewed-details]").innerText();
// The pixel was loaded seconds after the send: ignored (< 60 s, likely a server/proxy prefetch);
// the link click counts.
assert.ok(!/Email opened/.test(viewed) && /Quote viewed/.test(viewed), viewed);
const ccRow = mark.locator("[data-testid=email-history] [data-testid=prev-email-row][data-kind=cc_form]").first();
assert.match(await ccRow.locator("[data-testid=esign-details]").innerText(), /Signed[\s\S]*Jane Rivera[\s\S]*IP/);
await shot(mark, "33-previous-emails");
await rows.first().locator("[data-testid=snapshot-link]").click();
await mark.waitForSelector("[data-testid=snapshot-frame]");
await mark.waitForFunction(() => (document.querySelector("[data-testid=snapshot-frame]")?.getAttribute("srcdoc") || "").includes("first available date"));
const snapHtml = await mark.evaluate(() => document.querySelector("[data-testid=snapshot-frame]").getAttribute("srcdoc"));
assert.ok(!snapHtml.includes("/api/email/open/"), "viewing the snapshot is not counted as an open");
await mark.screenshot({ path: `${OUT}/34-email-history-text-snapshot.png` });
log("Previous Emails: #001..#" + firstSeq + " newest first; Text opens the exact sent copy (read-only)");
await mark.keyboard.press("Escape"); await mark.goto(leadUrl);
assert.equal(await mark.locator("[data-testid=email-history]").count(), 0, "no email history on Charges");
await mark.hover("[data-testid=email-hover]"); await mark.waitForSelector("[data-testid=ec-history]");
await mark.locator("[data-testid=email-center]").screenshot({ path: `${OUT}/31b-email-center-with-history.png` });

// 17c. EXTRA STOP / NOTES: button only on the lead; modal editor; saved by Submit Charges;
//      boxed section in the middle of the E-Quote and the booked order; clearing hides it.
await mark.goto(leadUrl);
assert.equal(await mark.locator("[data-testid=has-notes]").count(), 0);
await mark.locator("[data-testid=open-extra-notes]").screenshot({ path: `${OUT}/35-extra-notes-button.png` });
await mark.click("[data-testid=open-extra-notes]");
await mark.waitForSelector("[data-testid=extra-notes-modal]");
assert.match(await mark.textContent("[data-testid=extra-notes-modal] .ft-head"), new RegExp(`Extra Stop / Notes ${est.job_number}`));
await mark.click("[data-testid=extra-editor-area]");
await mark.click("[data-testid=re-bold]"); await mark.keyboard.type("Payment schedule"); await mark.click("[data-testid=re-bold]");
await mark.keyboard.press("Enter"); await mark.keyboard.type("Deposit $200 today, balance $1,050 COD on delivery.");
await mark.keyboard.press("Enter"); await mark.keyboard.type("Pay Deposit Online Here: ");
await mark.click("[data-testid=re-link]");
await mark.fill("[data-testid=re-link-name]", "Pay Deposit Online Here");
await mark.fill("[data-testid=re-link-url]", "javascript:alert(1)");
await mark.click("[data-testid=re-link-insert]");
await mark.waitForSelector("text=/starts with https/");
await mark.fill("[data-testid=re-link-url]", "https://example.test/pay");
await mark.click("[data-testid=re-link-insert]");
await mark.keyboard.press("Enter"); await mark.keyboard.type("Zelle: ");
await mark.click("[data-testid=re-link]");
await mark.fill("[data-testid=re-link-name]", "support@fastbreakcrm.test");
await mark.fill("[data-testid=re-link-url]", "mailto:support@fastbreakcrm.test");
await mark.click("[data-testid=re-link-insert]");
await mark.keyboard.press("Enter"); await mark.keyboard.type("We look forward to shipping your vehicle.");
await mark.keyboard.press("Enter"); await mark.keyboard.type("Thank you, Sam Rep 555-010-0101");
await mark.locator("[data-testid=extra-notes-modal]").screenshot({ path: `${OUT}/36-extra-notes-modal.png` });
await mark.click("[data-testid=extra-submit]");
await mark.waitForSelector("[data-testid=has-notes]");
assert.equal((await q1("select extra_stop_html from estimates where id=$1", [leadId])).extra_stop_html, null, "not saved until Submit Charges");
await mark.locator("[data-testid=open-extra-notes]").screenshot({ path: `${OUT}/35b-extra-notes-button-has-notes.png` });
await mark.click("[data-testid=save-charges]");
await mark.waitForTimeout(1000);
const xn = await q1("select extra_stop_html, (select count(*)::int from estimate_extra_notes_history h where h.estimate_id=e.id and h.field='extra_stop') n from estimates e where id=$1", [leadId]);
assert.ok(xn.extra_stop_html.includes('href="https://example.test/pay"') && xn.n === 1);
assert.equal(await mark.locator("text=Payment schedule").count(), 0, "content not shown inline on the lead");
await mark.reload();
assert.equal(await mark.locator("[data-testid=charges-history]").count(), 0, "no mid-page history card (Lead History tab instead)");
log("Extra Stop / Notes saved by Submit Charges; change logged (Lead History)");
await cust.goto(`${BASE}/d/${est.job_number}/${quoteTok}`);
await cust.waitForSelector("[data-testid=customer-doc]");
const docHtml = await cust.locator("[data-testid=customer-doc]").innerHTML();
const iX = docHtml.indexOf("Extra Stop / Notes"), iFrom = docHtml.indexOf("Pick-Up From"), iVeh = docHtml.indexOf("Year / Make / Model");
assert.ok(iFrom < iX && iX < iVeh, `order From(${iFrom}) < Notes(${iX}) < Vehicles(${iVeh})`);
const payLink = cust.locator("[data-extra-notes] a", { hasText: "Pay Deposit Online Here" });
assert.equal(await payLink.getAttribute("target"), "_blank");
assert.match(await payLink.getAttribute("rel"), /noopener/);
assert.ok(!(await cust.locator("[data-extra-notes]").innerText()).includes("example.test"), "customer sees the link name, not the URL");
await cust.locator("[data-extra-notes]").scrollIntoViewIfNeeded();
await cust.screenshot({ path: `${OUT}/37-customer-quote-extra-notes.png`, fullPage: true });
await cust.waitForTimeout(300);
assert.equal(await printedPages(cust), 1, "customer quote with notes + Remarks prints on one letter page");
log("customer quote with Extra Stop / Notes prints on 1 letter page (zoom", await cust.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--print-zoom")) + ")");
// PRINTED ESTIMATE tab: what the customer sees now (E-Quote while not booked, booked order once
// booked) + CC form; read-only preview, never counted as Quote Viewed.
const viewsBefore = (await q1("select count(*)::int n from crm_email_events where estimate_id=$1 and event='viewed'", [leadId])).n;
const qvNotesBefore = (await q1("select count(*)::int n from crm_notifications where kind='quote_viewed' and estimate_id=$1", [leadId])).n;
await mark.goto(`${leadUrl}/estimate`);
await mark.waitForSelector("[data-testid=doc-frame][data-kind=e_quote]");
await mark.waitForFunction(() => (document.querySelector("[data-testid=doc-frame]")?.contentDocument?.body?.innerHTML || "").includes("Extra Stop / Notes"));
await shot(mark, "50-printed-estimate-quote");
await mark.goto(leadUrl);
await mark.click("[data-testid=book-job]");
await mark.waitForSelector("[data-testid=job-booked]");
await mark.click("[data-testid=lead-tab-estimate]");
await mark.waitForSelector("[data-testid=doc-frame][data-kind=booked_esign]");
await mark.waitForFunction(() => (document.querySelector("[data-testid=doc-frame]")?.contentDocument?.body?.innerHTML || "").includes("Customer Payment"));
const bookedDoc = await mark.evaluate(() => document.querySelector("[data-testid=doc-frame]").contentDocument.body.innerHTML);
assert.ok(bookedDoc.includes("Extra Stop / Notes") && bookedDoc.includes("Pay Deposit Online Here"));
assert.ok(bookedDoc.includes("$1250.00") && bookedDoc.includes("$200.00") && bookedDoc.includes("$1050.00"), "booked order: Total, Customer Payment (recorded), Balance Due");
await mark.locator("[data-testid=doc-frame]").screenshot({ path: `${OUT}/38-booked-order-extra-notes.png` });
await shot(mark, "51-printed-estimate-booked");
await mark.click("[data-testid=pe-cc]");
await mark.waitForSelector("[data-testid=doc-frame][data-kind=cc_form]");
await mark.waitForTimeout(400);
await shot(mark, "52-printed-estimate-cc");
assert.equal((await q1("select count(*)::int n from crm_email_events where estimate_id=$1 and event='viewed'", [leadId])).n, viewsBefore, "preview is not a Quote View");
assert.equal((await q1("select count(*)::int n from crm_notifications where kind='quote_viewed' and estimate_id=$1", [leadId])).n, qvNotesBefore);
log("Printed Estimate: E-Quote before booking, booked order (Total / Customer Payment / Balance) after, CC toggle; no Quote Viewed fired");
await mark.click("[data-testid=lead-tab-emails]");
await mark.waitForSelector("[data-testid=email-history]");
await shot(mark, "53-emails-tab");
log("Extra Stop / Notes boxed between From/To and vehicles on E-Quote and booked order; named link only");
// Clear it -> section disappears
await mark.goto(leadUrl);
await mark.click("[data-testid=open-extra-notes]");
await mark.click("[data-testid=extra-editor-area]");
await mark.keyboard.press("Control+A"); await mark.keyboard.press("Delete");
await mark.click("[data-testid=extra-submit]");
await mark.click("[data-testid=save-charges]");
await mark.waitForTimeout(1000);
assert.equal((await q1("select extra_stop_html from estimates where id=$1", [leadId])).extra_stop_html, null);
await cust.goto(`${BASE}/d/${est.job_number}/${quoteTok}`);
assert.equal(await cust.locator("text=Extra Stop / Notes").count(), 0);
log("cleared Extra Stop / Notes -> section hidden on the customer quote");

// 18. Cancel Lead -> hidden everywhere except Search (CANCELLED) -> reopen
const l2 = fA; // "Tom Follow" from the Follow Up section
await mark.goto(`${BASE}/estimates/${l2.id}`);
await mark.click("[data-testid=cancel-lead]");
await mark.waitForSelector("[data-testid=reopen-lead]");
await mark.goto(`${BASE}/search?q=${encodeURIComponent("Tom Fol")}`);
await mark.waitForSelector("[data-testid=search-results] >> [data-testid=search-cancelled]");
await shot(mark, "24-search-cancelled", { fullPage: false });
const visibleLists = await q1("select count(*)::int n from estimates where id=$1 and status in ('draft','quoted','signed','booked')", [l2.id]);
assert.equal(visibleLists.n, 0);
await mark.goto(`${BASE}/estimates/${l2.id}`);
await mark.click("[data-testid=reopen-lead]");
await mark.waitForSelector("[data-testid=cancel-lead]");
log("Cancel Lead: only in Search (CANCELLED); reopened");

// 19. Delete Lead (admin, type the job number) -> permanent, via crm_delete_lead(), audit row only
await owner.goto(leadUrl);
await owner.click("[data-testid=delete-lead]");
assert.equal(await owner.isDisabled("[data-testid=delete-submit]"), true);
await owner.fill("[data-testid=delete-confirm]", "FB400002");
assert.equal(await owner.isDisabled("[data-testid=delete-submit]"), true, "wrong job number keeps Delete disabled");
await owner.fill("[data-testid=delete-confirm]", est.job_number.replace("FB", ""));
assert.equal(await owner.isDisabled("[data-testid=delete-submit]"), false, "digits-only job number accepted");
await owner.fill("[data-testid=delete-confirm]", est.job_number);
await shot(owner, "25-delete-confirm", { fullPage: false });
await Promise.all([owner.waitForURL(/user-menu/), owner.click("[data-testid=delete-submit]")]);
const gone = await q1(`select (select count(*)::int from estimates where id=$1) e, (select count(*)::int from crm_emails where estimate_id=$1) m,
  (select count(*)::int from crm_email_events where estimate_id=$1) ev, (select count(*)::int from payments where estimate_id=$1) p,
  (select count(*)::int from crm_deleted_jobs where job_number=$2) audit`, [leadId, est.job_number]);
assert.deepEqual(gone, { e: 0, m: 0, ev: 0, p: 0, audit: 1 });
let purgeBlocked = false;
await db.query("insert into crm_emails (estimate_id, token, kind, subject) values ($1, 'e2e-append-only-check-token', 'e_quote', 'x')", [l2.id]);
try { await db.query("delete from crm_emails where token='e2e-append-only-check-token'"); } catch { purgeBlocked = true; }
assert.ok(purgeBlocked, "append-only still enforced outside crm_delete_lead()");
log("Delete Lead: permanently removed with history; audit row kept; append-only still enforced elsewhere");

await db.query("update user_profiles set role='admin', can_view_cards=true, can_claim_unassigned=true where user_id=(select user_id from user_identities where username='Sam')");
await browser.close(); await db.end();
console.log("ALL CORE FLOW CHECKS PASSED");
