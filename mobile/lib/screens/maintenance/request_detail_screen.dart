import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../data/maintenance_repository.dart';
import '../../models/maintenance.dart';
import '../../state/auth_provider.dart';
import '../../widgets/common.dart';
import 'stage_form.dart';

/// One maintenance request, and whatever step it is sitting on.
///
/// The same arrangement as the breakdown screen: the server says which roles
/// may take each step, and that decides whether the form is drawn. Withdrawing
/// is the requester's own; rejecting is maintenance's, and the server sorts out
/// which of the two this person is being offered.
class RequestDetailScreen extends StatefulWidget {
  const RequestDetailScreen({super.key, required this.id});

  final String id;

  @override
  State<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends State<RequestDetailScreen> {
  late final MaintenanceRepository _repo = MaintenanceRepository(context.read<ApiClient>());

  MaintenanceRequest? _record;
  Map<String, WorkStage> _stages = const {};
  bool _loading = true;
  bool _busy = false;
  bool _changed = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final record = await _repo.request(widget.id);
      final stages = _stages.isEmpty ? await _repo.requestStages() : _stages;
      if (!mounted) return;
      setState(() {
        _record = record;
        _stages = stages;
        _error = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<String?> _advance(String action, Map<String, dynamic> fields) async {
    setState(() => _busy = true);
    try {
      final updated = await _repo.advanceRequest(widget.id, action, fields: fields);
      if (!mounted) return null;
      setState(() {
        _record = updated;
        _changed = true;
      });
      await _load();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final role = user?.role;
    final record = _record;

    final next = record == null || record.nextAction.isEmpty ? null : _stages[record.nextAction];
    final mayTakeNext = next != null && next.allows(role);

    // Withdraw is the requester's own; anyone else with the right role rejects.
    final mine = record != null && user != null && user.email == record.requestedBy;
    final endAction = mine ? 'Withdraw' : 'Reject';
    final end = _stages[endAction];
    final mayEnd = record != null &&
        end != null &&
        record.state == end.from &&
        end.allows(role) &&
        (mine || role == 'Manager');

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(record?.title ?? 'Request'),
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
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                    children: [
                      _Summary(record: record!),
                      const SizedBox(height: 12),
                      if (mayTakeNext)
                        StageForm(
                          key: ValueKey(record.nextAction),
                          stage: next,
                          busy: _busy,
                          initial: {'work_done': record.workDone},
                          onSubmit: (fields) => _advance(record.nextAction, fields),
                        )
                      else if (next != null)
                        AppCard(
                          child: Text(
                            'Waiting on maintenance to ${next.title.toLowerCase()}.',
                            style: const TextStyle(color: AppColors.textSecondary),
                          ),
                        ),
                      if (mayEnd) ...[
                        const SizedBox(height: 12),
                        _EndCard(
                          stage: end,
                          busy: _busy,
                          onConfirm: (reason) =>
                              _advance(endAction, {'cancel_reason': reason}),
                        ),
                      ],
                    ],
                  ),
      ),
    );
  }
}

class _Summary extends StatelessWidget {
  const _Summary({required this.record});

  final MaintenanceRequest record;

  @override
  Widget build(BuildContext context) => AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: MonoText(record.id, fontSize: 13)),
                StatusBadge(record.state),
              ],
            ),
            const SizedBox(height: 10),
            Text(record.title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            if (record.whatIsNeeded.isNotEmpty) _Line('What is needed', record.whatIsNeeded),
            if (record.whyNeeded.isNotEmpty) _Line('Why', record.whyNeeded),
            _Line('Plant', record.plant),
            if (record.machineName.isNotEmpty) _Line('Machine', record.machineName),
            if (record.priority.isNotEmpty) _Line('Urgency', record.priority),
            _Line('Raised by', record.requestedBy),
            _Line('Raised', formatDateTime(record.requestedAt)),
            if (record.neededBy != null) _Line('Wanted by', formatDate(record.neededBy)),
            if (record.workDone.isNotEmpty) _Line('Work done', record.workDone),
            if (record.waitingOn.isNotEmpty) _Line('Waiting on', record.waitingOn),
          ],
        ),
      );
}

class _Line extends StatelessWidget {
  const _Line(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 110,
              child: Text(
                label,
                style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
            ),
            Expanded(child: Text(value, style: const TextStyle(fontSize: 13))),
          ],
        ),
      );
}

/// Withdrawing or rejecting, which both want a reason.
///
/// A request that vanishes without one stops people raising them.
class _EndCard extends StatefulWidget {
  const _EndCard({required this.stage, required this.busy, required this.onConfirm});

  final WorkStage stage;
  final bool busy;
  final Future<String?> Function(String reason) onConfirm;

  @override
  State<_EndCard> createState() => _EndCardState();
}

class _EndCardState extends State<_EndCard> {
  final _reason = TextEditingController();
  bool _open = false;
  String _problem = '';

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_open) {
      return OutlinedButton.icon(
        icon: const Icon(Icons.block_outlined, size: 18),
        label: Text(widget.stage.title),
        onPressed: () => setState(() => _open = true),
      );
    }

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.stage.blurb),
          const SizedBox(height: 10),
          TextField(
            controller: _reason,
            maxLines: 2,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              isDense: true,
              labelText: widget.stage.labelFor('cancel_reason'),
            ),
          ),
          if (_problem.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(_problem, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: widget.busy ? null : () => setState(() => _open = false),
                  child: const Text('Keep it'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton(
                  onPressed: widget.busy
                      ? null
                      : () async {
                          if (_reason.text.trim().isEmpty) {
                            setState(() => _problem = 'Say why.');
                            return;
                          }
                          final error = await widget.onConfirm(_reason.text.trim());
                          if (error != null && mounted) setState(() => _problem = error);
                        },
                  child: Text(widget.busy ? 'Saving…' : widget.stage.title),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
