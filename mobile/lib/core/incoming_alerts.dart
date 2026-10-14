import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../data/incoming_feed.dart';

/// Phone notifications for new breakdowns and maintenance requests.
///
/// Raised on the phone itself from what the app reads off the API - there is
/// no push service behind this. The app checks while it is open (see
/// `IncomingWatcher`) and Android's WorkManager wakes it to check while it is
/// not (see `incoming_background.dart`).
///
/// Two channels rather than one, so the Maintenance Manager can give a stopped
/// machine its own sound in Android's settings and leave planned work quieter.
abstract final class IncomingAlerts {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;

  static const _breakdownChannel = AndroidNotificationChannel(
    'breakdowns',
    'Breakdowns',
    description: 'A plant manager has reported a stopped machine.',
    importance: Importance.max,
  );

  static const _requestChannel = AndroidNotificationChannel(
    'maintenance_requests',
    'Maintenance requests',
    description: 'A plant manager has raised planned maintenance work.',
    importance: Importance.high,
  );

  /// Where tapping a notification goes - set by the app once its router
  /// exists. Null in the background isolate, where there is nothing to open.
  static ValueChanged<String>? onOpen;

  /// Only Android is served; the app is not built for anything else.
  static bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// Safe to call more than once and from either isolate.
  static Future<void> init() async {
    if (_ready || !supported) return;
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ),
      onDidReceiveNotificationResponse: (response) {
        final path = response.payload;
        if (path != null && path.isNotEmpty) onOpen?.call(path);
      },
    );
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await android?.createNotificationChannel(_breakdownChannel);
    await android?.createNotificationChannel(_requestChannel);
    _ready = true;
  }

  /// Asks for the Android 13+ notification permission. A refusal is the
  /// person's to make; the queue still works, it just cannot ring.
  static Future<void> requestPermission() async {
    if (!supported) return;
    await init();
    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.requestNotificationsPermission();
  }

  /// The screen a notification opened the app on, when it was launched by one.
  static Future<String?> launchPath() async {
    if (!supported) return null;
    await init();
    final details = await _plugin.getNotificationAppLaunchDetails();
    if (details?.didNotificationLaunchApp != true) return null;
    final path = details?.notificationResponse?.payload;
    return (path == null || path.isEmpty) ? null : path;
  }

  /// Rings once per new record, or once for the lot when a backlog arrives at
  /// once - a phone that was off all night should not buzz twenty times.
  static Future<void> announce(List<IncomingItem> fresh) async {
    if (fresh.isEmpty || !supported) return;
    await init();

    if (fresh.length > 3) {
      final breakdowns = fresh.where((i) => i.isBreakdown).length;
      final requests = fresh.length - breakdowns;
      await _plugin.show(
        id: 0,
        title: '${fresh.length} new for maintenance',
        body: [
          if (breakdowns > 0) '$breakdowns breakdown${breakdowns == 1 ? '' : 's'}',
          if (requests > 0) '$requests request${requests == 1 ? '' : 's'}',
        ].join(' and '),
        notificationDetails: _details(breakdowns > 0 ? _breakdownChannel : _requestChannel),
        payload: breakdowns > 0 ? '/maintenance/breakdowns' : '/maintenance/requests',
      );
      return;
    }

    for (final item in fresh) {
      final title = item.isBreakdown
          ? 'Breakdown at ${item.plant}: ${item.title}'
          : 'Request from ${item.plant}: ${item.title}';
      final by = item.raisedBy.isEmpty ? '' : ' — ${item.raisedBy}';
      await _plugin.show(
        id: _idFor(item.key),
        title: title,
        body: '${item.detail}$by',
        notificationDetails: _details(
          item.isBreakdown ? _breakdownChannel : _requestChannel,
          longText: '${item.detail}$by',
        ),
        payload: item.path,
      );
    }
  }

  static NotificationDetails _details(AndroidNotificationChannel channel, {String? longText}) =>
      NotificationDetails(
        android: AndroidNotificationDetails(
          channel.id,
          channel.name,
          channelDescription: channel.description,
          importance: channel.importance,
          priority: channel.importance == Importance.max ? Priority.max : Priority.high,
          category: AndroidNotificationCategory.message,
          styleInformation: longText == null ? null : BigTextStyleInformation(longText),
        ),
      );

  /// A stable id per record, the same in both isolates - `String.hashCode`
  /// makes no such promise - so announcing a record twice replaces the first
  /// notification instead of stacking a second. Never 0, which the summary
  /// uses.
  static int _idFor(String key) {
    var hash = 0x811c9dc5;
    for (final unit in key.codeUnits) {
      hash = ((hash ^ unit) * 0x01000193) & 0x7fffffff;
    }
    return hash == 0 ? 1 : hash;
  }
}
