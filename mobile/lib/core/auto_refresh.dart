import 'dart:async';

import 'package:flutter/widgets.dart';

/// How often a screen re-reads the API when nothing else prompts it.
const kRefreshInterval = Duration(seconds: 10);

/// Keeps a screen in step with the backend without the user pulling to refresh.
///
/// The Admin console and this app write to the same records, so a screen that
/// fetched once in `initState` would drift as soon as the Admin changed
/// something. Mix this in and implement [refreshData]; it is called:
///
///   - on an interval while the app is in the foreground,
///   - immediately when the app is resumed from the background.
///
/// The timer is cancelled while the app is not in the foreground — a
/// backgrounded phone does not need to keep hitting the API, and the resume
/// hook brings it straight back up to date.
///
/// [refreshData] must not show a spinner or an error toast: it runs
/// unattended, so failures should be swallowed (the next tick retries).
mixin AutoRefresh<T extends StatefulWidget> on State<T>, WidgetsBindingObserver {
  Timer? _refreshTimer;

  /// Re-read whatever this screen displays. Called unattended — keep it quiet.
  Future<void> refreshData();

  /// Override to change the cadence for a particular screen.
  Duration get refreshInterval => kRefreshInterval;

  /// Call from `initState`, after the first load has been kicked off.
  void startAutoRefresh() {
    WidgetsBinding.instance.addObserver(this);
    _startTimer();
  }

  /// Call from `dispose`.
  void stopAutoRefresh() {
    _stopTimer();
    WidgetsBinding.instance.removeObserver(this);
  }

  void _startTimer() {
    _refreshTimer ??= Timer.periodic(refreshInterval, (_) {
      if (mounted) refreshData();
    });
  }

  void _stopTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = null;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed) {
      if (mounted) refreshData();
      _startTimer();
    } else {
      _stopTimer();
    }
  }
}
