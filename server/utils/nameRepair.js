import { validateItemName } from "./itemNaming.js";

/**
 * Repairs a free-typed item name into the SOI1/SOP1 convention (utils/itemNaming.js).
 *
 * Moved out of scripts/proposeItemNames.js (9 Oct 2026) so the physical stock
 * matcher uses the same repair as the catalog renaming. It only rearranges what
 * is there - it never invents a specification - and every result is judged by
 * the same validator the intake form calls.
 */

/** Materials of construction. They sit late in the name, before the item code. */
const MATERIALS = new Set([
  "CU", "AL", "SS", "MS", "GI", "CI", "PVC", "PU", "BRASS", "BRONZE",
  "NYLON", "TEFLON", "PTFE", "RUBBER", "COPPER", "ALUMINIUM",
]);

/** Vulgar fractions, as the validator understands them. */
const FRACTIONS = "¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";
const SPEC_START = new RegExp(`^[0-9${FRACTIONS}]`);

/** An item code as the standard writes it: uppercase, and it carries a digit. */
const CODE_SHAPE = /^[A-Z0-9][A-Z0-9/.-]*$/;

/**
 * Words that read as a number but are really part of the description, so that
 * joining them to the digit in front produces one honest specification token
 * rather than a stray number the validator rejects.
 *
 * "3 Pole" and "2 Way" are the whole reason this list exists: an electrician
 * says them as one thing, and split across two tokens the convention treats
 * the "3" as a dimension that wandered into the middle of the name.
 */
const COUNT_WORDS = new Set([
  "POLE", "POLES", "WAY", "PIN", "PHASE", "CORE", "LEG", "ROW", "NO", "NC",
  "SPEED", "STEP", "TIER", "STAGE",
]);

/* ------------------------------------------------------------------ tidying */

/**
 * Units of measure the store writes, for closing up "10 SQMM" into "10SQMM".
 *
 * The convention joins a value to its unit with no separator. Written apart
 * they are two tokens, and the second one — "SQMM*6MM" — opens with a letter
 * and carries digits, which is the shape the standard rejects.
 */
const UOMS = [
  "SQMM", "AWG", "MM", "CM", "MTR", "NB", "INCH", "IN", "FT", "FEET",
  "KVAR", "KVA", "KW", "HP", "VA", "V", "A", "W", "HZ", "BAR", "PSI",
  "KG", "GM", "G", "ML", "LTR", "L", "DEG", "TON", "RPM", "NM", "M",
];

/** "SQMM", "SQMM*6MM" and "MM*1" all open with a unit. */
const OPENS_WITH_UOM = new RegExp(`^(${UOMS.join("|")})(\\b|\\*|$)`, "i");

/**
 * Characters the convention does not allow, and what the store meant by them.
 *
 * The replacement character is the interesting one: it is a degree sign that
 * lost its encoding somewhere between the original workbook and ERPNext, and
 * it appears only on the 45 and 90 degree grease nipples.
 */
export const clean = (raw) => {
  let s = String(raw ?? "");

  s = s.replace(/\uFFFD/g, "°");
  s = s.replace(/\s*°/g, "DEG");
  // "10''+ SCREW DRIVER" — a typewriter inch mark with a stray plus.
  s = s.replace(/''\s*\+/g, '"');
  s = s.replace(/''/g, '"');
  s = s.replace(/[\u201C\u201D]/g, '"');
  s = s.replace(/[\u2018\u2019]/g, "'");
  // A dimension separator written as a word.
  s = s.replace(/\s+[xX\u00D7]\s+/g, "*");
  s = s.replace(/\s*\*\s*/g, "*");
  // A trailing asterisk with nothing after it is a typo, not a dimension.
  s = s.replace(/\*+(?=\s|$)/g, " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
};

const isSpec = (token) => SPEC_START.test(token);

/** First letter up, the rest untouched so "CU" and "BS245SR61" survive. */
const capitalize = (word) => (word ? word[0].toUpperCase() + word.slice(1) : word);

/** Uppercase the unit trailing a number, and leave words alone. */
const caseFix = (tokens) =>
  tokens.map((t) => (isSpec(t) ? t.toUpperCase() : capitalize(t)));

/**
 * Closes a value up to its unit: "10", "SQMM*6MM" → "10SQMM*6MM".
 *
 * Deliberately not applied to "1 1/2\"", where the second token is itself a
 * measurement rather than a unit — that is one-and-a-half inches, and joining
 * it would invent a dimension of eleven-halves.
 */
const joinUom = (tokens) => {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (/^[0-9][0-9.\-/]*$/.test(token) && next && OPENS_WITH_UOM.test(next)) {
      out.push(`${token}${next.toUpperCase()}`);
      i += 1;
      continue;
    }
    out.push(token);
  }
  return out;
};

/**
 * Joins a bare count to the word it counts: "3", "Pole" → "3POLE".
 *
 * "3 Pole" is the whole reason this exists: an electrician says it as one
 * thing, and split across two tokens the convention reads the "3" as a
 * dimension that wandered into the middle of the name.
 */
const joinCounts = (tokens) => {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (
      /^[0-9]+$/.test(token) &&
      next &&
      COUNT_WORDS.has(next.toUpperCase().replace(/[.,]/g, ""))
    ) {
      out.push(`${token}${next.toUpperCase()}`);
      i += 1;
      continue;
    }
    out.push(token);
  }
  return out;
};

/**
 * Puts the fields in the order the convention names them: dimensions and
 * ratings, then the item name and type, then the material, then the item code.
 *
 * The last resort, because it is the only step that moves words a storeman
 * reads off a shelf label. Nothing is added and nothing is dropped.
 */
const reorder = (tokens) => {
  const specs = [];
  const words = [];
  const materials = [];
  let code = "";

  let rest = tokens;
  const codeIndex = rest.findIndex(
    (t) =>
      /\d/.test(t) &&
      !isSpec(t) &&
      !MATERIALS.has(t.toUpperCase()) &&
      CODE_SHAPE.test(t.toUpperCase())
  );
  if (codeIndex !== -1) {
    code = rest[codeIndex].toUpperCase();
    rest = rest.filter((_, i) => i !== codeIndex);
  }

  for (const token of rest) {
    const bare = token.replace(/[(),]/g, "");
    if (isSpec(token)) specs.push(token.toUpperCase());
    else if (MATERIALS.has(bare.toUpperCase())) materials.push(bare.toUpperCase());
    else words.push(capitalize(token));
  }

  return [...specs, ...words, ...materials, code].filter(Boolean);
};

/**
 * The smallest repair that makes a name compliant.
 *
 * Each step is tried in turn and the first one that passes wins, so a name
 * needing only a capital letter gets a capital letter rather than being
 * rebuilt from its parts. Churn is not free: every changed name is a shelf
 * label somebody has to reprint and a phrase somebody has to unlearn, and a
 * migration that reorders four hundred names to fix eighty is how a naming
 * standard gets a reputation.
 */
const STEPS = [
  { name: "tidied", apply: (t) => t },
  { name: "case and units", apply: caseFix },
  { name: "value closed to unit", apply: (t) => joinUom(caseFix(t)) },
  { name: "count joined", apply: (t) => joinCounts(joinUom(caseFix(t))) },
  { name: "fields reordered", apply: (t) => reorder(joinCounts(joinUom(caseFix(t)))) },
];

export const repair = (rawName) => {
  const tidied = clean(rawName);
  if (!tidied) return { proposed: "", step: "empty", compliant: false, issues: [] };

  const tokens = tidied.split(/\s+/);
  let last = null;

  for (const step of STEPS) {
    const proposed = step.apply(tokens).join(" ").replace(/\s{2,}/g, " ").trim();
    const check = validateItemName(proposed);
    last = { proposed, step: step.name, ...check };
    if (check.compliant) return last;
  }
  return last;
};

/* ------------------------------------------------------------------- output */

/**
 * Which pile a row belongs in.
 *
 * A name that already passes is left exactly as it is. The convention puts the
 * material after the item name, and a couple of hundred names say "GI Union"
 * rather than "Union GI" — but the validator accepts both, the store reads
 * them daily, and rewriting a correct name to satisfy a rule nothing enforces
 * is churn dressed up as compliance. Those are reported separately, as
 * something to opt into rather than something being done to them.
 */
export const grade = (current, before, after) => {
  if (before.compliant) {
    const strict = reorder(joinCounts(joinUom(caseFix(clean(current).split(/\s+/)))))
      .join(" ")
      .trim();
    return strict !== current
      ? {
          band: "Optional - field order",
          note: "Already correct. The standard would put the material and code last.",
          optional: strict,
        }
      : { band: "No change", note: "Already correct.", optional: "" };
  }

  if (after.compliant) {
    return {
      band: after.step === "fields reordered" ? "Fix - reordered" : "Fix - safe",
      note:
        after.step === "fields reordered"
          ? "Fields put into the standard's sequence."
          : `Corrected: ${after.step}.`,
      optional: "",
    };
  }

  const onlyMissingSpec =
    after.issues.length === 1 && after.issues[0].code === "MISSING_SPECIFICATION";

  return onlyMissingSpec
    ? {
        band: "Fix - needs the size",
        note: "Tidied, but no dimension or rating appears anywhere in the name. Add the size.",
        optional: "",
      }
    : {
        band: "Fix - needs a decision",
        note: after.issues.map((i) => i.message).join(" "),
        optional: "",
      };
};

/**
 * The full standard form of a name, for a name being *written* to the standard
 * (the physical stock inspection, 9 Oct 2026) rather than a catalog name being
 * minimally repaired: every step is applied, not just the first that passes,
 * so materials go last in uppercase and values close up to their units.
 *
 * Before the steps, the shorthand the store and SAP both use is spelled the
 * way the convention reads it: "1/2 inch" is 1/2", "SQ.MM" is SQMM, "20 X 75"
 * is 20*75, and an M-thread size (M16) is a 16MM dimension. Still never invents
 * a size: a name with none comes back flagged, not guessed.
 *
 * @returns { name, compliant, issues }
 */
export const standardize = (raw) => {
  let s = clean(raw);
  if (!s) return { name: "", compliant: false, issues: [{ code: "EMPTY", message: "No name." }] };
  s = s.replace(/(\d)\s*(?:inch(?:es)?|in\.)(?=\s|$|\*)/gi, '$1"');
  s = s.replace(/(\d)\s*"/g, '$1"');
  s = s.replace(/\bSQ\s*\.?\s*MM\b/gi, "SQMM");
  s = s.replace(/(\d)\s*[xX×]\s*(?=\d)/g, "$1*");
  s = s.replace(/\bM\s?(\d{1,2})(?=\s|$|\*)/g, "$1MM");
  // A value and its quote mark glued to the next word: 2"MS -> 2" MS.
  s = s.replace(/(\d")(?=[A-Za-z])/g, "$1 ");
  s = s.replace(/\s{2,}/g, " ").trim();
  // SAP's ALL-CAPS words read as words, not acronyms, once they are four letters or more
  // ("HEX BOLT" -> "Hex Bolt"); materials and short codes (TVS, MCB, SS) stay as they are.
  const words = s.split(/\s+/).map((t) =>
    /^[A-Z]{4,}$/.test(t) && !MATERIALS.has(t) ? t[0] + t.slice(1).toLowerCase() : t
  );
  const name = reorder(joinCounts(joinUom(caseFix(words))))
    // A later dimension with no unit takes the first one's: 20MM*75 -> 20MM*75MM.
    .map((t) => {
      const m = t.match(/^[0-9][0-9./]*([A-Z"]+)\*/);
      return m ? t.replace(/\*([0-9][0-9./]*)(?=\*|$)/g, `*$1${m[1]}`) : t;
    })
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const check = validateItemName(name);
  return { name, ...check };
};
