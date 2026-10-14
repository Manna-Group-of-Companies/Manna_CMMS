import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/incoming_feed.dart';
import '../models/models.dart';
import '../state/auth_provider.dart';
import 'incoming_alerts.dart';

/// The instant alert: a breakdown or request the server pushes to this phone
/// through Firebase the moment a plant raises it.
///
/// Google keeps one connection open to every Android phone and wakes the app
/// through it, which is what reaches a locked phone with the app closed -
/// the polling in `IncomingWatcher` and `incoming_background.dart` cannot,
/// and both stay on as the fallback for a push that never arrives.
///
/// The server sends data only, never a ready-made notification, so the
/// notification is drawn here by the same code, on the same channels, with
/// the same tap-to-open as the polled ones, and through the same ledger: a
/// record the poll already rang for is not rung again by the push, nor the
/// other way round.
///
/// Needs `android/app/google-services.json` from the Firebase project. Without
/// it Firebase refuses to start, this logs once and stays off, and the app
/// carries on polling.

/// Runs in its own isolate, started by Android for this one message when the
/// app is closed. Nothing from the running app is there - Firebase included -
/// so it is set up again before the message is read.
@pragma('vm:entry-point')
Future<void> pushBackgroundHandler(RemoteMessage message) async {
  if (!await PushMessages._init()) return;
  await PushMessages.deliver(message.data);
}

abstract final class PushMessages {
  static bool _ready = false;
  static bool _tried = false;

  /// Firebase is up and messages can arrive. False until [start] has run, and
  /// for good when the phone has no Firebase config.
  static bool get ready => _ready;

  static Future<bool> _init() async {
    if (_ready) return true;
    if (_tried || !IncomingAlerts.supported) return false;
    _tried = true;
    try {
      await Firebase.initializeApp();
      _ready = true;
    } catch (error) {
      debugPrint('Push notifications are off: $error');
    }
    return _ready;
  }

  /// Called once from `main()`, before the app is built, so the background
  /// handler is registered before the app can be sent to the background.
  static Future<void> start() async {
    if (!await _init()) return;
    FirebaseMessaging.onBackgroundMessage(pushBackgroundHandler);
    // With the app on screen, Android hands the message to the app instead
    // of the tray; it is drawn here, the same as one that arrived closed.
    FirebaseMessaging.onMessage.listen((message) => deliver(message.data));
  }

  /// This phone's address, for the server. Null when push is off.
  static Future<String?> token() async {
    if (!await _init()) return null;
    try {
      return await FirebaseMessaging.instance.getToken();
    } catch (error) {
      debugPrint('No push token: $error');
      return null;
    }
  }

  /// Firebase replaces a token now and then; the server has to hear of it.
  static Stream<String> get tokenRefresh =>
      _ready ? FirebaseMessaging.instance.onTokenRefresh : const Stream.empty();

  /// Draws the notification for one pushed record - unless nobody who should
  /// see it is signed in on this phone, or it has already been rung for.
  static Future<void> deliver(Map<String, dynamic> data) async {
    final item = IncomingItem.fromPush(data);
    if (item == null) return;

    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    final stored = prefs.getString(kUserPrefsKey);
    if (stored == null) return;
    final user = AppUser.fromJson(jsonDecode(stored) as Map<String, dynamic>);
    if (!canSeeIncoming(user.role)) return;

    if (await AnnouncedLedger(user.id).markAnnounced(item.key)) {
      await IncomingAlerts.announce([item]);
    }
  }
}
