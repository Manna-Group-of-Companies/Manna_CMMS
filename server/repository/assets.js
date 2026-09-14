import { createDoc, getDoc, listAll, updateDoc } from "../integrations/erpnext/client.js";
import { attach, attachmentCounts, detach, listAttachments } from "./attachments.js";

/**
 * The asset register: the machines themselves.
 *
 * The same `CMMS Machine` records Module 2 raises breakdowns against. There is
 * deliberately no second "asset" doctype - a machine that breaks down and a
 * machine on the register are the same object, and keeping two would guarantee
 * they disagreed about which press is which.
 *
 * What this adds over Module 2's picker is everything about the machine that
 * is not needed to report a fault: what it is, who made it, what it needs, and
 * the drawings and manuals that came with it.
 */

const FIELDS = [
  "name",
  "machine_code",
  "machine_name",
  "plant",
  "machine_type",
  "area",
  "criticality",
  "status",
  "make",
  "model",
  "serial_no",
  "year_made",
  "capacity",
  "motor_kw",
  "commissioned_on",
  "maintained_by",
  "statutory_inspection",
  "statutory_due_date",
  "modified",
];

/** The utilities a machine needs, as one list rather than six checkboxes. */
const UTILITIES = [
  ["needs_power", "Power"],
  ["needs_steam", "Steam"],
  ["needs_thermic_fluid", "Thermic fluid"],
  ["needs_compressed_air", "Compressed air"],
  ["needs_cooling_water", "Cooling water"],
];

const toSummary = (row) => ({
  id: row.name,
  code: row.machine_code || row.name,
  name: row.machine_name,
  plant: row.plant,
  type: row.machine_type || "",
  area: row.area || "",
  criticality: row.criticality,
  status: row.status,
  make: row.make || "",
  model: row.model || "",
  serialNo: row.serial_no || "",
  yearMade: row.year_made || null,
  capacity: row.capacity || "",
  motorKw: Number(row.motor_kw || 0),
  commissionedOn: row.commissioned_on || null,
  maintainedBy: row.maintained_by || "",
  statutoryInspection: Boolean(row.statutory_inspection),
  statutoryDueDate: row.statutory_due_date || null,
  updatedAt: row.modified,
});

/**
 * The register, optionally narrowed to one plant.
 *
 * `plant` is the picker on the screen; `onlyPlants` is the confinement the
 * signed-in person cannot lift. Both apply, so a plant head who picks a plant
 * that is not theirs gets nothing rather than somebody else's machines.
 */
export const listAssets = async ({
  plant = "",
  onlyPlants = null,
  status = "",
  search = "",
} = {}) => {
  const filters = [];
  if (plant) filters.push(["CMMS Machine", "plant", "=", plant]);
  // An empty confinement means no plants, not every plant — a plant head whose
  // ERPNext permission is missing must be shown nothing rather than the group.
  if (onlyPlants) {
    filters.push(["CMMS Machine", "plant", "in", onlyPlants.length ? onlyPlants : ["__none__"]]);
  }
  if (status) filters.push(["CMMS Machine", "status", "=", status]);

  const rows = await listAll("CMMS Machine", {
    fields: FIELDS,
    filters: filters.length ? filters : undefined,
    orderBy: "name asc",
  });

  const assets = rows.map(toSummary);

  const term = String(search).trim().toLowerCase();
  if (!term) return assets;

  // Narrowed here rather than as a Frappe filter, because the useful search is
  // across code, name, make, model and serial at once - somebody standing in
  // front of a machine has whichever of those is on the plate.
  return assets.filter((a) =>
    [a.code, a.name, a.make, a.model, a.serialNo, a.type].some((f) =>
      String(f).toLowerCase().includes(term)
    )
  );
};

/** The register with a file count against each machine. */
export const listAssetsWithFiles = async (options) => {
  const assets = await listAssets(options);
  const counts = await attachmentCounts("CMMS Machine", assets.map((a) => a.id));
  return assets.map((a) => ({ ...a, fileCount: counts.get(a.id) || 0 }));
};

/** One machine in full, with everything attached to it. */
export const getAsset = async (id) => {
  const doc = await getDoc("CMMS Machine", id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) return null;

  return {
    ...toSummary(doc),
    shiftsPerDay: doc.shifts_per_day || 0,
    runningHoursPerDay: Number(doc.running_hours_per_day || 0),
    // What the machine makes in an hour, and the unit it is counted in. This
    // replaced a rupee loss rate; see the field comment in maintenanceDoctypes.
    outputPerHour: Number(doc.output_per_hour || 0),
    outputUom: doc.output_uom || "",
    standbyAvailable: Boolean(doc.standby_available),
    stopsWholePlant: Boolean(doc.stops_whole_plant),
    utilities: UTILITIES.filter(([field]) => doc[field]).map(([, label]) => label),
    supplierContact: doc.supplier_contact || "",
    recurringProblems: doc.recurring_problems || "",
    notes: doc.notes || "",
    files: await listAttachments("CMMS Machine", id),
  };
};

/** Everything the add and edit forms write. */
const WRITABLE = {
  code: "machine_code",
  name: "machine_name",
  plant: "plant",
  type: "machine_type",
  area: "area",
  criticality: "criticality",
  status: "status",
  make: "make",
  model: "model",
  serialNo: "serial_no",
  yearMade: "year_made",
  capacity: "capacity",
  motorKw: "motor_kw",
  commissionedOn: "commissioned_on",
  shiftsPerDay: "shifts_per_day",
  runningHoursPerDay: "running_hours_per_day",
  outputPerHour: "output_per_hour",
  outputUom: "output_uom",
  standbyAvailable: "standby_available",
  stopsWholePlant: "stops_whole_plant",
  needsPower: "needs_power",
  needsSteam: "needs_steam",
  needsThermicFluid: "needs_thermic_fluid",
  needsCompressedAir: "needs_compressed_air",
  needsCoolingWater: "needs_cooling_water",
  statutoryInspection: "statutory_inspection",
  statutoryDueDate: "statutory_due_date",
  maintainedBy: "maintained_by",
  supplierContact: "supplier_contact",
  recurringProblems: "recurring_problems",
  notes: "notes",
};

const CHECKS = new Set([
  "standby_available",
  "stops_whole_plant",
  "needs_power",
  "needs_steam",
  "needs_thermic_fluid",
  "needs_compressed_air",
  "needs_cooling_water",
  "statutory_inspection",
]);

const toDoc = (input = {}) => {
  const doc = {};
  for (const [from, to] of Object.entries(WRITABLE)) {
    if (input[from] === undefined) continue;
    doc[to] = CHECKS.has(to) ? (input[from] ? 1 : 0) : input[from];
  }
  return doc;
};

/**
 * Adds a machine to the register.
 *
 * `machine_code` is the name of the record, so it is what everything else
 * refers to. It is asked for rather than generated: the plates on these
 * machines already carry codes the maintenance team uses out loud, and a
 * system that invented its own would leave everybody translating.
 */
export const createAsset = async (input = {}) => {
  const code = String(input.code || "").trim();
  if (!code) throw new Error("A machine code is required");
  if (!String(input.name || "").trim()) throw new Error("A machine name is required");
  if (!input.plant) throw new Error("A plant is required");

  const created = await createDoc("CMMS Machine", {
    doctype: "CMMS Machine",
    ...toDoc(input),
    machine_code: code,
    // Sensible where the form did not ask, rather than letting Frappe pick the
    // first option of a Select and quietly calling every machine critical.
    criticality: input.criticality || "B - Important",
    status: input.status || "Running",
  });

  return getAsset(created.name);
};

/** Edits a machine. */
export const updateAsset = async (id, input = {}) => {
  const doc = toDoc(input);
  // The code names the record; renaming is a different operation in ERPNext
  // and not one a form should do by accident.
  delete doc.machine_code;

  if (Object.keys(doc).length) await updateDoc("CMMS Machine", id, doc);
  return getAsset(id);
};

/** The plants, for the picker. */
export const listPlants = async () => {
  const rows = await listAll("CMMS Plant", {
    fields: ["name", "short_code"],
    orderBy: "name asc",
  });
  return rows.map((p) => ({ name: p.name, code: p.short_code || "" }));
};


/* -------------------------------------------------------- what came with it */

export { MAX_FILE_BYTES } from "./attachments.js";

/** Drawings, manuals, specifications - and now the component document too. */
export const attachToAsset = (id, file) => attach("CMMS Machine", id, file);

/** Removes one attachment. */
export const detachFromAsset = (id, fileId) => detach("CMMS Machine", id, fileId);
