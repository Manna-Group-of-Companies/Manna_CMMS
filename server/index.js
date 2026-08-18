import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import { assertJwtSecret } from "./config/jwt.js";
import seedData from "./utils/seeder.js";
import {
  migrateRedStockStatuses,
  startWeeklyMergeScheduler,
} from "./utils/weeklyMerge.js";
import { settleParkedSupervisorMerges } from "./utils/mergeApply.js";

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
import stockRoomRoutes from "./routes/stockRoomRoutes.js";
import branchRequestRoutes from "./routes/branchRequestRoutes.js";
import disposalRoutes from "./routes/disposalRoutes.js";

dotenv.config();

const app = express();

// Render (and any other reverse proxy) puts the real caller in
// X-Forwarded-For. Without this every request arrives as the balancer's own
// address, so the login throttle would count the whole site as one client and
// lock everybody out together.
app.set("trust proxy", 1);

// Configure CORS - allow the deployed client plus local dev servers.
// Extra origins can be added at deploy time via CORS_ORIGINS (comma separated).
const allowedOrigins = [
  "https://mannagroupcmms.pages.dev", // Cloudflare Pages (production client)
  "http://localhost:5173", // vite dev
  "http://localhost:4173", // vite preview
  ...(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
];

// Cloudflare Pages publishes every branch and commit to its own generated
// subdomain of the project (`<commit>.mannagroupcmms.pages.dev`). Those are the
// same client against the same API, but the hostname is not known ahead of
// time, so the project's preview subdomains are matched rather than listed.
// Anchored, and only the label itself is a wildcard — nothing outside the
// project's own domain can satisfy it.
const PAGES_PREVIEW = /^https:\/\/[a-z0-9-]+\.mannagroupcmms\.pages\.dev$/;

const isAllowedOrigin = (origin) =>
  allowedOrigins.includes(origin) || PAGES_PREVIEW.test(origin);

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without an Origin header (mobile app, curl, server-to-server)
      // aren't subject to CORS, so let them through.
      if (!origin || isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
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
app.use("/api/red-stock", restockRoutes);
// The Red Stock Room was called Restock; the old path still works.
app.use("/api/restock", restockRoutes);
app.use("/api/merge-requests", mergeRoutes);
app.use("/api/movements", movementRoutes);
app.use("/api/stock-rooms", stockRoomRoutes);
app.use("/api/branch-requests", branchRequestRoutes);
// Consumption and scrap logs, and the scrap value report.
app.use("/api/disposals", disposalRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date() });
});

// Turn CORS rejections into a plain 403 instead of a 500 with a stack trace.
app.use((err, req, res, next) => {
  if (err && err.message?.startsWith("Origin not allowed by CORS")) {
    return res.status(403).json({ message: err.message });
  }
  return next(err);
});

const PORT = process.env.PORT || 5000;

const start = async () => {
  try {
    // Before anything else: a missing signing key would let anyone mint a token
    // for any account, so refuse to come up rather than serve with a hole.
    assertJwtSecret();

    await connectDB();

    // Seed initial data (users & products) if DB is empty
    await seedData();

    // Bring any pre-Red-Stock records onto the current status vocabulary
    await migrateRedStockStatuses();

    // A supervisor merge is theirs to make, so any that an older build left
    // waiting on an Admin are applied now — that stock is out of Red Stock and
    // countable nowhere until it reaches a store room.
    await settleParkedSupervisorMerges();

    // Raises one merge request per week over whatever is in Red Stock
    startWeeklyMergeScheduler();

    const server = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

    // The mobile app re-reads the API every 10 seconds over a pooled, kept-
    // alive connection. Node hangs up an idle socket after 5 seconds by
    // default, so the phone writes its next request into a socket the server
    // has already closed and gets no answer at all — the request hangs until
    // the client gives up ("No response from ..."), then repeats on the next
    // poll. Outliving the poll interval keeps the socket usable.
    // headersTimeout must stay above keepAliveTimeout, or it closes first.
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 70_000;
  } catch (error) {
    console.error("Server Error:", error.message);
    process.exit(1);
  }
};

start();

