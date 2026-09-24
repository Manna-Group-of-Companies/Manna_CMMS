import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/palette.dart';
import '../state/auth_provider.dart';
import '../widgets/common.dart';

/// Where somebody lands when their role has no screen in this app.
///
/// Mirrors `client/src/pages/auth/NoAccess.jsx`. The app now serves only
/// Breakdowns and Maintenance Requests - every stock-tracking screen it used
/// to carry is gone - so a role the web's own matrix does not list for either
/// one has nothing here. Signing in still worked and the password was still
/// right; this says so, rather than looking like a failed login.
class NoAccessScreen extends StatelessWidget {
  const NoAccessScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;

    return Scaffold(
      backgroundColor: AppColors.canvas,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AppCard(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: const Icon(
                        Icons.lock_outline,
                        size: 32,
                        color: AppColors.primary,
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'No screens for this role yet',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textStrong,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'You are signed in and your password is correct. This app covers '
                      'breakdowns and maintenance requests, and the ${user?.role ?? 'account'} '
                      'role is not on either of them yet.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 13, color: AppColors.textBody, height: 1.4),
                    ),
                    if (user?.email.isNotEmpty == true) ...[
                      const SizedBox(height: 14),
                      Text(
                        'Signed in as ${user!.email}',
                        style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                      ),
                    ],
                    const SizedBox(height: 8),
                    const Text(
                      'Ask the administrator to add your role, and it will appear the next '
                      'time you sign in.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                    ),
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.logout, size: 18),
                        label: const Text('Sign out'),
                        onPressed: () => context.read<AuthProvider>().logout(),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
