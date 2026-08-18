import mongoose from "mongoose";
import { AUDIT_FREQUENCY_NAMES } from "../utils/auditSchedule.js";

/**
 * One physical size and its unit, e.g. `{ value: "50", uom: "SQMM" }`, which
 * renders as `50SQMM` inside the standardized name.
 */
const dimensionSchema = new mongoose.Schema(
  {
    value: { type: String, default: "", trim: true },
    uom: { type: String, default: "", trim: true, uppercase: true },
  },
  { _id: false },
);

/**
 * The fields the SOI1/SOP1 name was built from (ST-09).
 *
 * Kept alongside the finished `name` rather than parsed back out of it: the
 * name is what everyone reads, but only the parts can be edited safely, and
 * the Plant Manager needs them broken out for the SAP record.
 */
export const namingSchema = new mongoose.Schema(
  {
    dimensions: { type: [dimensionSchema], default: [] },
    electricalRating: { type: String, default: "", trim: true },
    electricalUom: { type: String, default: "", trim: true, uppercase: true },
    itemName: { type: String, default: "", trim: true },
    type: { type: String, default: "", trim: true },
    material: { type: String, default: "", trim: true, uppercase: true },
    itemCode: { type: String, default: "", trim: true, uppercase: true },
  },
  { _id: false },
);

/**
 * The SAP hand-off (ST-13).
 *
 * Module 1 does not talk to SAP. It only tracks whether the finalized name has
 * been handed to the Plant Manager and created there, so nothing gets stocked
 * under a name SAP has never heard of.
 *
 * The default is "Not Required" on purpose: the catalog that predates this
 * field was imported wholesale, and defaulting it to "Pending" would drop
 * several thousand historic rows into the Plant Manager's queue on the first
 * deploy. Items created through the intake flow are stamped "Pending"
 * explicitly instead.
 */
const sapSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["Pending", "Created", "Not Required"],
      default: "Not Required",
    },
    /** The code SAP assigned, once the Plant Manager reports back. */
    code: { type: String, default: "", trim: true },
    createdAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
    },
    // The second level of the store's own classification, e.g. category
    // "Tools" / sub-category "Ring Spanners". Optional: the older catalog rows
    // predate it and only the spreadsheet import fills it in.
    subCategory: {
      type: String,
      default: "",
      trim: true,
    },
    brand: {
      type: String,
      default: "",
      trim: true,
    },
    // Condition as recorded during the physical stock take — "Good Condition",
    // "Working", "Brand New", "Complaint". Free text on purpose: the store
    // writes what it sees, and an enum would reject the next phrasing.
    status: {
      type: String,
      default: "",
      trim: true,
    },
    // Last known purchase price per unit, in rupees. 0 means "not recorded"
    // rather than "free" — most of the catalog has never been costed.
    unitCost: {
      type: Number,
      default: 0,
      min: [0, "Unit cost cannot be negative"],
    },
    /**
     * How often this item has to be physically counted: every month, every
     * three months, or twice a year.
     *
     * Defaults to Monthly so nothing silently drops off a count sheet the day
     * this field appears — the catalog that predates it keeps behaving exactly
     * as it did, and an item is only counted less often once somebody has
     * deliberately said so. The schedule itself is worked out per store room
     * in `utils/auditSchedule.js`, from when this item was last counted on
     * that particular shelf.
     */
    auditFrequency: {
      type: String,
      enum: AUDIT_FREQUENCY_NAMES,
      default: "Monthly",
    },
    // Where the item physically sits on the shelving, e.g. "A-1". The store
    // room says which room; this says where to walk to inside it.
    //
    // Optional on purpose: the catalog imported from the transaction ledger
    // carries no rack for any of its products, and making this required would
    // block every one of them from being saved until somebody had walked the
    // store. New products ask for it; old ones can be filled in as they are
    // handled.
    rackNumber: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },
    // Maintained by utils/stockRooms.js as the sum of this product's room
    // rows. Never assign it directly; call creditRoom/debitRoom instead.
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      default: 0,
      min: [0, "Quantity cannot be negative"],
    },
    unit: {
      type: String,
      required: [true, "Unit (e.g., Pcs, Kg) is required"],
      trim: true,
    },
    minStock: {
      type: Number,
      required: [true, "Minimum stock is required"],
      default: 5,
      min: [0, "Minimum stock cannot be negative"],
    },
    // The product's home room: where stock lands when a flow does not name a
    // room, and what the catalog filter matches on. The authoritative
    // per-room balances live in StockRoomInventory — a product may hold
    // stock in several rooms at once.
    storeRoom: {
      type: String,
      required: [true, "Store Room is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    image: {
      type: String,
      trim: true,
      default: "",
    },
    naming: {
      type: namingSchema,
      default: null,
    },
    /**
     * Whether `name` passes the SOI1/SOP1 rules (ST-10).
     *
     * Null means "never checked" — the imported catalog, which was named long
     * before the convention was written down. Only false is a finding; null is
     * a gap, and the two must not be shown the same way.
     */
    nameCompliant: {
      type: Boolean,
      default: null,
    },
    sap: {
      type: sapSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

// Drives the Plant Manager's pending-SAP queue, which is the only read that
// filters on this field.
productSchema.index({ "sap.status": 1, createdAt: -1 });

const Product = mongoose.model("Product", productSchema);
export default Product;
