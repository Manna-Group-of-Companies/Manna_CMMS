/**
 * CMMS unit → ERPNext UOM.
 *
 * The unit is free text in both clients — the web form is a plain input and
 * the tablet only hints "Pcs, Box, Kg" — so the catalog holds whatever people
 * typed, in whatever case, singular or plural.
 *
 * It has to be translated rather than passed through, because the CMMS default
 * is "Pcs" and **ERPNext has no such UOM**. Its countable unit is "Nos". Left
 * alone, every item in the catalog would be rejected on creation.
 */

/** Everything that means "a countable thing". */
const NOS = ["pcs", "pc", "pce", "piece", "pieces", "nos", "no", "nr", "num", "number", "numbers", "each", "ea", "qty", "quantity"];

/**
 * Spelling → the exact ERPNext UOM name.
 *
 * Only UOMs confirmed to exist in the instance are targets here. "Unit" is
 * kept apart from "Nos" although both exist: somebody who wrote "unit" may
 * have meant an assembly, and quietly folding it into a piece count would be a
 * guess dressed up as a translation.
 */
const MAP = new Map([
  ...NOS.map((key) => [key, "Nos"]),
  ...["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"].map((k) => [k, "Kg"]),
  ...["g", "gm", "gms", "gram", "grams"].map((k) => [k, "Gram"]),
  ...["l", "ltr", "ltrs", "lt", "litre", "litres", "liter", "liters"].map((k) => [k, "Litre"]),
  ...["m", "mtr", "mtrs", "meter", "meters", "metre", "metres"].map((k) => [k, "Meter"]),
  // The store measures a few things in centimetres. Without this they fell
  // through to Nos, which counts a length as a number of pieces.
  ...["cm", "cms", "centimeter", "centimeters", "centimetre", "centimetres"].map((k) => [k, "Centimeter"]),
  ...["packet", "packets", "pkt", "pkts"].map((k) => [k, "Packet"]),
  ...["box", "boxes", "bx"].map((k) => [k, "Box"]),
  ...["set", "sets"].map((k) => [k, "Set"]),
  ...["pair", "pairs", "pr"].map((k) => [k, "Pair"]),
  ...["roll", "rolls"].map((k) => [k, "Roll"]),
  ...["unit", "units"].map((k) => [k, "Unit"]),
]);

/** What an unrecognised unit becomes. */
export const DEFAULT_UOM = "Nos";

/**
 * Resolves one unit.
 *
 * `exact` is false when nothing matched and the default was used. The caller
 * reports those rather than swallowing them: a drum of grease counted in "Nos"
 * is not wrong enough to fail on, but it is wrong enough that somebody should
 * see it before four thousand items are created.
 */
export const resolveUom = (unit) => {
  const raw = String(unit ?? "").trim();
  if (!raw) return { uom: DEFAULT_UOM, exact: false, input: raw };

  // Trailing punctuation is common in typed-in units ("Pcs.", "Kg,").
  const key = raw.toLowerCase().replace(/[.,;:]+$/, "").trim();

  const mapped = MAP.get(key);
  if (mapped) return { uom: mapped, exact: true, input: raw };

  return { uom: DEFAULT_UOM, exact: false, input: raw };
};

/** Groups a catalog's units into what will be sent and what was guessed. */
export const summariseUoms = (units) => {
  const resolved = new Map();
  const guessed = new Map();

  for (const unit of units) {
    const { uom, exact, input } = resolveUom(unit);
    resolved.set(input, uom);
    if (!exact) guessed.set(input || "(blank)", uom);
  }

  return { resolved, guessed };
};
