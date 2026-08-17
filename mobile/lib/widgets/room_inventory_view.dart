import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/auto_refresh.dart';
import '../core/palette.dart';
import '../core/toast.dart';
import '../data/repository.dart';
import '../models/models.dart';
import 'common.dart';

/// Current stock grouped by room, shown as a tab of the Red Stock Room screen.
///
/// The quantities here are the per-room balances the backend holds, so a
/// product stocked in two rooms shows up under each with its own figure.
///
/// The Red Stock Room leads the list: a return lands there the moment it is
/// made, so the product shows up here without waiting on the weekly merge.
class RoomInventoryView extends StatefulWidget {
  const RoomInventoryView({super.key});

  @override
  State<RoomInventoryView> createState() => _RoomInventoryViewState();
}

class _RoomInventoryViewState extends State<RoomInventoryView>
    with WidgetsBindingObserver, AutoRefresh {
  List<RoomInventory> _rooms = const [];
  RoomInventory? _redStock;
  bool _loading = true;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load();
    // The Admin moves stock between rooms on their console.
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
  ///
  /// The two rooms are read independently: a backend that is missing one of
  /// the endpoints still shows the other rather than an empty tab.
  Future<void> _load({bool silent = false}) async {
    final repository = context.read<StockRepository>();
    final results = await Future.wait([
      _attempt(repository.inventoryByRoom(), 'stock rooms'),
      _attempt(repository.redStockRoom(), 'the Red Stock Room'),
    ]);

    final rooms = results[0] as List<RoomInventory>?;
    final redStock = results[1] as RoomInventory?;

    if (!mounted) return;
    setState(() {
      // Keep what is already on screen when a read fails.
      if (rooms != null) _rooms = rooms;
      if (redStock != null) _redStock = redStock;
      _loading = false;
    });

    if (!silent && rooms == null && redStock == null) {
      Toast.error('Failed to load stock rooms');
    }
  }

  /// Resolves to null instead of throwing, so one failed read does not take
  /// the other down with it.
  static Future<Object?> _attempt(Future<Object?> read, String label) async {
    try {
      return await read;
    } catch (error) {
      debugPrint('Error loading $label: $error');
      return null;
    }
  }

  /// Red Stock first, then the store rooms.
  List<RoomInventory> get _allRooms => [?_redStock, ..._rooms];

  /// Filters items within each room, dropping rooms left with nothing.
  List<RoomInventory> get _visible {
    final term = _search.trim().toLowerCase();
    if (term.isEmpty) return _allRooms;

    return _allRooms
        .map((room) {
          final items = room.items
              .where((item) =>
                  item.name.toLowerCase().contains(term) ||
                  item.code.toLowerCase().contains(term))
              .toList();
          return RoomInventory(
            id: room.id,
            name: room.name,
            itemCount: items.length,
            totalQuantity: items.fold(0, (sum, item) => sum + item.quantity),
            items: items,
          );
        })
        .where((room) => room.items.isNotEmpty)
        .toList();
  }

  int get _grandTotal => _allRooms.fold(0, (sum, room) => sum + room.totalQuantity);

  int get _inRedStock => _redStock?.totalQuantity ?? 0;

  @override
  Widget build(BuildContext context) {
    final rooms = _visible;

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
                      icon: Icons.warehouse_outlined,
                      iconColor: AppColors.primaryDeep,
                      title: '${_allRooms.length} '
                          '${_allRooms.length == 1 ? "Company" : "Companies"}',
                      trailing: AppBadge(
                        '$_grandTotal Pcs total',
                        color: AppColors.primaryDeep,
                        uppercase: false,
                        fontSize: 11,
                      ),
                    ),
                    if (_inRedStock > 0) ...[
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          const Icon(Icons.assignment_return_outlined,
                              size: 15, color: AppColors.accent),
                          const SizedBox(width: 7),
                          Expanded(
                            child: Text(
                              '$_inRedStock Pcs sitting in Red Stock, waiting on the '
                              'weekly merge',
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 11.5,
                                height: 1.35,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                onChanged: (value) => setState(() => _search = value),
                decoration: const InputDecoration(
                  hintText: 'Search this stock…',
                  prefixIcon: Icon(Icons.search, size: 19),
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
                  child: rooms.isEmpty
                      ? ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            EmptyState(
                              title: _search.isEmpty
                                  ? 'No stock recorded yet'
                                  : 'Nothing matches "$_search"',
                              message: _search.isEmpty
                                  ? 'Approved stock requests appear here under the room '
                                      'they were credited to, and returned stock under '
                                      'the Red Stock Room.'
                                  : 'Try a different product name or code.',
                              icon: Icons.warehouse_outlined,
                            ),
                          ],
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                          itemCount: rooms.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 12),
                          itemBuilder: (context, index) =>
                              _RoomSection(room: rooms[index]),
                        ),
                ),
        ),
      ],
    );
  }
}

class _RoomSection extends StatelessWidget {
  const _RoomSection({required this.room});

  final RoomInventory room;

  /// Red Stock is a holding room, not a store room, so it is marked out with
  /// the same accent the returns list uses.
  bool get _isRedStock => room.id == kRedStockRoomId;

  @override
  Widget build(BuildContext context) {
    final accent = _isRedStock ? AppColors.accent : AppColors.primaryDeep;

    return AppCard(
      padding: EdgeInsets.zero,
      borderColor: _isRedStock ? AppColors.accent.withValues(alpha: 0.30) : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.border)),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(7),
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Icon(
                    _isRedStock
                        ? Icons.assignment_return_outlined
                        : Icons.warehouse_outlined,
                    size: 16,
                    color: accent,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        room.name,
                        style: const TextStyle(
                          color: AppColors.textStrong,
                          fontSize: 14.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _isRedStock
                            ? '${room.itemCount} product(s) • returned stock'
                            : '${room.itemCount} product(s)',
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
                AppBadge(
                  '${room.totalQuantity} Pcs',
                  color: accent,
                  uppercase: false,
                  fontSize: 11.5,
                ),
              ],
            ),
          ),
          if (room.items.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 14),
              child: Center(
                child: Text(
                  _isRedStock
                      ? 'Nothing returned yet.'
                      : 'This room is empty.',
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                ),
              ),
            )
          else
            for (var i = 0; i < room.items.length; i++) ...[
              if (i > 0) const Divider(height: 1, indent: 14, endIndent: 14),
              _RoomItemRow(item: room.items[i]),
            ],
        ],
      ),
    );
  }
}

class _RoomItemRow extends StatelessWidget {
  const _RoomItemRow({required this.item});

  final RoomStockItem item;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      child: Row(
        children: [
          ProductThumb(imageUrl: item.image, size: 38),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 3),
                MonoText(item.code.isEmpty ? '—' : item.code, fontSize: 10),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${item.quantity} ${item.unit}',
                style: TextStyle(
                  color: item.isLowStock ? AppColors.warning : AppColors.textStrong,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (item.isLowStock) ...[
                const SizedBox(height: 3),
                const AppBadge('Low', color: AppColors.warning, fontSize: 9),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
