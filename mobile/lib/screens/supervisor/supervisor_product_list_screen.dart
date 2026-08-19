import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/palette.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/product_browser.dart';
import 'product_forms.dart';

/// `pages/supervisor/ProductList.jsx` — browse the catalog, edit and issue what
/// is on the shelf, and raise the two things the Admin still decides: a brand
/// new item, and stock coming in.
class SupervisorProductListScreen extends StatefulWidget {
  const SupervisorProductListScreen({super.key});

  @override
  State<SupervisorProductListScreen> createState() =>
      _SupervisorProductListScreenState();
}

class _SupervisorProductListScreenState extends State<SupervisorProductListScreen> {
  /// Bumped after an "Add product" request so the catalog reloads.
  int _reloadToken = 0;

  @override
  Widget build(BuildContext context) {
    return AppShell(
      title: 'Browse Engineering Stock Catalog',
      actions: [
        // The SAP hand-off queue belongs to intake, so it sits beside the
        // catalog rather than taking a slot in the bottom bar.
        IconButton(
          onPressed: () => context.push('/supervisor/sap-handoff'),
          icon: const Icon(Icons.swap_horiz, size: 22),
          tooltip: 'SAP hand-off',
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add, size: 20),
        label: const Text(
          'Add Engineering Stock',
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
        onPressed: () async {
          final submitted = await showProductForm(context);
          if (submitted && mounted) setState(() => _reloadToken++);
        },
      ),
      child: ProductBrowser(
        key: ValueKey(_reloadToken),
        // Rendered as buttons in the details sheet — tapping a catalog card is
        // the only way to reach them.
        actionsBuilder: (context, product, reload) => [
          ProductAction(
            label: 'Edit Stock',
            icon: Icons.edit_outlined,
            color: AppColors.primaryDeep,
            onSelected: () async {
              // An edit is saved on the product itself rather than queued for
              // the Admin, so the list has to re-read to show it.
              final saved = await showProductForm(context, product: product);
              if (saved) await reload();
            },
          ),
          ProductAction(
            label: 'Add Stock',
            icon: Icons.arrow_upward,
            color: AppColors.success,
            onSelected: () async {
              // Adding credits a room immediately, so the list has to re-read
              // to show the new total.
              final added = await showAddStockForm(context, product: product);
              if (added) await reload();
            },
          ),
          ProductAction(
            filled: true,
            label: 'Issue Engineering Stock',
            icon: Icons.send_outlined,
            color: AppColors.warning,
            onSelected: () async {
              // Issuing decrements stock immediately, so refresh the list.
              final issued = await showIssueProductForm(context, product: product);
              if (issued) await reload();
            },
          ),
        ],
      ),
    );
  }
}
