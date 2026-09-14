import { getDoc, listAll, updateDoc } from "../integrations/erpnext/client.js";
import { attach, attachmentCounts, detach, listAttachments } from "./attachments.js";

/**
 * The electrical portfolio: one system per plant, and its paperwork.
 *
 * Deliberately not the machine register. Electrical plant has a rating and a
 * location where a machine has a make and a model, and an APFC panel is not one
 * thing that fails — it is twelve capacitor steps, and "step 4 is out" is how
 * the fault gets reported.
 *
 * One system per plant, whether or not anyone has filled it in. An empty system
 * says nobody has recorded the supply yet, which is a finding worth surfacing;
 * no system at all reads as a missing feature.
 *
 * It used to carry subsystems and components — the APFC panel, its capacitor
 * steps. Those are gone: the maintenance team keeps a document describing the
 * installation, and keeping that document current is one job rather than two.
 * A form that competes with a Word file loses, and then neither is trusted. The
 * document is attached here alongside the drawings.
 */

const SYSTEM_FIELDS = [
  "name", "plant", "system_name", "supply_type", "supply_voltage", "consumer_number",
  "sanctioned_load_kw", "contract_demand_kva", "connected_load_kw", "target_power_factor",
  "has_dg_backup", "dg_capacity_kva", "has_solar", "solar_capacity_kw",
  "electrical_supervisor", "licence_number", "licence_valid_until",
  "last_inspection_on", "next_inspection_due", "notes", "modified",
];

const toSystem = (row) => ({
  id: row.name,
  plant: row.plant,
  name: row.system_name,
  supplyType: row.supply_type || "",
  supplyVoltage: row.supply_voltage || "",
  consumerNumber: row.consumer_number || "",
  sanctionedLoadKw: Number(row.sanctioned_load_kw || 0),
  contractDemandKva: Number(row.contract_demand_kva || 0),
  connectedLoadKw: Number(row.connected_load_kw || 0),
  targetPowerFactor: Number(row.target_power_factor || 0),
  hasDgBackup: Boolean(row.has_dg_backup),
  dgCapacityKva: Number(row.dg_capacity_kva || 0),
  hasSolar: Boolean(row.has_solar),
  solarCapacityKw: Number(row.solar_capacity_kw || 0),
  electricalSupervisor: row.electrical_supervisor || "",
  licenceNumber: row.licence_number || "",
  licenceValidUntil: row.licence_valid_until || null,
  lastInspectionOn: row.last_inspection_on || null,
  nextInspectionDue: row.next_inspection_due || null,
  notes: row.notes || "",
  updatedAt: row.modified,
});

/* ------------------------------------------------------------------ system */

/**
 * Every plant's electrical system, with a count of what hangs off it.
 *
 * `onlyPlants` is the caller's own scope, from their ERPNext plant
 * permissions. Applied on top of any `plant` filter they asked for, so
 * narrowing cannot be used to widen.
 */
export const listSystems = async ({ plant = "", onlyPlants = null } = {}) => {
  const filters = [];
  if (plant) filters.push(["CMMS Electrical System", "plant", "=", plant]);
  if (Array.isArray(onlyPlants) && onlyPlants.length) {
    filters.push(["CMMS Electrical System", "plant", "in", onlyPlants]);
  }

  const systems = await listAll("CMMS Electrical System", {
    fields: SYSTEM_FIELDS,
    filters: filters.length ? filters : undefined,
    orderBy: "plant asc",
  });

  const counts = await attachmentCounts("CMMS Electrical System", systems.map((x) => x.name));

  return systems.map((s) => ({
    ...toSystem(s),
    fileCount: counts.get(s.name) || 0,
  }));
};

/** One system in full, with everything attached to it. */
export const getSystem = async (id, { onlyPlants = null } = {}) => {
  const doc = await getDoc("CMMS Electrical System", id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) return null;

  // Checked here as well as in the list. Without it, somebody scoped to one
  // plant could still open another plant's system by its id — the list would
  // hide it, and the URL would not.
  if (Array.isArray(onlyPlants) && onlyPlants.length && !onlyPlants.includes(doc.plant)) {
    return null;
  }

  return {
    ...toSystem(doc),
    files: await listAttachments("CMMS Electrical System", id),
  };
};

const SYSTEM_WRITABLE = {
  name: "system_name",
  supplyType: "supply_type",
  supplyVoltage: "supply_voltage",
  consumerNumber: "consumer_number",
  sanctionedLoadKw: "sanctioned_load_kw",
  contractDemandKva: "contract_demand_kva",
  connectedLoadKw: "connected_load_kw",
  targetPowerFactor: "target_power_factor",
  hasDgBackup: "has_dg_backup",
  dgCapacityKva: "dg_capacity_kva",
  hasSolar: "has_solar",
  solarCapacityKw: "solar_capacity_kw",
  electricalSupervisor: "electrical_supervisor",
  licenceNumber: "licence_number",
  licenceValidUntil: "licence_valid_until",
  lastInspectionOn: "last_inspection_on",
  nextInspectionDue: "next_inspection_due",
  notes: "notes",
};

const CHECKS = new Set(["has_dg_backup", "has_solar"]);

const mapFields = (input, table) => {
  const out = {};
  for (const [from, to] of Object.entries(table)) {
    if (input[from] === undefined) continue;
    out[to] = CHECKS.has(to) ? (input[from] ? 1 : 0) : input[from];
  }
  return out;
};

export const updateSystem = async (id, input = {}) => {
  const fields = mapFields(input, SYSTEM_WRITABLE);
  if (Object.keys(fields).length) await updateDoc("CMMS Electrical System", id, fields);
  return getSystem(id);
};

/* ------------------------------------------------------------- attachments */

export { MAX_FILE_BYTES } from "./attachments.js";

/** The installation document, drawings, single-line diagrams, test reports. */
export const attachToSystem = (id, file) => attach("CMMS Electrical System", id, file);

/** Removes one. */
export const detachFromSystem = (id, fileId) => detach("CMMS Electrical System", id, fileId);
