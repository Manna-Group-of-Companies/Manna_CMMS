// Cancelling from the CMMS (27 Oct 2026): when a purchase request, a quotation or a PO may be cancelled. The sync
// then cancels it in SAP; these are the CMMS's own refusals, without ERPNext.
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cancelReason, cancelRefusal as requestRefusal } from "../repository/purchaseRequests.js";
import { cancelRefusal as quotationRefusal } from "../repository/purchaseQuotations.js";
import { cancelRefusal as orderRefusal } from "../repository/purchaseOrders.js";

describe("cancelling a purchase request", () => {
  const pr = (status, extra = {}) => ({ status, sap_doc_entry: 51, lines: [{ name: "L1", coverage: "" }], ...extra });

  it("is allowed in SAP with nothing quoted or ordered, and for one SAP refused", () => {
    assert.equal(requestRefusal(pr("In SAP")), "");
    assert.equal(requestRefusal(pr("Failed", { sap_doc_entry: null })), "", "SAP never had it: closed in the CMMS at once");
  });

  it("waits for its quotations and POs to be cancelled first - it never cascades", () => {
    assert.match(requestRefusal(pr("In SAP"), [{ id: "PQ-1", status: "Posted" }]), /Cancel or delete its quotation first: PQ-1/);
    assert.match(requestRefusal(pr("In SAP"), [{ id: "PQ-1", status: "Queued" }, { id: "PQ-2", status: "Failed" }]), /quotations first: PQ-1, PQ-2/);
    assert.match(requestRefusal(pr("Ordered"), [{ id: "PQ-1", status: "Cancelled" }], [{ name: "PO-1", status: "Open" }]), /purchase order first: PO-1/);
    assert.equal(requestRefusal(pr("In SAP"), [{ id: "PQ-1", status: "Cancelled" }], [{ name: "PO-1", status: "Closed" }]), "", "cancelled ones do not stand in the way");
  });

  it("refuses one on its way to SAP, one already ending, and one ordered outside the CMMS", () => {
    assert.match(requestRefusal(pr("Queued")), /on its way to SAP/);
    assert.match(requestRefusal(pr("Closed")), /nothing to cancel/);
    assert.match(requestRefusal(pr("Completed")), /nothing to cancel/);
    assert.match(requestRefusal(pr("In SAP", { cancel_status: "Queued" })), /already with the SAP sync/);
    assert.match(requestRefusal(pr("Ordered")), /SAP has a PO for it/);
    assert.match(requestRefusal(pr("In SAP", { po_status: "Posted" })), /PO was made on it before quotations/);
    assert.equal(requestRefusal(pr("In SAP", { po_status: "Failed" })), "", "an old PO SAP refused orders nothing");
  });

  it("can be asked again after SAP refused it", () => {
    assert.equal(requestRefusal(pr("In SAP", { cancel_status: "Failed" })), "");
  });

  it("needs a reason short enough for SAP's Comments", () => {
    assert.equal(cancelReason("  bought locally  "), "bought locally");
    assert.throws(() => cancelReason("  "), /Say why/);
    assert.throws(() => cancelReason("x".repeat(141)), /140 characters/);
  });
});

describe("cancelling a quotation", () => {
  it("is only for one SAP has and no PO is made from", () => {
    assert.equal(quotationRefusal({ status: "Posted", purchase_order: "" }), "");
    assert.match(quotationRefusal({ status: "Posted", purchase_order: "PO-2026-00353" }), /cancel the PO instead/);
    assert.match(quotationRefusal({ status: "Queued" }), /deleted rather than cancelled/);
    assert.match(quotationRefusal({ status: "Failed" }), /deleted rather than cancelled/);
    assert.match(quotationRefusal({ status: "Cancelled" }), /already cancelled/);
    assert.match(quotationRefusal({ status: "Posted", cancel_status: "Queued" }), /already with the SAP sync/);
  });
});

describe("cancelling a purchase order", () => {
  const po = (extra = {}) => ({ status: "Open", sync_status: "Posted", ...extra });
  const lines = (received = 0) => [{ received_qty: 0 }, { received_qty: received }];

  it("is allowed while it is open and nothing is received or entered against it", () => {
    assert.equal(orderRefusal(po(), lines()), "");
    assert.equal(orderRefusal(po({ sync_status: "Failed" }), lines()), "", "SAP never had it: closed in the CMMS at once");
  });

  it("refuses once goods are received, or a receipt is waiting to post - SAP will not cancel a PO with a GRPO", () => {
    assert.match(orderRefusal(po(), lines(2)), /Goods have been received/);
    assert.match(orderRefusal(po(), lines(), [{ name: "GR-2026-00410" }]), /GR-2026-00410.*delete that first/);
  });

  it("refuses one on its way to SAP, one already over, and a second request", () => {
    assert.match(orderRefusal(po({ sync_status: "Queued" }), lines()), /on its way to SAP/);
    assert.match(orderRefusal(po({ status: "Purchased" }), lines()), /Purchased; there is nothing to cancel/);
    assert.match(orderRefusal(po({ status: "Closed" }), lines()), /nothing to cancel/);
    assert.match(orderRefusal(po({ cancel_status: "Queued" }), lines()), /already with the SAP sync/);
  });
});
