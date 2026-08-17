import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../core/product_status.dart';
import '../../core/toast.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../widgets/common.dart';
import '../../widgets/item_name_builder.dart';
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

/// The product form: an ADD request when [product] is null, and a direct edit
/// of [product] when one is given.
///
/// Adding an item is the one catalog change the Admin still approves. An edit is
/// saved on the product itself, so it is live as soon as the sheet closes.
/// Resolves to `true` when something was submitted or saved.
Future<bool> showProductForm(BuildContext context, {Product? product}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ProductForm(product: product),
  );
  return result ?? false;
}

/// Stock In request — the one stock change that waits for the Admin.
Future<bool> showStockInRequestForm(
  BuildContext context, {
  required Product product,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _StockInRequestForm(product: product),
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

/// Books issued stock as Consumed (used up) or Scrapped (written off) — the
/// two outcomes besides returning it.
///
/// Neither puts stock back on a shelf: it left the store room at issue time,
/// so this only closes the quantity out against the issue. Resolves to `true`
/// when the disposal was recorded.
Future<bool> showDisposalForm(
  BuildContext context, {
  required IssueRecord issue,
  required String type,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _DisposalForm(issue: issue, type: type),
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

/// Sentinel item that swaps the dropdown for a text box.
const _addNewTaxonomy = '__add_new__';

/// Sentinel for "nothing picked yet". A dropdown's value has to be one of its
/// items, so the placeholder needs a value of its own.
const _unsetTaxonomy = '';

/// Category / sub-category picker over the classifications already in use.
///
/// A free text box is why a catalog ends up holding "Bearing", "Bearings" and
/// "BEARING" as three separate categories. A closed dropdown would be worse —
/// the store genuinely does meet a class of item it has never stocked. So this
/// is a dropdown with exactly one escape hatch, which makes reusing an existing
/// classification the easy path and inventing one a deliberate act.
///
/// [options] are owned by the parent: the sub-category list depends on the
/// category chosen above it, so the reload belongs to whoever holds both.
class _TaxonomyPicker extends StatefulWidget {
  const _TaxonomyPicker({
    required this.value,
    required this.options,
    required this.onChanged,
    this.placeholder = 'Select…',
    this.newLabel = '＋ Add a new one…',
    this.hintText = '',
    this.enabled = true,
    this.loading = false,
  });

  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;
  final String placeholder;
  final String newLabel;

  /// Shown inside the text box once "add a new one" is chosen.
  final String hintText;
  final bool enabled;

  /// The options are still on their way. Shown rather than hidden, so the field
  /// does not look empty when it is merely unloaded.
  final bool loading;

  @override
  State<_TaxonomyPicker> createState() => _TaxonomyPickerState();
}

class _TaxonomyPickerState extends State<_TaxonomyPicker> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.value);

  late bool _typing = _isFreeText;

  /// A value the option list does not contain can only have been typed in.
  /// Guarded on the list being loaded — before that, *everything* looks unknown.
  bool get _isFreeText =>
      widget.value.isNotEmpty &&
      widget.options.isNotEmpty &&
      !widget.options.contains(widget.value);

  @override
  void didUpdateWidget(covariant _TaxonomyPicker oldWidget) {
    super.didUpdateWidget(oldWidget);

    // The list arrived after the widget mounted (the usual case on an edit) and
    // the saved value turns out not to be in it.
    if (!_typing && _isFreeText) {
      _controller.text = widget.value;
      setState(() => _typing = true);
      return;
    }

    // The *parent* cleared the field — a sub-category dropped because the
    // category above it changed. Fall back to the list, which is now a
    // different list.
    //
    // Told apart from the user emptying the text box by the inner controller
    // rather than by the old value: every keystroke writes straight through, so
    // those two stay in step, and only an outside change can leave the
    // controller holding text the parent no longer has. Comparing against
    // `oldWidget.value` instead would treat backspacing the last character of a
    // half-typed name as a reset, clearing the box and snapping it back to a
    // dropdown mid-word.
    if (_typing && widget.value.isEmpty && _controller.text.isNotEmpty) {
      _controller.clear();
      setState(() => _typing = false);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  String _labelFor(String item) => switch (item) {
        _unsetTaxonomy => widget.loading ? 'Loading…' : widget.placeholder,
        _addNewTaxonomy => widget.newLabel,
        _ => item,
      };

  @override
  Widget build(BuildContext context) {
    if (_typing) {
      return Row(
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              enabled: widget.enabled,
              textCapitalization: TextCapitalization.words,
              autofocus: true,
              onChanged: widget.onChanged,
              decoration: InputDecoration(
                hintText:
                    widget.hintText.isEmpty ? widget.placeholder : widget.hintText,
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            onPressed: widget.enabled
                ? () {
                    _controller.clear();
                    widget.onChanged('');
                    setState(() => _typing = false);
                  }
                : null,
            icon: const Icon(Icons.list, size: 20),
            color: AppColors.textSecondary,
            tooltip: 'Pick from the list instead',
            visualDensity: VisualDensity.compact,
          ),
        ],
      );
    }

    // Deduped because a dropdown asserts on repeated values, and the option
    // lists come straight off the API.
    final items = <String>{_unsetTaxonomy, ...widget.options, _addNewTaxonomy}.toList();

    return DropdownShell(
      child: AppDropdown<String>(
        value: widget.options.contains(widget.value) ? widget.value : _unsetTaxonomy,
        items: items,
        labelBuilder: _labelFor,
        onChanged: (picked) {
          if (!widget.enabled) return;

          if (picked == _addNewTaxonomy) {
            // Cleared, so the box opens empty rather than holding the value the
            // user has just decided is wrong.
            _controller.clear();
            widget.onChanged('');
            setState(() => _typing = true);
            return;
          }
          widget.onChanged(picked ?? '');
        },
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
// ADD request / direct edit
// ---------------------------------------------------------------------------

class _ProductForm extends StatefulWidget {
  const _ProductForm({this.product});

  final Product? product;

  @override
  State<_ProductForm> createState() => _ProductFormState();
}

class _ProductFormState extends State<_ProductForm> {
  final _formKey = GlobalKey<FormState>();

  late final bool _isEdit = widget.product != null;
  late final ProductDraft _draft = widget.product == null
      ? ProductDraft()
      : ProductDraft.fromProduct(widget.product!);

  late final _name = TextEditingController(text: _draft.name);
  // Category and sub-category have no controller of their own: TaxonomyPicker
  // is a dropdown that keeps its own text box for the "add a new one" case, so
  // the draft is the single source of truth for both.
  late final _rackNumber = TextEditingController(text: _draft.rackNumber);
  late final _quantity = TextEditingController(text: '${_draft.quantity}');
  late final _unit = TextEditingController(text: _draft.unit);
  late final _minStock = TextEditingController(text: '${_draft.minStock}');
  late final _description = TextEditingController(text: _draft.description);
  // A captured photo lives in [_photo], not in the URL field: a base64 data URI
  // is far too long to sit inside a text input.
  late final _image = TextEditingController(text: _isInlinePhoto ? '' : _draft.image);

  late String? _photo = _isInlinePhoto ? _draft.image : null;
  bool _submitting = false;

  bool get _isInlinePhoto => _draft.image.startsWith('data:');

  // ---------------------------------------------------- intake checks (ST-09→14)

  /// Open by default, on an edit as much as on a new item.
  ///
  /// This used to be gated on the product already carrying `naming`, which hid
  /// the builder for every item entered before SOI1/SOP1 existed — precisely
  /// the set that needs it, since bringing a legacy name up to standard is the
  /// main reason to open the builder while editing.
  bool _showBuilder = true;

  /// Debounced checks against the name as it is typed. Both run on the same
  /// timer so a keystroke costs one round of requests, not two.
  Timer? _nameTimer;
  int _nameTicket = 0;
  NameCheck? _nameCheck;
  List<DuplicateMatch> _duplicates = const [];

  /// What the API refused, and the confirmation that answers it.
  ///
  /// Neither check is absolute: 422 says the name breaks SOI1/SOP1 and 409 says
  /// something similar already exists, and re-sending with the matching flag
  /// goes ahead deliberately. Holding the refusal here is what lets the sheet
  /// explain itself instead of just failing.
  List<NamingIssue>? _refusedName;
  List<DuplicateMatch>? _refusedDuplicates;
  String _refusedDuplicateMessage = '';
  bool _acknowledgeNaming = false;
  bool _allowDuplicate = false;

  bool get _awaitingConfirmation =>
      (_refusedName != null && !_acknowledgeNaming) ||
      (_refusedDuplicates != null && !_allowDuplicate);

  // ------------------------------------------------- category / sub-category

  /// Categories and sub-categories already in the catalog, offered as choices.
  ///
  /// The classifications already in use, offered by [TaxonomyPicker].
  ///
  /// Reusing one is the easy path — that is what keeps "Bearing", "Bearings"
  /// and "BEARING" from becoming three categories — while the picker's "add a
  /// new one" escape hatch still covers a class of item the store has never
  /// stocked before.
  List<String> _categoryOptions = const [];
  List<String> _subCategoryOptions = const [];

  /// Shown as "Loading…" in the picker, so an unloaded list does not read as an
  /// empty one.
  bool _loadingCategories = true;
  bool _loadingSubCategories = false;

  @override
  void initState() {
    super.initState();
    // A listener rather than onChanged: the builder's "Use this name" writes
    // straight to the controller, and that has to be checked too.
    _name.addListener(_onNameChanged);
    if (_name.text.trim().isNotEmpty) _scheduleNameChecks();
    _loadCategories();
    // On an edit the category is already known, so its sub-categories can be
    // fetched straight away rather than waiting for the field to change.
    if (_draft.category.isNotEmpty) {
      _loadingSubCategories = true;
      _loadSubCategories(_draft.category);
    }
  }

  Future<void> _loadCategories() async {
    try {
      final options = await context.read<StockRepository>().categories();
      if (mounted) setState(() => _categoryOptions = options);
    } catch (error) {
      // Without its options the picker still offers "add a new one", so the
      // form stays usable — not worth interrupting it for.
      debugPrint('Could not load categories: $error');
    } finally {
      if (mounted) setState(() => _loadingCategories = false);
    }
  }

  Future<void> _loadSubCategories(String category) async {
    try {
      final options =
          await context.read<StockRepository>().subCategories(category: category);
      // A late reply for a category the user has since changed away from must
      // not repopulate the list underneath them.
      if (mounted && _draft.category == category) {
        setState(() => _subCategoryOptions = options);
      }
    } catch (error) {
      debugPrint('Could not load sub-categories: $error');
    } finally {
      if (mounted && _draft.category == category) {
        setState(() => _loadingSubCategories = false);
      }
    }
  }

  /// True once the name differs from the saved one — typed over by hand, or
  /// adopted from the builder. A rename is the only case where the convention is
  /// enforced on an edit, so this also gates the compliance hint.
  bool get _renamed => _isEdit && _name.text.trim() != widget.product!.name;

  /// A sub-category belongs to one category, so changing the category reloads
  /// the list and drops a selection that no longer belongs to it.
  void _onCategoryChanged(String category) {
    final picked = category.trim();
    setState(() {
      _draft.category = picked;
      _draft.subCategory = '';
      _subCategoryOptions = const [];
      _loadingSubCategories = picked.isNotEmpty;
    });
    if (picked.isNotEmpty) _loadSubCategories(picked);
  }

  void _onNameChanged() {
    // A different name invalidates confirmations given about the previous one.
    if (_refusedName != null || _refusedDuplicates != null) {
      setState(() {
        _refusedName = null;
        _refusedDuplicates = null;
        _acknowledgeNaming = false;
        _allowDuplicate = false;
      });
    }
    _scheduleNameChecks();
  }

  void _scheduleNameChecks() {
    _nameTimer?.cancel();

    final name = _name.text.trim();
    // Below a few characters a name is too vague to check usefully, and an
    // untouched form should not open covered in warnings.
    if (name.length < 3) {
      if (_nameCheck != null || _duplicates.isNotEmpty) {
        setState(() {
          _nameCheck = null;
          _duplicates = const [];
        });
      }
      return;
    }

    final ticket = ++_nameTicket;
    _nameTimer = Timer(const Duration(milliseconds: 450), () async {
      final repository = context.read<StockRepository>();
      try {
        final check = await repository.checkItemName(name: name);

        // Reopening a product must not accuse it of duplicating itself, so the
        // check only runs once the name has actually changed.
        final matches = _isEdit && name == widget.product!.name
            ? const <DuplicateMatch>[]
            : await repository.findDuplicates(
                name: name,
                category: _draft.category,
                excludeId: widget.product?.id,
              );

        if (!mounted || ticket != _nameTicket) return;
        setState(() {
          _nameCheck = check;
          _duplicates = matches;
        });
      } catch (_) {
        // A failed check must not block the sheet — both run again on submit,
        // where they can actually be acted on.
        if (!mounted || ticket != _nameTicket) return;
        setState(() {
          _nameCheck = null;
          _duplicates = const [];
        });
      }
    });
  }

  /// The standard conditions, plus whatever this product already carries.
  ///
  /// The catalog holds a handful of one-off phrasings ("BreakDown on High
  /// loads", "Working and not verified") that predate the list, and some rows
  /// carry no condition at all. Editing either must not quietly rewrite it —
  /// and a dropdown whose value is absent from its items asserts — so the
  /// existing value is always offered alongside the standard ones. The empty
  /// one shows as "Not recorded".
  late final List<String> _statusOptions = [
    if (!productStatuses.contains(_draft.status)) _draft.status,
    ...productStatuses,
  ];

  static String _statusLabel(String status) => status.isEmpty ? 'Not recorded' : status;

  @override
  void dispose() {
    _nameTimer?.cancel();
    for (final controller in [
      _name,
      _rackNumber,
      _quantity,
      _unit,
      _minStock,
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

    // Category is a dropdown rather than a form field, so `validate()` cannot
    // speak for it — it is checked here instead.
    if (_draft.category.isEmpty) {
      Toast.error('Pick a category');
      return;
    }

    // Category and sub-category are written straight to the draft as they are
    // picked, so they are already current here.
    _draft
      ..name = _name.text.trim()
      ..rackNumber = _rackNumber.text.trim()
      ..quantity = int.tryParse(_quantity.text) ?? 0
      ..unit = _unit.text.trim()
      ..minStock = int.tryParse(_minStock.text) ?? 0
      ..description = _description.text.trim()
      ..image = _photo ?? _image.text.trim();

    setState(() => _submitting = true);
    try {
      final repository = context.read<StockRepository>();

      // An edit is saved straight onto the product; only a new item is queued
      // for the Admin. Either way the same two intake checks run server-side,
      // and are answered from the same two confirmations below.
      if (_isEdit) {
        await repository.updateProduct(
          productId: widget.product!.id,
          details: _draft,
          acknowledgeNaming: _acknowledgeNaming,
          allowDuplicate: _allowDuplicate,
        );
        Toast.success('"${_draft.name}" updated');
      } else {
        await repository.createProductRequest(
          details: _draft,
          acknowledgeNaming: _acknowledgeNaming,
          allowDuplicate: _allowDuplicate,
        );
        Toast.success('Product ADD request submitted successfully!');
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      // 422 and 409 are the two intake checks asking for confirmation (ST-10,
      // ST-14), not failures. Show what was found and let the supervisor decide.
      if (error.statusCode == 422 && error.code == 'NAME_NOT_COMPLIANT' && mounted) {
        setState(() {
          _refusedName = (error.body?['issues'] as List? ?? [])
              .whereType<Map<String, dynamic>>()
              .map(NamingIssue.fromJson)
              .toList();
        });
        Toast.error('Check the product name before saving');
      } else if (error.statusCode == 409 && error.code == 'POSSIBLE_DUPLICATE' && mounted) {
        setState(() {
          _refusedDuplicates = (error.body?['matches'] as List? ?? [])
              .whereType<Map<String, dynamic>>()
              .map(DuplicateMatch.fromJson)
              .toList();
          _refusedDuplicateMessage = error.message;
        });
        Toast.error(error.message);
      } else {
        Toast.error(error.message);
      }
    } catch (_) {
      Toast.error(_isEdit ? 'Failed to save the product' : 'Failed to submit request');
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
            ? 'Edit: ${widget.product!.name}'
            : 'Request Add New Product',
        submitLabel: _isEdit ? 'Save Changes' : 'Submit Request',
        submitting: _submitting,
        canSubmit: !_awaitingConfirmation,
        onSubmit: _submit,
        children: [
          // The naming convention comes first: the name it produces is what
          // every other field on this form hangs off.
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: _submitting
                  ? null
                  : () => setState(() => _showBuilder = !_showBuilder),
              icon: Icon(
                _showBuilder ? Icons.expand_less : Icons.auto_fix_high_outlined,
                size: 17,
              ),
              label: Text(
                '${_showBuilder ? 'Hide' : 'Show'} standard name builder (SOI1/SOP1)',
              ),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primaryDeep,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ),
          if (_showBuilder) ...[
            const SizedBox(height: 12),
            ItemNameBuilderCard(
              naming: _draft.naming,
              enabled: !_submitting,
              onApply: (name) => _name.text = name,
            ),
          ],
          const SizedBox(height: 18),
          _Field(
            label: 'Product Name',
            required: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  controller: _name,
                  validator: _requiredValidator,
                  decoration: const InputDecoration(
                    hintText: 'e.g. 25MM Bearing Deep Groove',
                  ),
                ),
                if (_isEdit && _renamed) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Renamed from "${widget.product!.name}" — saving applies it.',
                    style: const TextStyle(
                      color: AppColors.primaryDeep,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      height: 1.4,
                    ),
                  ),
                ],
                // ST-10 — the verdict on the name as it currently stands. Held
                // back on an edit that has not renamed anything: the server does
                // not hold an unchanged legacy name to the rules, so flagging it
                // would be a telling-off for something this form will not touch.
                if (_nameCheck != null && (!_isEdit || _renamed)) ...[
                  const SizedBox(height: 8),
                  NameComplianceHint(check: _nameCheck!),
                ],
              ],
            ),
          ),
          // ST-14 — what the catalog already holds that looks like this.
          if (_refusedDuplicates == null && _duplicates.isNotEmpty) ...[
            DuplicateMatchesCard(matches: _duplicates),
            const SizedBox(height: 16),
          ],
          _Field(
            label: 'Category',
            required: true,
            child: _TaxonomyPicker(
              value: _draft.category,
              options: _categoryOptions,
              loading: _loadingCategories,
              enabled: !_submitting,
              placeholder: 'Select a category…',
              newLabel: '＋ Add a new category…',
              hintText: 'e.g. Bearings',
              onChanged: _onCategoryChanged,
            ),
          ),
          // Narrowed to the category above — the catalog carries well over a
          // hundred sub-categories, and an unscoped list is unusable.
          _Field(
            label: 'Sub-category',
            child: _TaxonomyPicker(
              value: _draft.subCategory,
              options: _subCategoryOptions,
              loading: _loadingSubCategories,
              // Nothing to narrow by until a category is chosen.
              enabled: !_submitting && _draft.category.isNotEmpty,
              placeholder: _draft.category.isEmpty
                  ? 'Pick a category first'
                  : 'Select a sub-category…',
              newLabel: '＋ Add a new sub-category…',
              hintText: 'e.g. Ring Spanners',
              onChanged: (value) =>
                  setState(() => _draft.subCategory = value.trim()),
            ),
          ),
          _Field(
            label: 'Condition',
            required: true,
            child: DropdownShell(
              child: AppDropdown<String>(
                value: _draft.status,
                items: _statusOptions,
                labelBuilder: _statusLabel,
                onChanged: (value) =>
                    setState(() => _draft.status = value ?? _draft.status),
              ),
            ),
          ),
          _Field(
            label: 'Rack Number',
            child: TextFormField(
              controller: _rackNumber,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(hintText: 'e.g. A-1'),
            ),
          ),
          // Asked for once, when the item is first taken in. An edit does not
          // offer them: quantity and store room move real stock, and unit and
          // minimum stock are identity and purchasing figures that should not
          // drift from a sheet somebody opened to fix a shelf label.
          if (!_isEdit) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _Field(
                    label: 'Initial Quantity',
                    required: true,
                    child: TextFormField(
                      controller: _quantity,
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
            _Field(
              label: 'Minimum Stock',
              required: true,
              child: TextFormField(
                controller: _minStock,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                validator: _numberValidator,
              ),
            ),
            _Field(
              label: 'Store Room',
              required: true,
              child: DropdownShell(
                child: AppDropdown<String>(
                  value: _draft.storeRoom,
                  items: const ['Manna Rubber Park', 'Consumables Room'],
                  onChanged: (value) =>
                      setState(() => _draft.storeRoom = value ?? _draft.storeRoom),
                ),
              ),
            ),
          ],
          // Still shown on an edit, just not editable — the figures are needed
          // to make sense of the item, and each says where it does change.
          if (_isEdit) ...[
            _LockedFacts(product: widget.product!),
            const SizedBox(height: 18),
          ],
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

          // The two refusals, each with the tick that answers it. Submit stays
          // disabled until it is answered, so the same payload is never
          // re-sent unchanged.
          if (_refusedDuplicates != null) ...[
            DuplicateMatchesCard(
              matches: _refusedDuplicates!,
              heading: _refusedDuplicateMessage,
            ),
            const SizedBox(height: 6),
            ConfirmOverride(
              value: _allowDuplicate,
              tone: AppColors.danger,
              onChanged: (value) => setState(() => _allowDuplicate = value),
              label: 'This is a different item from the ones above — submit anyway.',
            ),
            const SizedBox(height: 12),
          ],

          if (_refusedName != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.warning.withValues(alpha: 0.22)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.rule_outlined,
                        size: 15,
                        color: AppColors.warningDeep,
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: Text(
                          '"${_name.text.trim()}" does not follow SOI1/SOP1',
                          style: const TextStyle(
                            color: AppColors.warningDeep,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            height: 1.3,
                          ),
                        ),
                      ),
                    ],
                  ),
                  for (final issue in _refusedName!)
                    Padding(
                      padding: const EdgeInsets.only(top: 5, left: 22),
                      child: Text(
                        '• ${issue.message}',
                        style: const TextStyle(
                          color: AppColors.warningDeep,
                          fontSize: 10.5,
                          height: 1.35,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 6),
            ConfirmOverride(
              value: _acknowledgeNaming,
              onChanged: (value) => setState(() => _acknowledgeNaming = value),
              label: 'Submit with this name anyway — it will be marked non-compliant '
                  'in the catalog.',
            ),
          ],
        ],
      ),
    );
  }
}

/// The figures an edit does not offer, with where each one actually changes.
///
/// Shown rather than dropped: somebody correcting a rack number still needs to
/// know which room and how much, and a form that silently omits half an item
/// reads as though the data were missing.
class _LockedFacts extends StatelessWidget {
  const _LockedFacts({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    final rows = <({String label, String value, String where})>[
      (label: 'Product Code', value: product.code, where: 'fixed identity'),
      (label: 'Unit of Measure', value: product.unit, where: 'fixed identity'),
      (
        label: 'Current Stock',
        value: '${product.quantity} ${product.unit}',
        where: 'Stock In request',
      ),
      (label: 'Store Room', value: product.storeRoom, where: 'Admin moves it'),
      (
        label: 'Minimum Stock',
        value: '${product.minStock} ${product.unit}',
        where: 'purchasing figure',
      ),
    ];

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.lock_outline, size: 14, color: AppColors.textMuted),
              SizedBox(width: 6),
              Text(
                'Not changed here',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 7),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    flex: 4,
                    child: Text(
                      row.label,
                      style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                    ),
                  ),
                  Expanded(
                    flex: 5,
                    child: Text(
                      row.value,
                      style: const TextStyle(
                        color: AppColors.textBody,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  Expanded(
                    flex: 4,
                    child: Text(
                      row.where,
                      textAlign: TextAlign.right,
                      style: const TextStyle(color: AppColors.textFaint, fontSize: 10),
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
// Stock In request
//
// Stock arriving is the one movement a supervisor cannot make alone: the Admin
// takes delivery of it and says which room it landed in. Stock leaving needs no
// request — it is issued, consumed, scrapped or returned, and each of those
// applies straight away.
// ---------------------------------------------------------------------------

class _StockInRequestForm extends StatefulWidget {
  const _StockInRequestForm({required this.product});

  final Product product;

  @override
  State<_StockInRequestForm> createState() => _StockInRequestFormState();
}

class _StockInRequestFormState extends State<_StockInRequestForm> {
  final _controller = TextEditingController(text: '1');
  bool _submitting = false;

  List<StockRoom> _rooms = const [];
  String? _roomId;

  int get _quantity => int.tryParse(_controller.text.trim()) ?? 0;

  @override
  void initState() {
    super.initState();
    _loadRooms();
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
      final requestNumber =
          await context.read<StockRepository>().createStockInRequest(
                productId: widget.product.id,
                quantity: _quantity,
                stockRoomId: _roomId,
              );
      Toast.success(
        requestNumber.isEmpty
            ? 'Stock In request submitted successfully!'
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
      title: 'Request Stock In',
      submitLabel: 'Submit Request',
      submitting: _submitting,
      initialSize: 0.55,
      onSubmit: _submit,
      children: [
        _ProductSummary(product: widget.product),
        const SizedBox(height: 18),
        _Field(
          label: 'Quantity Received (${widget.product.unit})',
          required: true,
          child: QuantityStepper(
            controller: _controller,
            onChanged: () => setState(() {}),
          ),
        ),
        if (_rooms.isNotEmpty)
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
        const Text(
          'This request goes to the office Admin for approval; stock changes only '
          'once it is approved.',
          style: TextStyle(color: AppColors.textMuted, fontSize: 11.5, height: 1.5),
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
  String _condition = 'Good';
  bool _submitting = false;

  int get _qty => int.tryParse(_quantity.text.trim()) ?? 0;
  int get _outstanding => widget.issue.outstanding;
  bool get _exceedsOutstanding => _qty > _outstanding;

  @override
  void dispose() {
    _quantity.dispose();
    _department.dispose();
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
    setState(() => _submitting = true);
    try {
      final message = await context.read<StockRepository>().returnIssuedStock(
            issueId: widget.issue.id,
            quantity: _qty,
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
                  'Merge it from the Red Room screen to put it back on a shelf.',
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
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Consumption and scrap
// ---------------------------------------------------------------------------

/// Books an issued batch as Consumed or Scrapped.
///
/// The two share a sheet because the operation is identical — close a quantity
/// out against an issue, with a reason — and only the wording, the colour and
/// the value line differ. Scrap additionally prices what is being written off,
/// since that total is the metric the whole log exists to produce.
class _DisposalForm extends StatefulWidget {
  const _DisposalForm({required this.issue, required this.type});

  final IssueRecord issue;

  /// `Consumed` or `Scrapped`.
  final String type;

  @override
  State<_DisposalForm> createState() => _DisposalFormState();
}

class _DisposalFormState extends State<_DisposalForm> {
  late final TextEditingController _quantity =
      TextEditingController(text: '${widget.issue.outstanding}');
  final TextEditingController _reason = TextEditingController();
  bool _submitting = false;

  bool get _isScrap => widget.type == 'Scrapped';
  int get _qty => int.tryParse(_quantity.text.trim()) ?? 0;
  int get _outstanding => widget.issue.outstanding;
  bool get _exceedsOutstanding => _qty > _outstanding;

  /// Per-unit cost as the catalogue currently holds it. 0 means the product has
  /// never been costed, which is common on the imported rows — the scrap is
  /// still worth recording, it just cannot be priced.
  num get _unitCost => widget.issue.product?.unitCost ?? 0;
  bool get _isCosted => _unitCost > 0;
  num get _previewValue => _unitCost * _qty;

  /// A write-off should say why. Consumption is routine and does not need one.
  bool get _reasonMissing => _isScrap && _reason.text.trim().isEmpty;

  @override
  void dispose() {
    _quantity.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_qty < 1) {
      Toast.error('Quantity must be at least 1');
      return;
    }
    if (_exceedsOutstanding) {
      Toast.error('Only $_outstanding still outstanding on this issue');
      return;
    }
    if (_reasonMissing) {
      Toast.error('Give a reason for scrapping this item');
      return;
    }
    setState(() => _submitting = true);
    try {
      final message = await context.read<StockRepository>().recordDisposal(
            type: widget.type,
            issueId: widget.issue.id,
            quantity: _qty,
            reason: _reason.text.trim(),
          );
      Toast.success(message);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      Toast.error(error.message);
    } catch (_) {
      Toast.error('Failed to record the ${widget.type.toLowerCase()} entry');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final product = widget.issue.product;
    final unit = product?.unit ?? 'unit(s)';
    final accent = _isScrap ? AppColors.danger : AppColors.textSecondary;

    return _FormSheet(
      title: _isScrap ? 'Scrap Item' : 'Mark as Consumed',
      titleIcon: _isScrap
          ? Icons.delete_outline
          : Icons.local_fire_department_outlined,
      titleIconColor: accent,
      submitLabel: _isScrap ? 'Record Scrap' : 'Record Consumption',
      submitColor: _isScrap ? AppColors.dangerDeep : AppColors.primary,
      submitting: _submitting,
      canSubmit: !_exceedsOutstanding && _qty >= 1 && !_reasonMissing,
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
            color: accent.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: accent.withValues(alpha: 0.18)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                _isScrap ? Icons.warning_amber_outlined : Icons.info_outline,
                size: 16,
                color: accent,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _isScrap
                      ? 'This stock is being written off — it will not come back '
                          'to a shelf. The value below is recorded against the '
                          'scrap metric and cannot be edited afterwards.'
                      : 'This stock has been used up and will not come back. '
                          'It was already taken off the shelf when it was '
                          'issued, so no store room changes here.',
                  style: TextStyle(color: accent, fontSize: 11.5, height: 1.45),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        _Field(
          label: 'Quantity to ${_isScrap ? 'Scrap' : 'Consume'} ($unit)',
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
        if (_isScrap) ...[
          _ScrapValuePreview(
            unitCost: _unitCost,
            quantity: _qty,
            value: _previewValue,
            isCosted: _isCosted,
          ),
          const SizedBox(height: 18),
        ],
        _Field(
          label: _isScrap ? 'Reason for Scrapping' : 'Note',
          required: _isScrap,
          child: TextField(
            controller: _reason,
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: _isScrap
                  ? 'e.g. Bearing seized, beyond repair'
                  : 'e.g. Used on the mixer overhaul',
            ),
          ),
        ),
      ],
    );
  }
}

/// Prices the scrap before it is booked, so the person recording it sees the
/// number that will land on the maintenance metric.
class _ScrapValuePreview extends StatelessWidget {
  const _ScrapValuePreview({
    required this.unitCost,
    required this.quantity,
    required this.value,
    required this.isCosted,
  });

  final num unitCost;
  final int quantity;
  final num value;
  final bool isCosted;

  @override
  Widget build(BuildContext context) {
    if (!isCosted) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surfaceMuted,
          borderRadius: BorderRadius.circular(10),
        ),
        child: const Row(
          children: [
            Icon(Icons.help_outline, size: 15, color: AppColors.textMuted),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'This product has no unit cost recorded, so the scrap cannot be '
                'valued. The quantity is still logged.',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 11.5,
                  height: 1.45,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.danger.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.2)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Text(
                'Unit cost',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
              ),
              const Spacer(),
              Text(
                formatCurrency(unitCost),
                style: const TextStyle(
                  color: AppColors.textBody,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Divider(height: 1),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                'Scrap value ($quantity × unit cost)',
                style: const TextStyle(
                  color: AppColors.textStrong,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const Spacer(),
              Text(
                formatCurrency(value),
                style: const TextStyle(
                  color: AppColors.dangerDeep,
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
