import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import { COMMON_STATUSES, statusTone } from "../../utils/productStatus";
import TaxonomySelect, {
  useCategoryOptions,
  useSubCategoryOptions,
} from "../../components/TaxonomySelect";
import ItemNameBuilder, {
  NameComplianceNotice,
  EMPTY_NAMING,
  isNamingBlank,
} from "../../components/ItemNameBuilder";
import DuplicateWarning, { useDuplicateCheck } from "../../components/DuplicateWarning";
import {
  Search,
  Filter,
  Plus,
  Edit,
  Eye,
  X,
  Boxes,
  Lock,
  Loader2,
  AlertCircle,
  HelpCircle,
  Send,
} from "lucide-react";

// Pre-defined sample images for easy product creation
const SAMPLE_IMAGES = [
  { name: "Default Box", url: "" },
  { name: "Mouse/Keyboard", url: "https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3" },
  { name: "Monitor/Screen", url: "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3" },
  { name: "Office Chair", url: "https://images.unsplash.com/photo-1505797149-43b0069ec26b?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3" },
  { name: "Laptop/Computer", url: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3" },
];

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
  const [activeModal, setActiveModal] = useState(null); // 'add' | 'edit' | 'details' | 'issue' | null
  const [selectedProduct, setSelectedProduct] = useState(null);

  // Issue Product Form State
  const [issueQty, setIssueQty] = useState(1);
  const [issueRecipient, setIssueRecipient] = useState("");
  const [issuePurpose, setIssuePurpose] = useState("");

  /**
   * The add / edit form.
   *
   * Adding still raises a request for the Admin; editing saves straight onto the
   * product. `subCategory` has to be here for either to carry it — the form used
   * to leave the key out entirely, so a sub-category could be looked at on this
   * page but never set from it, and an edit that changed it silently sent
   * nothing.
   */
  const [productForm, setProductForm] = useState({
    name: "",
    category: "",
    subCategory: "",
    status: "Good Condition",
    rackNumber: "",
    quantity: 0,
    unit: "Pcs",
    minStock: 5,
    storeRoom: "Manna Rubber Park",
    description: "",
    image: "",
  });

  // The classifications already in use, offered as dropdowns so the catalog
  // stops collecting "Bearing" / "Bearings" / "BEARING" as three categories.
  // Separate from the filter bar's lists above, which follow what is *being
  // filtered on* rather than what is being entered.
  const formCategoryOptions = useCategoryOptions();
  const formSubCategoryOptions = useSubCategoryOptions(productForm.category);

  /**
   * The SOI1/SOP1 fields the name is built from (ST-09), kept beside the form
   * because they are saved as their own sub-document rather than as a field.
   *
   * An intake concern only. A name is settled when the item is taken in — the
   * catalog, the issue history and SAP all refer to the item by it — so an edit
   * neither shows the builder nor lets the name be typed over.
   */
  const [naming, setNaming] = useState(EMPTY_NAMING);
  const [showBuilder, setShowBuilder] = useState(true);

  // ST-14 — what the catalog already holds that looks like this. Intake only:
  // an edit cannot change the name, so it has nothing that could newly collide,
  // and reopening a product must not accuse it of duplicating itself.
  const { matches: duplicateMatches, checking: checkingDuplicates } = useDuplicateCheck({
    name: productForm.name,
    category: productForm.category,
    excludeId: selectedProduct?._id || "",
    enabled: activeModal === "add",
  });

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

  // Scoped to the chosen category — see the Admin catalog for why.
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

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, [searchTerm, selectedCategory, selectedSubCategory, selectedStoreRoom, stockStatus]);

  useEffect(() => {
    fetchSubCategories();
  }, [selectedCategory]);

  // The Admin edits products and moves stock between rooms on their console,
  // so the catalog re-reads the API rather than showing the first fetch.
  // Paused while a modal is open so a form cannot be reset mid-typing.
  useAutoRefresh(() => fetchProducts({ silent: true }), { enabled: !activeModal });

  // Handle Form Change
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setProductForm((prev) => ({
      ...prev,
      [name]: name === "quantity" || name === "minStock" ? Number(value) : value,
    }));
  };

  // Open Edit Form
  const openEditModal = (product) => {
    setSelectedProduct(product);
    setProductForm({
      name: product.name,
      category: product.category,
      subCategory: product.subCategory || "",
      status: product.status || "",
      rackNumber: product.rackNumber || "",
      quantity: product.quantity,
      unit: product.unit,
      minStock: product.minStock,
      storeRoom: product.storeRoom,
      description: product.description || "",
      image: product.image || "",
    });
    // Not carried over: an edit shows neither the builder nor an editable name,
    // and a stale sub-document must not follow the user into the next add.
    setNaming(EMPTY_NAMING);
    setActiveModal("edit");
  };

  // Open Issue Product Form
  const openIssueModal = (product) => {
    setSelectedProduct(product);
    setIssueQty(1);
    setIssueRecipient("");
    setIssuePurpose("");
    setActiveModal("issue");
  };

  // Submit Issue Product (direct stock decrement)
  const handleIssueProduct = async (e) => {
    e.preventDefault();
    if (issueQty < 1) {
      showToast("Quantity must be at least 1", "error");
      return;
    }
    if (!issueRecipient.trim()) {
      showToast("Recipient is required", "error");
      return;
    }
    try {
      const { data } = await API.post("/issues", {
        productId: selectedProduct._id,
        quantity: issueQty,
        recipient: issueRecipient,
        purpose: issuePurpose,
      });
      showToast(data.message, "success");
      setActiveModal(null);
      fetchProducts(); // Refresh to show updated quantity
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to issue product", "error");
    }
  };

  // Submit Product Add Request
  //
  // [overrides] answers one of the two intake checks; see the catch.
  const handleAddRequest = async (e, overrides = {}) => {
    e?.preventDefault();
    try {
      await API.post("/requests/product", {
        requestType: "ADD",
        details: {
          ...productForm,
          // Carried so the approved product keeps the fields its name was built
          // from (ST-09) instead of only the finished string. Omitted when
          // blank, which is what a hand-typed name leaves it as.
          ...(isNamingBlank(naming) ? {} : { naming }),
        },
        ...overrides,
      });
      showToast("Product ADD request submitted successfully!", "success");
      setActiveModal(null);
      resetProductForm();
    } catch (error) {
      const retry = intakeOverrideFor(error, overrides);
      if (retry) return handleAddRequest(null, { ...overrides, ...retry });

      showToast(error.response?.data?.message || "Failed to submit request", "error");
    }
  };

  /**
   * Turns a refused save into the flag that answers it, once the user agrees.
   *
   * 422 and 409 are not failures — they are the naming convention (ST-10) and
   * the duplicate check (ST-14) asking a question. Confirming re-sends the same
   * payload with the matching override, which the API then accepts. Returns null
   * when the error is something else, or when that override was already set (so
   * a refusal can never loop).
   */
  const intakeOverrideFor = (error, overrides) => {
    const { status, data } = error.response || {};

    const flag =
      status === 422 && data?.code === "NAME_NOT_COMPLIANT"
        ? "acknowledgeNaming"
        : status === 409 && data?.code === "POSSIBLE_DUPLICATE"
          ? "allowDuplicate"
          : null;

    if (!flag || overrides[flag]) return null;
    if (!window.confirm(`${data.message}.\n\nSave anyway?`)) return null;

    return { [flag]: true };
  };

  // Save an edit straight to the product. Only a new item still waits for the
  // Admin — an edit takes effect as soon as it is saved, so there is no request
  // to track and the row is re-read instead.
  //
  // [overrides] carries the answer to one of the intake checks; see the catch.
  const handleEditProduct = async (e, overrides = {}) => {
    e?.preventDefault();

    // Only what the edit form actually offers. Quantity and store room move real
    // stock, and unit and minimum stock are identity and purchasing figures —
    // the form no longer shows any of them, so the payload must not carry them
    // either. Echoing them back would be harmless today (the API no-ops a zero
    // delta) but leaves a request shaped to write fields nobody was shown.
    //
    // The name and its naming fields are absent for the same reason: the form
    // does not offer them, and the API re-checks a name whenever either moves —
    // so echoing an unchanged legacy name back would hold a rack-number fix
    // against a convention that name predates.
    const details = {
      category: productForm.category,
      subCategory: productForm.subCategory,
      status: productForm.status,
      rackNumber: productForm.rackNumber,
      image: productForm.image,
      description: productForm.description,
    };

    try {
      await API.put(`/products/${selectedProduct._id}`, { ...details, ...overrides });
      showToast(`"${selectedProduct.name}" updated`, "success");
      setActiveModal(null);
      fetchProducts(); // The change is live, so show it.
    } catch (error) {
      const retry = intakeOverrideFor(error, overrides);
      if (retry) return handleEditProduct(null, { ...overrides, ...retry });

      showToast(error.response?.data?.message || "Failed to save the product", "error");
    }
  };

  const resetProductForm = () => {
    setProductForm({
      name: "",
      category: "",
      subCategory: "",
      status: "Good Condition",
      rackNumber: "",
      quantity: 0,
      unit: "Pcs",
      minStock: 5,
      storeRoom: "Manna Rubber Park",
      description: "",
      image: "",
    });
    setNaming(EMPTY_NAMING);
    setShowBuilder(true);
  };

  /**
   * Changing the main category invalidates the sub-category under it — "Ring
   * Spanners" does not belong to "Bearings" — so it is cleared rather than left
   * pointing at the wrong parent.
   */
  const setFormCategory = (category) =>
    setProductForm((prev) => ({
      ...prev,
      category,
      subCategory: category === prev.category ? prev.subCategory : "",
    }));

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
              onChange={(e) => {
                // Picking a category drops a sub-category that no longer
                // belongs to it.
                setSelectedCategory(e.target.value);
                setSelectedSubCategory("");
              }}
              className="px-3 py-2 text-xs rounded-xl bg-white border border-slate-200 text-slate-700 focus:outline-none focus:border-brand-500"
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
              className="px-3 py-2 text-xs rounded-xl bg-white border border-slate-200 text-slate-700 focus:outline-none focus:border-brand-500 disabled:opacity-60"
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
              className="px-3 py-2 text-xs rounded-xl bg-white border border-slate-200 text-slate-700 focus:outline-none focus:border-brand-500"
            >
              <option value="">All Companies</option>
              <option value="Manna Rubber Park">Manna Rubber Park</option>
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

        {/* Submit Request Button */}
        <button
          onClick={() => {
            resetProductForm();
            setActiveModal("add");
          }}
          className="w-full md:w-auto flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg cursor-pointer active:scale-98 transition-all shrink-0"
        >
          <Plus className="h-4 w-4" />
          Request Add Product
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
                  <th className="py-4 px-6">Condition</th>
                  <th className="py-4 px-6">Rack</th>
                  <th className="py-4 px-6">Company</th>
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
                        {product.subCategory && (
                          <div className="text-[10px] text-slate-500">{product.subCategory}</div>
                        )}
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        {product.status ? (
                          <span className={`badge badge-soft ${statusTone(product.status)}`}>
                            {product.status}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
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

                          {/* Edit (direct — no approval) */}
                          <button
                            onClick={() => openEditModal(product)}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-brand-700 transition-all cursor-pointer"
                            title="Edit Product"
                          >
                            <Edit className="h-4 w-4" />
                          </button>


                          {/* Issue Product (direct) */}
                          <button
                            onClick={() => openIssueModal(product)}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-amber-600 hover:text-amber-600 transition-all cursor-pointer"
                            title="Issue Product"
                          >
                            <Send className="h-4 w-4" />
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
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
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

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Category</span>
                    <span className="font-semibold text-slate-800">{selectedProduct.category}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Sub-Category</span>
                    <span className="font-semibold text-slate-800">{selectedProduct.subCategory || "—"}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Condition</span>
                    <span className="font-semibold text-slate-800">{selectedProduct.status || "—"}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Brand</span>
                    <span className="font-semibold text-slate-800">{selectedProduct.brand || "—"}</span>
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
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                  <span className="text-slate-500 block mb-1">Description</span>
                  <p className="text-slate-700 leading-relaxed">{selectedProduct.description || "No description provided."}</p>
                </div>
              </div>
            </div>
          )}

          {/* 2. Modal: ADD or EDIT PRODUCT FORM */}
          {(activeModal === "add" || activeModal === "edit") && (
            <div className="glass-premium w-full max-w-2xl rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-bold text-lg text-slate-900">
                  {activeModal === "add" ? "Request Add New Product" : `Edit Product: ${selectedProduct?.name}`}
                </h3>
                <button
                  onClick={() => setActiveModal(null)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={activeModal === "add" ? handleAddRequest : handleEditProduct} className="p-6 space-y-4">
                {/* Intake only. On a new item the naming convention comes first,
                    because the name it produces is what every other field hangs
                    off; on an edit the name is already settled and cannot be
                    changed here, so a builder would only offer something this
                    form has no way to apply. */}
                {activeModal === "add" && (
                  <>
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowBuilder((open) => !open)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer"
                      >
                        {showBuilder ? "Hide" : "Show"} standard name builder (SOI1/SOP1)
                      </button>
                    </div>

                    {showBuilder && (
                      <ItemNameBuilder
                        value={naming}
                        onChange={setNaming}
                        onApply={(name) => setProductForm((prev) => ({ ...prev, name }))}
                      />
                    )}
                  </>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Name */}
                  <div className="md:col-span-2">
                    {/* No asterisk on an edit: nothing is being asked for. */}
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Product Name{activeModal === "edit" ? "" : " *"}
                    </label>
                    {activeModal === "edit" ? (
                      <>
                        {/* Shown, never typed over. The name is how the catalog,
                            the issue history and SAP all refer to this item, so
                            it is settled at intake rather than left open to a
                            form somebody opened to correct a rack number. */}
                        <input
                          type="text"
                          value={productForm.name}
                          readOnly
                          className="w-full px-3 py-2 text-sm rounded-xl bg-slate-50 border border-slate-200 text-slate-600 cursor-not-allowed focus:outline-none"
                        />
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          Set when the item was taken in and not changed here.
                        </p>
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          name="name"
                          value={productForm.name}
                          onChange={handleFormChange}
                          required
                          placeholder="e.g. 25MM Bearing Deep Groove SS304"
                          className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
                        />
                        {/* ST-10 — only worth showing where it can be acted on,
                            which now that a name is fixed once saved is intake
                            and nowhere else. */}
                        <NameComplianceNotice name={productForm.name} />
                      </>
                    )}
                  </div>

                  {/* Category — a dropdown over what the store already uses,
                      with "add a new one" for a class of item it has not
                      stocked before. */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Category *</label>
                    <TaxonomySelect
                      value={productForm.category}
                      options={formCategoryOptions}
                      onChange={setFormCategory}
                      placeholder="Select a category…"
                      required
                    />
                  </div>

                  {/* Sub-Category — narrowed to the category above. */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Sub-Category</label>
                    <TaxonomySelect
                      value={productForm.subCategory}
                      options={formSubCategoryOptions}
                      onChange={(subCategory) =>
                        setProductForm((prev) => ({ ...prev, subCategory }))
                      }
                      placeholder={
                        productForm.category ? "Select a sub-category…" : "Pick a category first"
                      }
                      disabled={!productForm.category}
                    />
                  </div>

                  {/* Condition */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Condition</label>
                    <select
                      name="status"
                      value={productForm.status}
                      onChange={handleFormChange}
                      className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 cursor-pointer"
                    >
                      <option value="">Not recorded</option>
                      {(productForm.status && !COMMON_STATUSES.includes(productForm.status)
                        ? [productForm.status, ...COMMON_STATUSES]
                        : COMMON_STATUSES
                      ).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Rack Number */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Rack Number</label>
                    <input
                      type="text"
                      name="rackNumber"
                      value={productForm.rackNumber}
                      onChange={handleFormChange}
                      placeholder="e.g. A-1"
                      className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
                    />
                  </div>

                  {/* Asked for once, when the item is first taken in. An edit
                      does not offer them: quantity and store room move real
                      stock, and unit and minimum stock are identity and
                      purchasing figures that should not drift from a form
                      somebody opened to fix a shelf label. */}
                  {activeModal === "add" && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Initial Quantity *</label>
                        <input
                          type="number"
                          name="quantity"
                          value={productForm.quantity}
                          onChange={handleFormChange}
                          required
                          min="0"
                          className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Unit of Measure *</label>
                        <input
                          type="text"
                          name="unit"
                          value={productForm.unit}
                          onChange={handleFormChange}
                          required
                          placeholder="e.g. Pcs, Box, Kg"
                          className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Minimum Stock Limit *</label>
                        <input
                          type="number"
                          name="minStock"
                          value={productForm.minStock}
                          onChange={handleFormChange}
                          required
                          min="0"
                          className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Company *</label>
                        <select
                          name="storeRoom"
                          value={productForm.storeRoom}
                          onChange={handleFormChange}
                          required
                          className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
                        >
                          <option value="Manna Rubber Park">Manna Rubber Park</option>
                          <option value="Consumables Room">Consumables Room</option>
                        </select>
                      </div>
                    </>
                  )}

                  {/* Image URL / Quick Select */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Product Image URL</label>
                    <input
                      type="text"
                      name="image"
                      value={productForm.image}
                      onChange={handleFormChange}
                      placeholder="Paste image URL here"
                      className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
                    />
                    <div className="flex gap-1.5 mt-2 overflow-x-auto py-1">
                      {SAMPLE_IMAGES.map((img, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setProductForm((p) => ({ ...p, image: img.url }))}
                          className="px-2 py-1 text-[10px] bg-slate-100 border border-slate-200 hover:border-brand-700 hover:text-slate-900 rounded text-slate-600 cursor-pointer"
                        >
                          {img.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ST-14 — what the catalog already holds that looks like this,
                    shown while the name is being entered rather than only after
                    the save is refused. */}
                <DuplicateWarning matches={duplicateMatches} checking={checkingDuplicates} />

                {/* Description */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
                  <textarea
                    name="description"
                    value={productForm.description}
                    onChange={handleFormChange}
                    rows="3"
                    placeholder="Provide details about components, warranty, or catalog mapping..."
                    className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 resize-none"
                  ></textarea>
                </div>

                {/* Still shown on an edit, just not editable — somebody fixing a
                    rack number still needs to know which room and how much, and
                    a form that silently omits half an item reads as though the
                    data were missing. */}
                {activeModal === "edit" && selectedProduct && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-slate-400" /> Not changed here
                    </h4>
                    <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                      {[
                        ["Code", selectedProduct.code, "fixed identity"],
                        ["Unit", selectedProduct.unit, "fixed identity"],
                        [
                          "Current Stock",
                          `${selectedProduct.quantity} ${selectedProduct.unit}`,
                          "Stock In request",
                        ],
                        ["Company", selectedProduct.storeRoom, "Admin moves it"],
                      ].map(([term, value, why]) => (
                        <div key={term} className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            {term}
                          </dt>
                          <dd
                            className="text-xs font-semibold text-slate-800 truncate"
                            title={value}
                          >
                            {value}
                          </dd>
                          <dd className="text-[10px] text-slate-400">{why}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {/* Buttons */}
                <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-brand-600 hover:bg-brand-500 text-white cursor-pointer shadow-lg active:scale-98 transition-all"
                  >
                    {activeModal === "add" ? "Submit Request" : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 3. Modal: ISSUE PRODUCT FORM */}
          {activeModal === "issue" && selectedProduct && (
            <div className="glass-premium w-full max-w-md rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Send className="h-5 w-5 text-amber-600" />
                  Issue Product
                </h3>
                <button
                  onClick={() => setActiveModal(null)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleIssueProduct} className="p-6 space-y-4">
                {/* Product Info */}
                <div className="flex gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <img
                    src={selectedProduct.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format"}
                    alt={selectedProduct.name}
                    className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                  />
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{selectedProduct.name}</h4>
                    <span className="text-[10px] text-slate-600">Current Stock: <strong className="text-brand-700">{selectedProduct.quantity} {selectedProduct.unit}</strong></span>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-500/15 rounded-lg text-xs text-amber-600">
                  ⚡ This action will <strong>immediately reduce</strong> the product quantity. No admin approval required.
                </div>

                {/* Quantity */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Quantity to Issue ({selectedProduct.unit}) *
                  </label>
                  <input
                    type="number"
                    value={issueQty}
                    onChange={(e) => setIssueQty(Math.max(1, Number(e.target.value)))}
                    required
                    min="1"
                    max={selectedProduct.quantity}
                    className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
                  />
                  {issueQty > selectedProduct.quantity && (
                    <div className="text-rose-600 text-[10px] mt-1 flex items-center gap-1 font-medium">
                      <AlertCircle className="h-3.5 w-3.5" /> Exceeds available stock!
                    </div>
                  )}
                </div>

                {/* Recipient */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Recipient (Name / Department) *
                  </label>
                  <input
                    type="text"
                    value={issueRecipient}
                    onChange={(e) => setIssueRecipient(e.target.value)}
                    required
                    placeholder="e.g. Marketing Dept, John Smith"
                    className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
                  />
                </div>

                {/* Purpose */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Purpose / Notes
                  </label>
                  <textarea
                    value={issuePurpose}
                    onChange={(e) => setIssuePurpose(e.target.value)}
                    rows="2"
                    placeholder="e.g. Quarterly office supply restock"
                    className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 resize-none"
                  ></textarea>
                </div>

                {/* Buttons */}
                <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={issueQty > selectedProduct.quantity || issueQty < 1}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 cursor-pointer shadow-lg active:scale-98 transition-all"
                  >
                    Issue Now
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default ProductList;
