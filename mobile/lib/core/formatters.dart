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
