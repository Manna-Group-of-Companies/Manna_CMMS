import { useState, useRef, useEffect } from "react";
import { useNotifications } from "../context/NotificationContext";
import { Bell, Check, CheckSquare, Menu } from "lucide-react";

const Navbar = ({ title, subtitle, onMenuClick }) => {
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
        return "badge-emerald";
      case "REQUEST_REJECTED":
        return "badge-rose";
      case "LOW_STOCK":
        return "badge-amber";
      default:
        return "badge-slate";
    }
  };

  return (
    <header className="h-16 shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 border-b border-slate-200 bg-white/85 backdrop-blur-md sticky top-0 z-30">
      <div className="flex items-center gap-2.5 min-w-0">
        {/* The sidebar is a drawer below lg, so it needs a way in. */}
        <button
          onClick={onMenuClick}
          className="icon-btn h-9 w-9 -ml-1 lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h2 className="text-[15px] sm:text-base font-semibold text-slate-900 tracking-tight leading-tight truncate">
            {title}
          </h2>
          {/* Below sm the title alone has to carry it — two lines would push
              the bar past its 64px. */}
          {subtitle && (
            <p className="hidden sm:block text-[11px] text-slate-500 leading-tight truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Notification Bell */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="icon-btn h-10 w-10 relative"
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
            aria-expanded={dropdownOpen}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-1 bg-rose-500 text-[10px] font-bold text-white rounded-full flex items-center justify-center ring-2 ring-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {/* Dropdown Card — never wider than the viewport on a phone. */}
          {dropdownOpen && (
            <div className="card absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden shadow-xl z-50 animate-fade-in">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-slate-900">Notifications</span>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-[11px] font-semibold text-brand-700 hover:text-brand-600 flex items-center gap-1 cursor-pointer"
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-[22rem] overflow-y-auto divide-y divide-slate-100">
                {notifications.length === 0 ? (
                  <div className="px-4 py-10 text-center text-xs text-slate-500">
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n._id}
                      className={`px-4 py-3 flex flex-col gap-2 transition-colors ${
                        !n.read ? "bg-brand-50/70" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[12px] text-slate-800 leading-relaxed">
                          {n.message}
                        </span>
                        {!n.read && (
                          <button
                            onClick={() => markAsRead(n._id)}
                            className="icon-btn h-7 w-7 shrink-0"
                            title="Mark as read"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`badge ${getNotificationColors(n.type)}`}>
                          {n.type.replace(/_/g, " ")}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {formatTime(n.createdAt)}
                        </span>
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
