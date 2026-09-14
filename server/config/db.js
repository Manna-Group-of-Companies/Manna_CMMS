import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

/**
 * Connects to MongoDB, if there is one to connect to.
 *
 * No longer fatal when it is absent. MongoDB is being removed: everything that
 * has moved onto ERPNext — signing in, the catalog, stock — needs no database
 * here at all, and refusing to start without one would mean the migrated half
 * of the system could not run until the half being retired was configured.
 *
 * Returns whether a connection was made, so the boot sequence can skip the
 * steps that only make sense with one.
 */
const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.log("MONGO_URI is not set - running against ERPNext only.");
    return false;
  }

  try {
    await mongoose.connect(mongoUri);
    console.log("MongoDB Connected");
    return true;
  } catch (error) {
    // Still not fatal, but loud. An install that expects a database and cannot
    // reach it is a real fault, and the routes that need one will fail; the
    // ones that do not should keep serving rather than the whole store going
    // dark because a database it is being weaned off is unreachable.
    console.error("MongoDB Connection Error:", error.message);
    console.error("Continuing without it - MongoDB-backed routes will fail.");
    return false;
  }
};

export default connectDB;
