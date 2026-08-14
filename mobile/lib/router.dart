import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/palette.dart';
import 'screens/branch/branch_requests_screen.dart';
import 'screens/branch/branch_stock_screen.dart';
import 'screens/login_screen.dart';
import 'screens/supervisor/branch_approvals_screen.dart';
import 'screens/supervisor/my_requests_screen.dart';
import 'screens/supervisor/my_returns_screen.dart';
import 'screens/supervisor/profile_screen.dart';
import 'screens/supervisor/supervisor_dashboard_screen.dart';
import 'screens/supervisor/supervisor_issue_history_screen.dart';
import 'screens/supervisor/supervisor_product_list_screen.dart';
import 'state/auth_provider.dart';
import 'widgets/common.dart';

const supervisorHome = '/supervisor/dashboard';
const branchHome = '/branch/stock';

/// Where a signed-in account belongs. Admins never reach this — they are
/// turned away at login (see AuthProvider).
String homePathFor(String role) => role == 'Branch' ? branchHome : supervisorHome;

/// Route table and guards, replacing `App.jsx` + the two layout wrappers.
GoRouter buildRouter(AuthProvider auth) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: auth,
    routes: [
      GoRoute(path: '/', builder: (_, _) => const _SessionSplash()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),

      // Supervisor portal — the only section this app serves. Admins work in
      // the web console and are turned away at login (see AuthProvider).
      GoRoute(
        path: '/supervisor/dashboard',
        builder: (_, _) => const SupervisorDashboardScreen(),
      ),
      GoRoute(
        path: '/supervisor/products',
        builder: (_, _) => const SupervisorProductListScreen(),
      ),
      GoRoute(path: '/supervisor/requests', builder: (_, _) => const MyRequestsScreen()),
      GoRoute(
        path: '/supervisor/issues',
        builder: (_, _) => const SupervisorIssueHistoryScreen(),
      ),
      // Also carries Stock by Room, which no longer has a page of its own.
      GoRoute(path: '/supervisor/returns', builder: (_, _) => const MyReturnsScreen()),
      GoRoute(path: '/supervisor/profile', builder: (_, _) => const ProfileScreen()),
      // Stage two of the branch workflow is decided here.
      GoRoute(
        path: '/supervisor/branch-approvals',
        builder: (_, _) => const BranchApprovalsScreen(),
      ),

      // Branch portal — one room's stock, and the requests raised on it.
      GoRoute(path: '/branch/stock', builder: (_, _) => const BranchStockScreen()),
      GoRoute(path: '/branch/requests', builder: (_, _) => const BranchRequestsScreen()),
      GoRoute(path: '/branch/profile', builder: (_, _) => const ProfileScreen()),
    ],
    redirect: (context, state) {
      final path = state.matchedLocation;

      // Session still being restored — hold on the splash.
      if (auth.loading) return path == '/' ? null : '/';

      final user = auth.user;
      if (user == null) return path == '/login' ? null : '/login';

      final home = homePathFor(user.role);

      if (path == '/' || path == '/login' || path == '/supervisor' || path == '/branch') {
        return home;
      }

      // A Branch account is confined to its own portal, and only a Supervisor
      // reaches the supervisor screens — either way, back to their own home.
      if (user.isBranch && !path.startsWith('/branch')) return home;
      if (!user.isBranch && path.startsWith('/branch/')) return home;

      // Stock by Room folded into the Red Stock Room screen; keep old links
      // (a stored route, a shortcut on someone's phone) working.
      if (path == '/supervisor/stock') return '/supervisor/returns';

      // The admin console lives in the web client; send any leftover deep
      // link (a stored route, an old shortcut) back to the portal.
      if (path.startsWith('/admin')) return home;

      return null;
    },
    errorBuilder: (_, _) => const _SessionSplash(),
  );
}

class _SessionSplash extends StatelessWidget {
  const _SessionSplash();

  @override
  Widget build(BuildContext context) => const Scaffold(
        backgroundColor: AppColors.canvas,
        body: LoadingView(message: 'Restoring your session...'),
      );
}
