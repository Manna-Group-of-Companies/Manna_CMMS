import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmaster/data/incoming_feed.dart';

// What a push from the server turns into on the phone, and how it shares the
// ledger with the poll so one record never rings twice. The Firebase plumbing
// itself is not exercised here.

Map<String, dynamic> _breakdownPush() => {
      'kind': 'breakdown',
      'id': 'BD-2026-00240',
      'title': 'Cracker Mill 1',
      'detail': 'Bearing failure',
      'plant': 'Manna Rubber Products',
      'priority': 'High',
      'state': 'Reported',
      'waitingOn': 'Maintenance to start work',
      'raisedBy': 'mail@mannarubber.com',
      'raisedAt': '2026-10-14 09:13:27',
      'machineName': '',
    };

void main() {
  group('IncomingItem.fromPush', () {
    test('reads a breakdown the server pushed', () {
      final item = IncomingItem.fromPush(_breakdownPush())!;
      expect(item.isBreakdown, isTrue);
      expect(item.id, 'BD-2026-00240');
      expect(item.title, 'Cracker Mill 1');
      expect(item.awaitingPickup, isTrue);
      expect(item.path, '/maintenance/breakdowns/BD-2026-00240');
      expect(item.raisedAt, DateTime(2026, 10, 14, 9, 13, 27));
    });

    test('reads a request the server pushed', () {
      final item = IncomingItem.fromPush({
        'kind': 'request',
        'id': 'MR-2026-00241',
        'title': 'Replace conveyor belt',
        'state': 'Requested',
        'plant': 'Hi-Tech Rubber Industries',
      })!;
      expect(item.isBreakdown, isFalse);
      expect(item.awaitingPickup, isTrue);
      expect(item.path, '/maintenance/requests/MR-2026-00241');
      expect(item.raisedAt, isNull);
    });

    test('ignores a message that is not one of ours', () {
      expect(IncomingItem.fromPush({}), isNull);
      expect(IncomingItem.fromPush({'kind': 'breakdown'}), isNull);
      expect(IncomingItem.fromPush({'kind': 'weather', 'id': 'X-1'}), isNull);
    });
  });

  group('AnnouncedLedger.markAnnounced', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('the first push for a record rings; a second does not', () async {
      final ledger = AnnouncedLedger('u1');
      expect(await ledger.markAnnounced('breakdown:BD-1'), isTrue);
      expect(await ledger.markAnnounced('breakdown:BD-1'), isFalse);
    });

    test('a record the poll already rang for stays quiet when it is pushed', () async {
      final ledger = AnnouncedLedger('u1');
      final item = IncomingItem.fromPush(_breakdownPush())!;
      await ledger.takeFresh(const []); // the first look
      await ledger.takeFresh([item]); // the poll rings for it
      expect(await ledger.markAnnounced(item.key), isFalse);
    });

    test('a record the push rang for is not rung again by the next poll', () async {
      final ledger = AnnouncedLedger('u1');
      final item = IncomingItem.fromPush(_breakdownPush())!;
      await ledger.takeFresh(const []);
      expect(await ledger.markAnnounced(item.key), isTrue);
      expect(await ledger.takeFresh([item]), isEmpty);
    });
  });
}
