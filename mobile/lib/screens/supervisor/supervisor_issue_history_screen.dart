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

/// `pages/supervisor/IssueHistory.jsx` — the supervisor's own issuances,
/// each returnable while it is still outstanding.
class SupervisorIssueHistoryScreen extends StatefulWidget {
  const SupervisorIssueHistoryScreen({super.key});

  @override
  State<SupervisorIssueHistoryScreen> createState() =>
      _SupervisorIssueHistoryScreenState();
}

class _SupervisorIssueHistoryScreenState extends State<SupervisorIssueHistoryScreen>
    with WidgetsBindingObserver, AutoRefresh {
  List<IssueRecord> _issues = const [];
  bool _loading = true;

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
    return AppShell(
      title: 'Issue History Log',
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: PanelHeader(
                icon: Icons.send_outlined,
                iconColor: AppColors.warning,
                title: 'My Issue History',
                trailing: AppBadge(
                  '${_issues.length} Issues Made',
                  color: AppColors.warning,
                  uppercase: false,
                  fontSize: 11,
                ),
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
                    child: _issues.isEmpty
                        ? ListView(
                            padding: const EdgeInsets.all(16),
                            children: const [
                              EmptyState(
                                title: 'No products have been issued by you yet',
                                message:
                                    'Use the "Issue Product" action on the Products catalog '
                                    'to issue items.',
                              ),
                            ],
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                            itemCount: _issues.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 10),
                            itemBuilder: (context, index) {
                              final issue = _issues[index];
                              return IssueCard(
                                issue: issue,
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
