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
import '../../widgets/app_table.dart';
import '../../widgets/common.dart';
import '../../widgets/product_details_sheet.dart' show SheetGrabber;

/// `pages/supervisor/MyRequests.jsx` — the whole store's request queue: who
/// asked for what, when, and how the Admin decided. Editing and cancelling
/// stay with whoever raised the request.
class MyRequestsScreen extends StatefulWidget {
  const MyRequestsScreen({super.key});

  @override
  State<MyRequestsScreen> createState() => _MyRequestsScreenState();
}

class _MyRequestsScreenState extends State<MyRequestsScreen>
    with WidgetsBindingObserver, AutoRefresh {
  // Short, because the scope tabs share a row with the status filter.
  static const _allScope = 'All';
  static const _mineScope = 'Mine';

  static const _statuses = ['All Statuses', 'Pending', 'Accepted', 'Rejected'];

  List<MyRequest> _requests = const [];
  bool _loading = true;
  String _statusFilter = _statuses.first;
  String _scope = _allScope;

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

  /// Scope narrows who raised it; the status filter then narrows that.
  List<MyRequest> get _filtered {
    final scoped =
        _scope == _mineScope ? _requests.where((r) => r.isMine) : _requests;
    if (_statusFilter == _statuses.first) return scoped.toList();
    return scoped.where((r) => r.displayStatus == _statusFilter).toList();
  }

  @override
  Widget build(BuildContext context) {
    final requests = _filtered;
    final mine = _requests.where((r) => r.isMine).length;

    return AppShell(
      title: 'Requests Tracker',
      child: Column(
        children: [
          // One row of filters over a count line, instead of a panel carrying
          // two rows of tabs.
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      flex: 5,
                      child: FilterTabs(
                        options: const [_allScope, _mineScope],
                        selected: _scope,
                        onChanged: (value) => setState(() => _scope = value),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 4,
                      child: DropdownShell(
                        child: AppDropdown<String>(
                          value: _statusFilter,
                          items: _statuses,
                          onChanged: (value) {
                            if (value != null) {
                              setState(() => _statusFilter = value);
                            }
                          },
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '${requests.length} shown • $mine of ${_requests.length} raised by you',
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                  ),
                ),
              ],
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
                        : _buildTable(requests),
                  ),
          ),
        ],
      ),
    );
  }

  /// The queue as rows and columns; the rest of each request — who raised it,
  /// the Admin's decision and comments, and the edit/cancel actions — unfolds
  /// under its row.
  Widget _buildTable(List<MyRequest> requests) {
    return AppTable<MyRequest>(
      items: requests,
      idOf: (request) => request.id,
      columns: const [
        AppTableColumn('Request', flex: 6),
        AppTableColumn('Qty', width: 46, center: true),
        AppTableColumn('Status', width: 80, center: true),
      ],
      cellsOf: (context, request) => [
        TableTitleCell(
          title: request.productName,
          subtitle: '${request.requestNumber} • ${request.requestType}',
        ),
        TableNumberCell(
          value: request.quantity > 0 ? '${request.quantity}' : '—',
          unit: request.quantity > 0 ? 'Pcs' : '',
          color: RequestTypeBadge.colorOf(request.requestType),
        ),
        TableBadgeCell(
          request.displayStatus,
          color: StatusColors.of(request.displayStatus),
        ),
      ],
      detailOf: (context, request) => TableDetail(
        lines: _detailLines(request),
        actions: [
          // A request can only be changed by whoever raised it, and only while
          // the Admin has not acted.
          if (_canEdit(request))
            TableActionButton(
              label: 'Edit',
              icon: Icons.edit_outlined,
              color: AppColors.primaryDeep,
              onPressed: () => _edit(request),
            ),
          if (_canCancel(request))
            TableActionButton(
              label: 'Cancel request',
              icon: Icons.close,
              color: AppColors.dangerDeep,
              onPressed: () => _cancel(request),
            ),
        ],
      ),
    );
  }

  List<Widget> _detailLines(MyRequest request) {
    final approved = request.isApproved;
    // Only a Stock In stamps its own decision timestamps; the rest fall back to
    // the save that closed the request.
    final decidedOn =
        (approved ? request.approvedAt : request.rejectedAt) ?? request.decidedAt;
    final accent = approved ? AppColors.success : AppColors.danger;

    return [
      TableDetailLine(
        label: 'Request #',
        value: request.requestNumber,
        mono: true,
        valueColor: AppColors.primaryDeep,
      ),
      TableDetailLine(
        label: 'Type',
        value: request.requestType,
        valueColor: RequestTypeBadge.colorOf(request.requestType),
      ),
      TableDetailLine(
        label: 'Raised by',
        value: request.isMine
            ? '${request.supervisorName} (you)'
            : request.supervisorName,
        valueColor: request.isMine ? AppColors.primaryDeep : null,
      ),
      TableDetailLine(
        label: 'Status',
        value: request.displayStatus,
        valueColor: StatusColors.of(request.displayStatus),
      ),
      TableDetailLine(
        label: 'Raised on',
        value: formatDateTime(request.createdDate),
      ),
      if (request.hasDecisionDetail) ...[
        if (approved && request.approvedQuantity != null)
          TableDetailLine(
            label: 'Approved',
            value: '${request.approvedQuantity} Pcs',
            valueColor: accent,
          ),
        if (approved && request.stockRoom.isNotEmpty)
          TableDetailLine(label: 'Stock room', value: request.stockRoom, valueColor: accent),
        if (request.decidedBy.isNotEmpty)
          TableDetailLine(
            label: approved ? 'Approved by' : 'Rejected by',
            value: request.decidedBy,
            valueColor: accent,
          ),
        if (decidedOn != null)
          TableDetailLine(
            label: approved ? 'Approved on' : 'Rejected on',
            value: formatDateTime(decidedOn),
            valueColor: accent,
          ),
      ],
      TableDetailLine(
        label: 'Admin comments',
        value: request.adminComments.isNotEmpty
            ? request.adminComments
            : (request.status == 'Pending'
                ? 'Awaiting review...'
                : 'No comments left.'),
        italic: true,
      ),
    ];
  }

  /// Only stock requests carry a quantity that can be revised; a product
  /// ADD/EDIT request can be cancelled but not edited in place. Either way it
  /// has to be the caller's own request — the server enforces that too.
  bool _canEdit(MyRequest request) =>
      request.isMine && request.isPending && request.rawType != 'product';

  bool _canCancel(MyRequest request) => request.isMine && request.isPending;

  Future<void> _edit(MyRequest request) async {
    final saved = await showEditRequestForm(context, request: request);
    if (saved) await _load();
  }

  Future<void> _cancel(MyRequest request) async {
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
    if (confirmed != true || !mounted) return;

    try {
      final message = await context.read<StockRepository>().cancelStockRequest(
            kind: request.rawType,
            id: request.id,
          );
      Toast.success(message);
      await _load();
    } on ApiException catch (error) {
      Toast.error(error.message);
    } catch (_) {
      Toast.error('Failed to cancel the request');
    }
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
