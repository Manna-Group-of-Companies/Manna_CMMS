import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../core/formatters.dart';
import '../core/palette.dart';
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

/// The five bottom tabs, in order. Short labels because the bar is tight —
/// the drawer repeats them with fuller names.
const _bottomTabs = [
  NavLink('Home', '/supervisor/dashboard', Icons.home_outlined),
  NavLink('Catalog', '/supervisor/products', Icons.inventory_2_outlined),
  NavLink('Requests', '/supervisor/requests', Icons.assignment_outlined),
  NavLink('Approvals', '/supervisor/branch-approvals', Icons.fact_check_outlined),
  NavLink('Profile', '/supervisor/profile', Icons.person_outline),
];

/// Everything reachable from the drawer: the five tabs plus the screens that
/// do not earn a slot in the bar.
const _drawerLinks = [
  NavLink('Home', '/supervisor/dashboard', Icons.home_outlined),
  NavLink('Product Catalog', '/supervisor/products', Icons.inventory_2_outlined),
  NavLink('My Requests', '/supervisor/requests', Icons.assignment_outlined),
  NavLink('Branch Approvals', '/supervisor/branch-approvals', Icons.fact_check_outlined),
  NavLink('Issue History', '/supervisor/issues', Icons.send_outlined),
  NavLink('Red Stock Room', '/supervisor/returns', Icons.assignment_return_outlined),
  NavLink('Profile', '/supervisor/profile', Icons.person_outline),
];

/// A Branch account has two screens: its room's stock, and the requests it has
/// raised on that stock.
const _branchTabs = [
  NavLink('Stock', '/branch/stock', Icons.warehouse_outlined),
  NavLink('Requests', '/branch/requests', Icons.assignment_outlined),
  NavLink('Profile', '/branch/profile', Icons.person_outline),
];

/// Navigation for the signed-in role. Branch accounts never see the
/// supervisor screens, and the API refuses them regardless.
List<NavLink> _tabsFor(AuthProvider auth) =>
    auth.user?.isBranch == true ? _branchTabs : _bottomTabs;

List<NavLink> _linksFor(AuthProvider auth) =>
    auth.user?.isBranch == true ? _branchTabs : _drawerLinks;

/// Chrome shared by every authenticated screen: the app bar with the
/// notification bell (Navbar.jsx) and the navigation drawer (Sidebar.jsx).
class AppShell extends StatelessWidget {
  const AppShell({
    super.key,
    required this.title,
    required this.child,
    this.floatingActionButton,
    this.actions,
  });

  final String title;
  final Widget child;
  final Widget? floatingActionButton;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title, overflow: TextOverflow.ellipsis),
        actions: [...?actions, const _NotificationBell(), const SizedBox(width: 4)],
        shape: const Border(bottom: BorderSide(color: AppColors.border)),
      ),
      drawer: const AppDrawer(),
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: const AppBottomNav(),
      body: Column(
        children: [
          const ServerStatusBar(),
          Expanded(child: child),
        ],
      ),
    );
  }
}

/// Persistent tab bar across the bottom of every authenticated screen. The
/// last slot opens the drawer, which is where the profile and sign-out live.
class AppBottomNav extends StatelessWidget {
  const AppBottomNav({super.key});

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
                    if (location != tab.path) context.go(tab.path);
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
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 3),
              decoration: BoxDecoration(
                color: active
                    ? AppColors.primary.withValues(alpha: 0.12)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Icon(icon, size: 20, color: color),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 10.5,
                fontWeight: active ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class AppDrawer extends StatelessWidget {
  const AppDrawer({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    final location = GoRouterState.of(context).uri.path;

    return Drawer(
      child: SafeArea(
        child: Column(
          children: [
            // Brand header
            Container(
              height: 64,
              padding: const EdgeInsets.symmetric(horizontal: 20),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: AppColors.border)),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.20),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.primary.withValues(alpha: 0.30)),
                    ),
                    child: const Icon(Icons.widgets_outlined,
                        size: 20, color: AppColors.primaryDeep),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'StockMaster',
                        style: TextStyle(
                          color: AppColors.textStrong,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          height: 1.1,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${user?.role ?? ''} PORTAL',
                        style: const TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1.1,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // Signed-in user card
            Container(
              margin: const EdgeInsets.fromLTRB(16, 20, 16, 20),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.surfaceMuted,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  Container(
                    height: 40,
                    width: 40,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.primary.withValues(alpha: 0.22)),
                    ),
                    child: Icon(
                      user?.isBranch == true
                          ? Icons.warehouse_outlined
                          : Icons.person_outline,
                      size: 20,
                      color: AppColors.primaryDeep,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.name ?? '',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textStrong,
                            fontSize: 13.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          user?.email ?? '',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5),
                        ),
                        // A branch works one room; naming it here saves asking
                        // which one this login belongs to.
                        if (user?.stockRoomName.isNotEmpty == true) ...[
                          const SizedBox(height: 4),
                          AppBadge(user!.stockRoomName, color: AppColors.primaryDeep,
                              fontSize: 9.5),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Navigation
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  for (final link in _linksFor(auth))
                    _DrawerLink(link: link, active: location == link.path),
                ],
              ),
            ),

            // Sign out
            Container(
              padding: const EdgeInsets.all(12),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => _confirmSignOut(context),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(12)),
                  child: const Row(
                    children: [
                      Icon(Icons.logout, size: 19, color: AppColors.textSecondary),
                      SizedBox(width: 12),
                      Text(
                        'Sign Out',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context) async {
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

    if (confirmed == true && context.mounted) {
      await context.read<AuthProvider>().logout();
    }
  }
}

class _DrawerLink extends StatelessWidget {
  const _DrawerLink({required this.link, required this.active});

  final NavLink link;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: active ? AppColors.primary : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () {
            Navigator.of(context).pop();
            if (!active) context.go(link.path);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(
              children: [
                Icon(
                  link.icon,
                  size: 19,
                  color: active ? Colors.white : AppColors.textSecondary,
                ),
                const SizedBox(width: 12),
                Text(
                  link.name,
                  style: TextStyle(
                    color: active ? Colors.white : AppColors.textBody,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
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

class _NotificationBell extends StatelessWidget {
  const _NotificationBell();

  @override
  Widget build(BuildContext context) {
    final unread = context.watch<NotificationProvider>().unreadCount;

    return Stack(
      alignment: Alignment.center,
      children: [
        IconButton(
          icon: const Icon(Icons.notifications_none, size: 22),
          color: AppColors.textSecondary,
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
                    color: AppColors.textStrong,
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
