import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/palette.dart';
import 'screens/attendance/attendance_calendar_screen.dart';
import 'screens/attendance/attendance_screen.dart';
import 'screens/attendance/team_attendance_screen.dart';
import 'screens/leave/add_leave_screen.dart';
import 'screens/leave/apply_leave_screen.dart';
import 'screens/leave/leave_screen.dart';
import 'screens/login_screen.dart';
import 'screens/maintenance/breakdown_detail_screen.dart';
import 'screens/maintenance/breakdowns_screen.dart';
import 'screens/maintenance/request_detail_screen.dart';
import 'screens/maintenance/requests_screen.dart';
import 'screens/no_access_screen.dart';
import 'screens/supervisor/settings_screen.dart';
import 'state/auth_provider.dart';
import 'widgets/common.dart';

/// This app is Breakdowns, Maintenance Requests and - since 12 Oct 2026 - the
/// maintenance team's Attendance, and nothing else.
///
/// It was the Supervisor and Branch stock-tracking portals - the catalog, red
/// stock, issue history, a branch's own room. Every one of those screens is
/// gone: the group wants this app for raising and following maintenance work,
/// not for stock. The screen files themselves are left in the repository
/// rather than deleted, in case any of that is wanted back, but nothing routes
/// to them any more.
///
/// Who sees which screen mirrors `VIEWS.breakdowns` /
/// `VIEWS.maintenanceRequests` / `VIEWS.attendance` in
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

/// Attendance and leave, brought across from the field-sales app.
///
/// A Maintenance Member - a fitter or electrician - punches in and out,
/// looks at their month and applies for leave.
///
/// Since 13 Oct 2026 the managers' phones carry Breakdowns and Requests only:
/// the Maintenance Manager and the Manager decide attendance on the web
/// console, which still mirrors `VIEWS.attendance` and
/// `routes/attendanceRoutes.js`. The approver list is kept for the day the
/// team screen comes back to the phone.
const _attendanceRoles = {'Maintenance Member'};
const _attendanceApproverRoles = {'Maintenance Manager', 'Manager'};

bool canSeeBreakdowns(String role) => _breakdownRoles.contains(role);
bool canSeeRequests(String role) => _requestRoles.contains(role);
bool canSeeAttendance(String role) => _attendanceRoles.contains(role);
bool canApproveAttendance(String role) => _attendanceApproverRoles.contains(role);
bool isMaintenanceMember(String role) => role == 'Maintenance Member';

/// The Maintenance Manager follows breakdowns and requests on the phone but
/// moves none of them on from it: Start Repair, Machine Running, rejecting and
/// the rest are recorded on the computer only. Their detail screens offer no
/// step, no withdraw and no reject - only the record and what is due next.
bool isViewOnly(String role) => role == 'Maintenance Manager';

/// Whether this role has anything to do in the app at all.
bool worksInMaintenance(String role) =>
    canSeeBreakdowns(role) || canSeeRequests(role) || canSeeAttendance(role);

const breakdownsHome = '/maintenance/breakdowns';
const requestsHome = '/maintenance/requests';
const attendanceHome = '/attendance';
const noAccessHome = '/no-access';

/// The root navigator, so a dialog that belongs to the app rather than to any
/// one screen — the update prompt raised at startup — can be shown from
/// outside the widget tree.
final rootNavigatorKey = GlobalKey<NavigatorState>();

/// Where a signed-in account lands: the first of the screens their role is
/// on, or the no-access page when they are on none.
///
/// A team member's whole app is Attendance, so that is where they land; every
/// manager lands on Breakdowns, which is the work they open the app for.
String homePathFor(String role) {
  if (isMaintenanceMember(role)) return attendanceHome;
  if (canSeeBreakdowns(role)) return breakdownsHome;
  if (canSeeRequests(role)) return requestsHome;
  if (canSeeAttendance(role)) return attendanceHome;
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

      // Attendance and leave. One path, two screens: a member gets their own
      // day, an approver gets the queue and the team.
      GoRoute(
        path: attendanceHome,
        builder: (_, _) => canApproveAttendance(auth.user?.role ?? '')
            ? const TeamAttendanceScreen()
            : const AttendanceScreen(),
      ),
      GoRoute(
        path: '/attendance/calendar',
        builder: (_, state) {
          final q = state.uri.queryParameters;
          final member = q['member'] ?? '';
          return AttendanceCalendarScreen(
            member: member.isEmpty ? null : member,
            label: q['label'],
            regularizeDate: q['regularize'],
          );
        },
      ),
      GoRoute(path: '/attendance/leave', builder: (_, _) => const LeaveScreen()),
      GoRoute(
        path: '/attendance/leave/apply',
        builder: (_, state) => ApplyLeaveScreen(
          initialDate: DateTime.tryParse(state.uri.queryParameters['date'] ?? ''),
        ),
      ),
      GoRoute(path: '/attendance/team/add-leave', builder: (_, _) => const AddLeaveScreen()),
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

      // Attendance: the screen is the matrix's; within it, applying for leave
      // is a member's own act and the team queue is an approver's, the same
      // split the server's routes make.
      if (path.startsWith('/attendance') && !canSeeAttendance(user.role)) return home;
      if (path.startsWith('/attendance/team') && !canApproveAttendance(user.role)) return home;
      if (path.startsWith('/attendance/leave') && !isMaintenanceMember(user.role)) return home;

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
