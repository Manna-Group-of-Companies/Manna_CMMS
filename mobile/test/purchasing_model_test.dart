import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/models/purchasing.dart';

void main() {
  group('Low value purchase', () {
    test('parses an ordered request with its lines and steps', () {
      final record = LowValuePurchase.fromJson(const {
        'id': 'LVP-2026-00012',
        'plant': 'Manna Rubber Unit 1',
        'department': 'Maintenance',
        'status': 'Ordered',
        'waitingOn': 'Delivery',
        'urgency': 'Urgent',
        'requiredBy': '2026-10-24',
        'purpose': 'Belts for the mixer',
        'raisedBy': 'manager@mannarubber.com',
        'raisedAt': '2026-10-20 09:15:00',
        'estTotal': 2400,
        'total': '2350.5',
        'lines': [
          {
            'idx': 1,
            'description': 'V-belt B42',
            'specification': 'Fenner',
            'qty': 2,
            'unit': 'Nos',
            'estRate': 1200,
            'estAmount': 2400,
            'rate': 1175.25,
            'amount': 2350.5,
            'remarks': '',
          },
        ],
        'order': {
          'vendorName': 'Kottayam Traders',
          'vendorContact': '98470 00000',
          'expectedOn': '2026-10-22',
          'remarks': '',
          'by': 'shantu@mannarubber.com',
          'at': '2026-10-20 11:00:00',
        },
        'received': null,
        'closed': null,
        'may': {'order': false, 'receive': true, 'reject': false, 'withdraw': false},
        'updatedAt': '2026-10-20 11:00:00',
      });

      expect(record.id, 'LVP-2026-00012');
      expect(record.isUrgent, isTrue);
      expect(record.isOpen, isTrue);
      expect(record.requiredBy, DateTime(2026, 10, 24));
      expect(record.total, 2350.5, reason: 'a numeric string still reads as a number');
      expect(record.hasActual, isTrue);
      expect(record.lines.single.unit, 'Nos');
      expect(record.lines.single.isPriced, isTrue);
      expect(record.order?.vendorName, 'Kottayam Traders');
      expect(record.received, isNull);
      expect(record.may.receive, isTrue);
      expect(record.may.order, isFalse);
      expect(record.may.any, isTrue);
    });

    test('a bare record defaults to a requested one nobody may move', () {
      final record = LowValuePurchase.fromJson(const {'id': 'LVP-1'});

      expect(record.status, 'Requested');
      expect(record.urgency, 'Normal');
      expect(record.lines, isEmpty);
      expect(record.order, isNull);
      expect(record.hasActual, isFalse);
      expect(record.may.any, isFalse);
    });

    test('options carry the units, statuses, line limit and plants', () {
      final options = LowValueOptions.fromJson(const {
        'units': ['Nos', 'Kg'],
        'statuses': ['Requested', 'Ordered', 'Received', 'Rejected', 'Withdrawn'],
        'maxLines': 30,
        'plants': [
          {'name': 'Manna Rubber Unit 1', 'code': 'MR1'},
        ],
      });

      expect(options.units, ['Nos', 'Kg']);
      expect(options.statuses, hasLength(5));
      expect(options.maxLines, 30);
      expect(options.plants.single.code, 'MR1');
    });
  });
}
