import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/auto_refresh.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';
import '../branch/branch_requests_screen.dart' show BranchRequestCard;

/// Stage two of the branch workflow, on the phone.
///
/// The Admin decides stage one in the web console; approving here completes
/// the request and releases the stock from the branch's room.
class BranchApprovalsScreen extends StatefulWidget {
  const BranchApprovalsScreen({super.key});

  @override
  State<BranchApprovalsScreen> createState() => _BranchApprovalsScreenState();
}

class _BranchApprovalsScreenState extends State<BranchApprovalsScreen>
    with WidgetsBindingObserver, AutoRefresh {
  List<BranchRequestRecord> _requests = const [];
  bool _loading = true;
  String _tab = 'Awaiting me';
  String? _busyId;

  static const _tabs = ['Awaiting me', 'With Admin', 'Completed', 'Closed'];

  @override
  void initState() {
    super.initState();
    _load();
    // The Admin decides stage one elsewhere; poll so this queue keeps up.
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
      final requests = await context.read<StockRepository>().branchRequests();
      if (mounted) setState(() => _requests = requests);
    } catch (error) {
      debugPrint('Error fetching branch requests: $error');
      if (!silent) Toast.error('Could not load branch requests');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool _matches(BranchRequestRecord request) => switch (_tab) {
        'Awaiting me' => request.isPendingSupervisor,
        'With Admin' => request.isPendingAdmin,
        'Completed' => request.isApproved,
        _ => request.isRejected || request.isCancelled,
      };

  Future<void> _decide(
    BranchRequestRecord request, {
    required String action,
    required String comment,
    int? quantity,
  }) async {
    setState(() => _busyId = request.id);
    try {
      final updated =
          await context.read<StockRepository>().decideBranchRequestAsSupervisor(
                id: request.id,
                action: action,
                comment: comment,
                approvedQuantity: action == 'approve' ? quantity : null,
              );
      Toast.success(
        action == 'approve'
            ? '${updated.requestNumber} approved and released'
            : '${updated.requestNumber} rejected',
      );
      if (mounted) {
        setState(() {
          _requests = [
            for (final r in _requests) if (r.id == updated.id) updated else r,
          ];
        });
      }
    } on ApiException catch (error) {
      Toast.error(error.message);
      // The queue may have moved under us — re-read it.
      await _load(silent: true);
    } catch (error) {
      debugPrint('Error deciding branch request: $error');
      Toast.error('Could not record the decision');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible = _requests.where(_matches).toList();
    final waiting = _requests.where((r) => r.isPendingSupervisor).length;

    return AppShell(
      title: 'Branch Approvals',
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: AppCard(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: PanelHeader(
                          icon: Icons.fact_check_outlined,
                          iconColor: AppColors.primaryDeep,
                          title: 'Final approval releases the stock',
                        ),
                      ),
                      AppBadge('$waiting waiting', color: AppColors.warning),
                    ],
                  ),
                  const SizedBox(height: 12),
                  FilterTabs(
                    options: _tabs,
                    selected: _tab,
                    onChanged: (value) => setState(() => _tab = value),
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
                            children: const [
                              EmptyState(
                                title: 'Nothing here right now',
                                message: 'Branch requests appear once the Admin has '
                                    'passed them on.',
                                icon: Icons.fact_check_outlined,
                              ),
                            ],
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                            itemCount: visible.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 10),
                            itemBuilder: (context, index) {
                              final request = visible[index];
                              return BranchRequestCard(
                                request: request,
                                footer: request.isPendingSupervisor
                                    ? _DecisionPanel(
                                        request: request,
                                        busy: _busyId == request.id,
                                        onDecide: (action, comment, quantity) => _decide(
                                          request,
                                          action: action,
                                          comment: comment,
                                          quantity: quantity,
                                        ),
                                      )
                                    : null,
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

/// Approve or reject, with an optional cut to the quantity the Admin passed on.
class _DecisionPanel extends StatefulWidget {
  const _DecisionPanel({
    required this.request,
    required this.busy,
    required this.onDecide,
  });

  final BranchRequestRecord request;
  final bool busy;
  final void Function(String action, String comment, int quantity) onDecide;

  @override
  State<_DecisionPanel> createState() => _DecisionPanelState();
}

class _DecisionPanelState extends State<_DecisionPanel> {
  late final TextEditingController _quantity =
      TextEditingController(text: '${widget.request.effectiveQuantity}');
  final _comment = TextEditingController();

  @override
  void dispose() {
    _quantity.dispose();
    _comment.dispose();
    super.dispose();
  }

  void _submit(String action) {
    final comment = _comment.text.trim();
    if (action == 'reject' && comment.isEmpty) {
      Toast.error('Add a reason before rejecting');
      return;
    }
    final quantity = int.tryParse(_quantity.text.trim()) ?? widget.request.effectiveQuantity;
    widget.onDecide(action, comment, quantity);
  }

  @override
  Widget build(BuildContext context) {
    final ceiling = widget.request.effectiveQuantity;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.20)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Approving completes the request and takes $ceiling '
            '${widget.request.unit} out of ${widget.request.stockRoomName}.',
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 11.5,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              const Text(
                'Release',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: QuantityStepper(
                  controller: _quantity,
                  max: ceiling,
                  onChanged: () => setState(() {}),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _comment,
            decoration: const InputDecoration(
              hintText: 'Remark (required to reject)',
              isDense: true,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: widget.busy ? null : () => _submit('reject'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.danger,
                    side: BorderSide(color: AppColors.danger.withValues(alpha: 0.35)),
                  ),
                  icon: const Icon(Icons.close, size: 16),
                  label: const Text('Reject'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: FilledButton.icon(
                  onPressed: widget.busy ? null : () => _submit('approve'),
                  style: FilledButton.styleFrom(backgroundColor: AppColors.successDeep),
                  icon: widget.busy
                      ? const SizedBox(
                          height: 14,
                          width: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AppColors.white,
                          ),
                        )
                      : const Icon(Icons.check, size: 16),
                  label: const Text('Approve & Release'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
