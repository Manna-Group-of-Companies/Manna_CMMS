import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/palette.dart';
import '../data/repository.dart';
import '../models/models.dart';

/// The SOI1/SOP1 item naming convention, as a form (ST-09, ST-10), plus the
/// duplicate warning that goes with it (ST-14).
///
/// None of these widgets knows what a valid name looks like. The rules live on
/// the server in `utils/itemNaming.js` and are reached through
/// `POST /products/name-preview` — one implementation, so the phone, the web
/// console and the API can never disagree about what an item is called.

/// How long to wait after the last keystroke before asking the server.
const _debounce = Duration(milliseconds: 450);

/// Offered as suggestions, not as a closed list — the store meets new ones.
const _commonUoms = ['MM', 'CM', 'M', '”', '’', 'SQMM', 'KG', 'G', 'L', 'NOS', 'SET', 'MTR'];
const _electricalUoms = ['V', 'A', 'W', 'KW', 'HP', 'HZ', 'KVA'];

/// Small caps label, matching the field labels in the request forms.
class _MiniLabel extends StatelessWidget {
  const _MiniLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(
          text,
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 11.5,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
}

InputDecoration _dense(String hint) => InputDecoration(
      hintText: hint,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    );

/// Builds a standardized name out of its parts, previewing it as it is typed.
///
/// [naming] is mutated in place — it belongs to the draft being edited — and
/// [onChanged] lets the parent rebuild. [onApply] hands the finished name back
/// to the Product Name field.
class ItemNameBuilderCard extends StatefulWidget {
  const ItemNameBuilderCard({
    super.key,
    required this.naming,
    required this.onApply,
    this.onChanged,
    this.enabled = true,
  });

  final NamingParts naming;
  final void Function(String name) onApply;
  final VoidCallback? onChanged;
  final bool enabled;

  @override
  State<ItemNameBuilderCard> createState() => _ItemNameBuilderCardState();
}

class _ItemNameBuilderCardState extends State<ItemNameBuilderCard> {
  /// One controller pair per dimension row, kept in step with the row list so
  /// removing a middle row does not shuffle the values of the rows below it.
  final List<TextEditingController> _values = [];
  final List<TextEditingController> _uoms = [];

  late final _rating = TextEditingController(text: widget.naming.electricalRating);
  late final _ratingUom = TextEditingController(text: widget.naming.electricalUom);
  late final _itemName = TextEditingController(text: widget.naming.itemName);
  late final _type = TextEditingController(text: widget.naming.type);
  late final _material = TextEditingController(text: widget.naming.material);
  late final _itemCode = TextEditingController(text: widget.naming.itemCode);

  Timer? _timer;
  NameCheck? _check;
  bool _checking = false;

  /// Guards against a slow response overwriting a newer one.
  int _ticket = 0;

  @override
  void initState() {
    super.initState();
    for (final dimension in widget.naming.dimensions) {
      _values.add(TextEditingController(text: dimension.value));
      _uoms.add(TextEditingController(text: dimension.uom));
    }
    // Editing an existing product opens with parts already filled in, so the
    // preview should be there before the first keystroke.
    if (!widget.naming.isBlank) _schedule();
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (final controller in [
      ..._values,
      ..._uoms,
      _rating,
      _ratingUom,
      _itemName,
      _type,
      _material,
      _itemCode,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  /// Copies the controllers back into the draft and asks the server for a name.
  void _schedule() {
    final naming = widget.naming;
    naming.dimensions
      ..clear()
      ..addAll([
        for (var i = 0; i < _values.length; i++)
          ItemDimension(value: _values[i].text, uom: _uoms[i].text),
      ]);
    naming
      ..electricalRating = _rating.text
      ..electricalUom = _ratingUom.text
      ..itemName = _itemName.text
      ..type = _type.text
      ..material = _material.text
      ..itemCode = _itemCode.text;

    widget.onChanged?.call();

    _timer?.cancel();
    if (naming.isBlank) {
      setState(() {
        _check = null;
        _checking = false;
      });
      return;
    }

    setState(() => _checking = true);
    final ticket = ++_ticket;
    _timer = Timer(_debounce, () async {
      try {
        final result = await context.read<StockRepository>().checkItemName(naming: naming);
        if (mounted && ticket == _ticket) setState(() => _check = result);
      } catch (_) {
        // A failed preview must not block the form: the same check runs again
        // on submit, where it can actually be acted on.
        if (mounted && ticket == _ticket) setState(() => _check = null);
      } finally {
        if (mounted && ticket == _ticket) setState(() => _checking = false);
      }
    });
  }

  void _addDimension() {
    setState(() {
      _values.add(TextEditingController());
      _uoms.add(TextEditingController());
    });
    _schedule();
  }

  void _removeDimension(int index) {
    setState(() {
      // Always leave one row, so the section never collapses to nothing.
      if (_values.length == 1) {
        _values[0].clear();
        _uoms[0].clear();
      } else {
        _values.removeAt(index).dispose();
        _uoms.removeAt(index).dispose();
      }
    });
    _schedule();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Icon(Icons.auto_fix_high_outlined, size: 17, color: AppColors.primaryDeep),
              SizedBox(width: 7),
              Expanded(
                child: Text(
                  'Standard Name Builder',
                  style: TextStyle(
                    color: AppColors.textStrong,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'Fill in what applies. Dimensions first, then rating, item name, type, '
            'material and item code — the standard name assembles itself below.',
            style: TextStyle(color: AppColors.textMuted, fontSize: 11, height: 1.4),
          ),
          const SizedBox(height: 16),

          // Dimensions — the only fields joined by "*", and only to each other.
          const _MiniLabel('Dimensions'),
          for (var index = 0; index < _values.length; index++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: TextField(
                      controller: _values[index],
                      enabled: widget.enabled,
                      onChanged: (_) => _schedule(),
                      decoration: _dense(index == 0 ? 'e.g. 50' : 'e.g. 10'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: TextField(
                      controller: _uoms[index],
                      enabled: widget.enabled,
                      textCapitalization: TextCapitalization.characters,
                      onChanged: (_) => _schedule(),
                      decoration: _dense('UOM'),
                    ),
                  ),
                  IconButton(
                    onPressed: widget.enabled ? () => _removeDimension(index) : null,
                    icon: const Icon(Icons.close, size: 18),
                    color: AppColors.textMuted,
                    visualDensity: VisualDensity.compact,
                    tooltip: 'Clear this dimension',
                  ),
                ],
              ),
            ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: widget.enabled ? _addDimension : null,
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Add dimension'),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primaryDeep,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ),
          const SizedBox(height: 8),
          _UomHints(
            options: _commonUoms,
            enabled: widget.enabled,
            onPick: (uom) {
              // Fills the last dimension row that has no unit yet, which is the
              // one being worked on.
              final target = _uoms.indexWhere((controller) => controller.text.trim().isEmpty);
              _uoms[target == -1 ? _uoms.length - 1 : target].text = uom;
              _schedule();
            },
          ),
          const SizedBox(height: 16),

          const _MiniLabel('Electrical Rating'),
          Row(
            children: [
              Expanded(
                flex: 3,
                child: TextField(
                  controller: _rating,
                  enabled: widget.enabled,
                  onChanged: (_) => _schedule(),
                  decoration: _dense('e.g. 415'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: TextField(
                  controller: _ratingUom,
                  enabled: widget.enabled,
                  textCapitalization: TextCapitalization.characters,
                  onChanged: (_) => _schedule(),
                  decoration: _dense('V'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _UomHints(
            options: _electricalUoms,
            enabled: widget.enabled,
            onPick: (uom) {
              _ratingUom.text = uom;
              _schedule();
            },
          ),
          const SizedBox(height: 16),

          const _MiniLabel('Item Name'),
          TextField(
            controller: _itemName,
            enabled: widget.enabled,
            textCapitalization: TextCapitalization.words,
            onChanged: (_) => _schedule(),
            decoration: _dense('e.g. Bearing'),
          ),
          const SizedBox(height: 14),

          const _MiniLabel('Type'),
          TextField(
            controller: _type,
            enabled: widget.enabled,
            textCapitalization: TextCapitalization.words,
            onChanged: (_) => _schedule(),
            decoration: _dense('e.g. Deep Groove'),
          ),
          const SizedBox(height: 14),

          const _MiniLabel('Material'),
          TextField(
            controller: _material,
            enabled: widget.enabled,
            textCapitalization: TextCapitalization.characters,
            onChanged: (_) => _schedule(),
            decoration: _dense('e.g. SS304'),
          ),
          const SizedBox(height: 14),

          const _MiniLabel('Item Code'),
          TextField(
            controller: _itemCode,
            enabled: widget.enabled,
            textCapitalization: TextCapitalization.characters,
            onChanged: (_) => _schedule(),
            decoration: _dense('e.g. BS245SR61'),
          ),
          const SizedBox(height: 16),

          _NamePreview(
            check: _check,
            checking: _checking,
            enabled: widget.enabled,
            onApply: widget.onApply,
          ),
        ],
      ),
    );
  }
}

/// Tappable UOM suggestions. Faster than typing "SQMM" on a phone keyboard.
class _UomHints extends StatelessWidget {
  const _UomHints({required this.options, required this.onPick, required this.enabled});

  final List<String> options;
  final void Function(String uom) onPick;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        for (final uom in options)
          OutlinedButton(
            onPressed: enabled ? () => onPick(uom) : null,
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
              backgroundColor: AppColors.surface,
              side: const BorderSide(color: AppColors.borderStrong),
              textStyle: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(uom),
          ),
      ],
    );
  }
}

/// The composed name, its verdict, and the button that adopts it.
class _NamePreview extends StatelessWidget {
  const _NamePreview({
    required this.check,
    required this.checking,
    required this.enabled,
    required this.onApply,
  });

  final NameCheck? check;
  final bool checking;
  final bool enabled;
  final void Function(String name) onApply;

  @override
  Widget build(BuildContext context) {
    final result = check;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'STANDARD NAME',
                  style: TextStyle(
                    color: AppColors.textFaint,
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.6,
                  ),
                ),
              ),
              if (checking)
                const SizedBox(
                  height: 12,
                  width: 12,
                  child: CircularProgressIndicator(strokeWidth: 1.8),
                ),
            ],
          ),
          const SizedBox(height: 5),
          SelectableText(
            result?.name.isNotEmpty == true ? result!.name : 'Fill in the fields above…',
            style: TextStyle(
              color: result?.name.isNotEmpty == true
                  ? AppColors.textStrong
                  : AppColors.textFaint,
              fontSize: 14,
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
          if (result != null && result.name.isNotEmpty) ...[
            const SizedBox(height: 10),
            NameComplianceHint(check: result),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: enabled ? () => onApply(result.name) : null,
                    icon: const Icon(Icons.check, size: 16),
                    label: const Text('Use this name'),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      textStyle: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: result.name));
                  },
                  icon: const Icon(Icons.copy_all_outlined, size: 18),
                  color: AppColors.textSecondary,
                  tooltip: 'Copy the name',
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Whether a name follows the convention, and what is wrong with it if not
/// (ST-10). Used under the preview and under the Product Name field.
class NameComplianceHint extends StatelessWidget {
  const NameComplianceHint({super.key, required this.check});

  final NameCheck check;

  @override
  Widget build(BuildContext context) {
    if (check.compliant) {
      return const Row(
        children: [
          Icon(Icons.verified_outlined, size: 14, color: AppColors.success),
          SizedBox(width: 5),
          Expanded(
            child: Text(
              'Follows the SOI1/SOP1 naming convention',
              style: TextStyle(
                color: AppColors.success,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Icon(Icons.warning_amber_outlined, size: 14, color: AppColors.warning),
            SizedBox(width: 5),
            Expanded(
              child: Text(
                'Does not follow SOI1/SOP1',
                style: TextStyle(
                  color: AppColors.warning,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
        for (final issue in check.issues)
          Padding(
            padding: const EdgeInsets.only(top: 4, left: 19),
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
    );
  }
}

/// Catalog items that look like the one being entered (ST-14).
///
/// Shows enough of each match — room, rack, stock on hand — to judge whether it
/// really is the same thing, because "similar name" alone never settles it.
class DuplicateMatchesCard extends StatelessWidget {
  const DuplicateMatchesCard({super.key, required this.matches, this.heading});

  final List<DuplicateMatch> matches;
  final String? heading;

  @override
  Widget build(BuildContext context) {
    if (matches.isEmpty) return const SizedBox.shrink();

    final exact = matches.any((match) => match.exact);
    final tone = exact ? AppColors.danger : AppColors.warning;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: tone.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.copy_outlined, size: 15, color: tone),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  heading ??
                      (exact
                          ? 'This item is already in the catalog'
                          : '${matches.length} similar item${matches.length > 1 ? 's' : ''} '
                              'already in the catalog'),
                  style: TextStyle(color: tone, fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          for (final match in matches)
            Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    match.name,
                    style: const TextStyle(
                      color: AppColors.textStrong,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      height: 1.3,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${match.code} · ${match.storeRoom}'
                    '${match.rackNumber.isEmpty ? '' : ' · ${match.rackNumber}'} · '
                    '${match.quantity} ${match.unit} in stock',
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 10.5),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    match.reason,
                    style: TextStyle(
                      color: tone,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          Text(
            'Add stock to the existing item instead of creating a second record — '
            'or confirm below if this really is a different item.',
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 10.5, height: 1.4),
          ),
        ],
      ),
    );
  }
}

/// The tick that answers a refused save — a non-compliant name, or a possible
/// duplicate. Both checks are advisory, and this is how they are overridden.
class ConfirmOverride extends StatelessWidget {
  const ConfirmOverride({
    super.key,
    required this.value,
    required this.onChanged,
    required this.label,
    this.tone = AppColors.warning,
  });

  final bool value;
  final ValueChanged<bool> onChanged;
  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onChanged(!value),
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 22,
              width: 22,
              child: Checkbox(
                value: value,
                onChanged: (next) => onChanged(next ?? false),
                activeColor: tone,
                visualDensity: VisualDensity.compact,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  color: AppColors.textBody,
                  fontSize: 11.5,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
