import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api_client.dart';
import '../models/models.dart';

/// Where the session is kept. Public because the background check for new
/// breakdowns runs in its own isolate and signs its requests with the same
/// token - see core/incoming_background.dart.
const kTokenPrefsKey = 'token';
const kUserPrefsKey = 'user';

/// Shown when an account carries the retired `Admin` role.
///
/// Nothing issues that role now - ERPNext accounts map to Manager, Maintenance
/// Manager, Supervisor, Production Manager, Higher Management, VP Operations,
/// Purchase Manager or Maintenance Member - so this only catches a session
/// cached by a much older build. The Manager and the Maintenance Manager are served by this app: they get the maintenance
/// screens, the same two the web console shows them.
const kAdminNotSupported =
    'Admin accounts use the web console. Sign in with a supervisor or branch account.';

/// Port of `client/src/context/AuthContext.jsx`.
///
/// Restores the session from local storage, re-validates it against
/// `GET /session/me`, and clears everything on 401.
///
/// People sign in with their ERPNext email and password. The PIN is gone:
/// Frappe has no such concept, and the point of moving onto ERPNext is one
/// list of people rather than two that drift apart.
class AuthProvider extends ChangeNotifier {
  AuthProvider(this._api) {
    _api.onUnauthorized = () {
      if (_user != null || _api.token != null) logout();
    };
  }

  final ApiClient _api;

  AppUser? _user;
  bool _loading = true;
  bool _loggingOut = false;

  /// Runs before a sign-out clears the session, while requests can still be
  /// signed - the phone withdraws its push registration here. A failure is
  /// logged and the sign-out goes ahead regardless.
  Future<void> Function()? beforeLogout;

  AppUser? get user => _user;
  bool get loading => _loading;
  bool get isAuthenticated => _user != null;

  Future<void> initialize() async {
    final prefs = await SharedPreferences.getInstance();
    final storedToken = prefs.getString(kTokenPrefsKey);
    final storedUser = prefs.getString(kUserPrefsKey);

    if (storedToken != null && storedUser != null) {
      _api.token = storedToken;
      try {
        final cached = AppUser.fromJson(jsonDecode(storedUser) as Map<String, dynamic>);
        // An Admin session left over from an older build — drop it.
        if (cached.isAdmin) throw ApiException(kAdminNotSupported);
        _user = cached;
        notifyListeners();

        // Validate the token and refresh the cached profile.
        final data = await _api.get('/session/me');
        final fresh = AppUser.fromJson(data as Map<String, dynamic>);
        if (fresh.isAdmin) throw ApiException(kAdminNotSupported);
        _user = fresh;
        await prefs.setString(kUserPrefsKey, jsonEncode(_user!.toJson()));
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

  /// Signs in with an ERPNext email and password.
  ///
  /// Throws an [ApiException] whose message can be shown to the user.
  Future<AppUser> login(String email, String password) async {
    final data =
        await _api.post('/session/login', {'email': email, 'password': password})
            as Map<String, dynamic>;

    final user = AppUser.fromJson(data);
    final token = data['token'] as String?;

    // Nothing is persisted and no listener fires, so the router keeps the
    // user on the login screen to read the message.
    if (user.isAdmin) throw ApiException(kAdminNotSupported);

    final prefs = await SharedPreferences.getInstance();
    if (token != null) {
      _api.token = token;
      await prefs.setString(kTokenPrefsKey, token);
    }
    await prefs.setString(kUserPrefsKey, jsonEncode(user.toJson()));

    _user = user;
    _loading = false;
    notifyListeners();
    return user;
  }

  Future<void> logout() async {
    if (_loggingOut) return;
    _loggingOut = true;
    try {
      try {
        await beforeLogout?.call();
      } catch (error) {
        debugPrint('Before sign-out: $error');
      }
      await _clear();
      notifyListeners();
    } finally {
      _loggingOut = false;
    }
  }

  Future<void> _clear() async {
    _user = null;
    _api.token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(kTokenPrefsKey);
    await prefs.remove(kUserPrefsKey);
  }
}
