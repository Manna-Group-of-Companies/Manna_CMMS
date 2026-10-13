import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/attendance_rules.dart';
import '../../core/leave_balance.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/attendance_repository.dart';
import '../../models/attendance.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';
import '../leave/leave_screen.dart';

/// The maintenance manager's side of attendance: the corrections and leave
/// requests waiting on a decision, and the team itself.
///
/// The field-sales app spreads this over three screens (regularization
/// approvals, leave approvals, HR's backdated leave). One screen with three
/// tabs here, because it is one person's job and the queue is short.
class TeamAttendanceScreen extends StatefulWidget {
  const TeamAttendanceScreen({super.key});

  @override
  State<TeamAttendanceScreen> createState() => _TeamAttendanceScreenState();
}

class _TeamAttendanceScreenState extends State<TeamAttendanceScreen> {
  late final AttendanceRepository _repo = AttendanceRepository(context.read<ApiClient>());

  static const _tabs = ['Corrections', 'Leave', 'Team'];
  String _tab = _tabs.first;

  List<Regularization> _regs = const [];
  List<LeaveRequest> _leave = const [];
  List<TeamMember> _members = const [];
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      // All three at once, and all three waited for: awaiting them one after
      // another would leave the later ones unobserved when the first fails,
      // and an unobserved failure is an uncaught exception.
      final (regs, leave, members) = await (
        _repo.pendingRegularizations(),
        _repo.pendingLeave(),
        _repo.members(),
      ).wait;
      if (!mounted) return;
      setState(() {
        _regs = regs;
        _leave = leave;
        _members = members;
        _error = '';
      });
    } on ParallelWaitError catch (e) {
      final errors = e.errors as (AsyncError?, AsyncError?, AsyncError?);
      final first = (errors.$1 ?? errors.$2 ?? errors.$3)?.error;
      if (mounted) {
        setState(() => _error = first is ApiException ? first.message : 'Could not load attendance');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _decideRegularization(Regularization r, bool approve) async {
    try {
      await _repo.decideRegularization(r.id, approve: approve);
      Toast.success('${approve ? 'Approved' : 'Rejected'} ${r.memberName} · ${r.date}');
      _load();
    } on ApiException catch (e) {
      Toast.error(e.message);
    }
  }

  Future<void> _decideLeave(LeaveRequest l, bool approve) async {
    try {
      await _repo.decideLeave(l.id, approve: approve);
      Toast.success('${approve ? 'Approved' : 'Rejected'} ${l.memberName} · ${l.date}');
      _load();
    } on ApiException catch (e) {
      Toast.error(e.message);
    }
  }

  Future<void> _addLeave() async {
    final made = await context.push<bool>('/attendance/team/add-leave');
    if (made == true) _load();
  }

  Future<void> _openMonth(TeamMember m) async {
    await context.push<bool>(
      '/attendance/calendar?member=${Uri.encodeQueryComponent(m.email)}&label=${Uri.encodeQueryComponent(m.name)}',
    );
  }

  /// Puts a member on the leave scheme, changes their figures, or takes them
  /// off it. The one piece of HR data the role cannot hold.
  Future<void> _editScheme(TeamMember m) async {
    var from = m.scheme == null ? null : DateTime.tryParse(m.scheme!.accrualFrom);
    final opening = TextEditingController(
      text: m.scheme == null ? '0' : LeaveBalance.days(m.scheme!.openingBalance),
    );

    final result = await showDialog<_SchemeEdit>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setL) => AlertDialog(
          title: Text('Leave scheme — ${m.name}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'One paid day accrues for every month from the start month, on top of the balance carried forward.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
              const SizedBox(height: 8),
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: const Text('Accrues from'),
                subtitle: Text(
                  from == null ? 'Tap to choose the first month' : dmy(from!),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                trailing: const Icon(Icons.calendar_today_outlined),
                onTap: () async {
                  final now = DateTime.now();
                  final d = await showDatePicker(
                    context: ctx,
                    initialDate: from ?? DateTime(now.year, now.month, 1),
                    firstDate: DateTime(now.year - 3),
                    lastDate: DateTime(now.year + 1, 12, 31),
                  );
                  // The day within the month does not matter to the accrual;
                  // the first is stored so the row reads as a month.
                  if (d != null) setL(() => from = DateTime(d.year, d.month, 1));
                },
              ),
              TextField(
                controller: opening,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Balance carried forward (days)'),
              ),
            ],
          ),
          actions: [
            if (m.scheme != null)
              TextButton(
                onPressed: () => Navigator.pop(ctx, const _SchemeEdit.remove()),
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                child: const Text('Remove from scheme'),
              ),
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(
              onPressed: () {
                final f = from;
                if (f == null) {
                  Toast.error('Pick the month the accrual starts from.');
                  return;
                }
                final o = double.tryParse(opening.text.trim());
                if (o == null || o < 0) {
                  Toast.error('The carried-forward balance must be a number, zero or more.');
                  return;
                }
                Navigator.pop(ctx, _SchemeEdit(accrualFrom: isoDate(f), openingBalance: o));
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (result == null) return;

    try {
      await _repo.setScheme(m.email, accrualFrom: result.accrualFrom, openingBalance: result.openingBalance);
      Toast.success(result.accrualFrom.isEmpty ? '${m.name} taken off the leave scheme' : 'Leave scheme saved for ${m.name}');
      _load();
    } on ApiException catch (e) {
      Toast.error(e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      title: 'Attendance',
      floatingActionButton: _tab == 'Leave'
          ? FloatingActionButton.extended(
              onPressed: _addLeave,
              icon: const Icon(Icons.add),
              label: const Text('Add leave'),
            )
          : null,
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          children: [
            FilterTabs(
              options: [
                for (final t in _tabs)
                  switch (t) {
                    'Corrections' => _regs.isEmpty ? t : '$t (${_regs.length})',
                    'Leave' => _leave.isEmpty ? t : '$t (${_leave.length})',
                    _ => t,
                  },
              ],
              selected: switch (_tab) {
                'Corrections' => _regs.isEmpty ? _tab : '$_tab (${_regs.length})',
                'Leave' => _leave.isEmpty ? _tab : '$_tab (${_leave.length})',
                _ => _tab,
              },
              onChanged: (v) => setState(() => _tab = v.split(' (').first),
            ),
            const SizedBox(height: 12),
            if (_loading && _members.isEmpty && _regs.isEmpty && _leave.isEmpty)
              const Padding(padding: EdgeInsets.only(top: 40), child: LoadingView(message: 'Loading the team…'))
            else if (_error.isNotEmpty)
              EmptyState(title: 'Could not load attendance', message: _error, icon: Icons.error_outline, iconColor: AppColors.danger)
            else
              ..._body(),
          ],
        ),
      ),
    );
  }

  List<Widget> _body() {
    switch (_tab) {
      case 'Corrections':
        if (_regs.isEmpty) {
          return const [EmptyState(title: 'No corrections waiting', message: 'Every regularization has been decided.', icon: Icons.check_circle_outline)];
        }
        return [
          for (final r in _regs) ...[
            _RegularizationCard(
              r: r,
              onApprove: () => _decideRegularization(r, true),
              onReject: () => _decideRegularization(r, false),
            ),
            const SizedBox(height: 10),
          ],
        ];
      case 'Leave':
        if (_leave.isEmpty) {
          return const [EmptyState(title: 'No leave requests waiting', message: 'Add a phoned-in absence with the button below.', icon: Icons.check_circle_outline)];
        }
        return [
          for (final l in _leave) ...[
            _LeaveCard(l: l, onApprove: () => _decideLeave(l, true), onReject: () => _decideLeave(l, false)),
            const SizedBox(height: 10),
          ],
        ];
      default:
        if (_members.isEmpty) {
          return const [
            EmptyState(
              title: 'Nobody on the team yet',
              message: 'Give a person the Store Maintenance Member role in ERPNext and they appear here.',
              icon: Icons.group_outlined,
            ),
          ];
        }
        return [
          const Padding(
            padding: EdgeInsets.fromLTRB(2, 0, 2, 8),
            child: Text(
              'Tap a person for their month. The pencil sets their leave scheme.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 11.5),
            ),
          ),
          for (final m in _members) ...[
            _MemberCard(m: m, onOpen: () => _openMonth(m), onEditScheme: () => _editScheme(m)),
            const SizedBox(height: 10),
          ],
        ];
    }
  }
}

class _SchemeEdit {
  const _SchemeEdit({required this.accrualFrom, required this.openingBalance});

  /// An empty accrual date takes the member off the scheme.
  const _SchemeEdit.remove()
      : accrualFrom = '',
        openingBalance = 0;

  final String accrualFrom;
  final double openingBalance;
}

class _DecisionRow extends StatelessWidget {
  const _DecisionRow({required this.onApprove, required this.onReject});

  final VoidCallback onApprove;
  final VoidCallback onReject;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: FilledButton.icon(
            onPressed: onApprove,
            icon: const Icon(Icons.check, size: 18),
            label: const Text('Approve'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: onReject,
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
            icon: const Icon(Icons.close, size: 18),
            label: const Text('Reject'),
          ),
        ),
      ],
    );
  }
}

/// A correction, with what the day actually holds beside what was asked for.
/// The approver used to see only the request, and could not tell a forgotten
/// punch-out from a day nobody punched at all.
class _RegularizationCard extends StatelessWidget {
  const _RegularizationCard({required this.r, required this.onApprove, required this.onReject});

  final Regularization r;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  String get _actual {
    final a = r.actual;
    if (a == null) return 'Actual:  could not be read';
    final p = actualPunchOf(a.punchIn, a.punchOut);
    final times = 'In ${hhmm(p.punchIn)}   ·   Out ${hhmm(p.punchOut)}';
    return switch (p.kind) {
      ActualPunchKind.none => 'Actual:  nothing punched',
      ActualPunchKind.complete => 'Actual:  $times',
      _ => 'Actual:  $times  (${p.label.toLowerCase()})',
    };
  }

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.edit_calendar_outlined, color: AppColors.primaryDeep, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${r.memberName} · ${r.date}',
                  style: const TextStyle(color: AppColors.textStrong, fontWeight: FontWeight.w700, fontSize: 14),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(_actual, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
          const SizedBox(height: 2),
          Text(
            'Requested:  In ${hhmm(r.requestedIn)}   ·   Out ${hhmm(r.requestedOut)}',
            style: const TextStyle(fontSize: 12.5, color: AppColors.textBody),
          ),
          if (r.reason.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('Reason: ${r.reason}', style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
            ),
          const SizedBox(height: 12),
          _DecisionRow(onApprove: onApprove, onReject: onReject),
        ],
      ),
    );
  }
}

class _LeaveCard extends StatelessWidget {
  const _LeaveCard({required this.l, required this.onApprove, required this.onReject});

  final LeaveRequest l;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  @override
  Widget build(BuildContext context) {
    final bal = l.balance;
    final rem = bal?.remaining ?? 0.0;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.beach_access_outlined, color: AppColors.primaryDeep, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${l.memberName} · ${l.date}',
                  style: const TextStyle(color: AppColors.textStrong, fontWeight: FontWeight.w700, fontSize: 14),
                ),
              ),
              SoftChip(l.halfDay ? 'Half (${l.halfPeriod})' : 'Full day'),
            ],
          ),
          if (l.reason.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('Reason: ${l.reason}', style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
            ),
          if (bal != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                // Against what this member has actually earned. Somebody off
                // the scheme has no entitlement to be measured against, and
                // saying "0 left" would read as having used them all.
                !bal.onScheme
                    ? 'No paid leave scheme — this will be LOP'
                    : 'Balance: ${LeaveBalance.days(bal.taken)} taken · '
                        '${LeaveBalance.days(rem)} left of ${LeaveBalance.days(bal.entitlement)} earned'
                        '${rem <= 0 ? '  ·  will be LOP' : ''}',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: (!bal.onScheme || rem <= 0) ? AppColors.danger : AppColors.textPrimary,
                ),
              ),
            ),
          const SizedBox(height: 12),
          _DecisionRow(onApprove: onApprove, onReject: onReject),
        ],
      ),
    );
  }
}

class _MemberCard extends StatelessWidget {
  const _MemberCard({required this.m, required this.onOpen, required this.onEditScheme});

  final TeamMember m;
  final VoidCallback onOpen;
  final VoidCallback onEditScheme;

  @override
  Widget build(BuildContext context) {
    final s = m.scheme;
    final from = s == null ? null : DateTime.tryParse(s.accrualFrom);
    final scheme = s == null || from == null
        ? 'Not on the leave scheme'
        : 'Accrues from ${_monthYear(from)} · ${LeaveBalance.days(s.openingBalance)} carried forward';

    return AppCard(
      onTap: onOpen,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: AppColors.primary.withValues(alpha: 0.12),
            child: Text(
              m.name.isEmpty ? '?' : m.name.trim()[0].toUpperCase(),
              style: const TextStyle(color: AppColors.primaryDeep, fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(m.name, style: const TextStyle(color: AppColors.textStrong, fontWeight: FontWeight.w700, fontSize: 14)),
                Text(m.email, style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
                const SizedBox(height: 2),
                Text(
                  scheme,
                  style: TextStyle(
                    color: s == null ? AppColors.warning : AppColors.textSecondary,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.edit_outlined, size: 20),
            color: AppColors.textSecondary,
            tooltip: 'Leave scheme',
            onPressed: onEditScheme,
          ),
          const Icon(Icons.chevron_right, color: AppColors.textMuted),
        ],
      ),
    );
  }

  static String _monthYear(DateTime d) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${months[d.month - 1]} ${d.year}';
  }
}

/// Kept so a future "all leave" tab can reuse the member-naming tile without
/// re-importing the leave screen.
typedef TeamLeaveTile = LeaveRequestTile;
