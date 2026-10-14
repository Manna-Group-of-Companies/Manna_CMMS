import dotenv from "dotenv";

import { createDoc, docExists } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import { DEVICE_DOCTYPE, DEVICE_DOCTYPE_DEFINITION } from "../integrations/erpnext/deviceDoctype.js";

dotenv.config();

/**
 * Creates `CMMS Device` in ERPNext - where the phones that get push
 * notifications are kept.
 *
 *   node scripts/syncDevices.js --dry-run
 *   node scripts/syncDevices.js
 *
 * Safe to run again: an existing DocType is left alone rather than
 * overwritten, because overwriting a DocType drops columns and dropping a
 * column drops the data in it.
 */

const DRY = process.argv.includes("--dry-run");

const main = async () => {
  if (!erpHasCredentials()) {
    console.error(`ERPNext credentials are not set (${erpDisabledReason()}).`);
    process.exit(1);
  }
  if (DRY) console.log("DRY RUN - nothing will be written.\n");

  if (await docExists("DocType", DEVICE_DOCTYPE)) {
    console.log(`  = ${DEVICE_DOCTYPE} - already present`);
    return;
  }
  if (DRY) {
    console.log(`  + ${DEVICE_DOCTYPE} - would create`);
    return;
  }
  await createDoc("DocType", DEVICE_DOCTYPE_DEFINITION);
  console.log(`  + ${DEVICE_DOCTYPE} - created`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
