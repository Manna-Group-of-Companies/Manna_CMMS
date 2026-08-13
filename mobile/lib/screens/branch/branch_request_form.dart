import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../widgets/common.dart';
import '../../widgets/product_details_sheet.dart' show SheetGrabber;

/// Raises a request for one product held in the branch's own room.
///
/// [items] are the room's stock rows, so the picker can only offer what the
/// branch actually holds — the same rule the API enforces.
///
/// Returns true when a request was submitted.
Future<bool> showBranchRequestForm(
  BuildContext context, {
  required List<RoomStockItem> items,
  RoomStockItem? preselected,
}) async {
  final submitted = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _BranchRequestForm(items: items, preselected: preselected),
  );
  return submitted ?? false;
}

class _BranchRequestForm extends StatefulWidget {
  const _BranchRequestForm({required this.items, this.preselected});

  final List<RoomStockItem> items;
  final RoomStockItem? preselected;

  @override
  State<_BranchRequestForm> createState() => _BranchRequestFormState();
}

/// Placeholder id for "nothing picked yet" — [AppDropdown] takes a non-null
/// value, so the empty choice has to be a real entry.
const _kNoProduct = '';

class _BranchRequestFormState extends State<_BranchRequestForm> {
  late List<RoomStockItem> _inStock;
  String _selectedId = _kNoProduct;
  final _purpose = TextEditingController();
  final _quantityController = TextEditingController(text: '1');
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _inStock = widget.items.where((item) => item.quantity > 0).toList();

    final chosen = widget.preselected;
    if (chosen != null && _inStock.any((item) => item.productId == chosen.productId)) {
      _selectedId = chosen.productId;
    } else if (_inStock.length == 1) {
      _selectedId = _inStock.first.productId;
    }
  }

  @override
  void dispose() {
    _purpose.dispose();
    _quantityController.dispose();
    super.dispose();
  }

  RoomStockItem? get _selected {
    for (final item in _inStock) {
      if (item.productId == _selectedId) return item;
    }
    return null;
  }

  int get _quantity => int.tryParse(_quantityController.text.trim()) ?? 0;

  /// The dropdown carries product ids; this is what the row reads as.
  String _labelForProduct(String id) {
    if (id == _kNoProduct) return 'Select a product from your room';
    for (final item in _inStock) {
      if (item.productId == id) {
        return '${item.name} — ${item.quantity} ${item.unit}';
      }
    }
    return 'Unknown product';
  }

  Future<void> _submit() async {
    final product = _selected;
    if (product == null) {
      setState(() => _error = 'Choose a product to request');
      return;
    }
    if (_quantity < 1 || _quantity > product.quantity) {
      setState(() => _error = 'Only ${product.quantity} ${product.unit} available');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final number = await context.read<StockRepository>().createBranchRequest(
            productId: product.productId,
            quantity: _quantity,
            purpose: _purpose.text.trim(),
          );
      Toast.success(
        number.isEmpty
            ? 'Request sent for Admin approval'
            : 'Request $number sent for Admin approval',
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
      Toast.error(error.message);
    } catch (error) {
      debugPrint('Error creating branch request: $error');
      const message = 'Could not submit the request';
      if (mounted) setState(() => _error = message);
      Toast.error(message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final product = _selected;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SheetGrabber(),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Apply for Product',
                        style: TextStyle(
                          color: AppColors.textStrong,
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Goes to the Admin first, then to the Supervisor for '
                        'final approval.',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 12,
                          height: 1.45,
                        ),
                      ),
                      const SizedBox(height: 18),

                      if (_error != null) ...[
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(11),
                          decoration: BoxDecoration(
                            color: AppColors.danger.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: AppColors.danger.withValues(alpha: 0.24),
                            ),
                          ),
                          child: Text(
                            _error!,
                            style: const TextStyle(
                              color: AppColors.danger,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                      ],

                      const _FieldLabel('Product'),
                      const SizedBox(height: 6),
                      if (_inStock.isEmpty)
                        const Text(
                          'Your room holds no stock to request right now.',
                          style: TextStyle(color: AppColors.warning, fontSize: 12),
                        )
                      else
                        AppDropdown<String>(
                          value: _selectedId,
                          items: [_kNoProduct, ..._inStock.map((i) => i.productId)],
                          labelBuilder: _labelForProduct,
                          onChanged: (value) => setState(() {
                            _selectedId = value ?? _kNoProduct;
                            _quantityController.text = '1';
                            _error = null;
                          }),
                        ),

                      if (product != null) ...[
                        const SizedBox(height: 14),
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceMuted,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Row(
                            children: [
                              ProductThumb(imageUrl: product.image, size: 40),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      product.name,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: AppColors.textStrong,
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    const SizedBox(height: 3),
                                    Text(
                                      '${product.quantity} ${product.unit} in room · '
                                      'min ${product.minStock}',
                                      style: const TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 11.5,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                        _FieldLabel('Quantity (max ${product.quantity})'),
                        const SizedBox(height: 8),
                        QuantityStepper(
                          controller: _quantityController,
                          max: product.quantity,
                          onChanged: () => setState(() => _error = null),
                        ),
                      ],

                      const SizedBox(height: 16),
                      const _FieldLabel('Purpose (optional)'),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _purpose,
                        maxLines: 3,
                        decoration: const InputDecoration(
                          hintText: 'What the items are needed for',
                        ),
                      ),
                      const SizedBox(height: 22),

                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed:
                                  _saving ? null : () => Navigator.of(context).pop(false),
                              child: const Text('Cancel'),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            flex: 2,
                            child: FilledButton.icon(
                              onPressed: _saving || _inStock.isEmpty ? null : _submit,
                              icon: _saving
                                  ? const SizedBox(
                                      height: 15,
                                      width: 15,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: AppColors.white,
                                      ),
                                    )
                                  : const Icon(Icons.send_outlined, size: 17),
                              label: const Text('Submit Request'),
                            ),
                          ),
                        ],
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
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
        text.toUpperCase(),
        style: const TextStyle(
          color: AppColors.textSecondary,
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.7,
        ),
      );
}
