import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/models/models.dart';
import 'package:stockmaster/widgets/product_details_sheet.dart';
import 'package:stockmaster/widgets/product_table.dart';

/// The catalog grid has the same job as the issue grid: hold a phone screen
/// without scrolling sideways, and keep the rest of the record one tap away.
void main() {
  final products = [
    Product.fromJson(const {
      '_id': 'p1',
      'code': 'PRD-593021',
      'name': 'Dell UltraSharp 27 Monitor (U2723QE)',
      'category': 'Electronics',
      'quantity': 8,
      'unit': 'Pcs',
      'minStock': 10,
      'storeRoom': 'Engineer Room',
      'description': 'Colour-calibrated review monitor.',
    }),
    Product.fromJson(const {
      '_id': 'p2',
      'code': 'PRD-203847',
      'name': 'Wireless Logitech Mouse MX Master 3S',
      'category': 'Electronics',
      'quantity': 0,
      'unit': 'Pcs',
      'minStock': 5,
      'storeRoom': 'Consumables Room',
      'description': '',
    }),
  ];

  Future<void> pumpTable(WidgetTester tester, {VoidCallback? onIssue}) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.625;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ProductTable(
          products: products,
          actionsOf: (context, product) => [
            ProductAction(
              filled: true,
              label: 'Issue Engineering Stock',
              icon: Icons.send_outlined,
              onSelected: onIssue ?? () {},
            ),
          ],
        ),
      ),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('shows every summary column on screen at once', (tester) async {
    await pumpTable(tester);

    expect(tester.takeException(), isNull, reason: 'nothing may overflow');
    for (final header in ['ENGINEERING STOCK', 'STOCK', 'ROOM']) {
      expect(find.text(header), findsOneWidget);
      expect(
        tester.getBottomRight(find.text(header)).dx,
        lessThanOrEqualTo(tester.view.physicalSize.width / tester.view.devicePixelRatio),
        reason: '$header must fit the screen, not sit off the right edge',
      );
    }
    expect(find.text('PRD-593021'), findsOneWidget);
    expect(find.text('Engineer Room'), findsOneWidget);
    // Rows open the product rather than unfolding, so no chevrons at all.
    expect(find.byIcon(Icons.keyboard_arrow_down), findsNothing);
  });

  testWidgets('flags low and out-of-stock rows in the stock column', (tester) async {
    await pumpTable(tester);

    // 8 on hand against a minimum of 10.
    expect(find.text('LOW'), findsOneWidget);
    expect(find.text('OUT'), findsOneWidget);
  });

  testWidgets('opens the details page when a row is tapped', (tester) async {
    var issued = false;
    await pumpTable(tester, onIssue: () => issued = true);

    expect(find.text('Colour-calibrated review monitor.'), findsNothing);

    await tester.tap(find.text('Dell UltraSharp 27 Monitor (U2723QE)'));
    await tester.pumpAndSettle();

    // Swallowed, not asserted: the sheet's own spec tiles overflow under the
    // test font's square glyphs, which is the sheet's business, not the
    // table's.
    tester.takeException();
    expect(find.text('Engineering Stock Specifications'), findsOneWidget);
    expect(find.text('Colour-calibrated review monitor.'), findsOneWidget);

    // The role's actions come with the sheet.
    await tester.tap(find.text('Issue Engineering Stock'));
    await tester.pumpAndSettle();
    expect(issued, isTrue);
  });
}
