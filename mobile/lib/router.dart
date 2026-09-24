import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/palette.dart';
import 'screens/login_screen.dart';
import 'screens/maintenance/breakdown_detail_screen.dart';
import 'screens/maintenance/breakdowns_screen.dart';
import 'screens/maintenance/request_detail_screen.dart';
import 'screens/maintenance/requests_screen.dart';
import 'screens/no_access_screen.dart';
import 'screens/supervisor/settings_screen.dart';
import 'state/auth_provider.dart';
import 'widgets/common.dart';

/// This app is Breakdowns and Maintenance Requests, and nothing else.
///
/// It was the Supervisor and Branch stock-tracking portals - the catalog, red
/// stock, issue history, a branch's own room. Every one of those screens is
/// gone: the group wants this app for raising and following maintenance work,
/// not for stock. The screen files themselves are left in the repository
/// rather than deleted, in case any of that is wanted back, but nothing routes
/// to them any more.
///
/// Who sees which of the two remaining screens mirrors
/// `VIEWS.breakdowns` / `VIEWS.maintenanceRequests` in
/// `server/config/access.js` - the same matrix the web console enforces. Kept
/// as a literal copy here rather than fetched, the same way the web client
/// mirrors its own copy in `client/src/config/access.js`: change one, remember
/// to change the other.
const _breakdownRoles = {
  'Manager',
  'Maintenance Manager',
  'Higher Management',
  'Production Manager',
  'Supervisor',
};

const _requestRoles = {
  'Manager',
  'Maintenance Manager',
  'Production Manager',
  'Supervisor',
};

bool canSeeBreakdowns(String role) => _breakdownRoles.contains(role);
bool canSeeRequests(String role) => _requestRoles.contains(role);

/// Whether this role has anything to do in the app at all.
bool worksInMaintenance(String role) => canSeeBreakdowns(role) || canSeeRequests(role);

const breakdownsHome = '/maintenance/breakdowns';
const requestsHome = '/maintenance/requests';
const noAccessHome = '/no-access';

/// The root navigator, so a dialog that belongs to the app rather than to any
/// one screen — the update prompt raised at startup — can be shown from
/// outside the widget tree.
final rootNavigatorKey = GlobalKey<NavigatorState>();

/// Where a signed-in account lands: the first of the two screens their role is
/// on, or the no-access page when they are on neither.
String homePathFor(String role) {
  if (canSeeBreakdowns(role)) return breakdownsHome;
  if (canSeeRequests(role)) return requestsHome;
  return noAccessHome;
}

/// Route table and guards, replacing `App.jsx` + the two layout wrappers.
GoRouter buildRouter(AuthProvider auth) {
  return GoRouter(
    initialLocation: '/',
    navigatorKey: rootNavigatorKey,
    refreshListenable: auth,
    routes: [
      GoRoute(path: '/', builder: (_, _) => const _SessionSplash()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/no-access', builder: (_, _) => const NoAccessScreen()),

      // Breakdowns and planned work — the whole app.
      GoRoute(path: breakdownsHome, builder: (_, _) => const BreakdownsScreen()),
      GoRoute(
        path: '/maintenance/breakdowns/:id',
        builder: (_, state) =>
            BreakdownDetailScreen(id: state.pathParameters['id'] ?? ''),
      ),
      GoRoute(path: requestsHome, builder: (_, _) => const RequestsScreen()),
      GoRoute(
        path: '/maintenance/requests/:id',
        builder: (_, state) => RequestDetailScreen(id: state.pathParameters['id'] ?? ''),
      ),
      // Profile details and sign-out.
      GoRoute(path: '/maintenance/settings', builder: (_, _) => const SettingsScreen()),
    ],
    redirect: (context, state) {
      final path = state.matchedLocation;

      // Session still being restored — hold on the splash.
      if (auth.loading) return path == '/' ? null : '/';

      final user = auth.user;
      if (user == null) return path == '/login' ? null : '/login';

      final home = homePathFor(user.role);

      if (path == '/' || path == '/login' || path == '/maintenance') return home;

      // A role that gained access after landing here should not stay stuck on
      // the no-access page — most relevant right after an administrator adds
      // the role and the person signs in again without a fresh install.
      if (path == noAccessHome && worksInMaintenance(user.role)) return home;

      // Each of the two screens checks its own role, so a role allowed on one
      // but not the other cannot reach the one that refuses it by typing the
      // URL — the same thing `requireView` does on the server.
      if (path.startsWith('/maintenance/breakdowns') && !canSeeBreakdowns(user.role)) return home;
      if (path.startsWith('/maintenance/requests') && !canSeeRequests(user.role)) return home;
      if (path == '/maintenance/settings' && !worksInMaintenance(user.role)) return home;

      // Everything the app used to serve — the store catalog, red stock, a
      // branch's own room — is gone. A stored route or an old shortcut from
      // before this change lands on whichever of the two screens this role
      // actually has, rather than a blank page.
      if (path.startsWith('/supervisor') || path.startsWith('/branch')) return home;

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
