/**
 * Duplicate item prevention (ST-14).
 *
 * "Before creating, check the existing database and warn the user if a
 * same/similar item already exists." The hard part is *similar*: the same
 * bearing gets entered as "6205 Bearing Deep Groove" one year and
 * "25MM Bearing Deep Groove 6205" the next, and an exact-match check catches
 * neither.
 *
 * So names are compared as bags of words rather than as strings. Everything
 * that is not a letter or a digit is a separator, case is dropped, and two
 * items are judged on how much of their vocabulary they share. That survives
 * re-ordered fields, punctuation changes and the several "times" separators
 * the store uses interchangeably.
 */
import Product from "../models/Product.js";

/** At or above this, the two names are close enough to stop and ask. */
const SIMILAR_AT = 0.6;

/** How many candidates to pull back before scoring them in memory. */
const CANDIDATE_LIMIT = 300;

/** How many matches to show. More than a handful is noise on a warning panel. */
const MAX_MATCHES = 5;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "50SQMM*10MM Cable Leg" → ["50SQMM", "10MM", "CABLE", "LEG"] */
const tokenize = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** The whole name with every separator removed, for the exact-match test. */
const flatten = (value) => tokenize(value).join("");

/**
 * How alike two token bags are, on 0..1.
 *
 * Two measures, and the higher one wins:
 *
 *  - Jaccard (shared ÷ total vocabulary) is the honest general answer, but it
 *    punishes a short name for being a subset of a longer one.
 *  - Containment (shared ÷ the shorter bag) catches exactly that case —
 *    "Bearing 6205" against "25MM Bearing 6205 Deep Groove" — and is damped to
 *    0.85 so a genuine subset still scores below an outright match.
 */
const similarity = (a, b) => {
  if (!a.length || !b.length) return 0;

  const other = new Set(b);
  const shared = a.filter((token) => other.has(token)).length;
  if (!shared) return 0;

  const jaccard = shared / new Set([...a, ...b]).size;
  const containment = (shared / Math.min(a.length, b.length)) * 0.85;

  return Math.max(jaccard, containment);
};

/**
 * Products that look like the one about to be created.
 *
 * `exact` marks a match the store almost certainly already owns — the same
 * code, or the same name once punctuation is ignored. Those are worth blocking
 * on; the rest are worth showing.
 */
export const findSimilarProducts = async ({
  name = "",
  code = "",
  brand = "",
  category = "",
  excludeId = null,
} = {}) => {
  const tokens = tokenize(name);
  const trimmedCode = String(code ?? "").trim();

  if (!tokens.length && !trimmedCode) return [];

  // Pull a candidate set with the database rather than scanning the catalog:
  // the longest tokens are the distinctive ones ("SPROCKET" discriminates,
  // "10" does not), so they make the cheapest filter.
  const probes = [...tokens]
    .sort((a, b) => b.length - a.length)
    .filter((token) => token.length >= 3)
    .slice(0, 3)
    .map((token) => ({ name: { $regex: escapeRegex(token), $options: "i" } }));

  if (trimmedCode) {
    probes.push({ code: { $regex: `^${escapeRegex(trimmedCode)}$`, $options: "i" } });
  }

  // Nothing distinctive enough to probe on — a name of pure digits and
  // two-letter words. Fall back to the category so the check still says
  // something rather than silently passing.
  if (!probes.length && category) {
    probes.push({ category });
  }
  if (!probes.length) return [];

  const filter = { $or: probes };
  if (excludeId) filter._id = { $ne: excludeId };

  const candidates = await Product.find(filter).limit(CANDIDATE_LIMIT).lean();

  const flatName = flatten(name);
  const normalizedBrand = String(brand ?? "").trim().toUpperCase();

  const matches = [];
  for (const candidate of candidates) {
    const sameCode =
      Boolean(trimmedCode) && candidate.code?.toUpperCase() === trimmedCode.toUpperCase();
    const sameName = Boolean(flatName) && flatten(candidate.name) === flatName;

    let score = similarity(tokens, tokenize(candidate.name));

    // The same brand behind two similar names makes it likelier they are one
    // item; a nudge, not a verdict, and never enough on its own.
    if (
      normalizedBrand &&
      candidate.brand &&
      candidate.brand.trim().toUpperCase() === normalizedBrand
    ) {
      score = Math.min(1, score + 0.1);
    }

    if (sameCode || sameName) score = 1;
    if (score < SIMILAR_AT) continue;

    matches.push({
      _id: candidate._id,
      code: candidate.code,
      name: candidate.name,
      category: candidate.category,
      subCategory: candidate.subCategory || "",
      brand: candidate.brand || "",
      storeRoom: candidate.storeRoom,
      rackNumber: candidate.rackNumber || "",
      quantity: candidate.quantity,
      unit: candidate.unit,
      image: candidate.image || "",
      score: Math.round(score * 100) / 100,
      exact: sameCode || sameName,
      reason: sameCode
        ? "Same product code"
        : sameName
          ? "Same name, ignoring punctuation"
          : "Similar name",
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, MAX_MATCHES);
};

export { SIMILAR_AT };
