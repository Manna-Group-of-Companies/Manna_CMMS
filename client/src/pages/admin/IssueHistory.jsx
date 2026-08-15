import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Loader2,
  Send,
  Calendar,
  User,
  HelpCircle,
  Boxes,
  X,
} from "lucide-react";

const AdminIssueHistory = () => {
  const { showToast } = useNotifications();
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);

  /** [silent] is used by the background poll: no spinner, no error toast. */
  const fetchIssues = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const { data } = await API.get("/issues");
      setIssues(data);
    } catch (error) {
      console.error("Error loading issue history:", error);
      if (!silent) showToast("Failed to load issue history", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssues();
  }, []);

  // Supervisors issue and return stock from the app.
  useAutoRefresh(() => fetchIssues({ silent: true }));

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return (
      d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <Send className="h-5 w-5 text-amber-600" />
          <h3 className="text-lg font-bold text-slate-900">Issue History — All Supervisors</h3>
        </div>
        <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 text-xs font-bold">
          {issues.length} Total Issues
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : issues.length === 0 ? (
        <div className="glass-premium p-12 text-center rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
          <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">No products have been issued yet</h3>
          <p className="text-xs text-slate-500">When a supervisor issues a product, it will appear here.</p>
        </div>
      ) : (
        <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">Issue #</th>
                  <th className="py-4 px-6">Product</th>
                  <th className="py-4 px-6 text-center">Qty Issued</th>
                  <th className="py-4 px-6">Recipient</th>
                  <th className="py-4 px-6">Purpose</th>
                  <th className="py-4 px-6">Issued By</th>
                  <th className="py-4 px-6">Date & Time</th>
                  <th className="py-4 px-6 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {issues.map((issue) => (
                  <tr key={issue._id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 font-mono text-xs text-amber-600 font-bold">
                      {issue.issueNumber}
                    </td>
                    <td className="py-4 px-6">
                      <div 
                        className="flex items-center gap-3 cursor-pointer hover:bg-slate-100 p-2 rounded-lg transition-colors -ml-2"
                        onClick={() => issue.product && setSelectedProduct(issue.product)}
                      >
                        <img
                          src={
                            issue.product?.image ||
                            "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format"
                          }
                          alt={issue.product?.name}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200"
                        />
                        <div>
                          <div className="font-bold text-slate-900 group-hover:text-brand-700 transition-colors">
                            {issue.product?.name || "Deleted Product"}
                          </div>
                          <div className="text-[10px] font-mono text-brand-700">
                            {issue.product?.code || "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="bg-amber-500/10 text-amber-600 border border-amber-500/20 px-2.5 py-0.5 rounded text-xs font-bold">
                        −{issue.quantity} {issue.product?.unit || ""}
                      </span>
                    </td>
                    <td className="py-4 px-6 font-semibold text-slate-900">{issue.recipient}</td>
                    <td className="py-4 px-6 text-xs text-slate-600 italic max-w-[180px] truncate">
                      {issue.purpose || "—"}
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-xs text-slate-600 border border-slate-200">
                          <User className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-800">
                            {issue.supervisor?.name || "System"}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {issue.supervisor?.email || issue.supervisor?.role || ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600 flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 opacity-65" />
                      {formatDate(issue.createdAt)}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {issue.returnStatus === "Returned" ? (
                        <span className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-xs font-semibold">
                          Returned
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-md bg-rose-500/10 text-rose-600 border border-rose-500/20 text-xs font-semibold">
                          Not Returned
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Product Details Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="glass-premium w-full max-w-lg rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <Boxes className="h-5 w-5 text-brand-700" />
                Product Specifications
              </h3>
              <button
                onClick={() => setSelectedProduct(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
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
                  <span className="text-slate-500 block mb-0.5">Current Stock</span>
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
        </div>
      )}
    </div>
  );
};

export default AdminIssueHistory;
