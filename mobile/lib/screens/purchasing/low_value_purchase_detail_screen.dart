import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/purchasing_repository.dart';
import '../../models/purchasing.dart';
import '../../widgets/common.dart';
import 'low_value_widgets.dart';

/// One low value purchase request, laid out the way the paper sheet reads:
/// who asked and for what, the items with their estimate and what was paid,
/// the totals, then the purchase, the receipt or why it was closed.
///
/// The buttons at the foot are exactly the record's `may`. The server works
/// that out per person - the buyer orders and rejects, whoever asked withdraws,
/// the people who would see it arrive receive it - so nothing here looks at the
/// role. Unlike breakdowns, the Maintenance Manager is not view-only here:
/// raising and receiving a small buy is theirs to do from the phone.
class LowValuePurchaseDetailScreen extends StatefulWidget {
  const LowValuePurchaseDetailScreen({super.key, required this.id});

  final String id;

  @override
  State<LowValuePurchaseDetailScreen> createState() => _LowValuePurchaseDetailScreenState();
}

class _LowValuePurchaseDetailScreenState extends State<LowValuePurchaseDetailScreen> {
  late final PurchasingRepository _repo = PurchasingRepository(context.read<ApiClient>());

  LowValuePurchase? _record;
  bool _loading = true;
  bool _changed = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final record = await _repo.lowValuePurchase(widget.id);
      if (!mounted) return;
      setState(() {
        _record = record;
        _error = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Opens a step's sheet; the sheet saves and hands back the updated record.
  Future<void> _step(Widget sheet, String done) async {
    final updated = await showModalBottomSheet<LowValuePurchase>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => sheet,
    );
    if (updated == null || !mounted) return;
    setState(() {
      _record = updated;
      _changed = true;
    });
    Toast.success(done);
  }

  @override
  Widget build(BuildContext context) {
    final record = _record;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(record?.id ?? 'Low value purchase'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => Navigator.of(context).pop(_changed),
          ),
        ),
        body: _loading
            ? const LoadingView(message: 'Loading…')
            : _error.isNotEmpty
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
                        _Header(record: record!),
                        const SizedBox(height: 12),
                        _Items(record: record),
                        if (record.order != null) ...[
                          const SizedBox(height: 12),
                          _OrderSection(order: record.order!),
                        ],
                        if (record.received != null) ...[
                          const SizedBox(height: 12),
                          _ReceivedSection(received: record.received!),
                        ],
                        if (record.closed != null) ...[
                          const SizedBox(height: 12),
                          _ClosedSection(status: record.status, closed: record.closed!),
                        ],
                        const SizedBox(height: 12),
                        ..._actions(record),
                      ],
                    ),
                  ),
      ),
    );
  }

  List<Widget> _actions(LowValuePurchase record) {
    final may = record.may;
    if (!may.any) {
      return [
        if (record.waitingOn.isNotEmpty)
          AppCard(
            child: Text(
              'Waiting on: ${record.waitingOn}.',
              style: const TextStyle(color: AppColors.textSecondary),
            ),
          ),
      ];
    }

    return [
      if (may.order) ...[
        FilledButton.icon(
          icon: const Icon(Icons.shopping_cart_checkout, size: 18),
          label: const Text('Record the purchase'),
          onPressed: () => _step(
            _OrderSheet(repo: _repo, record: record),
            'Purchase recorded for ${record.id}',
          ),
        ),
        const SizedBox(height: 10),
      ],
      if (may.receive) ...[
        FilledButton.icon(
          icon: const Icon(Icons.inventory_2_outlined, size: 18),
          label: const Text('Mark received'),
          onPressed: () => _step(
            _ReceiveSheet(repo: _repo, record: record),
            '${record.id} received',
          ),
        ),
        const SizedBox(height: 10),
      ],
      if (may.reject) ...[
        OutlinedButton.icon(
          icon: const Icon(Icons.block_outlined, size: 18),
          label: const Text('Reject'),
          onPressed: () => _step(
            _CloseSheet(repo: _repo, record: record, step: _Close.reject),
            '${record.id} rejected',
          ),
        ),
        const SizedBox(height: 10),
      ],
      if (may.withdraw)
        OutlinedButton.icon(
          icon: const Icon(Icons.undo, size: 18),
          label: const Text('Withdraw'),
          onPressed: () => _step(
            _CloseSheet(repo: _repo, record: record, step: _Close.withdraw),
            '${record.id} withdrawn',
          ),
        ),
    ];
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.record});

  final LowValuePurchase record;

  @override
  Widget build(BuildContext context) => AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: MonoText(record.id, fontSize: 13)),
                if (record.isUrgent) ...[
                  const AppBadge('urgent', color: AppColors.danger),
                  const SizedBox(width: 6),
                ],
                LowValueStatusBadge(record.status),
              ],
            ),
            const SizedBox(height: 10),
            Text(record.purpose, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            LvLine('Plant', record.plant),
            if (record.department.isNotEmpty) LvLine('Department', record.department),
            LvLine('Urgency', record.urgency),
            LvLine('Needed by', formatDate(record.requiredBy)),
            LvLine('Raised by', record.raisedBy),
            LvLine('Raised', formatDateTime(record.raisedAt)),
            if (record.waitingOn.isNotEmpty) LvLine('Waiting on', record.waitingOn),
          ],
        ),
      );
}

/// The item table, as cards - six columns do not fit a phone.
class _Items extends StatelessWidget {
  const _Items({required this.record});

  final LowValuePurchase record;

  @override
  Widget build(BuildContext context) {
    final lines = record.lines;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PanelHeader(
            icon: Icons.list_alt_outlined,
            title: 'Items',
            iconColor: AppColors.primaryDeep,
            subtitle: lines.length == 1 ? '1 item' : '${lines.length} items',
          ),
          const SizedBox(height: 10),
          for (var i = 0; i < lines.length; i++) ...[
            if (i > 0) const Divider(height: 20),
            _ItemRow(line: lines[i], number: i + 1),
          ],
          const Divider(height: 24),
          LvTotalRow(
            label: 'Estimated total',
            amount: record.estTotal,
            strong: !record.hasActual,
          ),
          if (record.hasActual) ...[
            const SizedBox(height: 6),
            LvTotalRow(label: 'Purchased total', amount: record.total, strong: true),
          ],
        ],
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({required this.line, required this.number});

  final LowValueLine line;
  final int number;

  @override
  Widget build(BuildContext context) {
    final qty = '${formatQty(line.qty)} ${line.unit}'.trim();
    const muted = TextStyle(fontSize: 12, color: AppColors.textSecondary);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 22,
              child: Text('$number.', style: const TextStyle(fontSize: 13, color: AppColors.textMuted)),
            ),
            Expanded(
              child: Text(
                line.description,
                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(left: 22, top: 2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (line.specification.isNotEmpty) Text(line.specification, style: muted),
              const SizedBox(height: 4),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      line.estRate > 0
                          ? '$qty × ${formatCurrency(line.estRate)} est.'
                          : '$qty · no estimate',
                      style: muted,
                    ),
                  ),
                  Text(formatCurrency(line.estAmount), style: muted),
                ],
              ),
              if (line.isPriced) ...[
                const SizedBox(height: 2),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '$qty × ${formatCurrency(line.rate)} paid',
                        style: const TextStyle(fontSize: 12, color: AppColors.textBody),
                      ),
                    ),
                    Text(
                      formatCurrency(line.amount),
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textStrong,
                      ),
                    ),
                  ],
                ),
              ],
              if (line.remarks.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(line.remarks, style: muted),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _OrderSection extends StatelessWidget {
  const _OrderSection({required this.order});

  final LowValueOrder order;

  @override
  Widget build(BuildContext context) => AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const PanelHeader(
              icon: Icons.shopping_cart_outlined,
              title: 'Purchase',
              iconColor: AppColors.info,
            ),
            const SizedBox(height: 10),
            LvLine('Vendor', order.vendorName),
            if (order.vendorContact.isNotEmpty) LvLine('Contact', order.vendorContact),
            if (order.expectedOn != null) LvLine('Expected', formatDate(order.expectedOn)),
            if (order.remarks.isNotEmpty) LvLine('Remarks', order.remarks),
            LvLine('Ordered by', order.by),
            LvLine('Ordered', formatDateTime(order.at)),
          ],
        ),
      );
}

class _ReceivedSection extends StatelessWidget {
  const _ReceivedSection({required this.received});

  final LowValueReceipt received;

  @override
  Widget build(BuildContext context) => AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const PanelHeader(
              icon: Icons.inventory_2_outlined,
              title: 'Received',
              iconColor: AppColors.success,
            ),
            const SizedBox(height: 10),
            if (received.billNo.isNotEmpty) LvLine('Bill no.', received.billNo),
            if (received.billDate != null) LvLine('Bill date', formatDate(received.billDate)),
            if (received.remarks.isNotEmpty) LvLine('Remarks', received.remarks),
            LvLine('Received by', received.by),
            LvLine('Received', formatDateTime(received.at)),
          ],
        ),
      );
}

class _ClosedSection extends StatelessWidget {
  const _ClosedSection({required this.status, required this.closed});

  final String status;
  final LowValueClosure closed;

  @override
  Widget build(BuildContext context) => AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            PanelHeader(
              icon: Icons.block_outlined,
              title: status,
              iconColor: LowValueStatusBadge.colorOf(status),
            ),
            const SizedBox(height: 10),
            LvLine('Reason', closed.reason),
            LvLine('By', closed.by),
            LvLine('When', formatDateTime(closed.at)),
          ],
        ),
      );
}

/// The frame every step's sheet shares: a heading, the fields, the problem if
/// there is one, and Cancel beside the step itself.
class _StepSheet extends StatelessWidget {
  const _StepSheet({
    required this.title,
    required this.blurb,
    required this.children,
    required this.problem,
    required this.saving,
    required this.action,
    required this.onSubmit,
  });

  final String title;
  final String blurb;
  final List<Widget> children;
  final String problem;
  final bool saving;
  final String action;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) => Padding(
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
              Text(title, style: Theme.of(context).textTheme.titleLarge),
              if (blurb.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(blurb, style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
              ],
              const SizedBox(height: 16),
              ...children,
              if (problem.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(problem, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
              ],
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: saving ? null : () => Navigator.of(context).pop(),
                      child: const Text('Cancel'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: saving ? null : onSubmit,
                      child: Text(saving ? 'Saving…' : action),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
}

const _box = InputDecoration(border: OutlineInputBorder(), isDense: true);

/// The purchase manager bought it: from whom, and at what rate per item.
///
/// Each rate starts at the estimate, because most small buys cost what was
/// guessed - the buyer only corrects the ones that did not.
class _OrderSheet extends StatefulWidget {
  const _OrderSheet({required this.repo, required this.record});

  final PurchasingRepository repo;
  final LowValuePurchase record;

  @override
  State<_OrderSheet> createState() => _OrderSheetState();
}

class _OrderSheetState extends State<_OrderSheet> {
  final _vendor = TextEditingController();
  final _contact = TextEditingController();
  final _remarks = TextEditingController();
  late final Map<int, TextEditingController> _rates = {
    for (final line in widget.record.lines)
      line.idx: TextEditingController(
        text: line.estRate > 0 ? formatQty(line.estRate) : '',
      ),
  };
  DateTime? _expected;
  bool _saving = false;
  String _problem = '';

  @override
  void dispose() {
    _vendor.dispose();
    _contact.dispose();
    _remarks.dispose();
    for (final c in _rates.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// A blank box keeps the estimate, the same as the server reads it.
  double _rateOf(LowValueLine line) {
    final text = _rates[line.idx]?.text.trim() ?? '';
    if (text.isEmpty) return line.estRate;
    return double.tryParse(text) ?? 0;
  }

  double get _total =>
      widget.record.lines.fold<double>(0, (sum, l) => sum + l.qty * _rateOf(l));

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_vendor.text.trim().isEmpty) {
      setState(() => _problem = 'Say who it is bought from.');
      return;
    }
    final rates = <int, double>{};
    for (final line in widget.record.lines) {
      final rate = _rateOf(line);
      if (rate <= 0) {
        setState(() => _problem = 'Give the rate paid for ${line.description}.');
        return;
      }
      rates[line.idx] = rate;
    }

    setState(() {
      _saving = true;
      _problem = '';
    });
    try {
      final updated = await widget.repo.orderLowValue(
        widget.record.id,
        vendorName: _vendor.text.trim(),
        vendorContact: _contact.text.trim(),
        expectedOn: _expected == null ? '' : apiDay(_expected!),
        remarks: _remarks.text.trim(),
        rates: rates,
      );
      if (mounted) Navigator.of(context).pop(updated);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();

    return _StepSheet(
      title: 'Record the purchase',
      blurb: '${widget.record.id} · ${widget.record.plant}',
      problem: _problem,
      saving: _saving,
      action: 'Save purchase',
      onSubmit: _submit,
      children: [
        const LvFieldLabel('Bought from'),
        TextField(controller: _vendor, maxLength: 140, decoration: _box.copyWith(counterText: '')),
        const SizedBox(height: 12),
        const LvFieldLabel('Vendor contact'),
        TextField(
          controller: _contact,
          maxLength: 60,
          keyboardType: TextInputType.phone,
          decoration: _box.copyWith(counterText: '', hintText: 'Phone or name'),
        ),
        const SizedBox(height: 12),
        const LvFieldLabel('Expected on'),
        LvDateField(
          value: _expected,
          firstDate: DateTime(today.year, today.month, today.day),
          lastDate: today.add(const Duration(days: 365)),
          placeholder: 'Not known',
          clearable: true,
          onChanged: (d) => setState(() => _expected = d),
        ),
        const SizedBox(height: 16),
        Text('Rate paid', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final line in widget.record.lines) ...[
          Row(
            children: [
              Expanded(
                flex: 3,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      line.description,
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                    Text(
                      '${formatQty(line.qty)} ${line.unit} · est. ${formatCurrency(line.estRate)}',
                      style: const TextStyle(fontSize: 11.5, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: TextField(
                  controller: _rates[line.idx],
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  onChanged: (_) => setState(() {}),
                  decoration: _box.copyWith(labelText: 'Rate ₹'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
        ],
        LvTotalRow(label: 'Purchased total', amount: _total, strong: true),
        const SizedBox(height: 12),
        const LvFieldLabel('Remarks'),
        TextField(controller: _remarks, maxLines: 2, maxLength: 500, decoration: _box),
      ],
    );
  }
}

/// It arrived. The bill is optional - a small buy from a counter often has
/// only a slip.
class _ReceiveSheet extends StatefulWidget {
  const _ReceiveSheet({required this.repo, required this.record});

  final PurchasingRepository repo;
  final LowValuePurchase record;

  @override
  State<_ReceiveSheet> createState() => _ReceiveSheetState();
}

class _ReceiveSheetState extends State<_ReceiveSheet> {
  final _billNo = TextEditingController();
  final _remarks = TextEditingController();
  DateTime? _billDate;
  bool _saving = false;
  String _problem = '';

  @override
  void dispose() {
    _billNo.dispose();
    _remarks.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _problem = '';
    });
    try {
      final updated = await widget.repo.receiveLowValue(
        widget.record.id,
        billNo: _billNo.text.trim(),
        billDate: _billDate == null ? '' : apiDay(_billDate!),
        remarks: _remarks.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(updated);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    final vendor = widget.record.order?.vendorName ?? '';

    return _StepSheet(
      title: 'Mark received',
      blurb: vendor.isEmpty ? widget.record.id : '${widget.record.id} · from $vendor',
      problem: _problem,
      saving: _saving,
      action: 'Received',
      onSubmit: _submit,
      children: [
        const LvFieldLabel('Bill number'),
        TextField(controller: _billNo, maxLength: 60, decoration: _box.copyWith(counterText: '')),
        const SizedBox(height: 12),
        const LvFieldLabel('Bill date'),
        LvDateField(
          value: _billDate,
          firstDate: today.subtract(const Duration(days: 365)),
          lastDate: today,
          placeholder: 'No bill',
          clearable: true,
          onChanged: (d) => setState(() => _billDate = d),
        ),
        const SizedBox(height: 12),
        const LvFieldLabel('Remarks'),
        TextField(controller: _remarks, maxLines: 2, maxLength: 500, decoration: _box),
      ],
    );
  }
}

enum _Close { reject, withdraw }

/// Rejecting or withdrawing, which both want a reason - a request that vanishes
/// without one stops people raising them.
class _CloseSheet extends StatefulWidget {
  const _CloseSheet({required this.repo, required this.record, required this.step});

  final PurchasingRepository repo;
  final LowValuePurchase record;
  final _Close step;

  @override
  State<_CloseSheet> createState() => _CloseSheetState();
}

class _CloseSheetState extends State<_CloseSheet> {
  final _reason = TextEditingController();
  bool _saving = false;
  String _problem = '';

  bool get _rejecting => widget.step == _Close.reject;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    final reason = _reason.text.trim();
    if (reason.isEmpty) {
      setState(() => _problem = 'Say why.');
      return;
    }
    setState(() {
      _saving = true;
      _problem = '';
    });
    try {
      final id = widget.record.id;
      final updated = _rejecting
          ? await widget.repo.rejectLowValue(id, reason)
          : await widget.repo.withdrawLowValue(id, reason);
      if (mounted) Navigator.of(context).pop(updated);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => _StepSheet(
        title: _rejecting ? 'Reject this request' : 'Withdraw this request',
        blurb: _rejecting
            ? 'The person who raised it sees the reason.'
            : 'It will not be bought. The purchase manager sees the reason.',
        problem: _problem,
        saving: _saving,
        action: _rejecting ? 'Reject' : 'Withdraw',
        onSubmit: _submit,
        children: [
          const LvFieldLabel('Why'),
          TextField(
            controller: _reason,
            autofocus: true,
            maxLines: 3,
            maxLength: 500,
            decoration: _box,
          ),
        ],
      );
}
