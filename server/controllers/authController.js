import User, { PIN_LENGTH, isValidPin, nameMatcher } from "../models/User.js";
import jwt from "jsonwebtoken";
import { jwtSecret } from "../config/jwt.js";
import { recordLoginFailure, recordLoginSuccess } from "../middleware/loginLimit.js";

// Generate JWT Token
const generateToken = (id) => jwt.sign({ id }, jwtSecret(), { expiresIn: "30d" });

/**
 * The user as the client keeps it. A Branch account carries its room, because
 * every screen it can reach is scoped to that one room.
 *
 * The PIN itself never leaves the server; `hasPin` says only whether an admin
 * has issued one, which is what the user list needs to show.
 */
const publicUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  hasPin: Boolean(user.pin),
  stockRoom: user.stockRoom
    ? { _id: user.stockRoom._id, name: user.stockRoom.name }
    : null,
});

// @desc    Create a user
// @route   POST /api/auth/register
// @access  Admin
export const registerUser = async (req, res) => {
  const { name, pin, email, role, stockRoom } = req.body;

  try {
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Name is required" });
    }

    // The name is the login identifier, so a duplicate would make it ambiguous
    // which account a PIN belongs to.
    const nameTaken = await User.findOne({ name: nameMatcher(name) });
    if (nameTaken) {
      return res.status(400).json({ message: "That name is already taken" });
    }

    // A PIN is optional here: an account can be created now and issued its PIN
    // later. It just cannot sign in until then.
    if (pin && !isValidPin(pin)) {
      return res
        .status(400)
        .json({ message: `The PIN must be exactly ${PIN_LENGTH} digits` });
    }

    if (role === "Branch" && !stockRoom) {
      return res
        .status(400)
        .json({ message: "A Branch user must be assigned a stock room" });
    }

    const user = await User.create({
      name: String(name).trim(),
      email: email || "",
      pin: pin || null,
      role: role || "Supervisor", // Defaults to Supervisor
      // Only a Branch account is pinned to a room.
      stockRoom: role === "Branch" ? stockRoom : null,
    });

    res.status(201).json(publicUser(await user.populate("stockRoom", "name")));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req, res) => {
  const { name, pin } = req.body;

  try {
    const user = await User.findOne({ name: nameMatcher(name) })
      .select("+pin")
      .populate("stockRoom", "name");

    // Spelled out rather than folded into the generic failure: an account
    // waiting on its PIN is an admin task, not a typo the user can fix.
    if (user && !user.pin) {
      return res.status(403).json({
        message: "No PIN has been set for this account yet. Ask an admin to issue one.",
      });
    }

    if (user && (await user.matchPin(pin))) {
      recordLoginSuccess(req);
      res.json({
        ...publicUser(user),
        token: generateToken(user._id),
      });
    } else {
      // Counted here rather than in the middleware: only the handler knows
      // whether the PIN actually matched.
      recordLoginFailure(req);
      res.status(401).json({ message: "Invalid name or PIN" });
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
      .select("+pin")
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

// @desc    Every account, so an admin can see who still needs a PIN
// @route   GET /api/auth/users
// @access  Admin
export const listUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select("+pin")
      .populate("stockRoom", "name")
      .sort({ role: 1, name: 1 });
    res.json(users.map(publicUser));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Remove an account
// @route   DELETE /api/auth/users/:id
// @access  Admin
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Deleting the account you are signed in as would end the session mid-way
    // through the work, and there is no way to undo it afterwards.
    if (String(user._id) === String(req.user._id)) {
      return res
        .status(400)
        .json({ message: "You cannot delete the account you are signed in as" });
    }

    // The last Admin holds the only key to the console: without one, nobody can
    // issue a PIN or add a user ever again.
    if (user.role === "Admin") {
      const admins = await User.countDocuments({ role: "Admin" });
      if (admins <= 1) {
        return res
          .status(400)
          .json({ message: "The last Admin account cannot be deleted" });
      }
    }

    await user.deleteOne();

    res.json({ _id: user._id, message: `${user.name} was removed` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Issue or change an account's PIN
// @route   PUT /api/auth/users/:id/pin
// @access  Admin
export const setUserPin = async (req, res) => {
  const { pin } = req.body;

  try {
    if (!isValidPin(pin)) {
      return res
        .status(400)
        .json({ message: `The PIN must be exactly ${PIN_LENGTH} digits` });
    }

    const user = await User.findById(req.params.id).populate("stockRoom", "name");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Assigned through the document so the pre-save hook hashes it.
    user.pin = String(pin);
    await user.save();

    res.json({
      ...publicUser(user),
      message: `PIN updated for ${user.name}`,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
