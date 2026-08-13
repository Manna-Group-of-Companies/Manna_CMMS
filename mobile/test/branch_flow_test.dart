import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/main.dart';

/// Drives the branch request workflow against a mocked transport:
/// Branch submits → (Admin approves elsewhere) → Supervisor completes it.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<String> requested;
  late List<Map<String, dynamic>> posted;

  /// The one request the mocked server holds, so a decision can move it on.
  late Map<String, dynamic> stored;

  Map<String, dynamic> branchUser(String email) => {
        '_id': 'b1',
        'name': 'Engineer Room Branch',
        'email': email,
        'role': 'Branch',
        'stockRoom': {'_id': 'room1', 'name': 'Engineer Room'},
      };

  Map<String, dynamic> supervisorUser(String email) => {
        '_id': 'u1',
        'name': 'Sam Store',
        'email': email,
        'role': 'Supervisor',
      };

  ApiClient buildClient({String role = 'Branch'}) {
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
          final payload = jsonDecode(request.body) as Map<String, dynamic>;
          final user = role == 'Branch'
              ? branchUser(payload['email'] as String)
              : supervisorUser(payload['email'] as String);
          return ok({...user, 'token': 'test-token'});

        case '/api/auth/me':
          return ok(role == 'Branch'
              ? branchUser('branch@stock.com')
              : supervisorUser('supervisor@stock.com'));

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

        case '/api/dashboard/supervisor':
          return ok({
            'totalProducts': 42,
            'pendingRequests': 0,
            'approvedRequests': 0,
            'rejectedRequests': 0,
            'lowStockProductsCount': 0,
            'branchPendingSupervisor': 1,
            'todayActivity': <Map<String, dynamic>>[],
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

        case '/api/branch-requests/r1/supervisor':
          final payload = jsonDecode(request.body) as Map<String, dynamic>;
          posted.add(payload);
          stored = {
            ...stored,
            'status': payload['action'] == 'approve' ? 'Approved' : 'Rejected',
            'approvedQuantity': payload['approvedQuantity'] ?? 4,
            'supervisor': {'name': 'Sam Store'},
            'supervisorComments': payload['comment'],
            'supervisorDecidedAt': '2026-08-13T10:00:00.000Z',
          };
          return ok(stored);
      }

      return http.Response(jsonEncode({'message': 'Unexpected $path'}), 404);
    });

    return ApiClient(baseUrl: 'http://localhost:5000/api', httpClient: mock);
  }

  Future<void> signIn(WidgetTester tester, String email) async {
    await tester.enterText(
      find.widgetWithText(TextFormField, 'name@company.com'),
      email,
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, '••••••••'),
      'Branch@123',
    );
    await tester.ensureVisible(find.text('Sign In'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign In'));
    await tester.pumpAndSettle();
  }

  /// The stock table sits below the metric grid, and the ListView only builds
  /// what is on screen.
  Future<void> scrollToStock(WidgetTester tester) async {
    await tester.drag(find.byType(ListView), const Offset(0, -700));
    await tester.pumpAndSettle();
  }

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('signs a branch in and shows only its own room', (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();

    await signIn(tester, 'branch@stock.com');

    // Landed in the branch portal, not the supervisor one.
    expect(
      find.descendant(of: find.byType(AppBar), matching: find.text('Engineer Room Stock')),
      findsOneWidget,
    );
    expect(find.text('57'), findsOneWidget, reason: 'total quantity in the room');

    await scrollToStock(tester);
    expect(find.text('My Request Status'), findsOneWidget);
    expect(find.text('Wireless Mouse'), findsWidgets);
    expect(find.text('Stock on Hand'), findsOneWidget);

    // The room read is the branch endpoint; the supervisor screens are not
    // fetched at all.
    expect(requested, contains('GET /api/dashboard/branch'));
    expect(requested, isNot(contains('GET /api/dashboard/supervisor')));
    expect(requested, isNot(contains('GET /api/products')));
  });

  testWidgets('submits a request for a product in the room', (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();
    await signIn(tester, 'branch@stock.com');

    await scrollToStock(tester);
    await tester.tap(find.text('Apply').first);
    await tester.pumpAndSettle();

    expect(find.text('Apply for Product'), findsOneWidget);
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
    await signIn(tester, 'branch@stock.com');

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

  testWidgets('supervisor completes stage two from the phone', (tester) async {
    await tester.pumpWidget(
      StockMasterApp(apiClient: buildClient(role: 'Supervisor')),
    );
    await tester.pumpAndSettle();
    await signIn(tester, 'supervisor@stock.com');

    await tester.tap(find.text('Approvals'));
    await tester.pumpAndSettle();

    expect(find.text('Final approval releases the stock'), findsOneWidget);
    expect(find.text('#BRQ-100200'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Remark (required to reject)'),
      'Released to branch',
    );
    await tester.ensureVisible(find.text('Approve & Release'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Approve & Release'));
    await tester.pumpAndSettle();

    expect(requested, contains('PUT /api/branch-requests/r1/supervisor'));
    final decision = posted.firstWhere((p) => p.containsKey('action'));
    expect(decision['action'], 'approve');
    expect(decision['comment'], 'Released to branch');
    expect(decision['approvedQuantity'], 4);

    // Decided, so it leaves this approver's queue and lands under Completed.
    expect(find.text('#BRQ-100200'), findsNothing);
    await tester.tap(find.text('Completed'));
    await tester.pumpAndSettle();
    expect(find.text('APPROVED — COMPLETED'), findsOneWidget);
  });

  testWidgets('rejecting without a reason is refused before it is sent',
      (tester) async {
    await tester.pumpWidget(
      StockMasterApp(apiClient: buildClient(role: 'Supervisor')),
    );
    await tester.pumpAndSettle();
    await signIn(tester, 'supervisor@stock.com');

    await tester.tap(find.text('Approvals'));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Reject'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reject'));
    await tester.pumpAndSettle();

    expect(requested, isNot(contains('PUT /api/branch-requests/r1/supervisor')));
  });
}
