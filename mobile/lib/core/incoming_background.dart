import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import '../data/incoming_feed.dart';
import '../data/maintenance_repository.dart';
import '../models/models.dart';
import '../state/auth_provider.dart';
import 'api_client.dart';
import 'incoming_alerts.dart';
import 'server_config.dart';

/// The check for new breakdowns and requests while the app is closed.
///
/// Android's WorkManager wakes the app roughly every fifteen minutes - the
/// shortest period it allows - when the phone has a connection, and this reads
/// every open breakdown and request and rings for anything new. Doze
/// can stretch the gap on a phone left untouched; opening the app checks at
/// once. Instant delivery to a closed app needs a push service (Firebase Cloud
/// Messaging), which this system does not have yet.
const _taskName = 'incoming-check';

/// Runs in a background isolate with no widget tree, no providers and no
/// router - only what is on disk: the session the app saved and the server
/// address it last settled on.
@pragma('vm:entry-point')
void incomingTaskDispatcher() {
  Workmanager().executeTask((task, _) async {
    ApiClient? api;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.reload();
      final token = prefs.getString(kTokenPrefsKey);
      final stored = prefs.getString(kUserPrefsKey);
      if (token == null || stored == null) return true;

      final user = AppUser.fromJson(jsonDecode(stored) as Map<String, dynamic>);
      if (!canSeeIncoming(user.role)) return true;

      api = ApiClient(baseUrl: await ServerConfig.saved() ?? defaultApiBaseUrl())
        ..token = token;
      final items = await fetchIncoming(MaintenanceRepository(api));
      final fresh = await AnnouncedLedger(user.id).takeFresh(items);
      await IncomingAlerts.announce(fresh);
    } catch (error) {
      // Unattended: an unreachable server or an expired session waits for the
      // next run, which is the same thing a retry would do.
      debugPrint('Background incoming check failed: $error');
    } finally {
      api?.dispose();
    }
    return true;
  });
}

abstract final class IncomingBackground {
  static bool _initialized = false;

  static Future<void> _init() async {
    if (_initialized || !IncomingAlerts.supported) return;
    await Workmanager().initialize(incomingTaskDispatcher);
    _initialized = true;
  }

  /// Starts the periodic check for this phone. Keeps an existing schedule
  /// rather than restarting its clock on every launch.
  static Future<void> start() async {
    if (!IncomingAlerts.supported) return;
    await _init();
    await Workmanager().registerPeriodicTask(
      _taskName,
      _taskName,
      frequency: const Duration(minutes: 15),
      constraints: Constraints(networkType: NetworkType.connected),
      existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
    );
  }

  /// Signing out, or an account that is not the Maintenance Manager.
  static Future<void> stop() async {
    if (!IncomingAlerts.supported) return;
    await _init();
    await Workmanager().cancelByUniqueName(_taskName);
  }
}
