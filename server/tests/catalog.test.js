// A new item stays on the catalog while SAP creates it (28 Oct 2026): its queued row goes the moment the request
// turns Created, so a cached catalog that lacks the new Item must be dropped - missingFromCatalog says when.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { missingFromCatalog } from "../repository/catalog.js";

describe("missingFromCatalog", () => {
  const cached = [{ code: "HRD-ENG-10" }, { code: "HRD-ENG-11" }];

  it("names an item SAP has just created that the cached catalog lacks", () => {
    assert.deepEqual(missingFromCatalog([{ erp_item: "HRD-ENG-20" }], cached), ["HRD-ENG-20"]);
  });

  it("finds nothing missing once the catalog holds the new item", () => {
    assert.deepEqual(missingFromCatalog([{ erp_item: "HRD-ENG-10" }], cached), []);
  });

  it("ignores a created request with no item recorded", () => {
    assert.deepEqual(missingFromCatalog([{ erp_item: "" }, { erp_item: null }, {}], cached), []);
  });

  it("treats an empty catalog as missing every new item", () => {
    assert.deepEqual(missingFromCatalog([{ erp_item: " HRD-ENG-20 " }], []), ["HRD-ENG-20"]);
  });
});
