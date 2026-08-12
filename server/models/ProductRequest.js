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
      brand: { type: String, required: true },
      supplier: { type: String, required: true },
      quantity: { type: Number, required: true, default: 0 },
      unit: { type: String, required: true },
      minStock: { type: Number, required: true, default: 5 },
      maxStock: { type: Number, required: true, default: 100 },
      storeRoom: { type: String, required: true, enum: ["Store Room 1", "Store Room 2"] },
      description: String,
      image: String,
    },
    status: {
      type: String,
      required: true,
      enum: ["Pending", "Approved", "Rejected"],
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
