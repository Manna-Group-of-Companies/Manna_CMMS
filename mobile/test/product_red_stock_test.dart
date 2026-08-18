import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/data/repository.dart';
import 'package:stockmaster/models/models.dart';
import 'package:stockmaster/widgets/product_details_sheet.dart';

/// Stock handed back but not yet merged sits in neither the company it was
/// issued from nor the current-stock figure. The details sheet says how much of
/// it there is, and says nothing at all when there is none.
void main() {
  Map<String, dynamic> productJson(String id) => {
        '_id': id,
        'code': 'PRD-203847',
        'name': 'Wireless Mouse',
        'category': 'Electronics',
        'quantity': 45,
        'unit': 'Pcs',
        'minStock': 10,
        'storeRoom': 'Manna Rubber Park',
        'description': 'Spare for the line office.',
      };

  /// The Red Stock Room holds 4 of p1 and nothing of p2.
  const redStockRoom = {
    'name': 'Red Stock Room',
    'itemCount': 1,
    'totalQuantity': 4,
    'items': [
      {
        'productId': 'p1',
        'name': 'Wireless Mouse',
        'code': 'PRD-203847',
        'unit': 'Pcs',
        'image': '',
        'quantity': 4,
      },
    ],
  };

  Widget wrap(String productId, {int status = 200}) {
    final client = ApiClient(
      baseUrl: 'http://test/api',
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/red-stock/room')) {
          return http.Response(
            jsonEncode(status == 200 ? redStockRoom : {'message': 'nope'}),
            status,
          );
        }
        return http.Response(jsonEncode(<String, dynamic>{}), 200);
      }),
    );

    return MultiProvider(
      providers: [Provider<StockRepository>.value(value: StockRepository(client))],
      child: MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showProductDetails(
                context,
                Product.fromJson(productJson(productId)),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> openSheet(WidgetTester tester, Widget app) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.625;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(app);
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('shows what the product has waiting in Red Stock', (tester) async {
    await openSheet(tester, wrap('p1'));

    expect(find.text('In Red Stock'), findsOneWidget);
    expect(find.text('4 Pcs'), findsOneWidget);
    // The figure sits beside the stock that is actually on the shelf, not
    // folded into it.
    expect(find.text('45 Pcs'), findsOneWidget);
  });

  testWidgets('says nothing for a product with none', (tester) async {
    await openSheet(tester, wrap('p2'));

    expect(find.text('In Red Stock'), findsNothing);
  });

  testWidgets('a refused Red Stock read leaves the rest of the sheet alone',
      (tester) async {
    // A Branch account cannot read the room at all.
    await openSheet(tester, wrap('p1', status: 403));

    expect(find.text('In Red Stock'), findsNothing);
    expect(find.text('Wireless Mouse'), findsWidgets);
    expect(find.text('45 Pcs'), findsOneWidget);
  });
}
