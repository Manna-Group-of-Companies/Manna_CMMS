import '../core/api_client.dart';
import '../models/attendance.dart';

/// A punch the server refused for the hour it is, not because anything broke.
///
/// [regularizeDate] is set when the member's only way forward is a
/// regularization request for that day, so the screen can offer the shortcut.
class AttendanceWindowException implements Exception {
  const AttendanceWindowException(this.message, {this.regularizeDate});

  final String message;
  final String? regularizeDate;

  @override
  String toString() => message;
}

/// Attendance and leave, one method per endpoint.
///
/// Separate from [MaintenanceRepository] because it serves a different person:
/// a fitter clocking in, not a manager moving a breakdown on. The server
/// decides who may punch, who may approve, and what time it is — nothing here
/// sends a timestamp.
class AttendanceRepository {
  AttendanceRepository(this._api);

  final ApiClient _api;

  List<T> _list<T>(dynamic data, T Function(Map<String, dynamic>) from) =>
      (data as List? ?? []).whereType<Map<String, dynamic>>().map(from).toList(growable: false);

  /// A 422 with `OUTSIDE_WINDOW` is the one refusal the screen handles
  /// specially; everything else is shown as it came.
  Never _rethrow(ApiException e) {
    if (e.statusCode == 422 && e.code == 'OUTSIDE_WINDOW') {
      final date = e.body?['regularizeDate'];
      throw AttendanceWindowException(e.message, regularizeDate: date is String && date.isNotEmpty ? date : null);
    }
    throw e;
  }

  Map<String, dynamic> _coords(double? latitude, double? longitude) => {
        if (latitude != null && longitude != null) ...{'latitude': latitude, 'longitude': longitude},
      };

  // ------------------------------------------------------------------ self

  Future<AttendanceToday> me() async =>
      AttendanceToday.fromJson(await _api.get('/attendance/me') as Map<String, dynamic>);

  Future<AttendanceLog> punchIn({double? latitude, double? longitude}) async {
    try {
      final data = await _api.post('/attendance/punch-in', _coords(latitude, longitude));
      return AttendanceLog.fromJson(data as Map<String, dynamic>);
    } on ApiException catch (e) {
      _rethrow(e);
    }
  }

  Future<AttendanceLog> punchOut({double? latitude, double? longitude}) async {
    try {
      final data = await _api.post('/attendance/punch-out', _coords(latitude, longitude));
      return AttendanceLog.fromJson(data as Map<String, dynamic>);
    } on ApiException catch (e) {
      _rethrow(e);
    }
  }

  /// One month. [member] is honoured for approvers only; a member always
  /// gets their own, whatever is asked for.
  Future<AttendanceMonth> month(int year, int month, {String? member}) async {
    final data = await _api.get('/attendance/month', query: {
      'year': '$year',
      'month': '$month',
      'member': member,
    });
    return AttendanceMonth.fromJson(data as Map<String, dynamic>);
  }

  Future<Regularization> requestRegularization({
    required String attendanceDate,
    String? punchIn,
    String? punchOut,
    String reason = '',
  }) async {
    final data = await _api.post('/attendance/regularizations', {
      'attendanceDate': attendanceDate,
      'punchIn': ?punchIn,
      'punchOut': ?punchOut,
      'reason': reason,
    });
    return Regularization.fromJson(data as Map<String, dynamic>);
  }

  Future<LeaveOverview> myLeave() async =>
      LeaveOverview.fromJson(await _api.get('/attendance/leave') as Map<String, dynamic>);

  Future<LeaveRequest> applyLeave({
    required String leaveDate,
    required bool halfDay,
    String halfPeriod = 'Morning',
    String reason = '',
  }) async {
    final data = await _api.post('/attendance/leave', {
      'leaveDate': leaveDate,
      'halfDay': halfDay,
      if (halfDay) 'halfPeriod': halfPeriod,
      'reason': reason,
    });
    return LeaveRequest.fromJson(data as Map<String, dynamic>);
  }

  // ------------------------------------------------------------- approvers

  Future<List<Regularization>> pendingRegularizations() async =>
      _list(await _api.get('/attendance/regularizations/pending'), Regularization.fromJson);

  Future<Regularization> decideRegularization(String id, {required bool approve}) async {
    final data = await _api.post('/attendance/regularizations/$id/decide', {'approve': approve});
    return Regularization.fromJson(data as Map<String, dynamic>);
  }

  Future<List<LeaveRequest>> pendingLeave() async =>
      _list(await _api.get('/attendance/leave/pending'), LeaveRequest.fromJson);

  Future<LeaveRequest> decideLeave(String id, {required bool approve}) async {
    final data = await _api.post('/attendance/leave/$id/decide', {'approve': approve});
    return LeaveRequest.fromJson(data as Map<String, dynamic>);
  }

  /// Leave recorded on a member's behalf: already approved, any date.
  Future<LeaveRequest> managerLeaveEntry({
    required String member,
    required String leaveDate,
    required bool halfDay,
    String halfPeriod = 'Morning',
    String reason = '',
  }) async {
    final data = await _api.post('/attendance/leave/manager-entry', {
      'member': member,
      'leaveDate': leaveDate,
      'halfDay': halfDay,
      if (halfDay) 'halfPeriod': halfPeriod,
      'reason': reason,
    });
    return LeaveRequest.fromJson(data as Map<String, dynamic>);
  }

  Future<List<TeamMember>> members() async =>
      _list(await _api.get('/attendance/members'), TeamMember.fromJson);

  Future<LeaveOverview> memberLeave(String email) async => LeaveOverview.fromJson(
      await _api.get('/attendance/members/${Uri.encodeComponent(email)}/leave') as Map<String, dynamic>);

  /// An empty [accrualFrom] takes the member off the scheme.
  Future<LeaveScheme?> setScheme(String email, {required String accrualFrom, required double openingBalance}) async {
    final data = await _api.put('/attendance/members/${Uri.encodeComponent(email)}/scheme', {
      'accrualFrom': accrualFrom,
      'openingBalance': openingBalance,
    });
    return LeaveScheme.maybe((data as Map<String, dynamic>)['scheme']);
  }
}
