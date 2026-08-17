import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'apk_installer.dart';
import 'update_config.dart';
import 'update_storage.dart';

/// A dotted app version — `1.0.3`, optionally with the build number the
/// Play/Gradle world calls `versionCode`.
///
/// Comparison is numeric per segment, so `1.0.10` correctly beats `1.0.9`
/// (string comparison would get that backwards). Missing segments count as
/// zero, so `1.1` and `1.1.0` are the same release.
@immutable
class AppVersion implements Comparable<AppVersion> {
  const AppVersion(this.segments, {this.build = 0});

  /// Accepts `1.0.3`, `v1.0.3`, `1.0.3+7`, and `1.0.3-hotfix` (the suffix is
  /// ignored). Anything unparseable comes back as `0.0.0`, which simply never
  /// wins a comparison.
  factory AppVersion.parse(String raw, {int? build}) {
    var text = raw.trim();
    if (text.startsWith('v') || text.startsWith('V')) text = text.substring(1);

    var parsedBuild = build ?? 0;
    final plus = text.indexOf('+');
    if (plus >= 0) {
      parsedBuild = build ?? int.tryParse(text.substring(plus + 1)) ?? 0;
      text = text.substring(0, plus);
    }

    final segments = <int>[];
    for (final part in text.split('.')) {
      final digits = RegExp(r'^\d+').firstMatch(part.trim())?.group(0);
      segments.add(int.tryParse(digits ?? '') ?? 0);
    }
    return AppVersion(segments.isEmpty ? const [0] : segments,
        build: parsedBuild);
  }

  final List<int> segments;

  /// `versionCode` on Android. Only consulted when the dotted parts tie, so a
  /// rebuild of the same version can still be pushed out.
  final int build;

  @override
  int compareTo(AppVersion other) {
    final length =
        segments.length > other.segments.length ? segments.length : other.segments.length;
    for (var i = 0; i < length; i++) {
      final mine = i < segments.length ? segments[i] : 0;
      final theirs = i < other.segments.length ? other.segments[i] : 0;
      if (mine != theirs) return mine.compareTo(theirs);
    }
    return build.compareTo(other.build);
  }

  bool operator >(AppVersion other) => compareTo(other) > 0;
  bool operator <(AppVersion other) => compareTo(other) < 0;

  @override
  bool operator ==(Object other) =>
      other is AppVersion && compareTo(other) == 0;

  @override
  int get hashCode => Object.hash(toString(), build);

  @override
  String toString() => segments.join('.');
}

/// `version.json` as served by Firebase Hosting.
///
/// ```json
/// {
///   "latestVersion": "1.0.1",
///   "versionCode": 2,
///   "apkUrl": "downloads/stockmaster-1.0.1.apk",
///   "releaseNotes": "- Faster catalog\n- Fixes the returns filter",
///   "fileSize": 24117248,
///   "sha256": "9f86d0…",
///   "mandatory": false,
///   "minSupportedVersion": "1.0.0"
/// }
/// ```
///
/// Only `latestVersion` and `apkUrl` are required.
@immutable
class UpdateManifest {
  const UpdateManifest({
    required this.version,
    required this.apkUrl,
    this.versionCode,
    this.releaseNotes = '',
    this.fileSize,
    this.sha256,
    this.mandatory = false,
    this.minSupportedVersion,
  });

  factory UpdateManifest.fromJson(Map<String, dynamic> json) {
    final version = (json['latestVersion'] ?? json['version'] ?? '').toString().trim();
    final apk = (json['apkUrl'] ?? json['downloadUrl'] ?? '').toString().trim();
    if (version.isEmpty || apk.isEmpty) {
      throw const UpdateException(
        'The update manifest is missing "latestVersion" or "apkUrl".',
      );
    }

    final notes = json['releaseNotes'];
    return UpdateManifest(
      version: version,
      apkUrl: UpdateConfig.resolve(apk),
      versionCode: _asInt(json['versionCode'] ?? json['buildNumber']),
      // A list of bullet points is accepted as well as a plain string, since
      // that is the shape people reach for first when hand-editing the file.
      releaseNotes: notes is List
          ? notes.map((line) => '• $line').join('\n')
          : (notes ?? '').toString().trim(),
      fileSize: _asInt(json['fileSize'] ?? json['apkSize']),
      sha256: (json['sha256'] as String?)?.trim().toLowerCase(),
      mandatory: json['mandatory'] == true,
      minSupportedVersion: (json['minSupportedVersion'] as String?)?.trim(),
    );
  }

  static int? _asInt(Object? value) => switch (value) {
        int v => v,
        String v => int.tryParse(v),
        num v => v.toInt(),
        _ => null,
      };

  final String version;
  final Uri apkUrl;
  final int? versionCode;
  final String releaseNotes;
  final int? fileSize;
  final String? sha256;

  /// Set on a release the user must not be able to postpone.
  final bool mandatory;

  /// Anything older than this is forced to update, without having to flag
  /// every later release as mandatory.
  final String? minSupportedVersion;

  AppVersion get parsed => AppVersion.parse(version, build: versionCode);

  /// File the APK is cached under. Version-stamped, so a half-finished
  /// download of 1.0.1 is never mistaken for 1.0.2.
  String get fileName => 'stockmaster-$version.apk';
}

/// The outcome of a version check.
@immutable
class UpdateCheck {
  const UpdateCheck({
    required this.installedVersion,
    required this.installedBuild,
    this.latest,
  });

  final String installedVersion;
  final int installedBuild;

  /// Null when the manifest could not be read — see [UpdateService.check],
  /// which returns the installed version either way so Settings can still
  /// display it.
  final UpdateManifest? latest;

  AppVersion get installed =>
      AppVersion.parse(installedVersion, build: installedBuild);

  bool get updateAvailable {
    final manifest = latest;
    return manifest != null && manifest.parsed > installed;
  }

  /// Whether "Later" should be offered. A release can be flagged `mandatory`,
  /// or the installed build can have fallen below `minSupportedVersion`.
  bool get isMandatory {
    final manifest = latest;
    if (manifest == null || !updateAvailable) return false;
    if (manifest.mandatory) return true;
    final floor = manifest.minSupportedVersion;
    return floor != null && floor.isNotEmpty && installed < AppVersion.parse(floor);
  }
}

/// Anything the updater can fail at, phrased for the user.
class UpdateException implements Exception {
  const UpdateException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Where the download has got to.
enum UpdateStage { idle, downloading, verifying, opening, failed }

/// Reads the hosted manifest, downloads the APK it points at, and hands the
/// file to Android's package installer.
///
/// One instance backs one update dialog: [check] is static because it needs no
/// state, while a download is progress-reporting and cancellable, so it lives
/// on an instance the dialog can listen to.
class UpdateService extends ChangeNotifier {
  UpdateService({http.Client? client})
      : _client = client ?? http.Client(),
        _ownsClient = client == null;

  final http.Client _client;
  final bool _ownsClient;

  UpdateStage _stage = UpdateStage.idle;
  int _received = 0;
  int _total = 0;
  String? _error;
  bool _cancelled = false;
  bool _disposed = false;

  UpdateStage get stage => _stage;
  int get receivedBytes => _received;
  int get totalBytes => _total;
  String? get error => _error;
  bool get isBusy =>
      _stage == UpdateStage.downloading ||
      _stage == UpdateStage.verifying ||
      _stage == UpdateStage.opening;

  /// 0..1, or null while the server has not said how big the file is.
  double? get progress =>
      _total > 0 ? (_received / _total).clamp(0.0, 1.0) : null;

  /// Whether this build can actually carry an update through to the installer.
  /// False on web, iOS, Windows — where the check still runs but stops at
  /// "a newer version exists".
  static bool get canInstall => ApkInstaller.isSupported && UpdateStorage.isSupported;

  /// The version the user is running, straight from the installed package.
  static Future<UpdateCheck> installedOnly() async {
    final info = await PackageInfo.fromPlatform();
    return UpdateCheck(
      installedVersion: info.version,
      installedBuild: int.tryParse(info.buildNumber) ?? 0,
    );
  }

  /// Fetches `version.json` and compares it with the installed package.
  ///
  /// Throws [UpdateException] when the manifest cannot be reached or parsed —
  /// the startup path swallows that (the app must stay usable offline), while
  /// the Settings button surfaces it.
  static Future<UpdateCheck> check({http.Client? client}) async {
    final info = await PackageInfo.fromPlatform();
    final installed = UpdateCheck(
      installedVersion: info.version,
      installedBuild: int.tryParse(info.buildNumber) ?? 0,
    );

    if (!UpdateConfig.isConfigured) {
      throw const UpdateException(
        'No update server is configured for this build.',
      );
    }

    final owned = client == null;
    final http$ = client ?? http.Client();
    try {
      final url = UpdateConfig.manifestUrl(
        DateTime.now().millisecondsSinceEpoch,
      );
      final response = await http$
          .get(url, headers: const {'Cache-Control': 'no-cache'})
          .timeout(UpdateConfig.manifestTimeout);

      if (response.statusCode != 200) {
        throw UpdateException(
          'The update server answered ${response.statusCode}.',
        );
      }

      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is! Map<String, dynamic>) {
        throw const UpdateException('The update manifest is not valid JSON.');
      }

      return UpdateCheck(
        installedVersion: installed.installedVersion,
        installedBuild: installed.installedBuild,
        latest: UpdateManifest.fromJson(decoded),
      );
    } on UpdateException {
      rethrow;
    } on TimeoutException {
      throw const UpdateException('The update server took too long to respond.');
    } on FormatException {
      throw const UpdateException('The update manifest is not valid JSON.');
    } catch (error) {
      // No internet, DNS failure, captive portal — all the same to the user.
      debugPrint('Update check failed: $error');
      throw const UpdateException('Could not reach the update server.');
    } finally {
      if (owned) http$.close();
    }
  }

  /// Downloads [manifest]'s APK, then opens the Android installer for it.
  ///
  /// An APK already sitting complete in the cache is reused rather than pulled
  /// down a second time, so declining the Android install prompt and tapping
  /// *Update Now* again costs nothing.
  ///
  /// Returns true only once the installer is actually up — a cancelled
  /// download and a failed one both come back false, which is what tells the
  /// dialog to stay open.
  Future<bool> downloadAndInstall(UpdateManifest manifest) async {
    if (!canInstall) {
      _fail('Updates can only be installed on Android.');
      return false;
    }

    _cancelled = false;
    _error = null;
    _received = 0;
    _total = manifest.fileSize ?? 0;
    _set(UpdateStage.downloading);

    try {
      final dir = await UpdateStorage.cacheDir();
      final target = '$dir/${manifest.fileName}';
      final partial = '$target.part';

      if (await _isCached(target, manifest)) {
        _received = _total;
        await _open(target);
        return true;
      }

      // A leftover partial from an interrupted run: start it over rather than
      // resuming, since Hosting range requests are not worth the complexity
      // for a file this size.
      await UpdateStorage.delete(partial);

      final request = http.Request('GET', manifest.apkUrl);
      final response = await _client
          .send(request)
          .timeout(UpdateConfig.manifestTimeout);

      if (response.statusCode != 200) {
        throw UpdateException(
          'The download failed (HTTP ${response.statusCode}). '
          'Check that apkUrl in version.json points at a published file.',
        );
      }
      if (response.contentLength != null && response.contentLength! > 0) {
        _total = response.contentLength!;
      }
      notifyListeners();

      final digest = await UpdateStorage.writeStream(
        partial,
        response.stream,
        onProgress: (received) {
          _received = received;
          notifyListeners();
        },
        isCancelled: () => _cancelled,
      );

      if (_cancelled) {
        await UpdateStorage.delete(partial);
        _set(UpdateStage.idle);
        return false;
      }

      _set(UpdateStage.verifying);
      _verify(digest, await UpdateStorage.sizeOf(partial), manifest, partial);

      await UpdateStorage.rename(partial, target);
      // Keep only the release we are about to install.
      await UpdateStorage.pruneExcept(manifest.fileName);
      await _open(target);
      return true;
    } on UpdateException catch (error) {
      _fail(error.message);
    } on InstallException catch (error) {
      _fail(error.message);
    } on TimeoutException {
      _fail('The download stalled. Check the connection and try again.');
    } catch (error) {
      debugPrint('Update download failed: $error');
      _fail('The download failed. Check the connection and try again.');
    }
    return false;
  }

  /// True when a previous run already fetched this exact APK in full.
  Future<bool> _isCached(String path, UpdateManifest manifest) async {
    final size = await UpdateStorage.sizeOf(path);
    if (size <= 0) return false;
    if (manifest.fileSize != null && manifest.fileSize != size) {
      await UpdateStorage.delete(path);
      return false;
    }
    final expected = manifest.sha256;
    if (expected != null && expected.isNotEmpty) {
      if (await UpdateStorage.sha256Of(path) != expected) {
        await UpdateStorage.delete(path);
        return false;
      }
    }
    return true;
  }

  /// Refuses an APK that is not byte-for-byte what the manifest promised.
  void _verify(
    String digest,
    int size,
    UpdateManifest manifest,
    String partial,
  ) {
    final expectedSize = manifest.fileSize;
    if (expectedSize != null && expectedSize > 0 && expectedSize != size) {
      unawaited(UpdateStorage.delete(partial));
      throw const UpdateException(
        'The download is incomplete. Please try again.',
      );
    }
    final expectedHash = manifest.sha256;
    if (expectedHash != null && expectedHash.isNotEmpty && expectedHash != digest) {
      unawaited(UpdateStorage.delete(partial));
      throw const UpdateException(
        'The downloaded file did not match its checksum and was discarded.',
      );
    }
  }

  /// Opens the Android package installer, asking for the "install unknown
  /// apps" permission first if it has not been granted yet.
  Future<void> _open(String path) async {
    _set(UpdateStage.opening);

    if (!await ApkInstaller.canInstallPackages()) {
      final granted = await ApkInstaller.requestInstallPermission();
      if (!granted) {
        throw const UpdateException(
          'Android needs permission to install apps from StockMaster. '
          'Turn on "Allow from this source", then tap Update Now again.',
        );
      }
    }

    await ApkInstaller.install(path);
    // The installer is now in front of the user. Android takes it from here:
    // it confirms the install, matches the signature against the copy already
    // on the tablet, and upgrades in place.
    _set(UpdateStage.idle);
  }

  /// Stops an in-flight download. The partial file is cleaned up by
  /// [downloadAndInstall] as it unwinds.
  void cancel() {
    if (_stage != UpdateStage.downloading) return;
    _cancelled = true;
  }

  void _set(UpdateStage stage) {
    _stage = stage;
    notifyListeners();
  }

  void _fail(String message) {
    _error = message;
    _set(UpdateStage.failed);
  }

  /// The release the user last dismissed with "Later".
  static Future<String?> skippedVersion() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(UpdateConfig.skippedVersionKey);
  }

  /// Remembers that [version] was dismissed, so the next launch does not ask
  /// about the same release again. Checking from Settings ignores this.
  static Future<void> skipVersion(String version) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(UpdateConfig.skippedVersionKey, version);
  }

  @override
  void notifyListeners() {
    if (_disposed) return;
    super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _cancelled = true;
    if (_ownsClient) _client.close();
    super.dispose();
  }
}

/// `24117248` -> `23.0 MB`. Used by the progress line in the dialog.
String formatBytes(int bytes) {
  if (bytes <= 0) return '0 MB';
  const mb = 1024 * 1024;
  if (bytes < mb) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  return '${(bytes / mb).toStringAsFixed(1)} MB';
}
