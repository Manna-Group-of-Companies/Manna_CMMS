import { useEffect, useState } from "react";
import API from "../../services/api";
import { useAuth, MANAGER, MAINTENANCE_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import useStockRooms from "../../hooks/useStockRooms";
import ProductFormModal from "./ProductFormModal";
import CompanyBreakdown from "../../components/CompanyBreakdown";
import CategoryEditModal from "../../components/CategoryEditModal";
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
  FolderTree,
} from "lucide-react";

/** The two intake flags. Only shown when they say something: a null
    nameCompliant means "never checked", which is not a finding. */
const ProductFlags = ({ product }) => {
  const offName = product.nameCompliant === false;
  const sapPending = product.sap?.status === "Pending";
  // Items mirrored from SAP carry their SAP code with no hand-off status.
  const sapCode =
    (product.sap?.status === "Created" || (product.sapCategory && !product.sap?.status)) &&
    product.sap?.code;
  const catPending = product.sapCategory?.pending;
  const catError = product.sapCategory?.error;
  if (!offName && !sapPending && !sapCode && !catPending && !catError) return null;

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
      {catPending && !catError && (
        <span
          className="badge badge-brand badge-soft text-[10px]"
          title="Category saved here, waiting for the SAP category sync"
        >
          SAP update pending
        </span>
      )}
      {catError && (
        <span className="badge badge-rose badge-soft text-[10px]" title={catError}>
          SAP sync failed
        </span>
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
const RowActions = ({ product, onOpen, canEditCategory = false, canDelete = false }) => (
  <div className="flex items-center justify-end gap-1">
    {canEditCategory && product.sapCategory && (
      <button
        onClick={() => onOpen(product, "category")}
        className="icon-btn icon-btn-brand"
        title="Category (SAP item group / Sub-category A / B)"
        aria-label={`Category of ${product.name}`}
      >
        <FolderTree className="h-4 w-4" />
      </button>
    )}
    <button
      onClick={() => onOpen(product, "details")}
      className="icon-btn"
      title="Engineering Stock Details"
      aria-label={`Details for ${product.name}`}
    >
      <Eye className="h-4 w-4" />
    </button>
    {canEditCategory && product.sapCategory && (
      <button
        onClick={() => onOpen(product, "form")}
        className="icon-btn icon-btn-brand"
        title="Edit (SAP item master)"
        aria-label={`Edit ${product.name}`}
      >
        <Edit className="h-4 w-4" />
      </button>
    )}
    {canDelete && (
      <button
        onClick={() => onOpen(product, "delete")}
        className="icon-btn icon-btn-danger"
        title="Delete Engineering Stock"
        aria-label={`Delete ${product.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    )}
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


const ProductList = () => {
  // The companies stock can be filed against, read from the API (ST-33).
  const rooms = useStockRooms();
  const { showToast } = useNotifications();
  const { user } = useAuth();
  // Mirrors the guard on POST /naming-requests. Offering a button the server
  // will refuse is worse than not offering it.
  // Creating and editing items is the Maintenance Manager's alone (25 Sep 2026): a new
  // item goes to the VP Operations for approval and is then created in SAP.
  const canProposeItem = user?.role === MAINTENANCE_MANAGER;
  const canEditCategory = canProposeItem;
  // DELETE /products/:id is the Manager's.
  const canDelete = user?.role === MANAGER;
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [subCategoriesB, setSubCategoriesB] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSubCategory, setSelectedSubCategory] = useState("");
  const [selectedSubCategoryB, setSelectedSubCategoryB] = useState("");
  const [selectedStoreRoom, setSelectedStoreRoom] = useState("");

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
      if (selectedSubCategoryB) params.subCategoryB = selectedSubCategoryB;
      if (selectedStoreRoom) params.storeRoom = selectedStoreRoom;

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

  // Level 3 (SAP Sub-category B), only once a category and a sub-category are chosen.
  const fetchSubCategoriesB = async () => {
    if (!selectedCategory || !selectedSubCategory) {
      setSubCategoriesB([]);
      return;
    }
    try {
      const { data } = await API.get("/products/subcategories-b", {
        params: { category: selectedCategory, subCategory: selectedSubCategory },
      });
      setSubCategoriesB(data);
    } catch (error) {
      console.error("Error loading sub-categories B:", error);
    }
  };

  /** Picking a category drops a sub-category that no longer belongs to it. */
  const handleCategoryChange = (value) => {
    setSelectedCategory(value);
    setSelectedSubCategory("");
    setSelectedSubCategoryB("");
  };

  const handleSubCategoryChange = (value) => {
    setSelectedSubCategory(value);
    setSelectedSubCategoryB("");
  };

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, [searchTerm, selectedCategory, selectedSubCategory, selectedSubCategoryB, selectedStoreRoom]);

  useEffect(() => {
    fetchSubCategories();
  }, [selectedCategory]);

  useEffect(() => {
    fetchSubCategoriesB();
  }, [selectedCategory, selectedSubCategory]);

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
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:flex">
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
              onChange={(e) => handleSubCategoryChange(e.target.value)}
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

            {/* Sub-Category B Select (SAP SubTypeB) */}
            <select
              value={selectedSubCategoryB}
              onChange={(e) => setSelectedSubCategoryB(e.target.value)}
              disabled={subCategoriesB.length === 0}
              className="field field-sm w-full 2xl:w-auto cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Filter by sub-category B"
            >
              <option value="">All Sub-Categories B</option>
              {subCategoriesB.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {/* Company Select */}
            <select
              value={selectedStoreRoom}
              onChange={(e) => setSelectedStoreRoom(e.target.value)}
              className="field field-sm w-full 2xl:w-auto cursor-pointer col-span-2 md:col-span-1"
              aria-label="Filter by company"
            >
              <option value="">All Companies</option>
              {rooms.map((room) => (
                <option key={room._id} value={room.name}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/*
          Proposing an item is maintenance's job, and the Admin's.

          This button had no guard at all, so every role that can open the
          catalog - which is all of them - was offered it, including the plant
          heads. The server has always refused them (POST /naming-requests is
          Manager and Maintenance Manager only), so the button was an invitation
          to a 403. Naming is raised by maintenance and agreed by operations;
          a plant head has no part in it.
        */}
        {canProposeItem && (
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
        )}
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
                      <div className="text-[11px] text-slate-500">
                        {[product.subCategory, product.subCategoryB].filter(Boolean).join(" › ")}
                      </div>
                    )}
                  </CardRow>
                  <CardRow label="HSN · Tax">
                    <span className="mono text-slate-600">
                      {[product.hsnCode, product.taxRate].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </CardRow>
                  <CardRow label="Company">
                    <span className="badge badge-slate badge-soft">{product.storeRoom}</span>
                  </CardRow>
                </dl>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <StockBadge product={product} />
                  <RowActions product={product} onOpen={openModal} canEditCategory={canEditCategory} canDelete={canDelete} />
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
                    <th>HSN · Tax</th>
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
                          <div className="text-[11px] text-slate-500">
                            {[product.subCategory, product.subCategoryB].filter(Boolean).join(" › ")}
                          </div>
                        )}
                      </td>
                      <td className="mono text-slate-600 whitespace-nowrap">
                        {[product.hsnCode, product.taxRate].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td>
                        <span className="badge badge-slate badge-soft">{product.storeRoom}</span>
                      </td>
                      <td className="text-center">
                        <StockBadge product={product} />
                      </td>
                      <td>
                        <RowActions product={product} onOpen={openModal} canEditCategory={canEditCategory} canDelete={canDelete} />
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

          {/* 0a. Modal: CATEGORY (SAP item group / Sub-category A / B) */}
          {activeModal === "category" && selectedProduct && (
            <CategoryEditModal
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
                    <span className="kv-label">Sub-Category B</span>
                    <span className="kv-value">{selectedProduct.subCategoryB || "—"}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">SAP Item Code</span>
                    <span className="kv-value mono">{selectedProduct.sap?.code || "—"}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">Foreign Name</span>
                    <span className="kv-value">{selectedProduct.foreignName || "—"}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">HSN Code</span>
                    <span className="kv-value mono">{selectedProduct.hsnCode || "—"}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">Tax Rate</span>
                    <span className="kv-value">{selectedProduct.taxRate || "—"}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-label">Brand</span>
                    <span className="kv-value">{selectedProduct.brand || "—"}</span>
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
