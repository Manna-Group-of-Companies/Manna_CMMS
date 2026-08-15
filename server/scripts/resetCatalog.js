/**
 * Empties the catalog and everything that describes movement of it, so a fresh
 * product list can be imported over a clean database.
 *
 *   node scripts/resetCatalog.js --yes [options]
 *
 *   --yes            Required. Without it the script only reports what it would
 *                    delete and exits — a wipe should never be one typo away.
 *   --keep-history   Leave the ledger and the request queues alone and remove
 *                    only the products and their per-room rows. The kept rows
 *                    will then point at product ids that no longer exist.
 *   --keep-notifications  Leave the notification feed in place.
 *
 * Users, stock rooms and their settings are never touched: the people and the
 * places outlive any one version of the catalog.
 *
 * Every deletion is irreversible. Take a database dump first if the contents
 * matter.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

import Product from "../models/Product.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import StockMovement from "../models/StockMovement.js";
import IssueHistory from "../models/IssueHistory.js";
import RestockItem from "../models/RestockItem.js";
import MergeRequest from "../models/MergeRequest.js";
import ProductRequest from "../models/ProductRequest.js";
import StockInRequest from "../models/StockInRequest.js";
import StockOutRequest from "../models/StockOutRequest.js";
import StockReturnRequest from "../models/StockReturnRequest.js";
import BranchRequest from "../models/BranchRequest.js";
import Notification from "../models/Notification.js";

dotenv.config();

/** The catalog itself: the products and the per-room balances that are it. */
const CATALOG = [
  ["Products", Product],
  ["Per-room inventory rows", StockRoomInventory],
];

/**
 * Records that name a product by id. Kept only under --keep-history, because a
 * request or a ledger line whose product has been deleted cannot be approved,
 * traced or displayed.
 */
const PRODUCT_HISTORY = [
  ["Stock movements (ledger)", StockMovement],
  ["Issue history", IssueHistory],
  ["Red rack items", RestockItem],
  ["Merge requests", MergeRequest],
  ["Product requests", ProductRequest],
  ["Stock-in requests", StockInRequest],
  ["Stock-out requests", StockOutRequest],
  ["Stock-return requests", StockReturnRequest],
  ["Branch requests", BranchRequest],
];

const parseArgs = (argv) => ({
  confirmed: argv.includes("--yes"),
  keepHistory: argv.includes("--keep-history"),
  keepNotifications: argv.includes("--keep-notifications"),
});

const run = async () => {
  const options = parseArgs(process.argv.slice(2));

  const targets = [...CATALOG];
  if (!options.keepHistory) targets.push(...PRODUCT_HISTORY);
  if (!options.keepNotifications) targets.push(["Notifications", Notification]);

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB Connected");

  console.log("\nAbout to delete:");
  let total = 0;
  for (const [label, Model] of targets) {
    const count = await Model.countDocuments();
    total += count;
    console.log(`  ${String(count).padStart(6)}  ${label}`);
  }
  console.log(`  ${String(total).padStart(6)}  documents in total`);
  console.log("\nKept: users, stock rooms.");

  if (!options.confirmed) {
    console.log("\nNothing was deleted. Re-run with --yes to go ahead.");
    return;
  }

  console.log("");
  for (const [label, Model] of targets) {
    const { deletedCount } = await Model.deleteMany({});
    console.log(`Deleted ${deletedCount} ${label.toLowerCase()}`);
  }

  console.log("\nCatalog reset. Import the new product list next:");
  console.log('  node scripts/importProducts.js data/<file>.csv --tidy');
};

run()
  .catch((error) => {
    console.error(`\nReset failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
