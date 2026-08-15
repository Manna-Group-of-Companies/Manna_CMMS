import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'lan_discovery.dart';

/// Where the API lives, and how to find it.
///
/// The old build hardcoded `10.0.2.2` (which only works on the Android
/// *emulator*) and `localhost` everywhere else. On a physical phone neither
/// address routes to the developer machine, so every request hung until the
/// client timed out — surfacing as "The server took too long to respond".
///
/// Resolution order:
///   1. `--dart-define=API_URL=...`      (compile-time pin, wins outright)
///   2. the address the user saved in the app
///   3. `--dart-define=API_HOST=...` and the platform defaults
///   4. the hosted server on Render
///   5. a sweep of the device's own Wi-Fi subnet for the API port
abstract final class ServerConfig {
  static const prefsKey = 'api_base_url';

  static const _envUrl = String.fromEnvironment('API_URL');
  static const _envHost = String.fromEnvironment('API_HOST');

  /// Matches `PORT` in `server/.env`.
  static const port = int.fromEnvironment('API_PORT', defaultValue: 5000);

  /// The deployed StockMaster API. Reachable from anywhere, so it is what the
  /// app settles on unless a server answers on the local network first.
  static const cloudUrl = 'https://manna-cmms.onrender.com/api';

  /// Render puts free instances to sleep after a spell of inactivity, and the
  /// request that wakes one can take the better part of a minute — far longer
  /// than the LAN probes are given.
  static const cloudWakeTimeout = Duration(seconds: 45);

  /// Pings [cloudUrl] with enough patience for a sleeping instance to boot.
  static Future<bool> wakeCloud({http.Client? client}) =>
      ping(cloudUrl, timeout: cloudWakeTimeout, client: client);

  /// How long a single address is given to answer. LAN probes must stay snappy
  /// — a dead one is refused instantly anyway — while a remote host is allowed
  /// the cold start it may need.
  static Duration timeoutFor(String baseUrl) {
    final host = hostOf(baseUrl);
    final isLocal =
        host == 'localhost' || host == '127.0.0.1' || _ipv4.hasMatch(host);
    return isLocal ? const Duration(seconds: 2) : cloudWakeTimeout;
  }

  /// A compile-time pin disables discovery entirely.
  static String? get pinnedUrl => _envUrl.isEmpty ? null : normalize(_envUrl);

  static final _ipv4 = RegExp(r'^\d{1,3}(\.\d{1,3}){3}$');

  /// Turns whatever the user typed into a usable base URL.
  ///
  /// `192.168.1.35`            -> `http://192.168.1.35:5000/api`
  /// `192.168.1.35:5000/api/`  -> `http://192.168.1.35:5000/api`
  /// `https://stock.corp.com`  -> `https://stock.corp.com/api`
  static String normalize(String raw) {
    var text = raw.trim();
    if (text.isEmpty) return text;
    if (!text.contains('://')) text = 'http://$text';

    final Uri uri;
    try {
      uri = Uri.parse(text);
    } catch (_) {
      return '';
    }
    if (uri.host.isEmpty) return '';

    // Only bare IPs and localhost get the dev port filled in; a real hostname
    // is left on its scheme default so https deployments keep working.
    final needsDefaultPort = !uri.hasPort &&
        uri.scheme == 'http' &&
        (_ipv4.hasMatch(uri.host) || uri.host == 'localhost');

    // Collapse the path to a single trailing `/api`, dropping any query.
    final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
    if (segments.isEmpty || segments.last != 'api') segments.add('api');

    return Uri(
      scheme: uri.scheme,
      host: uri.host,
      port: needsDefaultPort ? port : (uri.hasPort ? uri.port : null),
      pathSegments: segments,
    ).toString();
  }

  static String hostOf(String baseUrl) {
    try {
      return Uri.parse(baseUrl).host;
    } catch (_) {
      return baseUrl;
    }
  }

  /// The address the user last saved, if any.
  static Future<String?> saved() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(prefsKey);
    return (value == null || value.isEmpty) ? null : value;
  }

  static Future<void> save(String? baseUrl) async {
    final prefs = await SharedPreferences.getInstance();
    if (baseUrl == null || baseUrl.isEmpty) {
      await prefs.remove(prefsKey);
    } else {
      await prefs.setString(prefsKey, baseUrl);
    }
  }

  /// Addresses worth trying before falling back to a network sweep.
  ///
  /// A server on the developer's own machine wins over the hosted one, so a
  /// local API keeps taking precedence during development; everywhere else the
  /// local addresses fail fast and the app lands on [cloudUrl].
  static List<String> quickCandidates() {
    final candidates = <String>[
      if (_envHost.isNotEmpty) normalize(_envHost),
      // The Android emulator reaches the host machine through 10.0.2.2.
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android)
        'http://10.0.2.2:$port/api',
      'http://localhost:$port/api',
      'http://127.0.0.1:$port/api',
      cloudUrl,
    ];
    return candidates.toSet().toList();
  }

  /// The address used when nothing answers — kept so error messages can name
  /// something concrete instead of being blank, and so a retry goes somewhere
  /// a device off the office Wi-Fi can actually reach.
  static String fallback() => cloudUrl;

  /// True when [baseUrl] serves `GET /api/health`.
  ///
  /// The response body is checked too, so an unrelated service squatting on
  /// port 5000 is not mistaken for the API.
  static Future<bool> ping(
    String baseUrl, {
    Duration timeout = const Duration(seconds: 2),
    http.Client? client,
  }) async {
    final owned = client == null;
    final http$ = client ?? http.Client();
    try {
      final response =
          await http$.get(Uri.parse('$baseUrl/health')).timeout(timeout);
      if (response.statusCode != 200) return false;
      final decoded = jsonDecode(response.body);
      return decoded is Map && decoded['status'] == 'healthy';
    } catch (_) {
      return false;
    } finally {
      if (owned) http$.close();
    }
  }

  /// Probes every candidate at once and returns the reachable one that sits
  /// highest in [candidates] — priority order, not whoever answers first.
  static Future<String?> firstReachable(
    List<String> candidates, {
    Duration timeout = const Duration(seconds: 2),
    http.Client? client,
  }) async {
    if (candidates.isEmpty) return null;
    final results = await Future.wait(
      candidates.map((url) => ping(url, timeout: timeout, client: client)),
    );
    for (var i = 0; i < candidates.length; i++) {
      if (results[i]) return candidates[i];
    }
    return null;
  }

  /// Sweeps the local Wi-Fi subnet, then confirms each open port is the API.
  static Future<String?> scanNetwork({
    void Function(double progress)? onProgress,
    http.Client? client,
  }) async {
    final hosts = await discoverLanHosts(port: port, onProgress: onProgress);
    if (hosts.isEmpty) return null;
    return firstReachable(
      [for (final host in hosts) 'http://$host:$port/api'],
      client: client,
    );
  }
}
