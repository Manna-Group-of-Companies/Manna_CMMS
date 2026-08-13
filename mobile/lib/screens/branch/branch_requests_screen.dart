import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/auto_refresh.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/branch_request_widgets.dart';
import '../../widgets/common.dart';
import 'branch_request_form.dart';

/// `pages/branch/MyRequests.jsx` — the branch's own queue: raise a request,
/// follow it through both approvals, read the whole trail.
class BranchRequestsScreen extends StatefulWidget {
  const BranchRequestsScreen({super.key});

  @override
  State<BranchRequestsScreen> createState() => _BranchRequestsScreenState();
}

class _BranchRequestsScreenState extends State<BranchRequestsScreen>
    with WidgetsBindingObserver, AutoRefresh {
  List<BranchRequestRecord> _requests = const [];
  List<RoomStockItem> _items = const [];
  bool _loading = true;
  String _filter = 'All';

  static const _filters = ['All', 'Pending Admin', 'Supervisor Pending', 'Approved', 'Rejected'];

  @override
  void initState() {
    super.initState();
    _load();
    // Approvals happen in the other two portals; polling shows the stage move.
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
      final repository = context.read<StockRepository>();
      final requests = await repository.myBranchRequests();
      final stock = await repository.branchStock();
      if (mounted) {
        setState(() {
          _requests = requests;
          _items = stock.items;
        });
      }
    } catch (error) {
      debugPrint('Error fetching branch requests: $error');
      if (!silent) Toast.error('Could not load your requests');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool _matches(BranchRequestRecord request) => switch (_filter) {
        'Pending Admin' => request.isPendingAdmin,
        'Supervisor Pending' => request.isPendingSupervisor,
        'Approved' => request.isApproved,
        'Rejected' => request.isRejected,
        _ => true,
      };

  Future<void> _newRequest() async {
    final submitted = await showBranchRequestForm(context, items: _items);
    if (submitted) await _load(silent: true);
  }

  Future<void> _withdraw(BranchRequestRecord request) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Withdraw request', style: TextStyle(fontSize: 17)),
        content: Text(
          'Withdraw ${request.requestNumber}? The Admin has not decided it yet.',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.dangerDeep),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Withdraw'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await context.read<StockRepository>().cancelBranchRequest(request.id);
      Toast.success('Request ${request.requestNumber} withdrawn');
      await _load(silent: true);
    } on ApiException catch (error) {
      Toast.error(error.message);
    } catch (error) {
      debugPrint('Error withdrawing branch request: $error');
      Toast.error('Could not withdraw the request');
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible = _requests.where(_matches).toList();

    return AppShell(
      title: 'My Product Requests',
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _newRequest,
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.white,
        icon: const Icon(Icons.add, size: 20),
        label: const Text('New Request'),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: AppCard(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  const PanelHeader(
                    icon: Icons.assignment_outlined,
                    iconColor: AppColors.primaryDeep,
                    title: 'Admin approval first, then Supervisor',
                  ),
                  const SizedBox(height: 12),
                  _StageTally(requests: _requests),
                  const SizedBox(height: 12),
                  FilterTabs(
                    options: _filters,
                    selected: _filter,
                    onChanged: (value) => setState(() => _filter = value),
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
                                title: _requests.isEmpty
                                    ? 'No requests yet'
                                    : 'Nothing matches this filter',
                                message: _requests.isEmpty
                                    ? 'Tap New Request to apply for stock from your room.'
                                    : 'Try another status filter.',
                                icon: Icons.assignment_outlined,
                              ),
                            ],
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 90),
                            itemCount: visible.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 10),
                            itemBuilder: (context, index) => BranchRequestCard(
                              request: visible[index],
                              onWithdraw: visible[index].isPendingAdmin
                                  ? () => _withdraw(visible[index])
                                  : null,
                            ),
                          ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _StageTally extends StatelessWidget {
  const _StageTally({required this.requests});

  final List<BranchRequestRecord> requests;

  @override
  Widget build(BuildContext context) {
    final entries = [
      (
        label: 'Pending Admin',
        value: requests.where((r) => r.isPendingAdmin).length,
        color: AppColors.warning,
      ),
      (
        label: 'Supervisor',
        value: requests.where((r) => r.isPendingSupervisor).length,
        color: AppColors.accent,
      ),
      (
        label: 'Approved',
        value: requests.where((r) => r.isApproved).length,
        color: AppColors.success,
      ),
      (
        label: 'Rejected',
        value: requests.where((r) => r.isRejected).length,
        color: AppColors.danger,
      ),
    ];

    return Row(
      children: [
        for (final entry in entries)
          Expanded(
            child: Column(
              children: [
                Text(
                  '${entry.value}',
                  style: TextStyle(
                    color: entry.color,
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  entry.label,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.3,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// One request, with its stage chain always visible and the full trail behind
/// a tap. Shared with the Supervisor approvals screen, which adds the decision
/// controls underneath via [footer].
class BranchRequestCard extends StatefulWidget {
  const BranchRequestCard({
    super.key,
    required this.request,
    this.onWithdraw,
    this.footer,
  });

  final BranchRequestRecord request;
  final VoidCallback? onWithdraw;
  final Widget? footer;

  @override
  State<BranchRequestCard> createState() => _BranchRequestCardState();
}

class _BranchRequestCardState extends State<BranchRequestCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final request = widget.request;

    return AppCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ProductThumb(imageUrl: request.image, size: 42),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      request.productName,
                      style: const TextStyle(
                        color: AppColors.textStrong,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        MonoText('#${request.requestNumber}'),
                        SoftChip('${request.quantity} ${request.unit}'),
                        if (request.approvedQuantity != null &&
                            request.approvedQuantity != request.quantity)
                          SoftChip(
                            '${request.approvedQuantity} approved',
                            color: AppColors.primaryDeep,
                          ),
                        SoftChip(request.stockRoomName),
                      ],
                    ),
                  ],
                ),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: _expanded ? 'Hide history' : 'Show history',
                icon: Icon(
                  _expanded ? Icons.expand_less : Icons.expand_more,
                  size: 20,
                  color: AppColors.textSecondary,
                ),
                onPressed: () => setState(() => _expanded = !_expanded),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: BranchStatusBadge(request.status)),
              if (widget.onWithdraw != null)
                IconButton(
                  visualDensity: VisualDensity.compact,
                  tooltip: 'Withdraw request',
                  icon: const Icon(Icons.delete_outline, size: 18),
                  color: AppColors.danger,
                  onPressed: widget.onWithdraw,
                ),
            ],
          ),
          const SizedBox(height: 10),
          BranchStageChain(request),
          if (widget.footer != null) ...[
            const SizedBox(height: 12),
            widget.footer!,
          ],
          if (_expanded) ...[
            const Divider(height: 24),
            const Text(
              'APPROVAL HISTORY',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.7,
              ),
            ),
            const SizedBox(height: 12),
            BranchHistoryTimeline(request.history),
            const Divider(height: 24),
            _Details(request: request),
          ],
        ],
      ),
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({required this.request});

  final BranchRequestRecord request;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: SpecTile(label: 'Product code', value: request.productCode),
            ),
            Expanded(
              child: SpecTile(
                label: 'Room stock when raised',
                value: '${request.stockAtRequest}',
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: SpecTile(
                label: 'Admin',
                value: request.adminName.isEmpty ? 'Not decided yet' : request.adminName,
              ),
            ),
            Expanded(
              child: SpecTile(
                label: 'Supervisor',
                value: request.supervisorName.isEmpty
                    ? 'Not decided yet'
                    : request.supervisorName,
              ),
            ),
          ],
        ),
        if (request.purpose.isNotEmpty) ...[
          const SizedBox(height: 8),
          SpecTile(label: 'Purpose', value: request.purpose),
        ],
        const SizedBox(height: 8),
        SpecTile(label: 'Raised', value: formatDateTime(request.createdAt)),
      ],
    );
  }
}
