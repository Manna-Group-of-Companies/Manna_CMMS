// The purchase manager's side (20 Oct 2026): making a SAP PO from a purchase
// request, and the low value purchase requests that stay in ERPNext.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maySee } from "../config/access.js";
import { cmmsRoleFor } from "../integrations/erpnext/auth.js";
import { checkOrder as checkPo, mayOrder } from "../repository/purchaseRequests.js";
import {
  allowedSteps,
  checkClose,
  checkOrder,
  checkRaise,
  checkReceive,
} from "../repository/lowValuePurchases.js";

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

describe("low value purchase requests", () => {
  const raise = (extra = {}) => ({
    plant: "Manna Treads",
    department: "Production",
    requiredBy: "2026-10-25",
    purpose: "Curing press gauges",
    lines: [{ description: "Pressure gauge", specification: "0-10 bar, 4in", qty: 2, unit: "Nos", estRate: 850 }],
    ...extra,
  });

  it("is raised for one's own plant, with the estimate worked out", () => {
    const fields = checkRaise(raise(), ["Manna Treads"], TODAY);
    assert.equal(fields.status, "Requested");
    assert.equal(fields.est_total, 1700);
    assert.equal(fields.lines[0].est_amount, 1700);
    refusal(() => checkRaise(raise(), ["Hi-Tech Rubber Industries"], TODAY), /not yours/);
    assert.equal(checkRaise(raise(), null, TODAY).plant, "Manna Treads", "an unscoped manager raises for any plant");
  });

  it("refuses an incomplete request", () => {
    refusal(() => checkRaise(raise({ plant: "" }), null, TODAY), /plant/);
    refusal(() => checkRaise(raise({ purpose: " " }), null, TODAY), /what it is for/);
    refusal(() => checkRaise(raise({ requiredBy: "2026-10-01" }), null, TODAY), /past/);
    refusal(() => checkRaise(raise({ lines: [] }), null, TODAY), /at least one/);
    refusal(() => checkRaise(raise({ lines: [{ description: "x", qty: 0, unit: "Nos" }] }), null, TODAY), /quantity/);
    refusal(() => checkRaise(raise({ lines: [{ description: "x", qty: 1, unit: "" }] }), null, TODAY), /unit/);
  });

  const doc = (extra = {}) => ({
    plant: "Manna Treads",
    status: "Requested",
    raised_by: "pm@x",
    lines: [{ name: "a", idx: 1, description: "Pressure gauge", qty: 2, uom: "Nos", est_rate: 850 }],
    ...extra,
  });

  it("is bought by the purchase manager; the estimate stands where no rate is given", () => {
    const bought = checkOrder(doc(), { vendorName: "Local Traders" }, TODAY);
    assert.equal(bought.status, "Ordered");
    assert.equal(bought.total, 1700);
    assert.equal(checkOrder(doc(), { vendorName: "X", lines: [{ idx: 1, rate: 900 }] }, TODAY).total, 1800);
    refusal(() => checkOrder(doc(), { vendorName: "" }, TODAY), /bought from/);
    refusal(() => checkOrder(doc({ status: "Ordered" }), { vendorName: "X" }, TODAY), /only a requested one/);
    refusal(() => checkOrder(doc({ lines: [{ idx: 1, description: "g", qty: 1, est_rate: 0 }] }), { vendorName: "X" }, TODAY), /rate paid/);
  });

  it("gives each person only their own steps", () => {
    const buyer = { email: "shantu@x", role: "Purchase Manager" };
    const asker = { email: "pm@x", role: "Production Manager" };
    const otherPlantHead = { email: "pm2@x", role: "Production Manager" };
    const own = { scoped: true, plants: ["Manna Treads"] };
    const other = { scoped: true, plants: ["Hi-Tech Rubber Industries"] };

    assert.deepEqual(allowedSteps(doc(), buyer, {}), { order: true, reject: true, withdraw: false, receive: false });
    assert.deepEqual(allowedSteps(doc(), asker, own), { order: false, reject: false, withdraw: true, receive: false });
    const ordered = doc({ status: "Ordered" });
    assert.ok(allowedSteps(ordered, asker, own).receive);
    assert.ok(allowedSteps(ordered, buyer, {}).receive);
    assert.ok(!allowedSteps(ordered, otherPlantHead, other).receive);
    assert.ok(!allowedSteps(ordered, { email: "vp@x", role: "VP Operations" }, {}).receive);
  });

  it("is received, rejected or withdrawn from the right state", () => {
    assert.equal(checkReceive(doc({ status: "Ordered" }), { billNo: "B-12" }, TODAY).status, "Received");
    refusal(() => checkReceive(doc(), {}, TODAY), /only an ordered one/);
    refusal(() => checkReceive(doc({ status: "Ordered" }), { billDate: "2026-12-01" }, TODAY), /future/);
    assert.equal(checkClose(doc(), "Rejected", { reason: "Buy it through SAP" }).status, "Rejected");
    refusal(() => checkClose(doc(), "Withdrawn", { reason: "" }), /Say why/);
    refusal(() => checkClose(doc({ status: "Ordered" }), "Withdrawn", { reason: "x" }), /no longer/);
  });
});
