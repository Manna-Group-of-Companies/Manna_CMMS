import { useState, useRef, useEffect } from "react";
import { useNotifications } from "../context/NotificationContext";
import { Bell, Check, CheckSquare, Menu } from "lucide-react";

const Navbar = ({ title, onMenuClick }) => {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const getNotificationColors = (type) => {
    switch (type) {
      case "REQUEST_APPROVED":
        return "bg-emerald-500/10 border-emerald-500/20 text-emerald-600";
      case "REQUEST_REJECTED":
        return "bg-rose-500/10 border-rose-500/20 text-rose-600";
      case "LOW_STOCK":
        return "bg-amber-500/10 border-amber-500/20 text-amber-600";
      default:
        return "bg-slate-100 border-slate-200 text-slate-700";
    }
  };

  return (
    <header className="h-16 flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-8 border-b border-slate-200 bg-slate-50 backdrop-blur-md sticky top-0 z-30">
      <div className="flex items-center gap-2 min-w-0">
        {/* The sidebar is a drawer below lg, so it needs a way in. */}
        <button
          onClick={onMenuClick}
          className="p-2 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h2 className="text-base sm:text-lg lg:text-xl font-semibold text-slate-900 tracking-tight truncate">
          {title}
        </h2>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4 shrink-0">
        {/* Notification Bell */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all duration-200 relative cursor-pointer"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 h-4 w-4 bg-rose-500 text-[10px] font-bold text-white rounded-full flex items-center justify-center animate-pulse">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Dropdown Card — never wider than the viewport on a phone. */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] glass-premium border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">Notifications</span>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-brand-700 hover:text-brand-700 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n._id}
                      className={`p-3 border-b border-slate-200 flex flex-col gap-1.5 transition-colors ${
                        !n.read ? "bg-brand-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium text-slate-800 leading-relaxed">
                          {n.message}
                        </span>
                        {!n.read && (
                          <button
                            onClick={() => markAsRead(n._id)}
                            className="p-1 hover:bg-slate-100 rounded-full text-slate-600 hover:text-slate-900 cursor-pointer"
                            title="Mark as read"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${getNotificationColors(
                            n.type
                          )}`}
                        >
                          {n.type.replace("_", " ")}
                        </span>
                        <span>{formatTime(n.createdAt)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
