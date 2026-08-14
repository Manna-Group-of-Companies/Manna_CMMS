import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../core/api_client.dart';
import '../core/server_config.dart';

enum ServerStatus {
  /// Trying the known addresses.
  checking,

  /// Sweeping the local network for the API.
  scanning,

  /// `GET /api/health` answered.
  connected,

  /// Nothing answered; the user needs to start the API or enter an address.
  unreachable,
}

/// Keeps [ApiClient.baseUrl] pointed at a server that actually answers.
class ServerProvider extends ChangeNotifier {
  ServerProvider(this._api, {this.enabled = true, this.probeClient});

  final ApiClient _api;

  /// Tests inject their own transport, so discovery is switched off for them.
  final bool enabled;

  /// Health checks use a separate transport from [ApiClient] so a probe never
  /// inherits the auth header or the request timeout. Tests supply their own;
  /// in production this stays null and each probe opens a short-lived client.
  final http.Client? probeClient;

  ServerStatus _status = ServerStatus.checking;
  double _scanProgress = 0;
  bool _disposed = false;

  ServerStatus get status => _status;
  double get scanProgress => _scanProgress;
  String get baseUrl => _api.baseUrl;
  String get host => ServerConfig.hostOf(_api.baseUrl);

  /// A compile-time `--dart-define=API_URL` pin cannot be overridden in-app.
  bool get isPinned => ServerConfig.pinnedUrl != null;

  /// Resolves the base URL from the fast candidates only, so start-up stays
  /// snappy. A full network sweep is offered afterwards via [autoDetect].
  ///
  /// Completes once the URL is settled — callers await it before making their
  /// first request.
  Future<void> start() async {
    if (!enabled) {
      _set(ServerStatus.connected);
      return;
    }

    final pinned = ServerConfig.pinnedUrl;
    if (pinned != null) {
      _api.baseUrl = pinned;
      _set(await ServerConfig.ping(pinned, client: probeClient)
          ? ServerStatus.connected
          : ServerStatus.unreachable);
      return;
    }

    _set(ServerStatus.checking);

    final saved = await ServerConfig.saved();
    if (saved != null) {
      _api.baseUrl = saved;
      if (await ServerConfig.ping(saved, client: probeClient)) {
        _set(ServerStatus.connected);
        return;
      }
    }

    final found = await ServerConfig.firstReachable(
      ServerConfig.quickCandidates(),
      client: probeClient,
    );
    if (found != null) {
      await _apply(found);
      return;
    }

    // Nothing on this network: fall back to the hosted API, which may have been
    // put to sleep and needs longer than a LAN probe to answer.
    if (await ServerConfig.wakeCloud(client: probeClient)) {
      await _apply(ServerConfig.cloudUrl);
      return;
    }

    // Keep the last known address so error messages name something real.
    _api.baseUrl = saved ?? ServerConfig.fallback();
    _set(ServerStatus.unreachable);
  }

  /// Re-runs the fast checks, then sweeps the Wi-Fi subnet if they all fail.
  Future<bool> autoDetect() async {
    if (!enabled || isPinned) return _status == ServerStatus.connected;

    _set(ServerStatus.checking);

    final saved = await ServerConfig.saved();
    final quick = await ServerConfig.firstReachable([
      ?saved,
      ...ServerConfig.quickCandidates(),
    ], client: probeClient);
    if (quick != null) {
      await _apply(quick);
      return true;
    }

    // Prefer waking the hosted API over sweeping the subnet: it is reachable
    // from any network, and the sweep is the slow last resort.
    if (await ServerConfig.wakeCloud(client: probeClient)) {
      await _apply(ServerConfig.cloudUrl);
      return true;
    }

    _scanProgress = 0;
    _set(ServerStatus.scanning);

    final found = await ServerConfig.scanNetwork(
      client: probeClient,
      onProgress: (progress) {
        _scanProgress = progress;
        if (!_disposed) notifyListeners();
      },
    );

    if (found != null) {
      await _apply(found);
      return true;
    }

    _set(ServerStatus.unreachable);
    return false;
  }

  /// Points the app at an address the user typed. Returns false (and keeps the
  /// previous address) when it does not answer.
  Future<bool> useAddress(String raw) async {
    final normalized = ServerConfig.normalize(raw);
    if (normalized.isEmpty) return false;

    _set(ServerStatus.checking);
    if (!await ServerConfig.ping(
      normalized,
      timeout: ServerConfig.timeoutFor(normalized),
      client: probeClient,
    )) {
      _set(_status == ServerStatus.connected
          ? ServerStatus.connected
          : ServerStatus.unreachable);
      return false;
    }

    await _apply(normalized);
    return true;
  }

  /// Cheap liveness re-check of the current address.
  Future<bool> recheck() async {
    if (!enabled) return true;
    _set(ServerStatus.checking);
    final ok = await ServerConfig.ping(
      _api.baseUrl,
      timeout: ServerConfig.timeoutFor(_api.baseUrl),
      client: probeClient,
    );
    _set(ok ? ServerStatus.connected : ServerStatus.unreachable);
    return ok;
  }

  Future<void> _apply(String baseUrl) async {
    _api.baseUrl = baseUrl;
    if (!isPinned) await ServerConfig.save(baseUrl);
    _set(ServerStatus.connected);
  }

  void _set(ServerStatus status) {
    _status = status;
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
