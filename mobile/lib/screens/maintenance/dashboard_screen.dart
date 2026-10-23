import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../data/maintenance_repository.dart';
import '../../models/maintenance.dart';
import '../../router.dart';
import '../../state/auth_provider.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';
import '../../widgets/work_widgets.dart';
import 'breakdowns_screen.dart';
import 'requests_screen.dart';

/// Home for every manager: breakdowns and maintenance requests summed up in
/// four tiles, the most recent of both, and shortcuts to the rest.
///
/// It reads the same two lists the Breakdowns and Requests screens do, so it
/// shows nothing either of those would not.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

/// A breakdown or a request, flattened for the dashboard's one list.
class _Work {
  const _Work({
    required this.icon,
    required this.title,
    required this.code,
    required this.state,
    required this.priority,
    required this.at,
    required this.path,
    required this.isOpen,
    required this.notStarted,
  });

  final IconData icon;
  final String title;
  final String code;
  final String state;
  final String priority;
  final DateTime? at;
  final String path;
  final bool isOpen;
  final bool notStarted;
}

class _DashboardScreenState extends State<DashboardScreen> {
  late final MaintenanceRepository _repo = MaintenanceRepository(context.read<ApiClient>());

  List<_Work> _work = const [];
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final role = context.read<AuthProvider>().user?.role ?? '';
    setState(() => _loading = true);
    try {
      final breakdowns = canSeeBreakdowns(role) ? await _repo.breakdowns() : const <Breakdown>[];
      final requests = canSeeRequests(role) ? await _repo.requests() : const <MaintenanceRequest>[];
      if (!mounted) return;

      final work = [
        for (final b in breakdowns)
          _Work(
            icon: Icons.precision_manufacturing_outlined,
            title: b.machineName.isEmpty ? b.machine : b.machineName,
            code: b.id,
            state: b.state,
            priority: b.priority,
            at: b.stoppedAt,
            path: '/maintenance/breakdowns/${b.id}',
            isOpen: b.isOpen,
            notStarted: b.state == 'Reported' || b.state == 'Attended',
          ),
        for (final r in requests)
          _Work(
            icon: Icons.handyman_outlined,
            title: r.title,
            code: r.id,
            state: r.state,
            priority: r.priority,
            at: r.requestedAt,
            path: '/maintenance/requests/${r.id}',
            isOpen: r.isOpen,
            notStarted: r.state == 'Requested' || r.state == 'Attended',
          ),
      ]..sort((a, b) => (b.at ?? DateTime(0)).compareTo(a.at ?? DateTime(0)));

      setState(() {
        _work = work;
        _error = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sheet(Widget Function(MaintenanceRepository repo) builder) async {
    final made = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => builder(_repo),
    );
    if (made == true) _load();
  }

  Future<void> _open(String path) async {
    final changed = await context.push<bool>(path);
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final role = context.watch<AuthProvider>().user?.role ?? '';
    final mayRaise = role == 'Manager' || role == 'Production Manager';

    final open = _work.where((w) => w.isOpen).length;
    final notStarted = _work.where((w) => w.isOpen && w.notStarted).length;
    final inProgress = _work.where((w) => w.isOpen && !w.notStarted).length;
    final done = _work.where((w) => !w.isOpen).length;

    return AppShell(
      title: 'Dashboard',
      showAppBar: false,
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            const _Header(),
            Transform.translate(
              offset: const Offset(0, -26),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    _StatTile(
                      value: open,
                      label: 'Open',
                      icon: Icons.inventory_2_outlined,
                      color: AppColors.primary,
                    ),
                    const SizedBox(width: 8),
                    _StatTile(
                      value: notStarted,
                      label: 'Not Started',
                      icon: Icons.hourglass_empty_rounded,
                      color: AppColors.info,
                    ),
                    const SizedBox(width: 8),
                    _StatTile(
                      value: inProgress,
                      label: 'In Progress',
                      icon: Icons.build_outlined,
                      color: AppColors.success,
                    ),
                    const SizedBox(width: 8),
                    _StatTile(
                      value: done,
                      label: 'Completed',
                      icon: Icons.check_circle_outline,
                      color: AppColors.accent,
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _SectionTitle(
                    icon: Icons.assignment_outlined,
                    title: 'Recent Work',
                    action: canSeeRequests(role) ? 'View All' : null,
                    onAction: () => context.go(requestsHome),
                  ),
                  const SizedBox(height: 10),
                  if (_loading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 30),
                      child: LoadingView(message: 'Loading…'),
                    )
                  else if (_error.isNotEmpty)
                    EmptyState(
                      title: 'Could not load the dashboard',
                      message: _error,
                      icon: Icons.error_outline,
                      iconColor: AppColors.danger,
                    )
                  else if (_work.isEmpty)
                    const EmptyState(
                      title: 'Nothing yet',
                      message: 'No breakdowns or requests to show.',
                      icon: Icons.inbox_outlined,
                    )
                  else
                    for (final w in _work.take(6)) ...[
                      WorkListTile(
                        icon: w.icon,
                        title: w.title,
                        code: w.code,
                        date: formatDate(w.at),
                        priority: w.priority,
                        state: w.state,
                        onTap: () => _open(w.path),
                      ),
                      const SizedBox(height: 10),
                    ],
                  const SizedBox(height: 8),
                  const _SectionTitle(icon: Icons.bolt_rounded, title: 'Quick Actions'),
                  const SizedBox(height: 10),
                  GridView.count(
                    crossAxisCount: 4,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 8,
                    crossAxisSpacing: 8,
                    childAspectRatio: 0.82,
                    children: [
                      if (mayRaise && canSeeBreakdowns(role))
                        _QuickAction(
                          icon: Icons.report_gmailerrorred_rounded,
                          label: 'Report Breakdown',
                          color: AppColors.danger,
                          onTap: () => _sheet((repo) => ReportBreakdownSheet(repo: repo)),
                        ),
                      if (mayRaise && canSeeRequests(role))
                        _QuickAction(
                          icon: Icons.add_circle_outline,
                          label: 'New Request',
                          color: AppColors.primary,
                          onTap: () => _sheet((repo) => RaiseRequestSheet(repo: repo)),
                        ),
                      if (canSeeBreakdowns(role))
                        _QuickAction(
                          icon: Icons.build_outlined,
                          label: 'Breakdowns',
                          color: AppColors.info,
                          onTap: () => context.go(breakdownsHome),
                        ),
                      if (canSeeRequests(role))
                        _QuickAction(
                          icon: Icons.assignment_outlined,
                          label: 'Requests',
                          color: AppColors.success,
                          onTap: () => context.go(requestsHome),
                        ),
                      if (canSeeLowValuePurchases(role))
                        _QuickAction(
                          icon: Icons.shopping_cart_outlined,
                          label: 'Misc.',
                          color: AppColors.accent,
                          onTap: () => context.go(lowValueHome),
                        ),
                      _QuickAction(
                        icon: Icons.person_outline,
                        label: 'Profile',
                        color: AppColors.textSecondary,
                        onTap: () => context.go('/maintenance/settings'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The dark band across the top: menu, greeting, who is signed in, the bell.
class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;

    // White status-bar icons over the dark band; there is no app bar to say so.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Container(
        decoration: const BoxDecoration(
          gradient: AppGradients.ink,
          borderRadius: BorderRadius.vertical(bottom: Radius.circular(26)),
        ),
        padding: EdgeInsets.fromLTRB(8, MediaQuery.of(context).padding.top + 6, 8, 44),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            IconButton(
              icon: const Icon(Icons.menu_rounded),
              color: Colors.white,
              tooltip: 'Menu',
              onPressed: () => Scaffold.of(context).openDrawer(),
            ),
            const SizedBox(width: 2),
            const Padding(padding: EdgeInsets.only(top: 6), child: AccountAvatar(size: 46)),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Hello,', style: TextStyle(color: AppColors.inkMuted, fontSize: 12)),
                    Text(
                      user?.name ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      user?.role ?? '',
                      style: const TextStyle(
                        color: Color(0xFFFFB38A),
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
            ),
            const NotificationBell(onDark: true),
          ],
        ),
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.value,
    required this.label,
    required this.icon,
    required this.color,
  });

  final int value;
  final String label;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Container(
      padding: const EdgeInsets.fromLTRB(10, 12, 10, 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
        boxShadow: AppShadows.raised,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, size: 16, color: color),
          ),
          const SizedBox(height: 10),
          Text(
            value.toString().padLeft(2, '0'),
            style: const TextStyle(
              color: AppColors.textStrong,
              fontSize: 22,
              fontWeight: FontWeight.w800,
              height: 1,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 9.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    ),
  );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.icon, required this.title, this.action, this.onAction});

  final IconData icon;
  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, size: 18, color: AppColors.primary),
      const SizedBox(width: 8),
      Expanded(
        child: Text(
          title,
          style: const TextStyle(
            color: AppColors.textStrong,
            fontSize: 15,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      if (action != null)
        GestureDetector(
          onTap: onAction,
          child: Row(
            children: [
              Text(
                action!,
                style: const TextStyle(
                  color: AppColors.primaryDeep,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Icon(Icons.chevron_right, size: 16, color: AppColors.primaryDeep),
            ],
          ),
        ),
    ],
  );
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => AppCard(
    onTap: onTap,
    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
    borderRadius: 14,
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.all(9),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, size: 20, color: color),
        ),
        const SizedBox(height: 8),
        Text(
          label,
          textAlign: TextAlign.center,
          maxLines: 2,
          style: const TextStyle(
            color: AppColors.textBody,
            fontSize: 10.5,
            fontWeight: FontWeight.w600,
            height: 1.2,
          ),
        ),
      ],
    ),
  );
}
