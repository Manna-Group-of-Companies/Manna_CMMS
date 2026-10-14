import '../core/api_client.dart';

/// This phone's standing with the server as a place to send push
/// notifications - `PUT /devices` and `DELETE /devices/:token` on the API.
class DeviceRepository {
  DeviceRepository(this._api);

  final ApiClient _api;

  /// Tells the server where to push. Called after sign-in and again whenever
  /// Firebase hands the phone a new token; the server keeps one row per token.
  Future<void> register(
    String token, {
    required String platform,
    required String appVersion,
  }) async {
    await _api.put('/devices', {
      'token': token,
      'platform': platform,
      'appVersion': appVersion,
    });
  }

  /// Withdraws this phone, on sign-out, while the session is still signed.
  Future<void> unregister(String token) async {
    await _api.delete('/devices/${Uri.encodeComponent(token)}');
  }
}
