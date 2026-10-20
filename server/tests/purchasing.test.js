// The purchase manager's side (20 Oct 2026): making a SAP PO from a purchase
// request, and the low value purchase requests that stay in ERPNext.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maySee } from "../config/access.js";
import { cmmsRoleFor } from "../integrations/erpnext/auth.js";
import { checkOrder as checkPo, mayOrder } from "../repository/purchaseRequests.js";
import { checkEdit, checkNew, editableFields } from "../repository/lowValuePurchases.js";
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
    assert.ok(!maySee("Purchase Manager", "breakdowns"));
  });

  it("low value requests reach every manager and the plant heads", () => {
    for (const role of ["Manager", "Maintenance Manager", "Production Manager", "VP Operations", "Higher Management"]) {
      assert.ok(maySee(role, "lowValuePurchases"), role);
    }
    assert.ok(!maySee("Supervisor", "lowValuePurchases"));
  });
});

describe("a PO from a purchase request", () => {
  const request = (extra = {}) => ({
    company: "HRI",
    status: "In SAP",
    sap_doc_entry: 77,
    po_status: "",
    lines: [
      { name: "l1", idx: 1, item: "HRI-ENG-7", item_name: "Pipe", qty: 6 },
      { name: "l2", idx: 2, item: "HRI-ENG-4", item_name: "Coupling", qty: 2 },
    ],
    ...extra,
  });
  const published = { vendors: [{ code: "V1", name: "Steel Co" }], taxCodes: [{ code: "G18", name: "GST 18", rate: 18 }] };
  const body = (extra = {}) => ({
    vendorCode: "V1",
    dueDate: "2026-10-30",
    lines: [{ itemCode: "HRI-ENG-7", qty: 6, price: 450, taxCode: "G18" }],
    ...extra,
  });

  it("is made only from a request already in SAP with no PO", () => {
    assert.ok(mayOrder(request()));
    assert.ok(!mayOrder(request({ status: "Queued", sap_doc_entry: null })));
    assert.ok(!mayOrder(request({ status: "Ordered" })));
    assert.ok(!mayOrder(request({ po_status: "Queued" })));
    assert.ok(mayOrder(request({ po_status: "Failed" })), "a failed one is made again");
    refusal(() => checkPo(request({ status: "Queued", sap_doc_entry: null }), body(), published, TODAY), /not in SAP yet/);
    refusal(() => checkPo(request({ po_status: "Posted" }), body(), published, TODAY), /already/);
  });

  it("writes the vendor, the dates and the lines ordered", () => {
    const edits = checkPo(request(), body(), published, TODAY);
    assert.equal(edits.po_status, "Queued");
    assert.equal(edits.po_vendor_name, "Steel Co");
    assert.equal(edits.po_date, TODAY);
    assert.deepEqual(edits.lines.map((l) => [l.item, l.po_qty, l.po_price, l.po_tax_code]), [
      ["HRI-ENG-7", 6, 450, "G18"],
      ["HRI-ENG-4", 0, 0, ""],
    ]);
  });

  it("refuses what SAP would", () => {
    refusal(() => checkPo(request(), body({ vendorCode: "" }), published, TODAY), /vendor/);
    refusal(() => checkPo(request(), body({ vendorCode: "NOPE" }), published, TODAY), /not among the SAP suppliers/);
    refusal(() => checkPo(request(), body({ dueDate: "2026-10-01" }), published, TODAY), /before the PO date/);
    refusal(() => checkPo(request(), body({ lines: [{ itemCode: "HRI-ENG-7", qty: 7, price: 1 }] }), published, TODAY), /Only 6/);
    refusal(() => checkPo(request(), body({ lines: [{ itemCode: "HRI-ENG-7", qty: 1, price: 0 }] }), published, TODAY), /price/);
    refusal(() => checkPo(request(), body({ lines: [{ itemCode: "HRI-ENG-7", qty: 1, price: 5, taxCode: "X" }] }), published, TODAY), /tax code/);
    refusal(() => checkPo(request(), body({ lines: [] }), published, TODAY), /at least one/);
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
