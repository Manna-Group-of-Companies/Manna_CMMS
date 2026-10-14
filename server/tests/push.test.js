// The push payloads the phone is sent, and how the Firebase credentials are
// read. The sending itself talks to Google and is not exercised here.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { breakdownMessage, readServiceAccount, requestMessage } from "../integrations/push.js";

const account = { project_id: "manna-cmms", private_key: "-----BEGIN", client_email: "x@y.iam" };

describe("push payloads", () => {
  it("a breakdown is sent as strings only, named by its machine", () => {
    const data = breakdownMessage({
      id: "BD-2026-00240",
      machine: "MCH-001",
      machineName: "Cracker Mill 1",
      whatHappened: "Bearing failure",
      plant: "Manna Rubber Products",
      priority: "High",
      state: "Reported",
      waitingOn: "Maintenance to start work",
      reportedBy: "mail@mannarubber.com",
      stoppedAt: "2026-10-14 09:13:27",
      stoppedForHours: 0.4,
    });
    assert.equal(data.kind, "breakdown");
    assert.equal(data.title, "Cracker Mill 1");
    assert.equal(data.raisedAt, "2026-10-14 09:13:27");
    for (const [key, value] of Object.entries(data)) {
      assert.equal(typeof value, "string", `${key} must be a string for Firebase`);
    }
  });

  it("a breakdown with no machine name falls back to the code; nulls become empty", () => {
    const data = breakdownMessage({ id: "BD-1", machine: "MCH-9", priority: null });
    assert.equal(data.title, "MCH-9");
    assert.equal(data.priority, "");
  });

  it("a request is sent by its title, with the machine beside it", () => {
    const data = requestMessage({
      id: "MR-2026-00240",
      title: "Replace conveyor belt",
      whatIsNeeded: "New belt, 12 m",
      plant: "Hi-Tech Rubber Industries",
      machineName: "Conveyor 2",
      requestedBy: "plant@mannarubber.com",
      requestedAt: "2026-10-14 09:13:27",
    });
    assert.equal(data.kind, "request");
    assert.equal(data.title, "Replace conveyor belt");
    assert.equal(data.machineName, "Conveyor 2");
    assert.equal(data.raisedBy, "plant@mannarubber.com");
  });
});

describe("the Firebase service account", () => {
  it("is absent when nothing is configured", () => {
    assert.equal(readServiceAccount({}), null);
  });

  it("is read as plain JSON", () => {
    assert.deepEqual(readServiceAccount({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(account) }), account);
  });

  it("is read base64-encoded, which is how it survives a hosting dashboard", () => {
    const encoded = Buffer.from(JSON.stringify(account)).toString("base64");
    assert.deepEqual(readServiceAccount({ FIREBASE_SERVICE_ACCOUNT: encoded }), account);
  });

  it("refuses JSON that is not a service account", () => {
    assert.throws(
      () => readServiceAccount({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ hello: "world" }) }),
      /missing project_id/
    );
  });
});
