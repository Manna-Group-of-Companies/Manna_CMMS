import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api_client.dart';
import '../models/models.dart';

const _kTokenKey = 'token';
const _kUserKey = 'user';

/// Shown when an Admin tries to sign in. This app ships the Supervisor and
/// Branch portals; the admin console lives in the React client.
const kAdminNotSupported =
    'Admin accounts use the web console. Sign in with a supervisor or branch account.';

/// Port of `client/src/context/AuthContext.jsx`.
///
/// Restores the session from local storage, re-validates it against
/// `GET /auth/me`, and clears everything on 401.
class AuthProvider extends ChangeNotifier {
  AuthProvider(this._api) {
    _api.onUnauthorized = () {
      if (_user != null || _api.token != null) logout();
    };
  }

  final ApiClient _api;

  AppUser? _user;
  bool _loading = true;

  AppUser? get user => _user;
  bool get loading => _loading;
  bool get isAuthenticated => _user != null;

  Future<void> initialize() async {
    final prefs = await SharedPreferences.getInstance();
    final storedToken = prefs.getString(_kTokenKey);
    final storedUser = prefs.getString(_kUserKey);

    if (storedToken != null && storedUser != null) {
      _api.token = storedToken;
      try {
        final cached = AppUser.fromJson(jsonDecode(storedUser) as Map<String, dynamic>);
        // An Admin session left over from an older build — drop it.
        if (cached.isAdmin) throw ApiException(kAdminNotSupported);
        _user = cached;
        notifyListeners();

        // Validate the token and refresh the cached profile.
        final data = await _api.get('/auth/me');
        final fresh = AppUser.fromJson(data as Map<String, dynamic>);
        if (fresh.isAdmin) throw ApiException(kAdminNotSupported);
        _user = fresh;
        await prefs.setString(_kUserKey, jsonEncode(_user!.toJson()));
      } on ApiException catch (error) {
        // A token is only invalid if the server said so. When the request
        // never landed the session is kept, otherwise an unreachable API
        // would silently sign the user out.
        if (error.isNetworkError) {
          debugPrint('Kept cached session; server unreachable: $error');
        } else {
          debugPrint('Session verification failed: $error');
          await _clear();
        }
      } catch (error) {
        debugPrint('Session verification failed: $error');
        await _clear();
      }
    }

    _loading = false;
    notifyListeners();
  }

  /// Signs in with the account name and the 4-digit PIN an admin issued.
  ///
  /// Throws an [ApiException] whose message can be shown to the user.
  Future<AppUser> login(String name, String pin) async {
    final data = await _api.post('/auth/login', {'name': name, 'pin': pin})
        as Map<String, dynamic>;

    final user = AppUser.fromJson(data);
    final token = data['token'] as String?;

    // Nothing is persisted and no listener fires, so the router keeps the
    // user on the login screen to read the message.
    if (user.isAdmin) throw ApiException(kAdminNotSupported);

    final prefs = await SharedPreferences.getInstance();
    if (token != null) {
      _api.token = token;
      await prefs.setString(_kTokenKey, token);
    }
    await prefs.setString(_kUserKey, jsonEncode(user.toJson()));

    _user = user;
    _loading = false;
    notifyListeners();
    return user;
  }

  Future<void> logout() async {
    await _clear();
    notifyListeners();
  }

  Future<void> _clear() async {
    _user = null;
    _api.token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kTokenKey);
    await prefs.remove(_kUserKey);
  }
}
