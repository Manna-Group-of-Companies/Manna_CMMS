import mongoose from "mongoose";
import bcrypt from "bcryptjs";

/** Every PIN is exactly this many digits. */
export const PIN_LENGTH = 4;

const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);

/** True when [value] can be used as a PIN. */
export const isValidPin = (value) => PIN_PATTERN.test(String(value ?? ""));

/**
 * Builds a case-insensitive exact-match query for a name, so "store
 * supervisor" signs the same account in as "Store Supervisor".
 */
export const nameMatcher = (name) =>
  new RegExp(`^${String(name ?? "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

const userSchema = new mongoose.Schema(
  {
    // The login identifier, so it has to be unique. Matching is
    // case-insensitive; see nameMatcher.
    name: {
      type: String,
      required: [true, "Name is required"],
      unique: true,
      trim: true,
    },
    // Contact detail only — accounts sign in with their name and PIN.
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
    },
    // A 4-digit PIN, hashed like a password. Never selected by default so it
    // cannot leak through a stray .find(); login asks for it explicitly.
    pin: {
      type: String,
      select: false,
      default: null,
    },
    role: {
      type: String,
      required: [true, "Role is required"],
      enum: ["Admin", "Supervisor", "Branch"],
    },
    // A Branch account is tied to exactly one room: it sees that room's stock
    // and nothing else. Admin and Supervisor accounts leave this null, since
    // they work across every room.
    stockRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StockRoom",
      default: null,
      required: [
        function () {
          return this.role === "Branch";
        },
        "A Branch user must be assigned a stock room",
      ],
    },
  },
  {
    timestamps: true,
  }
);

// Hash the PIN before saving, exactly as the password used to be. A null PIN
// (an account an admin has not issued one for yet) is left alone.
userSchema.pre("save", async function () {
  if (!this.isModified("pin") || !this.pin) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.pin = await bcrypt.hash(this.pin, salt);
});

/** False for an account with no PIN issued, so it can never sign in. */
userSchema.methods.matchPin = async function (enteredPin) {
  if (!this.pin || !enteredPin) return false;
  return await bcrypt.compare(String(enteredPin), this.pin);
};

const User = mongoose.model("User", userSchema);
export default User;
