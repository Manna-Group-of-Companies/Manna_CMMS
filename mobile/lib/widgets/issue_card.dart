import 'package:flutter/material.dart';

import '../core/formatters.dart';
import '../core/palette.dart';
import '../models/models.dart';
import 'common.dart';
import 'product_details_sheet.dart';

/// One issuance record, shared by the admin and supervisor issue history
/// screens. [onReturn] adds the "Return Stock" action (supervisors only).
class IssueCard extends StatelessWidget {
  const IssueCard({
    super.key,
    required this.issue,
    this.showSupervisor = false,
    this.onReturn,
  });

  final IssueRecord issue;
  final bool showSupervisor;
  final Future<void> Function()? onReturn;

  @override
  Widget build(BuildContext context) {
    final product = issue.product;
    final unit = product?.unit ?? '';

    return AppCard(
      padding: const EdgeInsets.all(14),
      onTap: product == null ? null : () => showProductDetails(context, product),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              MonoText(issue.issueNumber, color: AppColors.warning, fontSize: 11.5),
              const Spacer(),
              AppBadge(
                issue.returnStatus,
                color: switch (issue.returnStatus) {
                  'Returned' => AppColors.success,
                  'Partially Returned' => AppColors.warning,
                  _ => AppColors.danger,
                },
                uppercase: false,
                fontSize: 10.5,
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ProductThumb(imageUrl: product?.image ?? '', size: 42),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product?.name ?? 'Deleted Product',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textStrong,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        height: 1.25,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        MonoText(product?.code ?? '—', fontSize: 10.5),
                        if ((product?.storeRoom ?? '').isNotEmpty) ...[
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              '• ${product!.storeRoom}',
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 10.5,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              AppBadge(
                '−${issue.quantity} $unit',
                color: AppColors.warning,
                uppercase: false,
                fontSize: 11.5,
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 12),
          _DetailLine(
            icon: Icons.person_outline,
            label: 'Recipient',
            value: issue.recipient,
            valueColor: AppColors.textStrong,
          ),
          if (issue.purpose.isNotEmpty) ...[
            const SizedBox(height: 6),
            _DetailLine(
              icon: Icons.notes_outlined,
              label: 'Purpose',
              value: issue.purpose,
              italic: true,
            ),
          ],
          if (issue.returnedQuantity > 0 && !issue.isReturned) ...[
            const SizedBox(height: 6),
            _DetailLine(
              icon: Icons.assignment_return_outlined,
              label: 'Returned',
              value: '${issue.returnedQuantity} of ${issue.quantity} $unit',
              valueColor: AppColors.warning,
            ),
          ],
          if (showSupervisor) ...[
            const SizedBox(height: 6),
            _DetailLine(
              icon: Icons.badge_outlined,
              label: 'Issued by',
              value: issue.isMine
                  ? '${issue.supervisorName} (you)'
                  : (issue.supervisorEmail.isEmpty
                      ? issue.supervisorName
                      : '${issue.supervisorName} (${issue.supervisorEmail})'),
              valueColor: issue.isMine ? AppColors.primaryDeep : AppColors.textBody,
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              const Icon(Icons.calendar_today_outlined, size: 12, color: AppColors.textMuted),
              const SizedBox(width: 5),
              Text(
                formatDateTime(issue.createdAt),
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
              ),
              const Spacer(),
              // Partial returns keep the action available until nothing is
              // left outstanding. Only the supervisor who made the issue may
              // return it — the server rejects anyone else.
              if (onReturn != null && issue.canReturn)
                TextButton.icon(
                  onPressed: () => onReturn!(),
                  icon: const Icon(Icons.undo, size: 15),
                  label: const Text('Return Stock'),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.accent,
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor = AppColors.textBody,
    this.italic = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color valueColor;
  final bool italic;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 13, color: AppColors.textMuted),
        const SizedBox(width: 7),
        Text('$label: ', style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5)),
        Expanded(
          child: Text(
            value.isEmpty ? '—' : value,
            style: TextStyle(
              color: valueColor,
              fontSize: 12,
              fontWeight: italic ? FontWeight.normal : FontWeight.w600,
              fontStyle: italic ? FontStyle.italic : FontStyle.normal,
            ),
          ),
        ),
      ],
    );
  }
}
