import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/api_client.dart';
import '../core/incoming_alerts.dart';
import '../core/incoming_background.dart';
import '../core/push_messages.dart';
import '../data/device_repository.dart';
import '../data/incoming_feed.dart';
import '../data/maintenance_repository.dart';
import '../models/models.dart';

/// Rings the Maintenance Manager's phone when a plant manager reports a
/// breakdown or raises a request.
///
/// Registers the phone for push (see `push_messages.dart`), which is what
/// rings instantly, and polls the API once every [_pollInterval] while the app
/// is open as the fallback. Pauses the poll when the app goes to the
/// background - WorkManager takes over there - and checks at once on the way
/// back.
///
/// Every other role gets an idle watcher: no polling, no schedule.
class IncomingWatcher extends ChangeNotifier with WidgetsBindingObserver {
  IncomingWatcher(ApiClient api, {this.enabled = true})
      : _repo = MaintenanceRepository(api),
        _devices = DeviceRepository(api);

  static const _pollInterval = Duration(seconds: 20);

  final MaintenanceRepository _repo;
  final DeviceRepository _devices;

  /// The push token the server was last given, so sign-out can take it back.
  String? _pushToken;
  StreamSubscription<String>? _tokenRefresh;

  /// False under widget tests, which must not reach platform channels - the
  /// same rule `ServerProvider` follows. The queue still loads on [refresh].
  final bool enabled;

  AppUser? _user;
  Timer? _timer;
  bool _observing = false;
  bool _disposed = false;
  bool _busy = false;

  List<IncomingItem> _items = const [];
  bool _loaded = false;
  String _error = '';

  List<IncomingItem> get items => _items;
  bool get loaded => _loaded;
  String get error => _error;
  bool get active => _user != null && canSeeIncoming(_user!.role);

  /// Called by the provider wiring whenever the signed-in user changes.
  void syncUser(AppUser? user) {
    if (user?.id == _user?.id && user?.role == _user?.role) return;
    final previous = _user;
    _user = user;
    _timer?.cancel();
    _timer = null;
    _items = const [];
    _loaded = false;
    _error = '';

    if (!active) {
      if (enabled) {
        IncomingBackground.stop();
        if (previous != null) AnnouncedLedger(previous.id).clear();
      }
      scheduleMicrotask(_notify);
      return;
    }

    if (enabled) {
      if (!_observing) {
        WidgetsBinding.instance.addObserver(this);
        _observing = true;
      }
      IncomingAlerts.requestPermission();
      IncomingBackground.start();
      _registerPush();
      _timer = Timer.periodic(_pollInterval, (_) => refresh());
    }
    scheduleMicrotask(refresh);
  }

  /// Re-reads the queue and announces anything new. Quiet: a failed poll keeps
  /// the last list and the next tick tries again.
  Future<void> refresh() async {
    final user = _user;
    if (user == null || !canSeeIncoming(user.role) || _busy) return;
    _busy = true;
    try {
      final items = await fetchIncoming(_repo);
      if (_user?.id != user.id) return; // signed out mid-request
      _items = items;
      _error = '';
      if (enabled) {
        await IncomingAlerts.announce(await AnnouncedLedger(user.id).takeFresh(items));
      }
    } on ApiException catch (e) {
      _error = e.message;
      debugPrint('Incoming check failed: ${e.message}');
    } catch (e) {
      _error = '$e';
      debugPrint('Incoming check failed: $e');
    } finally {
      _busy = false;
      _loaded = true;
      _notify();
    }
  }

  Future<void> _registerPush() async {
    final token = await PushMessages.token();
    if (token == null || !active) return;
    _pushToken = token;
    _tokenRefresh ??= PushMessages.tokenRefresh.listen((fresh) {
      _pushToken = fresh;
      if (active) _sendToken(fresh);
    });
    await _sendToken(token);
  }

  Future<void> _sendToken(String token) async {
    try {
      final info = await PackageInfo.fromPlatform();
      await _devices.register(
        token,
        platform: 'android',
        appVersion: '${info.version}+${info.buildNumber}',
      );
    } catch (error) {
      // The next launch tries again; until then the phone polls.
      debugPrint('Could not register this phone for push: $error');
    }
  }

  /// Takes the phone off the server's list. Run before the session is
  /// cleared, while the request can still be signed - `AuthProvider` calls it
  /// through `beforeLogout`.
  Future<void> unregisterPush() async {
    final token = _pushToken;
    if (token == null) return;
    // Cleared first: a 401 on this request would sign the user out, which
    // would call this again.
    _pushToken = null;
    try {
      await _devices.unregister(token);
    } catch (error) {
      debugPrint('Could not withdraw this phone from push: $error');
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!active) return;
    if (state == AppLifecycleState.resumed) {
      refresh();
      _timer ??= Timer.periodic(_pollInterval, (_) => refresh());
    } else if (state == AppLifecycleState.paused) {
      _timer?.cancel();
      _timer = null;
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _tokenRefresh?.cancel();
    if (_observing) WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
