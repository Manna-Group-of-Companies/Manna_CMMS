import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/auto_refresh.dart';
import '../core/palette.dart';
import '../core/toast.dart';
import '../data/repository.dart';
import '../models/models.dart';
import 'common.dart';
import 'product_details_sheet.dart' show ProductAction, SheetGrabber;
import 'product_table.dart';

export 'product_details_sheet.dart' show ProductAction;

/// Search + filters + product list, shared by the admin and supervisor
/// catalog screens (`pages/*/ProductList.jsx`). Callers supply the actions
/// their role is allowed to perform; rows themselves carry no menu, so the
/// actions surface as buttons once the details sheet is open.
class ProductBrowser extends StatefulWidget {
  const ProductBrowser({super.key, this.actionsBuilder});

  /// Builds the details-sheet actions for [product]. `reload` re-runs the
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
  static const _anySubCategory = 'All Sub-Categories';
  static const _anyRoom = 'All Rooms';
  static const _anyStock = 'All Stock Levels';

  final _searchController = TextEditingController();
  Timer? _debounce;

  List<Product> _products = const [];
  List<String> _categories = const [];
  List<String> _subCategories = const [];
  bool _loading = true;

  String _search = '';
  String _category = _anyCategory;
  String _subCategory = _anySubCategory;
  String _storeRoom = _anyRoom;
  String _stockStatus = _anyStock;

  @override
  void initState() {
    super.initState();
    _loadProducts();
    _loadCategories();
    _loadSubCategories(_anyCategory);
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
            subCategory: _subCategory == _anySubCategory ? null : _subCategory,
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

  /// The sub-categories belonging to [category], or all of them when no
  /// category is chosen. Returns the list as well as storing it, so the filter
  /// sheet can repopulate its own dropdown the moment the category changes.
  Future<List<String>> _loadSubCategories(String category) async {
    try {
      final subCategories = await context.read<StockRepository>().subCategories(
            category: category == _anyCategory ? null : category,
          );
      if (mounted) setState(() => _subCategories = subCategories);
      return subCategories;
    } catch (error) {
      debugPrint('Error loading sub-categories: $error');
      return const [];
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
                      : ProductTable(
                          products: _products,
                          // Clears the "Add Products" button floating over
                          // the bottom of the list.
                          bottomInset: 88,
                          actionsOf: (context, product) =>
                              widget.actionsBuilder
                                  ?.call(context, product, _loadProducts) ??
                              const [],
                        ),
                ),
        ),
      ],
    );
  }

  /// How many of the filters are set to something other than "all" — shown on
  /// the filter button so a narrowed list is never a surprise.
  int get _activeFilters => [
        _category != _anyCategory,
        _subCategory != _anySubCategory,
        _storeRoom != _anyRoom,
        _stockStatus != _anyStock,
      ].where((applied) => applied).length;

  /// Search stays on screen and the dropdowns live in a sheet, so the list gets
  /// the room the filter panel used to take.
  Widget _buildFilterBar() {
    final chips = <_ActiveFilter>[
      if (_category != _anyCategory)
        _ActiveFilter(_category, () {
          // The sub-category belonged to that category; it goes with it.
          _applyFilters(category: _anyCategory, subCategory: _anySubCategory);
          _loadSubCategories(_anyCategory);
        }),
      if (_subCategory != _anySubCategory)
        _ActiveFilter(_subCategory, () => _applyFilters(subCategory: _anySubCategory)),
      if (_storeRoom != _anyRoom)
        _ActiveFilter(_storeRoom, () => _applyFilters(storeRoom: _anyRoom)),
      if (_stockStatus != _anyStock)
        _ActiveFilter(_stockStatus, () => _applyFilters(stockStatus: _anyStock)),
    ];

    return Padding(
      padding: EdgeInsets.fromLTRB(16, 10, 16, chips.isEmpty ? 6 : 2),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _searchController,
                  onChanged: _onSearchChanged,
                  textInputAction: TextInputAction.search,
                  style: const TextStyle(fontSize: 13, color: AppColors.textStrong),
                  decoration: InputDecoration(
                    hintText: 'Search code, name, category...',
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                    prefixIcon: const Icon(Icons.search, size: 18),
                    prefixIconConstraints: const BoxConstraints(minWidth: 38),
                    suffixIcon: _searchController.text.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close, size: 16),
                            color: AppColors.textMuted,
                            visualDensity: VisualDensity.compact,
                            onPressed: () {
                              _searchController.clear();
                              _onSearchChanged('');
                              setState(() {});
                            },
                          ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              _FilterButton(count: _activeFilters, onTap: _openFilterSheet),
            ],
          ),
          if (chips.isNotEmpty)
            Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final chip in chips)
                      _FilterChip(label: chip.label, onClear: chip.onClear),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  /// The one place a filter change is committed and the list re-queried.
  void _applyFilters({
    String? category,
    String? subCategory,
    String? storeRoom,
    String? stockStatus,
  }) {
    setState(() {
      _category = category ?? _category;
      _subCategory = subCategory ?? _subCategory;
      _storeRoom = storeRoom ?? _storeRoom;
      _stockStatus = stockStatus ?? _stockStatus;
    });
    _loadProducts();
  }

  Future<void> _openFilterSheet() async {
    // Edited on a copy, so backing out of the sheet leaves the list alone.
    var category = _category;
    var subCategory = _subCategory;
    var storeRoom = _storeRoom;
    var stockStatus = _stockStatus;
    // The options shown for the sub-category, reloaded whenever the category
    // above it changes.
    var subCategoryOptions = _subCategories;

    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) => Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(sheetContext).viewInsets.bottom,
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SheetGrabber(),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 4, 8, 0),
                  child: Row(
                    children: [
                      const Expanded(
                        child: PanelHeader(
                          icon: Icons.tune,
                          iconColor: AppColors.primaryDeep,
                          title: 'Filters',
                        ),
                      ),
                      TextButton(
                        onPressed: () {
                          setSheetState(() {
                            category = _anyCategory;
                            subCategory = _anySubCategory;
                            storeRoom = _anyRoom;
                            stockStatus = _anyStock;
                          });
                          _loadSubCategories(_anyCategory).then((options) {
                            if (sheetContext.mounted) {
                              setSheetState(() => subCategoryOptions = options);
                            }
                          });
                        },
                        child: const Text(
                          'Clear all',
                          style: TextStyle(
                            fontSize: 12.5,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 6, 20, 20),
                  child: Column(
                    children: [
                      _SheetField(
                        label: 'Category',
                        value: category,
                        items: [_anyCategory, ..._categories],
                        onChanged: (value) {
                          // A sub-category only means something inside its own
                          // category, so it is dropped and the list below is
                          // refetched for the new one.
                          setSheetState(() {
                            category = value;
                            subCategory = _anySubCategory;
                            subCategoryOptions = const [];
                          });
                          _loadSubCategories(value).then((options) {
                            if (sheetContext.mounted) {
                              setSheetState(() => subCategoryOptions = options);
                            }
                          });
                        },
                      ),
                      const SizedBox(height: 12),
                      _SheetField(
                        label: 'Sub-category',
                        value: subCategory,
                        items: [_anySubCategory, ...subCategoryOptions],
                        onChanged: (value) => setSheetState(() => subCategory = value),
                      ),
                      const SizedBox(height: 12),
                      _SheetField(
                        label: 'Store room',
                        value: storeRoom,
                        items: const [_anyRoom, 'Manna Rubber Park', 'Consumables Room'],
                        onChanged: (value) => setSheetState(() => storeRoom = value),
                      ),
                      const SizedBox(height: 12),
                      _SheetField(
                        label: 'Stock level',
                        value: stockStatus,
                        items: const [_anyStock, 'Low Stock Alert', 'Out of Stock'],
                        onChanged: (value) => setSheetState(() => stockStatus = value),
                      ),
                      const SizedBox(height: 18),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: () => Navigator.of(sheetContext).pop(true),
                          child: const Text('Show products'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    if (applied == true) {
      _applyFilters(
        category: category,
        subCategory: subCategory,
        storeRoom: storeRoom,
        stockStatus: stockStatus,
      );
    }
  }
}

/// A filter currently narrowing the list, and how to drop it.
class _ActiveFilter {
  const _ActiveFilter(this.label, this.onClear);

  final String label;
  final VoidCallback onClear;
}

/// Opens the filter sheet, carrying a count of the filters already applied.
class _FilterButton extends StatelessWidget {
  const _FilterButton({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final active = count > 0;

    return Material(
      color: active ? AppColors.primary : AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Ink(
          height: 42,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: active ? AppColors.primary : AppColors.border),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.tune,
                size: 17,
                color: active ? Colors.white : AppColors.textSecondary,
              ),
              const SizedBox(width: 6),
              Text(
                active ? '$count' : 'Filters',
                style: TextStyle(
                  color: active ? Colors.white : AppColors.textSecondary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// An applied filter, tapped to remove it.
class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.label, required this.onClear});

  final String label;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.primary.withValues(alpha: 0.10),
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onClear,
        borderRadius: BorderRadius.circular(999),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, 5, 7, 5),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: AppColors.primaryDeep,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.close, size: 13, color: AppColors.primaryDeep),
            ],
          ),
        ),
      ),
    );
  }
}

/// A labelled dropdown inside the filter sheet.
class _SheetField extends StatelessWidget {
  const _SheetField({
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final String label;
  final String value;
  final List<String> items;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 11.5,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 6),
        DropdownShell(
          child: AppDropdown<String>(
            value: value,
            items: items,
            onChanged: (selected) {
              if (selected != null) onChanged(selected);
            },
          ),
        ),
      ],
    );
  }
}
