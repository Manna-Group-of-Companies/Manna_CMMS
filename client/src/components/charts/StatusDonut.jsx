import { useState } from "react";

/**
 * Part of a whole, at a glance: a ring split by status with the total in the
 * middle and a legend carrying each name and count.
 *
 * Kept to a handful of segments - it is for "how much of this month is still
 * open", not for comparing close values. A 2px gap separates the segments, and
 * each one is named in the legend, so no state rests on its colour alone.
 * Hovering a segment or its legend row shows that segment in the middle.
 *
 *   segments [{ key, label, value, color }]
 */
const SIZE = 168;
const STROKE = 20;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const GAP = 3; // px of ring left between segments (the surface gap)

const StatusDonut = ({ segments, caption = "" }) => {
  const [hover, setHover] = useState(null);
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);
  const drawn = segments.filter((s) => s.value > 0);
  const focus = hover ? segments.find((s) => s.key === hover) : null;

  let offset = 0;
  const arcs = drawn.map((s) => {
    const full = (s.value / total) * C;
    const len = drawn.length > 1 ? Math.max(0.5, full - GAP) : full;
    const arc = { ...s, len, offset };
    offset += full;
    return arc;
  });

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden="true">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#eef1f4" strokeWidth={STROKE} />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth={hover === a.key ? STROKE + 4 : STROKE}
              strokeDasharray={`${a.len} ${C - a.len}`}
              strokeDashoffset={-a.offset}
              className="cursor-pointer transition-[stroke-width,opacity] duration-150"
              style={{ opacity: hover && hover !== a.key ? 0.35 : 1 }}
              onPointerEnter={() => setHover(a.key)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[32px] font-bold leading-none tracking-tight text-slate-900">
              {focus ? focus.value : total}
            </p>
            <p className="mt-1 text-[12px] text-slate-500">{focus ? focus.label : caption}</p>
          </div>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-1" aria-label="Breakdowns by status">
        {segments.map((s) => (
          <li
            key={s.key}
            onPointerEnter={() => setHover(s.key)}
            onPointerLeave={() => setHover(null)}
            className={`flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors ${
              hover === s.key ? "bg-slate-50" : ""
            }`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-700">{s.label}</span>
            <span className="text-[15px] font-bold tabular-nums text-slate-900">{s.value}</span>
            <span className="w-10 text-right text-[12px] tabular-nums text-slate-500">
              {total ? `${Math.round((s.value / total) * 100)}%` : "–"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default StatusDonut;
