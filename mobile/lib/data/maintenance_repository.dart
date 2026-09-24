import '../core/api_client.dart';
import '../models/maintenance.dart';

/// Breakdowns and maintenance requests, one method per endpoint.
///
/// Separate from [StockRepository] because it talks to a different half of the
/// API - the one that survived the move onto ERPNext - and mixing the two would
/// hide which calls still reach MongoDB.
///
/// Every write goes through `/action`, which is the same door the web client
/// uses: the server decides whether the signed-in person may take that step,
/// applies the ERPNext workflow transition, and sends the updated record back.
/// Nothing here writes a state directly.
class MaintenanceRepository {
  MaintenanceRepository(this._api);

  final ApiClient _api;

  List<T> _list<T>(dynamic data, T Function(Map<String, dynamic>) from) =>
      (data as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .map(from)
          .toList(growable: false);

  Map<String, WorkStage> _stages(dynamic data) {
    final map = data as Map<String, dynamic>? ?? {};
    return map.map(
      (action, value) => MapEntry(
        action,
        WorkStage.fromJson(action, value as Map<String, dynamic>? ?? {}),
      ),
    );
  }

  // ------------------------------------------------------------- breakdowns

  Future<List<Breakdown>> breakdowns({bool openOnly = false, String? plant}) async {
    final data = await _api.get('/breakdowns', query: {
      if (openOnly) 'open': 'true',
      'plant': plant,
    });
    return _list(data, Breakdown.fromJson);
  }

  Future<Breakdown> breakdown(String id) async {
    final data = await _api.get('/breakdowns/$id');
    return Breakdown.fromJson(data as Map<String, dynamic>);
  }

  /// The machines this account may report against.
  ///
  /// Already narrowed by the server to the plants the signed-in person covers,
  /// so a plant head is served only their own. The screen does not filter again.
  Future<List<MachineOption>> breakdownMachines() async {
    final data = await _api.get('/breakdowns/machines');
    return _list(data, MachineOption.fromJson);
  }

  Future<List<PlantOption>> plants() async {
    final data = await _api.get('/breakdowns/plants');
    return _list(data, PlantOption.fromJson);
  }

  Future<Map<String, WorkStage>> breakdownStages() async =>
      _stages(await _api.get('/breakdowns/stages'));

  Future<Breakdown> reportBreakdown({
    required String machine,
    required String stoppedAt,
    required String whatHappened,
    required String priority,
  }) async {
    final data = await _api.post('/breakdowns', {
      'machine': machine,
      'stoppedAt': stoppedAt,
      'whatHappened': whatHappened,
      'priority': priority,
      // A breakdown is a stopped machine, so this is not asked. The record and
      // the report both read it, so it is still sent.
      'productionStopped': true,
    });
    return Breakdown.fromJson(data as Map<String, dynamic>);
  }

  /// Attaches a file already read into memory - a photo taken when reporting,
  /// or the signed log sheet. Mirrors `POST /breakdowns/:id/files` on the web.
  ///
  /// Uploaded as a private ERPNext file, the same as every other attachment in
  /// this system, so there is no public URL to hand back and show inline - only
  /// that it succeeded.
  Future<void> attachToBreakdown(
    String id, {
    required String fileName,
    required String contentType,
    required String dataBase64,
  }) async {
    await _api.post('/breakdowns/$id/files', {
      'fileName': fileName,
      'contentType': contentType,
      'dataBase64': dataBase64,
    });
  }

  /// Moves a breakdown on. [fields] carries whatever the stage collects.
  Future<Breakdown> advanceBreakdown(
    String id,
    String action, {
    Map<String, dynamic> fields = const {},
  }) async {
    final data = await _api.post('/breakdowns/$id/action', {
      'action': action,
      'fields': fields,
    });
    return Breakdown.fromJson(data as Map<String, dynamic>);
  }

  // ----------------------------------------------------- maintenance requests

  Future<List<MaintenanceRequest>> requests({bool openOnly = false, String? plant}) async {
    final data = await _api.get('/maintenance-requests', query: {
      if (openOnly) 'open': 'true',
      'plant': plant,
    });
    return _list(data, MaintenanceRequest.fromJson);
  }

  Future<MaintenanceRequest> request(String id) async {
    final data = await _api.get('/maintenance-requests/$id');
    return MaintenanceRequest.fromJson(data as Map<String, dynamic>);
  }

  Future<Map<String, WorkStage>> requestStages() async =>
      _stages(await _api.get('/maintenance-requests/stages'));

  Future<MaintenanceRequest> raiseRequest({
    required String title,
    required String plant,
    required String whatIsNeeded,
    required String priority,
    String machine = '',
    String whyNeeded = '',
    String neededBy = '',
  }) async {
    final data = await _api.post('/maintenance-requests', {
      'title': title,
      'plant': plant,
      'whatIsNeeded': whatIsNeeded,
      'priority': priority,
      if (machine.isNotEmpty) 'machine': machine,
      if (whyNeeded.isNotEmpty) 'whyNeeded': whyNeeded,
      if (neededBy.isNotEmpty) 'neededBy': neededBy,
    });
    return MaintenanceRequest.fromJson(data as Map<String, dynamic>);
  }

  Future<MaintenanceRequest> advanceRequest(
    String id,
    String action, {
    Map<String, dynamic> fields = const {},
  }) async {
    final data = await _api.post('/maintenance-requests/$id/action', {
      'action': action,
      'fields': fields,
    });
    return MaintenanceRequest.fromJson(data as Map<String, dynamic>);
  }
}
