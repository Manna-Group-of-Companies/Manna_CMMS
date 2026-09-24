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

/// One breakdown, and whatever step it is sitting on.
///
/// Which step is offered comes from the server: each stage carries the roles
/// allowed to take it, and the same list decides whether the form is drawn at
/// all. A plant head reports a breakdown and can withdraw it; moving it on is
/// maintenance's, and showing them a button the server will refuse is the bug
/// this avoids.
class BreakdownDetailScreen extends StatefulWidget {
  const BreakdownDetailScreen({super.key, required this.id});

  final String id;

  @override
  State<BreakdownDetailScreen> createState() => _BreakdownDetailScreenState();
}

class _BreakdownDetailScreenState extends State<BreakdownDetailScreen> {
  late final MaintenanceRepository _repo = MaintenanceRepository(context.read<ApiClient>());

  Breakdown? _record;
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
      final record = await _repo.breakdown(widget.id);
      final stages = _stages.isEmpty ? await _repo.breakdownStages() : _stages;
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
      final updated = await _repo.advanceBreakdown(widget.id, action, fields: fields);
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
    final role = context.watch<AuthProvider>().user?.role;
    final record = _record;

    // The step the record is on, and whether this person may take it.
    final next = record == null || record.nextAction.isEmpty ? null : _stages[record.nextAction];
    final mayTakeNext = next != null && next.allows(role);

    // Withdrawing a report that should not have been raised. Only while it is
    // still Reported: once maintenance has started there is something real to
    // account for, and it is closed rather than made to disappear.
    final cancel = _stages['Cancel'];
    final mayCancel =
        record != null && cancel != null && record.state == cancel.from && cancel.allows(role);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(record?.machineName ?? 'Breakdown'),
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
                          initial: {
                            'failure_mode': record.failureMode,
                            'actions_performed': record.actionsPerformed,
                            'root_cause': record.rootCause,
                            'repeat_failure': record.repeatFailure,
                          },
                          onSubmit: (fields) => _advance(record.nextAction, fields),
                        )
                      else if (next != null)
                        // Not a blank space: without this the record simply
                        // stops and reads as though nothing is due.
                        AppCard(
                          child: Text(
                            'Waiting on maintenance to ${next.title.toLowerCase()}.',
                            style: const TextStyle(color: AppColors.textSecondary),
                          ),
                        ),
                      if (mayCancel) ...[
                        const SizedBox(height: 12),
                        _CancelCard(
                          stage: cancel,
                          busy: _busy,
                          onConfirm: () => _advance('Cancel', const {}),
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

  final Breakdown record;

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
            Text(
              record.whatHappened,
              style: const TextStyle(fontSize: 14, color: AppColors.textBody),
            ),
            const SizedBox(height: 12),
            _Line('Machine', '${record.machineName} — ${record.machine}'),
            _Line('Plant', record.plant),
            _Line('Stopped at', formatDateTime(record.stoppedAt)),
            if (record.priority.isNotEmpty) _Line('Urgency', record.priority),
            if (record.failureMode.isNotEmpty) _Line('Failure mode', record.failureMode),
            if (record.actionsPerformed.isNotEmpty)
              _Line('What was done', record.actionsPerformed),
            if (record.rootCause.isNotEmpty) _Line('Root cause', record.rootCause),
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

class _CancelCard extends StatefulWidget {
  const _CancelCard({required this.stage, required this.busy, required this.onConfirm});

  final WorkStage stage;
  final bool busy;
  final Future<String?> Function() onConfirm;

  @override
  State<_CancelCard> createState() => _CancelCardState();
}

class _CancelCardState extends State<_CancelCard> {
  bool _open = false;
  String _problem = '';

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
                          final error = await widget.onConfirm();
                          if (error != null && mounted) setState(() => _problem = error);
                        },
                  child: Text(widget.busy ? 'Cancelling…' : widget.stage.title),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
