import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import seedData from "./utils/seeder.js";

// Routes imports
import authRoutes from "./routes/authRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import requestRoutes from "./routes/requestRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import issueRoutes from "./routes/issueRoutes.js";
import restockRoutes from "./routes/restockRoutes.js";
import mergeRoutes from "./routes/mergeRoutes.js";
import movementRoutes from "./routes/movementRoutes.js";

dotenv.config();

const app = express();

// Configure CORS - allow React frontend (typically port 5173)
app.use(
  cors({
    origin: "*", // Or specify exact frontend URLs like http://localhost:5173
    credentials: true,
  })
);

// Product photos taken on the mobile app arrive inline as base64 data URIs,
// which blows past the 100kb express default.
app.use(express.json({ limit: "8mb" }));

// Register API Routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/issues", issueRoutes);
app.use("/api/restock", restockRoutes);
app.use("/api/merge-requests", mergeRoutes);
app.use("/api/movements", movementRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;

const start = async () => {
  try {
    await connectDB();

    // Seed initial data (users & products) if DB is empty
    await seedData();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server Error:", error.message);
    process.exit(1);
  }
};

start();

