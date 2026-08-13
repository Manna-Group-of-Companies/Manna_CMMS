import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_LOCAL_URI = "mongodb://127.0.0.1:27017/stockmaster";

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI || DEFAULT_LOCAL_URI;

  try {
    await mongoose.connect(mongoUri);
    console.log("MongoDB Connected");
  } catch (error) {
    console.error("MongoDB Connection Error:", error.message);
    process.exit(1);
  }
};

export default connectDB;