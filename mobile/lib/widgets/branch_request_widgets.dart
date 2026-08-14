import 'package:flutter/material.dart';

import '../core/formatters.dart';
import '../core/palette.dart';
import '../models/models.dart';
import 'common.dart';

/// The branch workflow's vocabulary, matching `components/RequestStatus.jsx`
/// in the web client so a request reads the same on both.
///
///   Pending Admin  →  Pending Supervisor  →  Approved
///          ↘ Rejected            ↘ Rejected
class BranchStatus {
  const BranchStatus({
    required this.label,
    required this.short,
    required this.step,
    required this.color,
  });

  final String label;
  final String short;

  /// How far along the four-stage chain the request has travelled.
  final int step;
  final Color color;

  static const _cancelled = BranchStatus(
    label: 'Withdrawn by branch',
    short: 'Withdrawn',
    step: 0,
    color: AppColors.textMuted,
  );

  static const _byStatus = {
    'Pending Admin': BranchStatus(
      label: 'Pending — Admin Review',
      short: 'Pending Admin',
      step: 1,
      color: AppColors.warning,
    ),
    'Pending Supervisor': BranchStatus(
      label: 'Admin Approved — Awaiting Supervisor',
      short: 'Supervisor Pending',
      step: 2,
      color: AppColors.accent,
    ),
    'Approved': BranchStatus(
      label: 'Approved — Completed',
      short: 'Approved',
      step: 3,
      color: AppColors.success,
    ),
    'Rejected': BranchStatus(
      label: 'Rejected',
      short: 'Rejected',
      step: 0,
      color: AppColors.danger,
    ),
    'Cancelled': _cancelled,
  };

  static BranchStatus of(String status) => _byStatus[status] ?? _cancelled;
}

/// The current status, worded the same on every screen.
class BranchStatusBadge extends StatelessWidget {
  const BranchStatusBadge(this.status, {super.key, this.compact = false});

  final String status;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final meta = BranchStatus.of(status);
    return AppBadge(
      compact ? meta.short : meta.label,
      color: meta.color,
      fontSize: 9.5,
    );
  }
}

/// Where the request stands in the two-approval chain.
class BranchStageChain extends StatelessWidget {
  const BranchStageChain(this.request, {super.key});

  final BranchRequestRecord request;

  static const _stages = ['Submitted', 'Admin', 'Supervisor', 'Done'];

  /// Who owns each stage and when they acted. The closing "Done" chip carries
  /// no caption — it is the supervisor's approval by another name.
  (String, DateTime?)? _actorAt(int index) => switch (index) {
        0 => (request.raisedBy, request.createdAt),
        1 => (request.adminDecidedBy, request.adminDecidedOn),
        2 => (request.supervisorDecidedBy, request.supervisorDecidedOn),
        _ => null,
      };

  @override
  Widget build(BuildContext context) {
    final meta = BranchStatus.of(request.status);
    final closed = request.isRejected || request.isCancelled;
    // Which stage turned it down, so the chain shows where it stopped.
    final failedAt =
        request.isRejected ? (request.supervisorDecidedAt != null ? 2 : 1) : -1;

    return Wrap(
      spacing: 4,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.start,
      children: [
        for (var i = 0; i < _stages.length; i++) ...[
          _StageChip(
            label: _stages[i],
            state: _stateAt(i, meta: meta, closed: closed, failedAt: failedAt),
            actor: _actorAt(i),
          ),
          if (i < _stages.length - 1)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Icon(Icons.chevron_right, size: 13, color: AppColors.textFaint),
            ),
        ],
      ],
    );
  }

  _StageState _stateAt(
    int index, {
    required BranchStatus meta,
    required bool closed,
    required int failedAt,
  }) {
    if (index == failedAt) return _StageState.failed;
    // The submission itself always happened, whatever came after.
    if (index == 0 && !request.isCancelled) return _StageState.done;
    if (request.isCancelled) return _StageState.pending;
    if (closed) return index < failedAt ? _StageState.done : _StageState.pending;
    // A completed request fills the last chip too, not just the ones before it.
    if (meta.step > index || meta.step == 3) return _StageState.done;
    if (meta.step == index) return _StageState.current;
    return _StageState.pending;
  }
}

enum _StageState { done, current, failed, pending }

class _StageChip extends StatelessWidget {
  const _StageChip({required this.label, required this.state, this.actor});

  final String label;
  final _StageState state;

  /// Who decided this stage and when. Null while it is still undecided, or on
  /// the closing chip, which repeats the supervisor's approval.
  final (String, DateTime?)? actor;

  @override
  Widget build(BuildContext context) {
    final (color, icon) = switch (state) {
      _StageState.done => (AppColors.success, Icons.check),
      _StageState.current => (AppColors.warning, Icons.schedule),
      _StageState.failed => (AppColors.danger, Icons.close),
      _StageState.pending => (AppColors.textFaint, Icons.radio_button_unchecked),
    };

    final name = actor?.$1 ?? '';
    final at = actor?.$2;
    final decided = name.isNotEmpty && at != null;

    final chip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: state == _StageState.pending
            ? AppColors.surfaceMuted
            : color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(7),
        border: Border.all(
          color: state == _StageState.pending
              ? AppColors.border
              : color.withValues(alpha: 0.22),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );

    if (!decided) return chip;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        chip,
        const SizedBox(height: 2),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 96),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                  height: 1.2,
                ),
              ),
              Text(
                formatDateTime(at),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.5,
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The full decision trail, kept visible at every stage of the workflow.
class BranchHistoryTimeline extends StatelessWidget {
  const BranchHistoryTimeline(this.history, {super.key});

  final List<BranchDecision> history;

  @override
  Widget build(BuildContext context) {
    if (history.isEmpty) {
      return const Text(
        'No history recorded yet.',
        style: TextStyle(color: AppColors.textMuted, fontSize: 11.5),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final entry in history) ...[
          _HistoryRow(entry: entry),
          if (entry != history.last) const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.entry});

  final BranchDecision entry;

  @override
  Widget build(BuildContext context) {
    final (color, icon) = switch (entry.action) {
      'Approved' => (AppColors.success, Icons.check),
      'Rejected' => (AppColors.danger, Icons.close),
      'Cancelled' => (AppColors.textMuted, Icons.block),
      _ => (AppColors.primaryDeep, Icons.send_outlined),
    };

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          height: 26,
          width: 26,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.10),
            shape: BoxShape.circle,
            border: Border.all(color: color.withValues(alpha: 0.24)),
          ),
          child: Icon(icon, size: 13, color: color),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    entry.headline,
                    style: const TextStyle(
                      color: AppColors.textStrong,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    [
                      if (entry.byName.isNotEmpty) entry.byName,
                      if (entry.byRole.isNotEmpty) entry.byRole,
                    ].join(' · '),
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                  ),
                  if (entry.quantity > 0)
                    Text(
                      'Qty ${entry.quantity}',
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                ],
              ),
              if (entry.comment.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  '"${entry.comment}"',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11.5,
                    height: 1.4,
                  ),
                ),
              ],
              const SizedBox(height: 2),
              Text(
                formatDateTime(entry.at),
                style: const TextStyle(color: AppColors.textFaint, fontSize: 10),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
