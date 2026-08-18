import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import useStockRooms from "../../hooks/useStockRooms";
import ProductFormModal from "./ProductFormModal";
import CompanyBreakdown from "../../components/CompanyBreakdown";
import { statusTone } from "../../utils/productStatus";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Eye,
  X,
  Boxes,
  Loader2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";

/** The two intake flags. Only shown when they say something: a null
    nameCompliant means "never checked", which is not a finding. */
const ProductFlags = ({ product }) => {
  const offName = product.nameCompliant === false;
  const sapPending = product.sap?.status === "Pending";
  const sapCode = product.sap?.status === "Created" && product.sap.code;
  if (!offName && !sapPending && !sapCode) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {offName && (
        <span className="badge badge-amber badge-soft text-[10px]">Name not SOI1/SOP1</span>
      )}
      {sapPending && (
        <span className="badge badge-indigo badge-soft text-[10px]">Pending SAP</span>
      )}
      {sapCode && (
        <span className="badge badge-emerald badge-soft text-[10px]">SAP {product.sap.code}</span>
      )}
    </div>
  );
};

/** What is on the shelf, over the limit it is judged against. Without the
    limit an amber badge only says "low" — this says how low, and against
    what, without opening the item. */
const StockBadge = ({ product }) => {
  const isLowStock = product.quantity <= product.minStock;
  return (
    <div className="whitespace-nowrap">
      <span
        className={`badge badge-pill ${
          product.quantity === 0 ? "badge-rose" : isLowStock ? "badge-amber" : "badge-emerald"
        }`}
      >
        {isLowStock && <AlertCircle className="h-3 w-3" />}
        {product.quantity} {product.unit}
      </span>
      <div className="text-[11px] text-slate-500 mt-0.5">
        min {product.minStock ?? 0} {product.unit}
      </div>
    </div>
  );
};

/** Details / edit / delete. Shared so the table row and the phone card offer
    the same three actions in the same order. */
const RowActions = ({ product, onOpen }) => (
  <div className="flex items-center justify-end gap-1">
    <button
      onClick={() => onOpen(product, "details")}
      className="icon-btn"
      title="Engineering Stock Details"
      aria-label={`Details for ${product.name}`}
    >
      <Eye className="h-4 w-4" />
    </button>
    <button
      onClick={() => onOpen(product, "form")}
      className="icon-btn icon-btn-brand"
      title="Edit Stock"
      aria-label={`Edit ${product.name}`}
    >
      <Edit className="h-4 w-4" />
    </button>
    <button
      onClick={() => onOpen(product, "delete")}
      className="icon-btn icon-btn-danger"
      title="Delete Engineering Stock"
      aria-label={`Delete ${product.name}`}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  </div>
);

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

const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=100&auto=format&fit=crop";

const ProductList = () => {
  // The companies stock can be filed against, read from the API (ST-33).
  const rooms = useStockRooms();
  const { showToast } = useNotifications();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSubCategory, setSelectedSubCategory] = useState("");
  const [selectedStoreRoom, setSelectedStoreRoom] = useState("");
  const [stockStatus, setStockStatus] = useState("");

  // Modals Toggles
  const [activeModal, setActiveModal] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /** Every row action opens a modal for one product; this is all three. */
  const openModal = (product, modal) => {
    setSelectedProduct(product);
    setActiveModal(modal);
  };

  const handleDelete = async () => {
    try {
      setDeleting(true);
      const { data } = await API.delete(`/products/${selectedProduct._id}`);
      showToast(data.message || "Engineering Stock deleted", "success");
      setActiveModal(null);
      setSelectedProduct(null);
      fetchProducts();
    } catch (error) {
      console.error("Error deleting product:", error);
      showToast(error.response?.data?.message || "Failed to delete engineering stock", "error");
    } finally {
      setDeleting(false);
    }
  };

  /** [silent] is used by the background poll: no spinner, no error toast. */
  const fetchProducts = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const params = {};
      if (searchTerm) params.search = searchTerm;
      if (selectedCategory) params.category = selectedCategory;
      if (selectedSubCategory) params.subCategory = selectedSubCategory;
      if (selectedStoreRoom) params.storeRoom = selectedStoreRoom;
      if (stockStatus) params.stockStatus = stockStatus;

      const { data } = await API.get("/products", { params });
      setProducts(data);
    } catch (error) {
      console.error("Error loading products:", error);
      if (!silent) showToast("Could not load engineering stock list", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data } = await API.get("/products/categories");
      setCategories(data);
    } catch (error) {
      console.error("Error loading categories:", error);
    }
  };

  // Scoped to the chosen category: the catalog has far too many sub-categories
  // for one flat list to be usable.
  const fetchSubCategories = async () => {
    try {
      const { data } = await API.get("/products/subcategories", {
        params: selectedCategory ? { category: selectedCategory } : {},
      });
      setSubCategories(data);
    } catch (error) {
      console.error("Error loading sub-categories:", error);
    }
  };

  /** Picking a category drops a sub-category that no longer belongs to it. */
  const handleCategoryChange = (value) => {
    setSelectedCategory(value);
    setSelectedSubCategory("");
  };

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, [searchTerm, selectedCategory, selectedSubCategory, selectedStoreRoom, stockStatus]);

  useEffect(() => {
    fetchSubCategories();
  }, [selectedCategory]);

  // Supervisors issue stock and raise requests that change these quantities.
  // Paused while a modal is open so an edit form cannot be reset mid-typing.
  useAutoRefresh(() => fetchProducts({ silent: true }), { enabled: !activeModal });



  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Search and Action Bar */}
      <div className="panel">
        <div className="flex-1 w-full flex flex-col 2xl:flex-row 2xl:items-center gap-2.5 min-w-0">
          {/* Search Box */}
          <div className="relative w-full 2xl:max-w-xs">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 pointer-events-none">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              placeholder="Search code, name, category…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="field field-search"
              aria-label="Search engineering stock"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 2xl:flex">
            {/* Category Select */}
            <select
              value={selectedCategory}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="field field-sm w-full 2xl:w-auto cursor-pointer"
              aria-label="Filter by category"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Sub-Category Select */}
            <select
              value={selectedSubCategory}
              onChange={(e) => setSelectedSubCategory(e.target.value)}
              disabled={subCategories.length === 0}
              className="field field-sm w-full 2xl:w-auto cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Filter by sub-category"
            >
              <option value="">All Sub-Categories</option>
              {subCategories.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {/* Company Select */}
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

            {/* Stock Level Select */}
            <select
              value={stockStatus}
              onChange={(e) => setStockStatus(e.target.value)}
              className="field field-sm w-full 2xl:w-auto cursor-pointer col-span-2 md:col-span-1"
              aria-label="Filter by stock level"
            >
              <option value="">All Stock Levels</option>
              <option value="low">Low Stock Alert</option>
              <option value="out">Out of Stock</option>
            </select>
          </div>
        </div>

        <button
          onClick={() => {
            setSelectedProduct(null);
            setActiveModal("form");
          }}
          className="btn btn-primary w-full sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          Add Engineering Stock
        </button>
      </div>

      {/* Catalog Grid / Table */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <div className="empty">
          <HelpCircle className="h-10 w-10 text-slate-300 mb-3" />
          <h3 className="empty-title">No engineering stock found</h3>
          <p className="empty-sub">Try adjusting your search query or filters.</p>
        </div>
      ) : (
        <>
          {/* Phone: the same rows, re-laid as cards. Seven columns on a 390px
              screen is a sideways scroll and nothing else, so each item gets a
              card and every cell keeps its column header as a label. */}
          <div className="space-y-3 md:hidden">
            {products.map((product) => (
              <div key={product._id} className="card p-4">
                <div className="flex items-start gap-3">
                  <img
                    src={product.image || PLACEHOLDER_IMAGE}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-lg border border-slate-200 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="cell-title break-words leading-snug">{product.name}</div>
                    <div className="mono text-brand-700">{product.code}</div>
                    <ProductFlags product={product} />
                  </div>
                </div>

                <dl className="mt-3 divide-y divide-slate-100 border-t border-slate-100 pt-1">
                  <CardRow label="Category">
                    <div>{product.category}</div>
                    {product.subCategory && (
                      <div className="text-[11px] text-slate-500">{product.subCategory}</div>
                    )}
                  </CardRow>
                  <CardRow label="Condition">
                    {product.status ? (
                      <span className={`badge badge-soft ${statusTone(product.status)}`}>
                        {product.status}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </CardRow>
                  <CardRow label="Rack">
                    <span className="mono text-slate-600">{product.rackNumber || "—"}</span>
                  </CardRow>
                  <CardRow label="Company">
                    <span className="badge badge-slate badge-soft">{product.storeRoom}</span>
                  </CardRow>
                </dl>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <StockBadge product={product} />
                  <RowActions product={product} onOpen={openModal} />
                </div>
              </div>
            ))}
          </div>

          {/* Tablet and up: the full table. */}
          <div className="table-card hidden md:block">
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Engineering Stock</th>
                    <th>Category</th>
                    <th>Condition</th>
                    <th>Rack</th>
                    <th>Company</th>
                    <th className="text-center">Stock</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product._id}>
                      <td>
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <img
                            src={product.image || PLACEHOLDER_IMAGE}
                            alt=""
                            className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="cell-title truncate">{product.name}</div>
                            <div className="mono text-brand-700">{product.code}</div>
                            <ProductFlags product={product} />
                          </div>
                        </div>
                      </td>
                      <td className="text-slate-700">
                        <div>{product.category}</div>
                        {product.subCategory && (
                          <div className="text-[11px] text-slate-500">{product.subCategory}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {product.status ? (
                          <span className={`badge badge-soft ${statusTone(product.status)}`}>
                            {product.status}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="mono text-slate-600">{product.rackNumber || "—"}</td>
                      <td>
                        <span className="badge badge-slate badge-soft">{product.storeRoom}</span>
                      </td>
                      <td className="text-center">
                        <StockBadge product={product} />
                      </td>
                      <td>
                        <RowActions product={product} onOpen={openModal} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ==============================================
          MODALS IMPLEMENTATION
          ============================================== */}

      {/* Modal Backdrop */}
      {activeModal && (
        <div className="modal-backdrop">

          {/* 0. Modal: CREATE / EDIT PRODUCT */}
          {activeModal === "form" && (
            <ProductFormModal
              product={selectedProduct}
              onClose={() => setActiveModal(null)}
              onSaved={fetchProducts}
            />
          )}

          {/* 0b. Modal: DELETE CONFIRMATION */}
          {activeModal === "delete" && selectedProduct && (
            <div className="modal max-w-md">
              <div className="modal-head">
                <h3 className="modal-title">Delete Engineering Stock</h3>
                <button onClick={() => setActiveModal(null)} className="modal-close" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="modal-body space-y-4">
                <p className="text-sm text-slate-700">
                  Delete <strong>{selectedProduct.name}</strong> ({selectedProduct.code})?
                </p>
                <div className="note note-rose">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
                  <span>
                    This removes the product and its {selectedProduct.quantity}{" "}
                    {selectedProduct.unit} from every company, and it disappears from the
                    Supervisor catalog. Issue history and past requests are kept for the
                    record. This cannot be undone.
                  </span>
                </div>
              </div>

              <div className="modal-foot">
                <button onClick={() => setActiveModal(null)} className="btn btn-neutral">
                  Cancel
                </button>
                <button onClick={handleDelete} disabled={deleting} className="btn btn-danger">
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Delete Permanently
                </button>
              </div>
            </div>
          )}

          {/* 1. Modal: PRODUCT DETAILS */}
          {activeModal === "details" && selectedProduct && (
            <div className="modal max-w-lg">
              <div className="modal-head">
                <h3 className="modal-title">
                  <Boxes className="h-[18px] w-[18px] text-brand-700" />
                  Engineering Stock Specifications
                </h3>
                <button onClick={() => setActiveModal(null)} className="modal-close" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="modal-body space-y-5">
                <div className="flex gap-4">
                  <img
                    src={selectedProduct.image || PLACEHOLDER_IMAGE}
                    alt=""
                    className="w-20 h-20 shrink-0 rounded-xl object-cover border border-slate-200"
                  />
                  <div className="min-w-0">
                    <h4 className="text-base font-semibold text-slate-900 leading-tight">
                      {selectedProduct.name}
                    </h4>
                    <span className="mono text-brand-700 mt-1 block">
                      CODE: {selectedProduct.code}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="badge badge-slate badge-soft">
                        {selectedProduct.storeRoom}
                      </span>
                      {selectedProduct.status && (
                        <span className={`badge badge-soft ${statusTone(selectedProduct.status)}`}>
                          {selectedProduct.status}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="kv">
                    <span className="kv-label">Category</span>
                    <span className="kv-value">{selectedProduct.category}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">Sub-Category</span>
                    <span className="kv-value">{selectedProduct.subCategory || "—"}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">Condition</span>
                    <span className="kv-value">{selectedProduct.status || "—"}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">Brand</span>
                    <span className="kv-value">{selectedProduct.brand || "—"}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">Rack Number</span>
                    <span className="kv-value">{selectedProduct.rackNumber || "—"}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">Unit Cost</span>
                    <span className="kv-value">
                      {selectedProduct.unitCost ? `₹${selectedProduct.unitCost}` : "—"}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">Quantity</span>
                    <span className="kv-value">
                      {selectedProduct.quantity} {selectedProduct.unit}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">Min Stock Limit</span>
                    <span className="kv-value">
                      {selectedProduct.minStock} {selectedProduct.unit}
                    </span>
                  </div>
                </div>

                {/* ST-35 — the quantity above is the total across companies;
                    this says which company it is actually in. */}
                <CompanyBreakdown
                  productId={selectedProduct._id}
                  unit={selectedProduct.unit}
                  rack={selectedProduct.rackNumber}
                />

                <div className="kv">
                  <span className="kv-label">Description</span>
                  <p className="text-[13px] text-slate-700 leading-relaxed">
                    {selectedProduct.description || "No description provided."}
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default ProductList;
