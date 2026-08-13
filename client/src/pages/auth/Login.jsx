import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, homePathFor } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import { Lock, Mail, Boxes } from "lucide-react";

/** The seeded demo logins, in the order the quick-login row shows them. */
const DEMO_ACCOUNTS = [
  { role: "Admin", label: "Office Admin", email: "admin@stock.com", password: "Admin@123", accent: "hover:border-brand-500/50 text-brand-700" },
  { role: "Supervisor", label: "Store Supervisor", email: "supervisor@stock.com", password: "Supervisor@123", accent: "hover:border-emerald-500/50 text-emerald-600" },
  { role: "Branch", label: "Branch", email: "branch@stock.com", password: "Branch@123", accent: "hover:border-indigo-500/50 text-indigo-600" },
];

const Login = () => {
  const { login } = useAuth();
  const { showToast } = useNotifications();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await login(email, password);
      showToast(`Welcome back, ${data.name}!`, "success");

      // Redirect based on role
      navigate(homePathFor(data.role));
    } catch (err) {
      setError(err);
      showToast(err, "error");
    } finally {
      setLoading(false);
    }
  };

  const handlePrefill = (account) => {
    setEmail(account.email);
    setPassword(account.password);
    setError("");
  };

  return (
    <div className="min-h-screen bg-canvas text-slate-900 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Soft teal wash behind the card */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-brand-500/15 rounded-full blur-[110px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[350px] h-[350px] bg-brand-400/10 rounded-full blur-[110px] pointer-events-none"></div>

      <div className="w-full max-w-md z-10">
        {/* Logo and Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-brand-600 p-3.5 rounded-2xl mb-3 shadow-lg shadow-brand-600/25">
            <Boxes className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight leading-none">StockMaster</h1>
          <p className="text-sm text-slate-600 mt-2">MERN Stock Management System</p>
        </div>

        {/* Login Card */}
        <div className="glass-premium p-8 rounded-2xl">
          <h2 className="text-xl font-semibold text-slate-900 mb-6 text-center">Sign In to Portal</h2>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-500/25 text-rose-600 text-xs font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                  <Mail className="h-4.5 w-4.5" />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all"
                  placeholder="name@company.com"
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                  <Lock className="h-4.5 w-4.5" />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-500 hover:to-brand-600 text-white text-sm font-semibold py-3 px-4 rounded-xl shadow-lg hover:shadow-brand-500/10 active:scale-98 transition-all flex items-center justify-center cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>

        {/* Demo Prefills */}
        <div className="mt-8 text-center">
          <p className="text-xs text-slate-500 mb-3">Quick Login (Demo Accounts):</p>
          <div className="flex justify-center gap-3">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.role}
                onClick={() => handlePrefill(account)}
                className={`px-3.5 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-xs font-medium transition-all cursor-pointer ${account.accent}`}
              >
                {account.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
