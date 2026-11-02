import test from "node:test";
import assert from "node:assert/strict";
import { welcomeEmail, normalizeTeamPhone, crmUrl, isTeamRole } from "../lib/team-invite.ts";

test("welcome email has CRM URL, network creds, order, setup link", () => {
  const m = welcomeEmail({ displayName: "Jordan", email: "j@x.com", url: "https://crm.example", networkId: "NETID", networkPassword: "NETPW", setupLink: "https://sb/link" });
  for (const s of ["https://crm.example", "Network ID: NETID", "Network Password: NETPW", "https://sb/link", "Network Login comes first", "User Login"]) assert.ok(m.text.includes(s), s);
  assert.ok(m.html.includes('<a href="https://sb/link">'));
});
test("manual add email includes temp password, no link", () => {
  const m = welcomeEmail({ displayName: "A<b>", email: "a@x.com", url: "u", tempPassword: "Temp1234" });
  assert.ok(m.text.includes("Temp1234")); assert.ok(!m.html.includes("<b>"));
});
test("phone + url + role", () => {
  assert.equal(normalizeTeamPhone("(555) 010-0100"), "555-010-0100");
  assert.equal(normalizeTeamPhone("1 555-010-0103"), "555-010-0103");
  assert.equal(normalizeTeamPhone(""), ""); assert.equal(normalizeTeamPhone("123"), null);
  assert.equal(crmUrl({}), "https://crm.fastbreakcrm.test");
  assert.equal(crmUrl({ NEXT_PUBLIC_SITE_URL: "https://a.b/" }), "https://a.b");
  assert.ok(isTeamRole("supervisor")); assert.ok(!isTeamRole("owner"));
});

test("welcome email: invite mentions choosing a username; manual add shows the username", () => {
  const inv = welcomeEmail({ displayName: "Ops", email: "k@x.com", url: "https://crm", setupLink: "https://sb/l" });
  assert.match(inv.text, /pick your username/);
  const add = welcomeEmail({ displayName: "Bo", email: "b@x.com", url: "https://crm", tempPassword: "Temp1234", username: "Bo" });
  assert.match(add.text, /username "Bo" \(or your email b@x.com\)/);
});

test("welcome email has logo + team welcome", () => {
  const m = welcomeEmail({ displayName: "K", email: "k@x.com", url: "https://crm", setupLink: "https://l", networkId: "N", networkPassword: "P" });
  assert.match(m.html, /<img src="https:\/\/crm\/brand\/fastbreak-logo.png"/);
  assert.match(m.text, /Welcome to the Fast Break Team/);
  assert.match(m.text, /Network ID: N/);
});
