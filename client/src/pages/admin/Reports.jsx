import { useSearchParams } from "react-router-dom";
import { AlertTriangle, BarChart3 } from "lucide-react";
import BreakdownReport from "./BreakdownReport";
import LowStockReport from "./LowStockReport";

/**
 * Reports (3 Nov 2026): every report the GM reads, on one screen - the MD, the
 * executive director and the GM asked for them in one place rather than spread
 * across the menu. Each tab is the report page itself, so a figure here is the
 * same figure the maintenance and store screens show. Nothing on it can be
 * acted on: Low Stock offers a purchase request only to the roles that raise
 * one. The open tab is in the address (?tab=), like Settings.
 *
 * Scrap & Consumption and Stock Audits are not here: they still sign in
 * against MongoDB and would only answer with a refusal. They join when they
 * move to ERPNext.
 */
const TABS = [
  { key: "breakdowns", label: "Breakdowns & Downtime", icon: BarChart3, Page: BreakdownReport },
  { key: "low-stock", label: "Low Stock", icon: AlertTriangle, Page: LowStockReport },
];

const Reports = () => {
  const [params, setParams] = useSearchParams();
  const active = TABS.find((t) => t.key === params.get("tab")) || TABS[0];
  const { Page } = active;

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Reports" className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          const selected = t.key === active.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={selected}
              onClick={() => setParams({ tab: t.key }, { replace: true })}
              className={`btn btn-sm ${selected ? "btn-primary" : "btn-neutral"}`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        <Page key={active.key} />
      </div>
    </div>
  );
};

export default Reports;
