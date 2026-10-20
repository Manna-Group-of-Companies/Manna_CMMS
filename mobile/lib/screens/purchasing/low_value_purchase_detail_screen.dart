import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/purchasing_repository.dart';
import '../../models/purchasing.dart';
import '../../widgets/common.dart';
import 'low_value_purchases_screen.dart' show ChoiceSheet;
import 'low_value_widgets.dart';

/// One row of the Purchase Request Sheet, read down instead of across: every
/// column as a label beside its value, in the sheet's order, with the images
/// where the sheet has its "Image samples" column.
///
/// A column this person may change - exactly the row's `editable`, which the
/// server works out per person and per row - shows a pencil and opens a sheet
/// to change it; the change is saved on its own with a `PUT` of that one
/// column. Nothing here looks at the role.
class LowValuePurchaseDetailScreen extends StatefulWidget {
  const LowValuePurchaseDetailScreen({super.key, required this.id});

  final String id;

  @override
  State<LowValuePurchaseDetailScreen> createState() => _LowValuePurchaseDetailScreenState();
}

class _LowValuePurchaseDetailScreenState extends State<LowValuePurchaseDetailScreen> {
  late final PurchasingRepository _repo = PurchasingRepository(context.read<ApiClient>());

  PurchaseRequest? _row;
  PurchaseSheetOptions _options = PurchaseSheetOptions.fallback;
  bool _loading = true;
  bool _busy = false;
  bool _changed = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
    _loadOptions();
  }

  Future<void> _load() async {
    try {
      final row = await _repo.request(widget.id);
      if (!mounted) return;
      setState(() {
        _row = row;
        _error = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Quietly: the built-in lists stand in until it answers.
  Future<void> _loadOptions() async {
    try {
      final options = await _repo.options();
      if (mounted) setState(() => _options = options);
    } on ApiException catch (e) {
      debugPrint('Purchase sheet options: ${e.message}');
    }
  }

  Future<void> _edit(PurchaseRequest row, SheetColumn column) async {
    final updated = await showModalBottomSheet<PurchaseRequest>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _EditColumnSheet(repo: _repo, row: row, column: column, options: _options),
    );
    if (updated == null || !mounted) return;
    setState(() {
      // The PUT answers with the row but not its images; keep the ones shown.
      _row = updated.images.isEmpty ? updated.withImages(row.images) : updated;
      _changed = true;
    });
    Toast.success('${column.label} saved');
  }

  Future<void> _addImage(PurchaseRequest row) async {
    final source = await askPhotoSource(context);
    if (source == null) return;
    try {
      final photo = await pickPhoto(source);
      if (photo == null || !mounted) return;
      setState(() => _busy = true);
      await _repo.attachImage(
        row.id,
        fileName: photo.name,
        contentType: photo.contentType,
        dataBase64: base64Encode(photo.bytes),
      );
      _changed = true;
      Toast.success('Image added');
      await _load();
    } on PhotoProblem catch (e) {
      Toast.show(e.message, ToastType.error);
    } on ApiException catch (e) {
      Toast.show(e.message, ToastType.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeImage(PurchaseRequest row, PurchaseImage image) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Remove this image?'),
        content: Text(image.fileName),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Keep')),
          FilledButton(onPressed: () => Navigator.of(dialog).pop(true), child: const Text('Remove')),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await _repo.removeImage(row.id, image.id);
      _changed = true;
      Toast.success('Image removed');
      await _load();
    } on ApiException catch (e) {
      Toast.show(e.message, ToastType.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final row = _row;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Purchase request'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => Navigator.of(context).pop(_changed),
          ),
          bottom: _busy
              ? const PreferredSize(
                  preferredSize: Size.fromHeight(2),
                  child: LinearProgressIndicator(minHeight: 2),
                )
              : null,
        ),
        body: _loading
            ? const LoadingView(message: 'Loading…')
            : _error.isNotEmpty && row == null
                ? EmptyState(
                    title: 'Could not load it',
                    message: _error,
                    icon: Icons.error_outline,
                    iconColor: AppColors.danger,
                  )
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                      children: [
                        _Summary(row: row!),
                        const SizedBox(height: 12),
                        AppCard(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          color: row.done ? sheetDoneFill : null,
                          borderColor: row.done ? sheetDoneGreen : null,
                          child: Column(
                            children: [
                              for (final (i, column) in sheetColumns.indexed) ...[
                                if (i > 0) const Divider(height: 1, color: AppColors.border),
                                if (column.key == imageSamplesColumn)
                                  _ImagesRow(
                                    row: row,
                                    busy: _busy,
                                    onAdd: () => _addImage(row),
                                    onRemove: (image) => _removeImage(row, image),
                                  )
                                else
                                  _ColumnRow(
                                    row: row,
                                    column: column,
                                    onEdit: row.canEdit(column.key) && !_busy ? () => _edit(row, column) : null,
                                  ),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        _Trail(row: row),
                      ],
                    ),
                  ),
      ),
    );
  }
}

/// The three chips the list leads with, so the state reads before the detail.
class _Summary extends StatelessWidget {
  const _Summary({required this.row});

  final PurchaseRequest row;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              MonoText(row.id),
              const Spacer(),
              if (row.done)
                const AppBadge('done', color: AppColors.success, icon: Icons.check),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              if (row.priority.isNotEmpty) SheetChip.priority(row.priority),
              SheetChip.approval(row.approvalStatus),
              SheetChip.purchase(row.purchaseStatus),
            ],
          ),
          if (row.editable.isEmpty) ...[
            const SizedBox(height: 8),
            const Text(
              'You can read this row but not change it.',
              style: TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
          ],
        ],
      );
}

/// One column: its heading, its value, and a pencil when it may be changed.
class _ColumnRow extends StatelessWidget {
  const _ColumnRow({required this.row, required this.column, required this.onEdit});

  final PurchaseRequest row;
  final SheetColumn column;

  /// Null when this person may not change it.
  final VoidCallback? onEdit;

  @override
  Widget build(BuildContext context) {
    final text = row.textOf(column.key);
    final color = SheetColors.of(column.key, text);

    return InkWell(
      onTap: onEdit,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 120,
              child: Text(
                column.label,
                style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: text.isEmpty
                  ? const Text('—', style: TextStyle(fontSize: 13, color: AppColors.textFaint))
                  : color != null
                      ? Align(alignment: Alignment.centerLeft, child: SheetChip(text, color: color))
                      : SelectableText(
                          text,
                          style: const TextStyle(fontSize: 13, color: AppColors.textPrimary),
                          // A tap on the text should still open the editor.
                          onTap: onEdit,
                        ),
            ),
            SizedBox(
              width: 28,
              child: onEdit == null
                  ? null
                  : const Icon(Icons.edit_outlined, size: 16, color: AppColors.primaryDeep),
            ),
          ],
        ),
      ),
    );
  }
}

/// The "Image samples" column: what is attached, and adding or removing one
/// for anyone who may change the row.
///
/// The files are private in ERPNext, so their links do not open without an
/// ERPNext session - the same as the breakdown photos - and are listed by name
/// rather than shown. A public one with a full address is shown.
class _ImagesRow extends StatelessWidget {
  const _ImagesRow({required this.row, required this.busy, required this.onAdd, required this.onRemove});

  final PurchaseRequest row;
  final bool busy;
  final VoidCallback onAdd;
  final ValueChanged<PurchaseImage> onRemove;

  static String _size(int bytes) {
    if (bytes <= 0) return '';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).ceil()} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(
              width: 120,
              child: Text('Image samples', style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (row.images.isEmpty)
                    const Text('—', style: TextStyle(fontSize: 13, color: AppColors.textFaint)),
                  for (final image in row.images)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        children: [
                          _Thumb(image: image),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  image.fileName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 12.5, color: AppColors.textPrimary),
                                ),
                                Text(
                                  [_size(image.size), if (image.addedAt != null) formatDate(image.addedAt)]
                                      .where((s) => s.isNotEmpty)
                                      .join(' · '),
                                  style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                                ),
                              ],
                            ),
                          ),
                          if (row.canAttach)
                            IconButton(
                              tooltip: 'Remove',
                              visualDensity: VisualDensity.compact,
                              icon: const Icon(Icons.delete_outline, size: 18, color: AppColors.danger),
                              onPressed: busy ? null : () => onRemove(image),
                            ),
                        ],
                      ),
                    ),
                  if (row.canAttach)
                    TextButton.icon(
                      style: TextButton.styleFrom(padding: EdgeInsets.zero, visualDensity: VisualDensity.compact),
                      icon: const Icon(Icons.add_a_photo_outlined, size: 16),
                      label: const Text('Add a photo'),
                      onPressed: busy ? null : onAdd,
                    ),
                ],
              ),
            ),
          ],
        ),
      );
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.image});

  final PurchaseImage image;

  @override
  Widget build(BuildContext context) {
    final showable = !image.isPrivate && image.url.startsWith('http');
    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: Container(
        width: 40,
        height: 40,
        color: AppColors.surfaceMuted,
        child: showable
            ? Image.network(
                image.url,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) =>
                    const Icon(Icons.image_outlined, size: 18, color: AppColors.textMuted),
              )
            : const Icon(Icons.image_outlined, size: 18, color: AppColors.textMuted),
      ),
    );
  }
}

/// Who added the row and who last touched it - not columns of the sheet,
/// but what anyone asking "who changed this?" needs.
class _Trail extends StatelessWidget {
  const _Trail({required this.row});

  final PurchaseRequest row;

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(fontSize: 11.5, color: AppColors.textMuted);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (row.raisedBy.isNotEmpty || row.raisedAt != null)
          Text('Added by ${row.raisedBy.isEmpty ? '—' : row.raisedBy} · ${formatDateTime(row.raisedAt)}',
              style: style),
        if (row.updatedBy.isNotEmpty || row.updatedAt != null) ...[
          const SizedBox(height: 2),
          Text(
            'Last changed by ${row.updatedBy.isEmpty ? '—' : row.updatedBy} · ${formatDateTime(row.updatedAt)}',
            style: style,
          ),
        ],
      ],
    );
  }
}

/// Changing one column. A pick saves as soon as a choice is tapped; a date or
/// text saves with the button. Pops the updated row.
class _EditColumnSheet extends StatefulWidget {
  const _EditColumnSheet({
    required this.repo,
    required this.row,
    required this.column,
    required this.options,
  });

  final PurchasingRepository repo;
  final PurchaseRequest row;
  final SheetColumn column;
  final PurchaseSheetOptions options;

  @override
  State<_EditColumnSheet> createState() => _EditColumnSheetState();
}

class _EditColumnSheetState extends State<_EditColumnSheet> {
  late final _text = TextEditingController(text: widget.row.textOf(widget.column.key));
  late DateTime? _day = switch (widget.column.key) {
    'date' => widget.row.date,
    'expectedOn' => widget.row.expectedOn,
    'receivedOn' => widget.row.receivedOn,
    _ => null,
  };
  bool _saving = false;
  String _problem = '';

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _save(String value) async {
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _problem = '';
    });
    try {
      final updated = await widget.repo.change(widget.row.id, widget.column.key, value);
      if (mounted) Navigator.of(context).pop(updated);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final column = widget.column;

    if (column.kind == SheetColumnKind.pick) {
      // The same list the filters use, painted in the column's colours.
      return Stack(
        children: [
          ChoiceSheet(
            title: column.label,
            choices: widget.options.choicesFor(column.key),
            selected: widget.row.textOf(column.key),
            colorOf: (v) => SheetColors.of(column.key, v),
            onPicked: (v) {
              if (_saving || v == widget.row.textOf(column.key)) {
                Navigator.of(context).pop();
              } else {
                _save(v);
              }
            },
          ),
          if (_saving)
            const Positioned(left: 0, right: 0, top: 0, child: LinearProgressIndicator(minHeight: 2)),
          if (_problem.isNotEmpty)
            Positioned(
              left: 16,
              right: 16,
              bottom: 8,
              child: Text(_problem, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
            ),
        ],
      );
    }

    final today = DateTime.now();
    final isDate = column.kind == SheetColumnKind.date;

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(column.label, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            if (isDate)
              LvDateField(
                value: _day,
                firstDate: today.subtract(const Duration(days: 365 * 3)),
                // The request's own date is never in the future; when it is
                // expected may well be.
                lastDate: column.key == 'expectedOn' ? today.add(const Duration(days: 365 * 2)) : today,
                clearable: column.clearable,
                placeholder: 'No date',
                onChanged: (d) => setState(() => _day = d),
              )
            else
              TextField(
                controller: _text,
                autofocus: true,
                minLines: column.multiline ? 3 : 1,
                maxLines: column.multiline ? 8 : 1,
                maxLength: column.key == 'raisedByName' ? 60 : 1000,
                decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
              ),
            if (_problem.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(_problem, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
            ],
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _saving ? null : () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: _saving || (isDate && _day == null && !column.clearable)
                        ? null
                        : () => _save(isDate ? (_day == null ? '' : apiDay(_day!)) : _text.text.trim()),
                    child: Text(_saving ? 'Saving…' : 'Save'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
