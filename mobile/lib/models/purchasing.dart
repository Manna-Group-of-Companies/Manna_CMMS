import '../core/formatters.dart';

/// The Purchase Request Sheet, as `/low-value-purchases` sends it.
///
/// Since 20 Oct 2026 this is the business's own Google Sheet ("Purchase
/// Request Sheet", tab "Purchase") moved into ERPNext: one row per request,
/// the same columns in the same order, and a row turns green once the purchase
/// status reads Received or Delivered. It replaced an earlier multi-item
/// request with its own order and receive steps; none of that survives.
///
/// Which columns of a row the signed-in person may change is the server's to
/// say, per row, in `editable`. The screens read that and nothing else -
/// deciding it again here from the role would drift the first time the rule
/// changes on the server.

List<String> _asStrings(dynamic value) =>
    (value as List? ?? []).map((e) => asString(e)).where((e) => e.isNotEmpty).toList();

/// How a column is changed: picked from the options, a day, or typed.
enum SheetColumnKind { pick, date, text }

/// One column of the sheet, by the name the API uses for it.
class SheetColumn {
  const SheetColumn(this.key, this.label, this.kind, {this.multiline = false, this.clearable = false});

  /// The API's name - the key a `PUT` carries and `editable` lists.
  final String key;

  /// The sheet's own heading.
  final String label;
  final SheetColumnKind kind;

  /// Text that is often a list, one item a line.
  final bool multiline;

  /// A date that may be emptied again (the server takes "" as no date).
  final bool clearable;
}

/// Not a column the API edits: images go up and come off through `/files`.
/// Kept in [sheetColumns] so the detail reads in the sheet's order.
const imageSamplesColumn = 'images';

/// The sheet's columns, left to right, as the "Purchase" tab has them.
const sheetColumns = [
  SheetColumn('date', 'Date', SheetColumnKind.date),
  SheetColumn('type', 'Type of Request', SheetColumnKind.pick),
  SheetColumn('company', 'Company', SheetColumnKind.pick),
  SheetColumn('raisedByName', 'Raised By', SheetColumnKind.text),
  SheetColumn('description', 'Description', SheetColumnKind.text, multiline: true),
  SheetColumn('purpose', 'Purpose of Purchase/Repair', SheetColumnKind.text, multiline: true),
  SheetColumn(imageSamplesColumn, 'Image samples', SheetColumnKind.text),
  SheetColumn('links', 'Links/Brands or vendor contact', SheetColumnKind.text, multiline: true),
  SheetColumn('priority', 'Priority', SheetColumnKind.pick),
  SheetColumn('approvalStatus', 'Status of Approval', SheetColumnKind.pick),
  SheetColumn('purchaseStatus', 'Status of Purchase/Repair', SheetColumnKind.pick),
  SheetColumn('expectedOn', 'Expected Date of Arrival', SheetColumnKind.date, clearable: true),
  SheetColumn('receivedOn', 'Received date', SheetColumnKind.date, clearable: true),
  SheetColumn('remarks', 'Remarks', SheetColumnKind.text, multiline: true),
];

/// An image of the item - the sheet's "Image samples" column.
class PurchaseImage {
  const PurchaseImage({
    required this.id,
    required this.fileName,
    required this.url,
    required this.size,
    required this.isPrivate,
    required this.addedAt,
  });

  final String id;
  final String fileName;

  /// ERPNext's own path. Uploads are private, so this does not open without an
  /// ERPNext session - see the detail screen.
  final String url;
  final int size;
  final bool isPrivate;
  final DateTime? addedAt;

  factory PurchaseImage.fromJson(Map<String, dynamic> json) => PurchaseImage(
        id: asString(json['id']),
        fileName: asString(json['fileName']),
        url: asString(json['url']),
        size: asInt(json['size']),
        isPrivate: json['isPrivate'] == true,
        addedAt: parseDate(json['addedAt']),
      );
}

/// One row of the sheet.
class PurchaseRequest {
  const PurchaseRequest({
    required this.id,
    required this.date,
    required this.type,
    required this.company,
    required this.raisedByName,
    required this.description,
    required this.purpose,
    required this.links,
    required this.priority,
    required this.approvalStatus,
    required this.purchaseStatus,
    required this.expectedOn,
    required this.receivedOn,
    required this.remarks,
    required this.done,
    required this.raisedBy,
    required this.raisedAt,
    required this.updatedBy,
    required this.updatedAt,
    required this.files,
    required this.editable,
    this.images = const [],
  });

  final String id;
  final DateTime? date;
  final String type;
  final String company;

  /// The name written in the sheet's "Raised By" - free text, as it was there.
  final String raisedByName;
  final String description;
  final String purpose;
  final String links;
  final String priority;
  final String approvalStatus;
  final String purchaseStatus;
  final DateTime? expectedOn;
  final DateTime? receivedOn;
  final String remarks;

  /// Received or Delivered: the sheet's green row.
  final bool done;

  /// The account that added the row (an email), which is not always the person
  /// named in [raisedByName].
  final String raisedBy;
  final DateTime? raisedAt;
  final String updatedBy;
  final DateTime? updatedAt;

  /// How many images, in the list. The detail carries the [images] themselves.
  final int files;

  /// The columns this person may change on this row, by [SheetColumn.key].
  final Set<String> editable;
  final List<PurchaseImage> images;

  bool canEdit(String column) => editable.contains(column);

  /// This row with [images] - a `PUT` answers without them, and the ones
  /// already on screen have not changed.
  PurchaseRequest withImages(List<PurchaseImage> images) => PurchaseRequest(
        id: id,
        date: date,
        type: type,
        company: company,
        raisedByName: raisedByName,
        description: description,
        purpose: purpose,
        links: links,
        priority: priority,
        approvalStatus: approvalStatus,
        purchaseStatus: purchaseStatus,
        expectedOn: expectedOn,
        receivedOn: receivedOn,
        remarks: remarks,
        done: done,
        raisedBy: raisedBy,
        raisedAt: raisedAt,
        updatedBy: updatedBy,
        updatedAt: updatedAt,
        files: files,
        editable: editable,
        images: images,
      );

  /// The server lets anyone who may change any column add or remove images.
  bool get canAttach => editable.isNotEmpty;

  /// The number of images, from whichever of the two was sent.
  int get imageCount => images.isNotEmpty ? images.length : files;

  /// A column's value as the sheet would show it; empty when blank.
  String textOf(String column) => switch (column) {
        'date' => date == null ? '' : formatDate(date),
        'type' => type,
        'company' => company,
        'raisedByName' => raisedByName,
        'description' => description,
        'purpose' => purpose,
        imageSamplesColumn => imageCount == 0 ? '' : (imageCount == 1 ? '1 image' : '$imageCount images'),
        'links' => links,
        'priority' => priority,
        'approvalStatus' => approvalStatus,
        'purchaseStatus' => purchaseStatus,
        'expectedOn' => expectedOn == null ? '' : formatDate(expectedOn),
        'receivedOn' => receivedOn == null ? '' : formatDate(receivedOn),
        'remarks' => remarks,
        _ => '',
      };

  /// The search box: every typed column, the row number and who added it.
  bool matches(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return [
      id, type, company, raisedByName, description, purpose, links, priority,
      approvalStatus, purchaseStatus, remarks, raisedBy,
    ].any((v) => v.toLowerCase().contains(q));
  }

  factory PurchaseRequest.fromJson(Map<String, dynamic> json) => PurchaseRequest(
        id: asString(json['id']),
        date: parseDate(json['date']),
        type: asString(json['type'], 'Purchase Request'),
        company: asString(json['company']),
        raisedByName: asString(json['raisedByName']),
        description: asString(json['description']),
        purpose: asString(json['purpose']),
        links: asString(json['links']),
        priority: asString(json['priority']),
        approvalStatus: asString(json['approvalStatus'], 'Pending'),
        purchaseStatus: asString(json['purchaseStatus'], 'Not Ordered'),
        expectedOn: parseDate(json['expectedOn']),
        receivedOn: parseDate(json['receivedOn']),
        remarks: asString(json['remarks']),
        done: json['done'] == true,
        raisedBy: asString(json['raisedBy']),
        raisedAt: parseDate(json['raisedAt']),
        updatedBy: asString(json['updatedBy']),
        updatedAt: parseDate(json['updatedAt']),
        files: asInt(json['files']),
        editable: _asStrings(json['editable']).toSet(),
        images: (json['images'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map(PurchaseImage.fromJson)
            .toList(growable: false),
      );
}

/// The sheet's dropdowns, from `/low-value-purchases/options`.
class PurchaseSheetOptions {
  const PurchaseSheetOptions({
    required this.types,
    required this.companies,
    required this.priorities,
    required this.approvalStatuses,
    required this.purchaseStatuses,
    required this.doneStatuses,
  });

  /// Used until the server answers, so the filters and the form are never
  /// empty on a slow connection. Kept in step with lowValuePurchaseDoctype.js;
  /// the server's own lists replace these as soon as they arrive.
  static const fallback = PurchaseSheetOptions(
    types: ['Purchase Request', 'Repair Request'],
    companies: [
      'Manna Rubber Products',
      'Hi-tech Rubber Industries',
      'Hi-tech Pretreads',
      'Manna Tyre Retreading',
      'Soorya Rubbers',
    ],
    priorities: ['Emergency', 'High', 'Medium', 'Low'],
    approvalStatuses: [
      'Pending',
      'Pending MD Approval',
      'Approved',
      'Limited Quantity Approved',
      'On Hold',
      'Rejected',
    ],
    purchaseStatuses: [
      'Not Ordered',
      'Finding Vendors',
      'Gathering Quotations',
      'Bidding Stage',
      'Order Placed',
      'Order Dispatched',
      'Sent for repair',
      'Received',
      'Delivered',
    ],
    doneStatuses: ['Received', 'Delivered'],
  );

  final List<String> types;
  final List<String> companies;
  final List<String> priorities;
  final List<String> approvalStatuses;
  final List<String> purchaseStatuses;
  final List<String> doneStatuses;

  /// The choices for a [SheetColumnKind.pick] column; empty for any other.
  List<String> choicesFor(String column) => switch (column) {
        'type' => types,
        'company' => companies,
        'priority' => priorities,
        'approvalStatus' => approvalStatuses,
        'purchaseStatus' => purchaseStatuses,
        _ => const [],
      };

  /// A list the server left out falls back to the built-in one rather than
  /// leaving a dropdown with nothing in it.
  factory PurchaseSheetOptions.fromJson(Map<String, dynamic> json) {
    List<String> or(String key, List<String> fallback) {
      final list = _asStrings(json[key]);
      return list.isEmpty ? fallback : list;
    }

    const f = PurchaseSheetOptions.fallback;
    return PurchaseSheetOptions(
      types: or('types', f.types),
      companies: or('companies', f.companies),
      priorities: or('priorities', f.priorities),
      approvalStatuses: or('approvalStatuses', f.approvalStatuses),
      purchaseStatuses: or('purchaseStatuses', f.purchaseStatuses),
      doneStatuses: or('doneStatuses', f.doneStatuses),
    );
  }
}
