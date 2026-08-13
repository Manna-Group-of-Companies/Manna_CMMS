import User from "../models/User.js";
import Product from "../models/Product.js";
import StockRoom from "../models/StockRoom.js";
import { ensureDefaultRooms, migrateProductsIntoRooms, renameStockRooms } from "./stockRooms.js";

/** The room the seeded Branch account is pointed at. */
const BRANCH_ROOM = StockRoom.DEFAULT_ROOMS[0];

/**
 * Creates the default Branch login if it is missing.
 *
 * Kept out of the "empty database" block below: the Branch role arrived after
 * these installs already had users, so a count check would never run it.
 */
const seedBranchUser = async () => {
  const existing = await User.findOne({ email: "branch@stock.com" });
  if (existing) return;

  const room = await StockRoom.findOne({ name: BRANCH_ROOM });
  if (!room) {
    console.warn(`Branch user not seeded: stock room "${BRANCH_ROOM}" is missing.`);
    return;
  }

  await User.create({
    name: `${room.name} Branch`,
    email: "branch@stock.com",
    password: "Branch@123", // Pre-save hook will hash this
    role: "Branch",
    stockRoom: room._id,
  });

  console.log(`Default Branch user seeded (branch@stock.com → ${room.name}).`);
};

const seedData = async () => {
  try {
    // 0. Stock rooms must exist before any product can be placed in one.
    //    Renames run first, or a renamed room would be recreated under its old
    //    name and the stock would end up split between the two.
    await renameStockRooms();
    await ensureDefaultRooms();

    // 1. Seed Users
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log("Seeding default users...");
      
      // Admin user
      await User.create({
        name: "System Admin",
        email: "admin@stock.com",
        password: "Admin@123", // Pre-saved hook will hash this
        role: "Admin",
      });

      // Supervisor user
      await User.create({
        name: "Store Supervisor",
        email: "supervisor@stock.com",
        password: "Supervisor@123",
        role: "Supervisor",
      });

      console.log("Default users seeded successfully (Admin and Supervisor).");
    }

    // 1b. The Branch login, room-scoped and read-only.
    await seedBranchUser();

    // 2. Seed Products
    const productCount = await Product.countDocuments();
    if (productCount === 0) {
      console.log("Seeding initial products...");

      const initialProducts = [
        {
          code: "PRD-203847",
          name: "Wireless Logitech Mouse MX Master 3S",
          category: "Electronics",
          brand: "Logitech",
          supplier: "LogiTech Solutions Inc.",
          quantity: 45,
          unit: "Pcs",
          minStock: 10,
          maxStock: 150,
          storeRoom: "Engineer Room",
          description: "High-performance wireless productivity mouse with ergonomic shape and MagSpeed scrolling.",
          image: "https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
        },
        {
          code: "PRD-593021",
          name: "Dell UltraSharp 27 Monitor (U2723QE)",
          category: "Electronics",
          brand: "Dell",
          supplier: "Dell Enterprise Services",
          quantity: 8,
          unit: "Pcs",
          minStock: 5,
          maxStock: 30,
          storeRoom: "Engineer Room",
          description: "27-inch 4K USB-C Hub Monitor with IPS Black technology and high contrast ratio.",
          image: "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
        },
        {
          code: "PRD-102948",
          name: "Steelcase Gesture Ergonomic Chair",
          category: "Furniture",
          brand: "Steelcase",
          supplier: "Steelcase Furniture Ltd.",
          quantity: 3, // Low Stock! (minStock is 5)
          unit: "Pcs",
          minStock: 5,
          maxStock: 25,
          storeRoom: "Consumables Room",
          description: "Premium ergonomic office chair with highly adjustable armrests and back support.",
          image: "https://images.unsplash.com/photo-1505797149-43b0069ec26b?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
        },
        {
          code: "PRD-884029",
          name: "Apple MacBook Pro 16-inch M3 Max",
          category: "Electronics",
          brand: "Apple",
          supplier: "Apple Authorized Distributor",
          quantity: 12,
          unit: "Pcs",
          minStock: 4,
          maxStock: 50,
          storeRoom: "Engineer Room",
          description: "Space black MacBook Pro with M3 Max chip, 36GB unified memory, and 1TB SSD storage.",
          image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
        },
        {
          code: "PRD-473920",
          name: "LED Desk Lamp with Wireless Charger",
          category: "Electronics",
          brand: "Anker",
          supplier: "Anker Tech Distribution",
          quantity: 75,
          unit: "Pcs",
          minStock: 15,
          maxStock: 200,
          storeRoom: "Consumables Room",
          description: "Flexible LED desk lamp with multiple color temperatures and integrated Qi wireless charging pad.",
          image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
        },
      ];

      await Product.insertMany(initialProducts);
      console.log("Initial products seeded successfully.");
    }

    // 3. Give every product a per-room balance. Products that predate stock
    // rooms get their whole quantity placed in their own store room.
    await migrateProductsIntoRooms();
  } catch (error) {
    console.error("Database seeding failed:", error.message);
  }
};

export default seedData;
