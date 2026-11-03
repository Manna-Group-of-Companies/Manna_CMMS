// Who sees which screen, given the matrix and what this release switches on.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAINTENANCE_MANAGER,
  MANAGER,
  PRODUCTION_MANAGER,
  maySee,
  maySeeItemValue,
  requireAnyView,
  rolesFor,
} from "../config/access.js";

describe("the release", () => {
  it("shows purchase requests to the Admin, maintenance, the plant heads and the purchase manager", () => {
    // The purchase manager since 20 Oct 2026: they make the POs from them.
    assert.deepEqual(rolesFor("purchaseRequests"), [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER, "Purchase Manager"]);
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

describe("item value", () => {
  it("is the Maintenance Manager's alone (23 Oct 2026)", () => {
    assert.ok(maySeeItemValue(MAINTENANCE_MANAGER));
    for (const role of [
      MANAGER,
      PRODUCTION_MANAGER,
      "Supervisor",
      "Higher Management",
      "VP Operations",
      "Purchase Manager",
      "Maintenance Member",
      undefined,
    ]) {
      assert.ok(!maySeeItemValue(role), String(role));
    }
  });
});

describe("the GM's reports (3 Nov 2026)", () => {
  /** What a guard does with one role: true when it lets them through. */
  const admits = (guard, role) => {
    let passed = false;
    const res = { status: () => ({ json: () => {} }) };
    guard({ user: { role } }, res, () => {
      passed = true;
    });
    return passed;
  };

  it("are Higher Management's screen and nobody else's", () => {
    assert.deepEqual(rolesFor("reports"), ["Higher Management"]);
  });

  it("let the GM read the reliability report without opening Breakdown Report", () => {
    const guard = requireAnyView("breakdownReport", "reports");
    assert.ok(admits(guard, "Higher Management"));
    assert.ok(admits(guard, MAINTENANCE_MANAGER), "the Maintenance Manager keeps it");
    assert.ok(!admits(guard, PRODUCTION_MANAGER));
    assert.ok(!maySee("Higher Management", "breakdownReport"));
  });

  it("refuse a screen the table does not know at import", () => {
    assert.throws(() => requireAnyView("reports", "no-such-screen"), /no-such-screen/);
  });
});
