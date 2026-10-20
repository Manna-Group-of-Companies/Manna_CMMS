/**
 * HSN codes, checked the way the server checks them (server/repository/
 * sapCategories.js - change the two together). Since 20 Oct 2026 a goods
 * receipt may carry a code SAP has not got yet, which is created in SAP from
 * what is typed, so it is checked for shape rather than against a list.
 */

/** Digits only: "7318.15.00" -> "73181500". */
export const hsnDigits = (value) => String(value ?? "").replace(/\D/g, "");

/** Why these digits are not an HSN code, or "" when they are one. */
export const hsnProblem = (digits) => {
  if (![4, 6, 8].includes(digits.length)) return "an HSN code has 4, 6 or 8 digits";
  const chapter = Number(digits.slice(0, 2));
  if (chapter < 1 || chapter > 98 || chapter === 77) return `chapter ${digits.slice(0, 2)} does not exist in the HSN`;
  return "";
};
