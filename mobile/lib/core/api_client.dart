import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'server_config.dart';

/// Error surfaced by [ApiClient]. [message] mirrors the `message` field the
/// Express API returns on failure, so it can be shown to the user directly.
class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.isNetworkError = false});

  /// The request never reached the API (host unreachable, timed out, DNS).
  /// Callers use this to keep a cached session instead of signing the user out.
  ApiException.network(this.message)
      : statusCode = null,
        isNetworkError = true;

  final String message;
  final int? statusCode;
  final bool isNetworkError;

  @override
  String toString() => message;
}

/// Resolves the API base URL used before discovery has run.
///
/// Override at build time with:
///   flutter run --dart-define=API_URL=http://192.168.1.10:5000/api
String defaultApiBaseUrl() => ServerConfig.pinnedUrl ?? ServerConfig.fallback();

/// Thin HTTP wrapper that mirrors `client/src/services/api.js`: it injects the
/// bearer token on every request and reports 401s so the session can be cleared.
class ApiClient {
  /// [httpClient] exists so tests can supply a mock transport.
  ApiClient({String? baseUrl, http.Client? httpClient})
      : baseUrl = baseUrl ?? defaultApiBaseUrl(),
        _http = httpClient ?? http.Client();

  /// Mutable: discovery (and the user, via the server settings sheet) can
  /// repoint the client at a different host while the app is running.
  String baseUrl;
  final http.Client _http;

  /// How long a single request may take. Long enough to cover a cold start on
  /// the hosted API and the upload of a product photo over a phone connection,
  /// short enough that an unreachable host does not leave the UI spinning.
  Duration timeout = const Duration(seconds: 30);

  String? token;

  /// Invoked when the API rejects the current token.
  void Function()? onUnauthorized;

  Future<dynamic> get(String path, {Map<String, String?>? query}) =>
      _send('GET', path, query: query);

  Future<dynamic> post(String path, [Map<String, dynamic>? body]) =>
      _send('POST', path, body: body);

  Future<dynamic> put(String path, [Map<String, dynamic>? body]) =>
      _send('PUT', path, body: body);

  Future<dynamic> delete(String path) => _send('DELETE', path);

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String?>? query,
    Map<String, dynamic>? body,
  }) async {
    var uri = Uri.parse('$baseUrl$path');
    if (query != null) {
      final params = <String, String>{
        for (final entry in query.entries)
          if (entry.value != null && entry.value!.isNotEmpty) entry.key: entry.value!,
      };
      if (params.isNotEmpty) uri = uri.replace(queryParameters: params);
    }

    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };

    http.Response response;
    try {
      final request = http.Request(method, uri)..headers.addAll(headers);
      if (body != null) request.body = jsonEncode(body);
      final streamed = await _http.send(request).timeout(timeout);
      response = await http.Response.fromStream(streamed);
    } on TimeoutException {
      throw ApiException.network(
        'No response from ${ServerConfig.hostOf(baseUrl)}. Check that the '
        'server is running and that this device is on the same network.',
      );
    } catch (_) {
      throw ApiException.network(
        'Cannot reach the server at ${ServerConfig.hostOf(baseUrl)}. '
        'Tap the server address below to change it.',
      );
    }

    dynamic decoded;
    if (response.body.isNotEmpty) {
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }
    }

    if (response.statusCode == 401) {
      onUnauthorized?.call();
      throw ApiException(
        _messageOf(decoded) ?? 'Your session has expired. Please sign in again.',
        statusCode: 401,
      );
    }

    if (response.statusCode >= 400) {
      throw ApiException(
        _messageOf(decoded) ?? 'Request failed (${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    return decoded;
  }

  static String? _messageOf(dynamic decoded) {
    if (decoded is Map && decoded['message'] is String) {
      final message = decoded['message'] as String;
      if (message.isNotEmpty) return message;
    }
    return null;
  }

  void dispose() => _http.close();
}
