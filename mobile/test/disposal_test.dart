import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/core/formatters.dart';
import 'package:stockmaster/models/models.dart';

/// Builds an issue row the way `GET /issues` sends one, so the parsing and the
/// settlement arithmetic are exercised together rather than in isolation.
IssueRecord issueFrom({
  required int quantity,
  int returned = 0,
  int consumed = 0,
  int scrapped = 0,
  List<Map<String, dynamic>> disposals = const [],
}) =>
    IssueRecord.fromJson({
      '_id': 'i1',
      'issueNumber': 'ISS-100200',
      'quantity': quantity,
      'recipient': 'Line 3',
      'returnedQuantity': returned,
      'consumedQuantity': consumed,
      'scrappedQuantity': scrapped,
      'disposals': disposals,
    });

void main() {
  group('formatCurrency', () {
    test('groups rupees the Indian way', () {
      expect(formatCurrency(120450), '₹1,20,450');
      expect(formatCurrency(2400), '₹2,400');
      expect(formatCurrency(10000000), '₹1,00,00,000');
    });

    test('keeps paise only when there are any', () {
      expect(formatCurrency(748.5), '₹748.50');
      expect(formatCurrency(748), '₹748');
    });

    test('handles zero and null', () {
      expect(formatCurrency(0), '₹0');
      expect(formatCurrency(null), '—');
    });
  });

  group('IssueRecord settlement', () {
    test('counts all three routes as settled', () {
      final issue = issueFrom(quantity: 10, returned: 2, consumed: 3, scrapped: 1);
      expect(issue.settledQuantity, 6);
      expect(issue.outstanding, 4);
      expect(issue.isSettled, isFalse);
      expect(issue.canReturn, isTrue);
    });

    test('an entirely consumed issue is settled, not outstanding', () {
      final issue = issueFrom(quantity: 5, consumed: 5);
      expect(issue.outstanding, 0);
      expect(issue.isSettled, isTrue);
      // The server's returnStatus still says "Not Returned" here — settlement
      // must not be inferred from it.
      expect(issue.isReturned, isFalse);
      expect(issue.canReturn, isFalse);
    });

    test('rows written before the new counters existed still read correctly', () {
      final legacy = IssueRecord.fromJson({
        '_id': 'i2',
        'issueNumber': 'ISS-100201',
        'quantity': 5,
        'recipient': 'Line 1',
        'returnedQuantity': 5,
        'returnStatus': 'Returned',
      });
      expect(legacy.consumedQuantity, 0);
      expect(legacy.scrappedQuantity, 0);
      expect(legacy.outstanding, 0);
      expect(legacy.isSettled, isTrue);
    });

    test('never reports negative outstanding if the counters over-settle', () {
      final issue = issueFrom(quantity: 3, returned: 2, consumed: 2);
      expect(issue.outstanding, 0);
    });
  });

  group('DisposalRecord', () {
    test('parses a scrap and totals its value onto the issue', () {
      final issue = issueFrom(
        quantity: 10,
        scrapped: 3,
        disposals: [
          {
            '_id': 'd1',
            'disposalNumber': 'SCR-100001',
            'type': 'Scrapped',
            'quantity': 3,
            'unitCost': 249.5,
            'value': 748.5,
            'disposedBy': {'name': 'A. Kumar'},
          },
        ],
      );

      expect(issue.disposals, hasLength(1));
      final scrap = issue.disposals.single;
      expect(scrap.isScrap, isTrue);
      expect(scrap.isConsumption, isFalse);
      expect(scrap.disposedByName, 'A. Kumar');
      expect(issue.scrapValue, 748.5);
      expect(formatCurrency(issue.scrapValue), '₹748.50');
    });

    test('consumption carries no scrap value', () {
      final issue = issueFrom(
        quantity: 4,
        consumed: 4,
        disposals: [
          {
            '_id': 'd2',
            'disposalNumber': 'CON-100002',
            'type': 'Consumed',
            'quantity': 4,
            'unitCost': 50,
            'value': 200,
          },
        ],
      );

      expect(issue.disposals.single.isConsumption, isTrue);
      // Consumption is logged and costed, but it is not scrap and must never
      // land in the scrap metric.
      expect(issue.scrapValue, 0);
    });

    test('falls back to Unknown once the account is deleted', () {
      final issue = issueFrom(
        quantity: 1,
        scrapped: 1,
        disposals: [
          {
            '_id': 'd3',
            'disposalNumber': 'SCR-100003',
            'type': 'Scrapped',
            'quantity': 1,
            'value': 10,
            'disposedBy': null,
          },
        ],
      );
      expect(issue.disposals.single.disposedByName, 'Unknown');
    });
  });

  group('ScrapSummary', () {
    test('parses the three breakdowns and the overall total', () {
      final summary = ScrapSummary.fromJson({
        'total': {'quantity': 9, 'value': 3200.75, 'events': 4},
        'byItem': [
          {'name': 'BEARING', 'code': 'P-1', 'quantity': 6, 'value': 2400.0, 'events': 2},
        ],
        'byStoreRoom': [
          {'storeRoom': 'Engineer Room', 'quantity': 9, 'value': 3200.75, 'events': 4},
        ],
        'byPeriod': [
          {'period': '2026-07', 'quantity': 4, 'value': 1200.0, 'events': 2},
          {'period': '2026-08', 'quantity': 5, 'value': 2000.75, 'events': 2},
        ],
        'groupBy': 'month',
      });

      expect(summary.isEmpty, isFalse);
      expect(summary.totalValue, 3200.75);
      expect(summary.byItem.single.label, 'BEARING');
      expect(summary.byItem.single.code, 'P-1');
      expect(summary.byStoreRoom.single.label, 'Engineer Room');
      expect(summary.byPeriod.map((r) => r.label), ['2026-07', '2026-08']);
      expect(summary.groupBy, 'month');
    });

    test('an empty report parses rather than throwing', () {
      final summary = ScrapSummary.fromJson({
        'total': {'quantity': 0, 'value': 0, 'events': 0},
        'byItem': [],
        'byStoreRoom': [],
        'byPeriod': [],
      });
      expect(summary.isEmpty, isTrue);
      expect(summary.totalValue, 0);
      expect(summary.groupBy, 'month');
    });
  });
}
