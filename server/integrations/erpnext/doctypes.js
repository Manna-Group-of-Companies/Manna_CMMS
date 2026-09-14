/**
 * The custom DocTypes that hold the parts of Module 1 ERPNext has no home for.
 *
 * Kept here, in the repository, rather than clicked together in the ERPNext UI.
 * These define where the store's operational data lives; they will be changed
 * repeatedly as the rewrite proceeds, and a schema that exists only inside a
 * production database cannot be reviewed, diffed, or rebuilt on a second site.
 * `scripts/syncDoctypes.js` pushes them.
 *
 * All are `custom: 1` in module "Custom". That is what lets them be created
 * over the REST API on Frappe Cloud without bench access, and it keeps them
 * clear of anything ERPNext ships and might overwrite on upgrade.
 *
 * --- Ordering ----------------------------------------------------------
 *
 * ERPNext validates a Link or Table target on insert, so a DocType must exist
 * before another can point at it. The array below is in dependency order, and
 * `LATE_FIELDS` carries the one link that cannot be: Red Stock Item points at
 * Merge Request, whose child points back at Red Stock Item. Something has to
 * be added after the fact, and this is it.
 */

/** Roles every CMMS DocType grants, matching how the store already works. */
const PERMISSIONS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: "Stock Manager", read: 1, write: 1, create: 1, report: 1, export: 1 },
  { role: "Stock User", read: 1, create: 1, report: 1 },
];

/** Shorthand for a field, so the definitions below stay readable. */
const f = (fieldname, label, fieldtype, extra = {}) => ({
  fieldname,
  label,
  fieldtype,
  ...extra,
});

const link = (fieldname, label, target, extra = {}) =>
  f(fieldname, label, "Link", { options: target, ...extra });

const select = (fieldname, label, options, extra = {}) =>
  f(fieldname, label, "Select", { options: options.join("\n"), ...extra });

const doc = ({ name, autoname, fields, istable = 0, extra = {} }) => ({
  doctype: "DocType",
  name,
  module: "Custom",
  custom: 1,
  istable,
  editable_grid: istable ? 1 : 0,
  track_changes: istable ? 0 : 1,
  allow_rename: 0,
  ...(istable ? {} : { naming_rule: "Expression", autoname }),
  fields,
  // A child table inherits its parent's permissions and must not carry its own.
  ...(istable ? {} : { permissions: PERMISSIONS }),
  ...extra,
});

/**
 * An issue of stock, and how it was eventually settled.
 *
 * The quantity itself moves through a standard Stock Entry; this records what
 * ERPNext has no way to express — that two spanners went to the fitting shop
 * and are still outstanding. `returned_qty`, `consumed_qty` and `scrapped_qty`
 * always sum to at most `quantity`, and the difference is what the recipient
 * still holds.
 */
const CMMS_ISSUE = doc({
  name: "CMMS Issue",
  autoname: "format:ISS-{YYYY}-{#####}",
  fields: [
    link("item_code", "Item", "Item", { reqd: 1, in_list_view: 1 }),
    f("item_name", "Item Name", "Data", { fetch_from: "item_code.item_name", read_only: 1 }),
    f("quantity", "Quantity Issued", "Float", { reqd: 1, in_list_view: 1, non_negative: 1 }),
    f("recipient", "Recipient", "Data", { reqd: 1, in_list_view: 1 }),
    f("purpose", "Purpose", "Small Text"),
    link("supervisor", "Issued By", "User", { reqd: 1 }),
    // Named rather than linked: an issue can be filled from several rooms at
    // once, and the ledger records the split as text the way it always has.
    f("source_warehouses", "Drawn From", "Data"),
    link("stock_entry", "Stock Entry", "Stock Entry", { read_only: 1 }),
    f("issue_date", "Date", "Datetime", { reqd: 1, in_list_view: 1 }),
    f("returned_qty", "Returned", "Float", { non_negative: 1, default: "0" }),
    f("consumed_qty", "Consumed", "Float", { non_negative: 1, default: "0" }),
    f("scrapped_qty", "Scrapped", "Float", { non_negative: 1, default: "0" }),
    select("return_status", "Settlement", ["Not Returned", "Partially Returned", "Returned"], {
      default: "Not Returned",
      in_list_view: 1,
    }),
  ],
});

/**
 * One returned batch sitting in the Red Stock Room.
 *
 * `condition` is the reason this cannot be an ordinary warehouse balance: two
 * of the same item in Red Stock are not interchangeable if one is Good and the
 * other Damaged, and ERPNext's Bin knows only the total.
 */
const CMMS_RED_STOCK_ITEM = doc({
  name: "CMMS Red Stock Item",
  autoname: "format:RS-{YYYY}-{#####}",
  fields: [
    link("item_code", "Item", "Item", { reqd: 1, in_list_view: 1 }),
    f("item_name", "Item Name", "Data", { fetch_from: "item_code.item_name", read_only: 1 }),
    f("quantity", "Quantity", "Float", { reqd: 1, in_list_view: 1, non_negative: 1 }),
    select("condition", "Condition", ["Good", "Damaged", "Repairable", "Expired"], {
      reqd: 1,
      default: "Good",
      in_list_view: 1,
    }),
    select(
      "status",
      "Status",
      ["In Red Stock", "Weekly Merge Pending", "Moved to Stock Room", "Scrapped"],
      { reqd: 1, default: "In Red Stock", in_list_view: 1 }
    ),
    link("returned_by", "Returned By", "User"),
    f("department", "Returning Department", "Data", { reqd: 1 }),
    f("return_date", "Returned On", "Date", { reqd: 1 }),
    link("source_issue", "From Issue", "CMMS Issue"),
    link("source_warehouse", "Originally From", "Warehouse"),
  ],
});

/** One line of a merge: which batch goes to which shelf. */
const CMMS_MERGE_ITEM = doc({
  name: "CMMS Merge Item",
  istable: 1,
  fields: [
    link("red_stock_item", "Red Stock Batch", "CMMS Red Stock Item", { reqd: 1, in_list_view: 1 }),
    link("item_code", "Item", "Item", { reqd: 1, in_list_view: 1 }),
    f("quantity", "Quantity", "Float", { reqd: 1, in_list_view: 1, non_negative: 1 }),
    link("destination_warehouse", "To Warehouse", "Warehouse", { in_list_view: 1 }),
    f("moved", "Moved", "Check", { default: "0" }),
  ],
});

/**
 * A request to put Red Stock back on a shelf.
 *
 * Two ways in, which is why `created_via` exists: a supervisor merging their
 * own returns, applied immediately, and the Admin's weekly sweep of whatever
 * nobody merged, which they approve and name a room for.
 */
const CMMS_MERGE_REQUEST = doc({
  name: "CMMS Merge Request",
  autoname: "format:MRG-{YYYY}-{#####}",
  fields: [
    select("status", "Status", ["Pending", "Approved", "Rejected", "Applied"], {
      reqd: 1,
      default: "Pending",
      in_list_view: 1,
    }),
    select("created_via", "Raised By", ["Supervisor", "Scheduled", "Admin"], {
      reqd: 1,
      default: "Supervisor",
      in_list_view: 1,
    }),
    link("requested_by", "Requested By", "User", { reqd: 1 }),
    link("destination_warehouse", "Destination", "Warehouse", { in_list_view: 1 }),
    f("week_key", "Week", "Data", { description: "ISO week this sweep covers, e.g. 2026-W34" }),
    f("comment", "Comment", "Small Text"),
    f("items", "Batches", "Table", { options: "CMMS Merge Item", reqd: 1 }),
    link("stock_entry", "Stock Entry", "Stock Entry", { read_only: 1 }),
    f("applied_on", "Applied On", "Datetime", { read_only: 1 }),
  ],
});

/**
 * A supervisor asking for a product to be added or changed.
 *
 * The requested values are held here rather than on the Item, because until an
 * Admin approves there is no Item to hold them — and an edit must not touch
 * the live catalog while it is still a request.
 */
const CMMS_PRODUCT_REQUEST = doc({
  name: "CMMS Product Request",
  autoname: "format:PR-{YYYY}-{#####}",
  fields: [
    select("request_type", "Type", ["ADD", "EDIT"], { reqd: 1, default: "ADD", in_list_view: 1 }),
    select("status", "Status", ["Pending", "Approved", "Rejected", "Cancelled"], {
      reqd: 1,
      default: "Pending",
      in_list_view: 1,
    }),
    link("supervisor", "Requested By", "User", { reqd: 1 }),
    // Empty for an ADD: the Item does not exist until this is approved.
    link("item_code", "Existing Item", "Item"),
    f("proposed_item_code", "Proposed Code", "Data", { in_list_view: 1 }),
    f("proposed_item_name", "Proposed Name", "Data", { reqd: 1 }),
    link("proposed_item_group", "Category", "Item Group"),
    link("proposed_uom", "Unit", "UOM"),
    f("proposed_brand", "Brand", "Data"),
    f("proposed_min_stock", "Minimum Stock", "Float", { non_negative: 1 }),
    link("proposed_warehouse", "Store", "Warehouse"),
    f("rack_number", "Rack", "Data"),
    f("opening_quantity", "Opening Quantity", "Float", { non_negative: 1, default: "0" }),
    f("description", "Description", "Small Text"),
    // Null means never checked, which is not the same as failing. The imported
    // catalog was named long before the convention existed.
    select("name_compliant", "Name Compliant", ["", "Yes", "No"], { default: "" }),
    f("admin_comments", "Admin Comments", "Small Text"),
  ],
});

/** One counted line of a stock audit. */
const CMMS_AUDIT_ITEM = doc({
  name: "CMMS Audit Item",
  istable: 1,
  fields: [
    link("item_code", "Item", "Item", { reqd: 1, in_list_view: 1 }),
    f("system_qty", "System", "Float", { in_list_view: 1 }),
    f("counted_qty", "Counted", "Float", { in_list_view: 1 }),
    f("variance", "Variance", "Float", { in_list_view: 1, read_only: 1 }),
    f("note", "Note", "Data"),
  ],
});

/**
 * A physical count of one store, and the score it earned.
 *
 * ERPNext's Stock Reconciliation records the correction but not the exercise:
 * who counted, how accurate they were, and when this shelf is next due. That
 * is what the store is actually managed on.
 */
const CMMS_STOCK_AUDIT = doc({
  name: "CMMS Stock Audit",
  autoname: "format:AUD-{YYYY}-{#####}",
  fields: [
    link("warehouse", "Store", "Warehouse", { reqd: 1, in_list_view: 1 }),
    f("period", "Period", "Data", { reqd: 1, in_list_view: 1, description: "YYYY-MM" }),
    select("status", "Status", ["Draft", "Submitted", "Reviewed"], {
      reqd: 1,
      default: "Draft",
      in_list_view: 1,
    }),
    link("counted_by", "Counted By", "User", { reqd: 1 }),
    f("counted_on", "Counted On", "Datetime"),
    f("score", "Score", "Percent", { read_only: 1, in_list_view: 1 }),
    f("items_counted", "Lines Counted", "Int", { read_only: 1 }),
    f("items_matched", "Lines Matching", "Int", { read_only: 1 }),
    f("items", "Counted Lines", "Table", { options: "CMMS Audit Item" }),
    link("stock_reconciliation", "Reconciliation", "Stock Reconciliation", { read_only: 1 }),
    link("reviewed_by", "Reviewed By", "User"),
    f("review_comments", "Review Comments", "Small Text"),
  ],
});

/**
 * Consumption and scrap.
 *
 * Already created; kept here so the definition lives with the others and a
 * second site can be built from this file alone.
 */
const CMMS_DISPOSAL = doc({
  name: "CMMS Disposal",
  autoname: "format:DISP-{YYYY}-{#####}",
  fields: [
    select("disposal_type", "Type", ["Consumed", "Scrapped"], { reqd: 1, in_list_view: 1 }),
    link("item_code", "Item", "Item", { reqd: 1, in_list_view: 1 }),
    f("quantity", "Quantity", "Float", { reqd: 1, in_list_view: 1, non_negative: 1 }),
    f("value", "Value", "Currency"),
    select("source", "Source", ["Issue", "Red Stock"]),
    f("reference", "Reference", "Data"),
    f("reason", "Reason", "Small Text"),
    f("disposal_date", "Date", "Date", { reqd: 1, in_list_view: 1 }),
    link("disposed_by", "Disposed By", "User"),
  ],
});

/** In dependency order. Children and link targets come before their users. */
export const DOCTYPES = [
  CMMS_ISSUE,
  CMMS_RED_STOCK_ITEM,
  CMMS_MERGE_ITEM,
  CMMS_MERGE_REQUEST,
  CMMS_PRODUCT_REQUEST,
  CMMS_AUDIT_ITEM,
  CMMS_STOCK_AUDIT,
  CMMS_DISPOSAL,
];

/**
 * Fields added after every DocType exists, because their targets could not
 * exist yet at creation time.
 *
 * Red Stock Item points at the Merge Request that moved it; Merge Request's
 * child points back at the Red Stock Item. One of the two has to be added
 * second, and this is the one.
 */
export const LATE_FIELDS = [
  {
    parent: "CMMS Red Stock Item",
    field: link("merge_request", "Merged By", "CMMS Merge Request", { read_only: 1 }),
  },
];
