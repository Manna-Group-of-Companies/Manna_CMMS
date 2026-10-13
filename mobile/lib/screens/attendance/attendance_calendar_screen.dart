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

/// One month, one colour per day, and the way to ask for a day to be
/// corrected.
///
/// Brought across from the field-sales app's calendar. The colours and their
/// order of precedence are `dayStatusOf` in core/attendance_rules.dart; this
/// only paints them.
class AttendanceCalendarScreen extends StatefulWidget {
  const AttendanceCalendarScreen({
    super.key,
    this.member,
    this.label,
    this.regularizeDate,
  });

  /// Whose month. Null means the signed-in member's own, which is also the
  /// only case the correction and leave buttons are offered in — an approver
  /// looking at somebody else's month reads it, nothing more.
  final String? member;

  /// Their name, for the title, when [member] is set.
  final String? label;

  /// Opens the regularization form for this day as soon as the month loads.
  /// Set when the member arrives here from a punch the server had to refuse.
  final String? regularizeDate;

  @override
  State<AttendanceCalendarScreen> createState() => _AttendanceCalendarScreenState();
}

class _AttendanceCalendarScreenState extends State<AttendanceCalendarScreen> {
  late final AttendanceRepository _repo = AttendanceRepository(context.read<ApiClient>());

  late int _year;
  late int _month;
  DateTime _today = DateTime.now();
  AttendanceMonth? _data;
  bool _loading = true;
  bool _changed = false;
  String _error = '';

  /// `regularizeDate` opens its form once, not on every month reload.
  bool _autoOpened = false;

  bool get _own => widget.member == null;

  @override
  void initState() {
    super.initState();
    final start = DateTime.tryParse(widget.regularizeDate ?? '') ?? DateTime.now();
    _year = start.year;
    _month = start.month;
    _load(first: true);
  }

  Future<void> _load({bool first = false}) async {
    setState(() => _loading = true);
    try {
      if (first) {
        // The server's idea of today, so the phone's clock cannot paint a
        // day absent before it has happened.
        try {
          _today = (await _repo.me()).serverNow;
        } on ApiException {
          _today = DateTime.now();
        }
      }
      final data = await _repo.month(_year, _month, member: widget.member);
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

    final day = DateTime.tryParse(widget.regularizeDate ?? '');
    if (day != null && !_autoOpened && _own && _data != null && mounted) {
      _autoOpened = true;
      _regularize(day, _data!.logs[isoDate(day)]);
    }
  }

  void _shiftMonth(int delta) {
    var y = _year;
    var m = _month + delta;
    if (m < 1) {
      m = 12;
      y--;
    } else if (m > 12) {
      m = 1;
      y++;
    }
    setState(() {
      _year = y;
      _month = m;
    });
    _load();
  }

  static const _monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

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
          title: Text(widget.label == null ? 'My Attendance' : '${widget.label} — Attendance'),
          leading: BackButton(onPressed: () => context.pop(_changed)),
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  IconButton(
                    icon: const Icon(Icons.chevron_left),
                    tooltip: 'Previous month',
                    onPressed: () => _shiftMonth(-1),
                  ),
                  Text(
                    '${_monthNames[_month - 1]} $_year',
                    style: const TextStyle(
                      color: AppColors.textStrong,
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.chevron_right),
                    tooltip: 'Next month',
                    onPressed: () => _shiftMonth(1),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  for (final d in const ['S', 'M', 'T', 'W', 'T', 'F', 'S'])
                    Expanded(
                      child: Center(
                        child: Text(
                          d,
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 4),
            Expanded(
              child: _loading && data == null
                  ? const LoadingView(message: 'Loading the month…')
                  : _error.isNotEmpty && data == null
                      ? Padding(
                          padding: const EdgeInsets.all(16),
                          child: EmptyState(
                            title: 'Could not load the month',
                            message: _error,
                            icon: Icons.error_outline,
                            iconColor: AppColors.danger,
                          ),
                        )
                      : Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 10),
                          child: GridView.count(
                            crossAxisCount: 7,
                            children: _cells(data!),
                          ),
                        ),
            ),
            const _Legend(),
          ],
        ),
      ),
    );
  }

  List<Widget> _cells(AttendanceMonth data) {
    final daysInMonth = DateTime(_year, _month + 1, 0).day;
    final firstWeekday = DateTime(_year, _month, 1).weekday % 7; // Sun=0
    final cells = <Widget>[for (var i = 0; i < firstWeekday; i++) const SizedBox()];

    for (var d = 1; d <= daysInMonth; d++) {
      final day = DateTime(_year, _month, d);
      final key = isoDate(day);
      final status = dayStatusOf(
        day: day,
        today: _today,
        log: data.logs[key],
        leave: data.leaves[key],
      );
      final color = DayPaint.colorOf(status);
      final hasReg = data.regularizations.containsKey(key);

      cells.add(InkWell(
        onTap: () => _openDay(day, data),
        borderRadius: BorderRadius.circular(8),
        child: Container(
          margin: const EdgeInsets.all(2),
          decoration: BoxDecoration(
            color: color ?? Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: color == null ? AppColors.border : Colors.transparent),
          ),
          child: Stack(
            children: [
              Center(
                child: Text(
                  '$d',
                  style: TextStyle(
                    // A Sunday carries no fill, so the date itself is greyed
                    // to say it is the weekly off rather than a working day
                    // nothing has been recorded against yet.
                    color: color != null
                        ? Colors.white
                        : (status == DayStatus.weeklyOff ? AppColors.textFaint : AppColors.textPrimary),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (hasReg)
                const Positioned(
                  right: 3,
                  top: 3,
                  child: Icon(Icons.flag, size: 10, color: Colors.white),
                ),
            ],
          ),
        ),
      ));
    }
    return cells;
  }

  void _openDay(DateTime day, AttendanceMonth data) {
    final key = isoDate(day);
    final log = data.logs[key];
    final reg = data.regularizations[key];
    final leave = data.leaves[key];
    final isFuture = dateOnly(day).isAfter(dateOnly(_today));

    showModalBottomSheet<void>(
      context: context,
      builder: (sheet) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              dmy(day),
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textStrong,
                fontSize: 17,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(child: SpecTile(label: 'Punch In', value: hhmm(log?.punchIn))),
                const SizedBox(width: 8),
                Expanded(child: SpecTile(label: 'Punch Out', value: hhmm(log?.punchOut))),
                const SizedBox(width: 8),
                Expanded(
                  child: SpecTile(
                    label: 'Hours',
                    value: log == null || log.punchOut == null ? '—' : log.workingHours.toStringAsFixed(2),
                    caption: log?.regularized == true ? 'regularized' : '',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (leave != null)
              _Note(
                color: AppColors.info,
                text: leave.isApproved
                    ? (leave.halfDay ? 'On leave — ${leave.halfPeriod.toLowerCase()} half' : 'On leave — full day')
                    : (leave.halfDay ? 'Half-day leave requested — awaiting approval' : 'Leave requested — awaiting approval'),
              ),
            if (reg != null)
              _Note(
                color: reg.isPending ? AppColors.warning : StatusColors.of(reg.status),
                text: 'Regularization: ${reg.status}'
                    '${reg.isPending ? ' (awaiting approval)' : ''}'
                    '  ·  In ${hhmm(reg.requestedIn)} · Out ${hhmm(reg.requestedOut)}',
              )
            else if (!isFuture && _own)
              FilledButton.icon(
                onPressed: () {
                  Navigator.pop(sheet);
                  _regularize(day, log);
                },
                icon: const Icon(Icons.edit_calendar_outlined, size: 18),
                label: const Text('Request regularization'),
              ),
            if (!dateOnly(day).isBefore(dateOnly(_today)) && leave == null && _own) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () {
                  Navigator.pop(sheet);
                  _applyLeave(day);
                },
                icon: const Icon(Icons.beach_access_outlined, size: 18),
                label: const Text('Apply for leave'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _applyLeave(DateTime day) async {
    final applied = await context.push<bool>('/attendance/leave/apply?date=${isoDate(day)}');
    if (applied == true) {
      _changed = true;
      _load();
    }
  }

  Future<void> _regularize(DateTime day, AttendanceLog? log) async {
    // Seed from whatever the day already has, so a member fixing a missed
    // punch-out only has to touch the one time that is actually wrong.
    TimeOfDay pick(String? stamp, TimeOfDay fallback) {
      final d = parseStamp(stamp);
      return d == null ? fallback : TimeOfDay(hour: d.hour, minute: d.minute);
    }

    var inT = pick(log?.punchIn, const TimeOfDay(hour: 9, minute: 30));
    var outT = pick(log?.punchOut, const TimeOfDay(hour: 18, minute: 30));
    final reason = TextEditingController();

    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setL) => AlertDialog(
          title: Text('Regularize ${dmy(day)}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: const Text('Punch In'),
                trailing: Text(inT.format(ctx), style: const TextStyle(fontWeight: FontWeight.w700)),
                onTap: () async {
                  final t = await showTimePicker(context: ctx, initialTime: inT);
                  if (t != null) setL(() => inT = t);
                },
              ),
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: const Text('Punch Out'),
                trailing: Text(outT.format(ctx), style: const TextStyle(fontWeight: FontWeight.w700)),
                onTap: () async {
                  final t = await showTimePicker(context: ctx, initialTime: outT);
                  if (t != null) setL(() => outT = t);
                },
              ),
              const SizedBox(height: 8),
              TextField(
                controller: reason,
                decoration: const InputDecoration(labelText: 'Reason'),
                maxLines: 2,
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Submit')),
          ],
        ),
      ),
    );
    if (ok != true) return;

    String stamp(TimeOfDay t) => '${isoDate(day)} ${two(t.hour)}:${two(t.minute)}:00';
    try {
      await _repo.requestRegularization(
        attendanceDate: isoDate(day),
        punchIn: stamp(inT),
        punchOut: stamp(outT),
        reason: reason.text.trim(),
      );
      Toast.success('Regularization submitted for approval');
      _changed = true;
      _load();
    } on ApiException catch (e) {
      Toast.error(e.message);
    }
  }
}

/// The calendar's colours, named by what they mean.
abstract final class DayPaint {
  static const onTime = Color(0xFF16A34A);
  static const lateOrEarly = Color(0xFFFACC15);
  static const missedOut = Color(0xFFF59E0B);
  static const absent = Color(0xFFDC2626);
  static const leaveFull = Color(0xFF2563EB);
  static const leaveHalf = Color(0xFF60A5FA);

  /// Null is a day with nothing to say: blank, or the weekly off.
  static Color? colorOf(DayStatus status) => switch (status) {
        DayStatus.onTime => onTime,
        DayStatus.lateOrEarly => lateOrEarly,
        DayStatus.missedOut => missedOut,
        DayStatus.absent => absent,
        DayStatus.leaveFull => leaveFull,
        DayStatus.leaveHalf => leaveHalf,
        DayStatus.blank || DayStatus.weeklyOff => null,
      };
}

class _Legend extends StatelessWidget {
  const _Legend();

  @override
  Widget build(BuildContext context) {
    Widget chip(Color c, String t) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3)),
            ),
            const SizedBox(width: 4),
            Text(t, style: const TextStyle(fontSize: 11, color: AppColors.textBody)),
          ],
        );

    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
        child: Wrap(
          spacing: 14,
          runSpacing: 8,
          children: [
            chip(DayPaint.onTime, 'On time'),
            chip(DayPaint.lateOrEarly, 'Late in / early out'),
            chip(DayPaint.missedOut, 'Missed punch-out'),
            chip(DayPaint.absent, 'Absent'),
            chip(DayPaint.leaveFull, 'On leave'),
            // Not a colour chip, because a Sunday has no fill to show.
            const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('7', style: TextStyle(fontSize: 11, color: AppColors.textFaint, fontWeight: FontWeight.w700)),
                SizedBox(width: 4),
                Text('Sunday — weekly off', style: TextStyle(fontSize: 11, color: AppColors.textBody)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.color, required this.text});

  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }
}
