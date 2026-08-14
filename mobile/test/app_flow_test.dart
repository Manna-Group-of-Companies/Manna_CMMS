import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/main.dart';
import 'package:stockmaster/state/auth_provider.dart';

/// Drives the app against a mocked transport so the real request paths,
/// auth header and response parsing are all exercised.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// Paths hit during the run, so we can assert on what the app requested.
  late List<String> requested;
  late List<String?> authHeaders;

  ApiClient buildClient({String role = 'Supervisor'}) {
    requested = [];
    authHeaders = [];

    final mock = MockClient((request) async {
      final path = request.url.path;
      requested.add('${request.method} $path');
      authHeaders.add(request.headers['Authorization']);

      http.Response ok(Object body) =>
          http.Response(jsonEncode(body), 200, headers: {
            'content-type': 'application/json; charset=utf-8',
          });

      switch (path) {
        case '/api/auth/login':
          final payload = jsonDecode(request.body) as Map<String, dynamic>;
          if (payload['pin'] != '4321') {
            return http.Response(
              jsonEncode({'message': 'Invalid name or PIN'}),
              401,
              headers: {'content-type': 'application/json'},
            );
          }
          return ok({
            '_id': 'u1',
            'name': payload['name'],
            'email': 'supervisor@stock.com',
            'role': role,
            'token': 'test-token',
          });

        case '/api/auth/me':
          return ok({
            '_id': 'u1',
            'name': 'Sam Store',
            'email': 'supervisor@stock.com',
            'role': role,
          });

        case '/api/notifications':
          return ok([
            {
              '_id': 'n1',
              'message': 'New Stock In request (REQ-IN-100001)',
              'type': 'REQUEST_CREATED',
              'read': false,
              'createdAt': '2026-08-11T09:15:00.000Z',
            },
          ]);

        case '/api/dashboard/supervisor':
          return ok({
            'totalProducts': 42,
            'pendingRequests': 3,
            'approvedRequests': 17,
            'rejectedRequests': 2,
            'lowStockProductsCount': 1,
            'todayActivity': [
              {
                '_id': 'r1',
                'requestNumber': 'REQ-IN-100001',
                'productName': 'HDMI Cable',
                'requestType': 'Stock In',
                'supervisorName': 'Sam Store',
                'status': 'Pending',
                'time': '2026-08-11T09:15:00.000Z',
              },
            ],
          });
      }

      return http.Response(jsonEncode({'message': 'Unexpected $path'}), 404);
    });

    return ApiClient(baseUrl: 'http://localhost:5000/api', httpClient: mock);
  }

  Future<void> signIn(
    WidgetTester tester, {
    required String pin,
    String name = 'Sam Store',
  }) async {
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Your account name'),
      name,
    );
    await tester.enterText(find.widgetWithText(TextFormField, '••••'), pin);
    await tester.ensureVisible(find.text('Sign In'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign In'));
    await tester.pumpAndSettle();
  }

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('signs a supervisor in and renders the dashboard', (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();

    // No stored session, so the router lands on the login screen.
    expect(find.text('Sign In to Portal'), findsOneWidget);

    await signIn(tester, pin: '4321');

    // Redirected into the portal with metrics parsed from the API.
    // Scoped to the app bar: "Home" is also a bottom-tab label.
    expect(
      find.descendant(of: find.byType(AppBar), matching: find.text('Home')),
      findsOneWidget,
    );
    expect(find.text('42'), findsOneWidget, reason: 'total products');
    // Metric tiles pad single digits to two, as in the design.
    expect(find.text('03'), findsOneWidget, reason: 'pending requests');
    // The panels below the metric grid are built lazily by the ListView.
    await tester.drag(find.byType(ListView), const Offset(0, -700));
    await tester.pumpAndSettle();
    expect(find.text("Today's Activity Log"), findsOneWidget);
    expect(find.text('REQ-IN-100001'), findsOneWidget);
    expect(find.text('HDMI Cable'), findsWidgets);

    // The token from /auth/login is attached to subsequent calls.
    expect(requested, contains('POST /api/auth/login'));
    expect(requested, contains('GET /api/dashboard/supervisor'));
    final dashboardCall = requested.indexOf('GET /api/dashboard/supervisor');
    expect(authHeaders[dashboardCall], 'Bearer test-token');
  });

  testWidgets('surfaces a rejected login and stays on the login screen',
      (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();

    await signIn(tester, pin: '0000');

    expect(find.text('Invalid name or PIN. Please try again.'), findsWidgets);
    expect(find.text('Sign In to Portal'), findsOneWidget);
    expect(requested, isNot(contains('GET /api/dashboard/supervisor')));
  });

  testWidgets('turns an admin away at login', (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient(role: 'Admin')));
    await tester.pumpAndSettle();

    // Credentials are valid — it is the role that is refused.
    await signIn(tester, pin: '4321', name: 'System Admin');

    expect(find.text(kAdminNotSupported), findsWidgets);
    expect(find.text('Sign In to Portal'), findsOneWidget);
    // No session was established, so nothing behind the login screen loaded.
    expect(requested, isNot(contains('GET /api/dashboard/supervisor')));
  });

  testWidgets('restores a stored session without showing the login screen',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'token': 'test-token',
      'user': jsonEncode({
        '_id': 'u1',
        'name': 'Sam Store',
        'email': 'supervisor@stock.com',
        'role': 'Supervisor',
      }),
    });

    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();

    expect(find.text('Sign In to Portal'), findsNothing);
    // Scoped to the app bar: "Home" is also a bottom-tab label.
    expect(
      find.descendant(of: find.byType(AppBar), matching: find.text('Home')),
      findsOneWidget,
    );
    // The stored token is re-validated on start-up.
    expect(requested, contains('GET /api/auth/me'));
  });

  testWidgets('discards a stored admin session from an older build',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'token': 'test-token',
      'user': jsonEncode({
        '_id': 'u1',
        'name': 'Olivia Office',
        'email': 'admin@stock.com',
        'role': 'Admin',
      }),
    });

    await tester.pumpWidget(StockMasterApp(apiClient: buildClient(role: 'Admin')));
    await tester.pumpAndSettle();

    expect(find.text('Sign In to Portal'), findsOneWidget);
  });
}
