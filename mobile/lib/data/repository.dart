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

  /// Where this product's stock actually sits, company by company (ST-35).
  ///
  /// The catalog carries one total; stock is held per company, so this is what
  /// turns "12 in stock" into somewhere to walk to.
  Future<List<ProductRoomStock>> productRooms(String id) async {
    final data = await _api.get('/products/$id/rooms');
    return _list(data, ProductRoomStock.fromJson);
  }

  // ------------------------------------------------------- intake and naming

  /// Composes and checks a name against SOI1/SOP1 (ST-09, ST-10).
  ///
  /// The convention itself lives on the server, in `utils/itemNaming.js`. The
  /// app asks rather than reimplementing it, because a rule that drifts between
  /// the phone, the web console and the API is worse than a round trip.
  ///
  /// Pass [naming] alone to build a name from its parts; pass [name] to check a
  /// name that was typed out by hand.
  Future<NameCheck> checkItemName({String? name, NamingParts? naming}) async {
    final data = await _api.post('/products/name-preview', {
      'name': ?name,
      'naming': ?naming?.toJson(),
    });
    return NameCheck.fromJson(Map<String, dynamic>.from(data as Map));
  }

  /// Catalog items that look like the one being created (ST-14).
  ///
  /// [excludeId] leaves a product out of its own results, for the edit case.
  Future<List<DuplicateMatch>> findDuplicates({
    required String name,
    String code = '',
    String brand = '',
    String category = '',
    String? excludeId,
  }) async {
    final data = await _api.get('/products/duplicates', query: {
      'name': name,
      'code': code,
      'brand': brand,
      'category': category,
      'excludeId': excludeId,
    });
    final json = Map<String, dynamic>.from(data as Map);
    return _list(json['matches'], DuplicateMatch.fromJson);
  }

  /// Items named in the store and still waiting to be created in SAP (ST-13).
  Future<List<Product>> sapPending({String? storeRoom}) async {
    final data = await _api.get('/products/sap-pending', query: {'storeRoom': storeRoom});
    return _list(data, Product.fromJson);
  }

  /// Saves an edit straight onto the catalog product — no approval involved.
  ///
  /// Adding an item is the only catalog change that still goes through a
  /// request; changing one takes effect as soon as this returns.
  ///
  /// Only the fields the edit sheet actually offers are sent — the
  /// classification and the descriptive ones. See [_editableOnUpdate].
  ///
  /// The rest is dropped rather than echoed back. Posting it unchanged would be
  /// harmless today (the API no-ops a zero delta) but it leaves a request shaped
  /// to write fields the sheet never showed, which is how a later change starts
  /// moving stock by accident. Quantity and store room move real stock; unit and
  /// minimum stock are identity and purchasing figures.
  ///
  /// [acknowledgeNaming] and [allowDuplicate] are carried for symmetry with the
  /// request path. Neither can fire here in practice: the API only re-checks a
  /// name when the payload sets one, and an edit never does.
  Future<Product> updateProduct({
    required String productId,
    required ProductDraft details,
    bool acknowledgeNaming = false,
    bool allowDuplicate = false,
  }) async {
    final body = details.toJson()
      ..removeWhere((key, _) => !_editableOnUpdate.contains(key));

    final data = await _api.put('/products/$productId', {
      ...body,
      'acknowledgeNaming': acknowledgeNaming,
      'allowDuplicate': allowDuplicate,
    });
    return Product.fromJson(Map<String, dynamic>.from(data as Map));
  }

  /// The only product fields an edit from the app may set. Kept next to
  /// [updateProduct] so the allow-list and the reason for it stay together.
  ///
  /// `name` and `naming` are deliberately absent. A name is settled when the
  /// item is taken in — it is what the catalog, the issue history and SAP refer
  /// to the item by — and the edit sheet shows it read-only, so an edit has no
  /// business sending one.
  static const _editableOnUpdate = {
    'category',
    'subCategory',
    'status',
    'rackNumber',
    'image',
    'description',
  };

  /// Records what SAP did with an item. [status] is `Created`, `Pending` or
  /// `Not Required`. Admin only.
  Future<Product> setSapStatus({
    required String productId,
    required String status,
    String code = '',
    String note = '',
  }) async {
    final data = await _api.put('/products/$productId/sap', {
      'status': status,
      'code': code,
      'note': note,
    });
    return Product.fromJson(Map<String, dynamic>.from(data as Map));
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

  // Both approval stages are decided in the web console. The app raises and
  // follows a branch's own requests; it no longer decides any of them, so the
  // queue read and the stage-two decision are not called from here.

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

  /// Raises an ADD request against the catalog — a new item is the only catalog
  /// change that still waits for the Admin. An edit is saved directly; see
  /// [updateProduct].
  ///
  /// The API applies the two intake checks first and refuses with 422 (the name
  /// breaks SOI1/SOP1) or 409 (an item like this already exists). Both are
  /// answerable rather than final: set [acknowledgeNaming] or [allowDuplicate]
  /// and send the same draft again to go ahead deliberately.
  Future<void> createProductRequest({
    required ProductDraft details,
    bool acknowledgeNaming = false,
    bool allowDuplicate = false,
  }) =>
      _api.post('/requests/product', {
        'requestType': 'ADD',
        'details': details.toJson(),
        'acknowledgeNaming': acknowledgeNaming,
        'allowDuplicate': allowDuplicate,
      });

  /// Adds stock to a product. Applies immediately, like issuing, consuming,
  /// scrapping and returning — stock coming in no longer waits for the Admin.
  ///
  /// [stockRoomId] names the room credited. Left out, the stock lands in the
  /// product's own room.
  Future<String> addStock({
    required String productId,
    required int quantity,
    String? stockRoomId,
  }) async {
    final data = await _api.post('/products/$productId/stock-in', {
      'quantity': quantity,
      'stockRoomId': ?stockRoomId,
    });
    return _message(data, 'Stock added');
  }

  /// Edits a still-pending stock request. [kind] is `stockin`, `stockout` or
  /// `stockreturn` — all three raised back when those were requests. The API
  /// rejects this once an Admin has decided it.
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

  /// Who stock may be issued to, as the Admin keeps them.
  ///
  /// The issue form picks from this rather than taking a typed name, so the
  /// same firm cannot arrive spelled three ways. A server that does not serve
  /// the list yet answers 404; the caller shows the form regardless and says
  /// there is nobody to pick.
  Future<List<Recipient>> recipients() async {
    final data = await _api.get('/recipients');
    return _list(data, Recipient.fromJson);
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
    return _message(data, 'Engineering Stock issued successfully');
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
  /// involved: the stock is in Red Stock as soon as this returns, and reaches a
  /// store room when the supervisor merges it — see [requestMerge].
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

  /// What one product has sitting in the Red Stock Room, or null when it has
  /// nothing there.
  ///
  /// Read out of the same rolled-up room as [redStockRoom]. The room carries
  /// one row per product that has returned stock — a short list, and the only
  /// read the API offers — so there is nothing narrower to ask for.
  Future<RoomStockItem?> redStockForProduct(String productId) async {
    if (productId.isEmpty) return null;

    final room = await redStockRoom();
    for (final item in room.items) {
      if (item.productId == productId) return item;
    }
    return null;
  }

  /// A supervisor sees only their own returns; the API scopes this by role.
  Future<List<RestockRecord>> restockItems({String? status}) async {
    final data = await _redStockGet('', query: {'status': status});
    return _list(data, RestockRecord.fromJson);
  }

  // ------------------------------------------------------------------ merges

  /// Merges this supervisor's Red Stock back into the store rooms, applied
  /// immediately — it no longer waits on the Admin. Each item returns to its
  /// own store room, since nobody is asked to name a destination.
  ///
  /// The Admin's weekly merge still needs approval: it sweeps every
  /// supervisor's returns at once, and that one does need a decision.
  ///
  /// [restockItemIds] narrows the merge to specific returns; omit it to take
  /// everything the supervisor has sitting in Red Stock.
  Future<String> requestMerge({List<String>? restockItemIds, String comment = ''}) async {
    final data = await _api.post('/merge-requests/mine', {
      'restockItemIds': ?restockItemIds,
      'comment': comment,
    });
    return _message(data, 'Merged out of Red Stock');
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
