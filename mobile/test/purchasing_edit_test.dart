import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/data/purchasing_repository.dart';
import 'package:stockmaster/models/purchasing.dart';
import 'package:stockmaster/screens/purchasing/low_value_purchases_screen.dart';

/// What editing and deleting a row of the Purchase Request Sheet put on the
/// wire: one `PUT` of only the columns that changed, and a `DELETE` of the row.
void main() {
  late List<http.Request> sent;

  PurchasingRepository buildRepository() {
    sent = [];
    final client = ApiClient(
      baseUrl: 'http://test/api',
      httpClient: MockClient((request) async {
        sent.add(request);
        if (request.method == 'DELETE') return http.Response(jsonEncode({'deleted': 'PRS-9'}), 200);
        final changes = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({..._row, ...changes}), 200);
      }),
    );
    return PurchasingRepository(client);
  }

  test('several columns go up in one PUT', () async {
    final repo = buildRepository();
    final updated = await repo.update('PRS-9', {'remarks': 'Called the vendor', 'expectedOn': ''});

    expect(sent, hasLength(1));
    expect(sent.single.method, 'PUT');
    expect(sent.single.url.path, '/api/low-value-purchases/PRS-9');
    expect(jsonDecode(sent.single.body), {'remarks': 'Called the vendor', 'expectedOn': ''});
    expect(updated.remarks, 'Called the vendor');
    expect(updated.expectedOn, isNull, reason: '"" empties the date');
  });

  test('one column still goes up on its own', () async {
    final repo = buildRepository();
    await repo.change('PRS-9', 'purchaseStatus', 'Order Placed');

    expect(jsonDecode(sent.single.body), {'purchaseStatus': 'Order Placed'});
  });

  test('a delete is a DELETE of the row', () async {
    final repo = buildRepository();
    await repo.delete('PRS-9');

    expect(sent.single.method, 'DELETE');
    expect(sent.single.url.path, '/api/low-value-purchases/PRS-9');
  });

  testWidgets('the edit form locks what may not be changed and saves only what was', (tester) async {
    tester.view.physicalSize = const Size(1200, 4000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final repo = buildRepository();
    final row = PurchaseRequest.fromJson(_row);
    PurchaseRequest? result;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                result = await showModalBottomSheet<PurchaseRequest>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => EditPurchaseRequestSheet(
                    repo: repo,
                    row: row,
                    options: PurchaseSheetOptions.fallback,
                  ),
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // Remarks is the one text column this person may type in; the rest of
    // the text columns, and the images, are locked.
    expect(find.byType(TextField), findsOneWidget);
    expect(find.byIcon(Icons.lock_outline), findsWidgets);
    expect(find.text('No changes'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Called the vendor');
    await tester.pump();
    expect(find.text('Save 1 change'), findsOneWidget);

    await tester.tap(find.text('Save 1 change'));
    await tester.pumpAndSettle();

    expect(sent, hasLength(1));
    expect(jsonDecode(sent.single.body), {'remarks': 'Called the vendor'});
    expect(result?.remarks, 'Called the vendor');
  });
}

const _row = <String, dynamic>{
  'id': 'PRS-9',
  'date': '2026-10-18',
  'type': 'Purchase Request',
  'company': 'Manna Rubber Products',
  'raisedByName': 'Anoop',
  'description': 'V-belt B42',
  'purpose': 'Mixer drive',
  'links': '',
  'priority': 'High',
  'approvalStatus': 'Approved',
  'purchaseStatus': 'Finding Vendors',
  'expectedOn': '2026-10-25',
  'receivedOn': null,
  'remarks': '',
  'editable': ['purchaseStatus', 'expectedOn', 'remarks'],
  'deletable': false,
};
