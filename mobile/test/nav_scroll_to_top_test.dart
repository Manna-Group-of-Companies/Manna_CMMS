import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/main.dart';

/// Tapping the tab a screen is already on scrolls it back to the top.
///
/// Driven through the real app and the real branch stock screen — the
/// behaviour depends on that screen's grid adopting the shell's primary scroll
/// controller, which only a real screen proves. The room is stocked with far
/// more rows than fit, so there is something to scroll.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  ApiClient buildClient() {
    final items = [
      for (var i = 0; i < 40; i++)
        {
          'productId': 'p$i',
          'name': 'Product $i',
          'code': 'PRD-${1000 + i}',
          'category': 'Electronics',
          'unit': 'Pcs',
          'image': '',
          'minStock': 5,
          'quantity': 20 + i,
          'isLowStock': false,
          'isOutOfStock': false,
        },
    ];

    final mock = MockClient((request) async {
      http.Response ok(Object body) => http.Response(
            jsonEncode(body),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );

      switch (request.url.path) {
        case '/api/auth/login':
          return ok({
            'token': 'test-token',
            '_id': 'b1',
            'name': 'Engineer Room Branch',
            'email': '',
            'role': 'Branch',
            'stockRoom': {'_id': 'room1', 'name': 'Engineer Room'},
          });

        case '/api/notifications':
          return ok(<Map<String, dynamic>>[]);

        case '/api/dashboard/branch':
          return ok({
            'room': {'_id': 'room1', 'name': 'Engineer Room', 'description': ''},
            'itemCount': items.length,
            'totalQuantity': 800,
            'lowStockCount': 0,
            'outOfStockCount': 0,
            'categoryCount': 1,
            'branchPendingAdmin': 0,
            'branchPendingSupervisor': 0,
            'branchApproved': 0,
            'branchRejected': 0,
            'items': items,
          });

        case '/api/branch-requests/mine':
        case '/api/branch-requests':
          return ok(<Map<String, dynamic>>[]);
      }

      return ok(<Map<String, dynamic>>[]);
    });

    return ApiClient(baseUrl: 'http://localhost:5000/api', httpClient: mock);
  }

  Future<void> signIn(WidgetTester tester) async {
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Your account name'),
      'Engineer Room Branch',
    );
    await tester.enterText(find.widgetWithText(TextFormField, '••••'), '1234');
    await tester.ensureVisible(find.text('Sign In'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign In'));
    await tester.pumpAndSettle();
  }

  /// The controller the branch stock grid actually attached to.
  ScrollController controllerOf(WidgetTester tester) {
    final scrollable = tester.widget<Scrollable>(
      find.descendant(of: find.byType(ListView), matching: find.byType(Scrollable)).first,
    );
    expect(
      scrollable.controller,
      isNotNull,
      reason: 'the screen grid adopts the shell primary scroll controller',
    );
    return scrollable.controller!;
  }

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('re-tapping the active tab scrolls the screen back to the top',
      (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();
    await signIn(tester);

    await tester.drag(find.byType(ListView).first, const Offset(0, -600));
    await tester.pumpAndSettle();

    final controller = controllerOf(tester);
    expect(controller.offset, greaterThan(0), reason: 'scrolled away from the top');

    // The tab this screen is already on — navigation has nothing to do.
    await tester.tap(find.text('Stock'));
    await tester.pumpAndSettle();

    expect(controller.offset, 0, reason: 'back at the top');
  });

  testWidgets('a screen already at the top is left alone', (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();
    await signIn(tester);

    await tester.tap(find.text('Stock'));
    await tester.pumpAndSettle();

    expect(controllerOf(tester).offset, 0);
  });

  testWidgets('tapping a different tab navigates instead of scrolling',
      (tester) async {
    await tester.pumpWidget(StockMasterApp(apiClient: buildClient()));
    await tester.pumpAndSettle();
    await signIn(tester);

    await tester.drag(find.byType(ListView).first, const Offset(0, -600));
    await tester.pumpAndSettle();
    expect(controllerOf(tester).offset, greaterThan(0));

    await tester.tap(find.text('Requests'));
    await tester.pumpAndSettle();

    // Left the stock screen rather than scrolling it.
    expect(find.text('My Engineering Stock Requests'), findsWidgets);
  });
}
