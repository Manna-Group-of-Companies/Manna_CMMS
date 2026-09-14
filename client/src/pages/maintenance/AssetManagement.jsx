import { useState } from "react";
import { Factory, Zap } from "lucide-react";

import AssetRegister from "./AssetRegister";
import ElectricalSystems from "./ElectricalSystems";

/**
 * Asset management: the machines and the electrical plant, in one place.
 *
 * They were two sidebar entries, which put a wall between things that are the
 * same job — recording what the company owns and what it is made of. Somebody
 * tracing why a press keeps tripping needs the press and the panel that feeds
 * it, and having to leave one screen for the other is how the connection gets
 * missed.
 *
 * They stay separate *tabs* rather than one merged list because their records
 * genuinely differ: a machine has a nameplate, an electrical system has a
 * supply and a licence. Flattening them was the mistake that made electrical
 * plant unrecordable in the first place.
 */

const TABS = [
  { key: "machines", label: "Machines", icon: Factory },
  { key: "electrical", label: "Electrical", icon: Zap },
];

const AssetManagement = ({ initialTab = "machines" }) => {
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="space-y-4">
      <div className="tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`tab inline-flex items-center gap-1.5 ${tab === key ? "tab-active" : ""}`}
            aria-current={tab === key ? "page" : undefined}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Mounted one at a time on purpose: each fetches its own list, and
          keeping the hidden one alive would have both polling ERPNext for a
          screen nobody is looking at. */}
      {tab === "machines" ? <AssetRegister /> : <ElectricalSystems />}
    </div>
  );
};

export default AssetManagement;
