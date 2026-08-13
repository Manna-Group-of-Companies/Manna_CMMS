// Finds hosts on the local network with the API port open.
//
// Raw sockets only exist on the `dart:io` platforms (Android/iOS/desktop);
// the web build gets the no-op stub.
export 'lan_discovery_stub.dart' if (dart.library.io) 'lan_discovery_io.dart';
