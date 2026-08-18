import 'package:flutter/material.dart';

import '../core/formatters.dart';
import '../core/palette.dart';
import '../models/models.dart';
import 'app_table.dart';
import 'product_details_sheet.dart';

/// The issue history as rows and columns, sized to the screen: Product, Qty and
/// Recipient carry the summary, and the rest of the record — issue number, who
/// issued it, purpose, date and the return action — unfolds under the row.
///
/// The web client (`pages/supervisor/IssueHistory.jsx`) shows the same fields as
/// one wide table; a phone gets the same data without the sideways scroll.
class IssueTable extends StatelessWidget {
  const IssueTable({
    super.key,
    required this.issues,
    this.showSupervisor = false,
    this.onReturn,
    this.onConsume,
    this.onScrap,
  });

  final List<IssueRecord> issues;

  /// Adds the "Issued by" line to the unfolded record — the supervisor list is
  /// shared, so it matters who sent the stock out.
  final bool showSupervisor;

  /// The three ways an issued item settles. Supplied by the supervisor screen;
  /// omitted where actioning is not offered (the Admin's read-only audit view).
  final Future<void> Function(IssueRecord issue)? onReturn;
  final Future<void> Function(IssueRecord issue)? onConsume;
  final Future<void> Function(IssueRecord issue)? onScrap;

  /// The full wording does not fit a phone column; the badge shortens it and
  /// the unfolded record spells it out.
  ///
  /// This reads settlement, not `returnStatus`: an issue that was entirely
  /// consumed is closed business even though nothing was ever returned.
  static String _shortStatus(IssueRecord issue) {
    if (!issue.isSettled) return issue.settledQuantity > 0 ? 'Partial' : 'Out';
    if (issue.returnedQuantity == issue.quantity) return 'Returned';
    if (issue.consumedQuantity == issue.quantity) return 'Used';
    if (issue.scrappedQuantity == issue.quantity) return 'Scrapped';
    return 'Settled';
  }

  static Color _statusColor(IssueRecord issue) {
    if (!issue.isSettled) {
      return issue.settledQuantity > 0 ? AppColors.warning : AppColors.danger;
    }
    return issue.scrappedQuantity > 0 ? AppColors.danger : AppColors.success;
  }

  @override
  Widget build(BuildContext context) {
    return AppTable<IssueRecord>(
      items: issues,
      idOf: (issue) => issue.id,
      columns: const [
        AppTableColumn('Engineering Stock', flex: 6),
        AppTableColumn('Qty', width: 52, center: true),
        AppTableColumn('Recipient', flex: 3),
        AppTableColumn('Status', width: 74, center: true),
      ],
      cellsOf: (context, issue) => [
        TableTitleCell(
          title: issue.product?.name ?? 'Deleted Engineering Stock',
          subtitle: issue.product?.code ?? '—',
          imageUrl: issue.product?.image ?? '',
        ),
        TableNumberCell(
          value: '−${issue.quantity}',
          unit: issue.product?.unit ?? '',
          color: AppColors.warning,
        ),
        TableTextCell(issue.recipient),
        TableBadgeCell(
          _shortStatus(issue),
          color: _statusColor(issue),
        ),
      ],
      detailOf: (context, issue) {
        final unit = issue.product?.unit ?? '';
        final storeRoom = issue.product?.storeRoom ?? '';

        return TableDetail(
          lines: [
            TableDetailLine(label: 'Issue #', value: issue.issueNumber, mono: true),
            if (showSupervisor)
              TableDetailLine(
                label: 'Issued by',
                value: issue.isMine
                    ? '${issue.supervisorName} (you)'
                    : issue.supervisorName,
                valueColor: issue.isMine ? AppColors.primaryDeep : null,
              ),
            if (storeRoom.isNotEmpty)
              TableDetailLine(label: 'From', value: storeRoom),
            TableDetailLine(label: 'Purpose', value: issue.purpose, italic: true),
            TableDetailLine(
              label: 'Date & time',
              value: formatDateTime(issue.createdAt),
            ),
            TableDetailLine(label: 'Return status', value: issue.returnStatus),
            if (issue.returnedQuantity > 0)
              TableDetailLine(
                label: 'Returned',
                value: '${issue.returnedQuantity} of ${issue.quantity} $unit'.trim(),
                valueColor: AppColors.warning,
              ),
            if (issue.consumedQuantity > 0)
              TableDetailLine(
                label: 'Consumed',
                value: '${issue.consumedQuantity} of ${issue.quantity} $unit'.trim(),
                valueColor: AppColors.textSecondary,
              ),
            if (issue.scrappedQuantity > 0)
              TableDetailLine(
                label: 'Scrapped',
                value: '${issue.scrappedQuantity} of ${issue.quantity} $unit'.trim(),
                valueColor: AppColors.danger,
              ),
            if (issue.scrapValue > 0)
              TableDetailLine(
                label: 'Scrap value',
                value: formatCurrency(issue.scrapValue),
                valueColor: AppColors.dangerDeep,
              ),
            if (issue.canReturn)
              TableDetailLine(
                label: 'Outstanding',
                value: '${issue.outstanding} $unit'.trim(),
                valueColor: AppColors.danger,
              ),
          ],
          actions: [
            if (issue.product != null)
              TableActionButton(
                label: 'Engineering Stock',
                icon: Icons.inventory_2_outlined,
                color: AppColors.primaryDeep,
                onPressed: () => showProductDetails(context, issue.product!),
              ),
            // Any supervisor may action any issue — whoever the recipient hands
            // the stock back to books it in.
            if (onReturn != null && issue.canReturn)
              TableActionButton(
                filled: true,
                label: 'Return Stock',
                icon: Icons.undo,
                color: AppColors.accent,
                onPressed: () => onReturn!(issue),
              ),
            if (onConsume != null && issue.canReturn)
              TableActionButton(
                label: 'Consumed',
                icon: Icons.local_fire_department_outlined,
                color: AppColors.textSecondary,
                onPressed: () => onConsume!(issue),
              ),
            if (onScrap != null && issue.canReturn)
              TableActionButton(
                label: 'Scrap',
                icon: Icons.delete_outline,
                color: AppColors.danger,
                onPressed: () => onScrap!(issue),
              ),
          ],
        );
      },
    );
  }
}
