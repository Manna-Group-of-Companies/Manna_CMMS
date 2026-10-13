import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/attendance_rules.dart';
import '../../core/location_fix.dart';
import '../../core/palette.dart';
import '../../core/toast.dart';
import '../../data/attendance_repository.dart';
import '../../models/attendance.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';

/// A team member's day: punch in, punch out, and the way to the month and to
/// leave.
///
/// The phone half of the attendance card the field-sales app keeps on its
/// home dashboard. The card is the whole of what a member does most days, so
/// it is the screen they land on rather than a tile on one.
class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key});

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  late final AttendanceRepository _repo = AttendanceRepository(context.read<ApiClient>());

  AttendanceToday? _me;
  AttendanceMonth? _month;

  /// When [_me] was read, so the server's clock can be carried forward
  /// without asking again.
  DateTime _loadedAt = DateTime.now();
  bool _loading = true;
  bool _busy = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final me = await _repo.me();
      final now = me.serverNow;
      final month = await _repo.month(now.year, now.month);
      if (!mounted) return;
      setState(() {
        _me = me;
        _month = month;
        _loadedAt = DateTime.now();
        _error = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Now, as the server sees it. A member controls the phone's clock, so it
  /// cannot decide whether a punch is still on offer; the server re-checks
  /// every punch anyway, this only stops the screen offering one it will
  /// refuse.
  DateTime get _serverNow =>
      (_me?.serverNow ?? DateTime.now()).add(DateTime.now().difference(_loadedAt));

  Future<void> _punch({required bool out}) async {
    setState(() => _busy = true);
    Toast.show('Getting location…');
    try {
      final fix = await bestEffortFix();
      final again = out && (_me?.today?.isOut ?? false);
      final log = out
          ? await _repo.punchOut(latitude: fix?.latitude, longitude: fix?.longitude)
          : await _repo.punchIn(latitude: fix?.latitude, longitude: fix?.longitude);
      if (!out) {
        Toast.success('Punched in ✓');
      } else {
        final hours = log.workingHours.toStringAsFixed(2);
        Toast.success(again ? 'Punch-out updated ✓  $hours h' : 'Punched out ✓  $hours h');
      }
      await _load();
    } on AttendanceWindowException catch (e) {
      await _outsidePunchHours(e);
    } on ApiException catch (e) {
      Toast.error(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The punch was refused for the hour it is, not because anything broke —
  /// so say which window closed and, where regularization is the way out,
  /// hand the member straight to it.
  Future<void> _outsidePunchHours(AttendanceWindowException e) async {
    if (!mounted) return;
    final day = e.regularizeDate;
    final regularize = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Outside punch hours'),
        content: Text(e.message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Close')),
          if (day != null)
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Regularize')),
        ],
      ),
    );
    if (regularize == true && mounted) {
      await context.push<bool>('/attendance/calendar?regularize=$day');
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      title: 'Attendance',
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          children: [
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 40),
                child: LoadingView(message: 'Loading attendance…'),
              )
            else if (_error.isNotEmpty && _me == null)
              EmptyState(
                title: 'Could not load attendance',
                message: _error,
                icon: Icons.error_outline,
                iconColor: AppColors.danger,
              )
            else ...[
              _PunchCard(
                me: _me!,
                serverNow: _serverNow,
                busy: _busy,
                onPunchIn: () => _punch(out: false),
                onPunchOut: () => _punch(out: true),
              ),
              const SizedBox(height: 12),
              if (_month != null) _MonthSummary(month: _month!, today: _serverNow),
              const SizedBox(height: 12),
              _LinkTile(
                icon: Icons.calendar_month_outlined,
                title: 'Attendance calendar',
                subtitle: 'Your month, and where to ask for a day to be corrected',
                onTap: () async {
                  await context.push<bool>('/attendance/calendar');
                  _load();
                },
              ),
              const SizedBox(height: 10),
              _LinkTile(
                icon: Icons.beach_access_outlined,
                title: 'Leave',
                subtitle: 'Your balance, your requests, and where to apply',
                onTap: () async {
                  await context.push<bool>('/attendance/leave');
                  _load();
                },
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Where the day stands, and the one button that moves it on.
class _PunchCard extends StatelessWidget {
  const _PunchCard({
    required this.me,
    required this.serverNow,
    required this.busy,
    required this.onPunchIn,
    required this.onPunchOut,
  });

  final AttendanceToday me;
  final DateTime serverNow;
  final bool busy;
  final VoidCallback onPunchIn;
  final VoidCallback onPunchOut;

  @override
  Widget build(BuildContext context) {
    final today = me.today;
    final isIn = today?.isIn ?? false;
    final isOut = today?.isOut ?? false;

    final String line;
    final IconData icon;
    final Color accent;
    if (isIn) {
      line = 'Punched in at ${hhmm(today!.punchIn)}';
      icon = Icons.timer_outlined;
      accent = AppColors.warning;
    } else if (isOut) {
      line = 'Done for today · ${today!.workingHours.toStringAsFixed(2)} h · out at ${hhmm(today.punchOut)}';
      icon = Icons.check_circle_outline;
      accent = AppColors.success;
    } else {
      line = 'Not punched in yet';
      icon = Icons.how_to_reg_outlined;
      accent = AppColors.primaryDeep;
    }

    // A member who punched out early, then kept working, punches out again —
    // the later stamp becomes the official one. Only offered while the window
    // is still open; after that the day needs regularizing.
    final canRepunch = isOut && minuteOfDay(serverNow) <= me.punchOutUntilMinute;

    final spinner = const SizedBox(
      height: 16,
      width: 16,
      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
    );

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, size: 26, color: accent),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      shortDate(serverNow),
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      line,
                      style: const TextStyle(
                        color: AppColors.textStrong,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (!isOut)
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: busy ? null : (isIn ? onPunchOut : onPunchIn),
                icon: busy ? spinner : Icon(isIn ? Icons.logout : Icons.login, size: 18),
                label: Text(isIn ? 'Punch Out' : 'Punch In'),
                style: FilledButton.styleFrom(
                  backgroundColor: isIn ? AppColors.warning : AppColors.primary,
                ),
              ),
            )
          else if (canRepunch)
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: busy ? null : onPunchOut,
                icon: const Icon(Icons.update, size: 18),
                label: const Text('Punch Out Again'),
              ),
            ),
          const SizedBox(height: 8),
          Text(
            'Punches are accepted from ${_clock(me.punchInFromMinute)} to '
            '${_clock(me.punchOutUntilMinute)}. Outside that, ask for a regularization.',
            style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
          ),
        ],
      ),
    );
  }

  static String _clock(int minute) {
    final h = minute ~/ 60;
    final m = minute % 60;
    final suffix = h >= 12 ? 'PM' : 'AM';
    final hour = h % 12 == 0 ? 12 : h % 12;
    return m == 0 ? '$hour $suffix' : '$hour:${two(m)} $suffix';
  }
}

/// The month so far, in the three figures that matter: days worked, days
/// still waiting on a punch-out, and leave granted.
class _MonthSummary extends StatelessWidget {
  const _MonthSummary({required this.month, required this.today});

  final AttendanceMonth month;
  final DateTime today;

  @override
  Widget build(BuildContext context) {
    var worked = 0;
    var open = 0;
    for (final log in month.logs.values) {
      if (log.punchIn != null && log.punchOut != null) {
        worked++;
      } else if (log.punchIn != null) {
        open++;
      }
    }
    final leave = month.leaves.values.where((l) => l.isApproved).fold<double>(0, (s, l) => s + l.days);
    final pending = month.regularizations.values.where((r) => r.isPending).length;

    return Row(
      children: [
        Expanded(
          child: MetricCard(
            title: 'Worked',
            value: worked,
            icon: Icons.check_outlined,
            accent: AppColors.success,
            caption: 'days this month',
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: MetricCard(
            title: 'Missed punch-out',
            value: open,
            icon: Icons.timer_off_outlined,
            accent: open > 0 ? AppColors.warning : AppColors.textMuted,
            caption: pending > 0 ? '$pending correction(s) pending' : 'ask to regularize',
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: MetricCard(
            title: 'Leave',
            value: leave.floor(),
            icon: Icons.beach_access_outlined,
            accent: AppColors.info,
            caption: leave == leave.floorToDouble() ? 'days granted' : '${leave.toStringAsFixed(1)} days granted',
          ),
        ),
      ],
    );
  }
}

class _LinkTile extends StatelessWidget {
  const _LinkTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, size: 20, color: AppColors.primaryDeep),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textStrong,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(subtitle, style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5)),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, color: AppColors.textMuted),
        ],
      ),
    );
  }
}
