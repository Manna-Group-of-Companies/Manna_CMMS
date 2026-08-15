import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import ProductFormModal from "./ProductFormModal";
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

const ProductList = () => {
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

  const handleDelete = async () => {
    try {
      setDeleting(true);
      const { data } = await API.delete(`/products/${selectedProduct._id}`);
      showToast(data.message || "Product deleted", "success");
      setActiveModal(null);
      setSelectedProduct(null);
      fetchProducts();
    } catch (error) {
      console.error("Error deleting product:", error);
      showToast(error.response?.data?.message || "Failed to delete product", "error");
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
      if (!silent) showToast("Could not load product list", "error");
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
        <div className="flex-1 w-full flex flex-col sm:flex-row sm:items-center gap-2.5 min-w-0">
          {/* Search Box */}
          <div className="relative w-full sm:max-w-xs">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 pointer-events-none">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              placeholder="Search code, name, category…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="field field-search"
              aria-label="Search products"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 sm:flex gap-2">
            {/* Category Select */}
            <select
              value={selectedCategory}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="field field-sm w-full sm:w-auto cursor-pointer"
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
              className="field field-sm w-full sm:w-auto cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Filter by sub-category"
            >
              <option value="">All Sub-Categories</option>
              {subCategories.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {/* Store Room Select */}
            <select
              value={selectedStoreRoom}
              onChange={(e) => setSelectedStoreRoom(e.target.value)}
              className="field field-sm w-full sm:w-auto cursor-pointer"
              aria-label="Filter by store room"
            >
              <option value="">All Rooms</option>
              <option value="Engineer Room">Engineer Room</option>
              <option value="Consumables Room">Consumables Room</option>
            </select>

            {/* Stock Level Select */}
            <select
              value={stockStatus}
              onChange={(e) => setStockStatus(e.target.value)}
              className="field field-sm w-full sm:w-auto cursor-pointer col-span-2"
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
          Add Product
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
          <h3 className="empty-title">No products found</h3>
          <p className="empty-sub">Try adjusting your search query or filters.</p>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Condition</th>
                  <th>Rack</th>
                  <th>Store Room</th>
                  <th className="text-center">Stock</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const isLowStock = product.quantity <= product.minStock;
                  return (
                    <tr key={product._id}>
                      <td>
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <img
                            src={product.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format&fit=crop"}
                            alt=""
                            className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="cell-title truncate">{product.name}</div>
                            <div className="mono text-brand-700">{product.code}</div>
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
                      <td className="text-center whitespace-nowrap">
                        <span
                          className={`badge badge-pill ${
                            product.quantity === 0
                              ? "badge-rose"
                              : isLowStock
                              ? "badge-amber"
                              : "badge-emerald"
                          }`}
                        >
                          {isLowStock && <AlertCircle className="h-3 w-3" />}
                          {product.quantity} {product.unit}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {/* Details */}
                          <button
                            onClick={() => {
                              setSelectedProduct(product);
                              setActiveModal("details");
                            }}
                            className="icon-btn"
                            title="Product Details"
                            aria-label={`Details for ${product.name}`}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {/* Edit */}
                          <button
                            onClick={() => {
                              setSelectedProduct(product);
                              setActiveModal("form");
                            }}
                            className="icon-btn icon-btn-brand"
                            title="Edit Product"
                            aria-label={`Edit ${product.name}`}
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => {
                              setSelectedProduct(product);
                              setActiveModal("delete");
                            }}
                            className="icon-btn icon-btn-danger"
                            title="Delete Product"
                            aria-label={`Delete ${product.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
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
                <h3 className="modal-title">Delete Product</h3>
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
                    {selectedProduct.unit} from every stock room, and it disappears from the
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
                  Product Specifications
                </h3>
                <button onClick={() => setActiveModal(null)} className="modal-close" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="modal-body space-y-5">
                <div className="flex gap-4">
                  <img
                    src={selectedProduct.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=100&auto=format"}
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

                <div className="grid grid-cols-2 gap-3">
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
                  <div className="kv col-span-2">
                    <span className="kv-label">Max Stock Limit</span>
                    <span className="kv-value">
                      {selectedProduct.maxStock} {selectedProduct.unit}
                    </span>
                  </div>
                </div>

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
