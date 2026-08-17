/// Where the over-the-air update manifest and the APKs live.
///
/// Everything is served by **GitHub**, over plain https, and no account or
/// token is involved — the repository is public, so both files are ordinary
/// anonymous downloads:
///
///   the manifest   `<baseUrl>/version.json`, i.e. `update/version.json`
///                  committed to the repo and read through raw.githubusercontent
///   the APK        an asset on the matching GitHub release, named in full by
///                  `apkUrl` inside the manifest
///
/// Publishing an update is therefore a `git push` plus a release upload; there
/// is no hosting service to deploy to and nothing to pay for.
///
/// [_updateBaseUrl] can be overridden per build without touching the source:
///
///   flutter build apk --release \
///     --dart-define=UPDATE_BASE_URL=https://example.com/somewhere
abstract final class UpdateConfig {
  /// The folder holding `version.json`, read straight from the `main` branch.
  ///
  /// Pinned to `main` rather than a tag, so publishing an update only means
  /// committing the new manifest. Note raw.githubusercontent caches for five
  /// minutes — irrelevant here, and [manifestUrl] busts it anyway.
  static const _updateBaseUrl =
      'https://raw.githubusercontent.com/Manna-Group-of-Companies/Manna_CMMS/main/update';

  static const _envBaseUrl = String.fromEnvironment('UPDATE_BASE_URL');

  /// The configured location, without a trailing slash.
  static String get baseUrl {
    final raw = _envBaseUrl.isNotEmpty ? _envBaseUrl : _updateBaseUrl;
    return raw.endsWith('/') ? raw.substring(0, raw.length - 1) : raw;
  }

  /// The manifest, relative to [baseUrl].
  static const manifestPath = 'version.json';

  /// False while [baseUrl] is still an unresolved placeholder. The startup
  /// check then does nothing at all, so such a build behaves exactly like the
  /// app did before the updater existed.
  static bool get isConfigured =>
      baseUrl.isNotEmpty &&
      !baseUrl.contains('REPLACE-ME') &&
      Uri.tryParse(baseUrl)?.hasScheme == true;

  /// Turns a manifest URL into an absolute one.
  ///
  /// `downloads/app-1.0.1.apk` -> `<baseUrl>/downloads/app-1.0.1.apk`
  /// `https://cdn.example/x.apk` is left alone, so the APK can live off-site.
  static Uri resolve(String url) => Uri.parse('$baseUrl/').resolve(url.trim());

  /// The manifest address, with a cache-buster so neither Hosting's CDN nor a
  /// captive-portal proxy can hand back yesterday's version.
  ///
  /// [stamp] is the current time in milliseconds; it is passed in rather than
  /// read here so the value stays testable.
  static Uri manifestUrl(int stamp) =>
      resolve(manifestPath).replace(queryParameters: {'t': '$stamp'});

  /// How long the manifest fetch is given. Short — a failed check must never
  /// hold up the app (see requirement: the app stays usable regardless).
  static const manifestTimeout = Duration(seconds: 12);

  /// How long the download is allowed to sit with no bytes arriving before it
  /// is treated as a dead connection.
  static const downloadStallTimeout = Duration(seconds: 45);

  /// Sub-folder of the app cache directory that holds downloaded APKs. Must
  /// match the `path` in `android/app/src/main/res/xml/update_file_paths.xml`,
  /// or the installer cannot be handed the file.
  static const cacheFolder = 'updates';

  /// Remembers the version the user dismissed with "Later", so the startup
  /// check does not ask again for that same release.
  static const skippedVersionKey = 'update_skipped_version';
}
