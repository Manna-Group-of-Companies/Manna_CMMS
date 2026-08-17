// The file-system side of the updater: where a downloaded APK is parked, and
// how bytes get into it.
//
// Files only exist on the `dart:io` platforms (Android/iOS/desktop); the web
// build gets the no-op stub.
export 'update_storage_stub.dart' if (dart.library.io) 'update_storage_io.dart';
