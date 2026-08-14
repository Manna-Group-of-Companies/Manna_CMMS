import '../core/formatters.dart';

class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.stockRoomId = '',
    this.stockRoomName = '',
  });

  final String id;
  final String name;
  final String email;
  final String role;

  /// Set on Branch accounts only: the one room the account may see. Admin and
  /// Supervisor accounts work across every room and leave these empty.
  final String stockRoomId;
  final String stockRoomName;

  bool get isAdmin => role == 'Admin';
  bool get isSupervisor => role == 'Supervisor';
  bool get isBranch => role == 'Branch';

  factory AppUser.fromJson(Map<String, dynamic> json) {
    final room = json['stockRoom'];
    return AppUser(
      id: asString(json['_id']),
      name: asString(json['name']),
      email: asString(json['email']),
      role: asString(json['role']),
      stockRoomId: asId(room) ?? '',
      stockRoomName: room is Map ? asString(room['name']) : '',
    );
  }

  Map<String, dynamic> toJson() => {
        '_id': id,
        'name': name,
        'email': email,
        'role': role,
        if (stockRoomId.isNotEmpty)
          'stockRoom': {'_id': stockRoomId, 'name': stockRoomName},
      };
}

/// A product record. Several endpoints populate only a subset of fields
/// (`name code unit storeRoom image`), so every field has a safe default and
/// [isPartial] tells the UI whether the full document is available.
class Product {
  const Product({
    required this.id,
    required this.code,
    required this.name,
    required this.category,
    required this.brand,
    required this.supplier,
    required this.quantity,
    required this.unit,
    required this.minStock,
    required this.maxStock,
    required this.storeRoom,
    required this.description,
    required this.image,
    required this.isPartial,
  });

  final String id;
  final String code;
  final String name;
  final String category;
  final String brand;
  final String supplier;
  final int quantity;
  final String unit;
  final int minStock;
  final int maxStock;
  final String storeRoom;
  final String description;
  final String image;
  final bool isPartial;

  bool get isOutOfStock => quantity == 0;
  bool get isLowStock => quantity <= minStock;

  factory Product.fromJson(Map<String, dynamic> json) => Product(
        id: asString(json['_id']),
        code: asString(json['code']),
        name: asString(json['name']),
        category: asString(json['category']),
        brand: asString(json['brand']),
        supplier: asString(json['supplier']),
        quantity: asInt(json['quantity']),
        unit: asString(json['unit']),
        minStock: asInt(json['minStock']),
        maxStock: asInt(json['maxStock']),
        storeRoom: asString(json['storeRoom']),
        description: asString(json['description']),
        image: asString(json['image']),
        isPartial: !json.containsKey('category') || !json.containsKey('quantity'),
      );

  static Product? maybe(dynamic json) =>
      json is Map<String, dynamic> ? Product.fromJson(json) : null;
}

/// Mutable form payload for ADD / EDIT product requests.
class ProductDraft {
  ProductDraft({
    this.name = '',
    this.category = '',
    this.brand = '',
    this.supplier = '',
    this.quantity = 0,
    this.unit = 'Pcs',
    this.minStock = 5,
    this.maxStock = 100,
    this.storeRoom = 'Engineer Room',
    this.description = '',
    this.image = '',
  });

  String name;
  String category;
  String brand;
  String supplier;
  int quantity;
  String unit;
  int minStock;
  int maxStock;
  String storeRoom;
  String description;
  String image;

  factory ProductDraft.fromProduct(Product product) => ProductDraft(
        name: product.name,
        category: product.category,
        brand: product.brand,
        supplier: product.supplier,
        quantity: product.quantity,
        unit: product.unit,
        minStock: product.minStock,
        maxStock: product.maxStock,
        storeRoom: product.storeRoom,
        description: product.description,
        image: product.image,
      );

  factory ProductDraft.fromJson(Map<String, dynamic> json) => ProductDraft(
        name: asString(json['name']),
        category: asString(json['category']),
        brand: asString(json['brand']),
        supplier: asString(json['supplier']),
        quantity: asInt(json['quantity']),
        unit: asString(json['unit']),
        minStock: asInt(json['minStock']),
        maxStock: asInt(json['maxStock']),
        storeRoom: asString(json['storeRoom'], 'Engineer Room'),
        description: asString(json['description']),
        image: asString(json['image']),
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'category': category,
        'brand': brand,
        'supplier': supplier,
        'quantity': quantity,
        'unit': unit,
        'minStock': minStock,
        'maxStock': maxStock,
        'storeRoom': storeRoom,
        'description': description,
        'image': image,
      };
}

class AppNotification {
  const AppNotification({
    required this.id,
    required this.message,
    required this.type,
    required this.read,
    required this.createdAt,
  });

  final String id;
  final String message;
  final String type;
  final bool read;
  final DateTime? createdAt;

  AppNotification copyWith({bool? read}) => AppNotification(
        id: id,
        message: message,
        type: type,
        read: read ?? this.read,
        createdAt: createdAt,
      );

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: asString(json['_id']),
        message: asString(json['message']),
        type: asString(json['type']),
        read: json['read'] == true,
        createdAt: parseDate(json['createdAt']),
      );
}

/// A storage location. Stock requests are approved into exactly one of these.
class StockRoom {
  const StockRoom({required this.id, required this.name});

  final String id;
  final String name;

  factory StockRoom.fromJson(Map<String, dynamic> json) => StockRoom(
        id: asString(json['_id']),
        name: asString(json['name']),
      );
}

/// One product's balance inside one room, as listed by `/stock-rooms/inventory`.
class RoomStockItem {
  const RoomStockItem({
    required this.productId,
    required this.name,
    required this.code,
    required this.unit,
    required this.image,
    required this.quantity,
    required this.isLowStock,
    this.category = '',
    this.minStock = 0,
    this.isOutOfStock = false,
  });

  final String productId;
  final String name;
  final String code;
  final String unit;
  final String image;
  final int quantity;
  final bool isLowStock;

  // Present on the branch room read; the shared room list leaves them at their
  // defaults.
  final String category;
  final int minStock;
  final bool isOutOfStock;

  factory RoomStockItem.fromJson(Map<String, dynamic> json) => RoomStockItem(
        productId: asString(json['productId']),
        name: asString(json['name']),
        code: asString(json['code']),
        unit: asString(json['unit'], 'Pcs'),
        image: asString(json['image']),
        quantity: asInt(json['quantity']),
        isLowStock: json['isLowStock'] == true,
        category: asString(json['category']),
        minStock: asInt(json['minStock']),
        isOutOfStock: json['isOutOfStock'] == true,
      );
}

/// `GET /dashboard/branch` — the branch's own room, plus where its requests
/// stand. Everything a Branch account is allowed to read.
class BranchStock {
  const BranchStock({
    required this.roomId,
    required this.roomName,
    required this.itemCount,
    required this.totalQuantity,
    required this.lowStockCount,
    required this.outOfStockCount,
    required this.categoryCount,
    required this.pendingAdmin,
    required this.pendingSupervisor,
    required this.approved,
    required this.rejected,
    required this.items,
  });

  final String roomId;
  final String roomName;
  final int itemCount;
  final int totalQuantity;
  final int lowStockCount;
  final int outOfStockCount;
  final int categoryCount;

  // The branch's own request queue, by stage.
  final int pendingAdmin;
  final int pendingSupervisor;
  final int approved;
  final int rejected;

  final List<RoomStockItem> items;

  factory BranchStock.fromJson(Map<String, dynamic> json) {
    final room = json['room'];
    return BranchStock(
      roomId: room is Map ? asString(room['_id']) : '',
      roomName: room is Map ? asString(room['name']) : '',
      itemCount: asInt(json['itemCount']),
      totalQuantity: asInt(json['totalQuantity']),
      lowStockCount: asInt(json['lowStockCount']),
      outOfStockCount: asInt(json['outOfStockCount']),
      categoryCount: asInt(json['categoryCount']),
      pendingAdmin: asInt(json['branchPendingAdmin']),
      pendingSupervisor: asInt(json['branchPendingSupervisor']),
      approved: asInt(json['branchApproved']),
      rejected: asInt(json['branchRejected']),
      items: (json['items'] as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .map(RoomStockItem.fromJson)
          .toList(),
    );
  }
}

/// One step in a branch request's decision trail.
class BranchDecision {
  const BranchDecision({
    required this.stage,
    required this.action,
    required this.byName,
    required this.byRole,
    required this.comment,
    required this.quantity,
    required this.at,
  });

  final String stage; // Submitted | Admin | Supervisor | Branch
  final String action; // Submitted | Approved | Rejected | Cancelled
  final String byName;
  final String byRole;
  final String comment;
  final int quantity;
  final DateTime? at;

  /// "Request submitted" / "Admin approved" — the wording the web client uses.
  String get headline =>
      stage == 'Submitted' ? 'Request submitted' : '$stage ${action.toLowerCase()}';

  factory BranchDecision.fromJson(Map<String, dynamic> json) => BranchDecision(
        stage: asString(json['stage']),
        action: asString(json['action']),
        byName: asString(json['byName']),
        byRole: asString(json['byRole']),
        comment: asString(json['comment']),
        quantity: asInt(json['quantity']),
        at: parseDate(json['at']),
      );
}

/// A branch request as it moves through the two approvals:
/// Pending Admin → Pending Supervisor → Approved (or Rejected at either stage).
class BranchRequestRecord {
  const BranchRequestRecord({
    required this.id,
    required this.requestNumber,
    required this.status,
    required this.productName,
    required this.productCode,
    required this.image,
    required this.unit,
    required this.quantity,
    required this.approvedQuantity,
    required this.stockAtRequest,
    required this.stockRoomName,
    required this.purpose,
    required this.branchName,
    required this.adminName,
    required this.adminComments,
    required this.adminDecidedAt,
    required this.supervisorName,
    required this.supervisorComments,
    required this.supervisorDecidedAt,
    required this.createdAt,
    required this.history,
  });

  final String id;
  final String requestNumber;
  final String status;
  final String productName;
  final String productCode;
  final String image;
  final String unit;
  final int quantity;

  /// Null until the Admin passes it on; it is what the Supervisor releases.
  final int? approvedQuantity;
  final int stockAtRequest;
  final String stockRoomName;
  final String purpose;
  final String branchName;
  /// Who signed each stage off and when, so a second approver reading the
  /// queue sees that a colleague already decided it.
  final String adminName;
  final String adminComments;
  final DateTime? adminDecidedAt;
  final String supervisorName;
  final String supervisorComments;
  final DateTime? supervisorDecidedAt;
  final DateTime? createdAt;
  final List<BranchDecision> history;

  bool get isPendingAdmin => status == 'Pending Admin';
  bool get isPendingSupervisor => status == 'Pending Supervisor';
  bool get isApproved => status == 'Approved';
  bool get isRejected => status == 'Rejected';
  bool get isCancelled => status == 'Cancelled';

  /// The quantity that will actually move, as it stands right now.
  int get effectiveQuantity => approvedQuantity ?? quantity;

  /// The last thing that happened at [stage]. `history` snapshots the name and
  /// role at decision time, which is the only record left once an account is
  /// renamed or deleted — the populated ref comes back null for those.
  BranchDecision? decisionAt(String stage) {
    for (final entry in history.reversed) {
      if (entry.stage == stage) return entry;
    }
    return null;
  }

  /// Who signed a stage off, preferring the live account and falling back to
  /// the snapshot. Empty when the stage is still undecided.
  String _decidedBy(String stage, String liveName) =>
      liveName.isNotEmpty ? liveName : (decisionAt(stage)?.byName ?? '');

  String get adminDecidedBy => _decidedBy('Admin', adminName);
  String get supervisorDecidedBy => _decidedBy('Supervisor', supervisorName);
  String get raisedBy => _decidedBy('Submitted', branchName);

  DateTime? get adminDecidedOn => adminDecidedAt ?? decisionAt('Admin')?.at;
  DateTime? get supervisorDecidedOn =>
      supervisorDecidedAt ?? decisionAt('Supervisor')?.at;

  factory BranchRequestRecord.fromJson(Map<String, dynamic> json) {
    final product = json['product'];
    final branch = json['branch'];
    final admin = json['admin'];
    final supervisor = json['supervisor'];

    return BranchRequestRecord(
      id: asString(json['_id']),
      requestNumber: asString(json['requestNumber']),
      status: asString(json['status']),
      productName: asString(json['productName']),
      productCode: asString(json['productCode']),
      image: product is Map ? asString(product['image']) : '',
      unit: asString(json['unit'], 'Pcs'),
      quantity: asInt(json['quantity']),
      approvedQuantity:
          json['approvedQuantity'] == null ? null : asInt(json['approvedQuantity']),
      stockAtRequest: asInt(json['stockAtRequest']),
      stockRoomName: asString(json['stockRoomName']),
      purpose: asString(json['purpose']),
      branchName: branch is Map ? asString(branch['name']) : '',
      adminName: admin is Map ? asString(admin['name']) : '',
      adminComments: asString(json['adminComments']),
      adminDecidedAt: parseDate(json['adminDecidedAt']),
      supervisorName: supervisor is Map ? asString(supervisor['name']) : '',
      supervisorComments: asString(json['supervisorComments']),
      supervisorDecidedAt: parseDate(json['supervisorDecidedAt']),
      createdAt: parseDate(json['createdAt']),
      history: (json['history'] as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .map(BranchDecision.fromJson)
          .toList(),
    );
  }
}

/// Stands in for the Red Stock Room's `_id`. The room is assembled from the
/// returned batches themselves, so there is no StockRoom document behind it.
const kRedStockRoomId = 'red-stock-room';

/// A room together with everything currently stored in it — the Stock tab.
class RoomInventory {
  const RoomInventory({
    required this.id,
    required this.name,
    required this.itemCount,
    required this.totalQuantity,
    required this.items,
  });

  final String id;
  final String name;
  final int itemCount;
  final int totalQuantity;
  final List<RoomStockItem> items;

  factory RoomInventory.fromJson(Map<String, dynamic> json) => RoomInventory(
        id: asString(json['_id']),
        name: asString(json['name']),
        itemCount: asInt(json['itemCount']),
        totalQuantity: asInt(json['totalQuantity']),
        items: (json['items'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map(RoomStockItem.fromJson)
            .toList(),
      );
}

/// A request row as returned by `/requests/myrequests` (supervisor view).
///
/// The endpoint returns every supervisor's requests, so [supervisorName] says
/// who raised it and [isMine] whether this account may still edit or cancel it.
///
/// Stock In rows carry the decision detail — how much was approved, which
/// room it landed in, and who decided — so the card can show the outcome
/// rather than just a status word.
class MyRequest {
  const MyRequest({
    required this.id,
    required this.requestNumber,
    required this.requestType,
    required this.productName,
    required this.createdDate,
    required this.status,
    required this.adminComments,
    required this.rawType,
    required this.quantity,
    required this.approvedQuantity,
    required this.stockRoom,
    required this.requestedStockRoom,
    required this.decidedBy,
    required this.approvedAt,
    required this.rejectedAt,
    required this.decidedAt,
    required this.supervisorName,
    required this.isMine,
  });

  final String id;
  final String requestNumber;
  final String requestType;
  final String productName;
  final DateTime? createdDate;
  final String status;
  final String adminComments;
  final String rawType;

  /// The supervisor who raised it, and whether that is this account. Only an
  /// owner may edit or cancel — the server enforces it too.
  final String supervisorName;
  final bool isMine;

  /// Quantity asked for. 0 on request types that carry no quantity.
  final int quantity;

  /// What the Admin actually approved; null until approved, and may be less
  /// than [quantity].
  final int? approvedQuantity;

  /// The room credited on approval, and the one the supervisor asked for.
  final String stockRoom;
  final String requestedStockRoom;

  final String decidedBy;
  final DateTime? approvedAt;
  final DateTime? rejectedAt;

  /// When the Admin closed it, whichever way it went. The server falls back to
  /// the closing save for the request types that stamp no timestamp of their own.
  final DateTime? decidedAt;

  bool get isPending => status == 'Pending';
  bool get isApproved => status == 'Approved';
  bool get isRejected => status == 'Rejected';

  /// The app says "Accepted" where the API stores "Approved".
  String get displayStatus => isApproved ? 'Accepted' : status;

  /// True when the outcome carries detail worth showing beneath the status.
  bool get hasDecisionDetail =>
      (isApproved &&
          (approvedQuantity != null || stockRoom.isNotEmpty || decidedAt != null)) ||
      (isRejected &&
          (adminComments.isNotEmpty || decidedBy.isNotEmpty || decidedAt != null));

  factory MyRequest.fromJson(Map<String, dynamic> json) => MyRequest(
        id: asString(json['_id']),
        requestNumber: asString(json['requestNumber']),
        requestType: asString(json['requestType']),
        productName: asString(json['productName']),
        createdDate: parseDate(json['createdDate']),
        status: asString(json['status']),
        adminComments: asString(json['adminComments']),
        rawType: asString(json['rawType']),
        quantity: asInt(json['quantity']),
        approvedQuantity:
            json['approvedQuantity'] == null ? null : asInt(json['approvedQuantity']),
        stockRoom: asString(json['stockRoom']),
        requestedStockRoom: asString(json['requestedStockRoom']),
        decidedBy: asString(json['decidedBy']),
        approvedAt: parseDate(json['approvedAt']),
        rejectedAt: parseDate(json['rejectedAt']),
        decidedAt: parseDate(json['decidedAt']),
        supervisorName: asString(json['supervisorName'], 'Unknown'),
        // Servers that predate the shared queue send only the caller's own
        // rows and no flag, so an absent flag means "mine".
        isMine: json['isMine'] != false,
      );
}

/// A request row as returned by `/requests/all` (admin view).
class AdminRequest {
  const AdminRequest({
    required this.id,
    required this.requestNumber,
    required this.requestType,
    required this.product,
    required this.details,
    required this.quantity,
    required this.createdDate,
    required this.status,
    required this.adminComments,
    required this.supervisorName,
    required this.supervisorEmail,
    required this.rawType,
  });

  final String id;
  final String requestNumber;
  final String requestType;
  final Product? product;
  final ProductDraft? details;
  final int? quantity;
  final DateTime? createdDate;
  final String status;
  final String adminComments;
  final String supervisorName;
  final String supervisorEmail;
  final String rawType;

  bool get isPending => status == 'Pending';
  bool get isProductRequest => rawType == 'product';

  /// Name shown in listings, matching the web client's fallback chain.
  String get displayName => isProductRequest
      ? (details?.name ?? '')
      : (product?.name ?? 'Unknown Product');

  /// True when approving a Stock Out would drive the stock negative.
  bool get exceedsStock =>
      requestType == 'Stock Out' && (product?.quantity ?? 0) < (quantity ?? 0);

  factory AdminRequest.fromJson(Map<String, dynamic> json) => AdminRequest(
        id: asString(json['_id']),
        requestNumber: asString(json['requestNumber']),
        requestType: asString(json['requestType']),
        product: Product.maybe(json['product']),
        details: json['details'] is Map<String, dynamic>
            ? ProductDraft.fromJson(json['details'] as Map<String, dynamic>)
            : null,
        quantity: json['quantity'] == null ? null : asInt(json['quantity']),
        createdDate: parseDate(json['createdDate']),
        status: asString(json['status']),
        adminComments: asString(json['adminComments']),
        supervisorName: json['supervisor'] is Map
            ? asString((json['supervisor'] as Map)['name'], 'System')
            : 'System',
        supervisorEmail: json['supervisor'] is Map
            ? asString((json['supervisor'] as Map)['email'])
            : '',
        rawType: asString(json['rawType']),
      );
}

class IssueRecord {
  const IssueRecord({
    required this.id,
    required this.issueNumber,
    required this.product,
    required this.quantity,
    required this.recipient,
    required this.purpose,
    required this.supervisorName,
    required this.supervisorEmail,
    required this.returnStatus,
    required this.returnedQuantity,
    required this.createdAt,
    required this.isMine,
  });

  final String id;
  final String issueNumber;
  final Product? product;
  final int quantity;
  final String recipient;
  final String purpose;
  final String supervisorName;
  final String supervisorEmail;
  final String returnStatus;

  /// How much of [quantity] has already been handed back into Red Stock.
  final int returnedQuantity;
  final DateTime? createdAt;

  /// Whether this account made the issue. Everyone sees every issue, but only
  /// the supervisor who made one may return it.
  final bool isMine;

  bool get isReturned => returnStatus == 'Returned';

  /// Still out with the recipient, and so still returnable.
  int get outstanding => quantity - returnedQuantity;

  /// Outstanding stock this account is allowed to hand back.
  bool get canReturn => isMine && outstanding > 0;

  factory IssueRecord.fromJson(Map<String, dynamic> json) => IssueRecord(
        id: asString(json['_id']),
        issueNumber: asString(json['issueNumber']),
        product: Product.maybe(json['product']),
        quantity: asInt(json['quantity']),
        recipient: asString(json['recipient']),
        purpose: asString(json['purpose']),
        supervisorName: json['supervisor'] is Map
            ? asString((json['supervisor'] as Map)['name'], 'System')
            : 'System',
        supervisorEmail: json['supervisor'] is Map
            ? asString((json['supervisor'] as Map)['email'])
            : '',
        returnStatus: asString(json['returnStatus'], 'Not Returned'),
        returnedQuantity: asInt(json['returnedQuantity']),
        createdAt: parseDate(json['createdAt']),
        // Servers that predate the shared history send only the caller's own
        // issues and no flag, so an absent flag means "mine".
        isMine: json['isMine'] != false,
      );
}

/// A merge the supervisor raised over their own Red Stock, as returned by
/// `/merge-requests/mine`.
///
/// Raising one moves no stock: it puts the request on the Admin's desk, and
/// the quantity only leaves Red Stock if the Admin approves it.
class MergeRequestSummary {
  const MergeRequestSummary({
    required this.id,
    required this.requestId,
    required this.status,
    required this.itemCount,
    required this.totalQuantity,
    required this.destinationRoom,
    required this.rejectionReason,
    required this.requestedAt,
    required this.reviewedAt,
  });

  final String id;
  final String requestId;

  /// `Pending Approval`, `Approved` or `Rejected`.
  final String status;
  final int itemCount;
  final int totalQuantity;

  /// The store room an approved merge sent the stock to.
  final String destinationRoom;
  final String rejectionReason;
  final DateTime? requestedAt;
  final DateTime? reviewedAt;

  bool get isPending => status == 'Pending Approval';
  bool get isApproved => status == 'Approved';
  bool get isRejected => status == 'Rejected';

  /// What the supervisor needs to read off the card in one line.
  String get summary => switch (status) {
        'Approved' => destinationRoom.isEmpty
            ? 'Approved — moved into a store room'
            : 'Approved — moved into $destinationRoom',
        'Rejected' => rejectionReason.isEmpty
            ? 'Rejected — your stock stays in Red Stock'
            : 'Rejected: $rejectionReason',
        _ => 'Waiting for the Admin to approve',
      };

  factory MergeRequestSummary.fromJson(Map<String, dynamic> json) =>
      MergeRequestSummary(
        id: asString(json['_id']),
        requestId: asString(json['requestId']),
        status: asString(json['status'], 'Pending Approval'),
        itemCount: asInt(json['itemCount']),
        totalQuantity: asInt(json['totalQuantity']),
        destinationRoom: asString(json['destinationRoom']),
        rejectionReason: asString(json['rejectionReason']),
        requestedAt: parseDate(json['requestedAt']),
        reviewedAt: parseDate(json['reviewedAt']),
      );
}

/// One returned batch sitting in the Red Stock Room, as returned by
/// `/red-stock`. A return needs no approval to get here; it only reaches a
/// store room once an Admin approves the weekly merge.
class RestockRecord {
  const RestockRecord({
    required this.id,
    required this.restockNumber,
    required this.product,
    required this.productName,
    required this.productCode,
    required this.unit,
    required this.quantity,
    required this.reason,
    required this.condition,
    required this.department,
    required this.status,
    required this.rejectionReason,
    required this.mergeRequestId,
    required this.destinationRoom,
    required this.sourceRoom,
    required this.returnDate,
    required this.returnedByName,
    required this.isMine,
  });

  final String id;
  final String restockNumber;
  final Product? product;

  /// Who returned it, and whether that is this account. The room is shared;
  /// only a supervisor's own batches go into a merge they raise.
  final String returnedByName;
  final bool isMine;

  /// Snapshots taken at return time, so a renamed product still reads right.
  final String productName;
  final String productCode;
  final String unit;
  final int quantity;
  final String reason;
  final String condition;
  final String department;
  final String status;

  /// Why the last weekly merge holding this item was rejected, if it was. The
  /// item stays in Red Stock either way.
  final String rejectionReason;

  /// The `REQ-MERGE-…` id once the item is part of a weekly merge.
  final String mergeRequestId;

  /// The store room an approved merge moved this quantity into.
  final String destinationRoom;

  /// Where the stock was issued from before it came back.
  final String sourceRoom;
  final DateTime? returnDate;

  bool get isMerged => status == 'Moved to Stock Room';

  /// Sitting in Red Stock, ready for the next weekly merge.
  bool get awaitingMerge => status == 'In Red Stock';

  /// Claimed by the open weekly merge, waiting on the Admin.
  bool get inWeeklyMerge => status == 'Weekly Merge Pending';

  /// Where this quantity landed, or will land once a merge is approved.
  String get destinationStoreRoom =>
      destinationRoom.isNotEmpty ? destinationRoom : (product?.storeRoom ?? '');

  /// Servers that predate the Red Stock rename still report the old status
  /// vocabulary. They mean the same three states, so they are translated here
  /// rather than being special-cased everywhere a status is read.
  static const _legacyStatuses = {
    'Restock Pending': 'In Red Stock',
    'Merge Rejected': 'In Red Stock',
    'Merge Requested': 'Weekly Merge Pending',
    'Merged': 'Moved to Stock Room',
  };

  static String _statusOf(String raw) => _legacyStatuses[raw] ?? raw;

  factory RestockRecord.fromJson(Map<String, dynamic> json) => RestockRecord(
        id: asString(json['_id']),
        restockNumber: asString(json['restockNumber']),
        product: Product.maybe(json['product']),
        productName: asString(json['productName']),
        productCode: asString(json['productCode']),
        unit: asString(json['unit']),
        quantity: asInt(json['quantity']),
        reason: asString(json['reason']),
        condition: asString(json['condition'], 'Good'),
        department: asString(json['department']),
        status: _statusOf(asString(json['status'], 'In Red Stock')),
        rejectionReason: json['lastRejection'] is Map
            ? asString((json['lastRejection'] as Map)['reason'])
            : asString(json['rejectionReason']),
        mergeRequestId: json['mergeRequest'] is Map
            ? asString((json['mergeRequest'] as Map)['requestId'])
            : '',
        destinationRoom: asString(json['destinationRoom']),
        sourceRoom: asString(json['sourceRoom']),
        returnDate: parseDate(json['returnDate']),
        returnedByName: json['returnedBy'] is Map
            ? asString((json['returnedBy'] as Map)['name'], 'Unknown')
            : 'Unknown',
        // Servers that predate the shared room send only the caller's own
        // batches and no flag, so an absent flag means "mine".
        isMine: json['isMine'] != false,
      );
}

/// One entry of `todayRequests` (admin) / `todayActivity` (supervisor).
class ActivityEntry {
  const ActivityEntry({
    required this.id,
    required this.requestNumber,
    required this.productName,
    required this.requestType,
    required this.supervisorName,
    required this.status,
    required this.time,
    required this.isMine,
  });

  final String id;
  final String requestNumber;
  final String productName;
  final String requestType;
  final String supervisorName;
  final String status;
  final DateTime? time;

  /// Whether the reading account raised it. False on the admin feed, which
  /// sends no flag — the admin is never the supervisor who asked.
  final bool isMine;

  factory ActivityEntry.fromJson(Map<String, dynamic> json) => ActivityEntry(
        id: asString(json['_id']),
        requestNumber: asString(json['requestNumber']),
        productName: asString(json['productName']),
        requestType: asString(json['requestType']),
        supervisorName: asString(json['supervisorName']),
        status: asString(json['status']),
        time: parseDate(json['time']),
        isMine: json['isMine'] == true,
      );
}

class AdminDashboard {
  const AdminDashboard({
    required this.totalProducts,
    required this.pendingRequests,
    required this.approvedRequests,
    required this.rejectedRequests,
    required this.lowStockProductsCount,
    required this.lowStockProducts,
    required this.todayRequestsCount,
    required this.todayRequests,
  });

  final int totalProducts;
  final int pendingRequests;
  final int approvedRequests;
  final int rejectedRequests;
  final int lowStockProductsCount;
  final List<Product> lowStockProducts;
  final int todayRequestsCount;
  final List<ActivityEntry> todayRequests;

  factory AdminDashboard.fromJson(Map<String, dynamic> json) => AdminDashboard(
        totalProducts: asInt(json['totalProducts']),
        pendingRequests: asInt(json['pendingRequests']),
        approvedRequests: asInt(json['approvedRequests']),
        rejectedRequests: asInt(json['rejectedRequests']),
        lowStockProductsCount: asInt(json['lowStockProductsCount']),
        lowStockProducts: (json['lowStockProducts'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map(Product.fromJson)
            .toList(),
        todayRequestsCount: asInt(json['todayRequestsCount']),
        todayRequests: (json['todayRequests'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map(ActivityEntry.fromJson)
            .toList(),
      );
}

class SupervisorDashboard {
  const SupervisorDashboard({
    required this.totalProducts,
    required this.pendingRequests,
    required this.approvedRequests,
    required this.rejectedRequests,
    required this.lowStockProductsCount,
    required this.totalStockQuantity,
    required this.todayActivity,
    required this.myPendingRequests,
    required this.myApprovedRequests,
    required this.myRejectedRequests,
    required this.issuedTodayCount,
    required this.myIssuedTodayCount,
    required this.redStockCount,
    required this.myRedStockCount,
    required this.recentIssues,
  });

  /// Store-wide counts: every supervisor's requests, not just this account's.
  final int totalProducts;
  final int pendingRequests;
  final int approvedRequests;
  final int rejectedRequests;
  final int lowStockProductsCount;

  /// This account's share of the same three queues.
  final int myPendingRequests;
  final int myApprovedRequests;
  final int myRejectedRequests;

  /// Issues made today across the store, and how many were this account's.
  final int issuedTodayCount;
  final int myIssuedTodayCount;

  /// Batches sitting in the Red Stock Room, store-wide and this account's.
  final int redStockCount;
  final int myRedStockCount;

  /// Pieces on hand across every product and room.
  final int totalStockQuantity;
  final List<ActivityEntry> todayActivity;

  /// The last few issues out of the store, whoever made them.
  final List<IssueRecord> recentIssues;

  factory SupervisorDashboard.fromJson(Map<String, dynamic> json) => SupervisorDashboard(
        totalProducts: asInt(json['totalProducts']),
        pendingRequests: asInt(json['pendingRequests']),
        approvedRequests: asInt(json['approvedRequests']),
        rejectedRequests: asInt(json['rejectedRequests']),
        lowStockProductsCount: asInt(json['lowStockProductsCount']),
        totalStockQuantity: asInt(json['totalStockQuantity']),
        myPendingRequests: asInt(json['myPendingRequests']),
        myApprovedRequests: asInt(json['myApprovedRequests']),
        myRejectedRequests: asInt(json['myRejectedRequests']),
        issuedTodayCount: asInt(json['issuedTodayCount']),
        myIssuedTodayCount: asInt(json['myIssuedTodayCount']),
        redStockCount: asInt(json['restockPendingCount']),
        myRedStockCount: asInt(json['myRestockPendingCount']),
        todayActivity: (json['todayActivity'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map(ActivityEntry.fromJson)
            .toList(),
        recentIssues: (json['recentIssues'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map(IssueRecord.fromJson)
            .toList(),
      );
}
