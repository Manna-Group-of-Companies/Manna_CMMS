import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Hands a downloaded APK to Android's own package installer.
///
/// There is **no silent install** here, and there cannot be: a normal (non
/// system, non device-owner) Android app is not allowed to install packages by
/// itself. All this does is fire `ACTION_VIEW` at the APK through a
/// `FileProvider`, which brings up the stock installer screen. The user taps
/// *Install*, Android checks the new APK is signed with the same key as the
/// copy already on the device, and upgrades it in place — the existing app is
/// never uninstalled and its data is left untouched.
///
/// The Kotlin half is in
/// `android/app/src/main/kotlin/com/mannarubber/stockmaster/MainActivity.kt`.
abstract final class ApkInstaller {
  static const _channel =
      MethodChannel('com.mannarubber.stockmaster/apk_installer');

  /// Whether this platform can install an APK at all. Only Android can.
  static bool get isSupported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// Whether the user has granted "Install unknown apps" to this app.
  ///
  /// Always true below Android 8, where it was a single global setting rather
  /// than a per-app one.
  static Future<bool> canInstallPackages() async {
    if (!isSupported) return false;
    try {
      return await _channel.invokeMethod<bool>('canInstallPackages') ?? false;
    } on PlatformException {
      return false;
    }
  }

  /// Opens the system "Install unknown apps" screen for this app and waits for
  /// the user to come back. Resolves to the permission state afterwards.
  static Future<bool> requestInstallPermission() async {
    if (!isSupported) return false;
    try {
      return await _channel.invokeMethod<bool>('requestInstallPermission') ??
          false;
    } on PlatformException {
      return false;
    }
  }

  /// Launches the package installer for the APK at [path].
  ///
  /// Returns as soon as the installer screen has been opened — what happens
  /// next is Android's business, and this app is usually being replaced while
  /// the returned future is already complete.
  static Future<void> install(String path) async {
    if (!isSupported) {
      throw const InstallException('Updates are only supported on Android.');
    }
    try {
      await _channel.invokeMethod<void>('installApk', {'path': path});
    } on PlatformException catch (error) {
      throw InstallException(error.message ?? 'Could not open the installer.');
    } on MissingPluginException {
      // A stale engine (hot restart after the channel was added) rather than
      // anything the user did.
      throw const InstallException(
        'The installer bridge is unavailable. Restart the app and try again.',
      );
    }
  }
}

class InstallException implements Exception {
  const InstallException(this.message);

  final String message;

  @override
  String toString() => message;
}
