import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/palette.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/product_browser.dart';
import 'product_forms.dart';

/// `pages/supervisor/ProductList.jsx` — browse the catalog and raise requests.
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
      title: 'Browse Products Catalog',
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
          'Request Product',
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
        onPressed: () async {
          final submitted = await showProductRequestForm(context);
          if (submitted && mounted) setState(() => _reloadToken++);
        },
      ),
      child: ProductBrowser(
        key: ValueKey(_reloadToken),
        // Rendered as buttons in the details sheet — tapping a catalog card is
        // the only way to reach them.
        actionsBuilder: (context, product, reload) => [
          ProductAction(
            label: 'Request Edit',
            icon: Icons.edit_outlined,
            color: AppColors.primaryDeep,
            onSelected: () => showProductRequestForm(context, product: product),
          ),
          ProductAction(
            label: 'Request Stock',
            icon: Icons.arrow_upward,
            color: AppColors.success,
            onSelected: () =>
                showStockRequestForm(context, product: product, kind: 'stockin'),
          ),
          ProductAction(
            filled: true,
            label: 'Issue Product',
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
