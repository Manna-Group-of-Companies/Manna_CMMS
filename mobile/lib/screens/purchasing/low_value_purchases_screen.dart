import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/purchasing_repository.dart';
import '../../models/maintenance.dart' show PlantOption;
import '../../models/purchasing.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';
import 'low_value_widgets.dart';

/// Used until `/low-value-purchases/options` answers, so the filter is never
/// empty on a slow connection. The server's own list replaces it.
const _fallbackStatuses = ['Requested', 'Ordered', 'Received', 'Rejected', 'Withdrawn'];

/// Low value purchase requests: small buys made locally, kept in ERPNext and
/// never sent to SAP.
///
/// Every manager and the plant heads raise them from here; the purchase manager
/// works the same list as their queue. Newest first, as the server sends them -
/// the filter is how the purchase manager narrows it to what is still to buy.
class LowValuePurchasesScreen extends StatefulWidget {
  const LowValuePurchasesScreen({super.key});

  @override
  State<LowValuePurchasesScreen> createState() => _LowValuePurchasesScreenState();
}

class _LowValuePurchasesScreenState extends State<LowValuePurchasesScreen> {
  late final PurchasingRepository _repo = PurchasingRepository(context.read<ApiClient>());

  List<LowValuePurchase> _rows = const [];
  LowValueOptions? _options;
  String _status = '';
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
    _loadOptions();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final rows = await _repo.lowValuePurchases(status: _status);
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

  /// Quietly: the list works without it, and the raise sheet asks again.
  Future<void> _loadOptions() async {
    try {
      final options = await _repo.lowValueOptions();
      if (mounted) setState(() => _options = options);
    } on ApiException catch (e) {
      debugPrint('Low value options: ${e.message}');
    }
  }

  Future<void> _raise() async {
    final made = await showModalBottomSheet<LowValuePurchase>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => RaiseLowValueSheet(repo: _repo, options: _options),
    );
    if (made == null) return;
    Toast.success('Raised ${made.id}');
    _load();
  }

  void _filter(String status) {
    if (status == _status) return;
    setState(() => _status = status);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final toBuy = _rows.where((r) => r.status == 'Requested').length;
    final onOrder = _rows.where((r) => r.status == 'Ordered').length;
    final statuses = _options?.statuses.isNotEmpty == true ? _options!.statuses : _fallbackStatuses;

    return AppShell(
      title: 'Low Value Purchases',
      // Everyone with the screen raises one; the server narrows a plant head to
      // their own plants when the form loads.
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _raise,
        icon: const Icon(Icons.add),
        label: const Text('Raise'),
      ),
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          children: [
            Row(
              children: [
                Expanded(
                  child: MetricCard(
                    title: 'To buy',
                    value: toBuy,
                    icon: Icons.shopping_cart_outlined,
                    accent: toBuy > 0 ? AppColors.warning : AppColors.textMuted,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: MetricCard(
                    title: 'On order',
                    value: onOrder,
                    icon: Icons.local_shipping_outlined,
                    accent: onOrder > 0 ? AppColors.info : AppColors.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            _StatusChips(
              options: ['', ...statuses],
              selected: _status,
              onChanged: _filter,
            ),
            const SizedBox(height: 12),
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 40),
                child: LoadingView(message: 'Loading purchase requests…'),
              )
            else if (_error.isNotEmpty)
              EmptyState(
                title: 'Could not load purchase requests',
                message: _error,
                icon: Icons.error_outline,
                iconColor: AppColors.danger,
              )
            else if (_rows.isEmpty)
              EmptyState(
                title: 'Nothing here',
                message: _status.isEmpty
                    ? 'No low value purchase requests yet. Raise one with the button below.'
                    : 'No requests are ${_status.toLowerCase()}.',
                icon: Icons.inbox_outlined,
              )
            else
              for (final row in _rows) ...[
                _LowValueTile(row: row, onOpen: () => _open(row)),
                const SizedBox(height: 10),
              ],
          ],
        ),
      ),
    );
  }

  Future<void> _open(LowValuePurchase row) async {
    final changed = await context.push<bool>('/purchases/low-value/${row.id}');
    if (changed == true) _load();
  }
}

/// The status filter. Five statuses and "All" do not fit [FilterTabs] on a
/// phone, so they scroll sideways in the same colours instead.
class _StatusChips extends StatelessWidget {
  const _StatusChips({required this.options, required this.selected, required this.onChanged});

  /// An empty string is "All".
  final List<String> options;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final option in options) ...[
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => onChanged(option),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: selected == option ? AppColors.primary : AppColors.surfaceMuted,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: selected == option ? AppColors.primary : AppColors.border,
                    ),
                  ),
                  child: Text(
                    option.isEmpty ? 'All' : option,
                    style: TextStyle(
                      color: selected == option ? Colors.white : AppColors.textSecondary,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
            ],
          ],
        ),
      );
}

class _LowValueTile extends StatelessWidget {
  const _LowValueTile({required this.row, required this.onOpen});

  final LowValuePurchase row;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final items = row.lines.length;
    final names = row.lines.map((l) => l.description).where((d) => d.isNotEmpty).toList();

    return AppCard(
      onTap: onOpen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  row.purpose,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                ),
              ),
              const SizedBox(width: 8),
              LowValueStatusBadge(row.status),
            ],
          ),
          const SizedBox(height: 2),
          MonoText(row.id),
          if (names.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              names.length > 2
                  ? '${names.take(2).join(', ')} +${names.length - 2} more'
                  : names.join(', '),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, color: AppColors.textBody),
            ),
          ],
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              SoftChip(row.plant),
              SoftChip(items == 1 ? '1 item' : '$items items'),
              if (row.requiredBy != null) SoftChip('Needed by ${formatDate(row.requiredBy)}'),
              if (row.isUrgent) const AppBadge('urgent', color: AppColors.danger),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Estimated ${formatCurrency(row.estTotal)}',
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                ),
              ),
              if (row.hasActual)
                Text(
                  'Paid ${formatCurrency(row.total)}',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textStrong,
                  ),
                ),
            ],
          ),
          if (row.waitingOn.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Waiting on: ${row.waitingOn}',
              style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
          ],
        ],
      ),
    );
  }
}

/// One item being typed into the raise form.
class _DraftLine {
  final description = TextEditingController();
  final specification = TextEditingController();
  final qty = TextEditingController(text: '1');
  final unit = TextEditingController();
  final rate = TextEditingController();

  /// Rows are added and removed in the middle, so each keeps its own key
  /// rather than its position - otherwise removing item 2 leaves item 3's
  /// text in item 2's boxes.
  final key = UniqueKey();

  double get qtyValue => double.tryParse(qty.text.trim()) ?? 0;
  double get rateValue => double.tryParse(rate.text.trim()) ?? 0;
  double get amount => qtyValue * rateValue;

  /// Nothing typed but the defaults - an "add item" tapped and then left.
  bool get isBlank =>
      description.text.trim().isEmpty &&
      specification.text.trim().isEmpty &&
      rate.text.trim().isEmpty;

  void dispose() {
    description.dispose();
    specification.dispose();
    qty.dispose();
    unit.dispose();
    rate.dispose();
  }
}

/// Raising a low value purchase request.
///
/// The plant is filled in for anyone who may raise for only one - the server
/// narrows the list, so one entry means there is nothing to choose.
class RaiseLowValueSheet extends StatefulWidget {
  const RaiseLowValueSheet({super.key, required this.repo, this.options});

  final PurchasingRepository repo;

  /// Passed in when the list already has them, to save asking again.
  final LowValueOptions? options;

  @override
  State<RaiseLowValueSheet> createState() => _RaiseLowValueSheetState();
}

class _RaiseLowValueSheetState extends State<RaiseLowValueSheet> {
  final _department = TextEditingController();
  final _purpose = TextEditingController();
  final List<_DraftLine> _lines = [];

  List<String> _units = const [];
  List<PlantOption> _plants = const [];
  int _maxLines = 30;
  String _plant = '';
  String _urgency = 'Normal';
  DateTime? _requiredBy;
  bool _loading = true;
  bool _saving = false;
  String _problem = '';

  @override
  void initState() {
    super.initState();
    _lines.add(_newLine());
    final given = widget.options;
    if (given != null) {
      _apply(given);
      _loading = false;
    } else {
      _loadOptions();
    }
  }

  _DraftLine _newLine() {
    final line = _DraftLine();
    if (_units.isNotEmpty) line.unit.text = _units.first;
    return line;
  }

  void _apply(LowValueOptions options) {
    _units = options.units;
    _plants = options.plants;
    _maxLines = options.maxLines;
    if (_plants.length == 1) _plant = _plants.first.name;
    for (final line in _lines) {
      if (line.unit.text.isEmpty && _units.isNotEmpty) line.unit.text = _units.first;
    }
  }

  Future<void> _loadOptions() async {
    try {
      final options = await widget.repo.lowValueOptions();
      if (!mounted) return;
      setState(() => _apply(options));
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _department.dispose();
    _purpose.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  double get _total => _lines.fold<double>(0, (sum, l) => sum + l.amount);

  void _addLine() => setState(() => _lines.add(_newLine()));

  void _removeLine(_DraftLine line) {
    setState(() => _lines.remove(line));
    line.dispose();
  }

  /// The obvious gaps, said before the round trip. The server checks all of
  /// it again, and its wording is the same.
  String? _check(List<_DraftLine> lines) {
    if (_plant.isEmpty) return 'Choose the plant it is for.';
    if (_requiredBy == null) return 'Say by when it is needed.';
    if (_purpose.text.trim().isEmpty) return 'Say what it is for.';
    if (lines.isEmpty) return 'Add at least one item.';
    for (var i = 0; i < lines.length; i++) {
      final line = lines[i];
      if (line.description.text.trim().isEmpty) return 'Item ${i + 1}: say what is needed.';
      if (line.qtyValue <= 0) return 'Item ${i + 1}: the quantity must be more than zero.';
      if (line.unit.text.trim().isEmpty) return 'Item ${i + 1}: give the unit.';
    }
    return null;
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    final lines = _lines.where((l) => !l.isBlank).toList();

    final problem = _check(lines);
    if (problem != null) {
      setState(() => _problem = problem);
      return;
    }

    setState(() {
      _saving = true;
      _problem = '';
    });
    try {
      final made = await widget.repo.raiseLowValue(
        plant: _plant,
        department: _department.text.trim(),
        urgency: _urgency,
        requiredBy: apiDay(_requiredBy!),
        purpose: _purpose.text.trim(),
        lines: [
          for (final line in lines)
            {
              'description': line.description.text.trim(),
              'specification': line.specification.text.trim(),
              'qty': line.qtyValue,
              'unit': line.unit.text.trim(),
              // Blank is allowed: the server reads it as no estimate.
              'estRate': line.rate.text.trim().isEmpty ? '' : line.rateValue,
              'remarks': '',
            },
        ],
      );
      if (mounted) Navigator.of(context).pop(made);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();

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
            Text('Raise a low value purchase', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            const Text(
              'Bought locally by the purchase manager. Not sent to SAP.',
              style: TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
            const SizedBox(height: 16),
            if (_loading)
              const LoadingView(message: 'Loading…')
            else ...[
              const LvFieldLabel('Plant'),
              if (_plants.length == 1)
                Text(_plant, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600))
              else if (_plants.isEmpty)
                const Text(
                  'There is no plant you may buy for.',
                  style: TextStyle(fontSize: 13, color: AppColors.danger),
                )
              else
                AppDropdown<String>(
                  value: _plant,
                  items: ['', ..._plants.map((p) => p.name)],
                  labelBuilder: (p) => p.isEmpty ? 'Choose…' : p,
                  onChanged: (v) => setState(() => _plant = v ?? ''),
                ),
              const SizedBox(height: 12),
              const LvFieldLabel('Department'),
              TextField(
                controller: _department,
                maxLength: 60,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  isDense: true,
                  counterText: '',
                  hintText: 'e.g. Maintenance, Mixing',
                ),
              ),
              const SizedBox(height: 12),
              const LvFieldLabel('How urgent'),
              FilterTabs(
                options: const ['Normal', 'Urgent'],
                selected: _urgency,
                onChanged: (v) => setState(() => _urgency = v),
              ),
              const SizedBox(height: 12),
              const LvFieldLabel('Needed by'),
              LvDateField(
                value: _requiredBy,
                firstDate: DateTime(today.year, today.month, today.day),
                lastDate: today.add(const Duration(days: 365)),
                onChanged: (d) => setState(() => _requiredBy = d),
              ),
              const SizedBox(height: 12),
              const LvFieldLabel('What is it for'),
              TextField(
                controller: _purpose,
                maxLines: 3,
                maxLength: 500,
                decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
              ),
              const SizedBox(height: 6),
              Text(
                'Items (${_lines.length} of $_maxLines)',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              for (var i = 0; i < _lines.length; i++) ...[
                _DraftLineCard(
                  key: _lines[i].key,
                  number: i + 1,
                  line: _lines[i],
                  units: _units,
                  onChanged: () => setState(() {}),
                  onRemove: _lines.length > 1 ? () => _removeLine(_lines[i]) : null,
                ),
                const SizedBox(height: 10),
              ],
              if (_lines.length < _maxLines)
                TextButton.icon(
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Add an item'),
                  onPressed: _addLine,
                ),
              const SizedBox(height: 8),
              LvTotalRow(label: 'Estimated total', amount: _total, strong: true),
            ],
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
                    onPressed: _saving || _loading || _plants.isEmpty ? null : _submit,
                    child: Text(_saving ? 'Raising…' : 'Raise it'),
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

class _DraftLineCard extends StatelessWidget {
  const _DraftLineCard({
    super.key,
    required this.number,
    required this.line,
    required this.units,
    required this.onChanged,
    required this.onRemove,
  });

  final int number;
  final _DraftLine line;
  final List<String> units;
  final VoidCallback onChanged;

  /// Null on the last item left, which cannot be removed.
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) => AppCard(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Item $number',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                ),
                if (onRemove != null)
                  IconButton(
                    tooltip: 'Remove',
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: onRemove,
                  ),
              ],
            ),
            const SizedBox(height: 4),
            TextField(
              controller: line.description,
              maxLength: 140,
              decoration: const InputDecoration(
                labelText: 'What is needed',
                border: OutlineInputBorder(),
                isDense: true,
                counterText: '',
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: line.specification,
              maxLength: 140,
              decoration: const InputDecoration(
                labelText: 'Specification (size, make, model)',
                border: OutlineInputBorder(),
                isDense: true,
                counterText: '',
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: line.qty,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    onChanged: (_) => onChanged(),
                    decoration: const InputDecoration(
                      labelText: 'Qty',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 3,
                  // Typed or picked: the list covers most buys, but a
                  // "Bundle" or "Tin" should not need a release to raise.
                  child: TextField(
                    controller: line.unit,
                    maxLength: 20,
                    decoration: InputDecoration(
                      labelText: 'Unit',
                      border: const OutlineInputBorder(),
                      isDense: true,
                      counterText: '',
                      suffixIcon: units.isEmpty
                          ? null
                          : PopupMenuButton<String>(
                              tooltip: 'Pick a unit',
                              icon: const Icon(Icons.arrow_drop_down),
                              onSelected: (u) {
                                line.unit.text = u;
                                onChanged();
                              },
                              itemBuilder: (_) => [
                                for (final u in units) PopupMenuItem(value: u, child: Text(u)),
                              ],
                            ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: line.rate,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    onChanged: (_) => onChanged(),
                    decoration: const InputDecoration(
                      labelText: 'Est. rate ₹',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            if (line.amount > 0) ...[
              const SizedBox(height: 6),
              Align(
                alignment: Alignment.centerRight,
                child: Text(
                  formatCurrency(line.amount),
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                ),
              ),
            ],
          ],
        ),
      );
}
