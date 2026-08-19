import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/palette.dart';
import '../core/product_status.dart';
import '../data/repository.dart';
import '../models/models.dart';
import 'common.dart';

/// A single action offered in the details sheet's footer (Issue Engineering Stock,
/// Add Stock, ...). The catalog card itself carries no action menu — every
/// operation is reached by opening the product first.
class ProductAction {
  const ProductAction({
    required this.label,
    required this.icon,
    required this.onSelected,
    this.color = AppColors.textBody,
    this.filled = false,
  });

  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onSelected;

  /// Draws the button solid rather than tinted, and gives it a row of its own.
  /// Reserved for the action a screen leads with — issuing, on the supervisor's
  /// catalog.
  final bool filled;
}

/// "Engineering Stock Specifications" modal, shared by every screen that shows a product.
/// Callers pass the [actions] their role is allowed to perform; they render as
/// buttons in the footer.
Future<void> showProductDetails(
  BuildContext context,
  Product product, {
  List<ProductAction> actions = const [],
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ProductDetailsSheet(product: product, actions: actions),
  );
}

class _ProductDetailsSheet extends StatefulWidget {
  const _ProductDetailsSheet({required this.product, this.actions = const []});

  final Product product;
  final List<ProductAction> actions;

  @override
  State<_ProductDetailsSheet> createState() => _ProductDetailsSheetState();
}

class _ProductDetailsSheetState extends State<_ProductDetailsSheet> {
  late Product _product = widget.product;

  /// What this product has waiting in the Red Stock Room, once that read
  /// lands. Null covers both "nothing returned" and "not read yet", which show
  /// the same way: the line is simply absent.
  RoomStockItem? _redStock;

  /// Where the stock actually is, company by company (ST-35). The catalog
  /// carries one total; stock is kept per company, so the total on its own
  /// does not say which shelf to walk to.
  List<ProductRoomStock> _rooms = const [];

  @override
  void initState() {
    super.initState();
    // Issue history populates only a handful of product fields; fetch the full
    // document so the specification grid is complete.
    if (_product.isPartial && _product.id.isNotEmpty) _loadFullProduct();
    _loadRedStock();
    _loadRooms();
  }

  Future<void> _loadRooms() async {
    if (_product.id.isEmpty) return;

    try {
      final rooms = await context.read<StockRepository>().productRooms(_product.id);
      // Empty companies are dropped: a list of zeroes is noise on a lookup, and
      // a company holding none of this item is not somewhere to be sent.
      if (mounted) {
        setState(() =>
            _rooms = rooms.where((room) => room.quantity > 0).toList());
      }
    } catch (_) {
      // The home company chip and the total are still shown; a failed read
      // costs the breakdown, not the sheet.
    }
  }

  Future<void> _loadFullProduct() async {
    try {
      final full = await context.read<StockRepository>().product(_product.id);
      if (mounted) setState(() => _product = full);
    } catch (_) {
      // Keep the partial record — the sheet degrades to what we already have.
    }
  }

  /// Stock that has been handed back but not yet merged into a company sits in
  /// neither place the grid above reports: it is out of the room it was issued
  /// from and not yet back in stock. Saying so here is what keeps somebody from
  /// re-ordering an item the store already has in hand.
  Future<void> _loadRedStock() async {
    if (_product.id.isEmpty) return;

    try {
      final held =
          await context.read<StockRepository>().redStockForProduct(_product.id);
      if (mounted) setState(() => _redStock = held);
    } catch (_) {
      // A Branch account cannot read the Red Stock Room at all, and a failed
      // read is not worth a toast on a sheet opened to look something up — the
      // line stays off and the rest of the sheet is unaffected.
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
                      'Engineering Stock Specifications',
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
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: [
                                SoftChip(p.storeRoom),
                                if (p.status.isNotEmpty)
                                  SoftChip(p.status, color: statusColor(p.status)),
                                // The two intake flags. A null nameCompliant
                                // means "never checked", which is not a
                                // finding and stays silent.
                                if (p.nameCompliant == false)
                                  SoftChip('Name not SOI1/SOP1', color: AppColors.warning),
                                if (p.sap.isPending)
                                  SoftChip('Pending SAP', color: AppColors.accent),
                                if (p.sap.isCreated && p.sap.code.isNotEmpty)
                                  SoftChip('SAP ${p.sap.code}', color: AppColors.success),
                              ],
                            ),
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
                    childAspectRatio: 2.35,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                    children: [
                      SpecTile(
                        label: 'Category',
                        value: p.category,
                        caption: p.subCategory,
                      ),
                      SpecTile(
                        label: 'Condition',
                        value: p.status.isEmpty ? '—' : p.status,
                        valueColor: p.status.isEmpty ? null : statusColor(p.status),
                      ),
                      SpecTile(label: 'Brand', value: p.brand.isEmpty ? '—' : p.brand),
                      SpecTile(
                        label: 'Rack Number',
                        value: p.rackNumber.isEmpty ? '—' : p.rackNumber,
                      ),
                      SpecTile(
                        label: 'Current Stock',
                        value: '${p.quantity} $unit',
                        valueColor: p.isOutOfStock
                            ? AppColors.danger
                            : p.isLowStock
                                ? AppColors.warning
                                : AppColors.textStrong,
                      ),
                      SpecTile(label: 'Min Stock Limit', value: '${p.minStock} $unit'),
                    ],
                  ),
                  // Where those units actually are (ST-35). Stock is kept per
                  // company, so the total above is only a sum — this is the
                  // part somebody walks to a shelf with. Shown once there is
                  // more than one company holding it; a single company is
                  // already the chip beside the name.
                  if (_rooms.length > 1) ...[
                    const SizedBox(height: 12),
                    _CompanyBreakdown(rooms: _rooms, unit: unit, rack: p.rackNumber),
                  ],
                  // Only when there is something there. An item with nothing
                  // returned says nothing, rather than carrying a "0 Pcs" line
                  // on every product in the catalog.
                  if (_redStock case final held? when held.quantity > 0) ...[
                    const SizedBox(height: 12),
                    _RedStockLine(held: held, fallbackUnit: unit),
                  ],
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
            if (widget.actions.isNotEmpty) _buildActionFooter(),
          ],
        ),
      ),
    );
  }

  Widget _buildActionFooter() {
    final tinted = widget.actions.where((a) => !a.filled).toList();
    final filled = widget.actions.where((a) => a.filled).toList();

    // Close the sheet first so the action's own form is not stacked on top.
    VoidCallback tap(ProductAction action) => () {
          Navigator.of(context).pop();
          action.onSelected();
        };

    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: AppColors.surfaceMuted,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (tinted.isNotEmpty)
                Row(
                  children: [
                    for (final action in tinted) ...[
                      Expanded(child: _ActionButton(action: action, onTap: tap(action))),
                      if (action != tinted.last) const SizedBox(width: 8),
                    ],
                  ],
                ),
              for (final action in filled) ...[
                if (tinted.isNotEmpty) const SizedBox(height: 8),
                _ActionButton(action: action, onTap: tap(action)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// How much of this product is held in the Red Stock Room.
///
/// Marked out in the same accent the Red Stock Room screen uses, so the two
/// read as the same place. It is stock the store holds but cannot issue yet —
/// it counts towards neither the current stock above nor any company's shelf
/// until the merge puts it back.
/// Which company holds how much of this item, and where on the floor (ST-35).
///
/// Stock is kept separately per company, so an item can read "40 Pcs" while no
/// single company has more than fifteen. Somebody sent to fetch twenty needs to
/// know that before they walk.
class _CompanyBreakdown extends StatelessWidget {
  const _CompanyBreakdown({
    required this.rooms,
    required this.unit,
    required this.rack,
  });

  final List<ProductRoomStock> rooms;
  final String unit;

  /// The rack the item sits on. One number on the product, so it is shown
  /// against the whole breakdown rather than repeated per company.
  final String rack;

  @override
  Widget build(BuildContext context) {
    return Container(
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
          Row(
            children: [
              const Icon(Icons.warehouse_outlined, size: 16, color: AppColors.textMuted),
              const SizedBox(width: 9),
              const Expanded(
                child: Text(
                  'Held by company',
                  style: TextStyle(
                    color: AppColors.textBody,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (rack.isNotEmpty)
                Text(
                  'Rack $rack',
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5),
                ),
            ],
          ),
          const SizedBox(height: 8),
          for (final room in rooms)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      room.stockRoom,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textBody, fontSize: 12.5),
                    ),
                  ),
                  Text(
                    '${room.quantity} $unit',
                    style: const TextStyle(
                      color: AppColors.textStrong,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _RedStockLine extends StatelessWidget {
  const _RedStockLine({required this.held, required this.fallbackUnit});

  final RoomStockItem held;

  /// The product's own unit, used when the returned batch did not record one.
  final String fallbackUnit;

  @override
  Widget build(BuildContext context) {
    final unit = held.unit.isEmpty ? fallbackUnit : held.unit;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.accent.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.accent.withValues(alpha: 0.30)),
      ),
      child: Row(
        children: [
          const Icon(Icons.assignment_return_outlined,
              size: 16, color: AppColors.accent),
          const SizedBox(width: 9),
          const Expanded(
            child: Text(
              'In Red Stock',
              style: TextStyle(
                color: AppColors.textBody,
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Text(
            '${held.quantity} $unit',
            style: const TextStyle(
              color: AppColors.accent,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.action, required this.onTap});

  final ProductAction action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final filled = action.filled;
    final foreground = filled ? Colors.white : action.color;

    return Material(
      color: filled ? action.color : action.color.withValues(alpha: 0.10),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: EdgeInsets.symmetric(vertical: filled ? 13 : 11),
          decoration: filled
              ? null
              : BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: action.color.withValues(alpha: 0.35)),
                ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(action.icon, size: filled ? 18 : 16, color: foreground),
              const SizedBox(width: 7),
              Flexible(
                child: Text(
                  action.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: foreground,
                    fontSize: filled ? 14 : 12.5,
                    fontWeight: filled ? FontWeight.w700 : FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
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
