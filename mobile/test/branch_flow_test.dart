import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/main.dart';

/// Drives the branch portal against a mocked transport: a branch raises a
/// request against its own room and follows it through the stages.
///
/// Both approval stages are decided in the web console, so nothing here
/// approves anything — the app only raises, follows and withdraws.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<String> requested;
  late List<Map<String, dynamic>> posted;

  /// The one request the mocked server holds, sitting at stage two.
  late Map<String, dynamic> stored;

  Map<String, dynamic> branchUser(String email) => {
        '_id': 'b1',
        'name': 'Engineer Room Branch',
        'email': email,
        'role': 'Branch',
        'stockRoom': {'_id': 'room1', 'name': 'Engineer Room'},
      };

  ApiClient buildClient() {
    requested = [];
    posted = [];
    stored = {
      '_id': 'r1',
      'requestNumber': 'BRQ-100200',
      'status': 'Pending Supervisor',
      'productName': 'Wireless Mouse',
      'productCode': 'PRD-203847',
      'unit': 'Pcs',
      'quantity': 4,
      'approvedQuantity': 4,
      'stockAtRequest': 45,
      'stockRoomName': 'Engineer Room',
      'purpose': 'Line 3 conveyor service',
      'branch': {'name': 'Engineer Room Branch', 'email': 'branch@stock.com'},
      'admin': {'name': 'System Admin'},
      'adminComments': 'Stock confirmed',
      'supervisor': null,
      'supervisorComments': '',
      'createdAt': '2026-08-13T09:00:00.000Z',
      'product': {'image': ''},
      'history': [
        {
          'stage': 'Submitted',
          'action': 'Submitted',
          'byName': 'Engineer Room Branch',
          'byRole': 'Branch',
          'comment': 'Line 3 conveyor service',
          'quantity': 4,
          'at': '2026-08-13T09:00:00.000Z',
        },
        {
          'stage': 'Admin',
          'action': 'Approved',
          'byName': 'System Admin',
          'byRole': 'Admin',
          'comment': 'Stock confirmed',
          'quantity': 4,
          'at': '2026-08-13T09:30:00.000Z',
        },
      ],
    };

    final mock = MockClient((request) async {
      final path = request.url.path;
      requested.add('${request.method} $path');

      http.Response ok(Object body) =>
          http.Response(jsonEncode(body), 200, headers: {
            'content-type': 'application/json; charset=utf-8',
          });

      switch (path) {
        case '/api/auth/login':
          // The name identifies the account now; the mock accepts any PIN.
          return ok({...branchUser('branch@stock.com'), 'token': 'test-token'});

        case '/api/auth/me':
          return ok(branchUser('branch@stock.com'));

        case '/api/notifications':
          return ok(<Map<String, dynamic>>[]);

        case '/api/dashboard/branch':
          return ok({
            'room': {'_id': 'room1', 'name': 'Engineer Room', 'description': ''},
            'itemCount': 2,
            'totalQuantity': 57,
            'lowStockCount': 1,
            'outOfStockCount': 0,
            'categoryCount': 1,
            'branchPendingAdmin': 0,
            'branchPendingSupervisor': 1,
            'branchApproved': 3,
            'branchRejected': 0,
            'items': [
              {
                'productId': 'p1',
                'name': 'Wireless Mouse',
                'code': 'PRD-203847',
                'category': 'Electronics',
                'unit': 'Pcs',
                'image': '',
                'minStock': 10,
                'quantity': 45,
                'isLowStock': false,
                'isOutOfStock': false,
              },
              {
                'productId': 'p2',
                'name': 'Desk Lamp',
                'code': 'PRD-473920',
                'category': 'Electronics',
                'unit': 'Pcs',
                'image': '',
                'minStock': 15,
                'quantity': 12,
                'isLowStock': true,
                'isOutOfStock': false,
              },
            ],
          });

        case '/api/branch-requests/mine':
        case '/api/branch-requests':
          if (request.method == 'POST') {
            posted.add(jsonDecode(request.body) as Map<String, dynamic>);
            return http.Response(
              jsonEncode({...stored, 'requestNumber': 'BRQ-777888'}),
              201,
              headers: {'content-type': 'application/json'},
            );
          }
          return ok([stored]);
      }

      return http.Response(jsonEncode({'message': 'Unexpected $path'}), 404);
    });

    return ApiClient(baseUrl: 'http://localhost:5000/api', httpClient: mock);
  }

  Future<void> signIn(WidgetTester tester, String name) async {
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Your account name'),
      name,
    );
    await tester.enterText(find.widgetWithText(TextFormField, '••••'), '1234');
    await tester.ensureVisible(find.text('Sign In'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign In'));
    await tester.pumpAndSettle();
  }

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('signs a branch in and shows only its own room', (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();

    await signIn(tester, 'Engineer Room Branch');

    // Landed in the branch portal, not the supervisor one.
    expect(
      find.descendant(of: find.byType(AppBar), matching: find.text('Engineer Room Stock')),
      findsOneWidget,
    );
    // The room's stock is the whole page — no summary cards above it, so the
    // grid and its first row are on screen without scrolling.
    expect(find.text('ITEM'), findsOneWidget, reason: 'the stock grid header');
    expect(find.text('STOCK'), findsOneWidget);
    expect(find.text('CATEGORY'), findsOneWidget);
    expect(find.text('Wireless Mouse'), findsWidgets);

    // The room read is the branch endpoint; the supervisor screens are not
    // fetched at all.
    expect(requested, contains('GET /api/dashboard/branch'));
    expect(requested, isNot(contains('GET /api/dashboard/supervisor')));
    expect(requested, isNot(contains('GET /api/products')));
  });

  testWidgets('submits a request for a product in the room', (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();
    await signIn(tester, 'Engineer Room Branch');

    // The stock list is the shared grid now: a row unfolds to its actions
    // rather than carrying a button across from the start.
    await tester.tap(find.text('Wireless Mouse').first);
    await tester.pumpAndSettle();

    final apply = find.text('Apply for Stock');
    expect(apply, findsOneWidget, reason: 'the unfolded row offers the action');
    await tester.ensureVisible(apply);
    await tester.pumpAndSettle();
    await tester.tap(apply);
    await tester.pumpAndSettle();

    expect(find.text('Apply for Engineering Stock'), findsOneWidget);
    expect(
      find.text('Goes to the Admin first, then to the Supervisor for final approval.'),
      findsOneWidget,
    );

    await tester.enterText(
      find.widgetWithText(TextField, 'What the items are needed for'),
      'Line 3 service',
    );
    await tester.tap(find.text('Submit Request'));
    await tester.pumpAndSettle();

    expect(requested, contains('POST /api/branch-requests'));
    final body = posted.firstWhere((p) => p.containsKey('productId'));
    expect(body['productId'], 'p1');
    expect(body['quantity'], 1);
    expect(body['purpose'], 'Line 3 service');
  });

  testWidgets('branch sees the stage it is waiting on, and the trail',
      (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();
    await signIn(tester, 'Engineer Room Branch');

    await tester.tap(find.text('Requests').last);
    await tester.pumpAndSettle();

    expect(find.text('BRQ-100200'), findsNothing, reason: 'number is prefixed with #');
    expect(find.text('#BRQ-100200'), findsOneWidget);
    expect(find.text('ADMIN APPROVED — AWAITING SUPERVISOR'), findsOneWidget);

    // The trail is behind the expander.
    await tester.tap(find.byTooltip('Show history'));
    await tester.pumpAndSettle();
    expect(find.text('APPROVAL HISTORY'), findsOneWidget);
    expect(find.text('Request submitted'), findsOneWidget);
    expect(find.text('Admin approved'), findsOneWidget);
    expect(find.text('"Stock confirmed"'), findsWidgets);

    expect(requested, contains('GET /api/branch-requests/mine'));
  });
}
