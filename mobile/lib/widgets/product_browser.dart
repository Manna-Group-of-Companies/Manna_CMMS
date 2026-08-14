import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/auto_refresh.dart';
import '../core/palette.dart';
import '../core/toast.dart';
import '../data/repository.dart';
import '../models/models.dart';
import 'common.dart';
import 'product_details_sheet.dart';

/// A single entry in a product card's overflow menu.
class ProductAction {
  const ProductAction({
    required this.label,
    required this.icon,
    required this.onSelected,
    this.color = AppColors.textBody,
  });

  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onSelected;
}

/// Search + filters + product list, shared by the admin and supervisor
/// catalog screens (`pages/*/ProductList.jsx`). Callers supply the per-row
/// actions their role is allowed to perform.
class ProductBrowser extends StatefulWidget {
  const ProductBrowser({super.key, this.actionsBuilder});

  /// Builds the overflow-menu actions for [product]. `reload` re-runs the
  /// current query, e.g. after a stock-changing operation.
  final List<ProductAction> Function(
    BuildContext context,
    Product product,
    Future<void> Function() reload,
  )? actionsBuilder;

  @override
  State<ProductBrowser> createState() => _ProductBrowserState();
}

class _ProductBrowserState extends State<ProductBrowser>
    with WidgetsBindingObserver, AutoRefresh {
  static const _anyCategory = 'All Categories';
  static const _anyRoom = 'All Rooms';
  static const _anyStock = 'All Stock Levels';

  final _searchController = TextEditingController();
  Timer? _debounce;

  List<Product> _products = const [];
  List<String> _categories = const [];
  bool _loading = true;

  String _search = '';
  String _category = _anyCategory;
  String _storeRoom = _anyRoom;
  String _stockStatus = _anyStock;

  @override
  void initState() {
    super.initState();
    _loadProducts();
    _loadCategories();
    // The Admin edits products and moves stock on their console, so the
    // catalog re-reads the API rather than showing only the first fetch.
    startAutoRefresh();
  }

  @override
  void dispose() {
    stopAutoRefresh();
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Future<void> refreshData() => _loadProducts(spinner: false, silent: true);

  /// [spinner] is false for pull-to-refresh, which draws its own indicator —
  /// swapping in the full-screen loader there would cancel the gesture.
  /// [silent] additionally suppresses the error toast, for background polls.
  Future<void> _loadProducts({bool spinner = true, bool silent = false}) async {
    if (spinner && mounted) setState(() => _loading = true);
    try {
      final products = await context.read<StockRepository>().products(
            search: _search,
            category: _category == _anyCategory ? null : _category,
            storeRoom: _storeRoom == _anyRoom ? null : _storeRoom,
            stockStatus: switch (_stockStatus) {
              'Low Stock Alert' => 'low',
              'Out of Stock' => 'out',
              _ => null,
            },
          );
      if (mounted) setState(() => _products = products);
    } catch (error) {
      debugPrint('Error loading products: $error');
      if (!silent) Toast.error('Could not load product list');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadCategories() async {
    try {
      final categories = await context.read<StockRepository>().categories();
      if (mounted) setState(() => _categories = categories);
    } catch (error) {
      debugPrint('Error loading categories: $error');
    }
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      setState(() => _search = value.trim());
      _loadProducts();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _buildFilterBar(),
        Expanded(
          child: _loading
              ? const LoadingView()
              : RefreshIndicator(
                  onRefresh: () => _loadProducts(spinner: false),
                  color: AppColors.primary,
                  backgroundColor: AppColors.surfaceMuted,
                  child: _products.isEmpty
                      ? ListView(
                          padding: const EdgeInsets.all(16),
                          children: const [
                            EmptyState(
                              title: 'No products found',
                              message: 'Try adjusting your search query or filters.',
                            ),
                          ],
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
                          itemCount: _products.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 10),
                          itemBuilder: (context, index) => _ProductCard(
                            product: _products[index],
                            actions: widget.actionsBuilder
                                ?.call(context, _products[index], _loadProducts),
                          ),
                        ),
                ),
        ),
      ],
    );
  }

  Widget _buildFilterBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              textInputAction: TextInputAction.search,
              style: const TextStyle(fontSize: 13.5, color: AppColors.textStrong),
              decoration: InputDecoration(
                hintText: 'Search code, name, supplier...',
                prefixIcon: const Icon(Icons.search, size: 18),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close, size: 16),
                        color: AppColors.textMuted,
                        onPressed: () {
                          _searchController.clear();
                          _onSearchChanged('');
                          setState(() {});
                        },
                      ),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: DropdownShell(
                    child: AppDropdown<String>(
                      value: _category,
                      items: [_anyCategory, ..._categories],
                      onChanged: (value) {
                        if (value == null) return;
                        setState(() => _category = value);
                        _loadProducts();
                      },
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownShell(
                    child: AppDropdown<String>(
                      value: _storeRoom,
                      items: const [_anyRoom, 'Engineer Room', 'Consumables Room'],
                      onChanged: (value) {
                        if (value == null) return;
                        setState(() => _storeRoom = value);
                        _loadProducts();
                      },
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            DropdownShell(
              child: AppDropdown<String>(
                value: _stockStatus,
                items: const [_anyStock, 'Low Stock Alert', 'Out of Stock'],
                onChanged: (value) {
                  if (value == null) return;
                  setState(() => _stockStatus = value);
                  _loadProducts();
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, this.actions});

  final Product product;
  final List<ProductAction>? actions;

  @override
  Widget build(BuildContext context) {
    final stockColor = product.isOutOfStock
        ? AppColors.danger
        : product.isLowStock
            ? AppColors.warning
            : AppColors.success;

    return AppCard(
      padding: const EdgeInsets.all(14),
      onTap: () => showProductDetails(context, product),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ProductThumb(imageUrl: product.image, size: 46),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textStrong,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        height: 1.25,
                      ),
                    ),
                    const SizedBox(height: 4),
                    MonoText(product.code, fontSize: 10.5),
                  ],
                ),
              ),
              if (actions != null && actions!.isNotEmpty)
                PopupMenuButton<ProductAction>(
                  icon: const Icon(Icons.more_vert, size: 20, color: AppColors.textSecondary),
                  color: AppColors.surfaceMuted,
                  position: PopupMenuPosition.under,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: const BorderSide(color: AppColors.border),
                  ),
                  onSelected: (action) => action.onSelected(),
                  itemBuilder: (context) => [
                    for (final action in actions!)
                      PopupMenuItem<ProductAction>(
                        value: action,
                        height: 44,
                        child: Row(
                          children: [
                            Icon(action.icon, size: 17, color: action.color),
                            const SizedBox(width: 10),
                            Text(
                              action.label,
                              style: TextStyle(color: action.color, fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: stockColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '${product.quantity} ${product.unit}',
                  style: TextStyle(
                    color: stockColor,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (product.isLowStock) ...[
                const SizedBox(width: 8),
                Row(
                  children: [
                    Icon(
                      Icons.error_outline,
                      size: 12,
                      color: AppColors.warningDeep.withValues(alpha: 0.8),
                    ),
                    const SizedBox(width: 3),
                    Text(
                      product.isOutOfStock ? 'Out of Stock' : 'Low Stock',
                      style: TextStyle(
                        color: AppColors.warningDeep.withValues(alpha: 0.8),
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ],
              const Spacer(),
              SoftChip(product.storeRoom),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Text(
                  '${product.category} • ${product.brand}',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.textBody, fontSize: 12),
                ),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  product.supplier,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
