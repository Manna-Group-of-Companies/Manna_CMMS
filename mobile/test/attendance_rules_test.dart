import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/core/attendance_rules.dart';
import 'package:stockmaster/models/attendance.dart';

AttendanceLog log({String? punchIn, String? punchOut}) => AttendanceLog(
      id: 'CATT-2026-00001',
      member: 'sunny@mannarubber.com',
      memberName: 'Sunny M J',
      date: '2026-10-13',
      status: punchOut == null ? 'Punched In' : 'Punched Out',
      punchIn: punchIn,
      punchOut: punchOut,
    );

LeaveRequest leave({required String status, bool halfDay = false}) => LeaveRequest(
      id: 'CLV-2026-00001',
      member: 'sunny@mannarubber.com',
      memberName: 'Sunny M J',
      date: '2026-10-13',
      status: status,
      halfDay: halfDay,
    );

void main() {
  group('actualPunchOf', () {
    test('a day with no attendance log is nothing punched', () {
      expect(actualPunchOf(null, null).kind, ActualPunchKind.none);
    });

    test('punched in and never out is a missed punch-out', () {
      final a = actualPunchOf('2026-10-10 09:12:00', null);
      expect(a.kind, ActualPunchKind.missedOut);
      expect(a.punchIn, '2026-10-10 09:12:00');
      expect(a.label, 'Missed punch-out');
    });

    test("Frappe's three spellings of unset all count as unset", () {
      for (final unset in [null, '', 'null']) {
        expect(actualPunchOf(unset, unset).kind, ActualPunchKind.none);
      }
    });

    test('an out with no in is a missed punch-in', () {
      expect(actualPunchOf(null, '2026-10-10 18:00:00').kind, ActualPunchKind.missedIn);
    });

    test('both punches present is a complete day', () {
      expect(
        actualPunchOf('2026-10-10 09:00:00', '2026-10-10 18:00:00').kind,
        ActualPunchKind.complete,
      );
    });
  });

  group('the calendar paints a day', () {
    // A Tuesday after go-live, with the month still in progress.
    final today = DateTime(2026, 10, 20, 11, 0);
    final tuesday = DateTime(2026, 10, 13);

    DayStatus at(DateTime day, {AttendanceLog? l, LeaveRequest? lv}) =>
        dayStatusOf(day: day, today: today, log: l, leave: lv);

    test('Sunday is the weekly off, whatever else the day holds', () {
      final sunday = DateTime(2026, 10, 18);
      expect(at(sunday), DayStatus.weeklyOff);
      // A leave request that happens to fall on a Sunday is not a day off
      // anybody spent, and a punch on one is not a working day.
      expect(at(sunday, lv: leave(status: 'Approved')), DayStatus.weeklyOff);
      expect(at(sunday, l: log(punchIn: '2026-10-18 09:00:00')), DayStatus.weeklyOff);
    });

    test('approved leave explains the day, half or full', () {
      expect(at(tuesday, lv: leave(status: 'Approved')), DayStatus.leaveFull);
      expect(at(tuesday, lv: leave(status: 'Approved', halfDay: true)), DayStatus.leaveHalf);
    });

    test('a leave request nobody has decided does not explain an absence', () {
      // Treating it as time off would let unapproved absence disappear into
      // the leave column.
      expect(at(tuesday, lv: leave(status: 'Pending Approval')), DayStatus.absent);
      expect(at(tuesday, lv: leave(status: 'Rejected')), DayStatus.absent);
    });

    test('a future day is blank, not absent', () {
      expect(at(DateTime(2026, 10, 21)), DayStatus.blank);
    });

    test('today before the first punch is blank, not absent', () {
      expect(at(DateTime(2026, 10, 20)), DayStatus.blank);
    });

    test('a day before the module went live is blank, not absent', () {
      // Nobody was expected to punch; a wall of red for those days would be
      // the first thing a member saw.
      expect(at(DateTime(2026, 10, 9)), DayStatus.blank);
      expect(at(DateTime(2026, 10, 12)), DayStatus.absent, reason: 'go-live day itself counts');
    });

    test('a past working day with nothing on it is absent, and only then', () {
      expect(at(tuesday), DayStatus.absent);
    });

    test('a punch-in with no punch-out is a forgotten punch, not a day off', () {
      expect(at(tuesday, l: log(punchIn: '2026-10-13 09:00:00')), DayStatus.missedOut);
    });

    test('in by 09:30 and out from 18:30 is on time', () {
      expect(
        at(tuesday, l: log(punchIn: '2026-10-13 09:30:00', punchOut: '2026-10-13 18:30:00')),
        DayStatus.onTime,
      );
    });

    test('a minute late in, or a minute early out, is flagged', () {
      expect(
        at(tuesday, l: log(punchIn: '2026-10-13 09:31:00', punchOut: '2026-10-13 18:30:00')),
        DayStatus.lateOrEarly,
      );
      expect(
        at(tuesday, l: log(punchIn: '2026-10-13 09:00:00', punchOut: '2026-10-13 18:29:00')),
        DayStatus.lateOrEarly,
      );
    });

    test('a punch beats a pending leave request for the same day', () {
      // Somebody who turned up worked, whatever request exists.
      expect(
        at(
          tuesday,
          l: log(punchIn: '2026-10-13 09:00:00', punchOut: '2026-10-13 18:30:00'),
          lv: leave(status: 'Pending Approval'),
        ),
        DayStatus.onTime,
      );
    });
  });

  group('stamps', () {
    test('an ERPNext stamp is read as wall-clock time, not shifted to local', () {
      final d = parseStamp('2026-10-12 09:12:00');
      expect(d, isNotNull);
      expect(d!.hour, 9);
      expect(d.minute, 12);
      expect(hhmm('2026-10-12 09:12:00'), '09:12');
    });

    test('an unset stamp reads as a dash', () {
      for (final unset in [null, '', 'null']) {
        expect(hhmm(unset), '—');
      }
    });

    test('the punch windows match the server', () {
      // server/utils/attendanceRules.js: 05:00 and 21:30.
      expect(kPunchInFromMinute, 5 * 60);
      expect(kPunchOutUntilMinute, 21 * 60 + 30);
    });
  });
}
