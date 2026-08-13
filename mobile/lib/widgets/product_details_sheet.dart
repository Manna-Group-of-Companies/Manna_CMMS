import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/palette.dart';
import '../data/repository.dart';
import '../models/models.dart';
import 'common.dart';

/// "Product Specifications" modal, shared by every screen that shows a product.
Future<void> showProductDetails(BuildContext context, Product product) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ProductDetailsSheet(product: product),
  );
}

class _ProductDetailsSheet extends StatefulWidget {
  const _ProductDetailsSheet({required this.product});

  final Product product;

  @override
  State<_ProductDetailsSheet> createState() => _ProductDetailsSheetState();
}

class _ProductDetailsSheetState extends State<_ProductDetailsSheet> {
  late Product _product = widget.product;

  @override
  void initState() {
    super.initState();
    // Issue history populates only a handful of product fields; fetch the full
    // document so the specification grid is complete.
    if (_product.isPartial && _product.id.isNotEmpty) _loadFullProduct();
  }

  Future<void> _loadFullProduct() async {
    try {
      final full = await context.read<StockRepository>().product(_product.id);
      if (mounted) setState(() => _product = full);
    } catch (_) {
      // Keep the partial record — the sheet degrades to what we already have.
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _product;
    final unit = p.unit;

    return DraggableScrollableSheet(
      initialChildSize: 0.72,
      minChildSize: 0.4,
      maxChildSize: 0.94,
      expand: false,
      builder: (context, scrollController) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            const SheetGrabber(),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 12, 12),
              child: Row(
                children: [
                  const Icon(Icons.inventory_2_outlined, size: 20, color: AppColors.primaryDeep),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'Product Specifications',
                      style: TextStyle(
                        color: AppColors.textStrong,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 20),
                    color: AppColors.textSecondary,
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                controller: scrollController,
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ProductThumb(imageUrl: p.image, size: 84, radius: 14),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              p.name,
                              style: const TextStyle(
                                color: AppColors.textStrong,
                                fontSize: 19,
                                fontWeight: FontWeight.w700,
                                height: 1.2,
                              ),
                            ),
                            const SizedBox(height: 6),
                            MonoText('CODE: ${p.code}'),
                            const SizedBox(height: 8),
                            SoftChip(p.storeRoom),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    childAspectRatio: 2.6,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                    children: [
                      SpecTile(label: 'Category', value: p.category),
                      SpecTile(label: 'Brand', value: p.brand),
                      SpecTile(
                        label: 'Current Stock',
                        value: '${p.quantity} $unit',
                        valueColor: p.isOutOfStock
                            ? AppColors.danger
                            : p.isLowStock
                                ? AppColors.warning
                                : AppColors.textStrong,
                      ),
                      SpecTile(label: 'Supplier', value: p.supplier),
                      SpecTile(label: 'Min Stock Limit', value: '${p.minStock} $unit'),
                      SpecTile(label: 'Max Stock Limit', value: '${p.maxStock} $unit'),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceMuted,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Description',
                          style: TextStyle(color: AppColors.textMuted, fontSize: 11),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          p.description.isEmpty ? 'No description provided.' : p.description,
                          style: const TextStyle(
                            color: AppColors.textBody,
                            fontSize: 12.5,
                            height: 1.6,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The little drag handle shown at the top of every bottom sheet.
class SheetGrabber extends StatelessWidget {
  const SheetGrabber({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 10, bottom: 6),
      height: 4,
      width: 42,
      decoration: BoxDecoration(
        color: AppColors.borderStrong,
        borderRadius: BorderRadius.circular(999),
      ),
    );
  }
}
