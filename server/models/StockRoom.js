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

/**
 * The rooms every install starts with, in display order (ST-33).
 *
 * The first is the group's main store: a supervisor's merge goes there when
 * nobody names a room, and the seeded Branch account is scoped to it.
 *
 * More can be added at runtime and nothing here has to change for that — this
 * list only says what a fresh database is given.
 */
stockRoomSchema.statics.DEFAULT_ROOMS = [
  "Manna Rubber Products",
  "Hi-Tech Rubber Industries",
  "Manna Treads",
  "Consumables Room",
];

/**
 * Rooms that have been renamed, old name → new. The room record is renamed in
 * place on boot and every copy of the old name held elsewhere is rewritten;
 * see `renameStockRooms` in utils/stockRooms.js.
 *
 * Applied in order, so a chain works: a database still on "Store Room 1" is
 * carried to "Engineer Room" by the first entry and on to "Manna Rubber Park"
 * by the third. Old entries therefore stay even once no install can still be
 * holding that name.
 */
stockRoomSchema.statics.RENAMED_ROOMS = [
  ["Store Room 1", "Engineer Room"],
  ["Store Room 2", "Consumables Room"],
  ["Engineer Room", "Manna Rubber Park"],
  // The park is the site; the store belongs to the company on it, and there
  // are three of those now. Its stock follows the name.
  ["Manna Rubber Park", "Manna Rubber Products"],
];

const StockRoom = mongoose.model("StockRoom", stockRoomSchema);
export default StockRoom;
