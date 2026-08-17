import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/auto_refresh.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';
import '../../widgets/disposal_log_view.dart';
import '../../widgets/issue_table.dart';
import 'product_forms.dart';

/// `pages/supervisor/IssueHistory.jsx` — everything the store has issued and
/// not yet had back, whoever issued it. The server drops fully settled rows
/// from a supervisor's list, so every row here still has stock out with a
/// recipient, and any supervisor may action any of them.
///
/// Settled stock has to go somewhere the supervisor can still see it, which is
/// what the second view is for: returns land in the Red Stock Room and show up
/// on that screen, while consumed and scrapped stock would otherwise disappear
/// from the app entirely the moment it was accounted for.
class SupervisorIssueHistoryScreen extends StatefulWidget {
  const SupervisorIssueHistoryScreen({super.key});

  @override
  State<SupervisorIssueHistoryScreen> createState() =>
      _SupervisorIssueHistoryScreenState();
}

class _SupervisorIssueHistoryScreenState
    extends State<SupervisorIssueHistoryScreen>
    with WidgetsBindingObserver, AutoRefresh {
  /// The two halves of this screen: what is still out, and what has been
  /// written off for good.
  static const _outstandingView = 'Outstanding';
  static const _disposedView = 'Used / Scrapped';

  static const _allScope = 'All Supervisors';
  static const _mineScope = 'Issued by Me';

  List<IssueRecord> _issues = const [];
  bool _loading = true;
  String _scope = _allScope;
  String _view = _outstandingView;

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

  /// The other two outcomes an issued item can have. Neither restores stock —
  /// both just close the quantity out against the issue.
  Future<void> _recordDisposal(IssueRecord issue, String type) async {
    final recorded = await showDisposalForm(context, issue: issue, type: type);
    if (recorded) await _load();
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      title: 'Issue History Log',
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: FilterTabs(
              options: const [_outstandingView, _disposedView],
              selected: _view,
              onChanged: (value) => setState(() => _view = value),
            ),
          ),
          Expanded(
            child: _view == _disposedView
                ? const DisposalLogView()
                : _buildOutstanding(),
          ),
        ],
      ),
    );
  }

  /// Issues with stock still out with a recipient, and the three actions that
  /// settle them.
  Widget _buildOutstanding() {
    final visible = _visible;
    final mine = _issues.where((issue) => issue.isMine).length;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
          child: AppCard(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                PanelHeader(
                  icon: Icons.send_outlined,
                  iconColor: AppColors.warning,
                  title: 'Issue History',
                  subtitle: '$mine of ${_issues.length} outstanding are yours',
                  trailing: AppBadge(
                    '${visible.length} Outstanding',
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
                                  ? 'Nothing you issued is still out'
                                  : 'Nothing is still out with a recipient',
                              message:
                                  'Fully returned issues drop off this list. Open a '
                                  'product in the Products catalog and tap '
                                  '"Issue Product" to issue items.',
                            ),
                          ],
                        )
                      : IssueTable(
                          issues: visible,
                          showSupervisor: true,
                          onReturn: _returnStock,
                          onConsume: (issue) =>
                              _recordDisposal(issue, 'Consumed'),
                          onScrap: (issue) =>
                              _recordDisposal(issue, 'Scrapped'),
                        ),
                ),
        ),
      ],
    );
  }
}
