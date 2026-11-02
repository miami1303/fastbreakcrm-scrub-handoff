import test from "node:test";
import assert from "node:assert/strict";
import {
  CRM_PHONE_DISPLAY,
  INTAKE_NOTICE_TO,
  buildIntakeNotice,
  escapeHtml,
  isAllowedIntakeOrigin,
  noticeErrorFromSend,
  parseWebsiteLead,
} from "../lib/website-intake.ts";
import { clearMemoryRateLimits, consumeMemoryRate, INTAKE_RATE_LIMIT } from "../lib/intake-rate-limit.ts";
import { NHTSA_MAKE_TYPE_SLUGS, vehicleYearOptions } from "../lib/vehicle-catalog/constants.ts";
import { catalogHas, customItemsToStore, mergeCatalogNames, readNhtsaMakeNames, readNhtsaModelNames, sanitizeCustomItem, titleCaseCatalogName } from "../lib/vehicle-catalog/names.ts";

const good = {
  name: "Pat Customer",
  email: "pat@example.com",
  phone: "(720) 555-0100",
  phone2: "303-555-0199",
  from_zip: "33313",
  to_zip: "80202-1234",
  transport_date: "11/02/2026",
  year1: "2015",
  make1: "Honda",
  model1: "Civic",
  type1: "Sedan",
  runs1: "yes",
  closed1: "yes",
  make2: "Ford",
  model2: "F-150",
  type2: "boats",
};

test("website lead: required fields and a full customer record", () => {
  const parsed = parseWebsiteLead(good);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.spam) return;
  assert.equal(parsed.lead.name, "Pat Customer");
  assert.equal(parsed.lead.email, "pat@example.com");
  assert.equal(parsed.lead.fromZip, "33313");
  assert.equal(parsed.lead.toZip, "80202");
  assert.equal(parsed.lead.transportDate, "2026-11-02");
  assert.equal(parsed.lead.vehicles[0].runs, true);
  assert.equal(parsed.lead.vehicles[0].closed, true);
  assert.equal(parsed.lead.vehicles[1].type, "Boat");
  assert.equal(parsed.lead.vehicles[1].runs, true, "a missing runs box defaults to runs");
  assert.equal(parsed.lead.vehicles[1].closed, false);
});

test("website lead: old field names are accepted and runs can be no", () => {
  const parsed = parseWebsiteLead({
    SNAME: "Sam Driver", EMAIL: "sam@example.com", STELH: "7205550101",
    SZIP: "80126", RZIP: "33313", MOVEDATE: "2026-12-01",
    YEAR1: "1995", MAKE1: "Ford", MODEL1: "Mustang", TYPE1: "Coupe", RUN1: "no", COVER1: "1",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.spam) return;
  assert.equal(parsed.lead.phone1, "7205550101");
  assert.equal(parsed.lead.vehicles[0].runs, false);
  assert.equal(parsed.lead.vehicles[0].closed, true);
});

test("website lead: missing name is rejected, honeypot is ignored, three vehicles are rejected", () => {
  assert.equal(parseWebsiteLead({ email: "a@b.co" }).ok, false);
  const spam = parseWebsiteLead({ ...good, company_website: "http://spam.test" });
  assert.equal(spam.ok && spam.spam, true);
  const tooMany = parseWebsiteLead({
    ...good,
    vehicles: [
      { make: "A", model: "1" },
      { make: "B", model: "2" },
      { make: "C", model: "3" },
    ],
  });
  assert.equal(tooMany.ok, false);
});

test("website lead: notice text has every customer field and the office phone", () => {
  const parsed = parseWebsiteLead(good);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.spam) return;
  const notice = buildIntakeNotice(parsed.lead, "FB400001");
  assert.equal(INTAKE_NOTICE_TO, "support@fastbreakcrm.test");
  assert.equal(CRM_PHONE_DISPLAY, "555-010-0100");
  for (const bit of ["Pat Customer", "pat@example.com", "(720) 555-0100", "303-555-0199", "33313", "80202", "2026-11-02", "Honda", "Civic", "Sedan", "Ford", "F-150", "Boat", "FB400001", "555-010-0100", "Closed trailer: Yes", "Closed trailer: No", "Runs: Yes"]) {
    assert.ok(notice.text.includes(bit), bit);
  }
  assert.equal(noticeErrorFromSend(null)?.includes("not set up"), true);
  assert.equal(noticeErrorFromSend({ ok: false })?.includes("lead is saved"), true);
  assert.equal(noticeErrorFromSend({ ok: true }), null);
  assert.equal(escapeHtml(`a <b> & "c"`), "a &lt;b&gt; &amp; &quot;c&quot;");
});

test("website lead: only the Fast Break site and the CRM may post", () => {
  const crm = ["https://crm.example.test"];
  assert.equal(isAllowedIntakeOrigin("https://fastbreakcrm.test", crm), true);
  assert.equal(isAllowedIntakeOrigin("https://fastbreakcrm.test", crm), true);
  assert.equal(isAllowedIntakeOrigin("https://crm.example.test", crm), true);
  assert.equal(isAllowedIntakeOrigin("https://evil.example", crm), false);
  assert.equal(isAllowedIntakeOrigin(null, crm), false);
});

test("website lead: per-source rate limit stops the 13th try in an hour", () => {
  clearMemoryRateLimits();
  const now = Date.now();
  for (let i = 0; i < INTAKE_RATE_LIMIT; i++) assert.equal(consumeMemoryRate("src", now).allowed, true);
  assert.equal(consumeMemoryRate("src", now).allowed, false);
  assert.equal(consumeMemoryRate("other", now).allowed, true);
});

test("vehicle catalog: years run from next year back to 1950, names merge, customs are remembered", () => {
  const years = vehicleYearOptions(new Date("2026-10-26T00:00:00Z"));
  assert.equal(years[0], 2027);
  assert.equal(years.at(-1), 1950);
  assert.equal(NHTSA_MAKE_TYPE_SLUGS.includes("trailer"), false);
  assert.equal(titleCaseCatalogName("BMW"), "BMW");
  assert.equal(titleCaseCatalogName("MERCEDES-BENZ"), "Mercedes-Benz");
  assert.equal(titleCaseCatalogName("FORD"), "Ford");
  const makes = mergeCatalogNames(readNhtsaMakeNames({ Results: [{ MakeName: "FORD" }, { MakeName: "ford" }, { MakeName: "BMW" }] }));
  assert.deepEqual(makes, ["BMW", "Ford"]);
  const models = mergeCatalogNames(readNhtsaModelNames({ Results: [{ Model_Name: "Camaro" }, { Model_Name: "Camaro" }] }));
  assert.deepEqual(models, ["Camaro"]);
  assert.equal(catalogHas(["Ford"], "ford"), true);
  const items = customItemsToStore([{
    year: "2015", make: "Zimmer", model: "Golden Spirit", type: "Coupe",
    makeOptions: ["Ford"], modelOptions: [], typeOptions: ["Sedan"],
  }]);
  assert.deepEqual(items.map(item => item.kind), ["make", "model", "type"]);
  assert.equal(sanitizeCustomItem({ kind: "model", value: "Golden Spirit", make: "Zimmer", year: 2015 })?.value, "Golden Spirit");
  assert.equal(sanitizeCustomItem({ kind: "nope", value: "X" }), null);
});

test("notice matches New Web Lead alert spec", () => {
  const r = parseWebsiteLead({ name: "Pat Customer", email: "pat@example.com", phone: "7205550100", from_zip: "80202", to_zip: "33101" });
  const n = buildIntakeNotice(r.lead, "400777", "555-010-0100", "https://crm.fastbreakcrm.test/estimates/abc");
  assert.equal(n.subject, "New Web Lead - Pat Customer");
  assert.match(n.text, /Job number: 400777/);
  assert.match(n.text, /Open lead: https:\/\/crm\.fastbreakcrm\.test\/estimates\/abc/);
  assert.match(n.text, /pat@example\.com/);
});

test("your mail host-style field names and vehicle textarea", () => {
  const r = parseWebsiteLead({ full_name: "Ann Lee", email_address: "ann@x.com", phone_number: "303-555-0101", pickup_zip_code: "80202", delivery_zip_code: "33101", vehicle: "2019 Honda Civic\n2021 Ford F-150" });
  assert.equal(r.ok, true);
  assert.equal(r.lead.name, "Ann Lee");
  assert.equal(r.lead.vehicles.length, 2);
  assert.equal(r.lead.vehicles[1].make, "Ford");
  assert.equal(r.lead.vehicles[1].model, "F-150");
});
