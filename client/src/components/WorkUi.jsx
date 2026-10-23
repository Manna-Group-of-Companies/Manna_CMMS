/**
 * The pieces the dashboard and the two maintenance lists share, drawn the way
 * the phone app draws them: a tinted thumbnail per row, coloured by priority,
 * and a figure tile with an icon chip.
 */

/** Tile colours by priority. The untinted fallback is the brand orange. */
const PRIORITY_TINT = {
  Critical: "bg-rose-500/10 border-rose-500/20 text-rose-700",
  High: "bg-rose-500/10 border-rose-500/20 text-rose-700",
  Medium: "bg-amber-500/10 border-amber-500/20 text-amber-700",
  Low: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600",
};

export const WorkThumb = ({ icon: Icon, priority }) => (
  <span
    className={`thumb ${PRIORITY_TINT[priority] || "bg-brand-500/10 border-brand-500/20 text-brand-700"}`}
  >
    <Icon className="h-5 w-5" />
  </span>
);

/** Icon chip colours for the four dashboard figures and the list stats. */
const TONES = {
  brand: "bg-brand-500/10 text-brand-700",
  blue: "bg-blue-500/10 text-blue-600",
  green: "bg-emerald-500/10 text-emerald-600",
  violet: "bg-violet-500/10 text-violet-600",
  amber: "bg-amber-500/10 text-amber-600",
  rose: "bg-rose-500/10 text-rose-600",
};

export const StatTile = ({ icon: Icon, label, value, sub, tone = "brand" }) => (
  <div className="stat-tile flex flex-col gap-1">
    <div className="flex items-center justify-between gap-2">
      <p className="text-[13px] font-medium text-slate-500">{label}</p>
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${TONES[tone] || TONES.brand}`}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
    <p className="text-[30px] font-bold leading-none tracking-tight text-slate-900 tabular-nums">{value}</p>
    {sub && <p className="mt-1 text-[13px] text-slate-500 max-sm:hidden">{sub}</p>}
  </div>
);
