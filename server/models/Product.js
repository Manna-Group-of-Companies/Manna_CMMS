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
    brand: {
      type: String,
      required: [true, "Brand is required"],
      trim: true,
    },
    supplier: {
      type: String,
      required: [true, "Supplier is required"],
      trim: true,
    },
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
    storeRoom: {
      type: String,
      required: [true, "Store Room is required"],
      enum: ["Store Room 1", "Store Room 2"],
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
