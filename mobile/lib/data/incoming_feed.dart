import 'package:shared_preferences/shared_preferences.dart';

import '../core/formatters.dart';
import '../models/maintenance.dart';
import 'maintenance_repository.dart';

/// What the Maintenance Manager is notified about: every open breakdown and
/// maintenance request, from every plant, merged into one list.
///
/// Read by the check while the app is open and by the background check while
/// it is not, so it holds no Flutter widgets and nothing from the widget tree.
/// The phone shows these on the Breakdowns and Requests screens; there is no
/// combined screen.

/// The one role this queue is for. The server already gives it every plant -
/// it is not on `PLANT_SCOPED_ROLES` - so nothing here narrows the list.
const incomingRole = 'Maintenance Manager';

bool canSeeIncoming(String role) => role == incomingRole;

enum IncomingKind { breakdown, request }

/// A breakdown or a request, flattened to what one row of the queue draws.
class IncomingItem {
  const IncomingItem({
    required this.kind,
    required this.id,
    required this.title,
    required this.detail,
    required this.plant,
    required this.priority,
    required this.state,
    required this.waitingOn,
    required this.raisedBy,
    required this.raisedAt,
    required this.machineName,
  });

  factory IncomingItem.fromBreakdown(Breakdown b) => IncomingItem(
        kind: IncomingKind.breakdown,
        id: b.id,
        title: b.machineName.isEmpty ? b.machine : b.machineName,
        detail: b.whatHappened,
        plant: b.plant,
        priority: b.priority,
        state: b.state,
        waitingOn: b.waitingOn,
        raisedBy: b.reportedBy,
        raisedAt: b.stoppedAt,
        machineName: '',
      );

  factory IncomingItem.fromRequest(MaintenanceRequest r) => IncomingItem(
        kind: IncomingKind.request,
        id: r.id,
        title: r.title,
        detail: r.whatIsNeeded,
        plant: r.plant,
        priority: r.priority,
        state: r.state,
        waitingOn: r.waitingOn,
        raisedBy: r.requestedBy,
        raisedAt: r.requestedAt,
        machineName: r.machineName,
      );

  /// One record as the server pushes it through Firebase - the fields of
  /// `breakdownMessage` / `requestMessage` in `server/integrations/push.js`,
  /// every value a string. Null for a message that is not one of ours.
  static IncomingItem? fromPush(Map<String, dynamic> data) {
    final kind = asString(data['kind']);
    final id = asString(data['id']);
    if (id.isEmpty || (kind != 'breakdown' && kind != 'request')) return null;
    return IncomingItem(
      kind: kind == 'breakdown' ? IncomingKind.breakdown : IncomingKind.request,
      id: id,
      title: asString(data['title']),
      detail: asString(data['detail']),
      plant: asString(data['plant']),
      priority: asString(data['priority']),
      state: asString(data['state']),
      waitingOn: asString(data['waitingOn']),
      raisedBy: asString(data['raisedBy']),
      raisedAt: parseDate(data['raisedAt']),
      machineName: asString(data['machineName']),
    );
  }

  final IncomingKind kind;
  final String id;
  final String title;
  final String detail;
  final String plant;
  final String priority;
  final String state;
  final String waitingOn;

  /// The plant manager who raised it, as ERPNext holds them - an email.
  final String raisedBy;

  /// When the machine stopped, or when the request was raised.
  final DateTime? raisedAt;

  /// A request may be about one machine; a breakdown's machine is its title.
  final String machineName;

  bool get isBreakdown => kind == IncomingKind.breakdown;

  /// Raised and not yet picked up by maintenance - the first state of each
  /// workflow. This is what a notification announces: everything after it is
  /// already in maintenance's hands.
  bool get awaitingPickup => isBreakdown ? state == 'Reported' : state == 'Requested';

  /// Where tapping it - in the list or on a notification - goes.
  String get path =>
      isBreakdown ? '/maintenance/breakdowns/$id' : '/maintenance/requests/$id';

  /// Unique across both kinds; a breakdown and a request never share a key
  /// even if ERPNext ever numbered them alike.
  String get key => '${kind.name}:$id';
}

const _priorityRank = {'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3};

/// Waiting for pickup first, then breakdowns ahead of planned work - a stopped
/// machine outranks anything planned - then by urgency, then newest first.
int compareIncoming(IncomingItem a, IncomingItem b) {
  if (a.awaitingPickup != b.awaitingPickup) return a.awaitingPickup ? -1 : 1;
  if (a.isBreakdown != b.isBreakdown) return a.isBreakdown ? -1 : 1;
  final pa = _priorityRank[a.priority] ?? 4;
  final pb = _priorityRank[b.priority] ?? 4;
  if (pa != pb) return pa - pb;
  final ta = a.raisedAt?.millisecondsSinceEpoch ?? 0;
  final tb = b.raisedAt?.millisecondsSinceEpoch ?? 0;
  return tb - ta;
}

/// Every open breakdown and request, both fetched at once and merged.
Future<List<IncomingItem>> fetchIncoming(MaintenanceRepository repo) async {
  final results = await Future.wait([
    repo.breakdowns(openOnly: true),
    repo.requests(openOnly: true),
  ]);
  final items = [
    for (final b in results[0] as List<Breakdown>) IncomingItem.fromBreakdown(b),
    for (final r in results[1] as List<MaintenanceRequest>) IncomingItem.fromRequest(r),
  ]..sort(compareIncoming);
  return items;
}

/// Which waiting records this phone has already announced, per account.
///
/// Kept in shared preferences because two isolates read it: the app while it
/// is open and the background check while it is not. Both reload before
/// reading, and both write the same answer, so the worst a race can do is
/// announce one record twice - and the notification id is derived from the
/// record, so the second simply replaces the first on the tray.
class AnnouncedLedger {
  AnnouncedLedger(this.userId);

  final String userId;

  String get _prefsKey => 'incoming_announced_$userId';

  /// The waiting records in [items] this phone has not announced yet.
  ///
  /// The first look on a phone - a fresh install, a new sign-in - announces
  /// only what was raised in the last [firstLookWindow]: the rest is recorded
  /// as seen, otherwise the Maintenance Manager would get a notification for
  /// every open record in the group the moment they sign in. Not nothing at
  /// all: on 13 Oct 2026 every check had failed until a breakdown came in, and
  /// the first one that worked swallowed it in silence.
  ///
  /// The ledger is then trimmed to what is still waiting. A record that has
  /// been picked up never goes back to its first state, so forgetting it
  /// cannot announce it again, and the list does not grow for ever.
  static const firstLookWindow = Duration(hours: 1);

  Future<List<IncomingItem>> takeFresh(List<IncomingItem> items, {DateTime? now}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();

    final waiting = items.where((i) => i.awaitingPickup).toList();
    final stored = prefs.getStringList(_prefsKey);
    await prefs.setStringList(_prefsKey, [for (final i in waiting) i.key]);

    if (stored == null) {
      final since = (now ?? DateTime.now()).subtract(firstLookWindow);
      return waiting.where((i) => i.raisedAt != null && i.raisedAt!.isAfter(since)).toList();
    }
    final known = stored.toSet();
    return waiting.where((i) => !known.contains(i.key)).toList();
  }

  /// Records a key a push has just rung for, so the next poll does not ring
  /// for it again. True when it was not yet known - false means the poll got
  /// there first and the push should stay quiet.
  ///
  /// A push that lands in the moment between signing in and the first poll
  /// starts the ledger early, and that first poll then rings for whatever
  /// else was waiting. Too narrow a window to be worth guarding.
  Future<bool> markAnnounced(String key) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    final stored = prefs.getStringList(_prefsKey) ?? const [];
    if (stored.contains(key)) return false;
    await prefs.setStringList(_prefsKey, [...stored, key]);
    return true;
  }

  /// Signing out forgets this account's ledger, so the next person to sign in
  /// on the phone starts from a clean first look.
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefsKey);
  }
}
