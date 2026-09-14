import { useSearchParams } from "react-router-dom";

import ChecklistSheet from "./ChecklistSheet";

/**
 * The printed checklist sheet, with stand-in content, so the *format* can be
 * reviewed without signing in and without a real checklist.
 *
 * It renders the real `ChecklistSheet`, not a copy of it. A mock-up of a form
 * is worth very little: the thing people argue about is column widths, how many
 * tick boxes fit, whether the signature block survives the page break - and a
 * replica drifts from the real sheet the moment either is edited, so the review
 * ends up being of a document nobody will ever print.
 *
 * Development only. `App.jsx` mounts this behind `import.meta.env.DEV`, so it
 * is not in a production build and there is no unauthenticated route to it on a
 * deployed site.
 *
 *     /sheet-preview?frequency=Daily     the tick-grid layout
 *     /sheet-preview?frequency=Yearly    the single-visit layout
 *
 * Which of the two layouts appears follows the frequency, exactly as it does
 * for a real checklist - Yearly is the only one that defaults to single-visit.
 */

/**
 * Enough points, in enough shapes, to show what the layout does with them.
 *
 * A point is a check and a method now - no section, no acceptance criterion -
 * so the sample carries only those.
 */
const POINTS = [
  {
    point: "Machine isolated and locked out before opening any guard",
    howToCheck: "Isolator off, lock fitted, key held by the person working",
    isSafety: 1,
  },
  {
    point: "Gearbox oil level",
    howToCheck: "Sight glass, machine stopped",
  },
  {
    point: "Grease main bearings",
    howToCheck: "Grease gun, 3 shots each",
  },
  {
    // Deliberately long: a point that wraps is what pushes a sheet onto a
    // second page, so the review has to be able to see one.
    point:
      "Check the drive chain tension and lubricate the full length of the chain, including the return run behind the guard",
    howToCheck: "Deflection at mid-span, chain oil",
  },
  {
    point: "Panel free of dust, doors closing fully",
    howToCheck: "Visual",
  },
  {
    point: "Motor temperature by hand after 30 minutes running",
    howToCheck: "Back of hand on motor body",
  },
  {
    point: "Unusual noise or vibration from the drive end",
    howToCheck: "Listen with the guard on",
  },
  {
    point: "Coupling rubber condition",
    howToCheck: "Visual, machine stopped",
  },
  {
    point: "Area around the machine clear, no oil on the floor",
  },
  {
    // No section: the sheet has to cope with points that belong to no block.
    point: "Emergency stop tested and machine restarts only after reset",
    isSafety: 1,
  },
];

const SAMPLE = {
  id: "PMC-00000",
  title: "Sample checklist - format review only",
  asset: "MRP-CRK-01",
  assetName: "Cracker Mill 1",
  assetKind: "machine",
  plant: "Manna Rubber Products",
  area: "Size Reduction",
  responsibility: "Operator",
  estimatedMinutes: 20,
  revision: "1",
  effectiveFrom: "2026-09-01",
  safetyNote:
    "Isolate at the local isolator and fit a personal lock before opening any guard. The mill coasts for about 40 seconds after power is removed - wait for it to stop.",
  notes: "Tick each point when done. A blank means it was not checked.",
  points: POINTS,
};

const ChecklistSheetPreview = () => {
  const [params] = useSearchParams();
  const frequency = params.get("frequency") || "Daily";

  /**
   * `?points=40` repeats the sample until there are that many.
   *
   * A ten-point sheet fits on one page, so it cannot show whether a longer one
   * continues correctly - whether the day numbers repeat at the top of page
   * two, and whether a point ever gets cut in half by the break. That is the
   * case worth testing, and it needs a sheet long enough to reach it.
   */
  const wanted = Math.min(Number(params.get("points")) || POINTS.length, 200);
  const points = Array.from({ length: wanted }, (_, i) => POINTS[i % POINTS.length]);

  return (
    <>
      {/*
        Stand-in console behind the sheet.

        Not decoration. Printing from the application prints whatever is in the
        DOM, and the bug being fixed here was the sidebar and the page under the
        modal coming out ahead of the sheet. A preview with nothing behind it
        cannot reproduce that, so it would have proved the fix worked when it
        did not. This is inside #root; the sheet is portalled out of it, so a
        correct print shows the sheet and none of this.
      */}
      <div className="flex min-h-screen">
        <aside className="w-64 shrink-0 bg-charcoal-900 p-4 text-slate-300">
          <p className="mb-4 font-bold text-white">CMMS</p>
          {["Engineering Stock", "Breakdowns", "Preventive Maintenance", "Asset Management"].map(
            (label) => (
              <p key={label} className="py-2 text-[13px]">
                {label}
              </p>
            )
          )}
        </aside>
        <main className="flex-1 p-6">
          <h1 className="text-xl font-bold">Preventive Maintenance</h1>
          <p className="text-sm text-slate-600">
            Stand-in page. If any of this appears in the print, the fix is wrong.
          </p>
          {Array.from({ length: 30 }).map((_, i) => (
            <p key={i} className="py-2 text-sm text-slate-400">
              Console row {i + 1} — must not print.
            </p>
          ))}
        </main>
      </div>

      <ChecklistSheet
        checklist={{
          ...SAMPLE,
          points,
          frequency,
          title: `Sample ${frequency.toLowerCase()} checklist`,
        }}
        onClose={() => {}}
      />
    </>
  );
};

export default ChecklistSheetPreview;
