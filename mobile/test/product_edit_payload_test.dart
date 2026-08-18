import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:http/http.dart' as http;
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/data/repository.dart';
import 'package:stockmaster/models/models.dart';

/// What an edit is allowed to put on the wire.
///
/// The sheet shows the name read-only and offers the SOI1/SOP1 builder at
/// intake only, so a save must carry neither `name` nor `naming`. The API
/// re-checks a name whenever the payload sets one — sending an unchanged legacy
/// name back would hold a rack-number correction against a convention that name
/// predates, and refuse the save until somebody confirmed past it.
void main() {
  late Map<String, dynamic> sent;
  late String sentPath;

  StockRepository buildRepository() {
    sent = {};
    sentPath = '';

    final client = ApiClient(
      baseUrl: 'http://test/api',
      httpClient: MockClient((request) async {
        sentPath = request.url.path;
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'_id': 'p1', 'name': 'Old Name'}), 200);
      }),
    );
    return StockRepository(client);
  }

  /// A legacy row: named before SOI1/SOP1 and carrying builder parts, which is
  /// the case that used to send both fields back.
  ProductDraft draftFromLegacyProduct() {
    final draft = ProductDraft.fromProduct(
      Product.fromJson({
        '_id': 'p1',
        'code': 'PRD-100001',
        'name': 'Old Name',
        'category': 'Bearings',
        'subCategory': 'Deep Groove',
        'status': 'Good Condition',
        'rackNumber': 'A-1',
        'quantity': 7,
        'unit': 'Pcs',
        'minStock': 5,
        'storeRoom': 'Manna Rubber Park',
        'description': 'Spare for line 3',
        'image': '',
        'naming': {
          'itemName': 'BEARING',
          'type': 'DEEP GROOVE',
          'material': 'SS304',
          'dimensions': [
            {'value': '25', 'uom': 'MM'},
          ],
        },
      }),
    );
    return draft
      ..rackNumber = 'A-2'
      ..description = 'Moved to A-2';
  }

  test('an edit sends the fields the sheet offers and nothing else', () async {
    final repository = buildRepository();
    await repository.updateProduct(
      productId: 'p1',
      details: draftFromLegacyProduct(),
    );

    expect(sentPath, '/api/products/p1');
    expect(
      sent.keys.toSet(),
      {
        'category',
        'subCategory',
        'status',
        'rackNumber',
        'image',
        'description',
        'acknowledgeNaming',
        'allowDuplicate',
      },
    );
    expect(sent['rackNumber'], 'A-2');
    expect(sent['description'], 'Moved to A-2');
  });

  test('an edit never carries the name or the fields it was built from', () async {
    final repository = buildRepository();
    await repository.updateProduct(
      productId: 'p1',
      details: draftFromLegacyProduct(),
    );

    expect(sent.containsKey('name'), isFalse);
    expect(sent.containsKey('naming'), isFalse);
  });

  test('an edit never carries the figures that move real stock', () async {
    final repository = buildRepository();
    await repository.updateProduct(
      productId: 'p1',
      details: draftFromLegacyProduct(),
    );

    for (final field in ['quantity', 'storeRoom', 'unit', 'minStock', 'code']) {
      expect(sent.containsKey(field), isFalse, reason: '$field must not be sent');
    }
  });
}
