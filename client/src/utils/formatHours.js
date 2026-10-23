/** Hours as people say them: "45 min" under an hour, "1.8 h" above, "—" when unknown. */
export const formatHours = (h) => {
  if (h === null || h === undefined || h === "" || !Number.isFinite(Number(h))) return "—";
  const n = Number(h);
  if (n > 0 && n < 1) return `${Math.round(n * 60)} min`;
  return `${Math.round(n * 10) / 10} h`;
};
