import * as taxonomy from "../repository/taxonomy.js";
import { readSapTree, renameCategoryValue } from "../repository/sapCategories.js";

/**
 * The SAP three-level tree (item group > Sub-category A > Sub-category B),
 * read from the items. Errors carrying 400/404 are the caller's to fix.
 */
const failSap = (res, error, fallback) => {
  if (error?.status === 400 || error?.status === 404) return res.status(error.status).json({ message: error.message });
  if (error?.status === 403) return res.status(403).json({ message: "Your ERPNext role does not allow that." });
  console.error(`${fallback}:`, error.message);
  return res.status(502).json({ message: `${fallback}: ${error.message}` });
};

/** @route GET /api/taxonomy/sap */
export const sapTree = async (_req, res) => {
  try {
    res.json(await readSapTree());
  } catch (error) {
    failSap(res, error, "Could not read the SAP category tree");
  }
};

/** @route PUT /api/taxonomy/sap/rename  { level: 2|3, category, subCategory?, from, to } */
export const sapRename = async (req, res) => {
  try {
    res.json(await renameCategoryValue(req.body || {}, req.user));
  } catch (error) {
    failSap(res, error, "Could not rename the category");
  }
};

/**
 * The category tree.
 *
 * Reading is open to everyone who browses the catalog. Changing it is not:
 * renaming a category re-points every item under it, and merging two removes
 * one of them, so this is master data rather than a preference.
 */

const fail = (res, error, fallback = "Something went wrong") => {
  if (error?.status === 403) {
    return res.status(403).json({ message: "Your ERPNext role does not allow that." });
  }
  if (!error?.status) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/** @route GET /api/taxonomy */
export const tree = async (_req, res) => {
  try {
    res.json(await taxonomy.readTree());
  } catch (error) {
    fail(res, error, "Could not read the category tree");
  }
};

/** @route POST /api/taxonomy */
export const add = async (req, res) => {
  try {
    res.status(201).json(await taxonomy.addGroup(req.body || {}));
  } catch (error) {
    fail(res, error, "Could not add it");
  }
};

/** @route PUT /api/taxonomy/rename */
export const rename = async (req, res) => {
  try {
    res.json(await taxonomy.renameGroup(req.body || {}));
  } catch (error) {
    fail(res, error, "Could not rename it");
  }
};

/** @route PUT /api/taxonomy/move */
export const move = async (req, res) => {
  try {
    res.json(await taxonomy.moveGroup(req.body || {}));
  } catch (error) {
    fail(res, error, "Could not move it");
  }
};

/** @route DELETE /api/taxonomy/:name */
export const remove = async (req, res) => {
  try {
    res.json(await taxonomy.removeGroup(req.params.name));
  } catch (error) {
    fail(res, error, "Could not remove it");
  }
};
