import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../widgets/common.dart';
import '../../widgets/product_details_sheet.dart' show SheetGrabber;

/// Photos are stored inline on the product record as a base64 `data:` URI, so
/// keep them small enough for the API request (and the Mongo document).
const _maxPhotoBytes = 2 * 1024 * 1024;

/// Quick-pick images offered by the web client when drafting a product.
const _sampleImages = <({String name, String url})>[
  (name: 'Default Box', url: ''),
  (
    name: 'Mouse/Keyboard',
    url:
        'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3'
  ),
  (
    name: 'Monitor/Screen',
    url:
        'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3'
  ),
  (
    name: 'Office Chair',
    url:
        'https://images.unsplash.com/photo-1505797149-43b0069ec26b?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3'
  ),
  (
    name: 'Laptop/Computer',
    url:
        'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3'
  ),
];

/// ADD (when [product] is null) or EDIT product request form.
/// Resolves to `true` when a request was submitted.
Future<bool> showProductRequestForm(BuildContext context, {Product? product}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ProductRequestForm(product: product),
  );
  return result ?? false;
}

/// Stock In / Out / Return request. [kind] is `stockin`, `stockout` or `stockreturn`.
Future<bool> showStockRequestForm(
  BuildContext context, {
  required Product product,
  required String kind,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _StockRequestForm(product: product, kind: kind),
  );
  return result ?? false;
}

/// Direct issuance (decrements stock immediately, no approval).
Future<bool> showIssueProductForm(BuildContext context, {required Product product}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _IssueProductForm(product: product),
  );
  return result ?? false;
}

/// Hands issued stock back into the Restock section.
/// Resolves to `true` when the return was recorded.
Future<bool> showReturnStockForm(
  BuildContext context, {
  required IssueRecord issue,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ReturnStockForm(issue: issue),
  );
  return result ?? false;
}

// ---------------------------------------------------------------------------
// Shared sheet chrome
// ---------------------------------------------------------------------------

class _FormSheet extends StatelessWidget {
  const _FormSheet({
    required this.title,
    required this.children,
    required this.submitLabel,
    required this.onSubmit,
    this.titleIcon,
    this.titleIconColor = AppColors.primaryDeep,
    this.submitColor = AppColors.primary,
    this.submitting = false,
    this.canSubmit = true,
    this.initialSize = 0.85,
  });

  final String title;
  final List<Widget> children;
  final String submitLabel;
  final VoidCallback onSubmit;
  final IconData? titleIcon;
  final Color titleIconColor;
  final Color submitColor;
  final bool submitting;
  final bool canSubmit;
  final double initialSize;

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: initialSize,
      minChildSize: 0.45,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: Container(
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
                    if (titleIcon != null) ...[
                      Icon(titleIcon, size: 20, color: titleIconColor),
                      const SizedBox(width: 8),
                    ],
                    Expanded(
                      child: Text(
                        title,
                        style: const TextStyle(
                          color: AppColors.textStrong,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, size: 20),
                      color: AppColors.textSecondary,
                      onPressed: submitting ? null : () => Navigator.of(context).pop(false),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
                  children: children,
                ),
              ),
              Container(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                decoration: const BoxDecoration(
                  color: AppColors.surface,
                  border: Border(top: BorderSide(color: AppColors.border)),
                ),
                child: SafeArea(
                  top: false,
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed:
                              submitting ? null : () => Navigator.of(context).pop(false),
                          child: const Text('Cancel'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        flex: 2,
                        child: FilledButton(
                          onPressed: (submitting || !canSubmit) ? null : onSubmit,
                          style: FilledButton.styleFrom(backgroundColor: submitColor),
                          child: submitting
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2.2,
                                    color: Colors.white,
                                  ),
                                )
                              : Text(submitLabel),
                        ),
                      ),
                    ],
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

class _Field extends StatelessWidget {
  const _Field({
    required this.label,
    required this.child,
    this.required = false,
  });

  final String label;
  final Widget child;
  final bool required;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text.rich(
            TextSpan(
              text: label,
              children: required
                  ? const [TextSpan(text: ' *', style: TextStyle(color: AppColors.danger))]
                  : null,
            ),
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 7),
          child,
        ],
      ),
    );
  }
}

/// Compact product header shown at the top of the stock/issue forms.
class _ProductSummary extends StatelessWidget {
  const _ProductSummary({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
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
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text.rich(
                  TextSpan(
                    text: 'Current Stock: ',
                    children: [
                      TextSpan(
                        text: '${product.quantity} ${product.unit}',
                        style: const TextStyle(
                          color: AppColors.primaryDeep,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// ADD / EDIT product request
// ---------------------------------------------------------------------------

class _ProductRequestForm extends StatefulWidget {
  const _ProductRequestForm({this.product});

  final Product? product;

  @override
  State<_ProductRequestForm> createState() => _ProductRequestFormState();
}

class _ProductRequestFormState extends State<_ProductRequestForm> {
  final _formKey = GlobalKey<FormState>();

  late final bool _isEdit = widget.product != null;
  late final ProductDraft _draft = widget.product == null
      ? ProductDraft()
      : ProductDraft.fromProduct(widget.product!);

  late final _name = TextEditingController(text: _draft.name);
  late final _category = TextEditingController(text: _draft.category);
  late final _brand = TextEditingController(text: _draft.brand);
  late final _supplier = TextEditingController(text: _draft.supplier);
  late final _quantity = TextEditingController(text: '${_draft.quantity}');
  late final _unit = TextEditingController(text: _draft.unit);
  late final _minStock = TextEditingController(text: '${_draft.minStock}');
  late final _maxStock = TextEditingController(text: '${_draft.maxStock}');
  late final _description = TextEditingController(text: _draft.description);
  // A captured photo lives in [_photo], not in the URL field: a base64 data URI
  // is far too long to sit inside a text input.
  late final _image = TextEditingController(text: _isInlinePhoto ? '' : _draft.image);

  late String? _photo = _isInlinePhoto ? _draft.image : null;
  bool _submitting = false;

  bool get _isInlinePhoto => _draft.image.startsWith('data:');

  @override
  void dispose() {
    for (final controller in [
      _name,
      _category,
      _brand,
      _supplier,
      _quantity,
      _unit,
      _minStock,
      _maxStock,
      _description,
      _image,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;

    _draft
      ..name = _name.text.trim()
      ..category = _category.text.trim()
      ..brand = _brand.text.trim()
      ..supplier = _supplier.text.trim()
      ..quantity = int.tryParse(_quantity.text) ?? 0
      ..unit = _unit.text.trim()
      ..minStock = int.tryParse(_minStock.text) ?? 0
      ..maxStock = int.tryParse(_maxStock.text) ?? 0
      ..description = _description.text.trim()
      ..image = _photo ?? _image.text.trim();

    setState(() => _submitting = true);
    try {
      await context.read<StockRepository>().createProductRequest(
            requestType: _isEdit ? 'EDIT' : 'ADD',
            productId: widget.product?.id,
            details: _draft,
          );
      Toast.success(
        'Product ${_isEdit ? 'EDIT' : 'ADD'} request submitted successfully!',
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      Toast.error(error.message);
    } catch (_) {
      Toast.error('Failed to submit request');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// Takes a photo with the camera / picks one from the gallery and keeps it as
  /// an inline data URI so it travels with the request like a pasted URL would.
  Future<void> _pickPhoto(ImageSource source) async {
    FocusScope.of(context).unfocus();
    try {
      final picked = await ImagePicker().pickImage(
        source: source,
        maxWidth: 1280,
        maxHeight: 1280,
        imageQuality: 70,
      );
      if (picked == null) return;

      final bytes = await picked.readAsBytes();
      if (bytes.lengthInBytes > _maxPhotoBytes) {
        Toast.error('That image is too large (max 2 MB). Try another one.');
        return;
      }
      if (!mounted) return;
      setState(() {
        _photo = 'data:${_mimeOf(picked)};base64,${base64Encode(bytes)}';
        _image.clear();
      });
    } on PlatformException catch (error) {
      Toast.error(
        error.message ??
            'Could not open the ${source == ImageSource.camera ? 'camera' : 'gallery'}',
      );
    } catch (_) {
      Toast.error('Could not attach that image');
    }
  }

  String _mimeOf(XFile file) {
    final mimeType = file.mimeType;
    if (mimeType != null && mimeType.startsWith('image/')) return mimeType;
    return switch (file.name.toLowerCase().split('.').last) {
      'png' => 'image/png',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      _ => 'image/jpeg',
    };
  }

  String? _requiredValidator(String? value) =>
      (value ?? '').trim().isEmpty ? 'Required' : null;

  String? _numberValidator(String? value) {
    final parsed = int.tryParse((value ?? '').trim());
    if (parsed == null) return 'Enter a number';
    if (parsed < 0) return 'Cannot be negative';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: _FormSheet(
        title: _isEdit
            ? 'Request Edit: ${widget.product!.name}'
            : 'Request Add New Product',
        submitLabel: 'Submit Request',
        submitting: _submitting,
        onSubmit: _submit,
        children: [
          _Field(
            label: 'Product Name',
            required: true,
            child: TextFormField(
              controller: _name,
              validator: _requiredValidator,
              decoration: const InputDecoration(hintText: 'e.g. MX Master 3S'),
            ),
          ),
          _Field(
            label: 'Category',
            required: true,
            child: TextFormField(
              controller: _category,
              validator: _requiredValidator,
              decoration: const InputDecoration(hintText: 'e.g. Electronics, Furniture'),
            ),
          ),
          _Field(
            label: 'Brand',
            required: true,
            child: TextFormField(
              controller: _brand,
              validator: _requiredValidator,
              decoration: const InputDecoration(hintText: 'e.g. Logitech, Dell'),
            ),
          ),
          _Field(
            label: 'Supplier Name',
            required: true,
            child: TextFormField(
              controller: _supplier,
              validator: _requiredValidator,
              decoration: const InputDecoration(hintText: 'e.g. LogiTech Solutions Inc.'),
            ),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _Field(
                  label: 'Initial Quantity',
                  required: true,
                  child: TextFormField(
                    controller: _quantity,
                    // Quantity changes must go through a stock request.
                    enabled: !_isEdit,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    validator: _numberValidator,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _Field(
                  label: 'Unit of Measure',
                  required: true,
                  child: TextFormField(
                    controller: _unit,
                    validator: _requiredValidator,
                    decoration: const InputDecoration(hintText: 'Pcs, Box, Kg'),
                  ),
                ),
              ),
            ],
          ),
          if (_isEdit)
            const Padding(
              padding: EdgeInsets.only(bottom: 16),
              child: Text(
                'Quantity is locked on edit requests — use a Stock In / Out request '
                'to change it.',
                style: TextStyle(color: AppColors.textMuted, fontSize: 11, height: 1.4),
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _Field(
                  label: 'Minimum Stock',
                  required: true,
                  child: TextFormField(
                    controller: _minStock,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    validator: _numberValidator,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _Field(
                  label: 'Maximum Stock',
                  required: true,
                  child: TextFormField(
                    controller: _maxStock,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    validator: _numberValidator,
                  ),
                ),
              ),
            ],
          ),
          _Field(
            label: 'Store Room',
            required: true,
            child: DropdownShell(
              child: AppDropdown<String>(
                value: _draft.storeRoom,
                items: const ['Engineer Room', 'Consumables Room'],
                onChanged: (value) =>
                    setState(() => _draft.storeRoom = value ?? _draft.storeRoom),
              ),
            ),
          ),
          _Field(
            label: 'Product Image',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ValueListenableBuilder<TextEditingValue>(
                      valueListenable: _image,
                      builder: (context, value, _) => ProductThumb(
                        imageUrl: _photo ?? value.text.trim(),
                        size: 66,
                        radius: 12,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: _PhotoSourceButton(
                                  icon: Icons.photo_camera_outlined,
                                  label: 'Camera',
                                  onPressed: _submitting
                                      ? null
                                      : () => _pickPhoto(ImageSource.camera),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _PhotoSourceButton(
                                  icon: Icons.photo_library_outlined,
                                  label: 'Gallery',
                                  onPressed: _submitting
                                      ? null
                                      : () => _pickPhoto(ImageSource.gallery),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _photo == null
                                ? 'Take a photo of the stock or pick one from the gallery.'
                                : 'Photo attached.',
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 11,
                              height: 1.35,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                if (_photo != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed:
                          _submitting ? null : () => setState(() => _photo = null),
                      icon: const Icon(Icons.delete_outline, size: 16),
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.dangerDeep,
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        textStyle: const TextStyle(fontSize: 11.5),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      label: const Text('Remove photo'),
                    ),
                  )
                else ...[
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _image,
                    decoration: const InputDecoration(hintText: 'Or paste image URL here'),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final sample in _sampleImages)
                        OutlinedButton(
                          onPressed: () => setState(() => _image.text = sample.url),
                          style: OutlinedButton.styleFrom(
                            padding:
                                const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            backgroundColor: AppColors.surfaceMuted,
                            side: const BorderSide(color: AppColors.borderStrong),
                            textStyle: const TextStyle(fontSize: 10.5),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          child: Text(sample.name),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          _Field(
            label: 'Description',
            child: TextFormField(
              controller: _description,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'Components, warranty, catalog mapping...',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Camera / gallery button pair shown next to the image preview.
class _PhotoSourceButton extends StatelessWidget {
  const _PhotoSourceButton({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: 16),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        backgroundColor: AppColors.surfaceMuted,
        side: const BorderSide(color: AppColors.borderStrong),
        textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Stock In / Out / Return request
// ---------------------------------------------------------------------------

class _StockRequestForm extends StatefulWidget {
  const _StockRequestForm({required this.product, required this.kind});

  final Product product;
  final String kind;

  @override
  State<_StockRequestForm> createState() => _StockRequestFormState();
}

class _StockRequestFormState extends State<_StockRequestForm> {
  final _controller = TextEditingController(text: '1');
  bool _submitting = false;

  /// Only a Stock In lands somewhere, so only it offers a room.
  bool get _picksRoom => widget.kind == 'stockin';
  List<StockRoom> _rooms = const [];
  String? _roomId;

  String get _label => switch (widget.kind) {
        'stockin' => 'Stock In',
        'stockout' => 'Stock Out',
        _ => 'Stock Return',
      };

  int get _quantity => int.tryParse(_controller.text.trim()) ?? 0;

  bool get _exceedsStock =>
      widget.kind == 'stockout' && _quantity > widget.product.quantity;

  @override
  void initState() {
    super.initState();
    if (_picksRoom) _loadRooms();
  }

  Future<void> _loadRooms() async {
    try {
      final rooms = await context.read<StockRepository>().stockRooms();
      if (!mounted) return;
      setState(() {
        _rooms = rooms;
        // Default to the product's own room when it is one of the options.
        _roomId = rooms
                .where((room) => room.name == widget.product.storeRoom)
                .firstOrNull
                ?.id ??
            rooms.firstOrNull?.id;
      });
    } catch (error) {
      // A missing room list only costs the supervisor the preference; the
      // Admin still picks the room that is credited.
      debugPrint('Could not load stock rooms: $error');
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_quantity < 1) {
      Toast.error('Quantity must be at least 1');
      return;
    }

    setState(() => _submitting = true);
    try {
      final requestNumber = await context.read<StockRepository>().createStockRequest(
            kind: widget.kind,
            productId: widget.product.id,
            quantity: _quantity,
            stockRoomId: _picksRoom ? _roomId : null,
          );
      Toast.success(
        requestNumber.isEmpty
            ? '$_label request submitted successfully!'
            : 'Stock request $requestNumber submitted successfully.',
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      Toast.error(error.message);
    } catch (_) {
      Toast.error('Failed to submit request');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _FormSheet(
      title: 'Request $_label',
      submitLabel: 'Submit Request',
      submitting: _submitting,
      canSubmit: !_exceedsStock,
      initialSize: 0.55,
      onSubmit: _submit,
      children: [
        _ProductSummary(product: widget.product),
        const SizedBox(height: 18),
        _Field(
          label: 'Mutation Quantity (${widget.product.unit})',
          required: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              QuantityStepper(
                controller: _controller,
                max: widget.kind == 'stockout' ? widget.product.quantity : null,
                onChanged: () => setState(() {}),
              ),
              if (widget.kind == 'stockout') ...[
                const SizedBox(height: 7),
                Text(
                  'Max available: ${widget.product.quantity} ${widget.product.unit}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5),
                ),
              ],
            ],
          ),
        ),
        if (_exceedsStock)
          const Row(
            children: [
              Icon(Icons.error_outline, size: 14, color: AppColors.dangerDeep),
              SizedBox(width: 6),
              Text(
                'Quantity exceeds available stock!',
                style: TextStyle(
                  color: AppColors.dangerDeep,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        if (_picksRoom && _rooms.isNotEmpty)
          _Field(
            label: 'Preferred Stock Room',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                DropdownShell(
                  child: AppDropdown<String>(
                    value: _roomId ?? _rooms.first.id,
                    items: _rooms.map((room) => room.id).toList(),
                    labelBuilder: (id) =>
                        _rooms.firstWhere((room) => room.id == id).name,
                    onChanged: (value) => setState(() => _roomId = value),
                  ),
                ),
                const SizedBox(height: 7),
                const Text(
                  'The Admin confirms the room when accepting.',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 11.5),
                ),
              ],
            ),
          ),
        const SizedBox(height: 8),
        Text(
          'This request goes to the office Admin for approval; stock changes only '
          'once it is approved.',
          style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5, height: 1.5),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Direct issuance
// ---------------------------------------------------------------------------

class _IssueProductForm extends StatefulWidget {
  const _IssueProductForm({required this.product});

  final Product product;

  @override
  State<_IssueProductForm> createState() => _IssueProductFormState();
}

class _IssueProductFormState extends State<_IssueProductForm> {
  final _quantity = TextEditingController(text: '1');
  final _recipient = TextEditingController();
  final _purpose = TextEditingController();
  bool _submitting = false;

  int get _qty => int.tryParse(_quantity.text.trim()) ?? 0;
  bool get _exceedsStock => _qty > widget.product.quantity;

  @override
  void dispose() {
    _quantity.dispose();
    _recipient.dispose();
    _purpose.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_qty < 1) {
      Toast.error('Quantity must be at least 1');
      return;
    }
    if (_recipient.text.trim().isEmpty) {
      Toast.error('Recipient is required');
      return;
    }

    setState(() => _submitting = true);
    try {
      final message = await context.read<StockRepository>().issueProduct(
            productId: widget.product.id,
            quantity: _qty,
            recipient: _recipient.text.trim(),
            purpose: _purpose.text.trim(),
          );
      Toast.success(message);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      Toast.error(error.message);
    } catch (_) {
      Toast.error('Failed to issue product');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _FormSheet(
      title: 'Issue Product',
      titleIcon: Icons.send_outlined,
      titleIconColor: AppColors.warning,
      submitLabel: 'Issue Now',
      submitColor: AppColors.warningDeep,
      submitting: _submitting,
      canSubmit: !_exceedsStock && _qty >= 1,
      initialSize: 0.8,
      onSubmit: _submit,
      children: [
        _ProductSummary(product: widget.product),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.warningDeep.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.warningDeep.withValues(alpha: 0.18)),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.bolt, size: 16, color: AppColors.warning),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'This action immediately reduces the product quantity. '
                  'No admin approval required.',
                  style: TextStyle(color: AppColors.warning, fontSize: 11.5, height: 1.45),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        _Field(
          label: 'Quantity to Issue (${widget.product.unit})',
          required: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              QuantityStepper(
                controller: _quantity,
                max: widget.product.quantity,
                onChanged: () => setState(() {}),
              ),
              const SizedBox(height: 7),
              Text(
                'Max available: ${widget.product.quantity} ${widget.product.unit}',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5),
              ),
            ],
          ),
        ),
        if (_exceedsStock)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Row(
              children: [
                Icon(Icons.error_outline, size: 14, color: AppColors.dangerDeep),
                SizedBox(width: 6),
                Text(
                  'Exceeds available stock!',
                  style: TextStyle(
                    color: AppColors.dangerDeep,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        _Field(
          label: 'Recipient (Name / Department)',
          required: true,
          child: TextField(
            controller: _recipient,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              hintText: 'e.g. Marketing Dept, John Smith',
            ),
          ),
        ),
        _Field(
          label: 'Purpose / Notes',
          child: TextField(
            controller: _purpose,
            maxLines: 2,
            decoration: const InputDecoration(
              hintText: 'e.g. Quarterly office supply restock',
            ),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Return into the Restock section
// ---------------------------------------------------------------------------

const _returnConditions = ['Good', 'Damaged', 'Repairable', 'Expired'];

class _ReturnStockForm extends StatefulWidget {
  const _ReturnStockForm({required this.issue});

  final IssueRecord issue;

  @override
  State<_ReturnStockForm> createState() => _ReturnStockFormState();
}

class _ReturnStockFormState extends State<_ReturnStockForm> {
  late final TextEditingController _quantity =
      TextEditingController(text: '${widget.issue.outstanding}');
  late final TextEditingController _department =
      TextEditingController(text: widget.issue.recipient);
  final _reason = TextEditingController();
  String _condition = 'Good';
  bool _submitting = false;

  int get _qty => int.tryParse(_quantity.text.trim()) ?? 0;
  int get _outstanding => widget.issue.outstanding;
  bool get _exceedsOutstanding => _qty > _outstanding;

  @override
  void dispose() {
    _quantity.dispose();
    _department.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_qty < 1) {
      Toast.error('Return quantity must be at least 1');
      return;
    }
    if (_exceedsOutstanding) {
      Toast.error('Only $_outstanding still outstanding on this issue');
      return;
    }
    if (_reason.text.trim().isEmpty) {
      Toast.error('A return reason is required');
      return;
    }

    setState(() => _submitting = true);
    try {
      final message = await context.read<StockRepository>().returnIssuedStock(
            issueId: widget.issue.id,
            quantity: _qty,
            reason: _reason.text.trim(),
            condition: _condition,
            department: _department.text.trim(),
          );
      Toast.success(message);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      Toast.error(error.message);
    } catch (_) {
      Toast.error('Failed to return stock');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final product = widget.issue.product;
    final unit = product?.unit ?? 'unit(s)';

    return _FormSheet(
      title: 'Return to Red Stock',
      titleIcon: Icons.assignment_return_outlined,
      titleIconColor: AppColors.accent,
      submitLabel: 'Send to Red Stock',
      submitColor: AppColors.accentDeep,
      submitting: _submitting,
      canSubmit: !_exceedsOutstanding && _qty >= 1,
      initialSize: 0.85,
      onSubmit: _submit,
      children: [
        if (product != null) ...[
          _ProductSummary(product: product),
          const SizedBox(height: 14),
        ],
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.accent.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.accent.withValues(alpha: 0.18)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.inventory_outlined, size: 16, color: AppColors.accent),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'This goes straight into the Red Stock Room — no approval needed. '
                  'It reaches a store room only once an Admin approves the weekly merge.',
                  style: const TextStyle(
                    color: AppColors.accent,
                    fontSize: 11.5,
                    height: 1.45,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        _Field(
          label: 'Quantity to Return ($unit)',
          required: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              QuantityStepper(
                controller: _quantity,
                max: _outstanding,
                onChanged: () => setState(() {}),
              ),
              const SizedBox(height: 7),
              Text(
                'Still outstanding: $_outstanding $unit of ${widget.issue.quantity}',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5),
              ),
            ],
          ),
        ),
        if (_exceedsOutstanding)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Row(
              children: [
                Icon(Icons.error_outline, size: 14, color: AppColors.dangerDeep),
                SizedBox(width: 6),
                Text(
                  'Exceeds the outstanding quantity!',
                  style: TextStyle(
                    color: AppColors.dangerDeep,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        _Field(
          label: 'Condition',
          required: true,
          child: DropdownShell(
            child: AppDropdown<String>(
              value: _condition,
              items: _returnConditions,
              onChanged: (value) => setState(() => _condition = value ?? 'Good'),
            ),
          ),
        ),
        _Field(
          label: 'Returning Department',
          required: true,
          child: TextField(
            controller: _department,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(hintText: 'e.g. Maintenance'),
          ),
        ),
        _Field(
          label: 'Reason for Return',
          required: true,
          child: TextField(
            controller: _reason,
            maxLines: 3,
            decoration: const InputDecoration(
              hintText: 'e.g. Job completed, surplus material returned',
            ),
          ),
        ),
      ],
    );
  }
}
