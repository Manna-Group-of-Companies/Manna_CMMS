import 'package:flutter/material.dart';

import 'palette.dart';

enum ToastType { info, success, error }

/// Global replacement for the web client's toast stack. Uses a root
/// [ScaffoldMessenger] so a toast can be raised from providers as well as
/// widgets, and keeps the status colour language (success / danger / info).
abstract final class Toast {
  static final GlobalKey<ScaffoldMessengerState> messengerKey =
      GlobalKey<ScaffoldMessengerState>();

  static void show(String message, [ToastType type = ToastType.info]) {
    final messenger = messengerKey.currentState;
    if (messenger == null || message.trim().isEmpty) return;

    final (accent, icon) = switch (type) {
      ToastType.success => (AppColors.success, Icons.check_circle_outline),
      ToastType.error => (AppColors.danger, Icons.error_outline),
      ToastType.info => (AppColors.info, Icons.info_outline),
    };

    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 4),
          behavior: SnackBarBehavior.floating,
          elevation: 0,
          backgroundColor: Colors.transparent,
          padding: EdgeInsets.zero,
          content: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: Color.alphaBlend(accent.withValues(alpha: 0.08), AppColors.surface),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: accent.withValues(alpha: 0.28)),
              boxShadow: AppShadows.raised,
            ),
            child: Row(
              children: [
                Icon(icon, size: 18, color: accent),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    message,
                    style: TextStyle(
                      color: accent,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
  }

  static void success(String message) => show(message, ToastType.success);
  static void error(String message) => show(message, ToastType.error);
}
