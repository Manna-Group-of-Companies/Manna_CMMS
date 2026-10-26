// A purchase request goes Completed once its goods are received (23 Oct 2026).
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { historyNote, nextStatus, receiptProgress, receivesFor, reconcileCompletion, stageOf } from "../repository/purchaseCompletion.js";
import { mayQuote } from "../repository/purchaseRequests.js";
import { checkQuotation } from "../repository/purchaseQuotations.js";

const request = (extra = {}) => ({
  name: "PR-2026-00400",
  company: "HRI",
  status: "Ordered",
  po_numbers: "671",
  po_doc_entry: null,
  lines: [
    { item: "ENG-0001", qty: 10 },
    { item: "ENG-0002", qty: 2 },
  ],
  ...extra,
});

const receipt = (name, lines, extra = {}) => ({
  name,
  kind: "Goods Receipt",
  company: "HRI",
  status: "Posted",
  sap_po_entry: 900,
  sap_po_number: "671",
  sap_doc_number: `GR${name.slice(-1)}`,
  lines: lines.map(([item, qty]) => ({ item, qty })),
  ...extra,
});

describe("what counts as received", () => {
  it("a posted receipt against one of the request's POs, in its company", () => {
    const pr = request({ po_numbers: "671, 702" });
    assert.ok(receivesFor(pr, receipt("GR-1", [])));
    assert.ok(receivesFor(pr, receipt("GR-2", [], { sap_po_number: "702" })));
    assert.ok(!receivesFor(pr, receipt("GR-3", [], { sap_po_number: "703" })));
    // SAP numbers each company's POs on its own.
    assert.ok(!receivesFor(pr, receipt("GR-4", [], { company: "MRP" })));
    // Not yet in SAP, or refused by it.
    assert.ok(!receivesFor(pr, receipt("GR-5", [], { status: "Queued" })));
    assert.ok(!receivesFor(pr, receipt("GR-6", [], { status: "Failed" })));
    // No bill, no PO.
    assert.ok(!receivesFor(pr, receipt("GR-7", [], { kind: "Stock Addition" })));
  });

  it("a PO made in the CMMS is matched by its SAP DocEntry", () => {
    const pr = request({ po_numbers: "", po_doc_entry: 900 });
    assert.ok(receivesFor(pr, receipt("GR-1", [], { sap_po_number: "" })));
  });
});

describe("when a request is Completed", () => {
  it("a full receipt completes it", () => {
    const progress = receiptProgress(request(), [receipt("GR-1", [["ENG-0001", 10], ["ENG-0002", 2]])]);
    assert.ok(progress.complete);
    assert.equal(nextStatus(request(), progress), "Completed");
  });

  it("a partial receipt leaves it Ordered", () => {
    const progress = receiptProgress(request(), [receipt("GR-1", [["ENG-0001", 10], ["ENG-0002", 1]])]);
    assert.ok(!progress.complete);
    assert.deepEqual(progress.lines.map((l) => l.received), [10, 1]);
    assert.equal(nextStatus(request(), progress), null);
  });

  it("receipts add up across several", () => {
    const first = receipt("GR-1", [["ENG-0001", 6]]);
    const second = receipt("GR-2", [["ENG-0001", 4], ["ENG-0002", 2]]);
    assert.ok(!receiptProgress(request(), [first]).complete);
    const both = receiptProgress(request(), [first, second]);
    assert.ok(both.complete);
    assert.equal(both.receipts.length, 2);
  });

  it("more than was asked is still complete", () => {
    assert.ok(receiptProgress(request(), [receipt("GR-1", [["ENG-0001", 12], ["ENG-0002", 2]])]).complete);
  });

  it("goes back to Ordered when the receipts no longer cover it", () => {
    const pr = request({ status: "Completed" });
    const progress = receiptProgress(pr, [receipt("GR-1", [["ENG-0001", 10]])]);
    assert.equal(nextStatus(pr, progress), "Ordered");
    assert.match(historyNote("Completed", "Ordered", progress, "2026-10-23 10:00:00"), /ENG-0002 0 of 2/);
  });

  it("a completed request that is still covered stays as it is", () => {
    const pr = request({ status: "Completed" });
    assert.equal(nextStatus(pr, receiptProgress(pr, [receipt("GR-1", [["ENG-0001", 10], ["ENG-0002", 2]])])), null);
  });

  it("never completes a closed, failed, queued or not-yet-ordered request", () => {
    const full = [receipt("GR-1", [["ENG-0001", 10], ["ENG-0002", 2]])];
    for (const status of ["Closed", "Failed", "Queued", "In SAP"]) {
      const pr = request({ status });
      assert.equal(nextStatus(pr, receiptProgress(pr, full)), null, status);
    }
  });

  it("a request with no lines is never complete", () => {
    assert.ok(!receiptProgress(request({ lines: [] }), []).complete);
  });

  // Since 24 Oct 2026 the PO is made from a quotation, so "no PO" is "no quotation".
  it("is read only: no quotation can be entered against it", () => {
    const pr = { ...request({ status: "Completed", sap_doc_entry: 77 }), lines: [{ name: "l1", item: "ENG-0001", qty: 10, coverage: "" }] };
    assert.ok(!mayQuote(pr));
    assert.throws(() => checkQuotation(pr, {}, {}, "2026-10-23"), (e) => e.status === 400 && /Completed/.test(e.message));
  });
});

/** ERPNext, in memory: the doctypes the completion check reads and writes. */
const fakeErp = ({ requests, receipts, orders = [] }) => {
  const docs = {
    "CMMS Purchase Request": requests.map(({ lines, ...r }) => ({ ...r })),
    "CMMS Purchase Request Line": requests.flatMap((r) => r.lines.map((l) => ({ ...l, parent: r.name }))),
    "CMMS Goods Receipt": receipts.map(({ lines, ...r }) => ({ ...r })),
    "CMMS Goods Receipt Line": receipts.flatMap((r) => r.lines.map((l) => ({ ...l, parent: r.name }))),
    "CMMS Purchase Order": orders.map(({ lines, ...o }) => ({ ...o })),
    "CMMS Purchase Order Line": orders.flatMap((o) => o.lines.map((l) => ({ ...l, parent: o.name }))),
    Comment: [],
  };
  const match = (row, [, field, op, value]) => {
    if (op === "=") return row[field] === value;
    if (op === "in") return value.map(String).includes(String(row[field]));
    throw new Error(`fake ERPNext: ${op}`);
  };
  const pick = (doctype, { filters = [], orFilters = [] } = {}) =>
    docs[doctype].filter(
      (row) => filters.every((f) => match(row, f)) && (!orFilters.length || orFilters.some((f) => match(row, f)))
    );
  return {
    docs,
    listDocs: async (doctype, options) => pick(doctype, options).map((r) => ({ ...r })),
    listChildRows: async (child, _parent, options) => pick(child, options).map((r) => ({ ...r })),
    updateDoc: async (doctype, name, fields) => {
      const row = docs[doctype].find((r) => r.name === name);
      Object.assign(row, fields);
      return row;
    },
    createDoc: async (doctype, doc) => {
      docs[doctype].push(doc);
      return doc;
    },
  };
};

describe("the completion check against ERPNext", () => {
  const now = () => "2026-10-23 11:00:00";

  it("raised, ordered, received: the request goes Completed, once", async () => {
    // Raised and ordered: the sync has turned it Ordered with PO 671.
    const erp = fakeErp({ requests: [request()], receipts: [] });
    assert.deepEqual(await reconcileCompletion({ api: erp, now }), []);

    // Half the goods come in.
    erp.docs["CMMS Goods Receipt"].push({ ...receipt("GR-1", []), lines: undefined });
    erp.docs["CMMS Goods Receipt Line"].push({ parent: "GR-1", item: "ENG-0001", qty: 10 });
    assert.deepEqual(await reconcileCompletion({ api: erp, now }), []);
    assert.equal(erp.docs["CMMS Purchase Request"][0].status, "Ordered");

    // The rest - entered, then posted by the sync.
    erp.docs["CMMS Goods Receipt"].push({ ...receipt("GR-2", [], { status: "Queued" }), lines: undefined });
    erp.docs["CMMS Goods Receipt Line"].push({ parent: "GR-2", item: "ENG-0002", qty: 2 });
    assert.deepEqual(await reconcileCompletion({ api: erp, now }), []);
    erp.docs["CMMS Goods Receipt"][1].status = "Posted";

    assert.deepEqual(await reconcileCompletion({ api: erp, now }), [{ id: "PR-2026-00400", from: "Ordered", to: "Completed" }]);
    assert.equal(erp.docs["CMMS Purchase Request"][0].status, "Completed");
    assert.equal(erp.docs.Comment.length, 1);
    assert.equal(erp.docs.Comment[0].reference_name, "PR-2026-00400");
    assert.match(erp.docs.Comment[0].content, /GR-1.*GR-2/);
    assert.match(erp.docs.Comment[0].content, /ERPNext goods receipts at 2026-10-23 11:00:00/);

    // Run again: nothing moves, nothing more is written.
    assert.deepEqual(await reconcileCompletion({ api: erp, now }), []);
    assert.equal(erp.docs.Comment.length, 1);
  });

  it("a receipt taken out of ERPNext reopens the request, and logs it", async () => {
    const full = receipt("GR-1", [["ENG-0001", 10], ["ENG-0002", 2]]);
    const erp = fakeErp({ requests: [request({ status: "Completed" })], receipts: [full] });
    assert.deepEqual(await reconcileCompletion({ api: erp, now }), []);

    erp.docs["CMMS Goods Receipt"].length = 0;
    assert.deepEqual(await reconcileCompletion({ api: erp, now }), [{ id: "PR-2026-00400", from: "Completed", to: "Ordered" }]);
    assert.equal(erp.docs["CMMS Purchase Request"][0].status, "Ordered");
    assert.match(erp.docs.Comment[0].content, /Back to Ordered from Completed/);
  });

  it("leaves a closed request alone, received or not", async () => {
    const erp = fakeErp({
      requests: [request({ status: "Closed" })],
      receipts: [receipt("GR-1", [["ENG-0001", 10], ["ENG-0002", 2]])],
    });
    assert.deepEqual(await reconcileCompletion({ api: erp, now }), []);
    assert.equal(erp.docs["CMMS Purchase Request"][0].status, "Closed");
  });

  it("stops quietly when ERPNext does not have the status yet", async () => {
    const erp = fakeErp({ requests: [request()], receipts: [receipt("GR-1", [["ENG-0001", 10], ["ENG-0002", 2]])] });
    erp.updateDoc = async () => {
      throw Object.assign(new Error('Status cannot be "Completed". It should be one of "Queued", "In SAP"'), { status: 417 });
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.deepEqual(await reconcileCompletion({ api: erp, now }), []);
    } finally {
      console.warn = warn;
    }
    assert.equal(erp.docs.Comment.length, 0);
  });
});

describe("the stage a request is shown at (26 Oct 2026)", () => {
  const pr = (status, coverage = ["", ""]) => ({
    status,
    lines: [
      { name: "L1", item: "ENG-0001", qty: 10, coverage: coverage[0] },
      { name: "L2", item: "ENG-0002", qty: 2, coverage: coverage[1] },
    ],
  });
  const po = (name, status, prLines, extra = {}) => ({ name, status, lines: prLines.map((pr_line) => ({ pr_line })), ...extra });

  it("In SAP with no quotation stays In SAP", () => {
    assert.equal(stageOf(pr("In SAP")), "In SAP");
  });

  it("a quotation makes it Quotation Made, one cancelled in SAP does not", () => {
    assert.equal(stageOf(pr("In SAP", ["Quoted", ""]), [{ status: "Queued" }]), "Quotation Made");
    assert.equal(stageOf(pr("In SAP", ["Quoted", ""]), [{ status: "Posted" }]), "Quotation Made");
    assert.equal(stageOf(pr("In SAP"), [{ status: "Cancelled" }]), "In SAP");
  });

  it("a PO from a quotation makes it Ordered at once, before the sync has run", () => {
    assert.equal(stageOf(pr("In SAP", ["Quoted", "Quoted"]), [{ status: "Posted" }], [po("PO-1", "Open", ["L1"])]), "Ordered");
  });

  it("every line on a Purchased or closed PO makes it Completed; a dropped line does not wait", () => {
    const quoted = pr("Ordered", ["Quoted", "Quoted"]);
    assert.equal(stageOf(quoted, [], [po("PO-1", "Purchased", ["L1"]), po("PO-2", "Open", ["L2"])]), "Ordered");
    assert.equal(stageOf(quoted, [], [po("PO-1", "Purchased", ["L1"]), po("PO-2", "Closed", ["L2"])]), "Completed");
    assert.equal(stageOf(pr("Ordered", ["Quoted", "Dropped"]), [], [po("PO-1", "Purchased", ["L1"])]), "Completed");
  });

  it("a PO SAP cancelled orders nothing: back to Quotation Made", () => {
    const cancelled = po("PO-1", "Closed", ["L1", "L2"], { error: "Cancelled in SAP 25 Oct 2026" });
    assert.equal(stageOf(pr("In SAP", ["Quoted", "Quoted"]), [{ status: "Posted" }], [cancelled]), "Quotation Made");
  });

  it("an older request ordered in SAP itself stays Ordered; Queued, Failed, Closed and Completed are shown as stored", () => {
    assert.equal(stageOf(pr("Ordered")), "Ordered");
    for (const s of ["Queued", "Failed", "Closed", "Completed"]) assert.equal(stageOf(pr(s), [{ status: "Posted" }]), s);
  });
});
