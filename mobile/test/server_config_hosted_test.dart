import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/core/server_config.dart';

void main() {
  test('the hosted server is the deployed Render address', () {
    expect(ServerConfig.cloudUrl, 'https://manna-cmms.onrender.com/api');
  });

  test('when nothing answers, the app falls back to the hosted server', () {
    expect(ServerConfig.fallback(), ServerConfig.cloudUrl);
  });

  test('a local API is tried before the hosted one', () {
    final candidates = ServerConfig.quickCandidates();
    expect(candidates.last, ServerConfig.cloudUrl);
    for (final candidate in candidates.take(candidates.length - 1)) {
      final host = ServerConfig.hostOf(candidate);
      final isLocal = host == 'localhost' || host == '127.0.0.1' || host == '10.0.2.2';
      expect(isLocal, true, reason: '$candidate is not a local address');
    }
  });

  test('the hosted server is given long enough to wake from sleep', () {
    // A cold start was measured at 52 seconds.
    expect(ServerConfig.cloudWakeTimeout, greaterThan(const Duration(seconds: 52)));
    expect(ServerConfig.timeoutFor(ServerConfig.cloudUrl), ServerConfig.cloudWakeTimeout);
    expect(ServerConfig.timeoutFor('http://192.168.1.35:5000/api'), const Duration(seconds: 2));
  });

  test('an empty base URL parses to an empty host, for the "not configured" message', () {
    expect(ServerConfig.hostOf(''), '');
  });
}
