import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/core/toast.dart';
import 'package:stockmaster/data/repository.dart';
import 'package:stockmaster/models/models.dart';
import 'package:stockmaster/screens/supervisor/product_forms.dart';

/// Saving an edit has to reach the API *and* be reported as saved.
///
/// The reply is the real one the API sends back: a full product document,
/// straight off the wire.
void main() {
  const productJson = {
    '_id': '6a803d6a58ac759cc14573fc',
    'code': 'SAP2',
    'name': 'M12 Anchor Bolt',
    'category': 'Anchor Bolts',
    'subCategory': 'Anchor Bolts',
    'brand': 'F. Weel',
    'status': 'Good Condition',
    'unitCost': 0,
    'rackNumber': 'C15',
    'quantity': 12,
    'unit': 'Units',
    'minStock': 1,
    'maxStock': 100,
    'storeRoom': 'Manna Rubber Park',
    'description': '',
    'image': '',
    'naming': null,
    'nameCompliant': null,
    'createdAt': '2026-08-15T10:20:26.565Z',
    'updatedAt': '2026-08-18T03:26:37.393Z',
    '__v': 0,
    'sap': {
      'status': 'Not Required',
      'code': '',
      'createdAt': null,
      'createdBy': null,
      'note': '',
    },
  };

  late List<String> puts;

  Widget wrap() {
    puts = [];
    final client = ApiClient(
      baseUrl: 'http://test/api',
      httpClient: MockClient((request) async {
        final path = request.url.path;
        if (request.method == 'PUT') {
          puts.add(path);
          return http.Response(jsonEncode(productJson), 200);
        }
        if (path.endsWith('/categories')) {
          return http.Response(jsonEncode(['Anchor Bolts', 'Tools']), 200);
        }
        if (path.endsWith('/subcategories')) {
          return http.Response(jsonEncode(['Anchor Bolts']), 200);
        }
        return http.Response(jsonEncode([]), 200);
      }),
    );

    return MultiProvider(
      providers: [Provider<StockRepository>.value(value: StockRepository(client))],
      child: MaterialApp(
        scaffoldMessengerKey: Toast.messengerKey,
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () =>
                  showProductForm(context, product: Product.fromJson(productJson)),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('an edit is sent, and reported as saved', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.625;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(wrap());
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField).at(1), 'C-16');
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save Changes'));
    await tester.pumpAndSettle();

    expect(puts, ['/api/products/6a803d6a58ac759cc14573fc']);
    // The sheet closes on a save that went through, and the toast says so.
    expect(find.text('Save Changes'), findsNothing, reason: 'the sheet stayed open');
    expect(find.textContaining('Failed to save'), findsNothing);
    expect(find.textContaining('updated'), findsOneWidget);
  });
}
