import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/auto_refresh.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../state/auth_provider.dart';
import '../../widgets/activity_row.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';
import 'product_forms.dart';

/// `pages/supervisor/SupervisorDashboard.jsx`.
class SupervisorDashboardScreen extends StatefulWidget {
  const SupervisorDashboardScreen({super.key});

  @override
  State<SupervisorDashboardScreen> createState() => _SupervisorDashboardScreenState();
}

class _SupervisorDashboardScreenState extends State<SupervisorDashboardScreen>
    with WidgetsBindingObserver, AutoRefresh {
  SupervisorDashboard? _metrics;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
    // Counts move whenever the Admin decides a request.
    startAutoRefresh();
  }

  @override
  void dispose() {
    stopAutoRefresh();
    super.dispose();
  }

  @override
  Future<void> refreshData() => _load(silent: true);

  /// [silent] suppresses the error toast so a background poll does not nag.
  Future<void> _load({bool silent = false}) async {
    try {
      final metrics = await context.read<StockRepository>().supervisorDashboard();
      if (mounted) setState(() => _metrics = metrics);
    } catch (error) {
      debugPrint('Error fetching supervisor dashboard: $error');
      if (!silent) Toast.error('Failed to fetch dashboard metrics');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final metrics = _metrics;

    return AppShell(
      title: 'Home',
      child: _loading && metrics == null
          ? const LoadingView(message: 'Loading dashboard...')
          : RefreshIndicator(
              onRefresh: _load,
              color: AppColors.primary,
              backgroundColor: AppColors.surface,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                children: [
                  const _Greeting(),
                  const SizedBox(height: 16),
                  if (metrics == null)
                    const EmptyState(
                      title: 'Metrics unavailable',
                      message: 'Pull down to try loading the dashboard again.',
                      icon: Icons.cloud_off_outlined,
                    )
                  else ...[
                    HeroStatCard(
                      label: 'Catalog Products',
                      value: '${metrics.totalProducts}',
                      caption: 'Items tracked across all store rooms',
                      icon: Icons.inventory_2_outlined,
                    ),
                    const SizedBox(height: 12),
                    GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      childAspectRatio: 1.5,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      // Every count is store-wide; the caption is this
                      // supervisor's share of it.
                      children: [
                        MetricCard(
                          title: 'Available Stock (Pcs)',
                          value: metrics.totalStockQuantity,
                          icon: Icons.warehouse_outlined,
                          accent: AppColors.primaryDeep,
                        ),
                        MetricCard(
                          title: 'Pending Requests',
                          value: metrics.pendingRequests,
                          caption: '${metrics.myPendingRequests} raised by you',
                          icon: Icons.schedule,
                          accent: AppColors.warning,
                        ),
                        MetricCard(
                          title: 'Accepted Requests',
                          value: metrics.approvedRequests,
                          caption: '${metrics.myApprovedRequests} raised by you',
                          icon: Icons.check_circle_outline,
                          accent: AppColors.success,
                        ),
                        MetricCard(
                          title: 'Rejected Requests',
                          value: metrics.rejectedRequests,
                          caption: '${metrics.myRejectedRequests} raised by you',
                          icon: Icons.cancel_outlined,
                          accent: AppColors.danger,
                        ),
                        MetricCard(
                          title: 'Issued Today',
                          value: metrics.issuedTodayCount,
                          caption: '${metrics.myIssuedTodayCount} issued by you',
                          icon: Icons.send_outlined,
                          accent: AppColors.warning,
                        ),
                        MetricCard(
                          title: 'In Red Stock',
                          value: metrics.redStockCount,
                          caption: '${metrics.myRedStockCount} returned by you',
                          icon: Icons.assignment_return_outlined,
                          accent: AppColors.accent,
                        ),
                        MetricCard(
                          title: 'Low Stock Items',
                          value: metrics.lowStockProductsCount,
                          icon: Icons.warning_amber_outlined,
                          accent: metrics.lowStockProductsCount > 0
                              ? AppColors.danger
                              : AppColors.info,
                          highlighted: metrics.lowStockProductsCount > 0,
                        ),
                      ],
                    ),
                    const SizedBox(height: 22),
                    _QuickActions(
                      onRequestProduct: () async {
                        final submitted = await showProductRequestForm(context);
                        if (submitted) await _load();
                      },
                    ),
                    const SizedBox(height: 22),
                    _ActivityPanel(entries: metrics.todayActivity),
                    const SizedBox(height: 16),
                    _RecentIssuesPanel(issues: metrics.recentIssues),
                  ],
                ],
              ),
            ),
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting();

  @override
  Widget build(BuildContext context) {
    final name = context.watch<AuthProvider>().user?.name ?? 'Supervisor';
    final hour = DateTime.now().hour;
    final partOfDay = hour < 12
        ? 'Good morning!'
        : hour < 17
            ? 'Good afternoon!'
            : 'Good evening!';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Hello, $name 👋',
          style: const TextStyle(
            color: AppColors.textStrong,
            fontSize: 20,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.4,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          partOfDay,
          style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
        ),
      ],
    );
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions({required this.onRequestProduct});

  final VoidCallback onRequestProduct;

  @override
  Widget build(BuildContext context) {
    final actions = [
      (
        label: 'Request\nProduct',
        icon: Icons.add_box_outlined,
        onTap: onRequestProduct,
      ),
      (
        label: 'Stock\nCatalog',
        icon: Icons.inventory_2_outlined,
        onTap: () => context.go('/supervisor/products'),
      ),
      (
        label: 'My\nRequests',
        icon: Icons.assignment_outlined,
        onTap: () => context.go('/supervisor/requests'),
      ),
      (
        label: 'Issue\nHistory',
        icon: Icons.send_outlined,
        onTap: () => context.go('/supervisor/issues'),
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Quick Actions',
          style: TextStyle(
            color: AppColors.textStrong,
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            for (final action in actions) ...[
              Expanded(
                child: QuickActionTile(
                  label: action.label,
                  icon: action.icon,
                  onTap: action.onTap,
                ),
              ),
              if (action != actions.last) const SizedBox(width: 10),
            ],
          ],
        ),
      ],
    );
  }
}

class _ActivityPanel extends StatelessWidget {
  const _ActivityPanel({required this.entries});

  final List<ActivityEntry> entries;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PanelHeader(
            icon: Icons.calendar_today_outlined,
            iconColor: AppColors.primaryDeep,
            title: "Today's Activity Log",
            subtitle: 'All supervisors • ${entries.length} today',
          ),
          const SizedBox(height: 16),
          if (entries.isEmpty)
            const EmptyState(
              title: 'No activity recorded today yet.',
              icon: Icons.schedule,
              dashed: true,
            )
          else
            for (final entry in entries) ...[
              // The feed spans the store, so every row names who raised it.
              ActivityRow(entry: entry, showSupervisor: true),
              if (entry != entries.last) const SizedBox(height: 10),
            ],
        ],
      ),
    );
  }
}

/// The last few issues out of the store, whoever made them. Read-only — a
/// return is raised from the Issue History screen, and only by its owner.
class _RecentIssuesPanel extends StatelessWidget {
  const _RecentIssuesPanel({required this.issues});

  final List<IssueRecord> issues;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PanelHeader(
            icon: Icons.send_outlined,
            iconColor: AppColors.warning,
            title: 'Latest Issues',
            trailing: TextButton(
              onPressed: () => context.go('/supervisor/issues'),
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                foregroundColor: AppColors.primaryDeep,
                padding: const EdgeInsets.symmetric(horizontal: 8),
              ),
              child: const Text('View all', style: TextStyle(fontSize: 11.5)),
            ),
          ),
          const SizedBox(height: 16),
          if (issues.isEmpty)
            const EmptyState(
              title: 'Nothing has been issued yet.',
              icon: Icons.send_outlined,
              dashed: true,
            )
          else
            for (final issue in issues) ...[
              _RecentIssueRow(issue: issue),
              if (issue != issues.last) const SizedBox(height: 10),
            ],
        ],
      ),
    );
  }
}

class _RecentIssueRow extends StatelessWidget {
  const _RecentIssueRow({required this.issue});

  final IssueRecord issue;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  issue.product?.name ?? 'Deleted Product',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textStrong,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              AppBadge(
                '−${issue.quantity} ${issue.product?.unit ?? ''}',
                color: AppColors.warning,
                uppercase: false,
                fontSize: 10.5,
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'to ${issue.recipient} by '
            '${issue.isMine ? "${issue.supervisorName} (you)" : issue.supervisorName}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
          ),
          const SizedBox(height: 3),
          Row(
            children: [
              MonoText(issue.issueNumber, color: AppColors.textMuted, fontSize: 10),
              const SizedBox(width: 6),
              Text(
                formatDateTime(issue.createdAt),
                style: const TextStyle(color: AppColors.textMuted, fontSize: 10),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

