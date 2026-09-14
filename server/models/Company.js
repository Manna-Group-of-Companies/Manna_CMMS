import mongoose from "mongoose";

/**
 * A business in the group.
 *
 * Stock rooms carried the company implicitly: the three seeded rooms are
 * simply the three companies' stores, and `StockRoom.RENAMED_ROOMS` says so
 * outright ("the store belongs to the company on it"). That was workable while
 * a company had exactly one room and nothing else needed to know whose site it
 * was. Two things broke it:
 *
 *   - ERPNext keeps `Company` as a hard boundary. A warehouse belongs to one,
 *     and a single Stock Entry cannot move stock across two of them.
 *   - Module 2 has to record whose asset broke down, which a room name only
 *     answers by accident.
 *
 * So the company becomes a record of its own and the room points at it.
 */
const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Company name is required"],
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    // Retired companies stay in the database so historical rooms, issues and
    // audits still resolve to a name — the same reason rooms are never deleted.
    isActive: {
      type: Boolean,
      default: true,
    },

    // --- ERPNext mapping -------------------------------------------------
    //
    // Blank until the integration fills it in. Kept here rather than derived
    // from the name because none of the three names matches ERPNext exactly:
    // the CMMS knows "Manna Rubber Products", ERPNext calls the same entity
    // "Manna Rubber Products Private Limited". Guessing that mapping in code
    // would post stock into a company that does not exist.

    /** Exact ERPNext Company docname that owns this company's stock. */
    erpCompany: {
      type: String,
      default: "",
      trim: true,
    },
    /**
     * The ERPNext abbreviation of `erpCompany`, e.g. "MRPPL".
     *
     * Snapshotted because every warehouse name in ERPNext ends in it
     * (`Stores - MRPPL`), so the sync needs it on hand for every posting
     * rather than re-reading the Company record each time.
     */
    erpAbbr: {
      type: String,
      default: "",
      trim: true,
    },
    /** Exact ERPNext Warehouse docname holding this company's maintenance stock. */
    erpWarehouse: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

/** True once this company can take part in an ERPNext posting. */
companySchema.methods.isErpMapped = function () {
  return Boolean(this.erpCompany && this.erpWarehouse);
};

/**
 * The ERPNext company every store in this system posts against.
 *
 * ERPNext holds four companies — MRPPL, MT, MTR and MRU — and each is a real
 * entity with its own GST registration; MRU trades in AED. Only this one is
 * used by the CMMS. Maintenance stock is an MRPPL function serving every site,
 * so each site's store is a *warehouse* under MRPPL rather than a company of
 * its own.
 *
 * That is what keeps a supervisor's merge a single Stock Entry. Warehouses of
 * one company can exchange stock freely; two companies cannot, and a merge
 * would have become a Delivery Note and Purchase Receipt pair across two GST
 * registrations — an invoice raised every time a spanner moved between sites.
 */
export const ERP_COMPANY = "Manna Rubber Products Private Limited";
export const ERP_ABBR = "MRPPL";

/**
 * Where returned stock waits until a merge puts it back on a shelf.
 *
 * Red Stock is a room in this system's vocabulary but not a `StockRoom`
 * record, so no company owns it and it needs naming here. It has to be a real
 * warehouse in ERPNext all the same: stock sitting in it is out of every store
 * and still on the books, which is exactly what a warehouse is for.
 */
export const ERP_RED_STOCK_WAREHOUSE = `Red Stock - ${ERP_ABBR}`;

/**
 * The companies every install starts with, in display order, each mapped to
 * the warehouse created for it under MRPPL.
 *
 * Hi-Tech Rubber Industries has no company of its own in ERPNext and needs
 * none — "HITECH" appears there only inside tread-rubber item codes, which is
 * a supplier marking rather than an entity. Under this arrangement it is a
 * warehouse like the others.
 */
companySchema.statics.DEFAULTS = [
  {
    name: "Manna Rubber Products",
    erpCompany: ERP_COMPANY,
    erpAbbr: ERP_ABBR,
    erpWarehouse: `Manna Rubber Products Store - ${ERP_ABBR}`,
  },
  {
    name: "Hi-Tech Rubber Industries",
    erpCompany: ERP_COMPANY,
    erpAbbr: ERP_ABBR,
    erpWarehouse: `Hi-Tech Rubber Industries Store - ${ERP_ABBR}`,
  },
  {
    name: "Manna Treads",
    erpCompany: ERP_COMPANY,
    erpAbbr: ERP_ABBR,
    erpWarehouse: `Manna Treads Store - ${ERP_ABBR}`,
  },
];

const Company = mongoose.model("Company", companySchema);
export default Company;
