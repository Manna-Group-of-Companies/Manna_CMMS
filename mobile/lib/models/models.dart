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

/// One physical size and its unit — `50` + `SQMM`, which becomes `50SQMM`
/// inside the standardized name.
class ItemDimension {
  const ItemDimension({this.value = '', this.uom = ''});

  final String value;
  final String uom;

  bool get isEmpty => value.trim().isEmpty;

  ItemDimension copyWith({String? value, String? uom}) =>
      ItemDimension(value: value ?? this.value, uom: uom ?? this.uom);

  factory ItemDimension.fromJson(Map<String, dynamic> json) => ItemDimension(
        value: asString(json['value']),
        uom: asString(json['uom']),
      );

  Map<String, dynamic> toJson() => {'value': value, 'uom': uom};
}

/// The SOI1/SOP1 fields an item name is built from (ST-09).
///
/// Mutable, because this is what the intake form edits directly. The name
/// itself is never composed here — `POST /products/name-preview` does that, so
/// the convention lives in exactly one place.
class NamingParts {
  NamingParts({
    List<ItemDimension>? dimensions,
    this.electricalRating = '',
    this.electricalUom = '',
    this.itemName = '',
    this.type = '',
    this.material = '',
    this.itemCode = '',
  }) : dimensions = dimensions ?? [const ItemDimension()];

  final List<ItemDimension> dimensions;
  String electricalRating;
  String electricalUom;
  String itemName;
  String type;
  String material;
  String itemCode;

  /// Nothing worth composing a name out of yet.
  bool get isBlank =>
      itemName.trim().isEmpty &&
      itemCode.trim().isEmpty &&
      electricalRating.trim().isEmpty &&
      dimensions.every((dimension) => dimension.isEmpty);

  factory NamingParts.fromJson(Map<String, dynamic> json) {
    final raw = (json['dimensions'] as List? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(ItemDimension.fromJson)
        .toList();

    return NamingParts(
      // Always leave one row so the form never renders an empty section.
      dimensions: raw.isEmpty ? [const ItemDimension()] : raw,
      electricalRating: asString(json['electricalRating']),
      electricalUom: asString(json['electricalUom']),
      itemName: asString(json['itemName']),
      type: asString(json['type']),
      material: asString(json['material']),
      itemCode: asString(json['itemCode']),
    );
  }

  static NamingParts? maybe(dynamic json) =>
      json is Map<String, dynamic> ? NamingParts.fromJson(json) : null;

  Map<String, dynamic> toJson() => {
        'dimensions':
            dimensions.where((d) => !d.isEmpty).map((d) => d.toJson()).toList(),
        'electricalRating': electricalRating,
        'electricalUom': electricalUom,
        'itemName': itemName,
        'type': type,
        'material': material,
        'itemCode': itemCode,
      };
}

/// One way a name breaks the convention. [code] is stable; [message] is written
/// for the person at the counter.
class NamingIssue {
  const NamingIssue({required this.code, required this.message});

  final String code;
  final String message;

  factory NamingIssue.fromJson(Map<String, dynamic> json) => NamingIssue(
        code: asString(json['code']),
        message: asString(json['message']),
      );
}

/// The server's verdict on a name (ST-10), with the name it composed.
class NameCheck {
  const NameCheck({
    required this.name,
    required this.compliant,
    required this.issues,
    this.naming,
  });

  final String name;
  final bool compliant;
  final List<NamingIssue> issues;

  /// The cleaned fields the name was built from — uppercased UOMs and all.
  final NamingParts? naming;

  factory NameCheck.fromJson(Map<String, dynamic> json) => NameCheck(
        name: asString(json['name']),
        compliant: json['compliant'] == true,
        issues: (json['issues'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map(NamingIssue.fromJson)
            .toList(),
        naming: NamingParts.maybe(json['naming']),
      );
}

/// A catalog item that looks like the one being created (ST-14).
class DuplicateMatch {
  const DuplicateMatch({
    required this.id,
    required this.name,
    required this.code,
    required this.storeRoom,
    required this.rackNumber,
    required this.quantity,
    required this.unit,
    required this.reason,
    required this.exact,
    required this.score,
  });

  final String id;
  final String name;
  final String code;
  final String storeRoom;
  final String rackNumber;
  final int quantity;
  final String unit;

  /// Why it matched — "Same product code", "Similar name", and so on.
  final String reason;

  /// The store almost certainly already owns this one, rather than something
  /// merely similar.
  final bool exact;
  final num score;

  factory DuplicateMatch.fromJson(Map<String, dynamic> json) => DuplicateMatch(
        id: asString(json['_id']),
        name: asString(json['name']),
        code: asString(json['code']),
        storeRoom: asString(json['storeRoom']),
        rackNumber: asString(json['rackNumber']),
        quantity: asInt(json['quantity']),
        unit: asString(json['unit']),
        reason: asString(json['reason']),
        exact: json['exact'] == true,
        score: json['score'] is num ? json['score'] as num : 0,
      );
}

/// Where an item stands with the Plant Manager's SAP record (ST-13).
class SapInfo {
  const SapInfo({this.status = 'Not Required', this.code = '', this.createdAt});

  /// `Pending`, `Created` or `Not Required`.
  final String status;

  /// The material code SAP assigned, once it exists.
  final String code;
  final DateTime? createdAt;

  bool get isPending => status == 'Pending';
  bool get isCreated => status == 'Created';

  factory SapInfo.fromJson(Map<String, dynamic> json) => SapInfo(
        status: asString(json['status'], 'Not Required'),
        code: asString(json['code']),
        createdAt: parseDate(json['createdAt']),
      );

  static SapInfo maybe(dynamic json) =>
      json is Map<String, dynamic> ? SapInfo.fromJson(json) : const SapInfo();
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
    required this.rackNumber,
    required this.quantity,
    required this.unit,
    required this.minStock,
    required this.storeRoom,
    required this.description,
    required this.image,
    required this.isPartial,
    this.subCategory = '',
    this.brand = '',
    this.status = '',
    this.unitCost = 0,
    this.naming,
    this.nameCompliant,
    this.sap = const SapInfo(),
  });

  final String id;
  final String code;
  final String name;
  final String category;

  // Recorded by the stock take and optional throughout: products created in the
  // app carry none of them until somebody fills them in, so each defaults to
  // empty rather than being required.
  final String subCategory;
  final String brand;

  /// Condition as written by the store — free text, see core/product_status.dart.
  final String status;

  /// Last known purchase price per unit, in rupees. 0 means "not recorded".
  final num unitCost;

  final String rackNumber;
  final int quantity;
  final String unit;
  final int minStock;
  final String storeRoom;
  final String description;
  final String image;
  final bool isPartial;

  /// The SOI1/SOP1 fields this name was built from (ST-09). Null on the
  /// imported catalog, which was named before the convention was captured.
  final NamingParts? naming;

  /// Whether [name] passes the convention (ST-10). Null means never checked —
  /// a gap, not a finding, and shown differently from false.
  final bool? nameCompliant;

  /// Where the item stands with SAP (ST-13).
  final SapInfo sap;

  bool get isOutOfStock => quantity == 0;
  bool get isLowStock => quantity <= minStock;

  factory Product.fromJson(Map<String, dynamic> json) => Product(
        id: asString(json['_id']),
        code: asString(json['code']),
        name: asString(json['name']),
        category: asString(json['category']),
        subCategory: asString(json['subCategory']),
        brand: asString(json['brand']),
        status: asString(json['status']),
        unitCost: json['unitCost'] is num ? json['unitCost'] as num : 0,
        rackNumber: asString(json['rackNumber']),
        quantity: asInt(json['quantity']),
        unit: asString(json['unit']),
        minStock: asInt(json['minStock']),
        storeRoom: asString(json['storeRoom']),
        description: asString(json['description']),
        image: asString(json['image']),
        naming: NamingParts.maybe(json['naming']),
        nameCompliant: json['nameCompliant'] is bool ? json['nameCompliant'] as bool : null,
        sap: SapInfo.maybe(json['sap']),
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
    this.subCategory = '',
    this.status = 'Good Condition',
    this.rackNumber = '',
    this.quantity = 0,
    this.unit = 'Pcs',
    this.minStock = 5,
    this.storeRoom = 'Manna Rubber Park',
    this.description = '',
    this.image = '',
    NamingParts? naming,
  }) : naming = naming ?? NamingParts();

  String name;
  String category;

  /// Second level of the store's classification — category "Tools" /
  /// sub-category "Ring Spanners". Optional, and blank on requests raised
  /// before the field existed.
  String subCategory;

  /// Condition of the stock, picked from `productStatuses` — see
  /// core/product_status.dart. A new product is assumed to be in good condition
  /// until the person adding it says otherwise.
  String status;

  String rackNumber;
  int quantity;
  String unit;
  int minStock;
  String storeRoom;
  String description;
  String image;

  /// The SOI1/SOP1 fields the name is composed from (ST-09). Always present so
  /// the builder has something to bind to; blank until it is filled in.
  final NamingParts naming;

  factory ProductDraft.fromProduct(Product product) => ProductDraft(
        name: product.name,
        category: product.category,
        subCategory: product.subCategory,
        status: product.status,
        rackNumber: product.rackNumber,
        quantity: product.quantity,
        unit: product.unit,
        minStock: product.minStock,
        storeRoom: product.storeRoom,
        description: product.description,
        image: product.image,
        // Editing a product created with the builder starts from its own parts
        // rather than from an empty form.
        naming: product.naming,
      );

  factory ProductDraft.fromJson(Map<String, dynamic> json) => ProductDraft(
        name: asString(json['name']),
        category: asString(json['category']),
        subCategory: asString(json['subCategory']),
        status: asString(json['status']),
        rackNumber: asString(json['rackNumber']),
        quantity: asInt(json['quantity']),
        unit: asString(json['unit']),
        minStock: asInt(json['minStock']),
        storeRoom: asString(json['storeRoom'], 'Manna Rubber Park'),
        description: asString(json['description']),
        image: asString(json['image']),
        naming: NamingParts.maybe(json['naming']),
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'category': category,
        'subCategory': subCategory,
        'status': status,
        'rackNumber': rackNumber,
        'quantity': quantity,
        'unit': unit,
        'minStock': minStock,
        'storeRoom': storeRoom,
        'description': description,
        'image': image,
        // Omitted when empty: sending a blank sub-document on an EDIT would
        // clear the naming fields of a product that has them.
        if (!naming.isBlank) 'naming': naming.toJson(),
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
    this.consumedQuantity = 0,
    this.scrappedQuantity = 0,
    this.disposals = const [],
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

  /// The other two ways an issue settles: used up, and thrown away. Neither
  /// puts stock back on a shelf, but both close the quantity out against the
  /// issue, so [outstanding] has to count them.
  final int consumedQuantity;
  final int scrappedQuantity;

  /// Every consumption and scrap booked against this issue, newest last.
  final List<DisposalRecord> disposals;

  final DateTime? createdAt;

  /// Whether this account made the issue. Only labels the row — every
  /// supervisor may return any issue, whoever issued it.
  final bool isMine;

  bool get isReturned => returnStatus == 'Returned';

  /// How much of the issue is accounted for, whichever way it went.
  int get settledQuantity =>
      returnedQuantity + consumedQuantity + scrappedQuantity;

  /// Still out with the recipient, and so still actionable.
  int get outstanding => (quantity - settledQuantity).clamp(0, quantity);

  /// Whether there is anything left to action. Open to any supervisor, not
  /// just the one who issued it — the server allows it either way.
  bool get canReturn => outstanding > 0;

  /// Nothing left outstanding: the issue is closed business however it ended.
  bool get isSettled => outstanding == 0;

  /// Total value written off against this issue, for the scrap metric.
  num get scrapValue => disposals
      .where((d) => d.isScrap)
      .fold<num>(0, (sum, d) => sum + d.value);

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
        consumedQuantity: asInt(json['consumedQuantity']),
        scrappedQuantity: asInt(json['scrappedQuantity']),
        disposals: (json['disposals'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map(DisposalRecord.fromJson)
            .toList(),
        createdAt: parseDate(json['createdAt']),
        // Servers that predate the shared history send only the caller's own
        // issues and no flag, so an absent flag means "mine".
        isMine: json['isMine'] != false,
      );
}

/// One consumption or scrap, as returned by `/disposals` and embedded in each
/// issue row.
///
/// Both logs share a record because they answer the same question — how much
/// of an issue will never come back, and what it was worth. [value] is the
/// scrap value metric when [isScrap]; the server computes and stores it from
/// the unit cost as it stood on the day, so re-costing a product later does
/// not restate past periods.
class DisposalRecord {
  const DisposalRecord({
    required this.id,
    required this.disposalNumber,
    required this.type,
    required this.quantity,
    required this.unitCost,
    required this.value,
    required this.reason,
    required this.disposedAt,
    required this.disposedByName,
    this.productName = '',
    this.productCode = '',
    this.unit = '',
    this.storeRoom = '',
    this.reference = '',
    this.department = '',
    this.source = '',
  });

  final String id;
  final String disposalNumber;

  /// `Consumed` or `Scrapped`.
  final String type;
  final int quantity;
  final num unitCost;

  /// quantity × unitCost, as recorded at disposal time.
  final num value;
  final String reason;
  final DateTime? disposedAt;
  final String disposedByName;

  // Present on the standalone log read; the copies embedded in an issue row
  // leave them empty because the issue already carries the product.
  final String productName;
  final String productCode;
  final String unit;
  final String storeRoom;

  /// The issue or restock number this was booked against.
  final String reference;
  final String department;

  /// `Issue` or `Red Stock` — which stage it was disposed from.
  final String source;

  bool get isScrap => type == 'Scrapped';
  bool get isConsumption => type == 'Consumed';

  factory DisposalRecord.fromJson(Map<String, dynamic> json) => DisposalRecord(
        id: asString(json['_id']),
        disposalNumber: asString(json['disposalNumber']),
        type: asString(json['type']),
        quantity: asInt(json['quantity']),
        unitCost: json['unitCost'] is num ? json['unitCost'] as num : 0,
        value: json['value'] is num ? json['value'] as num : 0,
        reason: asString(json['reason']),
        disposedAt: parseDate(json['disposedAt']),
        disposedByName: json['disposedBy'] is Map
            ? asString((json['disposedBy'] as Map)['name'], 'Unknown')
            : 'Unknown',
        productName: asString(json['productName']),
        productCode: asString(json['productCode']),
        unit: asString(json['unit']),
        storeRoom: asString(json['storeRoom']),
        reference: asString(json['reference']),
        department: asString(json['department']),
        source: asString(json['source']),
      );
}

/// One row of a scrap-value breakdown — by item, by store room, or by period.
class ScrapTotal {
  const ScrapTotal({
    required this.label,
    required this.quantity,
    required this.value,
    required this.events,
    this.code = '',
  });

  /// The product name, store room, or period key this row totals.
  final String label;
  final int quantity;
  final num value;

  /// How many separate scrap events make up the row.
  final int events;
  final String code;
}

/// `GET /disposals/scrap-summary` — total scrap value broken down three ways
/// at once (ST-27). One call rather than three, so the breakdowns cannot
/// disagree with each other.
class ScrapSummary {
  const ScrapSummary({
    required this.totalValue,
    required this.totalQuantity,
    required this.events,
    required this.byItem,
    required this.byStoreRoom,
    required this.byPeriod,
    required this.groupBy,
  });

  final num totalValue;
  final int totalQuantity;
  final int events;
  final List<ScrapTotal> byItem;
  final List<ScrapTotal> byStoreRoom;
  final List<ScrapTotal> byPeriod;

  /// `day`, `week` or `month` — how [byPeriod] is bucketed.
  final String groupBy;

  bool get isEmpty => events == 0;

  static List<ScrapTotal> _rows(dynamic raw, String labelKey) =>
      (raw as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .map((row) => ScrapTotal(
                label: asString(row[labelKey]),
                quantity: asInt(row['quantity']),
                value: row['value'] is num ? row['value'] as num : 0,
                events: asInt(row['events']),
                code: asString(row['code']),
              ))
          .toList();

  factory ScrapSummary.fromJson(Map<String, dynamic> json) {
    final total = json['total'];
    return ScrapSummary(
      totalValue: total is Map && total['value'] is num ? total['value'] as num : 0,
      totalQuantity: total is Map ? asInt(total['quantity']) : 0,
      events: total is Map ? asInt(total['events']) : 0,
      byItem: _rows(json['byItem'], 'name'),
      byStoreRoom: _rows(json['byStoreRoom'], 'storeRoom'),
      byPeriod: _rows(json['byPeriod'], 'period'),
      groupBy: asString(json['groupBy'], 'month'),
    );
  }
}

/// A merge the supervisor raised over their own Red Stock, as returned by
/// `/merge-requests/mine`.
///
/// Raising one is the whole merge: the stock is in the main store room by the
/// time the call answers, so these read as Approved from the start. A row that
/// says otherwise came from an older server.
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

  /// What the supervisor needs to read off the card in one line. A merge they
  /// raised is applied as it is raised, so it reads as Approved from the start;
  /// the waiting line is only ever a row an older server left behind.
  String get summary => switch (status) {
        'Approved' => destinationRoom.isEmpty
            ? 'Merged into a company — in stock now'
            : 'Merged into $destinationRoom — in stock now',
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
/// `/red-stock`. A return needs no approval to get here, and the supervisor
/// merges it back into a store room themselves.
class RestockRecord {
  const RestockRecord({
    required this.id,
    required this.restockNumber,
    required this.product,
    required this.productName,
    required this.productCode,
    required this.unit,
    required this.quantity,
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

  /// Still in the Red Stock Room, so the supervisor who returned it can merge
  /// it themselves. A weekly claim does not take that away: the server releases
  /// its own hold on their returns and applies their merge immediately, so the
  /// Admin's sweep cannot leave them waiting on stock they can place.
  bool get canMerge => awaitingMerge || inWeeklyMerge;

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
