import '../core/api_client.dart';
import '../models/purchasing.dart';

/// The Purchase Request Sheet, one method per endpoint.
///
/// Kept apart from `MaintenanceRepository` for the same reason that one is
/// apart from the stock catalog: a different half of the API, kept in ERPNext
/// only, and a screen reading it should not have to wonder whether SAP is
/// involved. It never is.
///
/// A row is changed one column at a time with a `PUT` of just that column, and
/// the server decides whether the signed-in person may - the row's `editable`
/// is how the screens know beforehand.
class PurchasingRepository {
  PurchasingRepository(this._api);

  final ApiClient _api;

  PurchaseRequest _row(dynamic data) => PurchaseRequest.fromJson(data as Map<String, dynamic>);

  /// Newest first, every company's. Each filter is optional; [openOnly] leaves
  /// out the rows already Received or Delivered.
  Future<List<PurchaseRequest>> sheet({
    String company = '',
    String approval = '',
    String purchase = '',
    String type = '',
    bool openOnly = false,
  }) async {
    final data = await _api.get('/low-value-purchases', query: {
      if (company.isNotEmpty) 'company': company,
      if (approval.isNotEmpty) 'approval': approval,
      if (purchase.isNotEmpty) 'purchase': purchase,
      if (type.isNotEmpty) 'type': type,
      if (openOnly) 'open': '1',
    });
    return (data as List? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(PurchaseRequest.fromJson)
        .toList(growable: false);
  }

  Future<PurchaseSheetOptions> options() async {
    final data = await _api.get('/low-value-purchases/options');
    return PurchaseSheetOptions.fromJson(data as Map<String, dynamic>);
  }

  /// The row with its images.
  Future<PurchaseRequest> request(String id) async =>
      _row(await _api.get('/low-value-purchases/$id'));

  /// A new row. A blank [date] is today and a blank [raisedByName] is the
  /// account's own name, both filled in by the server.
  Future<PurchaseRequest> add({
    String date = '',
    required String type,
    required String company,
    String raisedByName = '',
    required String description,
    String purpose = '',
    String links = '',
    required String priority,
  }) async =>
      _row(await _api.post('/low-value-purchases', {
        if (date.isNotEmpty) 'date': date,
        'type': type,
        'company': company,
        if (raisedByName.isNotEmpty) 'raisedByName': raisedByName,
        'description': description,
        'purpose': purpose,
        'links': links,
        'priority': priority,
      }));

  /// Changes one column. Dates go as "YYYY-MM-DD", or "" to empty one.
  Future<PurchaseRequest> change(String id, String column, String value) async =>
      _row(await _api.put('/low-value-purchases/$id', {column: value}));

  /// Attaches an image already read into memory. Mirrors the breakdown photo.
  Future<void> attachImage(
    String id, {
    required String fileName,
    required String contentType,
    required String dataBase64,
  }) async {
    await _api.post('/low-value-purchases/$id/files', {
      'fileName': fileName,
      'contentType': contentType,
      'dataBase64': dataBase64,
    });
  }

  Future<void> removeImage(String id, String fileId) async {
    await _api.delete('/low-value-purchases/$id/files/$fileId');
  }
}
