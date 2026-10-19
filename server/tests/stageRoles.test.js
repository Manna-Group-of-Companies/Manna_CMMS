// Who may take which step on a breakdown and a maintenance request.
//
// The rule since 14 Oct 2026: the plant reports, raises and closes;
// maintenance does every step between and never closes. The web client and
// the phone both draw their buttons from these lists, and the server refuses
// a step from a role that is not on one, so this is the whole of the rule.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STAGES, describeStages, mayTake } from "../integrations/erpnext/breakdownStages.js";
import {
  REQUEST_STAGES,
  describeRequestStages,
  mayTakeRequestStep,
} from "../integrations/erpnext/maintenanceRequestStages.js";

const MM = "Maintenance Manager";
const PLANT = "Production Manager";
const ADMIN = "Manager";

describe("breakdown steps", () => {
  it("maintenance starts the repair and hands the machine back", () => {
    for (const action of ["Start Repair", "Machine Running"]) {
      assert.ok(mayTake(action, MM), `${action} is maintenance's`);
      assert.ok(!mayTake(action, PLANT), `${action} is not the plant's`);
    }
  });

  it("the plant closes; the Maintenance Manager cannot close by any route", () => {
    const closes = Object.entries(STAGES)
      .filter(([, s]) => s.to === "Closed")
      .map(([action]) => action);
    assert.deepEqual(closes.sort(), ["Close", "Close with Root Cause"]);

    for (const action of closes) {
      assert.ok(!mayTake(action, MM), `${action} must refuse the Maintenance Manager`);
      assert.ok(mayTake(action, ADMIN), `${action} keeps the Admin as fallback`);
    }
    assert.ok(mayTake("Close", PLANT));
  });

  it("the contract handed to the screens says the same", () => {
    const stages = describeStages();
    assert.ok(!stages.Close.allowedRoles.includes(MM));
    assert.ok(!stages["Close with Root Cause"].allowedRoles.includes(MM));
  });
});

describe("maintenance request steps", () => {
  const plantManager = { role: PLANT, email: "plant@mannarubber.com" };
  const maintenance = { role: MM, email: "maintenance@mannarubber.com" };
  const request = { requested_by: "plant@mannarubber.com" };

  it("maintenance starts the work and marks it complete", () => {
    for (const action of ["Start Work", "Mark Complete"]) {
      assert.ok(REQUEST_STAGES[action], `${action} exists`);
      assert.ok(mayTakeRequestStep(action, maintenance, request), `${action} is maintenance's`);
      assert.ok(!mayTakeRequestStep(action, plantManager, request), `${action} is not the plant's`);
    }
  });

  it("the plant closes; the Maintenance Manager cannot", () => {
    assert.equal(REQUEST_STAGES["Close Request"].to, "Closed");
    assert.ok(mayTakeRequestStep("Close Request", plantManager, request));
    assert.ok(mayTakeRequestStep("Close Request", { role: ADMIN }, request));
    assert.ok(!mayTakeRequestStep("Close Request", maintenance, request));
    assert.ok(!describeRequestStages()["Close Request"].allowedRoles.includes(MM));
  });

  it("turning a request down stays maintenance's", () => {
    assert.ok(mayTakeRequestStep("Reject", maintenance, request));
    assert.ok(!mayTakeRequestStep("Reject", plantManager, request));
  });
});

// "Attended" (20 Oct 2026): maintenance marks a report seen before any work.
describe("attending to a report", () => {
  it("only maintenance attends, and work starts from Attended", () => {
    assert.ok(mayTake("Attend", MM));
    assert.ok(!mayTake("Attend", PLANT));
    assert.equal(STAGES.Attend.from, "Reported");
    assert.equal(STAGES["Start Repair"].from, "Attended");
    assert.ok(mayTakeRequestStep("Attend", { role: MM }, {}));
    assert.ok(!mayTakeRequestStep("Attend", { role: PLANT }, {}));
    assert.equal(REQUEST_STAGES["Start Work"].from, "Attended");
  });

  it("an attended report can still be cancelled, rejected or withdrawn", () => {
    assert.deepEqual(describeStages().Cancel.fromStates, ["Reported", "Attended"]);
    for (const action of ["Reject", "Withdraw"]) {
      assert.deepEqual(describeRequestStages()[action].fromStates, ["Requested", "Attended"]);
    }
  });

  it("attending stamps who and when", () => {
    const stamped = STAGES.Attend.stamp({ email: "mm@x" });
    assert.equal(stamped.attended_by, "mm@x");
    assert.ok(stamped.attended_at);
    assert.equal(REQUEST_STAGES.Attend.stamp({ email: "mm@x" }).attended_by, "mm@x");
  });
});
