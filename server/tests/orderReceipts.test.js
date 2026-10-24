// Goods receipts against a PO made from a quotation, in the vendor's unit (24 Oct 2026, phase 4), and when the
// request behind such POs is Completed.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkOrderLines } from "../repository/goodsReceipts.js";
import { orderProgress, reconcileCompletion } from "../repository/purchaseCompletion.js";
import { checkDrop, mayQuote } from "../repository/purchaseRequests.js";

describe("a request quoted in parts", () => {
  const ordered = {
    name: "PR-2026-00600",
    status: "Ordered",
    sap_doc_entry: 20,
    po_status: "",
    lines: [
      { name: "a", item: "HRI-ENG-1", coverage: "Quoted", quotation: "PQ-1" },
      { name: "b", item: "HRI-ENG-2", coverage: "" },
    ],
  };

  it("can still be quoted once its first quotation's PO has made it Ordered", () => {
    assert.equal(mayQuote(ordered), true);
  });

  it("can still have its open line dropped while Ordered", () => {
    assert.deepEqual(checkDrop(ordered, "b", "no vendor stocks it"), { coverage: "Dropped", quotation: "", drop_reason: "no vendor stocks it" });
  });

  it("is not quoted when its PO was made on the request the old way", () => {
    assert.equal(mayQuote({ ...ordered, po_status: "Posted" }), false);
  });
});

/** The plan's worked example: 5 Drum of grease quoted at 8,500. */
const po = (extra = {}) => ({
  order: "PO-2026-00400",
  number: "900",
  lines: [
    { line: "pol-1", name: "Grease EP2", itemCode: "HRI-ENG-12", vendorUnit: "Drum", unit: "Kg", receivableQty: 5, waitingQty: 0, price: 8500 },
    { line: "pol-2", name: "Spanner", itemCode: "HRI-ENG-2", vendorUnit: "Nos", unit: "Nos", receivableQty: 10, waitingQty: 0, price: 120 },
  ],
  ...extra,
});
const refused = (fn, pattern) => assert.throws(fn, (e) => e.status === 400 && pattern.test(e.message));

describe("a receipt against a PO made from a quotation", () => {
  it("books the bill: 3 Drum at 8,800 weighed in at 59.4 Kg cost 444.444... per Kg, 26,400 in all", () => {
    const [l] = checkOrderLines(po(), [{ orderLine: "pol-1", vendorQty: 3, receivedQty: 59.4, billPrice: 8800 }]);
    assert.equal(l.vendorQty, 3);
    assert.equal(l.receivedQty, 59.4);
    assert.equal(l.value, 26400);
    assert.ok(Math.abs(l.cost - 444.4444444) < 1e-6);
    assert.ok(Math.abs(l.receivedQty * l.cost - 26400) < 1e-6, "the cost, unrounded, gives back the bill");
    assert.equal(l.priceChanged, true);
  });

  it("takes the inventory units per vendor unit instead of the received quantity", () => {
    const [l] = checkOrderLines(po(), [{ orderLine: "pol-1", vendorQty: 3, ratio: 19.8 }]);
    assert.equal(l.receivedQty, 59.4);
  });

  it("rounds a ratio-given quantity to 3 decimals, as ERPNext keeps it", () => {
    const [l] = checkOrderLines(po(), [{ orderLine: "pol-1", vendorQty: 3, ratio: 19.83333 }]);
    assert.equal(l.receivedQty, 59.5);
  });

  it("prices a line at the quote when the bill price is left empty", () => {
    const [l] = checkOrderLines(po(), [{ orderLine: "pol-2", vendorQty: 6, receivedQty: 6, billPrice: "" }]);
    assert.equal(l.billPrice, 120);
    assert.equal(l.value, 720);
    assert.equal(l.priceChanged, false);
  });

  it("takes part of a line, and skips a line with nothing typed", () => {
    const lines = checkOrderLines(po(), [
      { orderLine: "pol-1", vendorQty: "", receivedQty: "", ratio: "" },
      { orderLine: "pol-2", vendorQty: 4, receivedQty: 4 },
    ]);
    assert.deepEqual(lines.map((l) => [l.line.line, l.vendorQty]), [["pol-2", 4]]);
  });

  it("refuses more than is pending on the PO, in the vendor's unit", () => {
    refused(() => checkOrderLines(po(), [{ orderLine: "pol-1", vendorQty: 6, receivedQty: 120 }]), /more than is pending/);
  });

  it("refuses what is pending once receipts already waiting are counted", () => {
    const waiting = po();
    waiting.lines[0] = { ...waiting.lines[0], receivableQty: 2, waitingQty: 3 };
    refused(() => checkOrderLines(waiting, [{ orderLine: "pol-1", vendorQty: 3, receivedQty: 59.4 }]), /after 3 already entered/);
  });

  it("lets the weighed quantity run over what was asked for: only the billed qty is limited", () => {
    const [l] = checkOrderLines(po(), [{ orderLine: "pol-1", vendorQty: 5, receivedQty: 104.2 }]);
    assert.equal(l.receivedQty, 104.2);
  });

  it("refuses a line with no received quantity and no ratio", () => {
    refused(() => checkOrderLines(po(), [{ orderLine: "pol-1", vendorQty: 3 }]), /give what came in, in Kg, or the Kg per Drum/);
  });

  it("refuses a received quantity with no billed quantity", () => {
    refused(() => checkOrderLines(po(), [{ orderLine: "pol-1", receivedQty: 59.4 }]), /quantity on the bill, in Drum/);
  });

  it("refuses a bill price of zero", () => {
    refused(() => checkOrderLines(po(), [{ orderLine: "pol-2", vendorQty: 1, receivedQty: 1, billPrice: 0 }]), /bill price/);
  });

  it("refuses a line that is not on the PO, and one entered twice", () => {
    refused(() => checkOrderLines(po(), [{ orderLine: "other", vendorQty: 1, receivedQty: 1 }]), /not an open line of PO 900/);
    refused(
      () =>
        checkOrderLines(po(), [
          { orderLine: "pol-2", vendorQty: 1, receivedQty: 1 },
          { orderLine: "pol-2", vendorQty: 1, receivedQty: 1 },
        ]),
      /entered twice/,
    );
  });

  it("refuses a receipt with nothing typed", () => {
    refused(() => checkOrderLines(po(), []), /at least one line/);
  });
});

const request = (extra = {}) => ({
  name: "PR-2026-00500",
  company: "HRI",
  status: "Ordered",
  po_numbers: "289",
  lines: [
    { name: "prl-1", item: "HRI-ENG-12", qty: 60, coverage: "Quoted" },
    { name: "prl-2", item: "HRI-ENG-2", qty: 10, coverage: "Quoted" },
    { name: "prl-3", item: "HRI-ENG-1", qty: 4, coverage: "Dropped" },
  ],
  ...extra,
});
const order = (name, status, prLines) => ({ name, status, sap_doc_number: "289", purchase_request: "PR-2026-00500", lines: prLines.map((pr_line) => ({ pr_line })) });

describe("a request made through quotations is Completed by its POs", () => {
  it("is complete once every PO is Purchased, though the grease weighed in under the request", () => {
    // 59.4 Kg came in against 60 asked for: judged by the PO, not the weight.
    assert.equal(orderProgress(request(), [order("PO-1", "Purchased", ["prl-1", "prl-2"])]).complete, true);
  });

  it("ignores a dropped line", () => {
    const p = orderProgress(request(), [order("PO-1", "Purchased", ["prl-1", "prl-2"])]);
    assert.deepEqual(p.lines.map((l) => l.item), ["HRI-ENG-12", "HRI-ENG-2"]);
  });

  it("waits for a PO still Open", () => {
    assert.equal(orderProgress(request(), [order("PO-1", "Purchased", ["prl-1"]), order("PO-2", "Open", ["prl-2"])]).complete, false);
  });

  it("waits for a line quoted but not on a PO yet", () => {
    assert.equal(orderProgress(request(), [order("PO-1", "Purchased", ["prl-1"])]).complete, false);
  });

  it("is not complete when every line was dropped", () => {
    const allDropped = request({ lines: [{ name: "prl-3", item: "HRI-ENG-1", qty: 4, coverage: "Dropped" }] });
    assert.equal(orderProgress(allDropped, [order("PO-1", "Purchased", [])]).complete, false);
  });

  it("counts a PO SAP closed with goods pending as done: nothing more is coming for it", () => {
    assert.equal(orderProgress(request(), [order("PO-1", "Closed", ["prl-1", "prl-2"])]).complete, true);
  });

  it("does not count a PO SAP cancelled: its lines wait for the next PO", () => {
    const cancelled = { ...order("PO-1", "Closed", ["prl-1", "prl-2"]), error: "Cancelled in SAP (PO 289) 2026-10-25 10:00:00." };
    assert.equal(orderProgress(request(), [cancelled]).complete, false);
    assert.equal(orderProgress(request(), [cancelled, order("PO-2", "Purchased", ["prl-1", "prl-2"])]).complete, true);
  });

  it("moves the request in ERPNext and writes why", async () => {
    const docs = {
      "CMMS Purchase Request": [{ name: "PR-2026-00500", company: "HRI", status: "Ordered", po_numbers: "289" }],
      "CMMS Purchase Request Line": request().lines.map((l) => ({ ...l, parent: "PR-2026-00500" })),
      "CMMS Goods Receipt": [],
      "CMMS Goods Receipt Line": [],
      "CMMS Purchase Order": [{ name: "PO-1", status: "Open", sap_doc_number: "289", purchase_request: "PR-2026-00500" }],
      "CMMS Purchase Order Line": [{ parent: "PO-1", pr_line: "prl-1" }, { parent: "PO-1", pr_line: "prl-2" }],
      Comment: [],
    };
    const match = (row, [, field, op, value]) => (op === "=" ? row[field] === value : value.map(String).includes(String(row[field])));
    const pick = (doctype, { filters = [], orFilters = [] } = {}) =>
      docs[doctype].filter((row) => filters.every((f) => match(row, f)) && (!orFilters.length || orFilters.some((f) => match(row, f))));
    const api = {
      listDocs: async (doctype, options) => pick(doctype, options).map((r) => ({ ...r })),
      listChildRows: async (child, _parent, options) => pick(child, options).map((r) => ({ ...r })),
      updateDoc: async (doctype, name, fields) => Object.assign(docs[doctype].find((r) => r.name === name), fields),
      createDoc: async (doctype, doc) => docs[doctype].push(doc),
    };
    const now = () => "2026-10-24 18:00:00";

    assert.deepEqual(await reconcileCompletion({ api, now }), []);
    docs["CMMS Purchase Order"][0].status = "Purchased";
    assert.deepEqual(await reconcileCompletion({ api, now }), [{ id: "PR-2026-00500", from: "Ordered", to: "Completed" }]);
    assert.match(docs.Comment[0].content, /every purchase order made from its quotations is Purchased or closed in SAP. POs: PO-1 \(SAP 289\) Purchased/);
    assert.deepEqual(await reconcileCompletion({ api, now }), []);
  });
});
