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

  it("gives the catalog and goods receipts to the Admin, maintenance and the plant heads", () => {
    for (const view of ["engineeringStock", "goodsReceipts"]) {
      assert.deepEqual(rolesFor(view), [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER], view);
      assert.ok(!maySee("Supervisor", view), `${view} is not the store supervisor's yet`);
      assert.ok(!maySee("Higher Management", view), `${view} is not the board's`);
    }
  });

  it("still gives every manager breakdowns and requests", () => {
    for (const role of [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER]) {
      assert.ok(maySee(role, "breakdowns"), role);
      assert.ok(maySee(role, "maintenanceRequests"), role);
    }
  });
});
