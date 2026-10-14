import { createDoc, getDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { TRADES } from "../integrations/erpnext/technicianDoctype.js";

/**
 * The maintenance team register.
 *
 * Kept by the Maintenance Manager, and the only source of names the "Repaired
 * by" rows offer. See `technicianDoctype.js` for why this is not ERPNext's
 * Employee.
 */

const DOCTYPE = "CMMS Technician";

const badRequest = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const shape = (doc) => ({
  id: doc.name,
  name: doc.technician_name || doc.name,
  trade: doc.trade || "",
  user: doc.user || "",
  active: Number(doc.is_active) === 1,
  resignedOn: doc.resigned_on || null,
});

/**
 * Everyone on the register, those still here first.
 *
 * Resigned people are returned rather than filtered out, because the screen
 * that keeps the register has to show them - it is where somebody is brought
 * back. Callers that only want who can be picked today ask for `activeOnly`.
 */
export const listTechnicians = async ({ activeOnly = false } = {}) => {
  const rows = await listDocs(DOCTYPE, {
    fields: ["name", "technician_name", "trade", "user", "is_active", "resigned_on"],
    filters: activeOnly ? [[DOCTYPE, "is_active", "=", 1]] : [],
    orderBy: "technician_name asc",
    limit: 500,
  });
  const all = rows.map(shape);
  return activeOnly ? all : [...all].sort((a, b) => Number(b.active) - Number(a.active));
};

export const addTechnician = async ({ name, trade = "", user = "" } = {}) => {
  const technicianName = String(name || "").trim();
  if (!technicianName) throw badRequest("Enter the name.");
  if (technicianName.length > 140) throw badRequest("That name is too long.");
  if (trade && !TRADES.includes(trade)) throw badRequest(`Trade must be one of: ${TRADES.join(", ")}.`);

  /**
   * Checked here as well as by the unique field, because Frappe's own answer to
   * a duplicate is a wall of traceback with the useful sentence buried in it.
   * The race this leaves is harmless: the unique field still refuses the second
   * write, and the two would be the same person anyway.
   */
  const clash = await listDocs(DOCTYPE, {
    fields: ["name", "is_active"],
    filters: [[DOCTYPE, "technician_name", "=", technicianName]],
    limit: 1,
  });
  if (clash.length) {
    throw badRequest(
      Number(clash[0].is_active) === 1
        ? `${technicianName} is already on the register.`
        : `${technicianName} is on the register as having left - bring them back instead of adding them again.`
    );
  }

  const created = await createDoc(DOCTYPE, {
    doctype: DOCTYPE,
    technician_name: technicianName,
    trade,
    user,
    is_active: 1,
  });
  return shape(created);
};

/**
 * Resigning and bringing back.
 *
 * Never a delete: a breakdown from last March names whoever repaired it, and
 * that has to go on reading correctly afterwards. Resigning only takes the name
 * out of what the crew rows offer from now on.
 */
export const setTechnicianActive = async (id, active, { resignedOn = "" } = {}) => {
  const doc = await getDoc(DOCTYPE, id);
  if (!doc) throw badRequest("That person is not on the register.");

  const updated = await updateDoc(DOCTYPE, id, {
    is_active: active ? 1 : 0,
    // Cleared on return, so somebody brought back does not read as still gone.
    resigned_on: active ? "" : resignedOn || new Date().toISOString().slice(0, 10),
  });
  return shape(updated);
};

export const updateTechnician = async (id, { trade, user } = {}) => {
  if (trade !== undefined && trade && !TRADES.includes(trade)) {
    throw badRequest(`Trade must be one of: ${TRADES.join(", ")}.`);
  }
  const edits = {};
  if (trade !== undefined) edits.trade = trade;
  if (user !== undefined) edits.user = user;
  if (Object.keys(edits).length === 0) return shape(await getDoc(DOCTYPE, id));
  return shape(await updateDoc(DOCTYPE, id, edits));
};
