import { test } from "node:test";
import assert from "node:assert/strict";

import { erpNow, erpPostingParts, erpToday } from "../integrations/erpnext/time.js";

// One moment: 20 Oct 2026, 12:19:48 UTC = 17:49:48 in India (PR-2026-00323's PO).
const MOMENT = new Date("2026-10-20T12:19:48Z");

test("erpNow writes India's wall-clock time, not this machine's (Render runs in UTC)", () => {
  assert.equal(erpNow(MOMENT), "2026-10-20 17:49:48");
});

test("erpToday turns the date over at midnight in India, not at 05:30", () => {
  // 19:00 UTC on the 20th is already 00:30 on the 21st in India.
  assert.equal(erpToday(new Date("2026-10-20T19:00:00Z")), "2026-10-21");
  assert.equal(erpToday(new Date("2026-10-20T18:29:59Z")), "2026-10-20");
});

test("erpPostingParts splits that same India time into date and time", () => {
  assert.deepEqual(erpPostingParts(MOMENT), { posting_date: "2026-10-20", posting_time: "17:49:48" });
});

test("erpNow says 00 for the hour after midnight, never 24", () => {
  assert.equal(erpNow(new Date("2026-10-20T18:30:05Z")), "2026-10-21 00:00:05");
});
