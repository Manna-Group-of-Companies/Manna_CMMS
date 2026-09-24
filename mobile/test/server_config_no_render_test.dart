import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/core/server_config.dart';

void main() {
  test('the fallback address is empty, not a hosted server nobody asked for', () {
    expect(ServerConfig.fallback(), '');
  });

  test('quick candidates never include a remote host', () {
    for (final candidate in ServerConfig.quickCandidates()) {
      final host = ServerConfig.hostOf(candidate);
      final isLocal = host == 'localhost' || host == '127.0.0.1' || host == '10.0.2.2';
      expect(isLocal, true, reason: '$candidate is not a local address');
    }
  });

  test('an empty base URL parses to an empty host, for the "not configured" message', () {
    expect(ServerConfig.hostOf(''), '');
  });
}
