// Who sees which screen, given the matrix and what this release switches on.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAINTENANCE_MANAGER, MANAGER, PRODUCTION_MANAGER, maySee, rolesFor } from "../config/access.js";

describe("the release", () => {
  it("shows purchase requests to the Admin, maintenance and the plant heads", () => {
    assert.deepEqual(rolesFor("purchaseRequests"), [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER]);
    assert.ok(!maySee("Supervisor", "purchaseRequests"));
  });

  it("keeps the rest of the engineering store with the Maintenance Manager alone", () => {
    assert.deepEqual(rolesFor("engineeringStock"), [MAINTENANCE_MANAGER]);
    assert.ok(!maySee(MANAGER, "engineeringStock"), "the Admin is on the matrix but the screen is unreleased");
  });

  it("still gives every manager breakdowns and requests", () => {
    for (const role of [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER]) {
      assert.ok(maySee(role, "breakdowns"), role);
      assert.ok(maySee(role, "maintenanceRequests"), role);
    }
  });
});
