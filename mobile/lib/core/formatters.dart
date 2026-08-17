import 'package:intl/intl.dart';

final _time = DateFormat.jm();
final _date = DateFormat('MMM d, y');

DateTime? parseDate(dynamic value) {
  if (value is! String || value.isEmpty) return null;
  return DateTime.tryParse(value)?.toLocal();
}

/// "5:03 PM"
String formatTime(DateTime? date) => date == null ? '—' : _time.format(date);

/// "Aug 11, 2026"
String formatDate(DateTime? date) => date == null ? '—' : _date.format(date);

/// "Aug 11, 2026 5:03 PM"
String formatDateTime(DateTime? date) =>
    date == null ? '—' : '${_date.format(date)} ${_time.format(date)}';

/// Rupees, grouped the Indian way — "₹1,20,450.50", and "₹2,400" when the
/// amount is whole. Costs are held in INR throughout; there is no second
/// currency to switch on.
///
/// Trailing ".00" is dropped because most stock is costed in whole rupees and
/// a column of "₹2,400.00" reads worse than "₹2,400" for no added precision.
final _rupees = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);
final _wholeRupees = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);

String formatCurrency(num? amount) {
  if (amount == null) return '—';
  return amount == amount.roundToDouble()
      ? _wholeRupees.format(amount)
      : _rupees.format(amount);
}

/// Parsing helpers tolerant of the partially-populated documents the API
/// returns (e.g. `populate("product", "name code unit")`).
int asInt(dynamic value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? fallback;
  return fallback;
}

String asString(dynamic value, [String fallback = '']) =>
    value is String ? value : (value == null ? fallback : '$value');

String? asId(dynamic value) {
  if (value is String) return value;
  if (value is Map && value['_id'] != null) return '${value['_id']}';
  return null;
}
