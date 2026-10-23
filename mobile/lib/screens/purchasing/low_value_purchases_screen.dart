import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/purchasing_repository.dart';
import '../../models/purchasing.dart';
import '../../state/auth_provider.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';
import '../../widgets/work_widgets.dart';
import 'low_value_widgets.dart';

/// The Purchase Request Sheet: the business's shared Google Sheet of things to
/// buy or repair, moved into ERPNext and kept there only - never sent to SAP.
///
/// Everyone with the screen sees every company's rows and adds rows; the
/// purchase manager works the same list as their queue. Newest first, as the
/// server sends them. On a phone each row is a card that reads left to right
/// the way the sheet does; the grid icon in the bar shows the sheet itself,
/// scrolling sideways, for anyone who wants the columns they are used to.
///
/// Holding a row down offers what this person may do to it without opening
/// it - edit the whole row, or delete it - going by the row's `editable` and
/// `deletable`, as the detail does.
class LowValuePurchasesScreen extends StatefulWidget {
  const LowValuePurchasesScreen({super.key});

  @override
  State<LowValuePurchasesScreen> createState() => _LowValuePurchasesScreenState();
}

class _LowValuePurchasesScreenState extends State<LowValuePurchasesScreen> {
  late final PurchasingRepository _repo = PurchasingRepository(context.read<ApiClient>());
  final _search = TextEditingController();

  List<PurchaseRequest> _rows = const [];
  PurchaseSheetOptions _options = PurchaseSheetOptions.fallback;
  // The built-in lists stand in for the filters, but the form waits for the
  // server's: it decides which companies this person may ask for.
  bool _optionsReady = false;

  /// Open (not yet Received or Delivered) is where the work is, so it is
  /// where the screen starts.
  bool _openOnly = true;
  String _company = '';
  String _approval = '';
  String _purchase = '';
  String _query = '';
  bool _asSheet = false;
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
    _loadOptions();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = _rows.isEmpty);
    try {
      final rows = await _repo.sheet(
        company: _company,
        approval: _approval,
        purchase: _purchase,
        openOnly: _openOnly,
      );
      if (!mounted) return;
      setState(() {
        _rows = rows;
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
      if (mounted) {
        setState(() {
          _options = options;
          _optionsReady = true;
        });
      }
    } on ApiException catch (e) {
      debugPrint('Purchase sheet options: ${e.message}');
    }
  }

  void _refilter(VoidCallback change) {
    setState(() {
      change();
      // A different filter is a different list: show the spinner, not the
      // old rows under the new chips.
      _rows = const [];
    });
    _load();
  }

  Future<void> _add() async {
    if (!_optionsReady) await _loadOptions();
    if (!mounted) return;
    if (!_optionsReady) {
      Toast.error('Could not reach the server. Try again in a moment.');
      return;
    }
    final made = await showModalBottomSheet<PurchaseRequest>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => NewPurchaseRequestSheet(
        repo: _repo,
        options: _options,
        raisedByName: context.read<AuthProvider>().user?.name ?? '',
      ),
    );
    if (made == null) return;
    Toast.success('Added to the sheet');
    _load();
  }

  Future<void> _open(PurchaseRequest row) async {
    final changed = await context.push<bool>('/purchases/low-value/${row.id}');
    if (changed == true) _load();
  }

  /// Edit and Delete for a row held down, where the row allows either.
  Future<void> _rowActions(PurchaseRequest row) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
              child: Text(
                requestHeadline(row),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
            ListTile(
              leading: const Icon(Icons.open_in_new),
              title: const Text('Open'),
              onTap: () => Navigator.of(sheet).pop('open'),
            ),
            if (row.editable.isNotEmpty)
              ListTile(
                leading: const Icon(Icons.edit_outlined),
                title: const Text('Edit'),
                onTap: () => Navigator.of(sheet).pop('edit'),
              ),
            if (row.deletable)
              ListTile(
                leading: const Icon(Icons.delete_outline, color: AppColors.danger),
                title: const Text('Delete', style: TextStyle(color: AppColors.danger)),
                onTap: () => Navigator.of(sheet).pop('delete'),
              ),
          ],
        ),
      ),
    );
    if (!mounted) return;
    switch (action) {
      case 'open':
        await _open(row);
      case 'edit':
        await _edit(row);
      case 'delete':
        await _delete(row);
    }
  }

  Future<void> _edit(PurchaseRequest row) async {
    // The form's company list is the server's, as for a new row; the
    // built-in one stands in if it cannot be had, and the server checks.
    if (!_optionsReady) await _loadOptions();
    if (!mounted) return;
    final updated = await showModalBottomSheet<PurchaseRequest>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => EditPurchaseRequestSheet(repo: _repo, row: row, options: _options),
    );
    if (updated == null) return;
    Toast.success('Request saved');
    // Reloaded rather than patched in: the change may move it out of the
    // filters on screen.
    _load();
  }

  Future<void> _delete(PurchaseRequest row) async {
    if (!await confirmDeleteRequest(context, row)) return;
    try {
      await _repo.delete(row.id);
      Toast.success('Request deleted');
      if (mounted) setState(() => _rows = _rows.where((r) => r.id != row.id).toList(growable: false));
      _load();
    } on ApiException catch (e) {
      Toast.show(e.message, ToastType.error);
    }
  }

  /// Null for a row this person can only read: holding it does nothing.
  VoidCallback? _holdFor(PurchaseRequest row) =>
      row.editable.isNotEmpty || row.deletable ? () => _rowActions(row) : null;

  /// One filter's choices in a sheet. Returns null when dismissed, "" for any.
  Future<void> _pick(String title, List<String> choices, String current, ValueChanged<String> set) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (_) => ChoiceSheet(title: title, choices: choices, selected: current, anyLabel: 'Any'),
    );
    if (picked == null || picked == current) return;
    _refilter(() => set(picked));
  }

  @override
  Widget build(BuildContext context) {
    final shown = _rows.where((r) => r.matches(_query)).toList(growable: false);
    final filtered = _company.isNotEmpty || _approval.isNotEmpty || _purchase.isNotEmpty;

    return AppShell(
      title: 'Miscellaneous Purchases',
      actions: [
        IconButton(
          tooltip: _asSheet ? 'Show as cards' : 'Show as the sheet',
          icon: Icon(_asSheet ? Icons.view_agenda_outlined : Icons.table_chart_outlined),
          onPressed: () => setState(() => _asSheet = !_asSheet),
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _add,
        icon: const Icon(Icons.add),
        label: const Text('New request'),
      ),
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          children: [
            TextField(
              controller: _search,
              onChanged: (v) => setState(() => _query = v),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                isDense: true,
                hintText: 'Search description, purpose, raised by…',
                prefixIcon: const Icon(Icons.search, size: 20),
                border: const OutlineInputBorder(),
                suffixIcon: _query.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Clear',
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () => setState(() {
                          _search.clear();
                          _query = '';
                        }),
                      ),
              ),
            ),
            const SizedBox(height: 10),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _FilterChip(
                    label: 'Open',
                    active: _openOnly,
                    onTap: () {
                      if (!_openOnly) _refilter(() => _openOnly = true);
                    },
                  ),
                  const SizedBox(width: 6),
                  _FilterChip(
                    label: 'All',
                    active: !_openOnly,
                    onTap: () {
                      if (_openOnly) _refilter(() => _openOnly = false);
                    },
                  ),
                  // A plant head has one company; there is nothing to choose.
                  if (_options.companies.length > 1) ...[
                    const SizedBox(width: 12),
                    _FilterChip(
                      label: _company.isEmpty ? 'Company' : _company,
                      active: _company.isNotEmpty,
                      dropdown: true,
                      onTap: () => _pick('Company', _options.companies, _company, (v) => _company = v),
                    ),
                  ],
                  const SizedBox(width: 6),
                  _FilterChip(
                    label: _approval.isEmpty ? 'Approval' : _approval,
                    active: _approval.isNotEmpty,
                    dropdown: true,
                    onTap: () =>
                        _pick('Status of Approval', _options.approvalStatuses, _approval, (v) => _approval = v),
                  ),
                  const SizedBox(width: 6),
                  _FilterChip(
                    label: _purchase.isEmpty ? 'Purchase' : _purchase,
                    active: _purchase.isNotEmpty,
                    dropdown: true,
                    onTap: () => _pick(
                      'Status of Purchase/Repair',
                      _options.purchaseStatuses,
                      _purchase,
                      (v) => _purchase = v,
                    ),
                  ),
                  if (filtered) ...[
                    const SizedBox(width: 6),
                    TextButton(
                      onPressed: () => _refilter(() {
                        _company = '';
                        _approval = '';
                        _purchase = '';
                      }),
                      child: const Text('Clear'),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 12),
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 40),
                child: LoadingView(message: 'Loading the sheet…'),
              )
            else if (_error.isNotEmpty)
              EmptyState(
                title: 'Could not load the requests',
                message: _error,
                icon: Icons.error_outline,
                iconColor: AppColors.danger,
              )
            else if (shown.isEmpty)
              EmptyState(
                title: 'Nothing here',
                message: _query.isNotEmpty
                    ? 'No row matches "$_query".'
                    : filtered || _openOnly
                        ? 'No rows match these filters.'
                        : 'The sheet is empty. Add a request with the button below.',
                icon: Icons.inbox_outlined,
              )
            else ...[
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  shown.length == 1 ? '1 row' : '${shown.length} rows',
                  style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                ),
              ),
              if (_asSheet)
                _SheetGrid(rows: shown, onOpen: _open, onHold: _holdFor)
              else
                for (final row in shown) ...[
                  _RowCard(row: row, onOpen: () => _open(row), onHold: _holdFor(row)),
                  const SizedBox(height: 10),
                ],
            ],
          ],
        ),
      ),
    );
  }
}

/// A filter as a pill: filled when it is narrowing the list.
class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.active,
    required this.onTap,
    this.dropdown = false,
  });

  final String label;
  final bool active;
  final VoidCallback onTap;
  final bool dropdown;

  @override
  Widget build(BuildContext context) {
    final fg = active ? Colors.white : AppColors.textSecondary;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: EdgeInsets.fromLTRB(14, 8, dropdown ? 8 : 14, 8),
        decoration: BoxDecoration(
          color: active ? AppColors.primary : AppColors.surface,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: active ? AppColors.primary : AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 180),
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ),
            if (dropdown) Icon(Icons.arrow_drop_down, size: 18, color: fg),
          ],
        ),
      ),
    );
  }
}

/// One choice from a list, in a bottom sheet. Pops the choice, or "" for
/// [anyLabel] when given.
class ChoiceSheet extends StatelessWidget {
  const ChoiceSheet({
    super.key,
    required this.title,
    required this.choices,
    required this.selected,
    this.anyLabel,
    this.colorOf,
    this.onPicked,
  });

  final String title;
  final List<String> choices;
  final String selected;

  /// When set, a first entry that clears the choice - a filter's "Any".
  final String? anyLabel;

  /// Paints each choice as its chip would be, for the status columns.
  final Color? Function(String value)? colorOf;

  /// What a tap does instead of popping the choice - the detail saves it
  /// before the sheet closes.
  final ValueChanged<String>? onPicked;

  @override
  Widget build(BuildContext context) {
    Widget tile(String value, String label) {
      final color = value.isEmpty ? null : colorOf?.call(value);
      return ListTile(
        dense: true,
        title: color == null
            ? Text(label)
            : Align(alignment: Alignment.centerLeft, child: SheetChip(label, color: color)),
        trailing: value == selected ? const Icon(Icons.check, color: AppColors.primary) : null,
        onTap: () => onPicked != null ? onPicked!(value) : Navigator.of(context).pop(value),
      );
    }

    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.7),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(title, style: Theme.of(context).textTheme.titleMedium),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                primary: false,
                children: [
                  if (anyLabel != null) tile('', anyLabel!),
                  for (final choice in choices) tile(choice, choice),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One row of the sheet as a card: when, where and what first, then who
/// asked, then where it stands. Green once it is in, as the sheet colours it.
class _RowCard extends StatelessWidget {
  const _RowCard({required this.row, required this.onOpen, this.onHold});

  final PurchaseRequest row;
  final VoidCallback onOpen;

  /// Edit and Delete, when the row allows either.
  final VoidCallback? onHold;

  @override
  Widget build(BuildContext context) {
    const muted = TextStyle(fontSize: 12, color: AppColors.textSecondary);

    return AppCard(
      onTap: onOpen,
      onLongPress: onHold,
      color: row.done ? sheetDoneFill : null,
      borderColor: row.done ? sheetDoneGreen : null,
      padding: const EdgeInsets.fromLTRB(12, 12, 14, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          WorkThumb(
            icon: row.type == 'Repair Request'
                ? Icons.handyman_outlined
                : Icons.shopping_bag_outlined,
            color: row.done ? AppColors.success : AppColors.primary,
          ),
          const SizedBox(width: 12),
          Expanded(child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                row.date == null ? '—' : formatDate(row.date),
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textStrong),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  row.company.isEmpty ? '—' : row.company,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: muted,
                ),
              ),
              const SizedBox(width: 8),
              SoftChip(row.type == 'Repair Request' ? 'Repair' : 'Purchase'),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            row.description.isEmpty ? '(no description)' : row.description,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              const Icon(Icons.person_outline, size: 14, color: AppColors.textMuted),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  row.raisedByName.isEmpty ? '—' : row.raisedByName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: muted,
                ),
              ),
              if (row.imageCount > 0) ...[
                const Icon(Icons.image_outlined, size: 14, color: AppColors.textMuted),
                const SizedBox(width: 2),
                Text('${row.imageCount}', style: muted),
              ],
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              if (row.priority.isNotEmpty) SheetChip.priority(row.priority),
              SheetChip.approval(row.approvalStatus),
              SheetChip.purchase(row.purchaseStatus),
            ],
          ),
          if (row.receivedOn != null || row.expectedOn != null) ...[
            const SizedBox(height: 8),
            Text(
              row.receivedOn != null
                  ? 'Received ${formatDate(row.receivedOn)}'
                  : 'Expected ${formatDate(row.expectedOn)}',
              style: muted,
            ),
          ],
        ],
      )),
        ],
      ),
    );
  }
}

/// The sheet itself, scrolling sideways: the "Purchase" tab's columns in its
/// order, a finished row in its green. Tapping a row opens it; holding it
/// offers Edit and Delete, as a card does.
class _SheetGrid extends StatelessWidget {
  const _SheetGrid({required this.rows, required this.onOpen, required this.onHold});

  final List<PurchaseRequest> rows;
  final ValueChanged<PurchaseRequest> onOpen;
  final VoidCallback? Function(PurchaseRequest row) onHold;

  static const _widths = <String, double>{
    'date': 92,
    'type': 120,
    'company': 160,
    'raisedByName': 120,
    'description': 240,
    'purpose': 200,
    imageSamplesColumn: 80,
    'links': 180,
    'priority': 100,
    'approvalStatus': 170,
    'purchaseStatus': 170,
    'expectedOn': 110,
    'receivedOn': 110,
    'remarks': 200,
  };

  Widget _cell(String column, Widget child, {Color? fill}) => Container(
        width: _widths[column] ?? 120,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        decoration: BoxDecoration(
          color: fill,
          border: const Border(
            right: BorderSide(color: AppColors.border),
            bottom: BorderSide(color: AppColors.border),
          ),
        ),
        child: child,
      );

  Widget _value(PurchaseRequest row, String column) {
    final text = row.textOf(column);
    final color = SheetColors.of(column, text);
    if (color != null && text.isNotEmpty) {
      return Align(alignment: Alignment.centerLeft, child: SheetChip(text, color: color));
    }
    return Text(
      text,
      maxLines: 3,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(fontSize: 12, color: AppColors.textBody),
    );
  }

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.borderStrong),
          borderRadius: BorderRadius.circular(8),
        ),
        clipBehavior: Clip.antiAlias,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final column in sheetColumns)
                      _cell(
                        column.key,
                        Text(
                          column.label,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textStrong,
                          ),
                        ),
                        fill: AppColors.surfaceMuted,
                      ),
                  ],
                ),
              ),
              for (final row in rows)
                InkWell(
                  onTap: () => onOpen(row),
                  onLongPress: onHold(row),
                  child: IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final column in sheetColumns)
                          _cell(
                            column.key,
                            _value(row, column.key),
                            fill: row.done ? sheetDoneGreen : AppColors.surface,
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
}

/// Adding a row to the sheet: the columns whoever asks fills in. Approval and
/// purchase status start at Pending and Not Ordered on the server, and the
/// rest is the purchase manager's.
class NewPurchaseRequestSheet extends StatefulWidget {
  const NewPurchaseRequestSheet({
    super.key,
    required this.repo,
    required this.options,
    this.raisedByName = '',
  });

  final PurchasingRepository repo;
  final PurchaseSheetOptions options;

  /// The signed-in person's name, to start "Raised By" with. They may be
  /// writing it up for someone else, so it can be changed.
  final String raisedByName;

  @override
  State<NewPurchaseRequestSheet> createState() => _NewPurchaseRequestSheetState();
}

class _NewPurchaseRequestSheetState extends State<NewPurchaseRequestSheet> {
  late final _raisedBy = TextEditingController(text: widget.raisedByName);
  final _description = TextEditingController();
  final _purpose = TextEditingController();
  final _links = TextEditingController();

  DateTime _date = DateTime.now();
  late String _type = widget.options.types.first;
  // Filled in when there is only one to choose - a plant head's own company.
  late String _company = widget.options.companies.length == 1 ? widget.options.companies.first : '';
  late String _priority =
      widget.options.priorities.contains('High') ? 'High' : widget.options.priorities.first;

  /// Held until the row exists: an image attaches *to* a row.
  PickedPhoto? _photo;
  bool _saving = false;
  String _problem = '';

  @override
  void dispose() {
    _raisedBy.dispose();
    _description.dispose();
    _purpose.dispose();
    _links.dispose();
    super.dispose();
  }

  Future<void> _addPhoto() async {
    FocusScope.of(context).unfocus();
    final source = await askPhotoSource(context);
    if (source == null) return;
    try {
      final photo = await pickPhoto(source);
      if (photo != null && mounted) {
        setState(() {
          _photo = photo;
          _problem = '';
        });
      }
    } on PhotoProblem catch (e) {
      if (mounted) setState(() => _problem = e.message);
    }
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    // The obvious gaps, said before the round trip. The server checks again.
    final gap = _company.isEmpty
        ? 'Choose the company it is for.'
        : _description.text.trim().isEmpty
            ? 'Say what is needed.'
            : '';
    if (gap.isNotEmpty) {
      setState(() => _problem = gap);
      return;
    }

    setState(() {
      _saving = true;
      _problem = '';
    });
    try {
      final made = await widget.repo.add(
        date: apiDay(_date),
        type: _type,
        company: _company,
        raisedByName: _raisedBy.text.trim(),
        description: _description.text.trim(),
        purpose: _purpose.text.trim(),
        links: _links.text.trim(),
        priority: _priority,
      );

      // A failed image does not undo the row - the request is on the sheet
      // either way - but it is said, so nobody assumes it went up.
      final photo = _photo;
      if (photo != null) {
        try {
          await widget.repo.attachImage(
            made.id,
            fileName: photo.name,
            contentType: photo.contentType,
            dataBase64: base64Encode(photo.bytes),
          );
        } on ApiException catch (e) {
          Toast.show('Added, but the photo failed: ${e.message}', ToastType.error);
        }
      }

      if (mounted) Navigator.of(context).pop(made);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  InputDecoration _box([String? hint]) => InputDecoration(
        border: const OutlineInputBorder(),
        isDense: true,
        counterText: '',
        hintText: hint,
      );

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    final options = widget.options;

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
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('New purchase request', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            const Text(
              'A new line on Miscellaneous Purchases.',
              style: TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
            const SizedBox(height: 16),
            const LvFieldLabel('Date'),
            LvDateField(
              value: _date,
              // The server refuses a date in the future.
              firstDate: today.subtract(const Duration(days: 365)),
              lastDate: today,
              onChanged: (d) => setState(() => _date = d ?? today),
            ),
            const SizedBox(height: 12),
            const LvFieldLabel('Type of Request'),
            FilterTabs(
              options: options.types,
              selected: _type,
              onChanged: (v) => setState(() => _type = v),
            ),
            const SizedBox(height: 12),
            const LvFieldLabel('Company'),
            DropdownShell(
              child: AppDropdown<String>(
                value: _company,
                items: ['', ...options.companies],
                labelBuilder: (c) => c.isEmpty ? 'Choose…' : c,
                onChanged: (v) => setState(() => _company = v ?? ''),
              ),
            ),
            const SizedBox(height: 12),
            const LvFieldLabel('Raised By'),
            TextField(controller: _raisedBy, maxLength: 60, decoration: _box()),
            const SizedBox(height: 12),
            const LvFieldLabel('Description'),
            TextField(
              controller: _description,
              minLines: 2,
              // Room for a list of 10-15 items before it scrolls.
              maxLines: 12,
              keyboardType: TextInputType.multiline,
              maxLength: 1000,
              decoration: _box('What is needed - one item a line'),
            ),
            const SizedBox(height: 12),
            const LvFieldLabel('Purpose of Purchase/Repair'),
            TextField(controller: _purpose, minLines: 1, maxLines: 4, maxLength: 1000, decoration: _box()),
            const SizedBox(height: 12),
            const LvFieldLabel('Links/Brands or vendor contact'),
            TextField(
              controller: _links,
              minLines: 1,
              maxLines: 4,
              maxLength: 1000,
              decoration: _box('A link, a brand, or who sells it'),
            ),
            const SizedBox(height: 12),
            const LvFieldLabel('Priority'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final p in options.priorities)
                  ChoiceChip(
                    label: Text(p),
                    selected: _priority == p,
                    selectedColor: SheetColors.priority(p).withValues(alpha: 0.18),
                    labelStyle: TextStyle(
                      color: _priority == p ? SheetColors.priority(p) : AppColors.textSecondary,
                      fontWeight: FontWeight.w600,
                      fontSize: 12,
                    ),
                    onSelected: (_) => setState(() => _priority = p),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            const LvFieldLabel('Image sample (optional)'),
            if (_photo == null)
              OutlinedButton.icon(
                icon: const Icon(Icons.add_a_photo_outlined, size: 18),
                label: const Text('Add a photo'),
                onPressed: _saving ? null : _addPhoto,
              )
            else
              Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.memory(_photo!.bytes, width: 64, height: 64, fit: BoxFit.cover),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _photo!.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Remove',
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: _saving ? null : () => setState(() => _photo = null),
                  ),
                ],
              ),
            if (_problem.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(_problem, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
            ],
            const SizedBox(height: 18),
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
                    onPressed: _saving ? null : _submit,
                    child: Text(_saving ? 'Adding…' : 'Add to sheet'),
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

/// Changing a whole row at once: every column in the sheet's order, filled in
/// as it stands. A column this person may not change - not in the row's
/// `editable` - is shown with a lock and cannot be touched. Save sends one
/// `PUT` of just the columns that changed. Pops the updated row.
///
/// The images are listed but not changed here: they go up and come off one at
/// a time on the request itself.
class EditPurchaseRequestSheet extends StatefulWidget {
  const EditPurchaseRequestSheet({
    super.key,
    required this.repo,
    required this.row,
    required this.options,
  });

  final PurchasingRepository repo;
  final PurchaseRequest row;
  final PurchaseSheetOptions options;

  @override
  State<EditPurchaseRequestSheet> createState() => _EditPurchaseRequestSheetState();
}

class _EditPurchaseRequestSheetState extends State<EditPurchaseRequestSheet> {
  late final Map<String, TextEditingController> _texts = {
    for (final c in sheetColumns)
      if (c.kind == SheetColumnKind.text && c.key != imageSamplesColumn)
        c.key: TextEditingController(text: widget.row.textOf(c.key)),
  };
  late final Map<String, String> _picks = {
    for (final c in sheetColumns)
      if (c.kind == SheetColumnKind.pick) c.key: widget.row.textOf(c.key),
  };
  late final Map<String, DateTime?> _days = {
    for (final c in sheetColumns)
      if (c.kind == SheetColumnKind.date) c.key: widget.row.dayOf(c.key),
  };
  bool _saving = false;
  String _problem = '';

  @override
  void dispose() {
    for (final c in _texts.values) {
      c.dispose();
    }
    super.dispose();
  }

  static String _day(DateTime? d) => d == null ? '' : apiDay(d);

  /// A column's value as the form has it now, in the form the API takes it.
  String _now(SheetColumn c) => switch (c.kind) {
        SheetColumnKind.pick => _picks[c.key] ?? '',
        SheetColumnKind.date => _day(_days[c.key]),
        SheetColumnKind.text => _texts[c.key]?.text.trim() ?? '',
      };

  /// The same, as the row came.
  String _was(SheetColumn c) => switch (c.kind) {
        SheetColumnKind.date => _day(widget.row.dayOf(c.key)),
        // Trimmed, so a stray space already in the sheet is not taken for a
        // change.
        _ => widget.row.textOf(c.key).trim(),
      };

  /// The columns that differ from the row as it came, by key. Only ones this
  /// person may change can differ - the rest are locked.
  Map<String, String> get _changes => {
        for (final c in sheetColumns)
          if (c.key != imageSamplesColumn && widget.row.canEdit(c.key) && _now(c) != _was(c)) c.key: _now(c),
      };

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    final changes = _changes;
    if (changes.isEmpty) return;
    setState(() {
      _saving = true;
      _problem = '';
    });
    try {
      final updated = await widget.repo.update(widget.row.id, changes);
      if (mounted) Navigator.of(context).pop(updated);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(SheetColumn column) {
    final row = widget.row;
    if (column.key == imageSamplesColumn) {
      return _LockedValue(row.textOf(column.key), note: 'Added and removed on the request itself.');
    }
    if (!row.canEdit(column.key)) return _LockedValue(row.textOf(column.key));

    switch (column.kind) {
      case SheetColumnKind.pick:
        final current = _picks[column.key] ?? '';
        final choices = widget.options.choicesFor(column.key);
        return DropdownShell(
          child: AppDropdown<String>(
            value: current,
            // What the row holds stays in the list even when the server's
            // options no longer have it - an old value, or a blank priority.
            items: [if (!choices.contains(current)) current, ...choices],
            labelBuilder: (v) => v.isEmpty ? '—' : v,
            onChanged: (v) {
              if (!_saving && v != null) setState(() => _picks[column.key] = v);
            },
          ),
        );
      case SheetColumnKind.date:
        final today = DateTime.now();
        return LvDateField(
          value: _days[column.key],
          firstDate: today.subtract(const Duration(days: 365 * 3)),
          // The request's own date is never in the future; when it is
          // expected may well be.
          lastDate: column.key == 'expectedOn' ? today.add(const Duration(days: 365 * 2)) : today,
          clearable: column.clearable,
          placeholder: 'No date',
          onChanged: (d) {
            if (!_saving) setState(() => _days[column.key] = d);
          },
        );
      case SheetColumnKind.text:
        return TextField(
          controller: _texts[column.key],
          enabled: !_saving,
          minLines: column.multiline ? 2 : 1,
          maxLines: column.multiline ? 6 : 1,
          maxLength: column.key == 'raisedByName' ? 60 : 1000,
          decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true, counterText: ''),
          onChanged: (_) => setState(() {}),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final row = widget.row;
    final changed = _changes.length;
    final anyLocked = sheetColumns.any((c) => c.key != imageSamplesColumn && !row.canEdit(c.key));

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
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Edit request', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(
              anyLocked ? '${row.id} · the columns with a lock are not yours to change.' : row.id,
              style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
            const SizedBox(height: 16),
            for (final column in sheetColumns) ...[
              LvFieldLabel(column.label),
              _field(column),
              const SizedBox(height: 12),
            ],
            if (_problem.isNotEmpty) ...[
              Text(_problem, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
              const SizedBox(height: 12),
            ],
            const SizedBox(height: 6),
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
                    onPressed: _saving || changed == 0 ? null : _save,
                    child: Text(
                      _saving
                          ? 'Saving…'
                          : changed == 0
                              ? 'No changes'
                              : changed == 1
                                  ? 'Save 1 change'
                                  : 'Save $changed changes',
                    ),
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

/// A column shown but not changeable here: the value in a muted box, with a
/// lock.
class _LockedValue extends StatelessWidget {
  const _LockedValue(this.text, {this.note});

  final String text;

  /// Where it is changed instead, when that is somewhere else.
  final String? note;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.surfaceMuted,
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    text.isEmpty ? '—' : text,
                    style: TextStyle(
                      fontSize: 13,
                      color: text.isEmpty ? AppColors.textFaint : AppColors.textSecondary,
                    ),
                  ),
                  if (note != null) ...[
                    const SizedBox(height: 2),
                    Text(note!, style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.lock_outline, size: 14, color: AppColors.textFaint),
          ],
        ),
      );
}
