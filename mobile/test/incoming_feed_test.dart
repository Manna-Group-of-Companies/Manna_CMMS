import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmaster/data/incoming_feed.dart';

IncomingItem _item(
  String id, {
  IncomingKind kind = IncomingKind.breakdown,
  String? state,
  String priority = 'Medium',
  DateTime? at,
}) =>
    IncomingItem(
      kind: kind,
      id: id,
      title: id,
      detail: '',
      plant: 'MRPPL',
      priority: priority,
      state: state ?? (kind == IncomingKind.breakdown ? 'Reported' : 'Requested'),
      waitingOn: '',
      raisedBy: 'plant@mannarubber.com',
      raisedAt: at,
      machineName: '',
    );

void main() {
  group('AnnouncedLedger', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('the first look rings only for the last hour - not the whole backlog', () async {
      final now = DateTime(2026, 10, 13, 17);
      final ledger = AnnouncedLedger('u1');
      final fresh = await ledger.takeFresh([
        _item('BD-old', at: now.subtract(const Duration(days: 2))),
        _item('BD-just-now', at: now.subtract(const Duration(minutes: 5))),
        _item('MR-old', kind: IncomingKind.request, at: now.subtract(const Duration(hours: 3))),
      ], now: now);
      expect(fresh.map((i) => i.id), ['BD-just-now']);
    });

    test('a record raised after the first look is announced once', () async {
      final ledger = AnnouncedLedger('u1');
      await ledger.takeFresh([_item('BD-1')]);

      final fresh = await ledger.takeFresh([_item('BD-1'), _item('BD-2')]);
      expect(fresh.map((i) => i.id), ['BD-2']);

      expect(await ledger.takeFresh([_item('BD-1'), _item('BD-2')]), isEmpty);
    });

    test('work already picked up is never announced', () async {
      final ledger = AnnouncedLedger('u1');
      await ledger.takeFresh(const []);
      final fresh = await ledger.takeFresh([_item('BD-3', state: 'Under Repair')]);
      expect(fresh, isEmpty);
    });

    test('a breakdown and a request with the same number are different records', () async {
      final ledger = AnnouncedLedger('u1');
      await ledger.takeFresh([_item('X-1')]);
      final fresh = await ledger.takeFresh([_item('X-1'), _item('X-1', kind: IncomingKind.request)]);
      expect(fresh.single.kind, IncomingKind.request);
    });

    test('signing out forgets the ledger, so the next account starts with a quiet first look',
        () async {
      final ledger = AnnouncedLedger('u1');
      await ledger.takeFresh([_item('BD-1')]);
      await ledger.clear();
      expect(await ledger.takeFresh([_item('BD-1'), _item('BD-2')]), isEmpty);
    });
  });

  test('the queue puts new work first, breakdowns before requests, then urgency, then newest', () {
    final now = DateTime(2026, 10, 13, 12);
    final items = [
      _item('MR-old', kind: IncomingKind.request, priority: 'High', at: now),
      _item('BD-repairing', state: 'Under Repair', priority: 'High', at: now),
      _item('BD-low', priority: 'Low', at: now),
      _item('BD-high-older', priority: 'High', at: now.subtract(const Duration(hours: 2))),
      _item('BD-high-newer', priority: 'High', at: now),
    ]..sort(compareIncoming);

    expect(items.map((i) => i.id), [
      'BD-high-newer',
      'BD-high-older',
      'BD-low',
      'MR-old',
      'BD-repairing',
    ]);
  });

  test('tapping goes to the record\'s own detail screen', () {
    expect(_item('BD-9').path, '/maintenance/breakdowns/BD-9');
    expect(_item('MR-9', kind: IncomingKind.request).path, '/maintenance/requests/MR-9');
  });
}
