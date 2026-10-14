import { registerDevice, removeDevice } from "../repository/devices.js";

/**
 * The phones that get push notifications - see integrations/push.js.
 *
 * A phone registers its Firebase token after signing in and whenever Firebase
 * hands it a new one, and withdraws it on sign-out. Whose phone it is comes
 * from the session, never the body.
 */

/**
 * @desc    Register (or refresh) this phone for push notifications
 * @route   PUT /api/devices
 * @access  Private
 */
export const register = async (req, res) => {
  const { token, platform, appVersion } = req.body || {};
  if (!String(token || "").trim()) {
    return res.status(400).json({ message: "A push token is required" });
  }
  try {
    await registerDevice({
      token: String(token).trim(),
      user: req.user.email,
      role: req.user.role,
      platform: String(platform || ""),
      appVersion: String(appVersion || ""),
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("Could not register the device:", error.message);
    res.status(500).json({ message: "Could not register this phone for notifications" });
  }
};

/**
 * @desc    Withdraw this phone, on sign-out
 * @route   DELETE /api/devices/:token
 * @access  Private
 */
export const unregister = async (req, res) => {
  try {
    const removed = await removeDevice(req.params.token);
    res.json({ ok: true, removed });
  } catch (error) {
    console.error("Could not unregister the device:", error.message);
    res.status(500).json({ message: "Could not withdraw this phone" });
  }
};
