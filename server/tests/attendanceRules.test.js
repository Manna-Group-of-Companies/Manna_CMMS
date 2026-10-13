// The attendance and leave rules, checked against the figures the field-sales
// app already proved in the field — including HR's own leave sheet, so if the
// arithmetic ever drifts it drifts against a real person's leave and this
// fails.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AttendanceRuleError,
  assertHalfDayInTime,
  assertPunchInOpen,
  assertPunchOutOpen,
  leaveBalanceFor,
  minuteOf,
  monthBounds,
  monthsAccrued,
  workingHours,
} from "../utils/attendanceRules.js";

const at = (from, opening, asOf, { taken = 0, pending = 0 } = {}) =>
  leaveBalanceFor({ accrualFrom: from, opening, taken, pending, asOf });

describe("punch windows", () => {
  it("punch-in opens at 05:00", () => {
    assert.throws(() => assertPunchInOpen("2026-10-12 04:59:59"), AttendanceRuleError);
    assert.doesNotThrow(() => assertPunchInOpen("2026-10-12 05:00:00"));
  });

  it("punch-out closes at the end of the 21:30 minute", () => {
    assert.doesNotThrow(() => assertPunchOutOpen("2026-10-12 21:30:59"));
    assert.throws(() => assertPunchOutOpen("2026-10-12 21:31:00"), AttendanceRuleError);
  });

  it("a refused punch-out names the day to regularize", () => {
    try {
      assertPunchOutOpen("2026-10-12 22:00:00");
      assert.fail("should have thrown");
    } catch (error) {
      assert.equal(error.code, "OUTSIDE_WINDOW");
      assert.equal(error.regularizeDate, "2026-10-12");
      assert.equal(error.status, 422);
    }
  });

  it("a half day for today must be asked for before noon", () => {
    assert.doesNotThrow(() => assertHalfDayInTime("2026-10-12", "2026-10-12 11:59:00"));
    assert.throws(() => assertHalfDayInTime("2026-10-12", "2026-10-12 12:00:00"));
    // Tomorrow's half day can be asked for at any hour today.
    assert.doesNotThrow(() => assertHalfDayInTime("2026-10-13", "2026-10-12 18:00:00"));
  });

  it("reads the minute off an ERPNext stamp", () => {
    assert.equal(minuteOf("2026-10-12 09:30:15"), 9 * 60 + 30);
    assert.equal(minuteOf(null), null);
  });
});

describe("working hours", () => {
  it("is measured between the two punches, to two places", () => {
    assert.equal(workingHours("2026-10-12 09:00:00", "2026-10-12 18:20:00"), 9.33);
  });

  it("is null, not zero, when a punch is missing", () => {
    // Zero there would make a forgotten punch-out look like a day nobody worked.
    assert.equal(workingHours("2026-10-12 09:00:00", null), null);
    for (const unset of [null, "", "null"]) {
      assert.equal(workingHours(unset, "2026-10-12 18:00:00"), null);
    }
  });

  it("never goes negative", () => {
    assert.equal(workingHours("2026-10-12 18:00:00", "2026-10-12 09:00:00"), 0);
  });
});

describe("month bounds", () => {
  it("covers the whole month, including a leap February", () => {
    assert.deepEqual(monthBounds(2028, 2), { from: "2028-02-01", to: "2028-02-29" });
    assert.deepEqual(monthBounds(2026, 10), { from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("HR's sheet, as at December 2026", () => {
  // Opening balance carried from July, plus one a month for Aug-Dec.
  const sheet = {
    "Pareeth Kb": [0, 5],
    Prashanth: [22, 27],
    Subhash: [17.5, 22.5],
    "Prasad V": [6, 11],
    "Nikhil Tk": [0, 5],
  };
  for (const [person, [opening, entitled]] of Object.entries(sheet)) {
    it(`${person}: ${opening} carried forward becomes ${entitled}`, () => {
      assert.equal(at("2026-08-01", opening, "2026-12-15").entitlement, entitled);
    });
  }
});

describe("when a day is credited", () => {
  it("August credits its day on the first, not the last", () => {
    assert.equal(at("2026-08-01", 0, "2026-08-01").accrued, 1);
    assert.equal(at("2026-08-01", 0, "2026-08-31").accrued, 1);
  });

  it("September makes it two", () => {
    assert.equal(at("2026-08-01", 0, "2026-09-01").accrued, 2);
  });

  it("accrual keeps going into the next year", () => {
    assert.equal(at("2026-08-01", 0, "2027-01-15").entitlement, 6);
    assert.equal(at("2026-08-01", 22, "2027-12-15").entitlement, 22 + 17);
  });

  it("a scheme that has not started yet credits nothing", () => {
    assert.equal(monthsAccrued("2026-12-01", "2026-08-22"), 0);
    assert.equal(at("2026-12-01", 3, "2026-08-22").entitlement, 3);
  });
});

describe("who is on the scheme", () => {
  it("no accrual date means no scheme, which is not a zero balance", () => {
    for (const v of [null, "", "null", "not-a-date"]) {
      const b = at(v, 0, "2026-12-15");
      assert.equal(b.onScheme, false, `accrualFrom=${v}`);
      assert.equal(b.entitlement, 0);
    }
  });

  it("a zero opening balance is still on the scheme and still accrues", () => {
    const b = at("2026-08-01", 0, "2026-12-15");
    assert.equal(b.onScheme, true);
    assert.equal(b.entitlement, 5);
  });
});

describe("what is left", () => {
  it("approved leave comes off the entitlement", () => {
    assert.equal(at("2026-08-01", 22, "2026-12-15", { taken: 4 }).remaining, 23);
  });

  it("half days count as halves", () => {
    assert.equal(at("2026-08-01", 17.5, "2026-12-15", { taken: 0.5 }).remaining, 22);
  });

  it("pending is shown but not deducted", () => {
    const b = at("2026-08-01", 0, "2026-12-15", { taken: 1, pending: 2 });
    assert.equal(b.pending, 2);
    assert.equal(b.remaining, 4);
  });

  it("remaining never reads negative, but overdrawn is admitted", () => {
    const b = at("2026-08-01", 0, "2026-12-15", { taken: 8 });
    assert.equal(b.remaining, 0);
    assert.equal(b.overdrawn, true);
  });

  it("taking exactly the entitlement is not overdrawn", () => {
    const b = at("2026-08-01", 0, "2026-12-15", { taken: 5 });
    assert.equal(b.remaining, 0);
    assert.equal(b.overdrawn, false);
  });
});
