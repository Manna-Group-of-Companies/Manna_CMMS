import '../core/api_client.dart';
import '../models/purchasing.dart';

/// Low value purchase requests, one method per endpoint.
///
/// Kept apart from `MaintenanceRepository` for the same reason that one is
/// apart from the stock catalog: a different half of the API, kept in ERPNext
/// only, and a screen reading it should not have to wonder whether SAP is
/// involved. It never is.
///
/// Every step goes to `/:id/<step>`, and the server decides whether the
/// signed-in person may take it - the record's `may` is how the screens know
/// beforehand.
class PurchasingRepository {
  PurchasingRepository(this._api);

  final ApiClient _api;

  LowValuePurchase _record(dynamic data) =>
      LowValuePurchase.fromJson(data as Map<String, dynamic>);

  /// Newest first. A plant head is sent their own plants' only.
  Future<List<LowValuePurchase>> lowValuePurchases({String? status, String? plant}) async {
    final data = await _api.get('/low-value-purchases', query: {
      if (status != null && status.isNotEmpty) 'status': status,
      if (plant != null && plant.isNotEmpty) 'plant': plant,
    });
    return (data as List? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(LowValuePurchase.fromJson)
        .toList(growable: false);
  }

  Future<LowValueOptions> lowValueOptions() async {
    final data = await _api.get('/low-value-purchases/options');
    return LowValueOptions.fromJson(data as Map<String, dynamic>);
  }

  Future<LowValuePurchase> lowValuePurchase(String id) async =>
      _record(await _api.get('/low-value-purchases/$id'));

  /// [lines] carries `description`, `specification`, `qty`, `unit`, `estRate`
  /// and `remarks` per item.
  Future<LowValuePurchase> raiseLowValue({
    required String plant,
    required String department,
    required String urgency,
    required String requiredBy,
    required String purpose,
    required List<Map<String, dynamic>> lines,
  }) async =>
      _record(await _api.post('/low-value-purchases', {
        'plant': plant,
        'department': department,
        'urgency': urgency,
        'requiredBy': requiredBy,
        'purpose': purpose,
        'lines': lines,
      }));

  /// The purchase manager bought it. [rates] maps a line's `idx` to the rate
  /// paid; a line left out keeps its estimate.
  Future<LowValuePurchase> orderLowValue(
    String id, {
    required String vendorName,
    String vendorContact = '',
    String expectedOn = '',
    String remarks = '',
    Map<int, double> rates = const {},
  }) async =>
      _record(await _api.post('/low-value-purchases/$id/order', {
        'vendorName': vendorName,
        'vendorContact': vendorContact,
        'expectedOn': expectedOn,
        'remarks': remarks,
        'lines': [
          for (final entry in rates.entries) {'idx': entry.key, 'rate': entry.value},
        ],
      }));

  Future<LowValuePurchase> receiveLowValue(
    String id, {
    String billNo = '',
    String billDate = '',
    String remarks = '',
  }) async =>
      _record(await _api.post('/low-value-purchases/$id/receive', {
        'billNo': billNo,
        'billDate': billDate,
        'remarks': remarks,
      }));

  Future<LowValuePurchase> rejectLowValue(String id, String reason) async =>
      _record(await _api.post('/low-value-purchases/$id/reject', {'reason': reason}));

  Future<LowValuePurchase> withdrawLowValue(String id, String reason) async =>
      _record(await _api.post('/low-value-purchases/$id/withdraw', {'reason': reason}));
}
