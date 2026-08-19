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
import '../../widgets/room_inventory_view.dart';
import 'product_forms.dart';

/// `pages/supervisor/MyReturns.jsx` — the whole Red Stock Room: every
/// supervisor's returned stock and how far each batch has moved through the
/// merge, plus the live per-room stock balances on a second tab.
///
/// The room is shared but a merge is not: a supervisor can only send their own
/// batches. Their merge moves the stock into the main store immediately, with
/// no Admin approval step.
class MyReturnsScreen extends StatefulWidget {
  const MyReturnsScreen({super.key});

  @override
  State<MyReturnsScreen> createState() => _MyReturnsScreenState();
}

class _MyReturnsScreenState extends State<MyReturnsScreen>
    with WidgetsBindingObserver, AutoRefresh {
  /// The two halves of this screen: the supervisor's own returns, and the
  /// stock-by-room balances that used to live on their own page.
  static const _returnsView = 'My Returns';
  static const _roomsView = 'Stock by Room';

  // Short, because the scope tabs share a row with the status filter.
  static const _allScope = 'All';
  static const _mineScope = 'Mine';

  static const _filters = ['All Statuses', 'In Red Stock', 'In Merge', 'Moved'];

  /// Short filter labels map onto the server's Red Stock statuses.
  static const _statusesFor = {
    'In Red Stock': ['In Red Stock'],
    'In Merge': ['Weekly Merge Pending'],
    'Moved': ['Moved to Stock Room'],
  };

  List<RestockRecord> _items = const [];
  List<MergeRequestSummary> _merges = const [];
  bool _loading = true;
  bool _merging = false;
  String _filter = 'All Statuses';
  String _scope = _allScope;
  String _view = _returnsView;

  /// Returns picked out by holding them, by restock id. Empty means the whole
  /// of Red Stock goes in the next merge request.
  final Set<String> _selected = {};

  @override
  void initState() {
    super.initState();
    _load();
    // Other stock activity can change this list while the screen is open.
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
      final items = await repository.restockItems();
      // Older servers do not serve this yet, so a failure here must not cost
      // the returns list.
      final merges = await repository.myMergeRequests().catchError((Object error) {
        debugPrint('Error loading merge requests: $error');
        return const <MergeRequestSummary>[];
      });

      if (mounted) {
        setState(() {
          _items = items;
          _merges = merges;
          // A selected return can leave Red Stock without the user doing
          // anything — the weekly run may claim it — so drop anything that is
          // no longer mergeable rather than sending a stale id.
          final mergeable = items
              .where((item) => item.isMine && item.awaitingMerge)
              .map((item) => item.id)
              .toSet();
          _selected.retainAll(mergeable);
        });
      }
    } catch (error) {
      debugPrint('Error loading returns: $error');
      if (!silent) Toast.error('Failed to load your returns');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Scope narrows who returned it; the status filter then narrows that.
  List<RestockRecord> get _visible {
    final scoped = _scope == _mineScope ? _items.where((item) => item.isMine) : _items;
    final statuses = _statusesFor[_filter];
    if (statuses == null) return scoped.toList();
    return scoped.where((item) => statuses.contains(item.status)).toList();
  }

  /// The room is shared, but only the caller's own batches can go into a merge
  /// they raise, so everything about selecting and merging counts those.
  List<RestockRecord> get _mine => _items.where((item) => item.isMine).toList();

  int get _awaitingMerge => _mine.where((item) => item.canMerge).length;

  /// Nothing held: the merge covers everything in Red Stock.
  bool get _selecting => _selected.isNotEmpty;

  /// The returns the next merge request would carry.
  List<RestockRecord> get _mergeable => _mine
      .where((item) => item.canMerge && (!_selecting || _selected.contains(item.id)))
      .toList();

  /// How much that is, which is what the button offers to send.
  int get _mergeQuantity =>
      _mergeable.fold(0, (sum, item) => sum + item.quantity);

  /// Holding a return picks it out; holding or tapping again puts it back.
  /// Only the Red Stock Room can be picked — anything already moved, or returned
  /// by another supervisor, is not this supervisor's to merge.
  void _toggle(RestockRecord item) {
    if (!item.isMine) {
      Toast.error('Only the supervisor who returned this can merge it');
      return;
    }
    if (!item.canMerge) {
      Toast.error('Only stock still in Red Stock can be merged');
      return;
    }
    setState(() {
      if (!_selected.remove(item.id)) _selected.add(item.id);
    });
  }

  /// What to report back: the outcome of the last merge raised. A pending one is
  /// preferred only because an older server could still leave one waiting.
  MergeRequestSummary? get _latestMerge =>
      _merges.where((merge) => merge.isPending).firstOrNull ?? _merges.firstOrNull;

  /// Confirms, then merges. The stock is in the main store by the time this
  /// returns — there is nothing left for the Admin to approve.
  Future<void> _requestMerge() async {
    final picked = _mergeable;
    if (picked.isEmpty) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Merge to Main Store', style: TextStyle(fontSize: 17)),
        content: Text(
          'Merge $_mergeQuantity Pcs across ${picked.length} '
          '${_selecting ? "selected " : ""}returned item(s) out of Red Stock.'
          '\n\nAll items move into the main store, and the stock is '
          'available straight away — this no longer waits for the Admin.',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Merge Now'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _merging = true);
    try {
      final message = await context.read<StockRepository>().requestMerge(
            // Omitted entirely when nothing was held, so the server sends
            // everything the supervisor has in Red Stock.
            restockItemIds: _selecting ? picked.map((item) => item.id).toList() : null,
          );
      Toast.success(message);
      setState(_selected.clear);
      await _load();
    } on ApiException catch (error) {
      Toast.error(error.message);
    } catch (error) {
      debugPrint('Error requesting merge: $error');
      Toast.error('Could not send the merge request');
    } finally {
      if (mounted) setState(() => _merging = false);
    }
  }

  /// Writes a return off out of the Red Stock Room.
  ///
  /// The room is shared and so is this: a merge only moves a supervisor's own
  /// batches, but scrap is a write-off of stock physically sitting in the room
  /// and the server lets any supervisor book one. Only a batch still in Red
  /// Stock can go — once the weekly sweep has claimed it, its quantity is
  /// counted in a merge the Admin is being asked to approve.
  Future<void> _scrap(RestockRecord item) async {
    final recorded = await showRedStockScrapForm(context, item: item);
    // The batch is smaller now, or gone from the room entirely.
    if (recorded && mounted) await _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // While returns are picked out, Back drops the selection rather than
      // leaving the screen — the usual Android hold-to-select behaviour.
      canPop: !_selecting,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _selecting) setState(_selected.clear);
      },
      child: _buildScreen(),
    );
  }

  Widget _buildScreen() {
    return AppShell(
      title: 'Red Stock Room',
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: FilterTabs(
              options: const [_returnsView, _roomsView],
              selected: _view,
              onChanged: (value) => setState(() => _view = value),
            ),
          ),
          Expanded(
            child: _view == _roomsView ? const RoomInventoryView() : _buildReturns(),
          ),
        ],
      ),
    );
  }

  Widget _buildReturns() {
    final visible = _visible;

    return Column(
      children: [
        // Everything above the grid is kept to two rows: the merge action with
        // its status line, and one row of filters.
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: _MergeButton(
                      quantity: _mergeQuantity,
                      count: _selecting ? _selected.length : 0,
                      busy: _merging,
                      onPressed:
                          _mergeable.isEmpty || _merging ? null : _requestMerge,
                    ),
                  ),
                  const SizedBox(width: 8),
                  AppBadge(
                    '$_awaitingMerge / ${_items.length}',
                    icon: Icons.assignment_return_outlined,
                    color: AppColors.accent,
                    uppercase: false,
                    fontSize: 11.5,
                  ),
                ],
              ),
              _SelectionBar(
                selecting: _selecting,
                selected: _selected.length,
                selectable: _awaitingMerge,
                onSelectAll: () => setState(() => _selected
                  ..clear()
                  ..addAll(_mine.where((item) => item.canMerge).map((item) => item.id))),
                onClear: () => setState(_selected.clear),
              ),
              if (_latestMerge case final merge?) ...[
                const SizedBox(height: 8),
                _MergeStatusLine(merge: merge),
              ],
              const SizedBox(height: 8),
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
                        value: _filter,
                        items: _filters,
                        onChanged: (value) {
                          if (value != null) setState(() => _filter = value);
                        },
                      ),
                    ),
                  ),
                ],
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
                  child: visible.isEmpty
                      ? ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            EmptyState(
                              title: _scope == _mineScope
                                  ? 'You have no returns here'
                                  : 'No returns found',
                              message:
                                  'Return issued stock from the Issue History — it goes '
                                  'straight into the Red Stock Room.',
                              icon: Icons.assignment_return_outlined,
                            ),
                          ],
                        )
                      : _buildTable(visible),
                ),
        ),
      ],
    );
  }

  /// The returns as rows and columns; the rest of each return unfolds under it.
  Widget _buildTable(List<RestockRecord> visible) {
    return AppTable<RestockRecord>(
      items: visible,
      idOf: (item) => item.id,
      selectedOf: (item) => _selected.contains(item.id),
      // Holding starts a selection; once one is under way a plain tap adds or
      // drops rather than unfolding.
      onRowLongPress: (_, item) => _toggle(item),
      onRowTap: _selecting ? (_, item) => _toggle(item) : null,
      columns: const [
        AppTableColumn('Engineering Stock', flex: 6),
        AppTableColumn('Qty', width: 52, center: true),
        AppTableColumn('Status', width: 82, center: true),
      ],
      cellsOf: (context, item) {
        final pickable = item.isMine && item.canMerge;

        return [
          Row(
            children: [
              if (_selecting && pickable) ...[
                Icon(
                  _selected.contains(item.id)
                      ? Icons.check_circle
                      : Icons.circle_outlined,
                  size: 17,
                  color: _selected.contains(item.id)
                      ? AppColors.accent
                      : AppColors.textFaint,
                ),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: TableTitleCell(
                  title: item.productName,
                  subtitle: item.productCode,
                  imageUrl: item.product?.image ?? '',
                ),
              ),
            ],
          ),
          TableNumberCell(
            value: '+${item.quantity}',
            unit: item.unit,
            color: AppColors.accent,
          ),
          TableBadgeCell(
            _shortStatus(item),
            color: _statusColor(item.status),
          ),
        ];
      },
      detailOf: (context, item) => TableDetail(
        lines: [
          TableDetailLine(label: 'Return #', value: item.restockNumber, mono: true),
          TableDetailLine(
            label: 'Returned by',
            value: item.isMine ? '${item.returnedByName} (you)' : item.returnedByName,
            valueColor: item.isMine ? AppColors.primaryDeep : null,
          ),
          TableDetailLine(label: 'Condition', value: item.condition),
          TableDetailLine(label: 'Department', value: item.department),
          TableDetailLine(
            label: 'Status',
            value: item.awaitingMerge ? 'Returned / In Red Stock' : item.status,
            valueColor: _statusColor(item.status),
          ),
          if (item.destinationStoreRoom.isNotEmpty)
            TableDetailLine(label: 'Moved to', value: item.destinationStoreRoom),
          if (item.mergeRequestId.isNotEmpty)
            TableDetailLine(label: 'Merge', value: item.mergeRequestId, mono: true),
          TableDetailLine(
            label: 'Returned on',
            value: formatDateTime(item.returnDate),
          ),
          if (item.awaitingMerge && item.rejectionReason.isNotEmpty)
            TableDetailLine(
              label: 'Merge rejected',
              value: item.rejectionReason,
              valueColor: AppColors.danger,
            ),
        ],
        actions: [
          // Only while the batch is still in the room and not spoken for by an
          // open merge — the API refuses it in any other state.
          if (item.awaitingMerge)
            TableActionButton(
              label: 'Scrap',
              icon: Icons.delete_outline,
              color: AppColors.danger,
              onPressed: () => _scrap(item),
            ),
        ],
      ),
    );
  }

  /// The badge wording, shortened to what a phone column can hold.
  static String _shortStatus(RestockRecord item) => switch (item.status) {
        'Moved to Stock Room' => 'Moved',
        'Weekly Merge Pending' => 'In Merge',
        _ => 'Red Stock',
      };

  static Color _statusColor(String status) => switch (status) {
        'Moved to Stock Room' => AppColors.success,
        'Weekly Merge Pending' => AppColors.info,
        _ => AppColors.danger,
      };
}

/// Sends Red Stock to the Admin: everything, or only what has been held and
/// picked out. Disabled while there is nothing to send — a request over no
/// items is refused by the API anyway, and the label says so.
class _MergeButton extends StatelessWidget {
  const _MergeButton({
    required this.quantity,
    required this.count,
    required this.busy,
    required this.onPressed,
  });

  final int quantity;

  /// How many returns were picked by hand; 0 when the merge covers the lot.
  final int count;
  final bool busy;
  final VoidCallback? onPressed;

  String get _label {
    if (quantity == 0) return 'Nothing to merge';
    if (count > 0) return 'Merge $count Selected ($quantity Pcs)';
    return 'Merge $quantity Pcs to Main Store';
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.accent,
          disabledBackgroundColor: AppColors.surfaceMuted,
          disabledForegroundColor: AppColors.textMuted,
          padding: const EdgeInsets.symmetric(vertical: 13),
        ),
        icon: busy
            ? const SizedBox(
                height: 15,
                width: 15,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
              )
            : const Icon(Icons.merge_outlined, size: 18),
        label: Text(
          _label,
          style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

/// The line under the merge button: how to pick returns before a selection has
/// started, and what is picked once one has.
class _SelectionBar extends StatelessWidget {
  const _SelectionBar({
    required this.selecting,
    required this.selected,
    required this.selectable,
    required this.onSelectAll,
    required this.onClear,
  });

  final bool selecting;
  final int selected;

  /// How many returns are in Red Stock, i.e. how many can be picked at all.
  final int selectable;
  final VoidCallback onSelectAll;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    // Nothing to say when there is nothing to pick.
    if (!selecting && selectable == 0) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: !selecting
          ? const Row(
              children: [
                Icon(Icons.touch_app_outlined, size: 13, color: AppColors.textMuted),
                SizedBox(width: 5),
                Expanded(
                  child: Text(
                    'Hold a return to merge only some of them',
                    style: TextStyle(color: AppColors.textMuted, fontSize: 11),
                  ),
                ),
              ],
            )
          : Row(
              children: [
                const Icon(Icons.check_circle, size: 13, color: AppColors.accent),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    '$selected of $selectable selected',
                    style: const TextStyle(
                      color: AppColors.textBody,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                if (selected < selectable)
                  TextButton(
                    onPressed: onSelectAll,
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      foregroundColor: AppColors.primaryDeep,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                    child: const Text('Select all', style: TextStyle(fontSize: 11.5)),
                  ),
                TextButton(
                  onPressed: onClear,
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    foregroundColor: AppColors.textSecondary,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                  ),
                  child: const Text('Clear', style: TextStyle(fontSize: 11.5)),
                ),
              ],
            ),
    );
  }
}

/// Where the supervisor's last merge stands: which company it went into, and
/// that the stock is there now. Their own merges apply as they are raised, so
/// this reports an outcome rather than a decision someone else still owes them.
class _MergeStatusLine extends StatelessWidget {
  const _MergeStatusLine({required this.merge});

  final MergeRequestSummary merge;

  Color get _color => switch (merge.status) {
        'Approved' => AppColors.success,
        'Rejected' => AppColors.danger,
        _ => AppColors.info,
      };

  IconData get _icon => switch (merge.status) {
        'Approved' => Icons.check_circle_outline,
        'Rejected' => Icons.cancel_outlined,
        _ => Icons.hourglass_top_outlined,
      };

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: _color.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: _color.withValues(alpha: 0.18)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(_icon, size: 16, color: _color),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    MonoText(merge.requestId, color: _color, fontSize: 11),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        '${merge.totalQuantity} Pcs • ${merge.itemCount} item(s)',
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppColors.textMuted, fontSize: 10.5),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  merge.summary,
                  style: TextStyle(color: _color, fontSize: 11.5, height: 1.35),
                ),
                if (merge.reviewedAt != null || merge.requestedAt != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    formatDateTime(merge.reviewedAt ?? merge.requestedAt),
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 10),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
