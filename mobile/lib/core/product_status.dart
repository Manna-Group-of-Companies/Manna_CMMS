import 'package:flutter/material.dart';

import 'palette.dart';

/// Condition recorded against a product during the stock take — "Good
/// Condition", "Working", "Brand New", "Complaint", "BreakDown on High loads".
///
/// The server keeps the field as free text, because the store writes what it
/// sees and the phrasing keeps changing. So the colour is matched on words
/// rather than on a fixed list, and anything unrecognised stays neutral instead
/// of being coloured wrongly. Mirrors `client/src/utils/productStatus.js`.
/// The conditions offered when a product is added or edited, in the order the
/// store uses them. Older rows may carry a phrasing that is not on this list —
/// the form keeps whatever it was given rather than forcing it onto one of
/// these, so nothing is rewritten by being looked at.
const productStatuses = <String>[
  'Good Condition',
  'Working',
  'Brand New',
  'Partially Usable',
  'Almost Empty',
  'Not Verified',
  'Complaint',
];

Color statusColor(String status) {
  final value = status.toLowerCase();
  if (value.trim().isEmpty) return AppColors.textSecondary;

  // Faults first, then the qualifiers, so "Working and not verified" reads as a
  // caution rather than as working.
  if (RegExp(r'break|damag|complaint|faulty|not working|dead|scrap').hasMatch(value)) {
    return AppColors.danger;
  }
  if (RegExp(r'not verified|unverified|partial|almost empty|empty|repair|service')
      .hasMatch(value)) {
    return AppColors.warning;
  }
  if (RegExp(r'good|working|brand new|new|full|usable').hasMatch(value)) {
    return AppColors.success;
  }
  return AppColors.textSecondary;
}
