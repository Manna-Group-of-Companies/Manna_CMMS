import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";

/**
 * A preventive maintenance checklist, as the sheet that gets carried to the
 * machine.
 *
 * Printed, or saved as a PDF from the same dialog — the browser's own print
 * gives both, and adding a PDF library to the server to produce a page it can
 * already produce would be a dependency earning nothing.
 *
 * One format. There used to be two — a *round* sheet with a column per visit
 * and a *single visit* sheet with a reading and a remark per point — and a
 * toggle between them. The plant asked for one, so every frequency now prints
 * the round sheet: thirty-one columns for a daily list, twelve for a monthly
 * one, a single column for a yearly one.
 *
 * Under every column is a "Done by" box, because whoever does the work signs
 * for it each time they do it. The sheet as a whole is signed off by the plant
 * manager and the maintenance manager.
 */

/** How many visits fit on one sheet, by frequency. */
const COLUMNS = {
  Daily: 31,
  Weekly: 5,
  Monthly: 12,
  Quarterly: 4,
  "Half-Yearly": 2,
  Yearly: 1,
};

/**
 * What the tick columns are headed with.
 *
 * Numbers where the period has no name - day 1 to 31, week 1 to 5. The monthly
 * sheet's twelve columns are the twelve months, read at a glance by their
 * initials; J, M and A repeat, as on every wall planner, and position resolves
 * it.
 */
const HEADINGS = {
  Monthly: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
  Quarterly: ["Q1", "Q2", "Q3", "Q4"],
  "Half-Yearly": ["H1", "H2"],
  Yearly: ["Done"],
};

const headingsFor = (frequency, count) =>
  HEADINGS[frequency] || Array.from({ length: count }, (_, i) => String(i + 1));

/**
 * How wide a visit column prints.
 *
 * Thirty-one days only fit as narrow ticks; a weekly or yearly column has the
 * room for a tick, a reading and the initials of whoever did it.
 */
const columnWidth = (columns) => (columns > 12 ? "w-6" : columns > 5 ? "w-10" : "w-20");

/**
 * The points, numbered, in the order they were written.
 *
 * Order is not cosmetic on a checklist. A round is walked in a sequence - down
 * one side of the machine and back up the other - and a list sorted by anything
 * other than the order somebody wrote it in sends the inspector back and forth
 * across the machine, which is how points get skipped.
 */
const numbered = (points = []) => points.map((p, i) => ({ ...p, n: i + 1 }));

const ChecklistSheet = ({ checklist, onClose }) => {
  const columns = COLUMNS[checklist.frequency] ?? 1;
  const width = columnWidth(columns);
  // Thirty-one or twelve columns need the long side of the page.
  const landscape = columns > 5;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Numbered before rendering rather than by a counter the rows call as they
   * render - mutating a variable during render runs twice under StrictMode, and
   * the printed sheet came out numbered 2, 6, 7, 8.
   */
  const points = numbered(checklist.points);

  /**
   * Only the daily sheet asks which shift. A daily round is walked every shift;
   * everything less frequent is done in the morning shift.
   */
  const isDaily = checklist.frequency === "Daily";

  /**
   * Rendered into `document.body`, outside the React root, and printed alone,
   * so the print rules in index.css can hide the whole application with one
   * selector and be certain nothing of it is left.
   */
  return createPortal(
    <div className="print-sheet fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 print:bg-white print:static print:overflow-visible">
      <div className="mx-auto my-6 max-w-[297mm] print:my-0 print:max-w-none">
        <div className="flex flex-wrap justify-end items-center gap-2 mb-2 print:hidden">
          <p className="mr-auto text-xs text-slate-200">
            Prints {landscape ? "landscape" : "portrait"}, {columns} column
            {columns === 1 ? "" : "s"} across.
          </p>
          <button className="btn btn-sm btn-primary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print / save as PDF
          </button>
          <button className="btn btn-sm btn-neutral" onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </button>
        </div>

        {/* The sheet sets its own page size and orientation, so a thirty-one
            column daily sheet never comes out on portrait A4. */}
        <style>{`@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; }`}</style>

        <div className="bg-white p-8 shadow-xl print:shadow-none print:p-0 text-slate-900">
          {/* --- heading --- */}
          <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                {checklist.frequency} Preventive Maintenance Checklist
              </h1>
              <p className="text-xs text-slate-600">
                Manna Group &middot; Manna CMMS
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-sm font-bold">{checklist.id}</p>
              <p className="text-xs text-slate-600">Rev {checklist.revision}</p>
            </div>
          </div>

          <Grid>
            <Cell
              label={checklist.assetKind === "electrical" ? "Electrical System" : "Machine"}
              value={`${checklist.assetName} (${checklist.asset})`}
              span={2}
            />
            <Cell label="Plant" value={checklist.plant} span={2} />
            <Cell label="Checklist" value={checklist.title} span={2} />
            {/* Month and year are written in by hand. Printing today's date on a
                sheet that will be pinned up for the next four weeks is how a
                sheet ends up filed under the wrong month. */}
            <Cell label="Month / period" value="" span={isDaily ? 1 : 2} />
            {isDaily && <Cell label="Shift" value="" span={1} />}
          </Grid>

          {(checklist.points || []).length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">
              This checklist has no points yet. Add them before printing it — a blank sheet gets
              signed as readily as a full one.
            </p>
          ) : (
            <table className="w-full border-collapse text-[11px] mt-3">
              <thead>
                <tr className="bg-slate-100">
                  <Th className="w-8">#</Th>
                  <Th>What to check</Th>
                  {headingsFor(checklist.frequency, columns).map((label, i) => (
                    <Th key={i} className={`${width} text-center`}>
                      {label}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <PointRow key={p.n} point={p} columns={columns} />
                ))}
                {/* The date each visit was made. The daily sheet's columns are
                    the days already, so it does not need the row. */}
                {!isDaily && (
                  <tr className="break-inside-avoid">
                    <Td className="text-right font-semibold" colSpan={2}>
                      Date
                    </Td>
                    {Array.from({ length: columns }).map((_, c) => (
                      <Td key={c} className="h-8" />
                    ))}
                  </tr>
                )}
                {/* Whoever did the work signs for it, every time. */}
                <tr className="break-inside-avoid">
                  <Td className="text-right font-semibold" colSpan={2}>
                    Done by (signature)
                  </Td>
                  {Array.from({ length: columns }).map((_, c) => (
                    <Td key={c} className="h-12" />
                  ))}
                </tr>
              </tbody>
            </table>
          )}

          <Section title="Remarks" />
          <div className="border border-slate-300 p-2 break-inside-avoid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border-b border-dotted border-slate-300 h-6" />
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            Anything that fails a check and is not fixed on the spot should be raised as a
            maintenance request — or a breakdown, if the machine has to stop.
          </p>

          {/* --- sign-off --- */}
          <div className="mt-6 grid grid-cols-2 gap-10 break-inside-avoid">
            <Sign role="Plant manager" />
            <Sign role="Maintenance manager" />
          </div>

          <div className="mt-4 flex items-end justify-between border-t border-slate-300 pt-2">
            <p className="text-[10px] text-slate-500">
              {checklist.notes || "Tick each point when done. A blank means it was not checked."}
            </p>
            {/* The revision, in the footer where an auditor looks for it. */}
            <p className="text-[10px] text-slate-500 shrink-0 ml-4">
              {checklist.id} · Rev {checklist.revision} · {checklist.frequency}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

/** One point, with a box per visit. */
const PointRow = ({ point: p, columns }) => (
  <tr>
    <Td className="text-center">{p.n}</Td>
    <Td>
      {p.point}
      {p.howToCheck && <span className="text-slate-500"> &mdash; {p.howToCheck}</span>}
    </Td>
    {Array.from({ length: columns }).map((_, c) => (
      <Td key={c} className="h-7" />
    ))}
  </tr>
);

const Grid = ({ children }) => (
  <div className="grid grid-cols-4 border-l border-t border-slate-300 mt-3 text-sm">{children}</div>
);

const Cell = ({ label, value, span = 1 }) => (
  <div className={`border-r border-b border-slate-300 px-2 py-1.5 ${span === 2 ? "col-span-2" : ""}`}>
    <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
    <p className="font-medium min-h-[1.25rem]">{value || ""}</p>
  </div>
);

const Section = ({ title }) => (
  <h2 className="mt-4 mb-1 text-xs font-bold uppercase tracking-wider text-slate-700">{title}</h2>
);

const Th = ({ children, className = "" }) => (
  <th className={`border border-slate-300 px-2 py-1 text-left text-[11px] font-semibold ${className}`}>
    {children}
  </th>
);

const Td = ({ children, className = "", colSpan }) => (
  <td colSpan={colSpan} className={`border border-slate-300 px-2 py-1 ${className}`}>
    {children}
  </td>
);

const Sign = ({ role }) => (
  <div>
    <div className="h-10 border-b border-slate-800" />
    <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{role}</p>
    <p className="text-[10px] text-slate-400">Name, signature &amp; date</p>
  </div>
);

export default ChecklistSheet;
