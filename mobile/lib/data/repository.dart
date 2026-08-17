import '../core/api_client.dart';
import '../core/formatters.dart';
import '../models/models.dart';

/// Typed access to the Express API. One method per endpoint used by the app.
class StockRepository {
  StockRepository(this._api);

  final ApiClient _api;

  // ---------------------------------------------------------------- products

  Future<List<Product>> products({
    String? search,
    String? category,
    String? subCategory,
    String? storeRoom,
    String? stockStatus,
  }) async {
    final data = await _api.get('/products', query: {
      'search': search,
      'category': category,
      'subCategory': subCategory,
      'storeRoom': storeRoom,
      'stockStatus': stockStatus,
    });
    return _list(data, Product.fromJson);
  }

  Future<List<String>> categories() async {
    final data = await _api.get('/products/categories');
    return (data as List? ?? []).map((e) => asString(e)).where((e) => e.isNotEmpty).toList();
  }

  /// Sub-categories in use, narrowed to [category] when one is given. The
  /// catalog holds well over a hundred, so an unscoped list is only useful
  /// before a category has been picked.
  Future<List<String>> subCategories({String? category}) async {
    final data = await _api.get('/products/subcategories', query: {'category': category});
    return (data as List? ?? []).map((e) => asString(e)).where((e) => e.isNotEmpty).toList();
  }

  Future<Product> product(String id) async {
    final data = await _api.get('/products/$id');
    return Product.fromJson(data as Map<String, dynamic>);
  }

  // --------------------------------------------------------------- dashboard

  Future<AdminDashboard> adminDashboard() async {
    final data = await _api.get('/dashboard/admin');
    return AdminDashboard.fromJson(data as Map<String, dynamic>);
  }

  Future<SupervisorDashboard> supervisorDashboard() async {
    final data = await _api.get('/dashboard/supervisor');
    return SupervisorDashboard.fromJson(data as Map<String, dynamic>);
  }

  // --------------------------------------------------------- branch requests

  /// The branch's own room and request tallies — the only read a Branch
  /// account is allowed. The room comes off the account, never the query.
  Future<BranchStock> branchStock() async {
    final data = await _api.get('/dashboard/branch');
    return BranchStock.fromJson(data as Map<String, dynamic>);
  }

  /// The requests this branch has raised, newest first.
  Future<List<BranchRequestRecord>> myBranchRequests() async {
    final data = await _api.get('/branch-requests/mine');
    return _list(data, BranchRequestRecord.fromJson);
  }

  /// The whole queue, as an approver sees it. Both approvers read the same
  /// list so each can see the stage the other is holding.
  Future<List<BranchRequestRecord>> branchRequests() async {
    final data = await _api.get('/branch-requests');
    return _list(data, BranchRequestRecord.fromJson);
  }

  /// Raises a request against the branch's own room. Returns the new number.
  Future<String> createBranchRequest({
    required String productId,
    required int quantity,
    String purpose = '',
  }) async {
    final data = await _api.post('/branch-requests', {
      'productId': productId,
      'quantity': quantity,
      'purpose': purpose,
    });
    return data is Map ? asString(data['requestNumber']) : '';
  }

  /// Withdraws a request the Admin has not decided yet.
  Future<void> cancelBranchRequest(String id) => _api.delete('/branch-requests/$id');

  /// Stage two. Approving here completes the request and releases the stock
  /// from the branch's room. [action] is `approve` or `reject`.
  Future<BranchRequestRecord> decideBranchRequestAsSupervisor({
    required String id,
    required String action,
    String comment = '',
    int? approvedQuantity,
  }) async {
    final data = await _api.put('/branch-requests/$id/supervisor', {
      'action': action,
      'comment': comment,
      'approvedQuantity': ?approvedQuantity,
    });
    return BranchRequestRecord.fromJson(data as Map<String, dynamic>);
  }

  // ---------------------------------------------------------------- requests

  Future<List<AdminRequest>> allRequests() async {
    final data = await _api.get('/requests/all');
    return _list(data, AdminRequest.fromJson);
  }

  Future<List<MyRequest>> myRequests() async {
    final data = await _api.get('/requests/myrequests');
    return _list(data, MyRequest.fromJson);
  }

  /// [action] is one of `approve`, `reject`, `keep-pending`.
  Future<void> processRequest({
    required String rawType,
    required String id,
    required String action,
    required String adminComments,
  }) =>
      _api.put('/requests/$rawType/$id/$action', {'adminComments': adminComments});

  Future<void> createProductRequest({
    required String requestType, // ADD | EDIT
    String? productId,
    required ProductDraft details,
  }) =>
      _api.post('/requests/product', {
        'requestType': requestType,
        'productId': ?productId,
        'details': details.toJson(),
      });

  /// [kind] is one of `stockin`, `stockout`, `stockreturn`.
  ///
  /// [stockRoomId] names the room the supervisor would like the stock placed
  /// in. It is advisory — the Admin picks the room actually credited.
  Future<String> createStockRequest({
    required String kind,
    required String productId,
    required int quantity,
    String? stockRoomId,
  }) async {
    final data = await _api.post('/requests/$kind', {
      'productId': productId,
      'quantity': quantity,
      'stockRoomId': ?stockRoomId,
    });
    // The create endpoints return the request document itself, so the number
    // is read from there rather than from a `message` field.
    final requestNumber =
        data is Map ? asString(data['requestNumber']) : '';
    return requestNumber;
  }

  /// Edits a still-pending stock request. [kind] is `stockin`, `stockout` or
  /// `stockreturn`. The API rejects this once an Admin has decided it.
  Future<String> updateStockRequest({
    required String kind,
    required String id,
    required int quantity,
    String? stockRoomId,
  }) async {
    final data = await _api.put('/requests/$kind/$id', {
      'quantity': quantity,
      'stockRoomId': ?stockRoomId,
    });
    return _message(data, 'Request updated');
  }

  /// Cancels a still-pending request. The row is kept as `Cancelled` so the
  /// Admin sees the cancellation rather than the request vanishing.
  Future<String> cancelStockRequest({required String kind, required String id}) async {
    final data = await _api.delete('/requests/$kind/$id');
    return _message(data, 'Request cancelled');
  }

  // ------------------------------------------------------------- stock rooms

  Future<List<StockRoom>> stockRooms() async {
    final data = await _api.get('/stock-rooms');
    return _list(data, StockRoom.fromJson);
  }

  /// Current stock grouped by room — the Stock tab.
  Future<List<RoomInventory>> inventoryByRoom() async {
    final data = await _api.get('/stock-rooms/inventory');
    return _list(data, RoomInventory.fromJson);
  }

  // ------------------------------------------------------------------ issues

  Future<List<IssueRecord>> issues() async {
    final data = await _api.get('/issues');
    return _list(data, IssueRecord.fromJson);
  }

  /// Returns the confirmation message produced by the API.
  Future<String> issueProduct({
    required String productId,
    required int quantity,
    required String recipient,
    required String purpose,
  }) async {
    final data = await _api.post('/issues', {
      'productId': productId,
      'quantity': quantity,
      'recipient': recipient,
      'purpose': purpose,
    });
    return _message(data, 'Product issued successfully');
  }

  // --------------------------------------------------- consumption and scrap

  /// Books issued stock as used up or thrown away — the two outcomes besides
  /// returning it.
  ///
  /// Neither puts stock back on a shelf: it left the store room when it was
  /// issued, so this only closes the quantity out against the issue. Scrap is
  /// the exception that also takes stock out of the Red Stock Room, which is
  /// why [restockItemId] is accepted in place of [issueId].
  ///
  /// Exactly one of [issueId] and [restockItemId] must be given, and Red Stock
  /// can only be scrapped, never consumed. [quantity] defaults to everything
  /// still outstanding when null.
  Future<String> recordDisposal({
    required String type,
    String? issueId,
    String? restockItemId,
    int? quantity,
    String reason = '',
  }) async {
    final data = await _api.post('/disposals', {
      'type': type,
      'issueId': ?issueId,
      'restockItemId': ?restockItemId,
      'quantity': ?quantity,
      'reason': reason,
    });
    return _message(data, 'Recorded as ${type.toLowerCase()}');
  }

  /// The consumption and scrap logs. [type] narrows to one of them; null reads
  /// both. History is never pruned, so this doubles as the audit read.
  Future<List<DisposalRecord>> disposals({
    String? type,
    String? storeRoom,
    DateTime? from,
    DateTime? to,
  }) async {
    final data = await _api.get('/disposals', query: {
      'type': type,
      'storeRoom': storeRoom,
      'from': from?.toIso8601String(),
      'to': to?.toIso8601String(),
    });
    return _list(data, DisposalRecord.fromJson);
  }

  /// Total scrap value per item, per store room and per period.
  Future<ScrapSummary> scrapSummary({
    DateTime? from,
    DateTime? to,
    String groupBy = 'month',
  }) async {
    final data = await _api.get('/disposals/scrap-summary', query: {
      'from': from?.toIso8601String(),
      'to': to?.toIso8601String(),
      'groupBy': groupBy,
    });
    return ScrapSummary.fromJson(Map<String, dynamic>.from(data as Map));
  }

  // --------------------------------------------------------------- red stock

  /// Hands issued stock back into the Red Stock Room. No Admin approval is
  /// involved: the stock is in Red Stock as soon as this returns. It reaches a
  /// store room only when an Admin approves the weekly merge.
  ///
  /// [quantity] defaults to everything still outstanding when null.
  Future<String> returnIssuedStock({
    required String issueId,
    int? quantity,
    required String condition,
    required String department,
  }) async {
    final data = await _redStockPost('/returns', {
      'issueId': issueId,
      'quantity': ?quantity,
      'condition': condition,
      'department': department,
    });
    return _message(data, 'Stock returned to the Red Stock Room');
  }

  /// The Red Stock Room read as a room, rolled up per product, so returned
  /// stock can be listed beside the store rooms. Unlike [restockItems] this is
  /// the whole room, not just the caller's own returns.
  Future<RoomInventory> redStockRoom() async {
    final data = await _redStockGet('/room');
    final json = Map<String, dynamic>.from(data as Map);
    json['_id'] = kRedStockRoomId;
    return RoomInventory.fromJson(json);
  }

  /// A supervisor sees only their own returns; the API scopes this by role.
  Future<List<RestockRecord>> restockItems({String? status}) async {
    final data = await _redStockGet('', query: {'status': status});
    return _list(data, RestockRecord.fromJson);
  }

  // ------------------------------------------------------------------ merges

  /// Asks the Admin to merge this supervisor's Red Stock into a store room
  /// rather than waiting for the weekly run. Nothing moves until the Admin
  /// approves it.
  ///
  /// [restockItemIds] narrows the request to specific returns; omit it to send
  /// everything the supervisor has sitting in Red Stock.
  Future<String> requestMerge({List<String>? restockItemIds, String comment = ''}) async {
    final data = await _api.post('/merge-requests/mine', {
      'restockItemIds': ?restockItemIds,
      'comment': comment,
    });
    return _message(data, 'Merge request sent to the Admin');
  }

  /// The merges this supervisor has raised, newest first.
  Future<List<MergeRequestSummary>> myMergeRequests() async {
    final data = await _api.get('/merge-requests/mine');
    return _list(data, MergeRequestSummary.fromJson);
  }

  /// The Red Stock Room used to be called Restock, and a server that predates
  /// the rename serves `/restock` but 404s on `/red-stock`. Both paths are
  /// mounted on current servers, so try the new name and fall back once —
  /// a phone should keep working against a backend that has not been
  /// redeployed yet.
  Future<dynamic> _redStockGet(String path, {Map<String, String?>? query}) =>
      _withLegacyPath((prefix) => _api.get('$prefix$path', query: query));

  Future<dynamic> _redStockPost(String path, Map<String, dynamic> body) =>
      _withLegacyPath((prefix) => _api.post('$prefix$path', body));

  /// A 404 means the route is not mounted, so the request never reached a
  /// handler and retrying the old path cannot repeat a write.
  static Future<dynamic> _withLegacyPath(
    Future<dynamic> Function(String prefix) send,
  ) async {
    try {
      return await send('/red-stock');
    } on ApiException catch (error) {
      if (error.statusCode != 404) rethrow;
      return send('/restock');
    }
  }

  // ----------------------------------------------------------- notifications

  Future<List<AppNotification>> notifications() async {
    final data = await _api.get('/notifications');
    return _list(data, AppNotification.fromJson);
  }

  Future<void> markNotificationRead(String id) => _api.put('/notifications/$id/read');

  Future<void> markAllNotificationsRead() => _api.put('/notifications/read-all');

  // ------------------------------------------------------------------ shared

  static List<T> _list<T>(dynamic data, T Function(Map<String, dynamic>) parse) =>
      (data as List? ?? []).whereType<Map<String, dynamic>>().map(parse).toList();

  static String _message(dynamic data, String fallback) {
    if (data is Map && data['message'] is String) {
      final message = data['message'] as String;
      if (message.isNotEmpty) return message;
    }
    return fallback;
  }
}
