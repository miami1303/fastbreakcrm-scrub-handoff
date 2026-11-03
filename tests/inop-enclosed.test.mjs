import { test } from "node:test";
import assert from "node:assert/strict";
import { vehicleRemarkCell, vehicleRemarkCellHtml, vehicleRemarkTags } from "../lib/quote-template.ts";

test("INOP and Enclosed print in the vehicle Remarks cell after ASAP", () => {
  assert.equal(vehicleRemarkCell("", false, true), "INOP");
  assert.equal(vehicleRemarkCell("", false, false, true), "Enclosed");
  assert.equal(vehicleRemarkCell("Keys", true, true, true), "ASAP - INOP - Enclosed - Keys");
  assert.equal(vehicleRemarkCell("Keys", false, false, false), "Keys");
  assert.deepEqual(vehicleRemarkTags(false, true, false), ["INOP"]);
});

test("Unchecked flags leave no label", () => {
  assert.equal(vehicleRemarkCell("", false, false, false), "");
  assert.equal(vehicleRemarkCellHtml("", false, false, false), "");
});

test("HTML cell shows INOP in red and escapes the remark", () => {
  const h = vehicleRemarkCellHtml("<b>x</b>", false, true, true);
  assert.match(h, /<span style="color:#B12E39;font-weight:700;">INOP<\/span> - Enclosed - &lt;b&gt;x&lt;\/b&gt;/);
  assert.equal(vehicleRemarkCellHtml("Keys", true), "ASAP - Keys");
});
