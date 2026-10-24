// Engineering purchases from 24 Oct 2026: the chosen vendor's quotation is
// entered against a purchase request, and the PO is made from it - one
// quotation, one PO. The rules, without ERPNext.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maySee } from "../config/access.js";
import { checkDrop, mayQuote } from "../repository/purchaseRequests.js";
import { checkQuotation, gstKindFor, isExpired, mayEdit, mayMakeOrder, newHsnCodes, taxCodesFor } from "../repository/purchaseQuotations.js";
import { checkOrder, nextOrderName } from "../repository/purchaseOrders.js";

const TODAY = "2026-10-24";
const refusal = (fn, pattern) => assert.throws(fn, (e) => e.status >= 400 && pattern.test(e.message));

const request = (extra = {}, lines = null) => ({
  name: "PR-2026-00400",
  company: "HRI",
  status: "In SAP",
  sap_doc_entry: 77,
  po_status: "",
  lines: lines || [
    { name: "l1", idx: 1, item: "HRI-ENG-7", item_name: "Grease", sap_item_code: "ENG-7", qty: 100, uom: "KGS", coverage: "" },
    { name: "l2", idx: 2, item: "HRI-ENG-4", item_name: "Coupling", sap_item_code: "ENG-4", qty: 2, uom: "NOS", coverage: "" },
  ],
  ...extra,
});
const published = {
  vendors: [{ code: "V1", name: "Lube Co" }],
  taxCodes: [{ code: "G18", name: "GST 18", rate: 18 }],
  units: ["KGS", "NOS", "DRUM", "BAG"],
  // Both request items already carry an HSN, so their lines need none.
  itemHsn: { "HRI-ENG-7": "27101980", "HRI-ENG-4": "73079990" },
};
const body = (extra = {}) => ({
  vendorCode: "V1",
  quotationDate: "2026-10-23",
  validUntil: "2026-11-23",
  lines: [{ lineId: "l1", vendorUnit: "drum", qty: 5, price: 8500, taxCode: "G18" }],
  ...extra,
});

describe("the quotation and PO screens", () => {
  it("are the purchase manager's and the Admin's, as making the PO was", () => {
    for (const view of ["purchaseQuotations", "purchaseOrders"]) {
      assert.ok(maySee("Purchase Manager", view), view);
      assert.ok(maySee("Manager", view), view);
      for (const role of ["Maintenance Manager", "Production Manager", "Supervisor", "Higher Management"]) {
        assert.ok(!maySee(role, view), `${view} is not the ${role}'s`);
      }
    }
  });
});

describe("a quotation for a purchase request", () => {
  it("is entered only against a request in SAP, with a line still open and no PO made on it", () => {
    assert.ok(mayQuote(request()));
    assert.ok(!mayQuote(request({ status: "Queued", sap_doc_entry: null })), "not in SAP yet");
    assert.ok(!mayQuote(request({ status: "Ordered" })), "ordered in SAP itself");
    assert.ok(!mayQuote(request({ po_status: "Failed" })), "a PO made on the request the old way is sent again, not quoted");
    const covered = [
      { name: "l1", item: "A", coverage: "Quoted", quotation: "PQ-2026-00001" },
      { name: "l2", item: "B", coverage: "Dropped" },
    ];
    assert.ok(!mayQuote(request({}, covered)), "every line quoted or dropped");
    refusal(() => checkQuotation(request({ status: "Queued", sap_doc_entry: null }), body(), published, TODAY), /not in SAP yet/);
    refusal(() => checkQuotation(request({ po_status: "Posted" }), body(), published, TODAY), /PO was made on this request/);
  });

  it("keeps the vendor's unit as SAP spells it, and the request's own unit beside it", () => {
    const q = checkQuotation(request(), body(), published, TODAY);
    assert.equal(q.vendor_name, "Lube Co");
    assert.deepEqual(q.lines.map((l) => [l.pr_line, l.vendor_uom, l.vendor_qty, l.price, l.tax_code, l.request_qty, l.inventory_uom]), [
      ["l1", "DRUM", 5, 8500, "G18", 100, "KGS"],
    ]);
  });

  it("refuses what SAP would, and a unit SAP does not have", () => {
    refusal(() => checkQuotation(request(), body({ vendorCode: "NOPE" }), published, TODAY), /not among the SAP suppliers/);
    refusal(() => checkQuotation(request(), body({ quotationDate: "2026-10-25" }), published, TODAY), /future/);
    refusal(() => checkQuotation(request(), body({ validUntil: "2026-10-01" }), published, TODAY), /expire before/);
    refusal(() => checkQuotation(request(), body({ lines: [{ lineId: "l1", vendorUnit: "BARREL", qty: 5, price: 1, taxCode: "G18" }] }), published, TODAY), /not a unit set up in SAP/);
    refusal(() => checkQuotation(request(), body({ lines: [{ lineId: "l1", vendorUnit: "DRUM", qty: 0, price: 1, taxCode: "G18" }] }), published, TODAY), /more than zero/);
    refusal(() => checkQuotation(request(), body({ lines: [{ lineId: "l1", vendorUnit: "DRUM", qty: 5, price: 0, taxCode: "G18" }] }), published, TODAY), /unit price/);
    refusal(() => checkQuotation(request(), body({ lines: [{ lineId: "l1", vendorUnit: "DRUM", qty: 5, price: 1, taxCode: "" }] }), published, TODAY), /tax code/);
    refusal(() => checkQuotation(request(), body({ lines: [] }), published, TODAY), /at least one/);
    refusal(() => checkQuotation(request(), body(), { ...published, units: [] }), /unit list/);
  });

  it("gives each request line one vendor: a line on a live quotation is not quoted again", () => {
    const lines = request().lines.map((l) => (l.name === "l1" ? { ...l, coverage: "Quoted", quotation: "PQ-2026-00001" } : l));
    refusal(() => checkQuotation(request({}, lines), body(), published, TODAY), /already on quotation PQ-2026-00001/);
    const dropped = request().lines.map((l) => (l.name === "l1" ? { ...l, coverage: "Dropped" } : l));
    refusal(() => checkQuotation(request({}, dropped), body(), published, TODAY), /dropped/);
    refusal(() => checkQuotation(request(), body({ lines: [body().lines[0], body().lines[0]] }), published, TODAY), /twice/);
  });

  it("is changed, with its own lines, only while SAP does not have it", () => {
    const lines = request().lines.map((l) => (l.name === "l1" ? { ...l, coverage: "Quoted", quotation: "PQ-2026-00001" } : l));
    const mine = { name: "PQ-2026-00001", status: "Queued", purchase_order: "" };
    assert.equal(checkQuotation(request({}, lines), body(), published, TODAY, mine).lines.length, 1, "its own line stays its to quote");
    assert.ok(mayEdit({ status: "Failed" }));
    assert.ok(!mayEdit({ status: "Posted" }), "posted: cancelled in SAP instead");
    refusal(() => checkQuotation(request({}, lines), body(), published, TODAY, { ...mine, status: "Posted" }), /cancelled in SAP/);
  });
});

describe("GST on a quotation line follows where the supplier is", () => {
  // SAP's own tax codes, as the sync publishes them, kinds from their components.
  const taxCodes = [
    { code: "CG+SG@18", rate: 18, kind: "cgst_sgst" },
    { code: "CG+SG@0", rate: 0, kind: "cgst_sgst" },
    { code: "IGST@18", rate: 18, kind: "igst" },
    { code: "EXEMPT", rate: 0, kind: "other" },
  ];
  const withStates = (extra = {}) => ({
    ...published,
    taxCodes,
    companyState: "KL",
    vendors: [
      { code: "S-1050", name: "A K R Polychem", state: "KL" },
      { code: "S-1001", name: "A.A Engineering", state: "KT" },
      { code: "S-9999", name: "No Address Ltd", state: "" },
    ],
    ...extra,
  });
  const line = (taxCode) => ({ lines: [{ lineId: "l1", vendorUnit: "NOS", qty: 10, price: 120, taxCode }] });

  it("takes CGST+SGST from a supplier in the company's own state, and IGST from any other", () => {
    assert.equal(gstKindFor("KL", "KL"), "cgst_sgst");
    assert.equal(gstKindFor("kt", "KL"), "igst");
    assert.equal(gstKindFor("", "KL"), null, "no state on the supplier: nothing is narrowed");
    assert.equal(gstKindFor("KL", ""), null, "no state on the company: nothing is narrowed");
    assert.deepEqual(taxCodesFor(taxCodes, "cgst_sgst").map((t) => t.code), ["CG+SG@18", "CG+SG@0"]);
    assert.deepEqual(taxCodesFor(taxCodes, "igst").map((t) => t.code), ["IGST@18"]);
    assert.equal(taxCodesFor(taxCodes, null).length, 4);
  });

  it("refuses EXEMPT from a same-state supplier, as SAP refused PQ-2026-00352", () => {
    refusal(() => checkQuotation(request(), body({ vendorCode: "S-1050", ...line("EXEMPT") }), withStates(), TODAY), /in KL, the company's own state.*CGST\+SGST/);
    assert.equal(checkQuotation(request(), body({ vendorCode: "S-1050", ...line("CG+SG@18") }), withStates(), TODAY).lines[0].tax_code, "CG+SG@18");
  });

  it("refuses CGST+SGST from another state's supplier, as SAP refused PQ-2026-00350 at first", () => {
    refusal(() => checkQuotation(request(), body({ vendorCode: "S-1001", ...line("CG+SG@18") }), withStates(), TODAY), /in KT, not the company's state \(KL\).*IGST/);
    assert.equal(checkQuotation(request(), body({ vendorCode: "S-1001", ...line("IGST@18") }), withStates(), TODAY).lines[0].tax_code, "IGST@18");
  });

  it("leaves the choice to SAP when a state is not known", () => {
    assert.equal(checkQuotation(request(), body({ vendorCode: "S-9999", ...line("EXEMPT") }), withStates(), TODAY).lines[0].tax_code, "EXEMPT");
    assert.equal(checkQuotation(request(), body({ vendorCode: "S-1050", ...line("EXEMPT") }), withStates({ companyState: "" }), TODAY).lines[0].tax_code, "EXEMPT");
  });
});

describe("an item with no HSN takes one on the quotation line", () => {
  // As PQ-2026-00352: Air Filter Element had no HSN, and SAP refused the GST line for it.
  const noHsn = { ...published, itemHsn: { "HRI-ENG-7": "", "HRI-ENG-4": "73079990" } };
  const line = (hsnCode, lineId = "l1") => ({ lines: [{ lineId, vendorUnit: "NOS", qty: 10, price: 120, taxCode: "G18", hsnCode }] });

  it("asks for it, and refuses the line without it", () => {
    refusal(() => checkQuotation(request(), body(line("")), noHsn, TODAY), /Grease has no HSN code, and SAP needs one/);
    assert.equal(checkQuotation(request(), body(line("8421.39.20")), noHsn, TODAY).lines[0].hsn_code, "84213920", "kept as digits");
  });

  it("refuses an HSN that cannot be one", () => {
    refusal(() => checkQuotation(request(), body(line("842")), noHsn, TODAY), /Grease: HSN 842/);
    refusal(() => checkQuotation(request(), body(line("77010000")), noHsn, TODAY), /Grease: HSN 77010000/);
  });

  it("leaves an item that has its HSN alone, whatever the line says", () => {
    assert.equal(checkQuotation(request(), body(line("8421", "l2")), noHsn, TODAY).lines[0].hsn_code, "", "the item's own HSN stands");
  });

  it("keeps an HSN the quotation brought its own to change, though saving put it on the item", () => {
    // As PQ-2026-00353: 8491 was saved, so the item now reads as having it - but it is still the quotation's.
    const saved = { ...published, itemHsn: { "HRI-ENG-7": "8491", "HRI-ENG-4": "73079990" } };
    const lines = request().lines.map((l) => (l.name === "l1" ? { ...l, coverage: "Quoted", quotation: "PQ-2026-00353" } : l));
    const mine = { name: "PQ-2026-00353", status: "Queued", purchase_order: "", lines: [{ item: "HRI-ENG-7", hsn_code: "8491" }] };
    assert.equal(checkQuotation(request({}, lines), body(line("27101980")), saved, TODAY, mine).lines[0].hsn_code, "27101980", "changed");
    refusal(() => checkQuotation(request({}, lines), body(line("")), saved, TODAY, mine), /Grease has no HSN code/);
  });

  it("still asks for an item's HSN that SAP has not got, so the line raises the request", () => {
    // As PQ-2026-00353 after its edit: the item says 8491, SAP's list does not have it, and the line had lost it.
    const pending = { ...published, hsn: ["8421", "73079990"], itemHsn: { "HRI-ENG-7": "8491", "HRI-ENG-4": "73079990" } };
    refusal(() => checkQuotation(request(), body(line("")), pending, TODAY), /Grease has no HSN code/);
    const q = checkQuotation(request(), body(line("8491")), pending, TODAY);
    assert.equal(q.lines[0].hsn_code, "8491");
    assert.deepEqual([...newHsnCodes(q.lines, pending.hsn)], [["8491", "HRI-ENG-7"]], "and asks SAP for it");
    assert.equal(checkQuotation(request(), body(line("", "l2")), pending, TODAY).lines[0].hsn_code, "", "an HSN SAP has stands");
  });

  it("asks SAP for a code it does not have yet, once per code", () => {
    const lines = [
      { item: "A", hsn_code: "84213920" },
      { item: "B", hsn_code: "84213920" },
      { item: "C", hsn_code: "8421" },
      { item: "D", hsn_code: "" },
    ];
    assert.deepEqual([...newHsnCodes(lines, ["8421"])], [["84213920", "A"]]);
    assert.equal(newHsnCodes(lines, ["8421", "84213920"]).size, 0);
  });
});

describe("dropping a request line", () => {
  it("needs a reason, and leaves a quoted line alone", () => {
    assert.deepEqual(checkDrop(request(), "l2", "  bought locally "), { coverage: "Dropped", quotation: "", drop_reason: "bought locally" });
    refusal(() => checkDrop(request(), "l2", " "), /Say why/);
    const quoted = request().lines.map((l) => (l.name === "l1" ? { ...l, coverage: "Quoted", quotation: "PQ-2026-00001" } : l));
    refusal(() => checkDrop(request({}, quoted), "l1", "x"), /on quotation PQ-2026-00001/);
    refusal(() => checkDrop(request({ status: "Ordered" }), "l1", "x"), /not quoted or dropped/);
  });
});

describe("a PO made from a quotation", () => {
  const quotation = (extra = {}) => ({
    name: "PQ-2026-00001",
    purchase_request: "PR-2026-00400",
    company: "HRI",
    status: "Posted",
    vendor_code: "V1",
    vendor_name: "Lube Co",
    valid_until: "2026-11-23",
    purchase_order: "",
    lines: [{ name: "q1", pr_line: "l1", item: "HRI-ENG-7", item_name: "Grease", vendor_uom: "DRUM", inventory_uom: "KGS", vendor_qty: 1, price: 8500, tax_code: "G18" }],
    ...extra,
  });
  const order = (extra = {}) => ({ deliveryDate: "2026-11-05", lines: [{ lineId: "q1", qty: 5 }], ...extra });

  it("is made once, and only from a quotation SAP has", () => {
    assert.ok(mayMakeOrder(quotation()));
    assert.ok(!mayMakeOrder(quotation({ status: "Queued" })));
    refusal(() => checkOrder(quotation({ status: "Queued" }), order(), TODAY), /SAP does not have this quotation/);
    refusal(() => checkOrder(quotation({ status: "Cancelled" }), order(), TODAY), /cancelled in SAP/);
    refusal(() => checkOrder(quotation({ purchase_order: "PO-2026-00341" }), order(), TODAY), /already been made/);
  });

  it("takes the quoted price and unit, and the quantity it is given - a vendor may quote for one", () => {
    const po = checkOrder(quotation(), order(), TODAY);
    assert.equal(po.po_date, TODAY);
    assert.equal(po.vendor_code, "V1");
    assert.equal(po.quotation_expired, 0);
    assert.deepEqual(po.lines.map((l) => [l.quotation_line, l.vendor_uom, l.qty, l.price, l.tax_code, l.received_qty]), [["q1", "DRUM", 5, 8500, "G18", 0]]);
    assert.equal(checkOrder(quotation(), order({ lines: [] }), TODAY).lines[0].qty, 1, "the quoted quantity when none is given");
    refusal(() => checkOrder(quotation(), order({ lines: [{ lineId: "q1", qty: 0 }] }), TODAY), /more than zero/);
    refusal(() => checkOrder(quotation(), order({ lines: [{ lineId: "nope", qty: 1 }] }), TODAY), /not on this quotation/);
    refusal(() => checkOrder(quotation(), order({ deliveryDate: "2026-10-01" }), TODAY), /before the PO date/);
  });

  it("is made from an expired quotation once the warning is accepted, and says so", () => {
    const old = quotation({ valid_until: "2026-10-20" });
    assert.ok(isExpired(old, TODAY));
    refusal(() => checkOrder(old, order(), TODAY), /expired on 2026-10-20/);
    assert.equal(checkOrder(old, order({ acceptExpired: true }), TODAY).quotation_expired, 1);
  });

  it("is numbered one above the last PO number used, old POs made on a request included", () => {
    // PR-2026-00340's PO went to SAP stamped PO26-00340; a new PO must not reuse it.
    assert.equal(nextOrderName("2026", [], ["PR-2026-00323", "PR-2026-00340"]), "PO-2026-00341");
    assert.equal(nextOrderName("2026", ["PO-2026-00341", "PO-2026-00342"], ["PR-2026-00340"]), "PO-2026-00343");
    assert.equal(nextOrderName("2027", ["PO-2026-00342"], ["PR-2026-00340"]), "PO-2027-00001", "a new year starts again");
    assert.equal(nextOrderName("2026"), "PO-2026-00001");
  });
});
