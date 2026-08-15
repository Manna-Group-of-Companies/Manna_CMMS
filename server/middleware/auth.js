import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { jwtSecret } from "../config/jwt.js";

export const protect = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret());

    // Get user from the token. The PIN is select:false, so it stays out.
    req.user = await User.findById(decoded.id);

    if (!req.user) {
      return res.status(401).json({ message: "Not authorized, user not found" });
    }

    return next();
  } catch (error) {
    // An unset secret is a server fault, not a bad token — saying "token
    // failed" would send everyone chasing their login instead of the config.
    if (error.name !== "JsonWebTokenError" && error.name !== "TokenExpiredError") {
      console.error("Auth misconfiguration:", error.message);
      return res.status(500).json({ message: "Authentication is misconfigured on the server" });
    }

    return res.status(401).json({ message: "Not authorized, token failed" });
  }
};

// Grant access to specific roles
export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Role (${req.user ? req.user.role : "none"}) is not allowed to access this resource`,
      });
    }
    next();
  };
};
