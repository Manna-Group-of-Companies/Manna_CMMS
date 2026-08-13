import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/toast.dart';
import '../data/repository.dart';
import '../models/models.dart';

/// Port of `client/src/context/NotificationContext.jsx`.
///
/// Polls `/notifications` every 30 seconds while a user is signed in.
class NotificationProvider extends ChangeNotifier {
  NotificationProvider(this._repository);

  static const _pollInterval = Duration(seconds: 30);

  final StockRepository _repository;

  List<AppNotification> _notifications = const [];
  Timer? _timer;
  String? _userId;
  bool _disposed = false;

  List<AppNotification> get notifications => _notifications;
  int get unreadCount => _notifications.where((n) => !n.read).length;

  /// Called by the provider wiring whenever the signed-in user changes.
  void syncUser(AppUser? user) {
    if (user?.id == _userId) return;
    _userId = user?.id;
    _timer?.cancel();

    if (user == null) {
      _notifications = const [];
      // Deferred: `syncUser` runs while the widget tree is building.
      scheduleMicrotask(_notify);
      return;
    }

    scheduleMicrotask(refresh);
    _timer = Timer.periodic(_pollInterval, (_) => refresh());
  }

  Future<void> refresh() async {
    if (_userId == null) return;
    try {
      _notifications = await _repository.notifications();
      _notify();
    } catch (error) {
      debugPrint('Error fetching notifications: $error');
    }
  }

  /// Notifications arrive from timers and microtasks that can outlive the
  /// provider, so every emission goes through this guard.
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> markAsRead(String id) async {
    try {
      await _repository.markNotificationRead(id);
      _notifications = [
        for (final n in _notifications) n.id == id ? n.copyWith(read: true) : n,
      ];
      _notify();
    } catch (error) {
      debugPrint('Error marking notification read: $error');
    }
  }

  Future<void> markAllAsRead() async {
    try {
      await _repository.markAllNotificationsRead();
      _notifications = [for (final n in _notifications) n.copyWith(read: true)];
      _notify();
      Toast.success('All notifications marked as read');
    } catch (error) {
      debugPrint('Error marking all read: $error');
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }
}
