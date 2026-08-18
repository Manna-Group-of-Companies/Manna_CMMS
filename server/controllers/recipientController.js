import Recipient from "../models/Recipient.js";
import IssueHistory from "../models/IssueHistory.js";

/** Matches a name exactly but ignoring case, so "ABC Traders" cannot be added twice. */
const sameName = (name) => ({
  name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
});

/**
 * @desc    The recipients an issue can be made out to
 * @route   GET /api/recipients?all=true
 * @access  Private (any signed-in user — the issue form needs it)
 *
 * Active only by default, which is what a picker wants. `all=true` includes the
 * retired ones, for the Admin's own list.
 */
export const getRecipients = async (req, res) => {
  try {
    const query = req.query.all === "true" ? {} : { isActive: true };
    // Grouped the way the picker reads: our own names first, then outside.
    const recipients = await Recipient.find(query).sort({ type: 1, name: 1 });
    res.json(recipients);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Add a recipient
 * @route   POST /api/recipients
 * @access  Private (Admin)
 */
export const createRecipient = async (req, res) => {
  const { name, type, description } = req.body || {};

  try {
    const trimmed = (name || "").trim();
    if (!trimmed) {
      return res.status(400).json({ message: "A recipient name is required" });
    }

    const existing = await Recipient.findOne(sameName(trimmed));
    if (existing) {
      // Retired and added again: bring the original back rather than opening a
      // second record under the same name, which the unique index would refuse.
      if (!existing.isActive) {
        existing.isActive = true;
        if (type) existing.type = type;
        await existing.save();
        return res.status(200).json({
          message: `"${existing.name}" is back on the list`,
          recipient: existing,
        });
      }
      return res.status(409).json({ message: `"${existing.name}" is already on the list` });
    }

    const recipient = await Recipient.create({
      name: trimmed,
      type: Recipient.TYPES.includes(type) ? type : Recipient.TYPES[0],
      description: (description || "").trim(),
    });

    res.status(201).json({ message: `"${recipient.name}" added`, recipient });
  } catch (error) {
    console.error("Error creating recipient:", error);
    res.status(400).json({ message: error.message });
  }
};

/**
 * @desc    Rename a recipient, move it between the two groups, or retire it
 * @route   PUT /api/recipients/:id
 * @access  Private (Admin)
 *
 * A rename does not follow the name onto issues already raised: those record
 * who took the stock at the time, and rewriting them would rewrite history.
 */
export const updateRecipient = async (req, res) => {
  const { name, type, description, isActive } = req.body || {};

  try {
    const recipient = await Recipient.findById(req.params.id);
    if (!recipient) {
      return res.status(404).json({ message: "Recipient not found" });
    }

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        return res.status(400).json({ message: "A recipient name is required" });
      }

      const clash = await Recipient.findOne({
        ...sameName(trimmed),
        _id: { $ne: recipient._id },
      });
      if (clash) {
        return res.status(409).json({ message: `"${clash.name}" is already on the list` });
      }

      recipient.name = trimmed;
    }

    if (type !== undefined && Recipient.TYPES.includes(type)) recipient.type = type;
    if (description !== undefined) recipient.description = String(description).trim();
    if (isActive !== undefined) recipient.isActive = Boolean(isActive);

    await recipient.save();
    res.json({ message: `"${recipient.name}" saved`, recipient });
  } catch (error) {
    console.error("Error updating recipient:", error);
    res.status(400).json({ message: error.message });
  }
};

/**
 * @desc    Take a recipient off the list
 * @route   DELETE /api/recipients/:id
 * @access  Private (Admin)
 *
 * One that has never been issued to is deleted outright. One that has is
 * retired instead: its name is on issues that have already happened, and the
 * Admin's list is where anyone would look to find out why it stopped being
 * offered.
 */
export const deleteRecipient = async (req, res) => {
  try {
    const recipient = await Recipient.findById(req.params.id);
    if (!recipient) {
      return res.status(404).json({ message: "Recipient not found" });
    }

    const issued = await IssueHistory.countDocuments(sameName(recipient.name));

    if (issued > 0) {
      recipient.isActive = false;
      await recipient.save();
      return res.json({
        message:
          `"${recipient.name}" is on ${issued} issue(s), so it was retired rather than ` +
          `deleted. It is no longer offered when issuing stock.`,
        recipient,
      });
    }

    await recipient.deleteOne();
    res.json({ message: `"${recipient.name}" removed`, recipient });
  } catch (error) {
    console.error("Error deleting recipient:", error);
    res.status(400).json({ message: error.message });
  }
};
