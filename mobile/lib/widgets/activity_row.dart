import 'package:flutter/material.dart';

import '../core/formatters.dart';
import '../core/palette.dart';
import '../models/models.dart';
import 'common.dart';

/// One entry of "Today's Requests" (admin) / "Today's Activity Log" (supervisor).
class ActivityRow extends StatelessWidget {
  const ActivityRow({super.key, required this.entry, this.showSupervisor = false});

  final ActivityEntry entry;
  final bool showSupervisor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  entry.productName,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textStrong,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              StatusBadge(entry.status),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              RequestTypeBadge(entry.requestType),
              const SizedBox(width: 8),
              Expanded(
                child: MonoText(
                  entry.requestNumber,
                  color: AppColors.textMuted,
                  fontSize: 10,
                ),
              ),
              Text(
                formatTime(entry.time),
                style: const TextStyle(color: AppColors.textMuted, fontSize: 10.5),
              ),
            ],
          ),
          if (showSupervisor && entry.supervisorName.isNotEmpty) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(Icons.person_outline, size: 12, color: AppColors.textMuted),
                const SizedBox(width: 4),
                Text(
                  entry.supervisorName,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
