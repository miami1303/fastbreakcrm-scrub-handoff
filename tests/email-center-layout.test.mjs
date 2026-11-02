import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app/estimates/[id]/email-center.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("Email Center order: customer letters, Payment Link, then CC form, contract, Free Text last", () => {
  const at = s => { const i = src.indexOf(s); assert.ok(i > 0, s); return i; };
  const letters = at("CUSTOMER_MESSAGE_KINDS.map");
  const pay = at(">Payment Link<");
  const cc = at(">Credit Card Authorization Form<");
  const ato = at(">Auto Transport Order for Service<");
  const free = at(">Free Text Email<");
  assert.ok(letters < pay && pay < cc && cc < ato && ato < free);
});

test("Email Center has no draft / placeholder notes", () => {
  assert.doesNotMatch(src, /ec-note|not approved yet|\(DRAFT\)|add to email center/i);
});

test("Email Center popup: narrower, contrast border, not pushed off the left edge", () => {
  const wide = css.match(/\.email-center\.ec-wide \{[^}]*\}/)[0];
  assert.doesNotMatch(wide, /left:\s*-/);
  assert.doesNotMatch(wide, /980px/);
  const base = css.match(/\.email-center \{[^}]*\}/)[0];
  assert.doesNotMatch(base, /border: 1px solid var\(--line\)/);
  assert.doesNotMatch(base, /padding: 4px;/);
});
