import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/palette.dart';
import '../../data/repository.dart';
import '../../models/models.dart';
import '../../state/auth_provider.dart';
import '../../state/server_provider.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';

/// Settings: the signed-in account, its request tallies, the server it talks
/// to, and sign-out. Reached from the last slot of the bottom bar.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  SupervisorDashboard? _summary;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    // The tallies come from the supervisor dashboard, which a branch account
    // is not allowed to read.
    if (context.read<AuthProvider>().user?.isBranch == true) return;
    try {
      final summary = await context.read<StockRepository>().supervisorDashboard();
      if (mounted) setState(() => _summary = summary);
    } catch (error) {
      // The rest of the screen is still useful without the tallies.
      debugPrint('Could not load request tallies: $error');
    }
  }

  Future<void> _confirmSignOut() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Sign out', style: TextStyle(fontSize: 17)),
        content: const Text(
          'Are you sure you want to sign out?',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.dangerDeep),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      await context.read<AuthProvider>().logout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final summary = _summary;

    return AppShell(
      title: 'Settings',
      child: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.primary,
        backgroundColor: AppColors.surfaceMuted,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            // Profile
            AppCard(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const PanelHeader(
                    icon: Icons.person_outline,
                    iconColor: AppColors.primaryDeep,
                    title: 'Profile',
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Container(
                        height: 58,
                        width: 58,
                        decoration: BoxDecoration(
                          color: AppColors.primary.withValues(alpha: 0.12),
                          shape: BoxShape.circle,
                          border:
                              Border.all(color: AppColors.primary.withValues(alpha: 0.22)),
                        ),
                        child: Icon(
                          user?.isBranch == true
                              ? Icons.warehouse_outlined
                              : Icons.person_outline,
                          size: 28,
                          color: AppColors.primaryDeep,
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user?.name ?? '—',
                              style: const TextStyle(
                                color: AppColors.textStrong,
                                fontSize: 17,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              user?.email ?? '',
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 12.5,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: [
                                AppBadge(
                                  user?.role ?? 'Supervisor',
                                  color: AppColors.primaryDeep,
                                  fontSize: 9.5,
                                ),
                                // A branch works one room, and the drawer that
                                // used to name it is gone.
                                if (user?.stockRoomName.isNotEmpty == true)
                                  AppBadge(
                                    user!.stockRoomName,
                                    color: AppColors.info,
                                    fontSize: 9.5,
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // Request tallies — supervisor-only; the endpoint refuses a branch.
            if (user?.isBranch != true) ...[
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const PanelHeader(
                      icon: Icons.assignment_outlined,
                      iconColor: AppColors.primaryDeep,
                      title: 'My Request Activity',
                    ),
                    const SizedBox(height: 14),
                    if (summary == null)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 14),
                        child: Center(
                          child: Text(
                            'Tallies unavailable.',
                            style: TextStyle(color: AppColors.textMuted, fontSize: 12),
                          ),
                        ),
                      )
                    else
                      Row(
                        children: [
                          Expanded(
                            child: MetricCard(
                              title: 'Pending',
                              value: summary.pendingRequests,
                              icon: Icons.schedule,
                              accent: AppColors.warning,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: MetricCard(
                              title: 'Accepted',
                              value: summary.approvedRequests,
                              icon: Icons.check_circle_outline,
                              accent: AppColors.success,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: MetricCard(
                              title: 'Rejected',
                              value: summary.rejectedRequests,
                              icon: Icons.cancel_outlined,
                              accent: AppColors.danger,
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
            ],

            // Connection — useful on site when the server address changes.
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const PanelHeader(
                    icon: Icons.dns_outlined,
                    iconColor: AppColors.textSecondary,
                    title: 'Server',
                  ),
                  const SizedBox(height: 12),
                  SpecTile(
                    label: 'API address',
                    value: context.watch<ServerProvider>().baseUrl,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            OutlinedButton.icon(
              onPressed: _confirmSignOut,
              icon: const Icon(Icons.logout, size: 18),
              label: const Text('Sign Out'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.dangerDeep,
                side: const BorderSide(color: AppColors.border),
                padding: const EdgeInsets.symmetric(vertical: 15),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
