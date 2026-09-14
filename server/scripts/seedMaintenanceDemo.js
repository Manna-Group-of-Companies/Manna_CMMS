import dotenv from "dotenv";

import {
  callMethod,
  createDoc,
  deleteDoc,
  docExists,
  getDoc,
  listDocs,
  updateDoc,
} from "../integrations/erpnext/client.js";
import { erpHasCredentials } from "../integrations/erpnext/config.js";
import { ERP_COMPANY, STORES } from "../integrations/erpnext/stores.js";

dotenv.config();

/**
 * Plants, logins and enough demonstration data to walk the breakdown workflow
 * end to end in the web dashboard.
 *
 *   node scripts/seedMaintenanceDemo.js
 *
 * Safe to run again. Machines and breakdowns are only created if the plant has
 * none, so a second run does not double the demo data.
 *
 * No passwords are set here. They are issued in ERPNext by whoever administers
 * it, so a credential never passes through this script, a terminal, or a chat.
 */

const log = (...p) => console.log(...p);
const step = (t) => log(`\n=== ${t} ===`);

const PLANTS = [
  { plant_name: "Manna Rubber Products", short_code: "MRP", store: STORES[0].warehouse },
  { plant_name: "Hi-Tech Rubber Industries", short_code: "HTR", store: STORES[1].warehouse },
  { plant_name: "Manna Treads", short_code: "MT", store: STORES[2].warehouse },
];

/**
 * One maintenance manager across every plant, and a manager per plant.
 *
 * That asymmetry is the point: maintenance is a shared function and production
 * is not, so a plant manager sees only their own site while maintenance sees
 * all three.
 */
const PEOPLE = [
  {
    email: "maintenance@mannarubber.com",
    first: "Maintenance",
    last: "Manager",
    roles: ["Store Maintenance Manager", "Stock Manager", "Stock User"],
    plant: null, // every plant
  },
  {
    email: "plant.mrp@mannarubber.com",
    first: "Plant Manager",
    last: "(Manna Rubber Products)",
    roles: ["Plant Manager"],
    plant: "Manna Rubber Products",
  },
  {
    email: "plant.hitech@mannarubber.com",
    first: "Plant Manager",
    last: "(Hi-Tech Rubber Industries)",
    roles: ["Plant Manager"],
    plant: "Hi-Tech Rubber Industries",
  },
  {
    email: "plant.treads@mannarubber.com",
    first: "Plant Manager",
    last: "(Manna Treads)",
    roles: ["Plant Manager"],
    plant: "Manna Treads",
  },
];

/** The MRPPL fleet, as given. Codes match the survey forms already printed. */
/**
 * The demo fleet: prefix, type, how many, area, criticality, output per hour,
 * the unit that output is counted in, statutory inspection.
 *
 * The rate used to be rupees per hour. It is now what the machine makes in an
 * hour - kilos through the size-reduction and refining line, finished pieces
 * off the presses - which is the same change the real machine records took.
 * The presses are counted in Nos on purpose: it is what makes the report's
 * per-unit totals worth having, since a run that mixed kg and Nos into one
 * number would be meaningless.
 */
const FLEET = [
  ["CRK", "Cracker Mill", 1, "Size Reduction", "A - Critical", 900, "Kg", true],
  ["GRD", "Grinder (Nylon Tyre)", 3, "Size Reduction", "B - Important", 320, "Kg", false],
  ["AUT", "Autoclave / Digester", 2, "Devulcanising", "A - Critical", 1100, "Kg", true],
  ["PRF", "Pre-Refiner Mill", 2, "Refining", "B - Important", 450, "Kg", false],
  ["REF", "Refiner Mill", 4, "Refining", "B - Important", 400, "Kg", false],
  ["PRT", "Press - Thermic Fluid Heated", 6, "Moulding", "B - Important", 24, "Nos", false],
  ["PRE", "Press - Electric Coil Heated", 5, "Moulding", "C - Ordinary", 14, "Nos", false],
];

/**
 * The actions that lead to each state, in order.
 *
 * A record cannot be created already Assessed - the workflow refuses it, which
 * is the workflow doing its job. So a demonstration record is reported like any
 * other and then walked forward through the same transitions a person would
 * use, which also proves each one works.
 */
const PATH_TO = {
  Reported: [],
  Assessed: ["Assess"],
  Planned: ["Assess", "Plan"],
  "Under Repair": ["Assess", "Plan", "Start Repair"],
  Repaired: ["Assess", "Plan", "Start Repair", "Machine Running"],
};

const hoursAgo = (h) => {
  const d = new Date(Date.now() - h * 3600_000);
  return d.toISOString().slice(0, 19).replace("T", " ");
};

/**
 * Four breakdowns, one at each stage, so every screen has something in it and
 * every workflow transition can be exercised without inventing data first.
 */
const DEMO = [
  {
    // Nobody has looked at it yet. This is what the Plant Manager's report
    // looks like on its own: five fields and no guesses.
    machine: "MRP-AUT-01",
    workflow_state: "Reported",
    stopped_at: hoursAgo(3),
    what_happened:
      "Steam not holding pressure. Door seal hissing on the left side. A batch is inside.",
    production_stopped: 1,
    reported_by: "plant.mrp@mannarubber.com",
  },
  {
    machine: "MRP-REF-02",
    workflow_state: "Assessed",
    stopped_at: hoursAgo(28),
    what_happened: "Mill stopped with a loud noise from the drive end. Smell of burning.",
    production_stopped: 1,
    reported_by: "plant.mrp@mannarubber.com",
    priority: "High",
    likely_cause: "Drive-end bearing seized. Probably lubrication - it was noisy for a week.",
    estimated_repair_hours: 8,
    assessed_by: "maintenance@mannarubber.com",
    assessed_at: hoursAgo(26),
    spares_required: [
      { description: "Spherical roller bearing 22320", qty_required: 2, qty_in_store: 0, needs_ordering: 1 },
      { description: "Drive belt B-98", qty_required: 4, qty_in_store: 6, needs_ordering: 0 },
    ],
  },
  {
    machine: "MRP-PRT-03",
    workflow_state: "Planned",
    stopped_at: hoursAgo(50),
    what_happened: "Platen not reaching temperature. Cycle aborting on the operator panel.",
    production_stopped: 0,
    reported_by: "plant.mrp@mannarubber.com",
    priority: "Medium",
    likely_cause: "Thermic fluid circulation - suspect the pump or a blocked line.",
    estimated_repair_hours: 12,
    assessed_by: "maintenance@mannarubber.com",
    assessed_at: hoursAgo(47),
    assigned_to: "maintenance@mannarubber.com",
    target_completion: hoursAgo(-24),
    planned_at: hoursAgo(45),
    spares_required: [
      { description: "Thermic fluid circulation pump seal kit", qty_required: 1, qty_in_store: 0, needs_ordering: 1 },
    ],
  },
  {
    // Repaired but not closed, so the Manager has something waiting: the check
    // that prevention was actually recorded rather than skipped.
    machine: "MRP-GRD-01",
    workflow_state: "Repaired",
    stopped_at: hoursAgo(120),
    what_happened: "Grinder tripping on overload. Dust extraction also weak.",
    production_stopped: 1,
    reported_by: "plant.mrp@mannarubber.com",
    priority: "High",
    likely_cause: "Choked dust line loading the motor.",
    estimated_repair_hours: 6,
    assessed_by: "maintenance@mannarubber.com",
    assessed_at: hoursAgo(118),
    assigned_to: "maintenance@mannarubber.com",
    target_completion: hoursAgo(110),
    planned_at: hoursAgo(117),
    actions_performed:
      "Cleared the dust line, replaced the cyclone gasket, checked motor current on load.",
    completed_at: hoursAgo(108),
    root_cause:
      "Dust line had never been on any cleaning schedule, so it choked gradually until the motor overloaded.",
    prevention_actions: [
      {
        action_type: "Change inspection / checklist",
        description: "Add weekly dust line and cyclone check to the grinder checklist.",
        owner_user: "maintenance@mannarubber.com",
      },
      {
        action_type: "Raise minimum stock",
        description: "Hold 2 cyclone gaskets. There were none and it cost half a shift.",
        owner_user: "maintenance@mannarubber.com",
      },
    ],
  },
];

const main = async () => {
  if (!erpHasCredentials()) {
    console.error("ERPNext credentials are not set.");
    process.exit(1);
  }

  // --- plants -----------------------------------------------------------
  step("Plants");
  for (const p of PLANTS) {
    if (await docExists("CMMS Plant", p.plant_name)) {
      log(`  = ${p.plant_name}`);
      continue;
    }
    await createDoc("CMMS Plant", {
      doctype: "CMMS Plant",
      plant_name: p.plant_name,
      short_code: p.short_code,
      company: ERP_COMPANY,
      store_warehouse: p.store,
      is_active: 1,
    });
    log(`  + ${p.plant_name}`);
  }

  // --- logins -----------------------------------------------------------
  step("Logins");
  for (const person of PEOPLE) {
    const exists = await docExists("User", person.email);
    if (!exists) {
      await createDoc("User", {
        doctype: "User",
        email: person.email,
        first_name: person.first,
        last_name: person.last,
        user_type: "System User",
        enabled: 1,
        send_welcome_email: 0,
        roles: person.roles.map((role) => ({ doctype: "Has Role", role })),
      });
      log(`  + ${person.email}  (${person.roles.join(", ")})`);
    } else {
      const user = await getDoc("User", person.email);
      const held = (user.roles || []).map((r) => r.role);
      const missing = person.roles.filter((r) => !held.includes(r));
      if (missing.length) {
        await updateDoc("User", person.email, {
          roles: [...held, ...missing].map((role) => ({ role })),
        });
        log(`  ~ ${person.email}  added ${missing.join(", ")}`);
      } else {
        log(`  = ${person.email}`);
      }
    }

    // A plant manager sees only their own plant. Done with a User Permission
    // rather than in application code, so it holds in the ERPNext desk too and
    // cannot be bypassed by calling the API directly.
    if (person.plant) {
      const existing = await listDocs("User Permission", {
        fields: ["name"],
        filters: [
          ["User Permission", "user", "=", person.email],
          ["User Permission", "allow", "=", "CMMS Plant"],
          ["User Permission", "for_value", "=", person.plant],
        ],
        limit: 1,
      });
      if (existing.length === 0) {
        await createDoc("User Permission", {
          doctype: "User Permission",
          user: person.email,
          allow: "CMMS Plant",
          for_value: person.plant,
          apply_to_all_doctypes: 1,
        });
        log(`      restricted to ${person.plant}`);
      }
    }
  }

  // --- machines ---------------------------------------------------------
  step("Machines (Manna Rubber Products)");
  const plant = "Manna Rubber Products";
  const already = await listDocs("CMMS Machine", {
    fields: ["name"],
    filters: [["CMMS Machine", "plant", "=", plant]],
    limit: 1,
  });

  if (already.length > 0) {
    log("  = machines already registered for this plant - skipping");
  } else {
    let n = 0;
    for (const [prefix, label, count, area, criticality, rate, uom, statutory] of FLEET) {
      for (let i = 1; i <= count; i += 1) {
        await createDoc("CMMS Machine", {
          doctype: "CMMS Machine",
          machine_code: `MRP-${prefix}-${String(i).padStart(2, "0")}`,
          machine_name: `${label} ${i}`,
          plant,
          machine_type: label,
          area,
          criticality,
          status: "Running",
          shifts_per_day: 2,
          running_hours_per_day: 16,
          output_per_hour: rate,
          output_uom: uom,
          stops_whole_plant: prefix === "CRK" ? 1 : 0,
          standby_available: count > 1 ? 1 : 0,
          needs_power: 1,
          needs_steam: prefix === "AUT" ? 1 : 0,
          needs_thermic_fluid: prefix === "PRT" ? 1 : 0,
          needs_compressed_air: prefix === "PRT" || prefix === "PRE" ? 1 : 0,
          needs_cooling_water: prefix === "REF" || prefix === "PRF" ? 1 : 0,
          statutory_inspection: statutory ? 1 : 0,
          maintained_by: "In-house",
          notes: "Seeded for demonstration. Replace with the surveyed data.",
        });
        n += 1;
      }
    }
    log(`  + ${n} machines`);
  }

  // --- demonstration breakdowns ----------------------------------------
  step("Breakdowns");
  const seeded = await listDocs("CMMS Breakdown", { fields: ["name"], limit: 1 });
  if (seeded.length > 0) {
    log("  = breakdowns already exist - skipping so a re-run does not double them");
  } else {
    for (const { workflow_state: target, ...fields } of DEMO) {
      // Reported first, carrying everything. The later-stage fields are
      // harmless on a Reported record and save a round trip per stage.
      const created = await createDoc("CMMS Breakdown", {
        doctype: "CMMS Breakdown",
        ...fields,
      });

      for (const action of PATH_TO[target]) {
        const current = await getDoc("CMMS Breakdown", created.name);
        await callMethod("frappe.model.workflow.apply_workflow", {
          doc: current,
          action,
        });
      }

      const final = await getDoc("CMMS Breakdown", created.name);
      const spares = (fields.spares_required || []).length;
      const actions = (fields.prevention_actions || []).length;
      log(
        `  + ${final.name}  ${fields.machine.padEnd(11)} ${String(final.workflow_state).padEnd(12)}` +
          `${spares ? spares + " spare(s) " : ""}${actions ? actions + " prevention" : ""}`
      );
      if (final.workflow_state !== target) {
        log(`      ! wanted ${target}, ended at ${final.workflow_state}`);
      }
    }
  }

  step("Done");
  log("Set each new account's password in ERPNext: User list > the account > New Password.");
};

main().catch((error) => {
  console.error("\nSeeding failed:", error.message);
  process.exit(1);
});
