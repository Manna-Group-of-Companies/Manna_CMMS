import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/formatters.dart';
import '../core/palette.dart';
import '../core/toast.dart';
import '../data/repository.dart';
import '../models/models.dart';
import 'app_table.dart';
import 'common.dart';

/// Everything issued that will never come back — used up (Consumed) or thrown
/// away (Scrapped).
///
/// This is the only place a supervisor can see them. A fully settled issue
/// drops off the Issue History list by design, so without this view the stock
/// would simply vanish from the app the moment it was accounted for.
///
/// Read-only on purpose: a disposal is booked against an issue and, once
/// recorded, is a permanent part of the scrap metric. Correcting one is an
/// Admin job, not something to fix by tapping a row here.
class DisposalLogView extends StatefulWidget {
  const DisposalLogView({super.key});

  @override
  State<DisposalLogView> createState() => _DisposalLogViewState();
}

class _DisposalLogViewState extends State<DisposalLogView> {
  static const _allFilter = 'All';
  static const _consumedFilter = 'Consumed';
  static const _scrappedFilter = 'Scrapped';

  List<DisposalRecord> _items = const [];
  bool _loading = true;
  String _filter = _allFilter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  /// [silent] suppresses the error toast so a background poll does not nag.
  Future<void> _load({bool silent = false}) async {
    try {
      // Both types in one read; the filter below is local, so switching tabs
      // costs nothing and the totals stay consistent between them.
      final items = await context.read<StockRepository>().disposals();
      if (mounted) setState(() => _items = items);
    } catch (error) {
      debugPrint('Error loading the disposal log: $error');
      if (!silent) Toast.error('Failed to load consumed and scrapped items');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<DisposalRecord> get _visible => switch (_filter) {
    _consumedFilter => _items.where((item) => item.isConsumption).toList(),
    _scrappedFilter => _items.where((item) => item.isScrap).toList(),
    _ => _items,
  };

  /// The metric the whole log exists to produce, over everything loaded —
  /// deliberately not narrowed by the filter, so switching tabs does not make
  /// the headline number move.
  num get _totalScrapValue => _items
      .where((item) => item.isScrap)
      .fold<num>(0, (sum, item) => sum + item.value);

  int get _consumedCount => _items.where((item) => item.isConsumption).length;
  int get _scrappedCount => _items.where((item) => item.isScrap).length;

  @override
  Widget build(BuildContext context) {
    final visible = _visible;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
          child: AppCard(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                PanelHeader(
                  icon: Icons.delete_outline,
                  iconColor: AppColors.danger,
                  title: 'Consumed & Scrapped',
                  subtitle:
                      '$_consumedCount used up • $_scrappedCount written off',
                  trailing: AppBadge(
                    formatCurrency(_totalScrapValue),
                    color: AppColors.danger,
                    uppercase: false,
                    fontSize: 11,
                  ),
                ),
                const SizedBox(height: 14),
                FilterTabs(
                  options: const [_allFilter, _consumedFilter, _scrappedFilter],
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
                              title: switch (_filter) {
                                _consumedFilter =>
                                  'Nothing recorded as consumed',
                                _scrappedFilter => 'Nothing has been scrapped',
                                _ => 'Nothing consumed or scrapped yet',
                              },
                              message:
                                  'Open an outstanding issue on the Issues tab and '
                                  'action it as Consumed or Scrapped. Entries here '
                                  'are permanent and are kept for audit.',
                              icon: Icons.delete_outline,
                            ),
                          ],
                        )
                      : _buildTable(visible),
                ),
        ),
      ],
    );
  }

  Widget _buildTable(List<DisposalRecord> visible) {
    return AppTable<DisposalRecord>(
      items: visible,
      idOf: (item) => item.id,
      columns: const [
        AppTableColumn('Engineering Stock', flex: 6),
        AppTableColumn('Qty', width: 52, center: true),
        AppTableColumn('Type', width: 78, center: true),
      ],
      cellsOf: (context, item) => [
        TableTitleCell(title: item.productName, subtitle: item.productCode),
        TableNumberCell(
          value: '−${item.quantity}',
          unit: item.unit,
          color: item.isScrap ? AppColors.danger : AppColors.textSecondary,
        ),
        TableBadgeCell(
          item.isScrap ? 'Scrapped' : 'Used',
          color: item.isScrap ? AppColors.danger : AppColors.textSecondary,
        ),
      ],
      detailOf: (context, item) => TableDetail(
        lines: [
          TableDetailLine(
            label: 'Ref #',
            value: item.disposalNumber,
            mono: true,
          ),
          TableDetailLine(
            label: 'Against',
            value: item.reference.isEmpty
                ? '—'
                : '${item.reference} (from ${item.source})',
            mono: true,
          ),
          if (item.storeRoom.isNotEmpty)
            TableDetailLine(label: 'Store room', value: item.storeRoom),
          if (item.department.isNotEmpty)
            TableDetailLine(label: 'Issued to', value: item.department),
          // Only scrap carries a value worth showing: consumption is a normal
          // cost of doing the work, scrap is the loss being measured.
          if (item.isScrap) ...[
            TableDetailLine(
              label: 'Unit cost',
              value: item.unitCost > 0
                  ? formatCurrency(item.unitCost)
                  : 'Not recorded',
            ),
            TableDetailLine(
              label: 'Scrap value',
              value: item.unitCost > 0 ? formatCurrency(item.value) : '—',
              valueColor: AppColors.dangerDeep,
            ),
          ],
          TableDetailLine(
            label: item.isScrap ? 'Reason' : 'Note',
            value: item.reason,
            italic: true,
          ),
          TableDetailLine(label: 'Recorded by', value: item.disposedByName),
          TableDetailLine(
            label: 'Recorded on',
            value: formatDateTime(item.disposedAt),
          ),
        ],
      ),
    );
  }
}
