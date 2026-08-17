import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/palette.dart';
import 'screens/branch/branch_requests_screen.dart';
import 'screens/branch/branch_stock_screen.dart';
import 'screens/login_screen.dart';
import 'screens/supervisor/branch_approvals_screen.dart';
import 'screens/supervisor/my_requests_screen.dart';
import 'screens/supervisor/my_returns_screen.dart';
import 'screens/supervisor/sap_handoff_screen.dart';
import 'screens/supervisor/settings_screen.dart';
import 'screens/supervisor/supervisor_issue_history_screen.dart';
import 'screens/supervisor/supervisor_product_list_screen.dart';
import 'state/auth_provider.dart';
import 'widgets/common.dart';

const supervisorHome = '/supervisor/products';
const branchHome = '/branch/stock';

/// The root navigator, so a dialog that belongs to the app rather than to any
/// one screen — the update prompt raised at startup — can be shown from
/// outside the widget tree.
final rootNavigatorKey = GlobalKey<NavigatorState>();

/// Where a signed-in account belongs. Admins never reach this — they are
/// turned away at login (see AuthProvider).
String homePathFor(String role) => role == 'Branch' ? branchHome : supervisorHome;

/// Route table and guards, replacing `App.jsx` + the two layout wrappers.
GoRouter buildRouter(AuthProvider auth) {
  return GoRouter(
    initialLocation: '/',
    navigatorKey: rootNavigatorKey,
    refreshListenable: auth,
    routes: [
      GoRoute(path: '/', builder: (_, _) => const _SessionSplash()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),

      // Supervisor portal — the only section this app serves. Admins work in
      // the web console and are turned away at login (see AuthProvider).
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
      // Items named in the store and waiting for the Plant Manager to create
      // them in SAP. Reached from the catalog rather than the bottom bar — it
      // belongs to intake, and the bar is full.
      GoRoute(path: '/supervisor/sap-handoff', builder: (_, _) => const SapHandoffScreen()),
      // Profile details and sign-out both live here.
      GoRoute(path: '/supervisor/settings', builder: (_, _) => const SettingsScreen()),
      // Stage two of the branch workflow is decided here.
      GoRoute(
        path: '/supervisor/branch-approvals',
        builder: (_, _) => const BranchApprovalsScreen(),
      ),

      // Branch portal — one room's stock, and the requests raised on it.
      GoRoute(path: '/branch/stock', builder: (_, _) => const BranchStockScreen()),
      GoRoute(path: '/branch/requests', builder: (_, _) => const BranchRequestsScreen()),
      GoRoute(path: '/branch/settings', builder: (_, _) => const SettingsScreen()),
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

      // The Home screen is gone — the bottom bar now carries every screen, so
      // an old dashboard link lands on the catalog instead.
      if (path == '/supervisor/dashboard') return home;

      // The profile is a section of Settings now; keep old links working.
      if (path == '/supervisor/profile') return '/supervisor/settings';
      if (path == '/branch/profile') return '/branch/settings';

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
