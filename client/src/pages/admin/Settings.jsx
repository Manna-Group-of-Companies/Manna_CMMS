import { useSearchParams } from "react-router-dom";
import { FolderTree, HardHat } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { maySee } from "../../config/access";
import Categories from "./Categories";
import Technicians from "../maintenance/Technicians";

/**
 * Settings (23 Oct 2026): adding categories and keeping the maintenance team,
 * on one screen. Each tab keeps the audience it had as a screen of its own, so
 * a role sees only the tabs it may open. The open tab is in the address
 * (?tab=), so the old Categories and Maintenance Team links land on theirs.
 */
const TABS = [
  { key: "categories", view: "categories", label: "Categories", icon: FolderTree, Page: Categories },
  { key: "team", view: "technicians", label: "Maintenance Team", icon: HardHat, Page: Technicians },
];

const Settings = () => {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const tabs = TABS.filter((t) => maySee(user?.role, t.view));
  const active = tabs.find((t) => t.key === params.get("tab")) || tabs[0];

  if (!active) return null;

  const { Page } = active;

  return (
    <div className="space-y-5">
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Settings" className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {tabs.map((t) => {
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
      )}

      <div role="tabpanel">
        <Page key={active.key} />
      </div>
    </div>
  );
};

export default Settings;
