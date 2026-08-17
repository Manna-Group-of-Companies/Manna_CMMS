import 'package:flutter/material.dart';

import '../core/formatters.dart';
import '../core/palette.dart';
import '../models/models.dart';
import 'common.dart';
import 'product_details_sheet.dart';

/// One issuance record, shared by the admin and supervisor issue history
/// screens.
///
/// An issued item settles in exactly three ways, and each has its own action
/// on the product details sheet the card opens: [onReturn] hands it back into
/// the Red Stock Room, [onConsume] books it as used up, [onScrap] writes it
/// off. The card itself carries no buttons.
class IssueCard extends StatelessWidget {
  const IssueCard({
    super.key,
    required this.issue,
    this.showSupervisor = false,
    this.onReturn,
    this.onConsume,
    this.onScrap,
  });

  final IssueRecord issue;
  final bool showSupervisor;
  final Future<void> Function()? onReturn;
  final Future<void> Function()? onConsume;
  final Future<void> Function()? onScrap;

  @override
  Widget build(BuildContext context) {
    final product = issue.product;
    final unit = product?.unit ?? '';

    return AppCard(
      padding: const EdgeInsets.all(14),
      // Actioning is reached by opening the product, the same way every other
      // stock operation is. Any supervisor may action any issue, and partial
      // settlement keeps the actions available until nothing is outstanding.
      onTap: product == null
          ? null
          : () => showProductDetails(
                context,
                product,
                actions: [
                  if (onReturn != null && issue.canReturn)
                    ProductAction(
                      filled: true,
                      label: 'Return Stock',
                      icon: Icons.undo,
                      color: AppColors.accent,
                      onSelected: () => onReturn!(),
                    ),
                  if (onConsume != null && issue.canReturn)
                    ProductAction(
                      label: 'Mark Consumed',
                      icon: Icons.local_fire_department_outlined,
                      color: AppColors.textSecondary,
                      onSelected: () => onConsume!(),
                    ),
                  if (onScrap != null && issue.canReturn)
                    ProductAction(
                      label: 'Scrap',
                      icon: Icons.delete_outline,
                      color: AppColors.danger,
                      onSelected: () => onScrap!(),
                    ),
                ],
              ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              MonoText(issue.issueNumber, color: AppColors.warning, fontSize: 11.5),
              const Spacer(),
              AppBadge(
                _settlementLabel(issue),
                color: _settlementColor(issue),
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
          if (issue.consumedQuantity > 0) ...[
            const SizedBox(height: 6),
            _DetailLine(
              icon: Icons.local_fire_department_outlined,
              label: 'Consumed',
              value: '${issue.consumedQuantity} of ${issue.quantity} $unit',
              valueColor: AppColors.textSecondary,
            ),
          ],
          if (issue.scrappedQuantity > 0) ...[
            const SizedBox(height: 6),
            _DetailLine(
              icon: Icons.delete_outline,
              label: 'Scrapped',
              // The value is the point of recording scrap at all, so it is
              // shown beside the quantity rather than buried in the log.
              value: issue.scrapValue > 0
                  ? '${issue.scrappedQuantity} of ${issue.quantity} $unit  •  ${formatCurrency(issue.scrapValue)}'
                  : '${issue.scrappedQuantity} of ${issue.quantity} $unit',
              valueColor: AppColors.danger,
            ),
          ],
          if (issue.outstanding > 0 && issue.settledQuantity > 0) ...[
            const SizedBox(height: 6),
            _DetailLine(
              icon: Icons.pending_outlined,
              label: 'Outstanding',
              value: '${issue.outstanding} $unit',
              valueColor: AppColors.textStrong,
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
            ],
          ),
        ],
      ),
    );
  }
}

/// How the issue ended, in one word.
///
/// The server's `returnStatus` only tracks the returning half of the story, so
/// an issue that was entirely used up still reads "Not Returned" there. What
/// the card needs to say is whether anything is still outstanding, and if not,
/// which of the three routes closed it.
String _settlementLabel(IssueRecord issue) {
  if (!issue.isSettled) {
    return issue.settledQuantity > 0 ? 'Part Settled' : 'Outstanding';
  }
  if (issue.returnedQuantity == issue.quantity) return 'Returned';
  if (issue.consumedQuantity == issue.quantity) return 'Consumed';
  if (issue.scrappedQuantity == issue.quantity) return 'Scrapped';
  return 'Settled';
}

Color _settlementColor(IssueRecord issue) {
  if (!issue.isSettled) {
    return issue.settledQuantity > 0 ? AppColors.warning : AppColors.danger;
  }
  // Scrap is the one settlement worth flagging even when complete: it is the
  // only one that cost the company something.
  return issue.scrappedQuantity > 0 ? AppColors.danger : AppColors.success;
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
