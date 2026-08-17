import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

import 'update_config.dart';

/// Where downloaded APKs are parked, and how bytes get into them.
///
/// The folder is the app's own cache directory — private to the app, wiped by
/// Android when storage runs short, and no storage permission needed. It is
/// also the folder declared in `res/xml/update_file_paths.xml`, which is what
/// lets the `FileProvider` hand the file to the package installer.
///
/// See `update_storage_stub.dart` for the web fallback.
abstract final class UpdateStorage {
  static const isSupported = true;

  /// The APK cache folder, created if it does not exist yet.
  static Future<String> cacheDir() async {
    final root = await getTemporaryDirectory();
    final dir = Directory('${root.path}/${UpdateConfig.cacheFolder}');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir.path;
  }

  /// Size of [path] in bytes, or -1 when there is no such file.
  static Future<int> sizeOf(String path) async {
    final file = File(path);
    return await file.exists() ? file.length() : -1;
  }

  static Future<void> delete(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }

  /// Clears out APKs left behind by earlier releases, keeping [keepName].
  ///
  /// Without this the cache would grow by one APK per published version.
  static Future<void> pruneExcept(String keepName) async {
    final dir = Directory(await cacheDir());
    if (!await dir.exists()) return;
    await for (final entry in dir.list()) {
      if (entry is! File) continue;
      final name = entry.uri.pathSegments.last;
      if (name == keepName) continue;
      try {
        await entry.delete();
      } on FileSystemException {
        // A file the OS still has open is not worth failing an update over.
      }
    }
  }

  /// Streams [bytes] into [path], reporting the running byte count, and
  /// returns the SHA-256 of everything written.
  ///
  /// The digest is computed as the bytes go past so the finished APK never has
  /// to be read back a second time. Returning early when [isCancelled] flips
  /// leaves a partial file behind; the caller deletes it.
  static Future<String> writeStream(
    String path,
    Stream<List<int>> bytes, {
    required void Function(int received) onProgress,
    required bool Function() isCancelled,
    Duration stallTimeout = UpdateConfig.downloadStallTimeout,
  }) async {
    final sink = File(path).openWrite();
    Digest? digest;
    final hasher = sha256.startChunkedConversion(
      ChunkedConversionSink<Digest>.withCallback((all) => digest = all.single),
    );
    var received = 0;

    try {
      // `timeout` fires when no *chunk* arrives inside the window, which is the
      // symptom of a dropped Wi-Fi connection; a slow-but-alive download keeps
      // resetting it.
      await for (final chunk in bytes.timeout(stallTimeout)) {
        if (isCancelled()) break;
        sink.add(chunk);
        hasher.add(chunk);
        received += chunk.length;
        onProgress(received);
      }
      await sink.flush();
    } finally {
      await sink.close();
    }

    hasher.close();
    return digest.toString();
  }

  static Future<String> sha256Of(String path) async {
    final digest = await sha256.bind(File(path).openRead()).first;
    return digest.toString();
  }

  static Future<void> rename(String from, String to) =>
      File(from).rename(to).then((_) {});
}
