import 'update_config.dart';

/// Web fallback: a browser cannot write an APK to disk, let alone install one.
/// Nothing here is ever reached — [UpdateService.canInstall] is false on web,
/// so the updater stops after the version check. See `update_storage_io.dart`
/// for the real implementation.
abstract final class UpdateStorage {
  static const isSupported = false;

  static Future<String> cacheDir() async => '';

  static Future<int> sizeOf(String path) async => -1;

  static Future<void> delete(String path) async {}

  static Future<void> pruneExcept(String keepName) async {}

  static Future<String> writeStream(
    String path,
    Stream<List<int>> bytes, {
    required void Function(int received) onProgress,
    required bool Function() isCancelled,
    Duration stallTimeout = UpdateConfig.downloadStallTimeout,
  }) async =>
      throw UnsupportedError('Downloading an APK needs a file system.');

  static Future<String> sha256Of(String path) async =>
      throw UnsupportedError('Downloading an APK needs a file system.');

  static Future<void> rename(String from, String to) async {}
}
