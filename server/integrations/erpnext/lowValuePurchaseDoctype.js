/**
 * Low value purchase requests (20 Oct 2026).
 *
 * The small things a plant needs and the purchase manager buys locally - a
 * tool, a few fittings, consumables - that are not worth a SAP purchase
 * request and a PO. Kept in ERPNext only: nothing here is ever posted to SAP.
 *
 * Laid out after the paper purchase request sheet: who asks, for which plant
 * and department, what is needed and why, by when; one line per thing with a
 * description, specification, quantity, unit and an estimated rate. The
 * purchase manager fills in the vendor and the actual rates when it is bought,
 * and the person who asked (or the purchase manager) records it received.
 *
 *   Requested -> Ordered -> Received
 *             -> Rejected (purchase manager) / Withdrawn (whoever asked)
 *
 * A status field rather than an ERPNext workflow, like the CMMS Purchase
 * Request: who may move it is decided in the application
 * (repository/lowValuePurchases.js), and nobody works these in the desk.
 *
 * Pushed by `scripts/syncPurchasing.js`.
 */

export const LOW_VALUE_DOCTYPE = "CMMS Low Value Purchase";
export const LOW_VALUE_LINE_DOCTYPE = "CMMS Low Value Purchase Line";

export const LOW_VALUE_STATUSES = ["Requested", "Ordered", "Received", "Rejected", "Withdrawn"];

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });

export const LOW_VALUE_LINE_DEFINITION = {
  doctype: "DocType",
  name: LOW_VALUE_LINE_DOCTYPE,
  module: "Custom",
  custom: 1,
  istable: 1,
  editable_grid: 1,
  fields: [
    f("description", "Item / Description", "Data", { reqd: 1, in_list_view: 1, length: 140 }),
    f("specification", "Specification / Size / Make", "Data", { in_list_view: 1, length: 140 }),
    f("qty", "Quantity", "Float", { reqd: 1, in_list_view: 1 }),
    f("uom", "Unit", "Data", { in_list_view: 1, length: 20 }),
    f("est_rate", "Estimated Rate", "Currency", { in_list_view: 1 }),
    f("est_amount", "Estimated Amount", "Currency", { read_only: 1 }),
    f("rate", "Actual Rate", "Currency"),
    f("amount", "Actual Amount", "Currency", { read_only: 1 }),
    f("remarks", "Remarks", "Data", { length: 140 }),
  ],
};

export const LOW_VALUE_DEFINITION = {
  doctype: "DocType",
  name: LOW_VALUE_DOCTYPE,
  module: "Custom",
  custom: 1,
  istable: 0,
  track_changes: 1,
  naming_rule: "Expression",
  autoname: "format:LVP-{YYYY}-{#####}",
  sort_field: "creation",
  sort_order: "DESC",
  permissions: [
    { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  ],
  fields: [
    // --- the request, as on the sheet
    f("plant", "Plant", "Link", { options: "CMMS Plant", reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    f("department", "Department", "Data", { length: 60 }),
    f("status", "Status", "Select", {
      options: LOW_VALUE_STATUSES.join("\n"),
      default: "Requested",
      read_only: 1,
      in_list_view: 1,
      in_standard_filter: 1,
    }),
    f("urgency", "Urgency", "Select", { options: "Normal\nUrgent", default: "Normal" }),
    f("required_by", "Required By", "Date", { reqd: 1, in_list_view: 1 }),
    f("purpose", "Purpose / Reason", "Small Text", { reqd: 1 }),
    f("col_a", "", "Column Break"),
    f("raised_by", "Requested By", "Link", { options: "User", read_only: 1 }),
    f("raised_at", "Requested At", "Datetime", { read_only: 1 }),
    f("est_total", "Estimated Total", "Currency", { read_only: 1, in_list_view: 1 }),

    f("lines_section", "Items", "Section Break"),
    f("lines", "Items", "Table", { options: LOW_VALUE_LINE_DOCTYPE, reqd: 1 }),

    // --- bought, by the purchase manager
    f("order_section", "Purchase", "Section Break"),
    f("vendor_name", "Vendor", "Data", { length: 140 }),
    f("vendor_contact", "Vendor Contact", "Data", { length: 60 }),
    f("expected_on", "Expected On", "Date"),
    f("order_remarks", "Purchase Remarks", "Small Text"),
    f("col_b", "", "Column Break"),
    f("ordered_by", "Ordered By", "Link", { options: "User", read_only: 1 }),
    f("ordered_at", "Ordered At", "Datetime", { read_only: 1 }),
    f("total", "Actual Total", "Currency", { read_only: 1 }),

    // --- arrived
    f("receive_section", "Received", "Section Break"),
    f("bill_no", "Bill No.", "Data", { length: 60 }),
    f("bill_date", "Bill Date", "Date"),
    f("receive_remarks", "Receiving Remarks", "Small Text"),
    f("col_c", "", "Column Break"),
    f("received_by", "Received By", "Link", { options: "User", read_only: 1 }),
    f("received_at", "Received At", "Datetime", { read_only: 1 }),

    // --- turned down or taken back
    f("closed_section", "Rejected / Withdrawn", "Section Break", { collapsible: 1 }),
    f("closed_reason", "Reason", "Small Text"),
    f("closed_by", "By", "Link", { options: "User", read_only: 1 }),
    f("closed_at", "At", "Datetime", { read_only: 1 }),
  ],
};
