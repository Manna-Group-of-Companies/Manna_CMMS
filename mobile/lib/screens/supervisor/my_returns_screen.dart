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
import '../../widgets/room_inventory_view.dart';

/// `pages/supervisor/MyReturns.jsx` — the supervisor's own returned stock and
/// how far each batch has moved through the merge, plus the live per-room
/// stock balances on a second tab.
///
/// The supervisor can ask for their Red Stock to be merged rather than waiting
/// for the weekly run, but the decision is not theirs: the request goes to the
/// Admin, and only an approval moves stock into a store room.
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

  static const _filters = ['All', 'In Red Stock', 'In Merge', 'Moved'];

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
  String _filter = 'All';
  String _view = _returnsView;

  /// Returns picked out by holding them, by restock id. Empty means the whole
  /// of Red Stock goes in the next merge request.
  final Set<String> _selected = {};

  @override
  void initState() {
    super.initState();
    _load();
    // The Admin's merge decision lands on their console.
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
              .where((item) => item.awaitingMerge)
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

  List<RestockRecord> get _visible {
    final statuses = _statusesFor[_filter];
    if (statuses == null) return _items;
    return _items.where((item) => statuses.contains(item.status)).toList();
  }

  int get _awaitingMerge => _items.where((item) => item.awaitingMerge).length;

  /// Nothing held: the merge covers everything in Red Stock.
  bool get _selecting => _selected.isNotEmpty;

  /// The returns the next merge request would carry.
  List<RestockRecord> get _mergeable => _items
      .where((item) =>
          item.awaitingMerge && (!_selecting || _selected.contains(item.id)))
      .toList();

  /// How much that is, which is what the button offers to send.
  int get _mergeQuantity =>
      _mergeable.fold(0, (sum, item) => sum + item.quantity);

  /// Holding a return picks it out; holding or tapping again puts it back.
  /// Only Red Stock can be picked — anything already in a merge, or moved, is
  /// not the supervisor's to send.
  void _toggle(RestockRecord item) {
    if (!item.awaitingMerge) {
      Toast.error('Only stock still in Red Stock can be merged');
      return;
    }
    setState(() {
      if (!_selected.remove(item.id)) _selected.add(item.id);
    });
  }

  /// What to report back: the merge still on the Admin's desk, or failing that
  /// the outcome of the last one raised.
  MergeRequestSummary? get _latestMerge =>
      _merges.where((merge) => merge.isPending).firstOrNull ?? _merges.firstOrNull;

  /// Confirms, then puts the request on the Admin's desk. Nothing moves here.
  Future<void> _requestMerge() async {
    final picked = _mergeable;
    if (picked.isEmpty) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Merge to store rooms', style: TextStyle(fontSize: 17)),
        content: Text(
          'Send $_mergeQuantity Pcs across ${picked.length} '
          '${_selecting ? "selected " : ""}returned item(s) to the Admin for '
          'merging.\n\nNothing moves yet — the Admin decides which store room '
          'the stock goes into.',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Send Request'),
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
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Column(
            children: [
              AppCard(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                child: Column(
                  children: [
                    PanelHeader(
                      icon: Icons.assignment_return_outlined,
                      iconColor: AppColors.accent,
                      title: 'My Returned Stock',
                      trailing: AppBadge(
                        '$_awaitingMerge awaiting merge',
                        color: AppColors.accent,
                        uppercase: false,
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(height: 12),
                    _MergeButton(
                      quantity: _mergeQuantity,
                      count: _selecting ? _selected.length : 0,
                      busy: _merging,
                      onPressed:
                          _mergeable.isEmpty || _merging ? null : _requestMerge,
                    ),
                    _SelectionBar(
                      selecting: _selecting,
                      selected: _selected.length,
                      selectable: _awaitingMerge,
                      onSelectAll: () => setState(() => _selected
                        ..clear()
                        ..addAll(_items
                            .where((item) => item.awaitingMerge)
                            .map((item) => item.id))),
                      onClear: () => setState(_selected.clear),
                    ),
                    if (_latestMerge case final merge?) ...[
                      const SizedBox(height: 10),
                      _MergeStatusLine(merge: merge),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 10),
              FilterTabs(
                options: _filters,
                selected: _filter,
                onChanged: (value) => setState(() => _filter = value),
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
                          children: const [
                            EmptyState(
                              title: 'No returns found',
                              message:
                                  'Return issued stock from your Issue History — it goes '
                                  'straight into the Red Stock Room.',
                              icon: Icons.assignment_return_outlined,
                            ),
                          ],
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                          itemCount: visible.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 10),
                          itemBuilder: (context, index) {
                            final item = visible[index];
                            return _RestockCard(
                              item: item,
                              selected: _selected.contains(item.id),
                              selecting: _selecting,
                              // Holding starts a selection; once one is under
                              // way a plain tap is enough to add or drop.
                              onLongPress: () => _toggle(item),
                              onTap: _selecting ? () => _toggle(item) : null,
                            );
                          },
                        ),
                ),
        ),
      ],
    );
  }
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
    return 'Merge $quantity Pcs to Store Rooms';
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

/// Where the supervisor's last merge request stands. The Admin owns the
/// decision, so this is the only place the outcome shows up unprompted.
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

class _RestockCard extends StatelessWidget {
  const _RestockCard({
    required this.item,
    required this.selected,
    required this.selecting,
    required this.onLongPress,
    required this.onTap,
  });

  final RestockRecord item;
  final bool selected;

  /// True once any return has been held, which is when the checkboxes appear.
  final bool selecting;
  final VoidCallback onLongPress;
  final VoidCallback? onTap;

  static Color _statusColor(String status) => switch (status) {
        'Moved to Stock Room' => AppColors.success,
        'Weekly Merge Pending' => AppColors.info,
        _ => AppColors.danger,
      };

  static Color _conditionColor(String condition) => switch (condition) {
        'Good' => AppColors.success,
        'Repairable' => AppColors.warning,
        _ => AppColors.danger,
      };

  @override
  Widget build(BuildContext context) {
    // Only Red Stock can go into a merge, so the rest stay plain even while a
    // selection is under way.
    final pickable = item.awaitingMerge;

    return AppCard(
      padding: const EdgeInsets.all(14),
      onLongPress: onLongPress,
      onTap: onTap,
      color: selected ? AppColors.accent.withValues(alpha: 0.05) : null,
      borderColor: selected ? AppColors.accent : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (selecting && pickable) ...[
                Icon(
                  selected ? Icons.check_circle : Icons.circle_outlined,
                  size: 17,
                  color: selected ? AppColors.accent : AppColors.textFaint,
                ),
                const SizedBox(width: 8),
              ],
              MonoText(item.restockNumber, color: AppColors.accent, fontSize: 11.5),
              const Spacer(),
              AppBadge(
                item.awaitingMerge ? 'Returned / In Red Stock' : item.status,
                color: _statusColor(item.status),
                uppercase: false,
                fontSize: 10.5,
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ProductThumb(imageUrl: item.product?.image ?? '', size: 42),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.productName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textStrong,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        height: 1.25,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        MonoText(
                          item.productCode.isEmpty ? '—' : item.productCode,
                          fontSize: 10.5,
                        ),
                        if (item.destinationStoreRoom.isNotEmpty) ...[
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              '• ${item.destinationStoreRoom}',
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 10.5,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              AppBadge(
                '+${item.quantity} ${item.unit}',
                color: AppColors.accent,
                uppercase: false,
                fontSize: 11.5,
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 12),
          Row(
            children: [
              const Text(
                'Condition: ',
                style: TextStyle(color: AppColors.textMuted, fontSize: 11.5),
              ),
              AppBadge(
                item.condition,
                color: _conditionColor(item.condition),
                fontSize: 9.5,
              ),
              const Spacer(),
              SoftChip(item.department),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            item.reason,
            style: const TextStyle(
              color: AppColors.textBody,
              fontSize: 12,
              fontStyle: FontStyle.italic,
              height: 1.4,
            ),
          ),
          if (item.awaitingMerge && item.rejectionReason.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.danger.withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.danger.withValues(alpha: 0.16)),
              ),
              child: Text(
                'Merge rejected: ${item.rejectionReason}',
                style: const TextStyle(
                  color: AppColors.danger,
                  fontSize: 11.5,
                  height: 1.4,
                ),
              ),
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              const Icon(Icons.calendar_today_outlined, size: 12, color: AppColors.textMuted),
              const SizedBox(width: 5),
              Text(
                formatDateTime(item.returnDate),
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
              ),
              const Spacer(),
              if (item.mergeRequestId.isNotEmpty)
                MonoText(item.mergeRequestId, color: AppColors.textMuted, fontSize: 10),
            ],
          ),
        ],
      ),
    );
  }
}
