import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/attendance_rules.dart';
import '../../core/leave_balance.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/attendance_repository.dart';
import '../../widgets/common.dart';

/// Apply for one day of leave, or half of one.
///
/// Today or later only; an earlier day is the manager's to record. A half day
/// for today has to be asked for before noon — the server refuses it after,
/// and the note under the switch says so before anyone tries.
class ApplyLeaveScreen extends StatefulWidget {
  const ApplyLeaveScreen({super.key, this.initialDate});

  /// Pre-filled when opened from a day on the calendar.
  final DateTime? initialDate;

  @override
  State<ApplyLeaveScreen> createState() => _ApplyLeaveScreenState();
}

class _ApplyLeaveScreenState extends State<ApplyLeaveScreen> {
  late final AttendanceRepository _repo = AttendanceRepository(context.read<ApiClient>());

  DateTime? _date;
  bool _halfDay = false;
  String _halfPeriod = 'Morning';
  final _reason = TextEditingController();
  bool _busy = false;
  LeaveBalance? _balance;

  @override
  void initState() {
    super.initState();
    final d = widget.initialDate;
    if (d != null) _date = dateOnly(d);
    _loadBalance();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _loadBalance() async {
    try {
      final data = await _repo.myLeave();
      if (mounted) setState(() => _balance = data.balance);
    } on ApiException {
      // The form works without the balance; the server still checks the rules.
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _date ?? now,
      firstDate: dateOnly(now),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (d != null) setState(() => _date = d);
  }

  Future<void> _submit() async {
    final date = _date;
    if (date == null) {
      Toast.error('Pick a leave date.');
      return;
    }
    setState(() => _busy = true);
    try {
      await _repo.applyLeave(
        leaveDate: isoDate(date),
        halfDay: _halfDay,
        halfPeriod: _halfPeriod,
        reason: _reason.text.trim(),
      );
      Toast.success('Leave applied — sent for approval.');
      if (mounted) context.pop(true);
    } on ApiException catch (e) {
      Toast.error(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final days = _halfDay ? 0.5 : 1.0;
    final b = _balance;
    // Beyond what this member has actually earned. Somebody off the scheme is
    // never "over": they have no paid entitlement to exceed, and warning them
    // about an allowance they do not have would be telling them a rule that
    // does not apply to them.
    final willBeOver = b != null && b.onScheme && (b.taken + days) > b.entitlement;

    return Scaffold(
      appBar: AppBar(title: const Text('Apply for Leave')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          if (b != null)
            AppCard(
              color: AppColors.surfaceMuted,
              padding: const EdgeInsets.all(12),
              child: Text(
                // "Not on the scheme" is a different sentence from "0 left".
                !b.onScheme
                    ? 'No paid leave scheme is set for you. Anything you apply for will be without pay (LOP).'
                    : '${LeaveBalance.days(b.remaining)} left of ${LeaveBalance.days(b.entitlement)} earned so far'
                        '${b.pending > 0 ? '   ·   ${LeaveBalance.days(b.pending)} pending' : ''}'
                        '${b.overdrawn ? '   ·   already over' : ''}',
                style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600, fontSize: 13),
              ),
            ),
          const SizedBox(height: 8),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Leave date'),
            subtitle: Text(
              _date == null ? 'Tap to choose (today or later)' : dmy(_date!),
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            trailing: const Icon(Icons.calendar_today_outlined),
            onTap: _pickDate,
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Half day'),
            subtitle: const Text('Counts as 0.5. For today, allowed only before 12 pm.'),
            value: _halfDay,
            onChanged: (v) => setState(() => _halfDay = v),
          ),
          if (_halfDay)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'Morning', label: Text('Morning'), icon: Icon(Icons.wb_twilight)),
                  ButtonSegment(value: 'Afternoon', label: Text('Afternoon'), icon: Icon(Icons.wb_sunny_outlined)),
                ],
                selected: {_halfPeriod},
                onSelectionChanged: (s) => setState(() => _halfPeriod = s.first),
              ),
            ),
          const SizedBox(height: 12),
          TextField(
            controller: _reason,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'Reason (optional)'),
          ),
          if (willBeOver)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.danger.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.danger.withValues(alpha: 0.25)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline, color: AppColors.danger, size: 20),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'This goes beyond the leave you have earned — it will be treated as '
                        'without pay (LOP). You can still apply.',
                        style: TextStyle(color: AppColors.danger, fontSize: 12.5),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: Padding(
              padding: const EdgeInsets.all(6),
              child: _busy
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Submit leave'),
            ),
          ),
        ],
      ),
    );
  }
}
