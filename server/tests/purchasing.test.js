// The purchase manager's side (20 Oct 2026): their role and screens, and the
// low value purchase requests that stay in ERPNext. Quotations and the PO made
// from one are in quotations.test.js.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maySee } from "../config/access.js";
import { cmmsRoleFor } from "../integrations/erpnext/auth.js";
import { checkEdit, checkNew, editableFields, mayDelete } from "../repository/lowValuePurchases.js";
import { sheetCompaniesFor } from "../integrations/erpnext/lowValuePurchaseDoctype.js";

const TODAY = "2026-10-20";
const refusal = (fn, pattern) => assert.throws(fn, (e) => e.status >= 400 && pattern.test(e.message));

describe("the purchase manager", () => {
  it("is their own ERPNext role, and sees both purchase screens", () => {
    assert.equal(cmmsRoleFor(["Employee", "Store Purchase Manager"]), "Purchase Manager");
    // ERPNext's own Purchase Manager role is not ours.
    assert.equal(cmmsRoleFor(["Purchase Manager"]), null);
    assert.ok(maySee("Purchase Manager", "purchaseRequests"));
    assert.ok(maySee("Purchase Manager", "lowValuePurchases"));
    assert.ok(maySee("Purchase Manager", "purchaseQuotations"));
    assert.ok(maySee("Purchase Manager", "purchaseOrders"));
    assert.ok(!maySee("Purchase Manager", "breakdowns"));
  });

  it("low value requests reach every manager and the plant heads", () => {
    for (const role of ["Manager", "Maintenance Manager", "Production Manager", "VP Operations", "Higher Management"]) {
      assert.ok(maySee(role, "lowValuePurchases"), role);
    }
    assert.ok(!maySee("Supervisor", "lowValuePurchases"));
  });
});

describe("the purchase request sheet (low value)", () => {
  const purchaser = { email: "shantu@x", role: "Purchase Manager" };
  const plantHead = { email: "pm@x", role: "Production Manager" };
  const md = { email: "md@x", role: "Higher Management" };
  const row = (extra = {}) => ({
    company: "Hi-tech Pretreads",
    raised_by: "pm@x",
    approval_status: "Pending",
    purchase_status: "Not Ordered",
    ...extra,
  });

  it("adds a row as the sheet would, pending and not ordered", () => {
    const fields = checkNew(
      { company: "hi-tech pretreads", description: "Weighing balance 150 kg", priority: "emergency" },
      { fullName: "Suresh", today: TODAY }
    );
    assert.equal(fields.company, "Hi-tech Pretreads", "picked in the sheet's own spelling");
    assert.equal(fields.priority, "Emergency");
    assert.equal(fields.raised_by_name, "Suresh");
    assert.equal(fields.request_date, TODAY);
    assert.equal(fields.request_type, "Purchase Request");
    assert.equal(fields.approval_status, "Pending");
    assert.equal(fields.purchase_status, "Not Ordered");
    refusal(() => checkNew({ description: "x" }, { today: TODAY }), /company/);
    refusal(() => checkNew({ company: "Manna Rubber Products", description: " " }, { today: TODAY }), /what is needed/);
    refusal(() => checkNew({ company: "Nowhere Ltd", description: "x" }, { today: TODAY }), /not one of the choices/);
    refusal(() => checkNew({ company: "Manna Rubber Products", description: "x", date: "2026-12-01" }, { today: TODAY }), /future/);
  });

  it("lets the purchase manager change every column, and others only theirs", () => {
    assert.ok(editableFields(row(), purchaser).includes("purchaseStatus"));
    assert.ok(editableFields(row(), purchaser).includes("approvalStatus"));
    const asker = editableFields(row(), plantHead);
    assert.ok(asker.includes("description") && asker.includes("remarks"));
    assert.ok(!asker.includes("approvalStatus") && !asker.includes("purchaseStatus"));
    assert.ok(!editableFields(row({ approval_status: "Approved" }), plantHead).includes("description"), "decided: no more edits");
    assert.deepEqual(editableFields(row(), md).sort(), ["approvalStatus", "remarks"]);
    assert.deepEqual(editableFields(row(), { email: "other@x", role: "Production Manager" }), []);
  });

  it("is deleted by the purchase manager, or by whoever raised it while pending", () => {
    assert.ok(mayDelete(row({ approval_status: "Approved" }), purchaser));
    assert.ok(mayDelete(row({ approval_status: "Rejected" }), { email: "a@x", role: "Manager" }));
    assert.ok(mayDelete(row(), plantHead), "their own, still pending");
    assert.ok(!mayDelete(row({ approval_status: "Approved" }), plantHead), "decided: no longer theirs to delete");
    assert.ok(!mayDelete(row(), md), "approving is not owning");
    assert.ok(!mayDelete(row(), { email: "other@x", role: "Production Manager" }));
  });

  it("shows a plant head their own company only", () => {
    assert.deepEqual(sheetCompaniesFor({ scoped: true, plants: ["Manna Treads"] }), ["Hi-tech Pretreads"]);
    assert.deepEqual(sheetCompaniesFor({ scoped: true, plants: ["Hi-Tech Rubber Industries"] }), ["Hi-tech Rubber Industries"]);
    assert.deepEqual(sheetCompaniesFor({ scoped: true, plants: [] }), []);
    assert.equal(sheetCompaniesFor({ scoped: false }), null, "everyone else sees every company");
    const own = ["Hi-tech Pretreads"];
    assert.equal(checkNew({ company: "Hi-tech Pretreads", description: "x" }, { today: TODAY, companies: own }).company, "Hi-tech Pretreads");
    refusal(() => checkNew({ company: "Manna Rubber Products", description: "x" }, { today: TODAY, companies: own }), /not yours/);
    refusal(() => checkEdit(row(), { company: "Manna Rubber Products" }, plantHead, own), /not yours/);
  });

  it("checks each change against who is making it", () => {
    assert.deepEqual(checkEdit(row(), { approvalStatus: "pending md approval" }, md), { approval_status: "Pending MD Approval" });
    refusal(() => checkEdit(row(), { purchaseStatus: "Order Placed" }, md), /may not change/);
    refusal(() => checkEdit(row(), { purchaseStatus: "Shipped" }, purchaser), /not one of the choices/);
    refusal(() => checkEdit(row(), { colour: "red" }, purchaser), /not a column/);
    refusal(() => checkEdit(row(), {}, purchaser), /Nothing to change/);
    const received = checkEdit(row(), { purchaseStatus: "Received" }, purchaser);
    assert.ok(received.received_on, "marking it received fills the received date");
    assert.equal(checkEdit(row(), { expectedOn: "" }, purchaser).expected_on, null);
  });
});
