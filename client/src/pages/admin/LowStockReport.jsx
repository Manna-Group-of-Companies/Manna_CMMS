import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import API from "../../services/api";
import { useAuth, MAINTENANCE_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import useStockRooms from "../../hooks/useStockRooms";
import { formatCurrency } from "../../utils/currency";
import { reorderCostOf, severityOf, shortageOf } from "../../utils/lowStock";
import PurchaseRequestModal from "./PurchaseRequestModal";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  CheckCircle,
  Download,
  Loader2,
  PackageX,
  Search,
  ShoppingCart,
  TrendingDown,
} from "lucide-react";

/**
 * Whether a shortfall can go on a purchase request at all.
 *
 * SAP buys against its own item code, so an item it has not created yet cannot
 * be asked for - it would be a line naming something the purchase manager
 * cannot raise a PO against.
 */
const requestable = (product) =>
  Boolean(product?.sap?.code) && Boolean(product?.sapCategory?.company);

const SEVERITIES = [
  { key: "", label: "All Severities" },
  { key: "out", label: "Out of Stock" },
  { key: "critical", label: "Critical (half the minimum or less)" },
  { key: "warning", label: "Warning" },
];

/** The columns of the table: header label, alignment, and the value a sort on
    that column reads. Order here is the order on screen. */
const COLUMNS = [
  { key: "code", label: "Code", text: true, value: (p) => String(p.code || "").toLowerCase() },
  {
    key: "name",
    label: "Engineering Stock",
    text: true,
    value: (p) => String(p.name || "").toLowerCase(),
  },
  {
    key: "category",
    label: "Category",
    text: true,
    value: (p) => String(p.category || "").toLowerCase(),
  },
  // SAP's U_SubTypeA and U_SubTypeB, A first: A is how the store looks things up.
  {
    key: "subCategory",
    label: "Sub-category A",
    text: true,
    value: (p) => String(p.subCategory || "").toLowerCase(),
  },
  {
    key: "subCategoryB",
    label: "Sub-category B",
    text: true,
    value: (p) => String(p.subCategoryB || "").toLowerCase(),
  },
  {
    key: "storeRoom",
    label: "Company",
    text: true,
    value: (p) => String(p.storeRoom || "").toLowerCase(),
  },
  {
    key: "rackNumber",
    label: "Rack",
    text: true,
    value: (p) => String(p.rackNumber || "").toLowerCase(),
  },
  { key: "quantity", label: "In Stock", align: "text-right", value: (p) => Number(p.quantity) || 0 },
  { key: "minStock", label: "Minimum", align: "text-right", value: (p) => Number(p.minStock) || 0 },
  { key: "shortage", label: "Shortage", align: "text-right", value: shortageOf },
  { key: "cost", label: "Reorder Cost", align: "text-right", value: reorderCostOf },
  { key: "severity", label: "Severity", align: "text-right", value: (p) => severityOf(p).rank },
];

/** A sortable header cell. Clicking the active column flips its direction. */
const SortHeader = ({ column, sort, onSort }) => {
  const active = sort.key === column.key;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th className={column.align || ""}>
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-1 cursor-pointer hover:text-slate-900 ${
          active ? "text-slate-900" : ""
        } ${column.align === "text-right" ? "flex-row-reverse" : ""}`}
        title={`Sort by ${column.label}`}
      >
        {column.label}
        <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
    </th>
  );
};

/** One labelled line inside a phone card: a table cell carrying the column
    header it lost when the table was taken away. */
const CardRow = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3 py-1.5">
    <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {label}
    </dt>
    <dd className="min-w-0 text-right text-[13px] text-slate-800">{children}</dd>
  </div>
);

/**
 * Every item at or below its minimum, in one table.
 *
 * The catalog mixes the shortfalls in with the several thousand items that are
 * fine, and the dashboard panel that used to show the worst five is gone with
 * the dashboard — so this is now the only place the shortfalls are read. It is
 * the whole list, row by row and column by column — what is on the shelf, what it
 * should be, how many units are missing and what buying them back costs —
 * sortable on any of those and exportable, so the same rows go out as the
 * purchase list.
 */
const LowStockReport = () => {
  const rooms = useStockRooms();
  const { user } = useAuth();
  const { showToast } = useNotifications();
  // Mirrors the server's guard on POST /purchase-requests.
  const canRequest = user?.role === MAINTENANCE_MANAGER;

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  // Ticked shortfalls, by item code - codes rather than rows, so a background
  // refresh that replaces every object leaves the ticks where they were.
  const [picked, setPicked] = useState(() => new Set());
  const [requesting, setRequesting] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStoreRoom, setSelectedStoreRoom] = useState("");
  const [severity, setSeverity] = useState("");
  // Worst first, which is the order the list is read in.
  const [sort, setSort] = useState({ key: "severity", dir: "desc" });

  /** [silent] is used by the background poll: no spinner, no error toast. */
  const fetchLowStock = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      // The same `stockStatus=low` the catalog filter uses. Deciding
      // `quantity <= minStock` on the server is what keeps this page and the
      // catalog filter agreeing on one number.
      const { data } = await API.get("/products", { params: { stockStatus: "low" } });
      setProducts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error loading low stock:", error);
      if (!silent) showToast("Could not load the low stock list", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLowStock();
  }, []);

  // Issues and stock-ins move these quantities all day, so the list re-reads
  // in the background like the rest of the console.
  useAutoRefresh(() => fetchLowStock({ silent: true }));

  const handleSort = (key) => {
    const column = COLUMNS.find((c) => c.key === key);
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : // Text opens A-Z; a number opens at its largest, which for every
          // numeric column here means the worst shortfall first.
          { key, dir: column?.text ? "asc" : "desc" },
    );
  };

  /** Search and the two selects are applied here rather than re-fetched: the
      whole low-stock set is already in hand and is small enough to filter. */
  const rows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    const filtered = products.filter((product) => {
      if (selectedStoreRoom && product.storeRoom !== selectedStoreRoom) return false;
      if (severity && severityOf(product).key !== severity) return false;
      if (!term) return true;
      return [
        product.code,
        product.name,
        product.category,
        product.subCategory,
        product.subCategoryB,
        product.rackNumber,
      ].some((field) => String(field || "").toLowerCase().includes(term));
    });

    const column = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[COLUMNS.length - 1];
    const direction = sort.dir === "asc" ? 1 : -1;

    return [...filtered].sort((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      // A stable tie-break on the code, so rows of equal severity do not
      // shuffle under the reader between polls.
      if (left === right) return String(a.code || "").localeCompare(String(b.code || ""));
      return left > right ? direction : -direction;
    });
  }, [products, searchTerm, selectedStoreRoom, severity, sort]);

  /**
   * The ticked shortfalls, and the one SAP company a request may cover.
   *
   * Read out of the full list rather than the visible rows, so narrowing the
   * search does not quietly drop items from a basket already gathered.
   *
   * A purchase request is raised against one SAP company - the purchase
   * manager turns it into a PO in that company's database - so the first tick
   * decides the company and the rest of the list locks to it. Enforced at the
   * tick rather than at the button: being told why a row cannot join is worth
   * more than being told at the end that the basket is wrong.
   */
  const chosen = useMemo(() => products.filter((p) => picked.has(p.code)), [products, picked]);
  const lockedCompany = chosen[0]?.sapCategory?.company || "";

  const whyNotPickable = (product) => {
    if (!requestable(product)) return "Not in SAP yet, so it cannot be put on a request";
    if (lockedCompany && product.sapCategory.company !== lockedCompany) {
      return `A request covers one SAP company, and ${lockedCompany} is already picked`;
    }
    return "";
  };

  const togglePicked = (code) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  // Nothing ticked yet? The first requestable row on screen decides which
  // company "all of them" means.
  const sweepCompany = lockedCompany || rows.find(requestable)?.sapCategory?.company || "";
  const sweepable = rows.filter(
    (p) => requestable(p) && p.sapCategory.company === sweepCompany
  );
  const allSwept = sweepable.length > 0 && sweepable.every((p) => picked.has(p.code));

  const toggleSweep = () =>
    setPicked((prev) => {
      if (prev.size > 0) return new Set();
      return new Set(sweepable.map((p) => p.code));
    });

  /** Counted off the full list, not the filtered rows: the tiles are the size
      of the problem, and a search should not appear to shrink it. */
  const totals = useMemo(
    () =>
      products.reduce(
        (acc, product) => {
          acc[severityOf(product).key] += 1;
          acc.cost += reorderCostOf(product);
          return acc;
        },
        { out: 0, critical: 0, warning: 0, cost: 0 },
      ),
    [products],
  );

  /** The visible rows, as the purchase list. Built here rather than on the
      server: the rows are already in the page and nothing else needs them. */
  const exportCsv = () => {
    if (rows.length === 0) {
      showToast("Nothing to export", "error");
      return;
    }

    const header = [
      "Code",
      "Engineering Stock",
      "Category",
      "Sub-category A",
      "Sub-category B",
      "Company",
      "Rack",
      "In Stock",
      "Minimum",
      "Shortage",
      "Unit",
      "Unit Cost",
      "Reorder Cost",
      "Severity",
    ];

    // Quoted and doubled: item names carry commas and the odd inch mark.
    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

    const body = rows.map((product) =>
      [
        product.code,
        product.name,
        product.category,
        product.subCategory,
        product.subCategoryB,
        product.storeRoom,
        product.rackNumber,
        product.quantity ?? 0,
        product.minStock ?? 0,
        shortageOf(product),
        product.unit,
        product.unitCost ?? 0,
        reorderCostOf(product),
        severityOf(product).label,
      ]
        .map(escape)
        .join(","),
    );

    const csv = [header.map(escape).join(","), ...body].join("\r\n");
    // The BOM is what makes Excel read the file as UTF-8 rather than as the
    // local codepage, which otherwise mangles every non-ASCII item name.
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `low-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    // In the document for the click: a detached anchor is ignored by some
    // browsers, which drops the download without erroring anywhere.
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick rather than straight away — revoking while the
    // browser is still reading the blob cancels the save.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`, "success");
  };

  const tiles = [
    {
      label: "Low Stock Items",
      value: products.length,
      hint: "At or below minimum",
      icon: AlertTriangle,
      chip: "bg-amber-50 text-amber-600 border-amber-500/20",
    },
    {
      label: "Out of Stock",
      value: totals.out,
      hint: "Nothing on the shelf",
      icon: PackageX,
      chip: "bg-rose-50 text-rose-600 border-rose-500/20",
    },
    {
      label: "Critical",
      value: totals.critical,
      hint: "Half the minimum or less",
      icon: TrendingDown,
      chip: "bg-orange-50 text-orange-600 border-orange-500/20",
    },
    {
      label: "Reorder Value",
      value: formatCurrency(totals.cost),
      hint: "To refill every shortfall",
      icon: Download,
      chip: "bg-brand-50 text-brand-700 border-brand-500/20",
    },
  ];

  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-brand-500 animate-spin" />
          <span className="text-sm font-medium text-slate-600">Loading low stock...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* The size of the problem, before the rows */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <div key={tile.label} className="card h-full p-4 flex flex-col gap-3">
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${tile.chip}`}
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <div>
                <p className="text-[28px] font-bold leading-none tracking-tight text-slate-900">
                  {tile.value}
                </p>
                <p className="mt-2 text-[12px] font-semibold leading-tight text-slate-700">
                  {tile.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{tile.hint}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Search, filters and the export */}
      <div className="panel">
        <div className="flex-1 w-full flex flex-col 2xl:flex-row 2xl:items-center gap-2.5 min-w-0">
          <div className="relative w-full 2xl:max-w-xs">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 pointer-events-none">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              placeholder="Search code, name, category, rack..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="field field-search"
              aria-label="Search low stock"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 2xl:flex">
            <select
              value={selectedStoreRoom}
              onChange={(e) => setSelectedStoreRoom(e.target.value)}
              className="field field-sm w-full 2xl:w-auto cursor-pointer"
              aria-label="Filter by company"
            >
              <option value="">All Companies</option>
              {rooms.map((room) => (
                <option key={room._id} value={room.name}>
                  {room.name}
                </option>
              ))}
            </select>

            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="field field-sm w-full 2xl:w-auto cursor-pointer"
              aria-label="Filter by severity"
            >
              {SEVERITIES.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex w-full sm:w-auto items-center gap-2">
          <button onClick={exportCsv} className="btn btn-neutral flex-1 sm:flex-none">
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          {canRequest && (
            <button
              onClick={() => setRequesting(true)}
              disabled={chosen.length === 0}
              className="btn btn-primary flex-1 sm:flex-none"
              title={
                chosen.length === 0
                  ? "Tick the shortfalls to put on one request"
                  : `Request ${chosen.length} item${chosen.length === 1 ? "" : "s"} for ${lockedCompany}`
              }
            >
              <ShoppingCart className="h-4 w-4" />
              Purchase request
              {chosen.length > 0 && ` (${chosen.length})`}
            </button>
          )}
          <Link to="/admin/products" className="btn btn-neutral flex-1 sm:flex-none">
            Open Catalog
          </Link>
        </div>
      </div>

      {/* The list */}
      {products.length === 0 ? (
        <div className="empty">
          <CheckCircle className="h-10 w-10 text-emerald-500 mb-3" />
          <h3 className="empty-title">Everything is stocked</h3>
          <p className="empty-sub">No engineering stock is at or below its minimum.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <Search className="h-10 w-10 text-slate-300 mb-3" />
          <h3 className="empty-title">No matching shortfalls</h3>
          <p className="empty-sub">Try adjusting your search query or filters.</p>
        </div>
      ) : (
        <>
          {/* Phone: the same rows, re-laid as cards. Thirteen columns on a 390px
              screen is a sideways scroll and nothing else, so each shortfall
              gets a card and every cell keeps its column header as a label. */}
          <div className="space-y-3 md:hidden">
            {rows.map((product) => {
              const level = severityOf(product);
              const blocked = canRequest ? whyNotPickable(product) : "";
              return (
                <div
                  key={product._id}
                  className={`card p-4 ${picked.has(product.code) ? "ring-1 ring-brand-500/40" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {canRequest && (
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
                        checked={picked.has(product.code)}
                        disabled={Boolean(blocked)}
                        onChange={() => togglePicked(product.code)}
                        aria-label={`Put ${product.name} on a purchase request`}
                        title={blocked || `Put ${product.name} on a purchase request`}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="cell-title break-words leading-snug">{product.name}</div>
                      <div className="mono text-brand-700">{product.code}</div>
                    </div>
                    <span className={`badge ${level.badge} shrink-0`}>{level.label}</span>
                  </div>

                  <dl className="mt-3 divide-y divide-slate-100 border-t border-slate-100 pt-1">
                    <CardRow label="In Stock">
                      <span
                        className={`font-bold ${
                          product.quantity === 0 ? "text-rose-600" : "text-amber-600"
                        }`}
                      >
                        {product.quantity ?? 0}
                      </span>{" "}
                      <span className="text-slate-500">
                        / {product.minStock ?? 0} {product.unit}
                      </span>
                    </CardRow>
                    <CardRow label="Shortage">
                      <span className="font-semibold">
                        {shortageOf(product)} {product.unit}
                      </span>
                    </CardRow>
                    <CardRow label="Reorder Cost">
                      {product.unitCost ? formatCurrency(reorderCostOf(product)) : "—"}
                    </CardRow>
                    <CardRow label="Category">{product.category || "—"}</CardRow>
                    <CardRow label="Sub-category A">{product.subCategory || "—"}</CardRow>
                    {product.subCategoryB && (
                      <CardRow label="Sub-category B">{product.subCategoryB}</CardRow>
                    )}
                    <CardRow label="Company">
                      <span className="badge badge-slate badge-soft">{product.storeRoom}</span>
                    </CardRow>
                    <CardRow label="Rack">
                      <span className="mono text-slate-600">{product.rackNumber || "—"}</span>
                    </CardRow>
                  </dl>
                </div>
              );
            })}
          </div>

          {/* Tablet and up: the full table, one row per shortfall. */}
          <div className="table-card hidden md:block">
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    {canRequest && (
                      <th className="w-10">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-brand-600 align-middle"
                          checked={allSwept}
                          onChange={toggleSweep}
                          disabled={sweepable.length === 0}
                          aria-label="Select the shortfalls on this screen"
                          title={
                            picked.size > 0
                              ? "Clear the selection"
                              : sweepCompany
                                ? `Select every ${sweepCompany} shortfall on this screen`
                                : "Nothing here is in SAP yet"
                          }
                        />
                      </th>
                    )}
                    <th className="text-right">#</th>
                    {COLUMNS.map((column) => (
                      <SortHeader key={column.key} column={column} sort={sort} onSort={handleSort} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((product, index) => {
                    const level = severityOf(product);
                    const blocked = canRequest ? whyNotPickable(product) : "";
                    return (
                      <tr key={product._id} className={picked.has(product.code) ? "bg-brand-50/60" : ""}>
                        {canRequest && (
                          <td>
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-brand-600 align-middle disabled:cursor-not-allowed disabled:opacity-40"
                              checked={picked.has(product.code)}
                              disabled={Boolean(blocked)}
                              onChange={() => togglePicked(product.code)}
                              aria-label={`Put ${product.name} on a purchase request`}
                              title={blocked || `Put ${product.name} on a purchase request`}
                            />
                          </td>
                        )}
                        <td className="text-right text-slate-400">{index + 1}</td>
                        <td className="mono text-brand-700 whitespace-nowrap">{product.code}</td>
                        <td>
                          <div className="cell-title max-w-[280px] truncate" title={product.name}>
                            {product.name}
                          </div>
                        </td>
                        <td className="text-slate-600">{product.category}</td>
                        <td className="text-slate-600">{product.subCategory || "—"}</td>
                        <td className="text-slate-600">{product.subCategoryB || "—"}</td>
                        <td>
                          <span className="badge badge-slate badge-soft">{product.storeRoom}</span>
                        </td>
                        <td className="mono text-slate-600">{product.rackNumber || "—"}</td>
                        <td className="text-right whitespace-nowrap">
                          <span
                            className={`font-bold ${
                              product.quantity === 0 ? "text-rose-600" : "text-amber-600"
                            }`}
                          >
                            {product.quantity ?? 0}
                          </span>{" "}
                          <span className="text-slate-500">{product.unit}</span>
                        </td>
                        <td className="text-right text-slate-600 whitespace-nowrap">
                          {product.minStock ?? 0} {product.unit}
                        </td>
                        <td className="text-right font-semibold text-slate-900 whitespace-nowrap">
                          {shortageOf(product)} {product.unit}
                        </td>
                        <td className="text-right text-slate-600 whitespace-nowrap">
                          {product.unitCost ? formatCurrency(reorderCostOf(product)) : "—"}
                        </td>
                        <td className="text-right">
                          <span className={`badge ${level.badge}`}>{level.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[12px] text-slate-500">
            Showing {rows.length} of {products.length} low stock item
            {products.length === 1 ? "" : "s"}.
            {chosen.length > 0 && (
              <>
                {" "}
                <span className="font-semibold text-slate-700">
                  {chosen.length} picked for {lockedCompany}
                </span>
                {/* The basket survives the filters, so some of it may be off
                    screen - saying so beats a count that looks wrong. */}
                <button
                  type="button"
                  onClick={() => setPicked(new Set())}
                  className="ml-2 font-semibold text-brand-700 underline underline-offset-2 hover:no-underline cursor-pointer"
                >
                  Clear
                </button>
              </>
            )}
          </p>
        </>
      )}

      {requesting && (
        <div className="modal-backdrop">
          <PurchaseRequestModal
            products={chosen.map((p) => ({ ...p, suggestedQty: shortageOf(p) }))}
            onClose={() => setRequesting(false)}
            onSaved={() => {
              setPicked(new Set());
              fetchLowStock({ silent: true });
            }}
          />
        </div>
      )}
    </div>
  );
};

export default LowStockReport;
