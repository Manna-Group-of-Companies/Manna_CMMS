import mongoose from "mongoose";

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
    maxStock: {
      type: Number,
      required: [true, "Maximum stock is required"],
      default: 100,
      min: [0, "Maximum stock cannot be negative"],
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
  },
  {
    timestamps: true,
  }
);

const Product = mongoose.model("Product", productSchema);
export default Product;
