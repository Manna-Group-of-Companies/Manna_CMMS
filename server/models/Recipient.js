import mongoose from "mongoose";

/**
 * Somebody stock can be issued to.
 *
 * The recipient used to be typed into the issue form by hand, so the same
 * person or firm arrived spelled a different way each time and the issue
 * history could not be grouped by who took the stock. The Admin enters them
 * here instead and the issue form picks from the list.
 *
 * The name is still what gets written onto the issue — `IssueHistory.recipient`
 * is a string, and every issue raised before this list existed carries a name
 * that was never a record. Nothing here rewrites those.
 */
const recipientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Recipient name is required"],
      unique: true,
      trim: true,
    },
    // Which half of the picker it appears under. Nothing else reads it: a
    // recipient is a name, and this only says whose name it is.
    type: {
      type: String,
      enum: ["Our Company", "Outside Company"],
      default: "Our Company",
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    // Retired recipients stay in the database. Their name is on issues that
    // have already happened, and dropping the record would not take it off
    // them — it would only stop anyone reading why it is no longer offered.
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

/** The two groups, in the order the picker shows them. */
recipientSchema.statics.TYPES = ["Our Company", "Outside Company"];

const Recipient = mongoose.model("Recipient", recipientSchema);
export default Recipient;
