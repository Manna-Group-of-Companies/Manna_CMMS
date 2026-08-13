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
import '../../widgets/common.dart';
import '../../widgets/product_details_sheet.dart' show SheetGrabber;

/// `pages/supervisor/MyRequests.jsx`.
class MyRequestsScreen extends StatefulWidget {
  const MyRequestsScreen({super.key});

  @override
  State<MyRequestsScreen> createState() => _MyRequestsScreenState();
}

class _MyRequestsScreenState extends State<MyRequestsScreen>
    with WidgetsBindingObserver, AutoRefresh {
  List<MyRequest> _requests = const [];
  bool _loading = true;
  String _statusFilter = 'All';

  @override
  void initState() {
    super.initState();
    _load();
    // An Admin decision lands on the web console, so re-read on a timer.
    startAutoRefresh();
  }

  @override
  void dispose() {
    stopAutoRefresh();
    super.dispose();
  }

  @override
  Future<void> refreshData() => _load(silent: true);

  /// [silent] suppresses the error toast so a background poll on a flaky
  /// connection does not nag.
  Future<void> _load({bool silent = false}) async {
    try {
      final requests = await context.read<StockRepository>().myRequests();
      if (mounted) setState(() => _requests = requests);
    } catch (error) {
      debugPrint('Error fetching my requests: $error');
      if (!silent) Toast.error('Could not load request history');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<MyRequest> get _filtered => _statusFilter == 'All'
      ? _requests
      : _requests.where((r) => r.displayStatus == _statusFilter).toList();

  @override
  Widget build(BuildContext context) {
    final requests = _filtered;

    return AppShell(
      title: 'My Requests Tracker',
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
                    title: 'Submitted Requests Log',
                  ),
                  const SizedBox(height: 14),
                  FilterTabs(
                    options: const ['All', 'Pending', 'Accepted', 'Rejected'],
                    selected: _statusFilter,
                    onChanged: (value) => setState(() => _statusFilter = value),
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
                    child: requests.isEmpty
                        ? ListView(
                            padding: const EdgeInsets.all(16),
                            children: [
                              EmptyState(
                                title: 'No requests found',
                                message:
                                    'There are no requests matching the status: $_statusFilter.',
                              ),
                            ],
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                            itemCount: requests.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 10),
                            itemBuilder: (context, index) => _MyRequestCard(
                              request: requests[index],
                              onChanged: _load,
                            ),
                          ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _MyRequestCard extends StatelessWidget {
  const _MyRequestCard({required this.request, required this.onChanged});

  final MyRequest request;

  /// Called after an edit or cancellation so the list re-reads the API.
  final Future<void> Function() onChanged;

  /// Only stock requests carry a quantity that can be revised; a product
  /// ADD/EDIT request can be cancelled but not edited in place.
  bool get _canEdit => request.isPending && request.rawType != 'product';

  Future<void> _edit(BuildContext context) async {
    final saved = await showEditRequestForm(context, request: request);
    if (saved) await onChanged();
  }

  Future<void> _cancel(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cancel request', style: TextStyle(fontSize: 17)),
        content: Text(
          'Cancel ${request.requestNumber}? The Admin will see it as Cancelled. '
          'This cannot be undone.',
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
            child: const Text('Cancel Request'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;

    try {
      final message = await context.read<StockRepository>().cancelStockRequest(
            kind: request.rawType,
            id: request.id,
          );
      Toast.success(message);
      await onChanged();
    } on ApiException catch (error) {
      Toast.error(error.message);
    } catch (_) {
      Toast.error('Failed to cancel the request');
    }
  }

  @override
  Widget build(BuildContext context) {
    final comments = request.adminComments.isNotEmpty
        ? request.adminComments
        : (request.status == 'Pending' ? 'Awaiting review...' : 'No comments left.');

    return AppCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              MonoText(request.requestNumber, fontSize: 11.5),
              const Spacer(),
              StatusBadge(request.displayStatus, withIcon: true),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      request.productName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textStrong,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        height: 1.25,
                      ),
                    ),
                    if (request.quantity > 0) ...[
                      const SizedBox(height: 4),
                      Text(
                        'Requested: ${request.quantity} Pcs',
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              RequestTypeBadge(request.requestType),
            ],
          ),
          if (request.hasDecisionDetail) ...[
            const SizedBox(height: 12),
            _DecisionPanel(request: request),
          ],
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.chat_bubble_outline, size: 13, color: AppColors.textMuted),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  comments,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                    fontStyle: FontStyle.italic,
                    height: 1.45,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              const Icon(Icons.calendar_today_outlined, size: 12, color: AppColors.textMuted),
              const SizedBox(width: 5),
              Text(
                formatDate(request.createdDate),
                style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
              ),
              const Spacer(),
              // A request can only be changed while the Admin has not acted.
              if (request.isPending) ...[
                if (_canEdit)
                  TextButton.icon(
                    onPressed: () => _edit(context),
                    icon: const Icon(Icons.edit_outlined, size: 15),
                    label: const Text('Edit'),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.primaryDeep,
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                  ),
                TextButton.icon(
                  onPressed: () => _cancel(context),
                  icon: const Icon(Icons.close, size: 15),
                  label: const Text('Cancel'),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.dangerDeep,
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

/// Revise a still-pending stock request. Resolves to `true` when saved.
Future<bool> showEditRequestForm(
  BuildContext context, {
  required MyRequest request,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _EditRequestSheet(request: request),
  );
  return result ?? false;
}

class _EditRequestSheet extends StatefulWidget {
  const _EditRequestSheet({required this.request});

  final MyRequest request;

  @override
  State<_EditRequestSheet> createState() => _EditRequestSheetState();
}

class _EditRequestSheetState extends State<_EditRequestSheet> {
  late final TextEditingController _quantity =
      TextEditingController(text: '${widget.request.quantity}');
  List<StockRoom> _rooms = const [];
  String? _roomId;
  bool _submitting = false;

  bool get _picksRoom => widget.request.rawType == 'stockin';
  int get _qty => int.tryParse(_quantity.text.trim()) ?? 0;

  @override
  void initState() {
    super.initState();
    if (_picksRoom) _loadRooms();
  }

  Future<void> _loadRooms() async {
    try {
      final rooms = await context.read<StockRepository>().stockRooms();
      if (!mounted) return;
      setState(() {
        _rooms = rooms;
        _roomId = rooms
                .where((room) => room.name == widget.request.requestedStockRoom)
                .firstOrNull
                ?.id ??
            rooms.firstOrNull?.id;
      });
    } catch (error) {
      debugPrint('Could not load stock rooms: $error');
    }
  }

  @override
  void dispose() {
    _quantity.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_qty < 1) {
      Toast.error('Quantity must be at least 1');
      return;
    }

    setState(() => _submitting = true);
    try {
      final message = await context.read<StockRepository>().updateStockRequest(
            kind: widget.request.rawType,
            id: widget.request.id,
            quantity: _qty,
            stockRoomId: _picksRoom ? _roomId : null,
          );
      Toast.success(message);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      Toast.error(error.message);
    } catch (_) {
      Toast.error('Failed to update the request');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SheetGrabber(),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 12, 12),
                child: Row(
                  children: [
                    const Icon(Icons.edit_outlined, size: 20, color: AppColors.primaryDeep),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Edit ${widget.request.requestNumber}',
                        style: const TextStyle(
                          color: AppColors.textStrong,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, size: 20),
                      color: AppColors.textSecondary,
                      onPressed:
                          _submitting ? null : () => Navigator.of(context).pop(false),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      widget.request.productName,
                      style: const TextStyle(
                        color: AppColors.textStrong,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 14),
                    const Text(
                      'Quantity',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 7),
                    QuantityStepper(
                      controller: _quantity,
                      onChanged: () => setState(() {}),
                    ),
                    if (_picksRoom && _rooms.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      const Text(
                        'Preferred Stock Room',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 7),
                      DropdownShell(
                        child: AppDropdown<String>(
                          value: _roomId ?? _rooms.first.id,
                          items: _rooms.map((room) => room.id).toList(),
                          labelBuilder: (id) =>
                              _rooms.firstWhere((room) => room.id == id).name,
                          onChanged: (value) => setState(() => _roomId = value),
                        ),
                      ),
                    ],
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed:
                                _submitting ? null : () => Navigator.of(context).pop(false),
                            child: const Text('Cancel'),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          flex: 2,
                          child: FilledButton(
                            onPressed: (_submitting || _qty < 1) ? null : _submit,
                            child: _submitting
                                ? const SizedBox(
                                    height: 18,
                                    width: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2.2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Text('Save Changes'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The outcome of a decided request: for an acceptance, how much landed and
/// where; for a rejection, who turned it down and when.
class _DecisionPanel extends StatelessWidget {
  const _DecisionPanel({required this.request});

  final MyRequest request;

  @override
  Widget build(BuildContext context) {
    final approved = request.isApproved;
    final accent = approved ? AppColors.success : AppColors.danger;

    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: accent.withValues(alpha: 0.16)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (approved) ...[
            if (request.approvedQuantity != null)
              _DecisionLine(
                icon: Icons.inventory_2_outlined,
                label: 'Approved',
                value: '${request.approvedQuantity} Pcs',
                accent: accent,
              ),
            if (request.stockRoom.isNotEmpty)
              _DecisionLine(
                icon: Icons.warehouse_outlined,
                label: 'Stock room',
                value: request.stockRoom,
                accent: accent,
              ),
            if (request.decidedBy.isNotEmpty)
              _DecisionLine(
                icon: Icons.verified_user_outlined,
                label: 'Approved by',
                value: request.decidedBy,
                accent: accent,
              ),
            if (request.approvedAt != null)
              _DecisionLine(
                icon: Icons.event_available_outlined,
                label: 'Approved on',
                value: formatDateTime(request.approvedAt),
                accent: accent,
              ),
          ] else ...[
            if (request.decidedBy.isNotEmpty)
              _DecisionLine(
                icon: Icons.person_off_outlined,
                label: 'Rejected by',
                value: request.decidedBy,
                accent: accent,
              ),
            if (request.rejectedAt != null)
              _DecisionLine(
                icon: Icons.event_busy_outlined,
                label: 'Rejected on',
                value: formatDateTime(request.rejectedAt),
                accent: accent,
              ),
          ],
        ],
      ),
    );
  }
}

class _DecisionLine extends StatelessWidget {
  const _DecisionLine({
    required this.icon,
    required this.label,
    required this.value,
    required this.accent,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 13, color: accent),
          const SizedBox(width: 7),
          Text('$label: ', style: TextStyle(color: accent, fontSize: 11.5)),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: accent,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
