/**
 * The electrical portfolio: system, subsystem, component.
 *
 * Electrical plant is not a machine and does not fit the machine record. A
 * press has a make, a model and a serial number on a plate; an APFC panel is a
 * cabinet with twelve capacitors in it, and asking for "the model" of the whole
 * thing gets a blank or a guess. What it does have is a rating, a location and
 * a list of what is inside it.
 *
 * So three levels rather than two:
 *
 *   Electrical System      one per plant - the supply itself. Sanctioned load,
 *                          contract demand, the statutory licence.
 *   Electrical Subsystem   the APFC panel, the LT panel, the DG set, the
 *                          transformer, the earthing.
 *   Electrical Component   what is inside one - the capacitor steps, the
 *                          contactors, the breakers.
 *
 * Almost nothing is required. The whole reason this exists is that the machine
 * form demanded fields electrical plant does not have, and a form that refuses
 * to save until somebody invents a model number is a form that gets filled in
 * with rubbish.
 */

const PERMISSIONS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
];

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
const link = (fieldname, label, target, extra = {}) =>
  f(fieldname, label, "Link", { options: target, ...extra });
const select = (fieldname, label, options, extra = {}) =>
  f(fieldname, label, "Select", { options: options.join("\n"), ...extra });
const check = (fieldname, label, extra = {}) => f(fieldname, label, "Check", { default: "0", ...extra });

const doc = ({ name, autoname, fields }) => ({
  doctype: "DocType",
  name,
  module: "Custom",
  custom: 1,
  istable: 0,
  track_changes: 1,
  allow_rename: 0,
  naming_rule: "Expression",
  autoname,
  permissions: PERMISSIONS,
  fields,
});

/** The incoming supply, one per plant. */
const SYSTEM = doc({
  name: "CMMS Electrical System",
  autoname: "format:ELEC-{####}",
  fields: [
    link("plant", "Plant", "CMMS Plant", { reqd: 1, in_list_view: 1 }),
    f("system_name", "System", "Data", { reqd: 1, in_list_view: 1 }),

    // --- the supply ---
    select("supply_type", "Supply", ["", "HT", "LT"], { in_list_view: 1 }),
    f("supply_voltage", "Supply Voltage", "Data", { description: "11 kV, 415 V" }),
    f("consumer_number", "Consumer Number", "Data"),
    f("sanctioned_load_kw", "Sanctioned Load (kW)", "Float"),
    f("contract_demand_kva", "Contract Demand (kVA)", "Float"),
    f("connected_load_kw", "Connected Load (kW)", "Float"),
    f("target_power_factor", "Target Power Factor", "Float", { description: "What the board penalises below" }),

    // --- backup and generation ---
    check("has_dg_backup", "Has DG backup"),
    f("dg_capacity_kva", "DG Capacity (kVA)", "Float"),
    check("has_solar", "Has solar"),
    f("solar_capacity_kw", "Solar Capacity (kW)", "Float"),

    /**
     * The statutory side, which is the part that bites.
     *
     * An electrical installation above a threshold needs a certified
     * supervisor and a periodic inspection, and the certificate is what an
     * inspector asks for first.
     */
    f("electrical_supervisor", "Electrical Supervisor", "Data"),
    f("licence_number", "Supervisor Licence No", "Data"),
    f("licence_valid_until", "Licence Valid Until", "Date"),
    f("last_inspection_on", "Last Statutory Inspection", "Date"),
    f("next_inspection_due", "Next Inspection Due", "Date"),

    f("notes", "Notes", "Small Text"),
  ],
});

/** A panel, a transformer, a DG set - a thing within the system. */
const SUBSYSTEM = doc({
  name: "CMMS Electrical Subsystem",
  autoname: "format:ESUB-{#####}",
  fields: [
    link("electrical_system", "Electrical System", "CMMS Electrical System", { reqd: 1, in_list_view: 1 }),
    f("plant", "Plant", "Data", { fetch_from: "electrical_system.plant", read_only: 1, in_list_view: 1 }),
    f("subsystem_name", "Subsystem", "Data", { reqd: 1, in_list_view: 1 }),
    select(
      "subsystem_type",
      "Type",
      ["", "APFC Panel", "Capacitor Bank", "Main LT Panel", "HT Panel / VCB", "Transformer",
       "DG Set", "MCC / Motor Control Centre", "Distribution Board", "Cable Network",
       "Earthing System", "Lighting", "UPS / Inverter", "Solar PV", "Other"],
      { in_list_view: 1 }
    ),
    f("location", "Location", "Data", { description: "Substation, press shop, roof" }),
    // Free text on purpose: a transformer is in kVA, a panel in amps, an APFC
    // in kVAr. One number with one unit would fit none of them.
    f("rating", "Rating", "Data", { description: "630 kVA, 400 A, 100 kVAr" }),
    f("make", "Make", "Data"),
    f("model", "Model", "Data"),
    f("serial_no", "Serial No", "Data"),
    f("commissioned_on", "Commissioned On", "Date"),
    select("criticality", "Criticality", ["A - Critical", "B - Important", "C - Ordinary"], { default: "B - Important" }),
    select("status", "Status", ["In service", "Standby", "Faulty", "Removed"], { default: "In service", in_list_view: 1 }),
    f("feeds", "Feeds", "Small Text", { description: "Which machines or areas hang off it" }),
    f("last_inspected_on", "Last Inspected", "Date"),
    f("next_inspection_due", "Next Inspection Due", "Date"),
    f("recurring_problems", "Recurring Problems", "Small Text"),
    f("notes", "Notes", "Small Text"),
  ],
});

/** What is inside a subsystem: the capacitor steps, the breakers, the relays. */
const COMPONENT = doc({
  name: "CMMS Electrical Component",
  autoname: "format:ECMP-{#####}",
  fields: [
    link("subsystem", "Subsystem", "CMMS Electrical Subsystem", { reqd: 1, in_list_view: 1 }),
    f("component_name", "Component", "Data", { reqd: 1, in_list_view: 1 }),
    select(
      "component_type",
      "Type",
      ["", "Capacitor", "Contactor", "Relay", "ACB", "MCCB", "MCB", "Fuse", "Isolator",
       "Meter", "Timer / Controller", "CT / PT", "Busbar", "Cable", "Reactor",
       "Indicator / Lamp", "Cooling Fan", "Other"],
      { in_list_view: 1 }
    ),
    /**
     * Which step of the bank it is.
     *
     * An APFC panel is a numbered sequence of capacitor steps, and "step 4 has
     * failed" is how the fault is actually reported. Without this the twelve
     * capacitors in a panel are indistinguishable.
     */
    f("step_number", "Step / Position", "Data", { in_list_view: 1 }),
    f("rating", "Rating", "Data", { description: "25 kVAr, 63 A, 415 V" }),
    f("quantity", "How Many", "Int", { default: "1" }),
    f("make", "Make", "Data"),
    f("model", "Model", "Data"),
    f("serial_no", "Serial No", "Data"),
    link("spare_item", "Replacement Item", "Item", { description: "The catalog code that fits it" }),
    f("installed_on", "Installed On", "Date"),
    select("status", "Status", ["In service", "Failed", "Removed", "Spare"], { default: "In service", in_list_view: 1 }),
    f("notes", "Notes", "Small Text"),
  ],
});

/** Parents before children: a link target must exist before the link does. */
export const ELECTRICAL_DOCTYPES = [SYSTEM, SUBSYSTEM, COMPONENT];

export const ELECTRICAL_ROLE_PERMS = [
  /**
   * System Manager first, and never omitted.
   *
   * Once ANY Custom DocPerm exists for a DocType, Frappe uses those instead of
   * the permissions on the DocType itself - it does not merge them. Granting
   * the store roles here without naming System Manager therefore revokes it,
   * silently, and the integration account loses the DocType entirely. That is
   * exactly what happened to this one: it read fine until the API key was
   * reissued against an account whose access came only from System Manager.
   */
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: "Store Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: "Store Maintenance Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: "Store Supervisor", read: 1, report: 1 },
  { role: "Plant Manager", read: 1, report: 1 },
];
