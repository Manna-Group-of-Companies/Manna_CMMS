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
  });

  final List<IssueRecord> issues;

  /// Adds the "Issued by" line to the unfolded record — the supervisor list is
  /// shared, so it matters who sent the stock out.
  final bool showSupervisor;

  /// Supplied by the supervisor screen; omitted where returning is not offered.
  final Future<void> Function(IssueRecord issue)? onReturn;

  /// The full wording does not fit a phone column; the badge shortens it and
  /// the unfolded record spells it out.
  static String _shortStatus(String status) => switch (status) {
        'Returned' => 'Returned',
        'Partially Returned' => 'Partial',
        _ => 'Out',
      };

  static Color _statusColor(String status) => switch (status) {
        'Returned' => AppColors.success,
        'Partially Returned' => AppColors.warning,
        _ => AppColors.danger,
      };

  @override
  Widget build(BuildContext context) {
    return AppTable<IssueRecord>(
      items: issues,
      idOf: (issue) => issue.id,
      columns: const [
        AppTableColumn('Product', flex: 6),
        AppTableColumn('Qty', width: 52, center: true),
        AppTableColumn('Recipient', flex: 3),
        AppTableColumn('Status', width: 74, center: true),
      ],
      cellsOf: (context, issue) => [
        TableTitleCell(
          title: issue.product?.name ?? 'Deleted Product',
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
          _shortStatus(issue.returnStatus),
          color: _statusColor(issue.returnStatus),
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
                label: 'Product',
                icon: Icons.inventory_2_outlined,
                color: AppColors.primaryDeep,
                onPressed: () => showProductDetails(context, issue.product!),
              ),
            // Any supervisor may return any issue — whoever the recipient hands
            // the stock back to books it in.
            if (onReturn != null && issue.canReturn)
              TableActionButton(
                filled: true,
                label: 'Return Stock',
                icon: Icons.undo,
                color: AppColors.accent,
                onPressed: () => onReturn!(issue),
              ),
          ],
        );
      },
    );
  }
}
