import { useEffect, useState } from "react";
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
 * Two layouts, and which one is offered matters more than it looks.
 *
 *   A *round* sheet has a column per visit — thirty-one for a daily list, twelve
 *   for a monthly one. It is what a daily checklist has to be: a single-visit
 *   sheet for a daily round means thirty-one printouts a month, and a plant
 *   that has to print thirty-one sheets prints none.
 *
 *   A *single visit* sheet gives each point room for a reading and a remark.
 *   That is what a yearly overhaul list needs, where the answer is a
 *   measurement rather than a tick.
 *
 * The default follows the frequency, and the toggle is there because the
 * maintenance manager will sometimes want the other one.
 */

/** How many visits fit on one round sheet, by frequency. */
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
 * Numbers everywhere the period has no name - day 1 to 31, week 1 to 5. The
 * monthly sheet is the exception: its twelve columns are the twelve months, and
 * heading them 1 to 12 asks the person filling it in to count across to find
 * September. The initials are read at a glance instead.
 *
 * J, M and A repeat, which is how every wall planner does it: the columns are
 * in order and always will be, so position resolves it.
 */
const HEADINGS = {
  Monthly: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
};

const headingsFor = (frequency, count) =>
  HEADINGS[frequency] || Array.from({ length: count }, (_, i) => String(i + 1));

/** What one round sheet covers, in the words printed on it. */
const PERIOD = {
  Daily: "One month — one column per day",
  Weekly: "One month — one column per week",
  Monthly: "One year — one column per month",
  Quarterly: "One year — one column per quarter",
  "Half-Yearly": "One year — one column per half",
  Yearly: "One visit",
};

const day = (v) => {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

/**
 * The points, numbered, in the order they were written.
 *
 * Order is not cosmetic on a checklist. A round is walked in a sequence - down
 * one side of the machine and back up the other - and a list sorted by anything
 * other than the order somebody wrote it in sends the inspector back and forth
 * across the machine, which is how points get skipped.
 *
 * They used to be grouped under section headings. The sections are gone: they
 * repeated what the points already said, and each heading row cost a line on a
 * sheet that has none to spare.
 */
const numbered = (points = []) => points.map((p, i) => ({ ...p, n: i + 1 }));

const ChecklistSheet = ({ checklist, onClose }) => {
  const columns = COLUMNS[checklist.frequency] ?? 1;

  const [layout, setLayout] = useState(columns > 1 ? "round" : "single");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Numbered across the whole sheet rather than restarting per section, so
   * "point 14 was not done" means one thing.
   *
   * Numbered here, before grouping, rather than by a counter the rows call as
   * they render. That is what it used to do - `let n = 0` and `() => ++n` -
   * and mutating a variable during render is exactly what React does not allow:
   * under StrictMode the render runs twice, both passes share the counter, and
   * the printed sheet came out numbered 2, 6, 7, 8, 11, 12, 15. A checklist
   * whose numbers skip is worse than one with no numbers, because "point 14"
   * then refers to nothing.
   */
  const points = numbered(checklist.points);

  /**
   * Only the daily sheet asks which shift.
   *
   * A daily round is walked every shift, so the box is the one thing that tells
   * two sheets from the same machine apart. Everything less frequent is done in
   * the morning shift, so a shift box on a monthly sheet is a blank somebody
   * has to be told to ignore.
   */
  const isDaily = checklist.frequency === "Daily";

  /**
   * Rendered into `document.body`, outside the React root, and printed alone.
   *
   * The console does not disappear when this modal opens - the sidebar, the
   * navbar and the page underneath are all still in the DOM behind it, and with
   * no print stylesheet the browser printed the lot: several pages of console
   * before the sheet, which is what "the print does not come properly" was.
   *
   * A portal puts the sheet beside `#root` rather than inside it, so the print
   * rules in index.css can hide the whole application with one selector and be
   * certain nothing of it is left. Doing it with `visibility: hidden` on the
   * console instead leaves its boxes occupying space, and the sheet comes out
   * after a run of blank pages.
   */
  return createPortal(
    <div className="print-sheet fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 print:bg-white print:static print:overflow-visible">
      <div className="mx-auto my-6 max-w-[297mm] print:my-0 print:max-w-none">
        <div className="flex flex-wrap justify-end items-center gap-2 mb-2 print:hidden">
          {columns > 1 && (
            <div className="tabs mr-auto">
              <button
                className={`tab ${layout === "round" ? "tab-active" : ""}`}
                onClick={() => setLayout("round")}
              >
                {PERIOD[checklist.frequency]}
              </button>
              <button
                className={`tab ${layout === "single" ? "tab-active" : ""}`}
                onClick={() => setLayout("single")}
              >
                One visit, with readings
              </button>
            </div>
          )}
          <button className="btn btn-sm btn-primary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print / save as PDF
          </button>
          <button className="btn btn-sm btn-neutral" onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </button>
        </div>

        {layout === "round" && columns > 1 && (
          <p className="mb-2 text-xs text-slate-500 print:hidden">
            Prints landscape, {columns} columns across.
          </p>
        )}

        {/*
          The sheet sets its own page size and orientation.

          There was no @page rule anywhere, so a thirty-one column daily sheet
          printed onto portrait A4 and came out unreadable unless the person
          remembered to change the dialog - which is what the "Print landscape"
          hint above was asking them to do. A form that depends on the operator
          getting the print dialog right is a form that gets printed wrong.
        */}
        <style>{`@page { size: A4 ${
          layout === "round" && columns > 1 ? "landscape" : "portrait"
        }; margin: 10mm; }`}</style>

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
              <p className="text-xs text-slate-600">
                Rev {checklist.revision}
                {checklist.effectiveFrom ? ` · from ${day(checklist.effectiveFrom)}` : ""}
              </p>
            </div>
          </div>

          <Grid>
            <Cell
              label={checklist.assetKind === "electrical" ? "Electrical System" : "Machine"}
              value={`${checklist.assetName} (${checklist.asset})`}
              span={2}
            />
            {/* Plant fills the row now. "Area / Section" was next to it and is
                gone: the plant does not use the term, so the box was a heading
                nobody could fill in. The column is still on the checklist
                record, fetched from the machine - this is the printed sheet. */}
            <Cell label="Plant" value={checklist.plant} span={2} />
            <Cell label="Checklist" value={checklist.title} span={2} />
            {/* Month and year are written in by hand. Printing today's date on a
                sheet that will be pinned up and used for the next four weeks is
                how a sheet ends up filed under the wrong month.

                "Done by" and "Takes about" used to sit here. They told whoever
                picked the sheet up something they already knew, on a form with
                no room to spare. Both are still on the checklist record - this
                is the printed sheet, not the data. */}
            <Cell label="Month / period" value="" span={isDaily ? 1 : 2} />
            {/* Daily only. The span above closes the row up when it is gone, so
                the grid stays a full rectangle rather than a box with a hole. */}
            {isDaily && <Cell label="Shift" value="" span={1} />}
          </Grid>

          {/*
            Isolation and permits, in a box at the top.
            Printed here rather than as a point halfway down, because it has to
            be read before anybody starts and not when they reach item nine.
          */}
          {checklist.safetyNote && (
            <div className="mt-3 border-2 border-slate-800 p-2">
              <p className="text-[10px] font-bold uppercase tracking-wider">Before you start</p>
              <p className="text-sm whitespace-pre-wrap">{checklist.safetyNote}</p>
            </div>
          )}

          {(checklist.points || []).length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">
              This checklist has no points yet. Add them before printing it — a blank sheet gets
              signed as readily as a full one.
            </p>
          ) : layout === "round" && columns > 1 ? (
            <table className="w-full border-collapse text-[11px] mt-3">
              <thead>
                <tr className="bg-slate-100">
                  <Th className="w-8">#</Th>
                  <Th>What to check</Th>
                  {headingsFor(checklist.frequency, columns).map((label, i) => (
                    <Th key={i} className="w-6 text-center">
                      {label}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <RoundRow key={p.n} point={p} columns={columns} />
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse text-sm mt-3">
              <thead>
                <tr className="bg-slate-100">
                  <Th className="w-8">#</Th>
                  <Th>What to check</Th>
                  <Th className="w-44">How</Th>
                  <Th className="w-24">Reading / OK</Th>
                  <Th className="w-40">Remarks</Th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <SingleRow key={p.n} point={p} />
                ))}
              </tbody>
            </table>
          )}

          <Section title="Anything found, and what was done about it" />
          <div className="border border-slate-300 p-2 break-inside-avoid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border-b border-dotted border-slate-300 h-6" />
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            Anything that fails a check and is not fixed on the spot should be raised as a
            maintenance request — or a breakdown, if the machine has to stop.
          </p>

          {/* --- signatures --- */}
          <div className="mt-6 grid grid-cols-3 gap-6 break-inside-avoid">
            <Sign role="Checked by" />
            <Sign role="Shift in-charge" />
            <Sign role="Maintenance manager" />
          </div>

          <div className="mt-4 flex items-end justify-between border-t border-slate-300 pt-2">
            <p className="text-[10px] text-slate-500">
              {checklist.notes || "Tick each point when done. A blank means it was not checked."}
            </p>
            {/* The revision, in the footer where an auditor looks for it. A
                signed sheet with no revision on it cannot be matched to the list
                that was current when it was signed. */}
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

/** One point on the round sheet. */
const RoundRow = ({ point: p, columns }) => (
  <tr>
    <Td className="text-center">{p.n}</Td>
    <Td>
      {/* A safety point is marked, and stays marked. They are the first
          casualty of a list somebody decided was too long. */}
      {p.isSafety && <span className="font-bold mr-1">&#9888;</span>}
      {p.point}
      {p.howToCheck && <span className="text-slate-500"> &mdash; {p.howToCheck}</span>}
    </Td>
    {Array.from({ length: columns }).map((_, c) => (
      <Td key={c} className="h-7" />
    ))}
  </tr>
);

/** One point on the single-visit sheet, where the answer is a reading. */
const SingleRow = ({ point: p }) => (
  <tr>
    <Td className="text-center">{p.n}</Td>
    <Td>
      {p.isSafety && <span className="font-bold mr-1">&#9888;</span>}
      {p.point}
    </Td>
    <Td className="text-xs">{p.howToCheck || ""}</Td>
    <Td className="h-9" />
    <Td />
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

const Td = ({ children, className = "" }) => (
  <td className={`border border-slate-300 px-2 py-1 ${className}`}>{children}</td>
);

const Sign = ({ role }) => (
  <div>
    <div className="h-10 border-b border-slate-800" />
    <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{role}</p>
    <p className="text-[10px] text-slate-400">Name &amp; date</p>
  </div>
);

export default ChecklistSheet;
