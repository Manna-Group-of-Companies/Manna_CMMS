// New HSN codes from goods receipts (20 Oct 2026): what counts as an HSN code
// when SAP has no list to check it against.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hsnDigits, hsnProblem } from "../repository/sapCategories.js";

describe("an HSN code typed from a bill", () => {
  it("is kept as digits only", () => {
    assert.equal(hsnDigits("7318.15.00"), "73181500");
    assert.equal(hsnDigits(" 8481 90 90 "), "84819090");
    assert.equal(hsnDigits(""), "");
    assert.equal(hsnDigits(null), "");
  });

  it("has 4, 6 or 8 digits", () => {
    for (const ok of ["7318", "731815", "73181500"]) assert.equal(hsnProblem(ok), "", ok);
    for (const bad of ["731", "73181", "7318150", "731815001"]) assert.match(hsnProblem(bad), /4, 6 or 8 digits/, bad);
  });

  it("is in a chapter that exists: 01 to 98, never 77", () => {
    assert.equal(hsnProblem("0101"), "");
    assert.equal(hsnProblem("9801"), "");
    assert.match(hsnProblem("0012"), /chapter 00/);
    assert.match(hsnProblem("9901"), /chapter 99/);
    assert.match(hsnProblem("77010000"), /chapter 77/);
  });
});
