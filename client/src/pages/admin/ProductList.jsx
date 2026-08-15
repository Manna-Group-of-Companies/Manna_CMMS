import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import ProductFormModal from "./ProductFormModal";
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
  const [loading, setLoading] = useState(true);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
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

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, [searchTerm, selectedCategory, selectedStoreRoom, stockStatus]);

  // Supervisors issue stock and raise requests that change these quantities.
  // Paused while a modal is open so an edit form cannot be reset mid-typing.
  useAutoRefresh(() => fetchProducts({ silent: true }), { enabled: !activeModal });



  return (
    <div className="space-y-6">
      {/* Search and Action Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex-1 w-full flex flex-col sm:flex-row items-center gap-3">
          {/* Search Box */}
          <div className="relative w-full sm:w-80">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              placeholder="Search code, name, category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            {/* Category Select */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl bg-white border border-slate-200 text-slate-700 focus:outline-none focus:border-brand-500"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Store Room Select */}
            <select
              value={selectedStoreRoom}
              onChange={(e) => setSelectedStoreRoom(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl bg-white border border-slate-200 text-slate-700 focus:outline-none focus:border-brand-500"
            >
              <option value="">All Rooms</option>
              <option value="Engineer Room">Engineer Room</option>
              <option value="Consumables Room">Consumables Room</option>
            </select>

            {/* Stock Level Select */}
            <select
              value={stockStatus}
              onChange={(e) => setStockStatus(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl bg-white border border-slate-200 text-slate-700 focus:outline-none focus:border-brand-500"
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
          className="w-full md:w-auto px-4 py-2.5 text-xs font-bold rounded-xl bg-brand-600 hover:bg-brand-500 text-white cursor-pointer shadow active:scale-98 transition-all flex items-center justify-center gap-2"
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
        <div className="glass-premium p-12 text-center rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
          <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">No products found</h3>
          <p className="text-xs text-slate-500">
            Try adjusting your search query or filters.
          </p>
        </div>
      ) : (
        <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">Product</th>
                  <th className="py-4 px-6">Category</th>
                  <th className="py-4 px-6">Rack</th>
                  <th className="py-4 px-6">Store Room</th>
                  <th className="py-4 px-6 text-center">Stock Quantity</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {products.map((product) => {
                  const isLowStock = product.quantity <= product.minStock;
                  return (
                    <tr
                      key={product._id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-4 px-6 flex items-center gap-3">
                        <img
                          src={product.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format&fit=crop"}
                          alt={product.name}
                          className="w-10 h-10 rounded-lg object-cover border border-slate-200"
                        />
                        <div>
                          <div className="font-bold text-slate-900">{product.name}</div>
                          <div className="text-[10px] font-mono text-brand-700">{product.code}</div>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="text-slate-800">{product.category}</div>
                      </td>
                      <td className="py-4 px-6">
                        <span className="font-mono text-xs text-slate-700">{product.rackNumber || "—"}</span>
                      </td>
                      <td className="py-4 px-6">
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 border border-slate-200 text-slate-600">
                          {product.storeRoom}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <span
                            className={`text-sm font-bold px-2 py-0.5 rounded ${product.quantity === 0
                                ? "bg-rose-50 text-rose-600"
                                : isLowStock
                                  ? "bg-amber-50 text-amber-600"
                                  : "bg-emerald-50 text-emerald-600"
                              }`}
                          >
                            {product.quantity} {product.unit}
                          </span>
                          {isLowStock && (
                            <span className="text-[9px] text-amber-600 font-semibold mt-1 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> Low Stock
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Details */}
                          <button
                            onClick={() => {
                              setSelectedProduct(product);
                              setActiveModal("details");
                            }}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
                            title="Product Details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {/* Edit */}
                          <button
                            onClick={() => {
                              setSelectedProduct(product);
                              setActiveModal("form");
                            }}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-brand-700 transition-all cursor-pointer"
                            title="Edit Product"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => {
                              setSelectedProduct(product);
                              setActiveModal("delete");
                            }}
                            className="p-1.5 hover:bg-rose-50 rounded-lg text-rose-600 transition-all cursor-pointer"
                            title="Delete Product"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">

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
            <div className="glass-premium w-full max-w-md rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-bold text-lg text-slate-900">Delete Product</h3>
                <button
                  onClick={() => setActiveModal(null)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm text-slate-700">
                  Delete <strong>{selectedProduct.name}</strong> ({selectedProduct.code})?
                </p>
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-500/20 text-[11px] text-rose-900 leading-relaxed">
                  This removes the product and its {selectedProduct.quantity} {selectedProduct.unit}{" "}
                  from every stock room, and it disappears from the Supervisor catalog. Issue
                  history and past requests are kept for the record. This cannot be undone.
                </div>

                <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                  <button
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-600 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 cursor-pointer active:scale-98 transition-all flex items-center gap-2"
                  >
                    {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Delete Permanently
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 1. Modal: PRODUCT DETAILS */}
          {activeModal === "details" && selectedProduct && (
            <div className="glass-premium w-full max-w-lg rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-bold text-lg text-slate-900">Product Specifications</h3>
                <button
                  onClick={() => setActiveModal(null)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="flex gap-4">
                  <img
                    src={selectedProduct.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=100&auto=format"}
                    alt={selectedProduct.name}
                    className="w-24 h-24 rounded-xl object-cover border border-slate-200"
                  />
                  <div>
                    <h4 className="text-xl font-bold text-slate-900 leading-tight">{selectedProduct.name}</h4>
                    <span className="text-xs font-mono text-brand-700 mt-1 block">CODE: {selectedProduct.code}</span>
                    <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                      {selectedProduct.storeRoom}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Category</span>
                    <span className="font-semibold text-slate-800">{selectedProduct.category}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Rack Number</span>
                    <span className="font-semibold text-slate-800">{selectedProduct.rackNumber || "—"}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Quantity</span>
                    <span className="font-bold text-slate-900">{selectedProduct.quantity} {selectedProduct.unit}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Min Stock Limit</span>
                    <span className="font-semibold text-slate-800">{selectedProduct.minStock} {selectedProduct.unit}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Max Stock Limit</span>
                    <span className="font-semibold text-slate-800">{selectedProduct.maxStock} {selectedProduct.unit}</span>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                  <span className="text-slate-500 block mb-1">Description</span>
                  <p className="text-slate-700 leading-relaxed">{selectedProduct.description || "No description provided."}</p>
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
