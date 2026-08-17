/**
 * SOI1/SOP1 — the Manna Group stock item naming convention (ST-09, ST-10).
 *
 * Two jobs live here, and only here:
 *
 *   1. `composeItemName` builds the standardized Product Name out of the fields
 *      captured during intake, so nobody has to remember the separator rules.
 *   2. `validateItemName` reads a finished name back and reports every rule it
 *      breaks, so a non-compliant entry can be flagged *before* it is saved.
 *
 * This is the single implementation. The admin console and the phone app both
 * call it through `POST /api/products/name-preview` rather than carrying their
 * own copy — a naming rule that drifts between three codebases is worse than
 * one round trip per keystroke.
 *
 * The format, from the standard:
 *
 *   Dimension1-UOM * Dimension2-UOM * Dimension3-UOM _ Rating-UOM _
 *   Item Name _ Type _ Material _ Item Code
 *
 * where `-` means "joined with no separator", `_` means "one space", and `*`
 * separates dimensions from each other. Written out, that is:
 *
 *   50SQMM*10MM Cable Leg Ring Type CU
 *   ¼” 110V Pneumatic Switch BS245SR61
 */

/**
 * Vulgar fractions. The store writes imperial sizes as ¼ and ¾ rather than 1/4,
 * and those are digits as far as every rule below is concerned.
 */
const FRACTIONS = "¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";

/**
 * A *specification* token — a dimension or an electrical rating. It always
 * opens with a number, which is what separates "25MM" from "Bearing".
 */
const SPEC_START = new RegExp(`^[0-9${FRACTIONS}]`);

/** An item code: uppercase alphanumerics, as printed on the part. */
const ITEM_CODE = /^[A-Z0-9][A-Z0-9/.-]*$/;

/**
 * Everything the convention allows to appear in a name. Inch and foot marks
 * are UOMs in their own right, so both the typographic and the typewriter
 * forms are permitted.
 */
const ALLOWED_CHARS = new RegExp(`[^A-Za-z0-9${FRACTIONS}\\s*/.,()"”'’-]`);

const collapse = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Strips every space — dimensions and codes are written closed up. */
const tighten = (value) => String(value ?? "").replace(/\s+/g, "");

/**
 * "All initials are to be in UPPERCASE." Only the first letter of each word is
 * touched: the rest is left exactly as typed so "CU", "SQMM" and part numbers
 * such as "BS245SR61" survive intact.
 */
const capitalizeInitials = (value) =>
  collapse(value)
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

/**
 * Cleans the captured fields into the exact strings that go into the name.
 *
 * Normalising here rather than at validation time means the composed name is
 * correct by construction — the builder cannot produce a lowercase UOM, so the
 * validator never has to reject its own output.
 */
export const normalizeNamingParts = (parts = {}) => {
  const rawDimensions = Array.isArray(parts.dimensions) ? parts.dimensions : [];

  return {
    dimensions: rawDimensions
      .map((dimension) => ({
        value: tighten(dimension?.value),
        // "All UOMs ... shall be in UPPERCASE".
        uom: tighten(dimension?.uom).toUpperCase(),
      }))
      // A UOM with nothing to measure is not a dimension.
      .filter((dimension) => dimension.value),
    electricalRating: tighten(parts.electricalRating),
    electricalUom: tighten(parts.electricalUom).toUpperCase(),
    itemName: capitalizeInitials(parts.itemName),
    type: capitalizeInitials(parts.type),
    // Material of construction, uppercase like the UOMs.
    material: collapse(parts.material).toUpperCase(),
    itemCode: tighten(parts.itemCode).toUpperCase(),
  };
};

/**
 * Builds the standardized name and validates it in one pass.
 *
 * Returns `{ name, naming, compliant, issues }` — `naming` being the cleaned
 * fields, so a caller can store back exactly what the name was built from.
 */
export const composeItemName = (parts = {}) => {
  const naming = normalizeNamingParts(parts);

  // Dimensions are the only fields joined by "*", and only to each other.
  const dimensions = naming.dimensions
    .map((dimension) => `${dimension.value}${dimension.uom}`)
    .join("*");

  const rating = naming.electricalRating
    ? `${naming.electricalRating}${naming.electricalUom}`
    : "";

  // "Only applicable fields shall be included" — every empty one drops out
  // rather than leaving a gap or a dangling separator.
  const name = [dimensions, rating, naming.itemName, naming.type, naming.material, naming.itemCode]
    .filter(Boolean)
    .join(" ");

  return { name, naming, ...validateItemName(name) };
};

/**
 * Checks a finished name against the convention.
 *
 * Returns `{ compliant, issues }`, where each issue carries a stable `code` so
 * the UI can style it, and a `message` written for the person at the counter
 * rather than for a developer.
 *
 * The four rejected examples in the standard each trip at least one rule:
 * "Bearing6205" and "Wire Copper" carry no specification, "motor5hp" glues a
 * spec onto a word and opens lowercase, and "Bolt SS 10mm" puts its dimension
 * after the item name.
 */
export const validateItemName = (rawName) => {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });

  const name = String(rawName ?? "");
  if (!name.trim()) {
    add("EMPTY", "Enter a product name.");
    return { compliant: false, issues };
  }

  // --- whole-string rules: "blank spaces or unnecessary symbols shall not be
  // used", and the separators mean what the standard says they mean.
  if (name !== name.trim()) {
    add("EDGE_SPACE", "Remove the space at the start or end of the name.");
  }
  if (/ {2,}/.test(name)) {
    add("DOUBLE_SPACE", "Use a single space between fields.");
  }
  if (name.includes("_")) {
    add(
      "UNDERSCORE",
      "Underscores are notation in the standard, not part of the name — use a space.",
    );
  }
  if (/\s\*|\*\s/.test(name)) {
    add("SPACED_ASTERISK", "Write dimensions as 50SQMM*10MM, with no space around the *.");
  }

  const stray = name.match(ALLOWED_CHARS);
  if (stray) {
    add("UNEXPECTED_SYMBOL", `"${stray[0]}" is not used by the naming convention.`);
  }

  // --- token rules
  const tokens = name.trim().split(/\s+/);
  const isSpec = (token) => SPEC_START.test(token);
  const lastIndex = tokens.length - 1;

  if (!tokens.some(isSpec)) {
    add(
      "MISSING_SPECIFICATION",
      "Add the dimension or electrical rating — a name with no specification is not unique.",
    );
  }

  // Dimensions and ratings lead; everything else follows. A spec appearing
  // after a word is the "Bolt SS 10mm" mistake.
  const firstWord = tokens.findIndex((token) => !isSpec(token));
  if (firstWord !== -1) {
    const misplaced = tokens.findIndex((token, index) => index > firstWord && isSpec(token));
    if (misplaced !== -1) {
      add(
        "SEQUENCE",
        `"${tokens[misplaced]}" is a dimension and belongs at the front, before the item name.`,
      );
    }
  }

  for (const [index, token] of tokens.entries()) {
    if (isSpec(token)) {
      // The letters trailing a number are its UOM.
      if (/[a-z]/.test(token)) {
        add("LOWERCASE_UOM", `Write the unit in "${token}" in uppercase.`);
      }
      continue;
    }

    if (/^[a-z]/.test(token)) {
      add("LOWERCASE_INITIAL", `"${token}" must start with a capital letter.`);
    }

    // A word carrying digits is a specification glued to text — except the item
    // code, which is the last field and is written in uppercase.
    if (/\d/.test(token) && !(index === lastIndex && ITEM_CODE.test(token))) {
      add(
        "IMPROPER_FORMAT",
        `Separate the specification out of "${token}" — dimensions go first, on their own.`,
      );
    }
  }

  // Two rules can fire on the same token (a lowercase UOM is often also a
  // sequence error); the same message twice helps nobody.
  const unique = [];
  const seen = new Set();
  for (const issue of issues) {
    if (seen.has(issue.message)) continue;
    seen.add(issue.message);
    unique.push(issue);
  }

  return { compliant: unique.length === 0, issues: unique };
};

/**
 * Resolves the name to save from what the intake form sent.
 *
 * A typed name always wins — the store sometimes has a name already agreed
 * with the Plant Manager — and the builder fills in only when the field was
 * left blank. Either way the result is validated the same.
 */
export const resolveItemName = ({ name, naming } = {}) => {
  const typed = collapse(name);
  const hasParts =
    naming &&
    (naming.itemName ||
      naming.itemCode ||
      naming.electricalRating ||
      (Array.isArray(naming.dimensions) && naming.dimensions.some((d) => d?.value)));

  if (!typed && hasParts) return composeItemName(naming);

  return {
    name: typed,
    naming: hasParts ? normalizeNamingParts(naming) : null,
    ...validateItemName(typed),
  };
};
