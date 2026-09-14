import {
  createDoc,
  deleteDoc,
  getDoc,
  listAll,
  updateDoc,
} from "../integrations/erpnext/client.js";
import { FREQUENCIES } from "../integrations/erpnext/preventiveDoctypes.js";

/**
 * Preventive maintenance checklists.
 *
 * The inspections that stop a breakdown happening. One list per machine per
 * frequency, edited here and printed for the floor — see preventiveDoctypes.js
 * for why the sheet is paper and the content is not.
 *
 * Everything lives in ERPNext. There is no MongoDB behind any of this.
 */

export { FREQUENCIES };

const LIST_FIELDS = [
  "name",
  "title",
  "machine",
  "machine_name",
  "electrical_system",
  "system_name",
  "plant",
  "area",
  "frequency",
  "responsibility",
  "estimated_minutes",
  "is_active",
  "revision",
  "effective_from",
  "modified",
];

/** Where a frequency sits in the order a maintenance department says them. */
const FREQUENCY_RANK = Object.fromEntries(FREQUENCIES.map((f, i) => [f, i]));

const toSummary = (row) => ({
  id: row.name,
  title: row.title,
  machine: row.machine || "",
  machineName: row.machine_name || row.machine || "",
  electricalSystem: row.electrical_system || "",
  systemName: row.system_name || row.electrical_system || "",
  /**
   * What the checklist is *for*, whichever kind of asset that is.
   *
   * Every screen wants a name to put in a column, and none of them should have
   * to know that two different links can supply it.
   */
  assetKind: row.electrical_system ? "electrical" : "machine",
  asset: row.electrical_system || row.machine || "",
  assetName:
    row.electrical_system
      ? row.system_name || row.electrical_system
      : row.machine_name || row.machine || "",
  plant: row.plant || "",
  area: row.area || "",
  frequency: row.frequency || "",
  responsibility: row.responsibility || "",
  estimatedMinutes: Number(row.estimated_minutes || 0),
  isActive: Boolean(row.is_active),
  revision: row.revision || "1",
  effectiveFrom: row.effective_from || null,
  updatedAt: row.modified,
});

/**
 * A point as the screens see it: what to check, and how.
 *
 * `section` and `acceptance` are no longer read or written. The columns are
 * still on the DocType in ERPNext and still hold what was entered - dropping a
 * column drops its data, and 62 checklists have values in these - so they are
 * simply not part of the application's surface any more. Nothing writes them,
 * so they will not drift; if they are ever wanted back, the data is there.
 */
const toPoint = (row) => ({
  id: row.name,
  idx: row.idx,
  point: row.point || "",
  howToCheck: row.how_to_check || "",
  isSafety: Boolean(row.is_safety),
});

/**
 * The checklists, in frequency order within each machine.
 *
 * Sorted here rather than by ERPNext, which would order a Select alphabetically
 * and put Daily after Annual. The order matters more than usual on this screen:
 * somebody reading a machine's coverage is asking "what is missing", and an
 * alphabetical list makes a gap much harder to see.
 */
export const listChecklists = async ({
  plant = "",
  onlyPlants = null,
  machine = "",
  electricalSystem = "",
  frequency = "",
  includeInactive = false,
  search = "",
} = {}) => {
  const filters = [];
  if (plant) filters.push(["CMMS Checklist", "plant", "=", plant]);
  // The confinement the reader cannot lift, alongside the picker they can. An
  // empty list means no plants rather than every plant, exactly as it does on
  // the register and the breakdown list.
  if (onlyPlants) {
    filters.push(["CMMS Checklist", "plant", "in", onlyPlants.length ? onlyPlants : ["__none__"]]);
  }
  if (machine) filters.push(["CMMS Checklist", "machine", "=", machine]);
  if (electricalSystem) {
    filters.push(["CMMS Checklist", "electrical_system", "=", electricalSystem]);
  }
  if (frequency) filters.push(["CMMS Checklist", "frequency", "=", frequency]);
  if (!includeInactive) filters.push(["CMMS Checklist", "is_active", "=", 1]);

  const rows = await listAll("CMMS Checklist", {
    fields: LIST_FIELDS,
    filters: filters.length ? filters : undefined,
    orderBy: "machine asc",
  });

  const lists = rows.map(toSummary).sort((a, b) => {
    if (a.assetName !== b.assetName) return a.assetName.localeCompare(b.assetName);
    return (FREQUENCY_RANK[a.frequency] ?? 99) - (FREQUENCY_RANK[b.frequency] ?? 99);
  });

  const term = String(search).trim().toLowerCase();
  if (!term) return lists;

  return lists.filter((c) =>
    // `area` was searchable here. It is no longer shown anywhere, and a search
    // that matches on an invisible field returns results nobody can explain.
    [c.title, c.asset, c.assetName, c.frequency].some((v) =>
      String(v).toLowerCase().includes(term)
    )
  );
};

/** One checklist in full, with its points in printed order. */
export const getChecklist = async (id) => {
  const doc = await getDoc("CMMS Checklist", id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) return null;

  return {
    ...toSummary(doc),
    safetyNote: doc.safety_note || "",
    notes: doc.notes || "",
    points: (doc.points || []).map(toPoint).sort((a, b) => (a.idx || 0) - (b.idx || 0)),
  };
};

/** Points, normalised for ERPNext's child table. */
const toPointRows = (points = []) =>
  (points || [])
    .filter((p) => String(p.point || "").trim())
    .map((p) => ({
      doctype: "CMMS Checklist Point",
      point: String(p.point).trim(),
      how_to_check: String(p.howToCheck || p.how_to_check || "").trim(),
      is_safety: p.isSafety || p.is_safety ? 1 : 0,
    }));

/** Everything the add and edit forms write, other than the points. */
const toDoc = (input = {}) => {
  const doc = {};
  const copy = {
    title: "title",
    machine: "machine",
    electricalSystem: "electrical_system",
    plant: "plant",
    frequency: "frequency",
    responsibility: "responsibility",
    estimatedMinutes: "estimated_minutes",
    safetyNote: "safety_note",
    notes: "notes",
    revision: "revision",
    effectiveFrom: "effective_from",
  };
  for (const [from, to] of Object.entries(copy)) {
    if (input[from] !== undefined) doc[to] = input[from];
  }
  if (input.isActive !== undefined) doc.is_active = input.isActive ? 1 : 0;
  return doc;
};

/**
 * Which asset a checklist belongs to, and the plant that puts it in.
 *
 * Exactly one of the two links, enforced here because Frappe cannot say "one
 * of these but not both" — and the plant read off whichever it is, because it
 * is no longer fetched by ERPNext and a checklist without one falls out of
 * every plant-filtered view, including the one confining a plant head to their
 * own site.
 */
const resolveAsset = async ({ machine = "", electricalSystem = "" }) => {
  if (machine && electricalSystem) {
    throw new Error("A checklist belongs to a machine or an electrical system, not both");
  }
  if (!machine && !electricalSystem) {
    throw new Error("Choose the machine or electrical system this checklist is for");
  }

  const doctype = machine ? "CMMS Machine" : "CMMS Electrical System";
  const parent = await getDoc(doctype, machine || electricalSystem).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!parent) throw new Error(`No such ${machine ? "machine" : "electrical system"}`);

  return { machine, electricalSystem, plant: parent.plant || "" };
};

/** Adds a checklist. */
export const createChecklist = async (input = {}) => {
  if (!input.frequency) throw new Error("Choose how often it is done");
  if (!FREQUENCIES.includes(input.frequency)) {
    throw new Error(`"${input.frequency}" is not one of the frequencies this system uses`);
  }

  const asset = await resolveAsset(input);

  const created = await createDoc("CMMS Checklist", {
    doctype: "CMMS Checklist",
    ...toDoc({ ...input, ...asset }),
    // Named after the machine and the frequency where nobody typed a title,
    // which is what everybody would have typed anyway.
    title: String(input.title || "").trim() || `${input.frequency} check`,
    is_active: input.isActive === false ? 0 : 1,
    revision: String(input.revision || "1"),
    points: toPointRows(input.points),
  });

  return getChecklist(created.name);
};

/**
 * Edits a checklist.
 *
 * Changing the points bumps the revision, unless the caller set one. That is
 * not bookkeeping for its own sake: a signed sheet in a file has a revision
 * printed in its footer, and if the revision never moves there is no way to
 * tell which list somebody was actually working from. An auditor asks that
 * question first.
 *
 * The bump is numeric where the existing revision is a number and left alone
 * where somebody has used their own scheme ("Rev C"), because guessing at
 * somebody else's numbering is worse than leaving it.
 */
export const updateChecklist = async (id, input = {}) => {
  const existing = await getDoc("CMMS Checklist", id);
  const doc = toDoc(input);
  // The asset and the frequency are what the checklist *is*. Changing either
  // turns it into a different list, and doing that by editing hides the change
  // from anybody holding a printed copy — make a new one instead.
  delete doc.machine;
  delete doc.electrical_system;
  delete doc.plant;
  delete doc.frequency;

  if (input.points !== undefined) {
    doc.points = toPointRows(input.points);

    if (input.revision === undefined) {
      const current = String(existing.revision || "1");
      if (/^\d+$/.test(current)) doc.revision = String(Number(current) + 1);
    }
  }

  if (Object.keys(doc).length) await updateDoc("CMMS Checklist", id, doc);
  return getChecklist(id);
};

/**
 * Appends one point to a checklist.
 *
 * Its own operation rather than a full-form save, because this is the thing the
 * maintenance manager does most: a breakdown gets closed, its prevention action
 * says "check the coupling bolts weekly", and that point has to reach the
 * weekly sheet before anybody forgets. Two clicks, from wherever they are.
 */
export const addChecklistPoint = async (id, point = {}) => {
  if (!String(point.point || "").trim()) throw new Error("Say what to check");

  const existing = await getDoc("CMMS Checklist", id);
  const points = [...(existing.points || []), ...toPointRows([point])];

  await updateDoc("CMMS Checklist", id, {
    points,
    ...(/^\d+$/.test(String(existing.revision || "1"))
      ? { revision: String(Number(existing.revision || 1) + 1) }
      : {}),
  });
  return getChecklist(id);
};

/**
 * Copies a checklist onto another machine.
 *
 * The only realistic way a plant ever gets a full set. Three of the mills are
 * the same mill, and typing the same fourteen points three times is how the
 * third one ends up with eleven of them.
 */
export const copyChecklist = async (
  id,
  { machine = "", electricalSystem = "", title = "", frequency = "" } = {}
) => {
  const source = await getDoc("CMMS Checklist", id);

  const sameAsset =
    (machine && machine === source.machine) ||
    (electricalSystem && electricalSystem === source.electrical_system);
  if (sameAsset && (!frequency || frequency === source.frequency)) {
    throw new Error("That is the asset it is already on. Choose another.");
  }

  const asset = await resolveAsset({ machine, electricalSystem });

  const created = await createDoc("CMMS Checklist", {
    doctype: "CMMS Checklist",
    title: String(title).trim() || source.title,
    machine: asset.machine,
    electrical_system: asset.electricalSystem,
    plant: asset.plant,
    frequency: frequency || source.frequency,
    responsibility: source.responsibility || "",
    estimated_minutes: source.estimated_minutes || 0,
    safety_note: source.safety_note || "",
    notes: source.notes || "",
    is_active: 1,
    // A copy starts at revision 1. Carrying the source's revision across would
    // claim a history this list does not have.
    revision: "1",
    points: (source.points || []).map((p) => ({
      doctype: "CMMS Checklist Point",
      point: p.point,
      how_to_check: p.how_to_check || "",
      is_safety: p.is_safety ? 1 : 0,
    })),
  });

  return getChecklist(created.name);
};

/**
 * Retires a checklist.
 *
 * Deleted outright rather than deactivated only when it has no points — an
 * empty list somebody created by mistake is clutter, but one with points in it
 * has been worked on and may have been printed, so it is switched off instead
 * and stays readable.
 */
export const removeChecklist = async (id) => {
  const doc = await getDoc("CMMS Checklist", id);
  if ((doc.points || []).length > 0) {
    await updateDoc("CMMS Checklist", id, { is_active: 0 });
    return { deleted: false, deactivated: true };
  }
  await deleteDoc("CMMS Checklist", id);
  return { deleted: true, deactivated: false };
};

/**
 * Which machines have which frequencies covered.
 *
 * The screen that answers "is there a checklist for every machine", which was
 * the whole ask. A list of the checklists that exist cannot answer it — the
 * useful information is the empty cells.
 */
export const coverage = async ({ plant = "", onlyPlants = null } = {}) => {
  const confined = onlyPlants
    ? [["plant", "in", onlyPlants.length ? onlyPlants : ["__none__"]]]
    : [];

  const [machines, checklists] = await Promise.all([
    listAll("CMMS Machine", {
      fields: ["name", "machine_name", "plant", "area", "criticality", "status"],
      filters: [
        ...(plant ? [["CMMS Machine", "plant", "=", plant]] : []),
        ...confined.map(([f, op, v]) => ["CMMS Machine", f, op, v]),
        // A retired machine needs no inspection, and counting it as a gap would
        // make the coverage figure permanently unreachable.
        ["CMMS Machine", "status", "!=", "Retired"],
      ],
      orderBy: "name asc",
    }),
    listAll("CMMS Checklist", {
      fields: ["name", "machine", "frequency", "title", "is_active"],
      filters: [
        ["CMMS Checklist", "is_active", "=", 1],
        // Machines only. The grid has a row per machine, so an electrical
        // checklist has nowhere to land in it — and counting it would inflate
        // the coverage figure with sheets that cover no machine at all.
        ["CMMS Checklist", "machine", "!=", ""],
        ...(plant ? [["CMMS Checklist", "plant", "=", plant]] : []),
        ...confined.map(([f, op, v]) => ["CMMS Checklist", f, op, v]),
      ],
    }),
  ]);

  const byMachine = new Map();
  for (const c of checklists) {
    if (!byMachine.has(c.machine)) byMachine.set(c.machine, []);
    byMachine.get(c.machine).push(c);
  }

  const rows = machines.map((m) => {
    const held = byMachine.get(m.name) || [];
    const have = new Set(held.map((c) => c.frequency));
    return {
      machine: m.name,
      machineName: m.machine_name || m.name,
      plant: m.plant,
      area: m.area || "",
      criticality: m.criticality || "",
      checklists: held.map((c) => ({ id: c.name, frequency: c.frequency, title: c.title })),
      frequencies: Object.fromEntries(
        FREQUENCIES.map((freq) => [
          freq,
          held.find((c) => c.frequency === freq)?.name || null,
        ])
      ),
      // Not "how many of the six", because not every machine needs all six. A
      // hand pump with a yearly list is covered; a critical press with only a
      // yearly list is not. The screen decides what to make of it — this only
      // reports what is there.
      count: have.size,
    };
  });

  return {
    frequencies: FREQUENCIES,
    machines: rows,
    totals: {
      machines: rows.length,
      withAny: rows.filter((r) => r.count > 0).length,
      withNone: rows.filter((r) => r.count === 0).length,
      // The ones that matter most and have nothing, which is the line anybody
      // reading this screen should act on first.
      criticalWithNone: rows.filter((r) => r.count === 0 && r.criticality?.startsWith("A")).length,
      checklists: checklists.length,
    },
  };
};

/** One machine's checklists, for its page in the asset register. */
export const checklistsForMachine = async (machine) => {
  const rows = await listAll("CMMS Checklist", {
    fields: LIST_FIELDS,
    filters: [["CMMS Checklist", "machine", "=", machine]],
  });

  return rows
    .map(toSummary)
    .sort((a, b) => (FREQUENCY_RANK[a.frequency] ?? 99) - (FREQUENCY_RANK[b.frequency] ?? 99));
};

/** One electrical system's checklists, for its page in the portfolio. */
export const checklistsForElectricalSystem = async (system) => {
  const rows = await listAll("CMMS Checklist", {
    fields: LIST_FIELDS,
    filters: [["CMMS Checklist", "electrical_system", "=", system]],
  });

  return rows
    .map(toSummary)
    .sort((a, b) => (FREQUENCY_RANK[a.frequency] ?? 99) - (FREQUENCY_RANK[b.frequency] ?? 99));
};
