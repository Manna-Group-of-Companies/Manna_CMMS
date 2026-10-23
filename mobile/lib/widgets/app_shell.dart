import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../core/formatters.dart';
import '../core/palette.dart';
import '../router.dart';
import '../state/auth_provider.dart';
import '../state/notification_provider.dart';
import 'common.dart';
import 'product_details_sheet.dart' show SheetGrabber;
import 'server_status_banner.dart';

class NavLink {
  const NavLink(this.name, this.path, this.icon);

  final String name;
  final String path;
  final IconData icon;
}

/// Breakdowns, Requests, Purchases and Attendance, each shown only if the
/// signed-in role is on the matching screen — see `canSeeBreakdowns` /
/// `canSeeRequests` / `canSeeLowValuePurchases` / `canSeeAttendance` in
/// router.dart, which mirror the same matrix the web
/// console enforces. The app used to carry a store catalog and a branch's own
/// room here as well; both are gone. A maintenance member sees Attendance
/// alone, which is the whole of their app.
List<NavLink> _tabsFor(AuthProvider auth) {
  final role = auth.user?.role;
  if (role == null) return const [];
  return [
    if (hasDashboard(role))
      const NavLink('Dashboard', dashboardHome, Icons.space_dashboard_outlined),
    if (canSeeBreakdowns(role))
      const NavLink('Breakdowns', breakdownsHome, Icons.build_outlined),
    if (canSeeRequests(role))
      const NavLink('Requests', requestsHome, Icons.assignment_outlined),
    if (canSeeLowValuePurchases(role))
      const NavLink('Miscellaneous', lowValueHome, Icons.shopping_cart_outlined),
    if (canSeeAttendance(role))
      const NavLink('Attendance', attendanceHome, Icons.how_to_reg_outlined),
    const NavLink('Profile', '/maintenance/settings', Icons.person_outline),
  ];
}

/// Chrome shared by every authenticated screen: the app bar with the drawer
/// button and the notification bell (Navbar.jsx), the dark side drawer, and
/// the bottom tab bar for the working screens. Profile and sign-out are the
/// last tab, and the foot of the drawer.
class AppShell extends StatefulWidget {
  const AppShell({
    super.key,
    required this.title,
    required this.child,
    this.floatingActionButton,
    this.actions,
    this.showAppBar = true,
  });

  final String title;
  final Widget child;
  final Widget? floatingActionButton;
  final List<Widget>? actions;

  /// Off for a screen that draws its own header - the dashboard's dark one.
  /// It then opens the drawer itself, with `Scaffold.of(context).openDrawer()`.
  final bool showAppBar;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  /// Handed to the screen below as its primary controller, so the tab bar can
  /// scroll a list it does not otherwise know anything about. A vertical list
  /// that names no controller of its own picks this one up.
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  /// Tapping the tab already showing sends its list back to the top — the way
  /// out of a long scroll without dragging all the way back.
  void _scrollToTop() {
    // A screen can have more than one list attached at once (an empty state
    // swapped for a grid, say). Which one was meant is then a guess, so do
    // nothing rather than scroll the wrong one — and never read `offset` with
    // several attached, which asserts.
    if (_scrollController.positions.length != 1) return;
    if (_scrollController.offset <= 0) return;

    _scrollController.animateTo(
      0,
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.showAppBar
          ? AppBar(
              title: _TitleWithAccount(title: widget.title),
              leading: Builder(
                builder: (context) => IconButton(
                  icon: const Icon(Icons.menu_rounded, size: 24),
                  color: AppColors.textStrong,
                  tooltip: 'Menu',
                  onPressed: () => Scaffold.of(context).openDrawer(),
                ),
              ),
              titleSpacing: 0,
              actions: [
                ...?widget.actions,
                const NotificationBell(),
                const SizedBox(width: 4),
              ],
              shape: const Border(bottom: BorderSide(color: AppColors.border)),
            )
          : null,
      drawer: const AppDrawer(),
      floatingActionButton: widget.floatingActionButton,
      bottomNavigationBar: AppBottomNav(onReselect: _scrollToTop),
      body: PrimaryScrollController(
        controller: _scrollController,
        child: Column(
          children: [
            const ServerStatusBar(),
            Expanded(child: widget.child),
          ],
        ),
      ),
    );
  }
}

/// The app bar heading: the screen's name over who is signed in. The account
/// was previously only visible behind the Settings gear, which made a shared
/// phone easy to use under the wrong login.
class _TitleWithAccount extends StatelessWidget {
  const _TitleWithAccount({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        if (user != null)
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Row(
              children: [
                Icon(
                  user.isBranch ? Icons.warehouse_outlined : Icons.person_outline,
                  size: 11.5,
                  color: AppColors.textMuted,
                ),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    // A Branch account works one room, so name the room with it.
                    user.stockRoomName.isEmpty
                        ? '${user.name} • ${user.role}'
                        : '${user.name} • ${user.stockRoomName}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      height: 1.1,
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// Persistent tab bar across the bottom of every authenticated screen, with
/// one slot per screen the signed-in role can reach.
class AppBottomNav extends StatelessWidget {
  const AppBottomNav({super.key, this.onReselect});

  /// Tapping the tab that is already showing. Navigation has nothing to do at
  /// that point, so the shell uses it to scroll the screen back to the top.
  final VoidCallback? onReselect;

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    final tabs = _tabsFor(context.watch<AuthProvider>());

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 62,
          child: Row(
            children: [
              for (final tab in tabs)
                _NavTab(
                  label: tab.name,
                  icon: tab.icon,
                  active: location == tab.path,
                  onTap: () {
                    if (location == tab.path) {
                      onReselect?.call();
                    } else {
                      context.go(tab.path);
                    }
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavTab extends StatelessWidget {
  const _NavTab({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = active ? AppColors.primaryDeep : AppColors.textMuted;

    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 3),
              decoration: BoxDecoration(
                color: active
                    ? AppColors.primary.withValues(alpha: 0.12)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Icon(icon, size: 20, color: color),
            ),
            const SizedBox(height: 4),
            // Clip rather than wrap so the row keeps its height on a narrow
            // phone.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: color,
                  fontSize: 10.5,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The dark side drawer: who is signed in, every screen this role has, and
/// sign-out at the foot.
class AppDrawer extends StatelessWidget {
  const AppDrawer({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    final location = GoRouterState.of(context).uri.path;

    return Drawer(
      backgroundColor: AppColors.ink,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.horizontal(right: Radius.circular(24)),
      ),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
              child: Row(
                children: [
                  const AccountAvatar(size: 48),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.name ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          user?.role ?? '',
                          style: const TextStyle(
                            color: AppColors.inkMuted,
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          user?.email ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppColors.inkMuted, fontSize: 10.5),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(color: AppColors.inkRaised, height: 1),
            const SizedBox(height: 10),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  for (final tab in _tabsFor(auth))
                    _DrawerItem(
                      icon: tab.icon,
                      label: tab.name,
                      active: location == tab.path,
                      onTap: () {
                        Navigator.of(context).pop();
                        if (location != tab.path) context.go(tab.path);
                      },
                    ),
                ],
              ),
            ),
            const Divider(color: AppColors.inkRaised, height: 1),
            Padding(
              padding: const EdgeInsets.all(12),
              child: _DrawerItem(
                icon: Icons.logout_rounded,
                label: 'Logout',
                color: const Color(0xFFFF7A59),
                onTap: () async {
                  Navigator.of(context).pop();
                  final confirmed = await confirmSignOut(context);
                  if (confirmed && context.mounted) {
                    await context.read<AuthProvider>().logout();
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Asks before signing out; shared by the drawer and the Profile screen.
Future<bool> confirmSignOut(BuildContext context) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Sign out', style: TextStyle(fontSize: 17)),
      content: const Text(
        'Are you sure you want to sign out?',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AppColors.dangerDeep),
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('Sign Out'),
        ),
      ],
    ),
  );
  return confirmed == true;
}

class _DrawerItem extends StatelessWidget {
  const _DrawerItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
    this.color,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final fg = color ?? (active ? Colors.white : const Color(0xFFD5DAE3));

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: active ? AppColors.primary : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Icon(icon, size: 20, color: fg),
                const SizedBox(width: 14),
                Text(
                  label,
                  style: TextStyle(
                    color: fg,
                    fontSize: 13.5,
                    fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The orange disc with a person in it, used in the drawer, the dashboard
/// header and the Profile screen.
class AccountAvatar extends StatelessWidget {
  const AccountAvatar({super.key, this.size = 44});

  final double size;

  @override
  Widget build(BuildContext context) => Container(
        height: size,
        width: size,
        decoration: BoxDecoration(
          gradient: AppGradients.primary,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white.withValues(alpha: 0.85), width: 2),
        ),
        child: Icon(Icons.person_rounded, size: size * 0.56, color: Colors.white),
      );
}

class NotificationBell extends StatelessWidget {
  const NotificationBell({super.key, this.onDark = false});

  /// Drawn on the dashboard's dark header rather than a white app bar.
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final unread = context.watch<NotificationProvider>().unreadCount;

    return Stack(
      alignment: Alignment.center,
      children: [
        IconButton(
          icon: const Icon(Icons.notifications_none, size: 22),
          color: onDark ? Colors.white : AppColors.textSecondary,
          tooltip: 'Notifications',
          onPressed: () => _openPanel(context),
        ),
        if (unread > 0)
          Positioned(
            top: 8,
            right: 8,
            child: IgnorePointer(
              child: Container(
                height: 16,
                width: 16,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: AppColors.dangerDeep,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  unread > 9 ? '9+' : '$unread',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  void _openPanel(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _NotificationPanel(),
    );
  }
}

class _NotificationPanel extends StatelessWidget {
  const _NotificationPanel();

  static Color _colorOf(String type) => switch (type) {
        'REQUEST_APPROVED' => AppColors.success,
        'REQUEST_REJECTED' => AppColors.danger,
        'LOW_STOCK' => AppColors.warning,
        _ => AppColors.textBody,
      };

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<NotificationProvider>();
    final notifications = provider.notifications;

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.3,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            const SheetGrabber(),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 12, 12),
              child: Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Notifications',
                      style: TextStyle(
                        color: AppColors.textStrong,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  if (provider.unreadCount > 0)
                    TextButton.icon(
                      onPressed: provider.markAllAsRead,
                      icon: const Icon(Icons.done_all, size: 15),
                      label: const Text('Mark all read'),
                      style: TextButton.styleFrom(foregroundColor: AppColors.primaryDeep),
                    ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 20),
                    color: AppColors.textSecondary,
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: notifications.isEmpty
                  ? const Center(
                      child: Text(
                        'No notifications yet.',
                        style: TextStyle(color: AppColors.textMuted, fontSize: 13),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: provider.refresh,
                      color: AppColors.primary,
                      backgroundColor: AppColors.surfaceMuted,
                      child: ListView.separated(
                        controller: scrollController,
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        itemCount: notifications.length,
                        separatorBuilder: (_, _) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final n = notifications[index];
                          return Container(
                            color: n.read
                                ? null
                                : AppColors.primary.withValues(alpha: 0.06),
                            padding: const EdgeInsets.fromLTRB(20, 12, 12, 12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        n.message,
                                        style: const TextStyle(
                                          color: AppColors.textPrimary,
                                          fontSize: 12.5,
                                          height: 1.5,
                                        ),
                                      ),
                                    ),
                                    if (!n.read)
                                      IconButton(
                                        visualDensity: VisualDensity.compact,
                                        tooltip: 'Mark as read',
                                        icon: const Icon(Icons.check, size: 16),
                                        color: AppColors.textSecondary,
                                        onPressed: () => provider.markAsRead(n.id),
                                      ),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    AppBadge(
                                      n.type.replaceAll('_', ' '),
                                      color: _colorOf(n.type),
                                      fontSize: 9,
                                    ),
                                    Text(
                                      formatTime(n.createdAt),
                                      style: const TextStyle(
                                        color: AppColors.textMuted,
                                        fontSize: 10,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
