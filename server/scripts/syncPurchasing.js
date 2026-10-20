import dotenv from "dotenv";

import { createDoc, docExists, getDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import { LOW_VALUE_DEFINITION } from "../integrations/erpnext/lowValuePurchaseDoctype.js";

dotenv.config();

/**
 * The purchase manager's side of the CMMS (20 Oct 2026), in ERPNext.
 *
 *   node scripts/syncPurchasing.js --dry-run
 *   node scripts/syncPurchasing.js
 *   node scripts/syncPurchasing.js --user=someone@mannarubber.com   (another purchase manager)
 *
 *   - the "Store Purchase Manager" role, given to the purchase manager
 *     (Shantu by default). No desk access: it is a CMMS role, and a desk role
 *     would turn an employee's account into a System User;
 *   - the Purchase Request Sheet doctype, CMMS Purchase Sheet Entry
 *     (lowValuePurchaseDoctype.js);
 *   - the PO fields on CMMS Purchase Request and its lines, which the PO form
 *     writes and sap-sync posts as a SAP Purchase Order. Custom Fields, so the
 *     doctype itself (sap-sync/setup-purchase-request.js) is not rewritten.
 *
 * Only adds. Safe to run again.
 */

const DRY = process.argv.includes("--dry-run");
const USER = (process.argv.find((a) => a.startsWith("--user=")) || "--user=shantu@mannarubber.com").slice(7);
const ROLE = "Store Purchase Manager";
const log = (...p) => console.log(...p);

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });

const PR_FIELDS = {
  "CMMS Purchase Request": [
    f("po_section", "Purchase Order (made in the CMMS)", "Section Break", { collapsible: 1 }),
    f("po_status", "PO Status", "Select", { options: "\nQueued\nPosted\nFailed", read_only: 1, in_list_view: 1 }),
    f("po_vendor_code", "Vendor Code", "Data", { read_only: 1 }),
    f("po_vendor_name", "Vendor", "Data", { read_only: 1 }),
    f("po_date", "PO Date", "Date", { read_only: 1 }),
    f("po_due_date", "Delivery Date", "Date", { read_only: 1 }),
    f("po_remarks", "PO Remarks", "Small Text", { read_only: 1 }),
    f("po_col", "", "Column Break"),
    f("po_raised_by", "PO Made By", "Link", { options: "User", read_only: 1 }),
    f("po_raised_at", "PO Made At", "Datetime", { read_only: 1 }),
    f("po_doc_entry", "SAP PO DocEntry", "Int", { read_only: 1 }),
    f("po_doc_number", "SAP PO No.", "Data", { read_only: 1 }),
    f("po_error", "PO Error", "Small Text", { read_only: 1 }),
  ],
  "CMMS Purchase Request Line": [
    f("po_qty", "PO Quantity", "Float"),
    f("po_price", "PO Unit Price", "Currency"),
    f("po_tax_code", "PO Tax Code", "Data", { length: 20 }),
  ],
};

const syncRole = async () => {
  log("\n=== role ===");
  if (await docExists("Role", ROLE)) log(`  = ${ROLE} - present`);
  else {
    log(`  + ${ROLE}`);
    if (!DRY) await createDoc("Role", { role_name: ROLE, desk_access: 0 });
  }

  const user = await getDoc("User", USER).catch(() => null);
  if (!user) {
    log(`  ! ${USER} is not an ERPNext user - give the role by hand once the account exists`);
    return;
  }
  const roles = user.roles || [];
  if (roles.some((r) => r.role === ROLE)) {
    log(`  = ${USER} already holds ${ROLE}`);
    return;
  }
  log(`  + give ${ROLE} to ${USER} (${user.full_name}; now holds ${roles.map((r) => r.role).join(", ") || "nothing"})`);
  if (DRY) return;
  // The whole table, as Frappe replaces a child table it is given.
  await updateDoc("User", USER, { roles: [...roles.map((r) => ({ role: r.role })), { role: ROLE }] });
};

const syncDoctypes = async () => {
  log("\n=== the purchase request sheet ===");
  for (const definition of [LOW_VALUE_DEFINITION]) {
    if (await docExists("DocType", definition.name)) {
      log(`  = ${definition.name} - present`);
      continue;
    }
    log(`  + ${definition.name} (${definition.fields.length} fields)`);
    if (!DRY) await createDoc("DocType", definition);
  }
};

const syncPoFields = async () => {
  log("\n=== PO fields on purchase requests ===");
  for (const [doctype, wanted] of Object.entries(PR_FIELDS)) {
    const meta = await getDoc("DocType", doctype).catch(() => null);
    if (!meta) {
      log(`  ! ${doctype} is not on this site - run sap-sync/setup-purchase-request.js first`);
      continue;
    }
    const custom = await listDocs("Custom Field", { filters: [["dt", "=", doctype]], fields: ["fieldname"], limit: 500 });
    const present = new Set([...(meta.fields || []), ...custom].map((x) => x.fieldname));
    let after = meta.fields?.[meta.fields.length - 1]?.fieldname;
    for (const field of wanted) {
      if (present.has(field.fieldname)) {
        after = field.fieldname;
        continue;
      }
      log(`  + ${doctype}.${field.fieldname}`);
      if (!DRY) await createDoc("Custom Field", { dt: doctype, ...field, insert_after: after });
      after = field.fieldname;
    }
  }
};

const main = async () => {
  if (!erpHasCredentials()) {
    console.error(`ERPNext credentials are not set (${erpDisabledReason()}).`);
    process.exit(1);
  }
  if (DRY) log("DRY RUN - nothing will be written.");
  await syncRole();
  await syncDoctypes();
  await syncPoFields();
  log("\nDone.");
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
