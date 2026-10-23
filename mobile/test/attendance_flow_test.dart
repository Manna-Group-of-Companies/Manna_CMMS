import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/main.dart';

/// A maintenance member's day, driven through the real app against a mocked
/// transport: sign in, land on Attendance, punch in, see the day move on.
///
/// The phone sends no time with a punch - the server stamps it - so the only
/// thing the request can carry is where the phone was, and in a test there is
/// no plugin to ask, so it carries nothing. That path has to work: a fitter in
/// a steel shed is in the same position.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<String> requested;
  late List<String> punchBodies;

  ApiClient buildClient({String role = 'Maintenance Member'}) {
    requested = [];
    punchBodies = [];
    var punched = false;

    Map<String, dynamic> todayLog() => {
          'id': 'CATT-2026-00001',
          'member': 'sunny@mannarubber.com',
          'memberName': 'Sunny M J',
          'date': '2026-10-12',
          'status': 'Punched In',
          'punchIn': '2026-10-12 09:12:00',
          'punchOut': null,
          'workingHours': 0,
          'regularized': false,
        };

    final mock = MockClient((request) async {
      final path = request.url.path;
      requested.add('${request.method} $path');

      http.Response ok(Object body, [int status = 200]) => http.Response(
            jsonEncode(body),
            status,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );

      switch (path) {
        case '/api/session/login':
          return ok({
            'email': 'sunny@mannarubber.com',
            'name': 'Sunny M J',
            'role': role,
            'erpRoles': ['Store Maintenance Member'],
            'token': 'test-token',
          });

        case '/api/notifications':
          return ok(<Map<String, dynamic>>[]);

        case '/api/attendance/me':
          return ok({
            'member': 'sunny@mannarubber.com',
            'isMember': true,
            'canApprove': false,
            'serverNow': '2026-10-12 09:00:00',
            'window': {'punchInFromMinute': 300, 'punchOutUntilMinute': 1290},
            'today': punched ? todayLog() : null,
          });

        case '/api/attendance/month':
          return ok({
            'member': 'sunny@mannarubber.com',
            'year': 2026,
            'month': 10,
            'logs': punched ? [todayLog()] : <Map<String, dynamic>>[],
            'regularizations': <Map<String, dynamic>>[],
            'leaves': <Map<String, dynamic>>[],
          });

        case '/api/attendance/punch-in':
          punched = true;
          punchBodies.add(request.body);
          return ok(todayLog(), 201);

        // The approver's side: an empty queue and a team of one.
        case '/api/attendance/regularizations/pending':
        case '/api/attendance/leave/pending':
          return ok(<Map<String, dynamic>>[]);
        case '/api/attendance/members':
          return ok([
            {'email': 'sunny@mannarubber.com', 'name': 'Sunny M J', 'scheme': null},
          ]);

        // Where a manager lands before tapping the Attendance tab.
        case '/api/breakdowns':
          return ok(<Map<String, dynamic>>[]);
      }

      return http.Response(jsonEncode({'message': 'Unexpected $path'}), 404);
    });

    return ApiClient(baseUrl: 'http://localhost:5000/api', httpClient: mock);
  }

  Future<void> signIn(WidgetTester tester) async {
    await tester.enterText(
      find.widgetWithText(TextFormField, 'you@mannarubber.com'),
      'sunny@mannarubber.com',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Your ERPNext password'),
      'secret',
    );
    await tester.ensureVisible(find.text('Sign In'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign In'));
    await tester.pumpAndSettle();
  }

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    // There is no location plugin under test, so answer every call on its
    // channel with "no": location services off, so the punch goes out without
    // coordinates - the same path a fitter in a steel shed takes.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('flutter.baseflow.com/geolocator'),
      (call) async => false,
    );
  });

  testWidgets('a member signs in, lands on Attendance and punches in', (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();
    await signIn(tester);

    // Attendance is the whole of a member's app: the one tab, and home.
    expect(find.text('Attendance'), findsWidgets);
    expect(find.text('Breakdowns'), findsNothing);
    expect(find.text('Requests'), findsNothing);
    expect(find.text('Not punched in yet'), findsOneWidget);
    expect(requested, contains('GET /api/attendance/me'));

    await tester.tap(find.text('Punch In'));
    await tester.pumpAndSettle();

    expect(requested, contains('POST /api/attendance/punch-in'));
    // No plugin to ask in a test, so no coordinates - and no time, ever.
    expect(punchBodies.single, '{}');
    expect(find.text('Punched in at 09:12'), findsOneWidget);
    expect(find.text('Punch Out'), findsOneWidget);
  });

  testWidgets('a Maintenance Manager phone is Breakdowns and Requests, no Attendance',
      (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient(role: 'Maintenance Manager')));
    await tester.pumpAndSettle();
    await signIn(tester);

    // Attendance is decided on the web console since 13 Oct 2026.
    // On the dashboard, which names Requests in both the tab bar and its
    // shortcuts.
    expect(find.text('Requests'), findsWidgets);
    expect(find.text('Attendance'), findsNothing);
    expect(find.text('Punch In'), findsNothing);
  });
}
