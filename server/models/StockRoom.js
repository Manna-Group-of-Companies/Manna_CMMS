import mongoose from "mongoose";

/**
 * A physical storage location.
 *
 * Rooms used to be a two-value enum on the product. They are real records now
 * so a product can hold stock in more than one room at a time, and so new
 * rooms can be added without a schema change.
 */
const stockRoomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Stock room name is required"],
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    // Retired rooms stay in the database so historical inventory rows and
    // approved requests still resolve to a name.
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

/** The rooms every install starts with, in display order. */
stockRoomSchema.statics.DEFAULT_ROOMS = ["Engineer Room", "Consumables Room"];

/**
 * Rooms that have been renamed, old name → new. The room record is renamed in
 * place on boot and every copy of the old name held elsewhere is rewritten;
 * see `renameStockRooms` in utils/stockRooms.js.
 */
stockRoomSchema.statics.RENAMED_ROOMS = [
  ["Store Room 1", "Engineer Room"],
  ["Store Room 2", "Consumables Room"],
];

const StockRoom = mongoose.model("StockRoom", stockRoomSchema);
export default StockRoom;
