import * as sheet from "../repository/lowValuePurchases.js";

/** The Purchase Request Sheet. See repository/lowValuePurchases.js. */

const fail = (res, error, fallback = "Something went wrong") => {
  if ([400, 403, 404].includes(error?.status)) return res.status(error.status).json({ message: error.message });
  if (error?.status === 417) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/** @route GET /api/low-value-purchases?company=&approval=&purchase=&type=&open=1 */
export const list = async (req, res) => {
  try {
    res.json(
      await sheet.listSheet({
        company: req.query.company || "",
        approval: req.query.approval || "",
        purchase: req.query.purchase || "",
        type: req.query.type || "",
        open: ["1", "true"].includes(String(req.query.open || "")),
        limit: Math.min(Number(req.query.limit) || 500, 1000),
        user: req.user,
      })
    );
  } catch (error) {
    fail(res, error, "Could not load the purchase request sheet");
  }
};

/** @route GET /api/low-value-purchases/options - the dropdowns */
export const options = (req, res) => res.json(sheet.sheetOptions());

/** @route GET /api/low-value-purchases/:id */
export const detail = async (req, res) => {
  try {
    res.json(await sheet.getEntry(req.params.id, req.user));
  } catch (error) {
    fail(res, error, "Could not load the request");
  }
};

/** @route POST /api/low-value-purchases - a new row */
export const add = async (req, res) => {
  try {
    res.status(201).json(await sheet.addEntry(req.body, req.user));
  } catch (error) {
    fail(res, error, "Could not add the request");
  }
};

/** @route PUT /api/low-value-purchases/:id - { <column>: value } for the columns being changed */
export const edit = async (req, res) => {
  try {
    res.json(await sheet.editEntry(req.params.id, req.body, req.user));
  } catch (error) {
    fail(res, error, "Could not save the change");
  }
};

/** @route POST /api/low-value-purchases/:id/files - an image of the item */
export const addImage = async (req, res) => {
  try {
    res.status(201).json(await sheet.addImage(req.params.id, req.body || {}, req.user));
  } catch (error) {
    fail(res, error, "Could not attach the image");
  }
};

/** @route DELETE /api/low-value-purchases/:id/files/:fileId */
export const removeImage = async (req, res) => {
  try {
    res.json(await sheet.removeImage(req.params.id, req.params.fileId, req.user));
  } catch (error) {
    fail(res, error, "Could not remove the image");
  }
};
