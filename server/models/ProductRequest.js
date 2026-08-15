import mongoose from "mongoose";

const productRequestSchema = new mongoose.Schema(
  {
    requestNumber: {
      type: String,
      required: true,
      unique: true,
    },
    requestType: {
      type: String,
      required: true,
      enum: ["ADD", "EDIT"],
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: function () {
        return this.requestType === "EDIT";
      },
    },
    details: {
      code: String,
      name: { type: String, required: true },
      category: { type: String, required: true },
      // Shelf position, e.g. "A-1". Optional for the same reason it is on the
      // product itself — see models/Product.js.
      rackNumber: { type: String, default: "", trim: true, uppercase: true },
      quantity: { type: Number, required: true, default: 0 },
      unit: { type: String, required: true },
      minStock: { type: Number, required: true, default: 5 },
      maxStock: { type: Number, required: true, default: 100 },
      // Named rather than referenced, because the request records what the
      // supervisor asked for. Any active room is allowed: pinning an enum here
      // meant a renamed or newly added room could not be requested at all.
      storeRoom: { type: String, required: true, trim: true },
      description: String,
      image: String,
    },
    status: {
      type: String,
      required: true,
      enum: ["Pending", "Approved", "Rejected", "Cancelled"],
      default: "Pending",
    },
    adminComments: {
      type: String,
      default: "",
    },
    supervisor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const ProductRequest = mongoose.model("ProductRequest", productRequestSchema);
export default ProductRequest;
