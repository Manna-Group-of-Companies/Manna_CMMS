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

/// Every supervisor working screen, in order. There is no drawer, so the bar
/// carries the whole portal; Settings sits in the app bar instead.
const _bottomTabs = [
  NavLink('Catalog', '/supervisor/products', Icons.inventory_2_outlined),
  NavLink('Requests', '/supervisor/requests', Icons.assignment_outlined),
  NavLink('Approvals', '/supervisor/branch-approvals', Icons.fact_check_outlined),
  NavLink('Issues', '/supervisor/issues', Icons.send_outlined),
  NavLink('Red Room', '/supervisor/returns', Icons.assignment_return_outlined),
];

/// A Branch account has two screens: its room's stock, and the requests it has
/// raised on that stock.
const _branchTabs = [
  NavLink('Stock', '/branch/stock', Icons.warehouse_outlined),
  NavLink('Requests', '/branch/requests', Icons.assignment_outlined),
];

/// Navigation for the signed-in role. Branch accounts never see the
/// supervisor screens, and the API refuses them regardless.
List<NavLink> _tabsFor(AuthProvider auth) =>
    auth.user?.isBranch == true ? _branchTabs : _bottomTabs;

/// Where the gear goes — each portal has its own Settings screen.
String _settingsPathFor(AuthProvider auth) =>
    auth.user?.isBranch == true ? '/branch/settings' : '/supervisor/settings';

/// Chrome shared by every authenticated screen: the app bar with the settings
/// gear and the notification bell (Navbar.jsx), and the bottom tab bar for the
/// working screens. Profile and sign-out live behind the gear.
class AppShell extends StatefulWidget {
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
      appBar: AppBar(
        title: _TitleWithAccount(title: widget.title),
        actions: [
          ...?widget.actions,
          const _SettingsButton(),
          const _NotificationBell(),
          const SizedBox(width: 4),
        ],
        shape: const Border(bottom: BorderSide(color: AppColors.border)),
      ),
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

/// The gear in the app bar, on every authenticated screen. Behind it: the
/// account card, the request tallies, the server address and sign-out.
class _SettingsButton extends StatelessWidget {
  const _SettingsButton();

  @override
  Widget build(BuildContext context) {
    final path = _settingsPathFor(context.watch<AuthProvider>());
    final active = GoRouterState.of(context).uri.path == path;

    return IconButton(
      icon: const Icon(Icons.settings_outlined, size: 22),
      color: active ? AppColors.primaryDeep : AppColors.textSecondary,
      tooltip: 'Settings',
      onPressed: () {
        if (!active) context.go(path);
      },
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
