import '../models/attendance.dart';

/// The attendance rules the phone needs to draw the screens.
///
/// Brought across from the field-sales app (`SALES_DASHBOARD/app/lib/core/
/// attendance_rules.dart`). There these were the only copy, because the reps
/// wrote to ERPNext straight from the phone. Here the server holds the copy
/// that counts — `server/utils/attendanceRules.js` — and every punch is
/// stamped with the server's clock. The two window numbers below exist so the
/// phone does not offer a punch the server is going to refuse; `/attendance/me`
/// carries the live values as well, and the screen prefers those.

/// Punch-in opens at 05:00.
const int kPunchInFromMinute = 5 * 60;

/// Punch-out closes at the end of the 21:30 minute.
const int kPunchOutUntilMinute = 21 * 60 + 30;

/// A punch-in after this is painted "late in" on the calendar.
const int kLateInAfterMinute = 9 * 60 + 30;

/// A punch-out before this is painted "early out".
const int kEarlyOutBeforeMinute = 18 * 60 + 30;

/// The day this module went live for the maintenance team.
///
/// Days before it are left blank rather than marked absent: nobody was
/// expected to punch, and a member scrolling back should not find a wall of
/// red for days the app did not exist.
final DateTime kAttendanceGoLive = DateTime(2026, 10, 12);

int minuteOfDay(DateTime t) => t.hour * 60 + t.minute;

String two(int n) => n.toString().padLeft(2, '0');

/// `YYYY-MM-DD`, the key every record is filed under.
String isoDate(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${two(d.month)}-${two(d.day)}';

DateTime dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

/// An ERPNext stamp (`YYYY-MM-DD HH:MM:SS`) as wall-clock time.
///
/// No timezone conversion: the stamp is already in the site's own zone, and
/// `toLocal()` on a phone set to anything else would shift every punch.
/// Frappe reads an unset Datetime back as null, '' or 'null'; all three are
/// unset.
DateTime? parseStamp(dynamic value) {
  final s = '${value ?? ''}'.trim();
  if (s.isEmpty || s == 'null') return null;
  return DateTime.tryParse(s.replaceFirst(' ', 'T'));
}

/// "09:12" from a stamp, or "—" when there is none.
String hhmm(dynamic stamp) {
  final d = parseStamp(stamp);
  return d == null ? '—' : '${two(d.hour)}:${two(d.minute)}';
}

/// "Oct 12" — a calendar day, short.
String shortDate(DateTime d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${d.day} ${months[d.month - 1]}';
}

/// "12/10/2026" — the way the sales app wrote a day.
String dmy(DateTime d) => '${d.day}/${d.month}/${d.year}';

enum ActualPunchKind { none, missedIn, missedOut, complete }

/// What a member actually punched on a day — shown to whoever approves a
/// regularization for that day, beside what was asked for.
class ActualPunch {
  const ActualPunch(this.kind, this.punchIn, this.punchOut);

  final ActualPunchKind kind;
  final String? punchIn;
  final String? punchOut;

  String get label => switch (kind) {
        ActualPunchKind.none => 'Nothing punched',
        ActualPunchKind.missedIn => 'Missed punch-in',
        ActualPunchKind.missedOut => 'Missed punch-out',
        ActualPunchKind.complete => 'Punched in and out',
      };
}

ActualPunch actualPunchOf(String? punchIn, String? punchOut) {
  String? at(String? v) {
    final s = (v ?? '').trim();
    return s.isEmpty || s == 'null' ? null : s;
  }

  final pin = at(punchIn);
  final pout = at(punchOut);
  final kind = pin == null && pout == null
      ? ActualPunchKind.none
      : pin == null
          ? ActualPunchKind.missedIn
          : pout == null
              ? ActualPunchKind.missedOut
              : ActualPunchKind.complete;
  return ActualPunch(kind, pin, pout);
}

/// How one day is painted on the calendar.
enum DayStatus {
  /// Nothing expected and nothing to say: a future day, today before the
  /// first punch, or a day before the module existed.
  blank,

  /// Sunday is the weekly off.
  weeklyOff,
  leaveFull,
  leaveHalf,
  absent,
  missedOut,
  lateOrEarly,
  onTime,
}

/// Where one day stands.
///
/// The order of the checks is the whole rule, and `absent` is deliberately the
/// last resort: calling somebody absent is a payroll consequence, so every
/// innocent explanation is checked first.
///
///  1. Sunday is nobody's absence, whatever else the day holds — a leave
///     request that happens to fall on one is not a day off anybody spent.
///  2. Approved leave explains the day.
///  3. A future day, today before anyone has punched, and a day before the
///     module went live are blank, not absent.
///  4. A punch-in with no punch-out is a forgotten punch, not a day off.
///  5. Both punches: on time, or late in / early out.
DayStatus dayStatusOf({
  required DateTime day,
  required DateTime today,
  AttendanceLog? log,
  LeaveRequest? leave,
  DateTime? goLive,
}) {
  final d0 = dateOnly(day);
  final t0 = dateOnly(today);

  if (d0.weekday == DateTime.sunday) return DayStatus.weeklyOff;

  if (leave != null && leave.isApproved) {
    return leave.halfDay ? DayStatus.leaveHalf : DayStatus.leaveFull;
  }
  if (d0.isAfter(t0)) return DayStatus.blank;

  if (log == null) {
    if (d0.isAtSameMomentAs(t0)) return DayStatus.blank;
    if (d0.isBefore(goLive ?? kAttendanceGoLive)) return DayStatus.blank;
    return DayStatus.absent;
  }

  final pin = parseStamp(log.punchIn);
  final pout = parseStamp(log.punchOut);
  if (pin != null && pout == null) return DayStatus.missedOut;
  if (pin != null && pout != null) {
    final lateIn = minuteOfDay(pin) > kLateInAfterMinute;
    final earlyOut = minuteOfDay(pout) < kEarlyOutBeforeMinute;
    return (lateIn || earlyOut) ? DayStatus.lateOrEarly : DayStatus.onTime;
  }
  return DayStatus.blank;
}
