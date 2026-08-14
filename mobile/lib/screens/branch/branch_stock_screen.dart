import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/auto_refresh.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../widgets/app_shell.dart';
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
      if (!silent) Toast.error('Failed to load your stock room');
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

    return AppShell(
      title: stock == null ? 'Branch Stock' : '${stock.roomName} Stock',
      child: _loading && stock == null
          ? const LoadingView(message: 'Loading stock room...')
          : RefreshIndicator(
              onRefresh: _load,
              color: AppColors.primary,
              backgroundColor: AppColors.surface,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                children: [
                  if (stock == null)
                    const EmptyState(
                      title: 'Stock unavailable',
                      message: 'Pull down to try loading your room again.',
                      icon: Icons.cloud_off_outlined,
                    )
                  else ...[
                    HeroStatCard(
                      label: stock.roomName,
                      value: '${stock.totalQuantity}',
                      caption: '${stock.itemCount} items held in your room',
                      icon: Icons.warehouse_outlined,
                    ),
                    const SizedBox(height: 12),
                    GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      childAspectRatio: 1.75,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      children: [
                        MetricCard(
                          title: 'Categories',
                          value: stock.categoryCount,
                          icon: Icons.category_outlined,
                          accent: AppColors.info,
                        ),
                        MetricCard(
                          title: 'Low Stock',
                          value: stock.lowStockCount,
                          icon: Icons.warning_amber_outlined,
                          accent: stock.lowStockCount > 0
                              ? AppColors.warning
                              : AppColors.info,
                          highlighted: stock.lowStockCount > 0,
                        ),
                        MetricCard(
                          title: 'Out of Stock',
                          value: stock.outOfStockCount,
                          icon: Icons.remove_shopping_cart_outlined,
                          accent: stock.outOfStockCount > 0
                              ? AppColors.danger
                              : AppColors.info,
                        ),
                        MetricCard(
                          title: 'Items in Room',
                          value: stock.itemCount,
                          icon: Icons.inventory_2_outlined,
                          accent: AppColors.primaryDeep,
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    _RequestStatusStrip(stock: stock),
                    const SizedBox(height: 18),
                    _StockPanel(
                      items: items,
                      total: stock.items.length,
                      filter: _filter,
                      onFilter: (value) => setState(() => _filter = value),
                      onSearch: (value) => setState(() => _search = value),
                      onApply: _apply,
                    ),
                  ],
                ],
              ),
            ),
    );
  }
}

/// Where this branch's requests stand, so the stage is visible from the stock
/// screen as well as the requests screen.
class _RequestStatusStrip extends StatelessWidget {
  const _RequestStatusStrip({required this.stock});

  final BranchStock stock;

  @override
  Widget build(BuildContext context) {
    final entries = [
      (label: 'Pending Admin', value: stock.pendingAdmin, color: AppColors.warning),
      (label: 'Supervisor Pending', value: stock.pendingSupervisor, color: AppColors.accent),
      (label: 'Approved', value: stock.approved, color: AppColors.success),
      (label: 'Rejected', value: stock.rejected, color: AppColors.danger),
    ];

    return AppCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: PanelHeader(
                  icon: Icons.assignment_outlined,
                  iconColor: AppColors.primaryDeep,
                  title: 'My Request Status',
                ),
              ),
              TextButton(
                onPressed: () => context.go('/branch/requests'),
                style: TextButton.styleFrom(foregroundColor: AppColors.primaryDeep),
                child: const Text('View all'),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final entry in entries)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                  decoration: BoxDecoration(
                    color: entry.color.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: entry.color.withValues(alpha: 0.20)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${entry.value}',
                        style: TextStyle(
                          color: entry.color,
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        entry.label,
                        style: TextStyle(
                          color: entry.color,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StockPanel extends StatelessWidget {
  const _StockPanel({
    required this.items,
    required this.total,
    required this.filter,
    required this.onFilter,
    required this.onSearch,
    required this.onApply,
  });

  final List<RoomStockItem> items;
  final int total;
  final String filter;
  final ValueChanged<String> onFilter;
  final ValueChanged<String> onSearch;
  final Future<void> Function(RoomStockItem) onApply;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const PanelHeader(
            icon: Icons.inventory_2_outlined,
            iconColor: AppColors.primaryDeep,
            title: 'Stock on Hand',
          ),
          const SizedBox(height: 14),
          TextField(
            onChanged: onSearch,
            decoration: const InputDecoration(
              hintText: 'Search name, code or category',
              prefixIcon: Icon(Icons.search, size: 19),
              isDense: true,
            ),
          ),
          const SizedBox(height: 12),
          FilterTabs(
            options: const ['All', 'Low Stock', 'Out of Stock'],
            selected: filter,
            onChanged: onFilter,
          ),
          const SizedBox(height: 14),
          if (items.isEmpty)
            EmptyState(
              title: total == 0 ? 'No stock in this room yet' : 'No items match',
              message: total == 0
                  ? 'Items placed in your room will appear here.'
                  : 'Try a different search or filter.',
              icon: Icons.inventory_2_outlined,
              dashed: true,
            )
          else
            for (final item in items) ...[
              _StockRow(item: item, onApply: () => onApply(item)),
              if (item != items.last) const Divider(height: 18),
            ],
        ],
      ),
    );
  }
}

class _StockRow extends StatelessWidget {
  const _StockRow({required this.item, required this.onApply});

  final RoomStockItem item;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) {
    final (statusLabel, statusColor) = item.isOutOfStock
        ? ('Out of Stock', AppColors.danger)
        : item.isLowStock
            ? ('Low Stock', AppColors.warning)
            : ('In Stock', AppColors.success);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ProductThumb(imageUrl: item.image),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                item.name,
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
                  MonoText(item.code),
                  if (item.category.isNotEmpty) SoftChip(item.category),
                  AppBadge(statusLabel, color: statusColor, fontSize: 9),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                '${item.quantity} ${item.unit} in room · min ${item.minStock}',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        TextButton.icon(
          onPressed: item.isOutOfStock ? null : onApply,
          icon: const Icon(Icons.send_outlined, size: 15),
          label: const Text('Apply'),
          style: TextButton.styleFrom(
            foregroundColor: AppColors.primaryDeep,
            visualDensity: VisualDensity.compact,
          ),
        ),
      ],
    );
  }
}
