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

        // The catalog is where a supervisor lands — there is no Home screen.
        case '/api/products':
          return ok([
            {
              '_id': 'p1',
              'name': 'HDMI Cable',
              'category': 'Electrical',
              'unit': 'pcs',
              'quantity': 42,
              'minStockLevel': 5,
            },
          ]);

        case '/api/products/categories':
          return ok(['Electrical']);
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

  testWidgets('signs a supervisor in and renders the catalog', (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();

    // No stored session, so the router lands on the login screen.
    expect(find.text('Sign In to Portal'), findsOneWidget);

    await signIn(tester, pin: '4321');

    // Redirected into the portal, which now opens on the catalog.
    expect(
      find.descendant(
        of: find.byType(AppBar),
        matching: find.text('Browse Engineering Stock Catalog'),
      ),
      findsOneWidget,
    );
    expect(find.text('HDMI Cable'), findsWidgets);

    // Every working screen is a bottom tab; none hide behind a drawer.
    expect(find.byType(Drawer), findsNothing);
    for (final tab in ['Catalog', 'Requests', 'Issues', 'Red Room']) {
      expect(find.text(tab), findsWidgets, reason: '$tab tab');
    }
    // Branch approvals are decided in the web console, not on the phone.
    expect(find.text('Approvals'), findsNothing);
    expect(find.text('Home'), findsNothing);

    // Settings is the gear in the app bar, holding profile and sign-out.
    expect(
      find.descendant(
        of: find.byType(AppBar),
        matching: find.byTooltip('Settings'),
      ),
      findsOneWidget,
    );
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
    expect(find.text('Profile'), findsOneWidget);
    expect(find.text('Sign Out'), findsOneWidget);

    // The token from /auth/login is attached to subsequent calls.
    expect(requested, contains('POST /api/auth/login'));
    expect(requested, contains('GET /api/products'));
    final catalogCall = requested.indexOf('GET /api/products');
    expect(authHeaders[catalogCall], 'Bearer test-token');
  });

  testWidgets('surfaces a rejected login and stays on the login screen',
      (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();

    await signIn(tester, pin: '0000');

    expect(find.text('Invalid name or PIN. Please try again.'), findsWidgets);
    expect(find.text('Sign In to Portal'), findsOneWidget);
    expect(requested, isNot(contains('GET /api/products')));
  });

  testWidgets('turns an admin away at login', (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient(role: 'Admin')));
    await tester.pumpAndSettle();

    // Credentials are valid — it is the role that is refused.
    await signIn(tester, pin: '4321', name: 'System Admin');

    expect(find.text(kAdminNotSupported), findsWidgets);
    expect(find.text('Sign In to Portal'), findsOneWidget);
    // No session was established, so nothing behind the login screen loaded.
    expect(requested, isNot(contains('GET /api/products')));
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
    expect(
      find.descendant(
        of: find.byType(AppBar),
        matching: find.text('Browse Engineering Stock Catalog'),
      ),
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
