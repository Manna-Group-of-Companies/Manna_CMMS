import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/auto_refresh.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';
import '../../widgets/issue_card.dart';
import 'product_forms.dart';

/// `pages/supervisor/IssueHistory.jsx` — every issuance the store has made,
/// whoever made it. Only the supervisor who made one may return it, so the
/// Return action is offered on their own rows alone.
class SupervisorIssueHistoryScreen extends StatefulWidget {
  const SupervisorIssueHistoryScreen({super.key});

  @override
  State<SupervisorIssueHistoryScreen> createState() =>
      _SupervisorIssueHistoryScreenState();
}

class _SupervisorIssueHistoryScreenState extends State<SupervisorIssueHistoryScreen>
    with WidgetsBindingObserver, AutoRefresh {
  static const _allScope = 'All Supervisors';
  static const _mineScope = 'Issued by Me';

  List<IssueRecord> _issues = const [];
  bool _loading = true;
  String _scope = _allScope;

  List<IssueRecord> get _visible => _scope == _mineScope
      ? _issues.where((issue) => issue.isMine).toList()
      : _issues;

  @override
  void initState() {
    super.initState();
    _load();
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
      final issues = await context.read<StockRepository>().issues();
      if (mounted) setState(() => _issues = issues);
    } catch (error) {
      debugPrint('Error loading issue history: $error');
      if (!silent) Toast.error('Failed to load issue history');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// The sheet reports its own success/failure, so only a reload is needed.
  Future<void> _returnStock(IssueRecord issue) async {
    final returned = await showReturnStockForm(context, issue: issue);
    if (returned) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    final mine = _issues.where((issue) => issue.isMine).length;

    return AppShell(
      title: 'Issue History Log',
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: AppCard(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  PanelHeader(
                    icon: Icons.send_outlined,
                    iconColor: AppColors.warning,
                    title: 'Issue History',
                    subtitle: '$mine of ${_issues.length} issued by you',
                    trailing: AppBadge(
                      '${visible.length} Issues',
                      color: AppColors.warning,
                      uppercase: false,
                      fontSize: 11,
                    ),
                  ),
                  const SizedBox(height: 14),
                  FilterTabs(
                    options: const [_allScope, _mineScope],
                    selected: _scope,
                    onChanged: (value) => setState(() => _scope = value),
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const LoadingView()
                : RefreshIndicator(
                    onRefresh: _load,
                    color: AppColors.primary,
                    backgroundColor: AppColors.surfaceMuted,
                    child: visible.isEmpty
                        ? ListView(
                            padding: const EdgeInsets.all(16),
                            children: [
                              EmptyState(
                                title: _scope == _mineScope
                                    ? 'No products have been issued by you yet'
                                    : 'No products have been issued yet',
                                message:
                                    'Use the "Issue Product" action on the Products catalog '
                                    'to issue items.',
                              ),
                            ],
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                            itemCount: visible.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 10),
                            itemBuilder: (context, index) {
                              final issue = visible[index];
                              return IssueCard(
                                issue: issue,
                                showSupervisor: true,
                                onReturn: () => _returnStock(issue),
                              );
                            },
                          ),
                  ),
          ),
        ],
      ),
    );
  }
}
