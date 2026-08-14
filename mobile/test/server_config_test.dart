import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/core/server_config.dart';
import 'package:stockmaster/state/server_provider.dart';

/// Serves `/api/health` for [healthyHosts] only; everything else looks dead.
MockClient healthOn(Set<String> healthyHosts, {List<String>? probed}) {
  return MockClient((request) async {
    probed?.add(request.url.host);
    if (request.url.path == '/api/health' &&
        healthyHosts.contains(request.url.host)) {
      return http.Response(
        jsonEncode({'status': 'healthy', 'timestamp': '2026-08-12T00:00:00Z'}),
        200,
        headers: {'content-type': 'application/json'},
      );
    }
    throw const SocketExceptionStub();
  });
}

/// MockClient has no way to simulate a refused connection, so throwing any
/// error from the handler stands in for one.
class SocketExceptionStub implements Exception {
  const SocketExceptionStub();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('normalize', () {
    test('fills in the scheme, dev port and /api suffix', () {
      expect(ServerConfig.normalize('192.168.1.35'),
          'http://192.168.1.35:5000/api');
    });

    test('is idempotent and strips a trailing slash', () {
      const canonical = 'http://192.168.1.35:5000/api';
      expect(ServerConfig.normalize(canonical), canonical);
      expect(ServerConfig.normalize('http://192.168.1.35:5000/api/'), canonical);
      expect(ServerConfig.normalize('  192.168.1.35:5000/api  '), canonical);
    });

    test('keeps an explicit port', () {
      expect(ServerConfig.normalize('10.0.0.4:8080'),
          'http://10.0.0.4:8080/api');
    });

    test('leaves an https hostname on its default port', () {
      expect(ServerConfig.normalize('https://stock.corp.com'),
          'https://stock.corp.com/api');
    });

    test('rejects junk instead of building a broken URL', () {
      expect(ServerConfig.normalize(''), '');
      expect(ServerConfig.normalize('   '), '');
    });
  });

  group('discovery', () {
    test('ping only accepts the StockMaster health payload', () async {
      final wrongService = MockClient(
        (_) async => http.Response('<html>nginx</html>', 200),
      );
      expect(
        await ServerConfig.ping('http://192.168.1.9:5000/api',
            client: wrongService),
        isFalse,
      );
      expect(
        await ServerConfig.ping('http://192.168.1.35:5000/api',
            client: healthOn({'192.168.1.35'})),
        isTrue,
      );
    });

    test('firstReachable honours candidate order, not response order',
        () async {
      final client = healthOn({'10.0.2.2', 'localhost'});
      final found = await ServerConfig.firstReachable(
        const [
          'http://10.0.2.2:5000/api',
          'http://localhost:5000/api',
        ],
        client: client,
      );
      expect(found, 'http://10.0.2.2:5000/api');
    });

    test('the hosted server is a candidate, and the last-resort address',
        () async {
      expect(ServerConfig.quickCandidates(), contains(ServerConfig.cloudUrl));
      expect(ServerConfig.quickCandidates().last, ServerConfig.cloudUrl,
          reason: 'a local API still wins over the hosted one');
      expect(ServerConfig.fallback(), ServerConfig.cloudUrl);
    });

    test('a sleeping remote host gets longer than a LAN probe', () {
      expect(ServerConfig.timeoutFor(ServerConfig.cloudUrl),
          ServerConfig.cloudWakeTimeout);
      expect(ServerConfig.timeoutFor('http://192.168.1.35:5000/api'),
          const Duration(seconds: 2));
      expect(ServerConfig.timeoutFor('http://localhost:5000/api'),
          const Duration(seconds: 2));
    });

    test('firstReachable returns null when nothing answers', () async {
      final found = await ServerConfig.firstReachable(
        const ['http://192.168.1.99:5000/api'],
        client: healthOn(const {}),
      );
      expect(found, isNull);
    });
  });

  group('ServerProvider', () {
    test('is inert when discovery is disabled', () async {
      final api = ApiClient(baseUrl: 'http://localhost:5000/api');
      final server = ServerProvider(api, enabled: false);

      await server.start();

      expect(server.status, ServerStatus.connected);
      expect(api.baseUrl, 'http://localhost:5000/api');
    });

    test('useAddress repoints the client and persists the address', () async {
      final api = ApiClient(baseUrl: 'http://10.0.2.2:5000/api');
      final server = ServerProvider(api, probeClient: healthOn({'192.168.1.35'}));

      expect(await server.useAddress('192.168.1.35'), isTrue);
      expect(api.baseUrl, 'http://192.168.1.35:5000/api');
      expect(server.status, ServerStatus.connected);
      expect(await ServerConfig.saved(), 'http://192.168.1.35:5000/api');
    });

    test('useAddress keeps the old address when the new one is dead', () async {
      final api = ApiClient(baseUrl: 'http://10.0.2.2:5000/api');
      final server = ServerProvider(api, probeClient: healthOn(const {}));

      expect(await server.useAddress('192.168.1.99'), isFalse);
      expect(api.baseUrl, 'http://10.0.2.2:5000/api',
          reason: 'a failed probe must not repoint the client');
      expect(await ServerConfig.saved(), isNull);
    });

    test('rejects an empty address', () async {
      final api = ApiClient(baseUrl: 'http://localhost:5000/api');
      expect(await ServerProvider(api).useAddress('  '), isFalse);
    });

    test('start prefers the saved address over the platform defaults',
        () async {
      SharedPreferences.setMockInitialValues({
        ServerConfig.prefsKey: 'http://192.168.1.35:5000/api',
      });
      final api = ApiClient(baseUrl: 'http://localhost:5000/api');
      final server = ServerProvider(
        api,
        probeClient: healthOn({'192.168.1.35', 'localhost'}),
      );

      await server.start();

      expect(api.baseUrl, 'http://192.168.1.35:5000/api');
      expect(server.status, ServerStatus.connected);
    });

    test('start falls back to a quick candidate when the saved one is dead',
        () async {
      SharedPreferences.setMockInitialValues({
        ServerConfig.prefsKey: 'http://192.168.1.99:5000/api',
      });
      final api = ApiClient(baseUrl: 'http://192.168.1.99:5000/api');
      final probed = <String>[];
      final server = ServerProvider(
        api,
        probeClient: healthOn({'localhost'}, probed: probed),
      );

      await server.start();

      expect(server.status, ServerStatus.connected);
      expect(api.baseUrl, 'http://localhost:5000/api');
      expect(probed, contains('192.168.1.99'),
          reason: 'the saved address is tried first');
    });

    test('start lands on the hosted server when nothing local answers',
        () async {
      final api = ApiClient(baseUrl: 'http://localhost:5000/api');
      final server = ServerProvider(
        api,
        probeClient: healthOn({ServerConfig.hostOf(ServerConfig.cloudUrl)}),
      );

      await server.start();

      expect(api.baseUrl, ServerConfig.cloudUrl);
      expect(server.status, ServerStatus.connected);
      expect(await ServerConfig.saved(), ServerConfig.cloudUrl);
    });

    test('start reports unreachable and keeps the last known address',
        () async {
      SharedPreferences.setMockInitialValues({
        ServerConfig.prefsKey: 'http://192.168.1.99:5000/api',
      });
      final api = ApiClient(baseUrl: 'http://192.168.1.99:5000/api');
      final server = ServerProvider(api, probeClient: healthOn(const {}));

      await server.start();

      expect(server.status, ServerStatus.unreachable);
      expect(api.baseUrl, 'http://192.168.1.99:5000/api');
    });
  });

  group('ApiClient error reporting', () {
    test('flags a timeout as a network error and names the host', () async {
      final api = ApiClient(
        baseUrl: 'http://192.168.1.35:5000/api',
        httpClient: MockClient((_) async {
          await Future<void>.delayed(const Duration(seconds: 5));
          return http.Response('{}', 200);
        }),
      )..timeout = const Duration(milliseconds: 50);

      final error = await api.get('/auth/me').then<Object?>(
            (_) => null,
            onError: (Object e) => e,
          );

      expect(error, isA<ApiException>());
      error as ApiException;
      expect(error.isNetworkError, isTrue);
      expect(error.message, contains('192.168.1.35'));
    });

    test('an unreachable host is a network error, a 500 is not', () async {
      final unreachable = ApiClient(
        baseUrl: 'http://192.168.1.35:5000/api',
        httpClient: MockClient((_) async => throw const SocketExceptionStub()),
      );
      final broken = ApiClient(
        baseUrl: 'http://192.168.1.35:5000/api',
        httpClient: MockClient(
          (_) async => http.Response(jsonEncode({'message': 'boom'}), 500),
        ),
      );

      Future<ApiException> failureOf(ApiClient client) async =>
          await client.get('/auth/me').then<ApiException?>(
                (_) => null,
                onError: (Object e) => e as ApiException,
              ) as ApiException;

      expect((await failureOf(unreachable)).isNetworkError, isTrue);

      final serverError = await failureOf(broken);
      expect(serverError.isNetworkError, isFalse);
      expect(serverError.statusCode, 500);
      expect(serverError.message, 'boom');
    });
  });
}
