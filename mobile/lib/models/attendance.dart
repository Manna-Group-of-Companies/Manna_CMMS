import '../core/formatters.dart';
import '../core/leave_balance.dart';

/// Attendance and leave, as `/api/attendance` sends them.
///
/// Kept apart from `maintenance.dart` the way that is kept apart from
/// `models.dart`: a punch is a record of a person's day, and a breakdown is a
/// stopped machine, and one file for both only makes each harder to read.

double _asDouble(dynamic value, [double fallback = 0]) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? fallback;
  return fallback;
}

bool _asBool(dynamic value) => value == true || value == 1 || value == '1';

/// A stamp that may be unset. Frappe's three spellings of unset all read as null.
String? _stamp(dynamic value) {
  final s = asString(value).trim();
  return s.isEmpty || s == 'null' ? null : s;
}

/// One day's punches.
class AttendanceLog {
  const AttendanceLog({
    required this.id,
    required this.member,
    required this.memberName,
    required this.date,
    required this.status,
    this.punchIn,
    this.punchOut,
    this.workingHours = 0,
    this.regularized = false,
  });

  final String id;
  final String member;
  final String memberName;

  /// `YYYY-MM-DD`.
  final String date;

  /// `Punched In` or `Punched Out`.
  final String status;
  final String? punchIn;
  final String? punchOut;
  final double workingHours;

  /// The times were written by an approved regularization, not stamped.
  final bool regularized;

  bool get isIn => status == 'Punched In';
  bool get isOut => status == 'Punched Out';

  factory AttendanceLog.fromJson(Map<String, dynamic> json) => AttendanceLog(
        id: asString(json['id']),
        member: asString(json['member']),
        memberName: asString(json['memberName']),
        date: asString(json['date']),
        status: asString(json['status']),
        punchIn: _stamp(json['punchIn']),
        punchOut: _stamp(json['punchOut']),
        workingHours: _asDouble(json['workingHours']),
        regularized: _asBool(json['regularized']),
      );
}

/// What the day's log actually holds, carried beside a regularization so the
/// approver can tell a forgotten punch-out from a day nobody punched at all.
/// Null when the server could not read the logs.
class ActualPunches {
  const ActualPunches({this.punchIn, this.punchOut});

  final String? punchIn;
  final String? punchOut;

  static ActualPunches? maybe(dynamic json) =>
      json is Map<String, dynamic> ? ActualPunches(punchIn: _stamp(json['punchIn']), punchOut: _stamp(json['punchOut'])) : null;
}

/// A request for a day's punches to be corrected.
class Regularization {
  const Regularization({
    required this.id,
    required this.member,
    required this.memberName,
    required this.date,
    required this.status,
    this.requestedIn,
    this.requestedOut,
    this.reason = '',
    this.actual,
  });

  final String id;
  final String member;
  final String memberName;
  final String date;
  final String status;
  final String? requestedIn;
  final String? requestedOut;
  final String reason;
  final ActualPunches? actual;

  bool get isPending => status == 'Pending Approval';

  factory Regularization.fromJson(Map<String, dynamic> json) => Regularization(
        id: asString(json['id']),
        member: asString(json['member']),
        memberName: asString(json['memberName']),
        date: asString(json['date']),
        status: asString(json['status']),
        requestedIn: _stamp(json['requestedIn']),
        requestedOut: _stamp(json['requestedOut']),
        reason: asString(json['reason']),
        actual: ActualPunches.maybe(json['actual']),
      );
}

/// One day of leave, or half of one.
class LeaveRequest {
  const LeaveRequest({
    required this.id,
    required this.member,
    required this.memberName,
    required this.date,
    required this.status,
    this.halfDay = false,
    this.halfPeriod = '',
    this.days = 1,
    this.reason = '',
    this.managerEntry = false,
    this.balance,
  });

  final String id;
  final String member;
  final String memberName;
  final String date;
  final String status;
  final bool halfDay;

  /// `Morning` or `Afternoon` when [halfDay].
  final String halfPeriod;
  final double days;
  final String reason;

  /// Recorded by the manager on the member's behalf.
  final bool managerEntry;

  /// The member's balance, carried on a pending request for the approver.
  final LeaveBalance? balance;

  bool get isPending => status == 'Pending Approval';
  bool get isApproved => status == 'Approved';

  factory LeaveRequest.fromJson(Map<String, dynamic> json) => LeaveRequest(
        id: asString(json['id']),
        member: asString(json['member']),
        memberName: asString(json['memberName']),
        date: asString(json['date']),
        status: asString(json['status']),
        halfDay: _asBool(json['halfDay']),
        halfPeriod: asString(json['halfPeriod']),
        days: _asDouble(json['days'], 1),
        reason: asString(json['reason']),
        managerEntry: _asBool(json['managerEntry']),
        balance: json['balance'] is Map<String, dynamic>
            ? LeaveBalance.fromJson(json['balance'] as Map<String, dynamic>)
            : null,
      );
}

/// Where this person stands today, from `/attendance/me`.
class AttendanceToday {
  const AttendanceToday({
    required this.member,
    required this.isMember,
    required this.canApprove,
    required this.serverNow,
    required this.punchInFromMinute,
    required this.punchOutUntilMinute,
    this.today,
  });

  final String member;
  final bool isMember;
  final bool canApprove;

  /// The server's clock, so the phone's own cannot decide whether a punch is
  /// still on offer.
  final DateTime serverNow;
  final int punchInFromMinute;
  final int punchOutUntilMinute;
  final AttendanceLog? today;

  factory AttendanceToday.fromJson(Map<String, dynamic> json) {
    final window = json['window'] as Map<String, dynamic>? ?? const {};
    final now = DateTime.tryParse(asString(json['serverNow']).replaceFirst(' ', 'T')) ?? DateTime.now();
    return AttendanceToday(
      member: asString(json['member']),
      isMember: _asBool(json['isMember']),
      canApprove: _asBool(json['canApprove']),
      serverNow: now,
      punchInFromMinute: asInt(window['punchInFromMinute'], 5 * 60),
      punchOutUntilMinute: asInt(window['punchOutUntilMinute'], 21 * 60 + 30),
      today: json['today'] is Map<String, dynamic>
          ? AttendanceLog.fromJson(json['today'] as Map<String, dynamic>)
          : null,
    );
  }
}

/// One member's month.
class AttendanceMonth {
  AttendanceMonth({
    required this.member,
    required this.year,
    required this.month,
    required List<AttendanceLog> logs,
    required List<Regularization> regularizations,
    required List<LeaveRequest> leaves,
  })  : logs = {for (final l in logs) l.date: l},
        regularizations = {for (final r in regularizations) r.date: r},
        // A granted request outranks a pending one for the same day.
        leaves = _byDate(leaves);

  final String member;
  final int year;
  final int month;
  final Map<String, AttendanceLog> logs;
  final Map<String, Regularization> regularizations;
  final Map<String, LeaveRequest> leaves;

  static Map<String, LeaveRequest> _byDate(List<LeaveRequest> all) {
    final out = <String, LeaveRequest>{};
    for (final l in all) {
      final prev = out[l.date];
      if (prev == null || (l.isApproved && !prev.isApproved)) out[l.date] = l;
    }
    return out;
  }

  static List<T> _list<T>(dynamic data, T Function(Map<String, dynamic>) from) =>
      (data as List? ?? []).whereType<Map<String, dynamic>>().map(from).toList();

  factory AttendanceMonth.fromJson(Map<String, dynamic> json) => AttendanceMonth(
        member: asString(json['member']),
        year: asInt(json['year']),
        month: asInt(json['month']),
        logs: _list(json['logs'], AttendanceLog.fromJson),
        regularizations: _list(json['regularizations'], Regularization.fromJson),
        leaves: _list(json['leaves'], LeaveRequest.fromJson),
      );
}

/// The balance and the requests together — what the Leave screen draws.
class LeaveOverview {
  const LeaveOverview({required this.balance, required this.requests});

  final LeaveBalance balance;
  final List<LeaveRequest> requests;

  factory LeaveOverview.fromJson(Map<String, dynamic> json) => LeaveOverview(
        balance: LeaveBalance.fromJson(json['balance'] as Map<String, dynamic>?),
        requests: (json['requests'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map(LeaveRequest.fromJson)
            .toList(),
      );
}

/// A member's paid-leave scheme: when accrual started and what they carried forward.
class LeaveScheme {
  const LeaveScheme({required this.accrualFrom, required this.openingBalance});

  final String accrualFrom;
  final double openingBalance;

  static LeaveScheme? maybe(dynamic json) {
    if (json is! Map<String, dynamic>) return null;
    final from = _stamp(json['accrualFrom']);
    if (from == null) return null;
    return LeaveScheme(accrualFrom: from, openingBalance: _asDouble(json['openingBalance']));
  }
}

/// One person on the maintenance team.
class TeamMember {
  const TeamMember({required this.email, required this.name, this.scheme});

  final String email;
  final String name;
  final LeaveScheme? scheme;

  factory TeamMember.fromJson(Map<String, dynamic> json) => TeamMember(
        email: asString(json['email']),
        name: asString(json['name']),
        scheme: LeaveScheme.maybe(json['scheme']),
      );
}
