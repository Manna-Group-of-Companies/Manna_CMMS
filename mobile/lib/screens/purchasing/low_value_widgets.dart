import 'package:flutter/material.dart';

import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../widgets/common.dart';

/// Pieces the low value list and detail screens share.

/// The status, coloured for where it stands in the purchase.
///
/// Not [StatusBadge]: that one's colours are the stock approvals', where
/// anything it does not know reads as pending - which would show a request
/// that has been received as still waiting.
class LowValueStatusBadge extends StatelessWidget {
  const LowValueStatusBadge(this.status, {super.key});

  final String status;

  static Color colorOf(String status) => switch (status) {
        'Ordered' => AppColors.info,
        'Received' => AppColors.success,
        'Rejected' => AppColors.danger,
        'Withdrawn' => AppColors.textMuted,
        _ => AppColors.warning,
      };

  @override
  Widget build(BuildContext context) => AppBadge(status, color: colorOf(status));
}

/// "YYYY-MM-DD", the form the API takes dates in.
String apiDay(DateTime day) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${day.year}-${two(day.month)}-${two(day.day)}';
}

/// A quantity without a trailing ".0" - "2 Nos", "1.5 Kg".
String formatQty(double qty) =>
    qty == qty.roundToDouble() ? qty.toStringAsFixed(0) : '$qty';

class LvFieldLabel extends StatelessWidget {
  const LvFieldLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.textMuted,
          ),
        ),
      );
}

/// A day picked from a calendar, with a way to clear it when it is optional.
class LvDateField extends StatelessWidget {
  const LvDateField({
    super.key,
    required this.value,
    required this.firstDate,
    required this.lastDate,
    required this.onChanged,
    this.placeholder = 'Choose a date',
    this.clearable = false,
  });

  final DateTime? value;
  final DateTime firstDate;
  final DateTime lastDate;
  final ValueChanged<DateTime?> onChanged;
  final String placeholder;
  final bool clearable;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              icon: const Icon(Icons.event_outlined, size: 18),
              label: Text(value == null ? placeholder : formatDate(value)),
              onPressed: () async {
                final now = DateTime.now();
                var initial = value ?? now;
                if (initial.isBefore(firstDate)) initial = firstDate;
                if (initial.isAfter(lastDate)) initial = lastDate;
                final picked = await showDatePicker(
                  context: context,
                  initialDate: initial,
                  firstDate: firstDate,
                  lastDate: lastDate,
                );
                if (picked != null) onChanged(picked);
              },
            ),
          ),
          if (clearable && value != null) ...[
            const SizedBox(width: 8),
            IconButton(
              tooltip: 'Clear',
              icon: const Icon(Icons.close, size: 18),
              onPressed: () => onChanged(null),
            ),
          ],
        ],
      );
}

/// A label beside its value, the way the detail sheet reads.
class LvLine extends StatelessWidget {
  const LvLine(this.label, this.value, {super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 110,
              child: Text(
                label,
                style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
            ),
            Expanded(child: Text(value, style: const TextStyle(fontSize: 13))),
          ],
        ),
      );
}

/// The two figures at the foot of a sheet, or the one before it is bought.
class LvTotalRow extends StatelessWidget {
  const LvTotalRow({super.key, required this.label, required this.amount, this.strong = false});

  final String label;
  final double amount;
  final bool strong;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: strong ? FontWeight.w700 : FontWeight.w500,
                color: strong ? AppColors.textStrong : AppColors.textSecondary,
              ),
            ),
          ),
          Text(
            formatCurrency(amount),
            style: TextStyle(
              fontSize: strong ? 16 : 13,
              fontWeight: FontWeight.w700,
              color: strong ? AppColors.textStrong : AppColors.textBody,
            ),
          ),
        ],
      );
}
