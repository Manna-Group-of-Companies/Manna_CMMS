import { useEffect, useId, useRef, useState } from "react";
import { formatHours } from "../../utils/formatHours";

/**
 * Downtime over time: this period as the line that matters (brand orange over
 * a faint wash), the period before as grey context, one y-axis in hours.
 *
 * Hover, touch or the arrow keys move a crosshair that snaps to the nearest
 * bucket and reads out both periods there. Every value is also in a visually
 * hidden table, so nothing is reachable only by pointing.
 *
 *   points   [{ label, detail, value }]      this period, oldest first
 *   previous [{ value }]                     the period before, same length
 */
const HEIGHT = 230;
const PAD = { top: 16, right: 14, bottom: 30, left: 38 };

const CURRENT = "var(--color-brand-500)";
const PREVIOUS = "#94a3b8"; // slate-400: context, deliberately quiet

/** 0, a clean step, and the step count that covers `max`. */
const niceScale = (max) => {
  if (!(max > 0)) return { top: 4, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  return { top: Math.ceil(max / step) * step, step };
};

/**
 * A monotone cubic through the points (Fritsch–Carlson), so the curve is smooth
 * but never dips below zero or bulges past a value it was not given.
 */
const smoothPath = (pts) => {
  const n = pts.length;
  if (!n) return "";
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
};

const DowntimeChart = ({ points, previous = [], periodLabel = "This period", previousLabel = "Previous period" }) => {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(560);
  const [active, setActive] = useState(null); // bucket index under the crosshair
  const gradientId = useId();

  // The chart draws in real pixels at the width it is given, so strokes and
  // dots stay their true size rather than being stretched by a viewBox.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = points.length;
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const max = Math.max(0, ...points.map((p) => p.value || 0), ...previous.map((p) => p?.value || 0));
  const { top, step } = niceScale(max);
  const x = (i) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => PAD.top + innerH - ((v || 0) / top) * innerH;

  const currentPts = points.map((p, i) => [x(i), y(p.value)]);
  const previousPts = previous.slice(0, n).map((p, i) => [x(i), y(p?.value)]);
  const line = smoothPath(currentPts);
  const area = n
    ? `${line} L${currentPts[n - 1][0]},${y(0)} L${currentPts[0][0]},${y(0)} Z`
    : "";
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const pick = (clientX) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round(((px - PAD.left) / innerW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };

  const onKeyDown = (e) => {
    if (!n) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(n - 1, Math.max(0, (a ?? (delta > 0 ? -1 : n)) + delta)));
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  const shown = active !== null && points[active] ? points[active] : null;
  const tipLeft = shown ? Math.min(Math.max(x(active), 70), width - 70) : 0;

  return (
    <div>
      {/* Legend: two series, so identity never rests on colour alone. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-4 rounded-full" style={{ background: CURRENT }} aria-hidden="true" />
          {periodLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-4 border-t-2 border-dashed" style={{ borderColor: PREVIOUS }} aria-hidden="true" />
          {previousLabel}
        </span>
      </div>

      <div
        ref={wrapRef}
        className="relative touch-pan-y outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500"
        tabIndex={0}
        role="img"
        aria-label={`Downtime in hours, ${periodLabel.toLowerCase()} against ${previousLabel.toLowerCase()}. Use the arrow keys to read each point.`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={HEIGHT} className="block" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Hairline grid and its labels: recessive, solid, clean numbers. */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#eef1f4" strokeWidth="1" />
              <text x={PAD.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums">
                {t}
              </text>
            </g>
          ))}

          {points.map((p, i) => (
            <text key={p.label + i} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-slate-400 text-[11px]">
              {p.label}
            </text>
          ))}

          {previousPts.length > 1 && (
            <path
              d={smoothPath(previousPts)}
              fill="none"
              stroke={PREVIOUS}
              strokeWidth="2"
              strokeDasharray="5 5"
              strokeLinecap="round"
            />
          )}
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke={CURRENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* The end of the line is labelled with a dot; the crosshair shows the rest. */}
          {n > 0 && active === null && (
            <circle cx={currentPts[n - 1][0]} cy={currentPts[n - 1][1]} r="4.5" fill={CURRENT} stroke="#fff" strokeWidth="2" />
          )}

          {shown && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={y(0)}
                stroke="#cbd5e1"
                strokeWidth="1"
              />
              {previousPts[active] && (
                <circle cx={previousPts[active][0]} cy={previousPts[active][1]} r="4" fill={PREVIOUS} stroke="#fff" strokeWidth="2" />
              )}
              <circle cx={currentPts[active][0]} cy={currentPts[active][1]} r="6" fill="#fff" stroke={CURRENT} strokeWidth="2.5" />
            </g>
          )}
        </svg>

        {shown && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-[12px] text-white shadow-lg"
            style={{ left: tipLeft, top: Math.max(0, y(Math.max(shown.value || 0, previous[active]?.value || 0)) - 64) }}
            role="status"
          >
            <p className="font-semibold text-slate-300">{shown.detail || shown.label}</p>
            <p className="mt-0.5 flex items-center gap-2">
              <span className="h-0.5 w-3 rounded-full" style={{ background: CURRENT }} aria-hidden="true" />
              <strong className="font-semibold">{formatHours(shown.value)}</strong>
              <span className="text-slate-400">down</span>
            </p>
            {previous[active] && (
              <p className="flex items-center gap-2">
                <span className="w-3 border-t-2 border-dashed" style={{ borderColor: PREVIOUS }} aria-hidden="true" />
                <strong className="font-semibold">{formatHours(previous[active].value)}</strong>
                <span className="text-slate-400">before</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* The same numbers as a table, for screen readers. */}
      <table className="sr-only">
        <caption>Downtime in hours</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">{periodLabel}</th>
            <th scope="col">{previousLabel}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.label + i}>
              <th scope="row">{p.detail || p.label}</th>
              <td>{formatHours(p.value)}</td>
              <td>{formatHours(previous[i]?.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DowntimeChart;
