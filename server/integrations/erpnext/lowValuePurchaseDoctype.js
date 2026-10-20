/**
 * Low value purchase requests (20 Oct 2026): the "Purchase Request Sheet".
 *
 * The small things a plant needs and the purchase manager buys or has
 * repaired locally, which never go to SAP. Until now they were a Google Sheet
 * that everybody typed into; this is that sheet, row for row and column for
 * column, so nothing about how it is read changes - only that it lives in
 * ERPNext, can be filtered, and keeps who changed what.
 *
 * One record per row of the sheet. The dropdowns carry the sheet's own values
 * (its hidden lists in columns P-U), including the ones that only ever appear
 * there, so a row copied across keeps its meaning.
 *
 * No workflow: the sheet is a tracker that is updated, not a document that is
 * approved step by step. Who may change which column is decided in the
 * application - repository/lowValuePurchases.js.
 *
 * Pushed by `scripts/syncPurchasing.js`.
 */

export const LOW_VALUE_DOCTYPE = "CMMS Purchase Sheet Entry";

export const REQUEST_TYPES = ["Purchase Request", "Repair Request"];
export const SHEET_COMPANIES = [
  "Manna Rubber Products",
  "Hi-tech Rubber Industries",
  "Hi-tech Pretreads",
  "Manna Tyre Retreading",
  "Soorya Rubbers",
];
export const PRIORITIES = ["Emergency", "High", "Medium", "Low"];
export const APPROVAL_STATUSES = [
  "Pending",
  "Pending MD Approval",
  "Approved",
  "Limited Quantity Approved",
  "On Hold",
  "Rejected",
];
export const PURCHASE_STATUSES = [
  "Not Ordered",
  "Finding Vendors",
  "Gathering Quotations",
  "Bidding Stage",
  "Order Placed",
  "Order Dispatched",
  "Sent for repair",
  "Received",
  "Delivered",
];
/**
 * The sheet's company for each CMMS plant, so a plant head sees their own.
 *
 * The sheet names companies its own way, and one of them differently from the
 * plant: Manna Treads' rows are "Hi-tech Pretreads" (every one of Ajith's 88
 * rows on the sheet). Soorya Rubbers has no plant in the CMMS, so only the
 * roles that see every company see it.
 */
export const PLANT_COMPANIES = {
  "Manna Rubber Products": ["Manna Rubber Products"],
  "Hi-Tech Rubber Industries": ["Hi-tech Rubber Industries"],
  "Manna Treads": ["Hi-tech Pretreads"],
  "Manna Tyre Retreads": ["Manna Tyre Retreading"],
};

/** The sheet companies a scope allows: every one, or a plant head's own (null = every one). */
export const sheetCompaniesFor = (scope) =>
  scope?.scoped ? [...new Set((scope.plants || []).flatMap((p) => PLANT_COMPANIES[p] || []))] : null;

/** The sheet greys a row out - green, in fact - once it reaches one of these. */
export const DONE_STATUSES = ["Received", "Delivered"];

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
const select = (fieldname, label, options, extra = {}) =>
  f(fieldname, label, "Select", { options: options.join("\n"), ...extra });

export const LOW_VALUE_DEFINITION = {
  doctype: "DocType",
  name: LOW_VALUE_DOCTYPE,
  module: "Custom",
  custom: 1,
  istable: 0,
  track_changes: 1,
  naming_rule: "Expression",
  autoname: "format:PRS-{YYYY}-{#####}",
  sort_field: "creation",
  sort_order: "DESC",
  permissions: [
    { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  ],
  fields: [
    // --- the columns of the sheet, in its order
    f("request_date", "Date", "Date", { reqd: 1, in_list_view: 1 }),
    select("request_type", "Type of Request", REQUEST_TYPES, { default: "Purchase Request", in_list_view: 1 }),
    select("company", "Company", SHEET_COMPANIES, { reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    f("raised_by_name", "Raised By", "Data", { length: 60, in_list_view: 1 }),
    f("description", "Description", "Small Text", { reqd: 1 }),
    f("purpose", "Purpose of Purchase/Repair", "Small Text"),
    f("links", "Links/Brands of Product or contact details of vendor", "Small Text"),
    select("priority", "Priority", PRIORITIES, { default: "High", in_list_view: 1 }),
    select("approval_status", "Status of Approval", APPROVAL_STATUSES, {
      default: "Pending",
      in_list_view: 1,
      in_standard_filter: 1,
    }),
    select("purchase_status", "Status of Purchase/Repair", PURCHASE_STATUSES, {
      default: "Not Ordered",
      in_list_view: 1,
      in_standard_filter: 1,
    }),
    f("expected_on", "Expected Date of Arrival", "Date"),
    f("received_on", "Received Date", "Date"),
    f("remarks", "Remarks", "Small Text"),

    // --- who, which the sheet could not keep (images are attached files)
    f("trail_section", "Record", "Section Break", { collapsible: 1 }),
    f("raised_by", "Raised By (account)", "Link", { options: "User", read_only: 1 }),
    f("raised_at", "Raised At", "Datetime", { read_only: 1 }),
    f("trail_col", "", "Column Break"),
    f("updated_by", "Last Updated By", "Link", { options: "User", read_only: 1 }),
    f("updated_at", "Last Updated At", "Datetime", { read_only: 1 }),
  ],
};
