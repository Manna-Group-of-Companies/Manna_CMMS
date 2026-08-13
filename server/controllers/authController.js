import User from "../models/User.js";
import jwt from "jsonwebtoken";

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || "default_jwt_secret_key_12345", {
    expiresIn: "30d",
  });
};

/**
 * The user as the client keeps it. A Branch account carries its room, because
 * every screen it can reach is scoped to that one room.
 */
const publicUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  stockRoom: user.stockRoom
    ? { _id: user.stockRoom._id, name: user.stockRoom.name }
    : null,
});

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public (or Admin only, let's make it Public for initial setup, but verify role creation)
export const registerUser = async (req, res) => {
  const { name, email, password, role, stockRoom } = req.body;

  try {
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    if (role === "Branch" && !stockRoom) {
      return res
        .status(400)
        .json({ message: "A Branch user must be assigned a stock room" });
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role || "Supervisor", // Defaults to Supervisor
      // Only a Branch account is pinned to a room.
      stockRoom: role === "Branch" ? stockRoom : null,
    });

    if (user) {
      res.status(201).json({
        ...publicUser(await user.populate("stockRoom", "name")),
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: "Invalid user data" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email }).populate("stockRoom", "name");

    if (user && (await user.matchPassword(password))) {
      res.json({
        ...publicUser(user),
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: "Invalid email or password" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user profile
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("-password")
      .populate("stockRoom", "name");
    if (user) {
      res.json(publicUser(user));
    } else {
      res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
