import { useEffect } from "react";
import { Printer, X } from "lucide-react";

/**
 * The maintenance work sheet — one page per request, printed and signed.
 *
 * The same sheet the breakdown record produces, adapted to a planned job: no
 * stoppage, no downtime, no root cause, and materials by length and weight
 * rather than spares by piece.
 *
 * What the system already knows is printed in; what only the people who did the
 * work can attest to is left as ruled lines and signature blocks. That split is
 * the whole design. A sheet that reprints everything leaves nothing to sign
 * for, and a sheet that prints nothing makes the crew copy out what the system
 * already holds — and copied figures are where the two records start to differ.
 *
 * Blank rows are always left under the materials and the crew, because a sheet
 * is carried to the job and things get used that nobody predicted. That matters
 * more on a fabrication job than on a repair: what a guard actually took is
 * rarely what somebody estimated it would take.
 *
 * It comes back as a scan attached to the request. The paper is the signed
 * original; the record is the searchable copy.
 */

const when = (v) => {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const day = (v) => {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const hours = (h) => {
  if (h === null || h === undefined || h === "") return "";
  const n = Number(h);
  if (!Number.isFinite(n)) return "";
  if (n < 1) return `${Math.round(n * 60)} min`;
  if (n < 72) return `${Math.round(n * 10) / 10} hr`;
  return `${Math.round(n / 24)} days`;
};

/** Enough rows that the sheet is usable at the job, not just a printout. */
const padTo = (rows, n) => [...rows, ...Array(Math.max(0, n - rows.length)).fill(null)];

const MaintenanceLogSheet = ({ record, onClose }) => {
  // Escape closes it, because it opens over everything and a print preview is
  // the next thing most people reach for.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const crew = padTo(record.workedBy || [], 6);
  const materials = padTo(record.materials || [], 8);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 print:bg-white print:static print:overflow-visible">
      <div className="mx-auto my-6 max-w-[210mm] print:my-0 print:max-w-none">
        <div className="flex justify-end gap-2 mb-2 print:hidden">
          <button className="btn btn-sm btn-primary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print / save as PDF
          </button>
          <button className="btn btn-sm btn-neutral" onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </button>
        </div>

        <div className="bg-white p-8 shadow-xl print:shadow-none print:p-0 text-slate-900">
          {/* --- heading --- */}
          <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Maintenance Work Sheet</h1>
              <p className="text-xs text-slate-600">
                Manna Group &middot; Manna CMMS
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-lg font-bold">{record.id}</p>
              <p className="text-xs text-slate-600">{record.plant}</p>
            </div>
          </div>

          {/* --- the job --- */}
          <Grid>
            <Cell label="Work" value={record.title} span={2} />
            <Cell label="Type" value={record.requestType} />
            <Cell label="Priority" value={record.priority} />
            <Cell
              label="Machine / location"
              value={record.machine ? `${record.machineName} (${record.machine})` : record.plant}
              span={2}
            />
            <Cell label="Area" value={record.area} />
            <Cell label="Wanted by" value={day(record.neededBy)} />
            <Cell label="Requested by" value={record.requestedBy} span={2} />
            <Cell label="Raised on" value={when(record.requestedAt)} span={2} />
            <Cell label="Work started" value={when(record.startedAt)} span={2} />
            <Cell label="Completed" value={when(record.completedAt)} span={2} />
          </Grid>

          <Section title="What was asked for" />
          <Written text={record.whatIsNeeded} lines={2} />

          <Section title="Work carried out" />
          <Written text={record.workDone} lines={5} />

          {/* --- materials --- */}
          <Section title="Materials and items used" />
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100">
                <Th className="w-10">#</Th>
                <Th>Description</Th>
                <Th className="w-28">Item code</Th>
                <Th className="w-16">Qty</Th>
                <Th className="w-16">Unit</Th>
                <Th className="w-28">Issued by</Th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m, i) => (
                <tr key={i}>
                  <Td className="text-center">{i + 1}</Td>
                  <Td>{m?.description || ""}</Td>
                  <Td className="font-mono text-xs">{m?.itemCode || ""}</Td>
                  <Td className="text-center">{m?.qty || ""}</Td>
                  <Td className="text-center">{m?.uom || ""}</Td>
                  <Td />
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-500">
            Anything used that is not printed above goes in a blank row, with the unit.
          </p>

          {/* --- the team --- */}
          <Section title="Labour" />
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100">
                <Th className="w-10">#</Th>
                <Th>Name</Th>
                <Th className="w-32">Role</Th>
                <Th className="w-20">Hours</Th>
                <Th className="w-40">Signature</Th>
              </tr>
            </thead>
            <tbody>
              {crew.map((w, i) => (
                <tr key={i}>
                  <Td className="text-center">
                    {/* The first row is the team leader on every sheet, so there
                        is never a question of who was in charge. */}
                    {i === 0 ? "L" : i + 1}
                  </Td>
                  <Td>{w?.name || ""}</Td>
                  <Td>{i === 0 ? w?.role || "Team leader" : w?.role || ""}</Td>
                  <Td className="text-center">{w?.hours || ""}</Td>
                  <Td className="h-9" />
                </tr>
              ))}
              <tr>
                <Td />
                <Td className="text-right font-semibold">Total person-hours</Td>
                <Td />
                <Td className="text-center font-semibold">{record.labourHours || ""}</Td>
                <Td />
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-500">
            Row marked L is the team leader. Everyone who worked on the job signs.
          </p>

          {/* --- closing --- */}
          <Section title="Accepted by the requester" />
          <Written text={record.closingRemarks} lines={2} />
          <p className="mt-1 text-[10px] text-slate-500">
            {record.closedAt
              ? `Closed ${when(record.closedAt)} by ${record.closedBy}${
                  record.satisfied ? "" : " — recorded as not to satisfaction"
                }.`
              : "The person who raised this request signs here to accept the work."}
          </p>

          {/* --- signatures --- */}
          <div className="mt-6 grid grid-cols-3 gap-6">
            <Sign role="Team leader" />
            <Sign role="Maintenance manager" />
            <Sign role="Requested by" />
          </div>

          {/*
            The maintenance head last, and set apart. The others sign for the
            work; this one signs for the sheet itself — that the procedure was
            followed and the paper says what happened.
          */}
          <div className="mt-6 border-2 border-slate-800 p-3">
            <p className="text-xs font-bold uppercase tracking-wider">
              Verified by the maintenance head
            </p>
            <p className="text-[11px] text-slate-600 mb-6">
              I have read this sheet and confirm the work and the materials are as recorded.
            </p>
            <div className="grid grid-cols-3 gap-6">
              <Sign role="Name" bare />
              <Sign role="Signature" bare />
              <Sign role="Date" bare />
            </div>
          </div>

          <p className="mt-4 text-[10px] text-slate-500">
            Printed from {record.id}
            {record.turnaroundHours ? ` · turnaround ${hours(record.turnaroundHours)}` : ""}. Sign,
            scan, and attach the scan to this request in Manna CMMS.
          </p>
        </div>
      </div>
    </div>
  );
};

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

/**
 * Printed where the system knows it, ruled lines where it does not.
 *
 * A field the record already holds is never left blank for somebody to copy out
 * by hand — copied figures are where the paper and the record start to differ.
 */
const Written = ({ text, lines }) =>
  text ? (
    <p className="text-sm border border-slate-300 p-2 whitespace-pre-wrap min-h-[3rem]">{text}</p>
  ) : (
    <div className="border border-slate-300 p-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="border-b border-dotted border-slate-300 h-6" />
      ))}
    </div>
  );

const Th = ({ children, className = "" }) => (
  <th className={`border border-slate-300 px-2 py-1 text-left text-[11px] font-semibold ${className}`}>
    {children}
  </th>
);

const Td = ({ children, className = "" }) => (
  <td className={`border border-slate-300 px-2 py-1 h-8 ${className}`}>{children}</td>
);

const Sign = ({ role, bare }) => (
  <div>
    <div className="h-10 border-b border-slate-800" />
    <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{role}</p>
    {!bare && <p className="text-[10px] text-slate-400">Name &amp; date</p>}
  </div>
);

export default MaintenanceLogSheet;
