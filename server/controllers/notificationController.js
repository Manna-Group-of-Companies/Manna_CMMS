import Notification from "../models/Notification.js";

// @desc    Get user notifications
// @route   GET /api/notifications
// @access  Private
export const getNotifications = async (req, res) => {
  try {
    let query = {};

    if (req.user.role === "Supervisor") {
      // Supervisor only sees their own notifications
      query.user = req.user._id;
    } else {
      // Admin sees notifications where user is null (admin notifications) OR specifically for them
      query = {
        $or: [{ user: { $exists: false } }, { user: null }, { user: req.user._id }],
      };
    }

    const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(50);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
export const markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    // Verify security (Supervisor can only mark their own notification as read)
    if (req.user.role === "Supervisor" && notification.user && notification.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to read this notification" });
    }

    notification.read = true;
    await notification.save();

    res.json({ message: "Notification marked as read", notification });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark all user notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
export const markAllNotificationsRead = async (req, res) => {
  try {
    let query = {};

    if (req.user.role === "Supervisor") {
      query.user = req.user._id;
    } else {
      query = {
        $or: [{ user: { $exists: false } }, { user: null }, { user: req.user._id }],
      };
    }

    await Notification.updateMany(query, { read: true });
    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
