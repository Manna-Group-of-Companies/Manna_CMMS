import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/auto_refresh.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/app_table.dart';
import '../../widgets/common.dart';
import 'branch_request_form.dart';

/// `pages/branch/BranchDashboard.jsx` — the stock standing in the branch's own
/// room, and a way to apply for any of it.
class BranchStockScreen extends StatefulWidget {
  const BranchStockScreen({super.key});

  @override
  State<BranchStockScreen> createState() => _BranchStockScreenState();
}

class _BranchStockScreenState extends State<BranchStockScreen>
    with WidgetsBindingObserver, AutoRefresh {
  BranchStock? _stock;
  bool _loading = true;
  String _filter = 'All';
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load();
    // The Admin moves and corrects this stock elsewhere; polling keeps the
    // branch's copy of the numbers honest.
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
      final stock = await context.read<StockRepository>().branchStock();
      if (mounted) setState(() => _stock = stock);
    } catch (error) {
      debugPrint('Error fetching branch stock: $error');
      if (!silent) Toast.error('Failed to load your company');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<RoomStockItem> get _visible {
    final items = _stock?.items ?? const <RoomStockItem>[];
    final term = _search.trim().toLowerCase();

    return items.where((item) {
      if (_filter == 'Low Stock' && !item.isLowStock) return false;
      if (_filter == 'Out of Stock' && !item.isOutOfStock) return false;
      if (term.isEmpty) return true;
      return item.name.toLowerCase().contains(term) ||
          item.code.toLowerCase().contains(term) ||
          item.category.toLowerCase().contains(term);
    }).toList();
  }

  Future<void> _apply(RoomStockItem item) async {
    final submitted = await showBranchRequestForm(
      context,
      items: _stock?.items ?? const [],
      preselected: item,
    );
    if (submitted) await _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final stock = _stock;
    final items = _visible;

    // The room's stock is the whole page: the summary cards and the request
    // strip that used to sit above it pushed the list itself below the fold,
    // and the counts they showed are all readable from the rows. Request
    // progress has its own tab.
    return AppShell(
      title: stock == null ? 'Branch Stock' : '${stock.roomName} Stock',
      child: _loading && stock == null
          ? const LoadingView(message: 'Loading company...')
          : Column(
              children: [
                if (stock != null)
                  _StockFilters(
                    filter: _filter,
                    onFilter: (value) => setState(() => _filter = value),
                    onSearch: (value) => setState(() => _search = value),
                  ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _load,
                    color: AppColors.primary,
                    backgroundColor: AppColors.surface,
                    child: stock == null
                        ? ListView(
                            padding: const EdgeInsets.all(16),
                            children: const [
                              EmptyState(
                                title: 'Stock unavailable',
                                message: 'Pull down to try loading your company again.',
                                icon: Icons.cloud_off_outlined,
                              ),
                            ],
                          )
                        : items.isEmpty
                            ? ListView(
                                padding: const EdgeInsets.all(16),
                                children: [
                                  EmptyState(
                                    title: stock.items.isEmpty
                                        ? 'No stock in this company yet'
                                        : 'No items match',
                                    message: stock.items.isEmpty
                                        ? 'Items placed in your company will appear here.'
                                        : 'Try a different search or filter.',
                                    icon: Icons.inventory_2_outlined,
                                    dashed: true,
                                  ),
                                ],
                              )
                            : _BranchStockTable(items: items, onApply: _apply),
                  ),
                ),
              ],
            ),
    );
  }
}

/// Search and the stock filter, kept above the grid the way the catalog keeps
/// its own search bar above the product table.
class _StockFilters extends StatelessWidget {
  const _StockFilters({
    required this.filter,
    required this.onFilter,
    required this.onSearch,
  });

  final String filter;
  final ValueChanged<String> onFilter;
  final ValueChanged<String> onSearch;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
      child: Column(
        children: [
          TextField(
            onChanged: onSearch,
            style: const TextStyle(fontSize: 13, color: AppColors.textStrong),
            decoration: const InputDecoration(
              hintText: 'Search name, code or category',
              prefixIcon: Icon(Icons.search, size: 19),
              isDense: true,
            ),
          ),
          const SizedBox(height: 10),
          FilterTabs(
            options: const ['All', 'Low Stock', 'Out of Stock'],
            selected: filter,
            onChanged: onFilter,
          ),
        ],
      ),
    );
  }
}


/// The branch's room as rows and columns, matching `ProductTable`.
///
/// Room is not a column here the way it is in the catalog: a Branch account
/// only ever sees its own room, so the space goes to the category instead.
class _BranchStockTable extends StatelessWidget {
  const _BranchStockTable({required this.items, required this.onApply});

  final List<RoomStockItem> items;
  final Future<void> Function(RoomStockItem) onApply;

  static (String, Color) _status(RoomStockItem item) => item.isOutOfStock
      ? ('Out of Stock', AppColors.danger)
      : item.isLowStock
          ? ('Low Stock', AppColors.warning)
          : ('In Stock', AppColors.success);

  @override
  Widget build(BuildContext context) {
    return AppTable<RoomStockItem>(
      items: items,
      idOf: (item) => item.productId,
      columns: const [
        AppTableColumn('Item', flex: 6),
        AppTableColumn('Stock', width: 62, center: true),
        AppTableColumn('Category', flex: 3),
      ],
      cellsOf: (context, item) {
        final (_, color) = _status(item);
        return [
          TableTitleCell(title: item.name, subtitle: item.code, imageUrl: item.image),
          TableNumberCell(
            value: '${item.quantity}',
            unit: item.unit,
            color: color,
            note: item.isOutOfStock
                ? 'Out'
                : item.isLowStock
                    ? 'Low'
                    : '',
          ),
          TableTextCell(item.category, color: AppColors.textBody),
        ];
      },
      detailOf: (context, item) {
        final (label, color) = _status(item);
        return TableDetail(
          lines: [
            TableDetailLine(label: 'Code', value: item.code),
            TableDetailLine(label: 'Category', value: item.category),
            TableDetailLine(label: 'In company', value: '${item.quantity} ${item.unit}'),
            TableDetailLine(label: 'Minimum', value: '${item.minStock} ${item.unit}'),
            TableDetailLine(label: 'Status', value: label, valueColor: color),
          ],
          actions: [
            // Out-of-stock rows still unfold — the branch can read the figures
            // — but there is nothing there to apply for.
            if (!item.isOutOfStock)
              TableActionButton(
                label: 'Apply for Stock',
                icon: Icons.send_outlined,
                color: AppColors.primaryDeep,
                filled: true,
                onPressed: () => onApply(item),
              ),
          ],
        );
      },
    );
  }
}
