import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/models/models.dart';
import 'package:stockmaster/widgets/issue_table.dart';

/// The grid has to hold a phone screen without scrolling sideways, so the
/// checks here are about fitting: every summary column visible at once, and the
/// columns that did not fit reachable by unfolding the row.
void main() {
  final issues = [
    IssueRecord.fromJson(const {
      '_id': '1',
      'issueNumber': 'ISS-619470',
      'product': {
        'name': 'Hydraulic Hose 3/4 inch braided',
        'code': 'PRD-173390',
        'unit': 'pcs',
        'storeRoom': 'Engineer Room',
      },
      'quantity': 12,
      'recipient': 'Maintenance',
      'purpose': 'Line 3 press rebuild, urgent',
      'supervisor': {'name': 'Paul Sunny', 'email': 'paul@manna.com'},
      'returnStatus': 'Partially Returned',
      'returnedQuantity': 5,
      'createdAt': '2026-08-11T11:03:00.000Z',
      'isMine': true,
    }),
    IssueRecord.fromJson(const {
      '_id': '2',
      'issueNumber': 'ISS-433649',
      'quantity': 3,
      'recipient': 'Electrical',
      'purpose': '',
      'returnStatus': 'Not Returned',
      'createdAt': '2026-08-12T09:00:00.000Z',
      'isMine': false,
    }),
  ];

  Future<void> pumpTable(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.625;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: IssueTable(
          issues: issues,
          showSupervisor: true,
          onReturn: (_) async {},
        ),
      ),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('shows every summary column on screen at once', (tester) async {
    await pumpTable(tester);

    expect(tester.takeException(), isNull, reason: 'nothing may overflow');
    for (final header in ['PRODUCT', 'QTY', 'RECIPIENT', 'STATUS']) {
      expect(find.text(header), findsOneWidget);
      expect(
        tester.getBottomRight(find.text(header)).dx,
        lessThanOrEqualTo(tester.view.physicalSize.width / tester.view.devicePixelRatio),
        reason: '$header must fit the screen, not sit off the right edge',
      );
    }
    expect(find.text('−12'), findsOneWidget);
    expect(find.text('Maintenance'), findsOneWidget);
    expect(find.text('Partial'), findsOneWidget);
  });

  testWidgets('unfolds a row to the fields that did not fit across', (tester) async {
    await pumpTable(tester);

    // Folded: the wide fields are not on screen.
    expect(find.text('ISS-619470'), findsNothing);
    expect(find.text('Return Stock'), findsNothing);

    await tester.tap(find.text('Maintenance'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('ISS-619470'), findsOneWidget);
    expect(find.text('Paul Sunny (you)'), findsOneWidget);
    expect(find.text('Line 3 press rebuild, urgent'), findsOneWidget);
    expect(find.text('Partially Returned'), findsOneWidget);
    expect(find.text('5 of 12 pcs'), findsOneWidget);
    expect(find.text('Return Stock'), findsOneWidget);

    // Folding it back leaves only the summary again.
    await tester.tap(find.text('Maintenance'));
    await tester.pumpAndSettle();
    expect(find.text('ISS-619470'), findsNothing);
  });

  testWidgets('a fully deleted product still renders its row', (tester) async {
    await pumpTable(tester);

    expect(find.text('Deleted Product'), findsOneWidget);

    await tester.tap(find.text('Electrical'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('ISS-433649'), findsOneWidget);
    // No product to open, so the sheet button is withheld.
    expect(find.text('Product'), findsNothing);
    expect(find.text('Return Stock'), findsOneWidget);
  });
}
