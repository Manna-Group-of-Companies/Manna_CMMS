import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/attendance_rules.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/attendance_repository.dart';
import '../../models/attendance.dart';
import '../../widgets/common.dart';

/// The manager recording leave on a member's behalf — a phoned-in absence.
///
/// Recorded as already approved, and any date is allowed: the point is a day
/// that has already happened. The HR screen of the field-sales app, with the
/// maintenance manager in HR's chair.
class AddLeaveScreen extends StatefulWidget {
  const AddLeaveScreen({super.key});

  @override
  State<AddLeaveScreen> createState() => _AddLeaveScreenState();
}

class _AddLeaveScreenState extends State<AddLeaveScreen> {
  late final AttendanceRepository _repo = AttendanceRepository(context.read<ApiClient>());

  List<TeamMember> _members = const [];
  String? _member;
  DateTime? _date;
  bool _halfDay = false;
  String _halfPeriod = 'Morning';
  final _reason = TextEditingController();
  bool _loading = true;
  bool _busy = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final members = await _repo.members();
      if (!mounted) return;
      setState(() {
        _members = members;
        _error = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _date ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (d != null) setState(() => _date = d);
  }

  Future<void> _save() async {
    final member = _member;
    final date = _date;
    if (member == null) {
      Toast.error('Pick a team member.');
      return;
    }
    if (date == null) {
      Toast.error('Pick a date.');
      return;
    }
    setState(() => _busy = true);
    try {
      final made = await _repo.managerLeaveEntry(
        member: member,
        leaveDate: isoDate(date),
        halfDay: _halfDay,
        halfPeriod: _halfPeriod,
        reason: _reason.text.trim(),
      );
      Toast.success('Leave added (approved)  ${made.id}');
      if (mounted) context.pop(true);
    } on ApiException catch (e) {
      Toast.error(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add Leave')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          const Text(
            'Mark leave on behalf of a team member — a phoned-in absence, say. '
            'Recorded as already approved; any date is allowed.',
            style: TextStyle(fontSize: 12.5, color: AppColors.textSecondary),
          ),
          const SizedBox(height: 14),
          if (_loading)
            const LoadingView(message: 'Loading the team…')
          else if (_error.isNotEmpty)
            EmptyState(title: 'Could not load the team', message: _error, icon: Icons.error_outline, iconColor: AppColors.danger)
          else
            DropdownButtonFormField<String>(
              initialValue: _member,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Team member'),
              items: [
                for (final m in _members)
                  DropdownMenuItem(value: m.email, child: Text(m.name, overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => setState(() => _member = v),
            ),
          const SizedBox(height: 8),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Leave date'),
            subtitle: Text(
              _date == null ? 'Tap to choose (any date)' : dmy(_date!),
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            trailing: const Icon(Icons.calendar_today_outlined),
            onTap: _pickDate,
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Half day'),
            value: _halfDay,
            onChanged: (v) => setState(() => _halfDay = v),
          ),
          if (_halfDay)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'Morning', label: Text('Morning'), icon: Icon(Icons.wb_twilight)),
                  ButtonSegment(value: 'Afternoon', label: Text('Afternoon'), icon: Icon(Icons.wb_sunny_outlined)),
                ],
                selected: {_halfPeriod},
                onSelectionChanged: (s) => setState(() => _halfPeriod = s.first),
              ),
            ),
          const SizedBox(height: 8),
          TextField(
            controller: _reason,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'Reason (optional)'),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy || _loading ? null : _save,
            child: Padding(
              padding: const EdgeInsets.all(6),
              child: _busy
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Add leave'),
            ),
          ),
        ],
      ),
    );
  }
}
