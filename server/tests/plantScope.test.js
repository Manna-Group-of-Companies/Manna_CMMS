// The company side of a plant head's scope: which SAP companies their plants
// buy and receive for. The plant side comes from ERPNext and is not exercised
// here.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { companiesForPlants, withinCompany } from "../repository/plantScope.js";

describe("a plant head's companies", () => {
  it("are the abbrs of their plants' stores", () => {
    assert.deepEqual(companiesForPlants(["Hi-Tech Rubber Industries"]), ["HRI"]);
    assert.deepEqual(companiesForPlants(["Manna Rubber Products", "Manna Treads"]), ["MRPPL", "MT"]);
  });

  it("are none for a plant with no store, and none for no plants", () => {
    assert.deepEqual(companiesForPlants(["No Such Plant"]), []);
    assert.deepEqual(companiesForPlants([]), []);
  });

  it("decide what a scoped user may touch; an unscoped user may touch anything", () => {
    const scoped = { scoped: true, companies: ["HRI"] };
    assert.ok(withinCompany(scoped, "HRI"));
    assert.ok(withinCompany(scoped, " hri "), "case and spacing do not matter");
    assert.ok(!withinCompany(scoped, "MRPPL"));
    assert.ok(!withinCompany(scoped, ""), "no company named is not a company of theirs");
    assert.ok(withinCompany({ scoped: false, companies: null }, "MRPPL"));
  });
});
