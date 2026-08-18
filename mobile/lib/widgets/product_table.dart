import 'package:flutter/material.dart';

import '../core/palette.dart';
import '../models/models.dart';
import 'app_table.dart';
import 'product_details_sheet.dart';

/// The catalog as rows and columns (`pages/*/ProductList.jsx`): Product, Stock
/// and Room across the row, with category, the stock limits and the role's
/// actions unfolding underneath.
class ProductTable extends StatelessWidget {
  const ProductTable({
    super.key,
    required this.products,
    required this.actionsOf,
    this.bottomInset = 0,
  });

  final List<Product> products;

  /// The actions this role may perform on [product] — the same list the details
  /// sheet renders in its footer.
  final List<ProductAction> Function(BuildContext context, Product product) actionsOf;

  /// Room under the last row for the "Add Engineering Stock" button to float over.
  final double bottomInset;

  static Color _stockColor(Product product) => product.isOutOfStock
      ? AppColors.danger
      : product.isLowStock
          ? AppColors.warning
          : AppColors.success;

  @override
  Widget build(BuildContext context) {
    return AppTable<Product>(
      items: products,
      idOf: (product) => product.id,
      bottomInset: bottomInset,
      columns: const [
        AppTableColumn('Engineering Stock', flex: 6),
        AppTableColumn('Stock', width: 62, center: true),
        AppTableColumn('Room', flex: 3),
      ],
      cellsOf: (context, product) => [
        TableTitleCell(
          title: product.name,
          subtitle: product.code,
          imageUrl: product.image,
        ),
        TableNumberCell(
          value: '${product.quantity}',
          unit: product.unit,
          color: _stockColor(product),
          note: product.isOutOfStock
              ? 'Out'
              : product.isLowStock
                  ? 'Low'
                  : '',
        ),
        TableTextCell(product.storeRoom, color: AppColors.textBody),
      ],
      // A row is a shortcut to the product itself: the specification and every
      // action this role may perform live in the details sheet, so the row
      // opens it rather than unfolding a second copy of the same fields.
      onRowTap: (context, product) => showProductDetails(
        context,
        product,
        actions: actionsOf(context, product),
      ),
    );
  }
}
