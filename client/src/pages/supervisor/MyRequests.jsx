import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { Loader2, ClipboardList, Eye, Calendar, HelpCircle, Check, X, Clock } from "lucide-react";

const MyRequests = () => {
  const { showToast } = useNotifications();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("All"); // All | Pending | Approved | Rejected

  const fetchMyRequests = async () => {
    try {
      setLoading(true);
      const { data } = await API.get("/requests/myrequests");
      setRequests(data);
    } catch (error) {
      console.error("Error fetching my requests:", error);
      showToast("Could not load request history", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyRequests();
  }, []);

  const getStatusStyle = (status) => {
    switch (status) {
      case "Approved":
        return {
          bg: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
          icon: Check,
        };
      case "Rejected":
        return {
          bg: "bg-rose-500/10 text-rose-600 border border-rose-500/20",
          icon: X,
        };
      default:
        return {
          bg: "bg-amber-500/10 text-amber-600 border border-amber-500/20",
          icon: Clock,
        };
    }
  };

  const getRequestTypeStyle = (type) => {
    switch (type) {
      case "Add Product":
        return "bg-brand-500/10 text-brand-700 border border-brand-500/20";
      case "Edit Product":
        return "bg-indigo-500/10 text-indigo-600 border border-indigo-500/20";
      case "Stock In":
        return "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20";
      case "Stock Out":
        return "bg-rose-500/10 text-rose-600 border border-rose-500/20";
      default:
        return "bg-cyan-500/10 text-cyan-700 border border-cyan-500/20";
    }
  };

  const filteredRequests = statusFilter === "All"
    ? requests
    : requests.filter((r) => r.status === statusFilter);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  };

  return (
    <div className="space-y-6">
      {/* Tab Filter and Status Headers */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-brand-700" />
          <h3 className="text-lg font-bold text-slate-900">Submitted Requests Log</h3>
        </div>

        {/* Tab Buttons */}
        <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          {["All", "Pending", "Approved", "Rejected"].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                statusFilter === status
                  ? "bg-brand-600 text-white shadow"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Requests Table */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="glass-premium p-12 text-center rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
          <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">No requests found</h3>
          <p className="text-xs text-slate-500">
            There are no requests matching the status: <strong className="text-brand-700">{statusFilter}</strong>.
          </p>
        </div>
      ) : (
        <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">Request Number</th>
                  <th className="py-4 px-6">Type</th>
                  <th className="py-4 px-6">Target Product</th>
                  <th className="py-4 px-6">Submission Date</th>
                  <th className="py-4 px-6">Approval Status</th>
                  <th className="py-4 px-6">Admin Notes / Comments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {filteredRequests.map((req) => {
                  const statusStyle = getStatusStyle(req.status);
                  const StatusIcon = statusStyle.icon;
                  return (
                    <tr
                      key={req._id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-4 px-6 font-mono text-xs text-brand-700 font-semibold">
                        {req.requestNumber}
                      </td>
                      <td className="py-4 px-6">
                        <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getRequestTypeStyle(req.requestType)}`}>
                          {req.requestType}
                        </span>
                      </td>
                      <td className="py-4 px-6 font-bold text-slate-900">
                        {req.productName}
                      </td>
                      <td className="py-4 px-6 text-xs text-slate-600 flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 opacity-65" />
                        {formatDate(req.createdDate)}
                      </td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusStyle.bg}`}>
                          <StatusIcon className="h-3 w-3" />
                          {req.status}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-xs italic text-slate-600 max-w-xs truncate">
                        {req.adminComments || (req.status === "Pending" ? "Awaiting review..." : "No comments left.")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyRequests;
