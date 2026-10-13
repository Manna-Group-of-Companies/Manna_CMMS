import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/leave_balance.dart';
import '../../core/palette.dart';
import '../../data/attendance_repository.dart';
import '../../models/attendance.dart';
import '../../widgets/common.dart';

/// A member's leave: the balance, every request they have made, and the way
/// to make another.
class LeaveScreen extends StatefulWidget {
  const LeaveScreen({super.key});

  @override
  State<LeaveScreen> createState() => _LeaveScreenState();
}

class _LeaveScreenState extends State<LeaveScreen> {
  late final AttendanceRepository _repo = AttendanceRepository(context.read<ApiClient>());

  LeaveOverview? _data;
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
      final data = await _repo.myLeave();
      if (!mounted) return;
      setState(() {
        _data = data;
        _error = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _apply() async {
    final applied = await context.push<bool>('/attendance/leave/apply');
    if (applied == true) {
      _changed = true;
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) context.pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Leave'),
          leading: BackButton(onPressed: () => context.pop(_changed)),
          actions: [IconButton(icon: const Icon(Icons.refresh), tooltip: 'Refresh', onPressed: _load)],
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _apply,
          icon: const Icon(Icons.add),
          label: const Text('Apply for leave'),
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
            children: [
              if (_loading)
                const Padding(padding: EdgeInsets.only(top: 40), child: LoadingView(message: 'Loading leave…'))
              else if (_error.isNotEmpty && data == null)
                EmptyState(
                  title: 'Could not load leave',
                  message: _error,
                  icon: Icons.error_outline,
                  iconColor: AppColors.danger,
                )
              else if (data != null) ...[
                LeaveBalanceCard(balance: data.balance),
                const SizedBox(height: 14),
                const Padding(
                  padding: EdgeInsets.fromLTRB(2, 0, 2, 8),
                  child: Text(
                    'My leave requests',
                    style: TextStyle(color: AppColors.textStrong, fontWeight: FontWeight.w700),
                  ),
                ),
                if (data.requests.isEmpty)
                  const EmptyState(
                    title: 'No leave requests yet',
                    message: 'Tap "Apply for leave" to make one.',
                    icon: Icons.beach_access_outlined,
                  )
                else
                  for (final l in data.requests) ...[
                    LeaveRequestTile(request: l),
                    const SizedBox(height: 8),
                  ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The balance card.
///
/// "Not on the scheme" is not "no days left". Saying 0 to someone who was
/// never enrolled reads as "you have used them all" and would have them treat
/// every day as unpaid.
class LeaveBalanceCard extends StatelessWidget {
  const LeaveBalanceCard({super.key, required this.balance});

  final LeaveBalance balance;

  @override
  Widget build(BuildContext context) {
    final b = balance;
    if (!b.onScheme) {
      return const AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Leave balance', style: TextStyle(color: AppColors.textStrong, fontWeight: FontWeight.w700)),
            SizedBox(height: 8),
            Text(
              'You are not on the leave accrual scheme, so no balance is held here. '
              'Speak to the maintenance manager about your leave.',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
            ),
          ],
        ),
      );
    }

    Widget cell(String label, String value, Color color) => Expanded(
          child: Column(
            children: [
              Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: color)),
              Text(label, style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
            ],
          ),
        );

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // No financial-year heading. The accrual does not reset in January
          // or in April — it runs continuously from each member's own start
          // date — so naming a year would promise a reset that never happens.
          const Text('Leave balance', style: TextStyle(color: AppColors.textStrong, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          // Where the entitlement comes from, because a number that grows by
          // itself each month is otherwise unexplainable to the person it
          // belongs to.
          Text(
            '${LeaveBalance.days(b.opening)} carried forward + ${LeaveBalance.days(b.accrued)} accrued',
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              cell('Entitled', LeaveBalance.days(b.entitlement), AppColors.textStrong),
              cell('Taken', LeaveBalance.days(b.taken), AppColors.primaryDeep),
              cell('Pending', LeaveBalance.days(b.pending), AppColors.warning),
              cell('Remaining', LeaveBalance.days(b.remaining), b.overdrawn ? AppColors.danger : AppColors.success),
            ],
          ),
          if (b.overdrawn)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(
                '${LeaveBalance.days(b.taken - b.entitlement)} day(s) beyond your entitlement — '
                'those are without pay (LOP).',
                style: const TextStyle(fontSize: 12, color: AppColors.danger),
              ),
            ),
          if (b.pending > 0)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                'Pending days are shown but not deducted — a request that is refused was never leave.',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted),
              ),
            ),
        ],
      ),
    );
  }
}

/// One leave request in a list: the day, half or full, the reason, and where
/// it got to.
class LeaveRequestTile extends StatelessWidget {
  const LeaveRequestTile({super.key, required this.request, this.showMember = false});

  final LeaveRequest request;

  /// Name the member — for a list that mixes people.
  final bool showMember;

  @override
  Widget build(BuildContext context) {
    final l = request;
    final color = StatusColors.of(l.status);
    final sub = [
      if (l.reason.isNotEmpty) l.reason,
      if (l.managerEntry) 'Added by manager',
    ].join('  ·  ');

    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Icon(Icons.beach_access_outlined, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${showMember ? '${l.memberName} · ' : ''}${l.date}'
                  '${l.halfDay ? '  ·  Half day (${l.halfPeriod})' : ''}',
                  style: const TextStyle(color: AppColors.textStrong, fontSize: 13.5, fontWeight: FontWeight.w700),
                ),
                if (sub.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(sub, style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5)),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          StatusBadge(l.status),
        ],
      ),
    );
  }
}
