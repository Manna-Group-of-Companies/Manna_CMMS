import '../core/formatters.dart';
import 'maintenance.dart' show PlantOption;

/// Low value purchase requests, as `/low-value-purchases` sends them.
///
/// Small buys made locally and kept in ERPNext only - nothing here ever goes to
/// SAP. A manager or plant head asks, the purchase manager buys it or turns it
/// down, and whoever asked records it received.
///
/// Who may take which step is the server's to say, per record, in `may`. The
/// screens read that and nothing else; deciding it again here from the role
/// would drift the first time the rule changes on the server.

double _asDouble(dynamic value, [double fallback = 0]) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? fallback;
  return fallback;
}

List<String> _asStrings(dynamic value) =>
    (value as List? ?? []).map((e) => asString(e)).where((e) => e.isNotEmpty).toList();

Map<String, dynamic>? _asMap(dynamic value) => value is Map<String, dynamic> ? value : null;

/// One item on the request: what was guessed it would cost, and - once bought -
/// what it did.
class LowValueLine {
  const LowValueLine({
    required this.idx,
    required this.description,
    required this.specification,
    required this.qty,
    required this.unit,
    required this.estRate,
    required this.estAmount,
    required this.rate,
    required this.amount,
    required this.remarks,
  });

  /// The row number on the record. The order step names lines by this.
  final int idx;
  final String description;
  final String specification;
  final double qty;
  final String unit;
  final double estRate;
  final double estAmount;

  /// Zero until the purchase manager records what was paid.
  final double rate;
  final double amount;
  final String remarks;

  bool get isPriced => rate > 0;

  factory LowValueLine.fromJson(Map<String, dynamic> json) => LowValueLine(
        idx: asInt(json['idx']),
        description: asString(json['description']),
        specification: asString(json['specification']),
        qty: _asDouble(json['qty']),
        unit: asString(json['unit']),
        estRate: _asDouble(json['estRate']),
        estAmount: _asDouble(json['estAmount']),
        rate: _asDouble(json['rate']),
        amount: _asDouble(json['amount']),
        remarks: asString(json['remarks']),
      );
}

/// The purchase: who it was bought from, and when it should arrive.
class LowValueOrder {
  const LowValueOrder({
    required this.vendorName,
    required this.vendorContact,
    required this.expectedOn,
    required this.remarks,
    required this.by,
    required this.at,
  });

  final String vendorName;
  final String vendorContact;
  final DateTime? expectedOn;
  final String remarks;
  final String by;
  final DateTime? at;

  factory LowValueOrder.fromJson(Map<String, dynamic> json) => LowValueOrder(
        vendorName: asString(json['vendorName']),
        vendorContact: asString(json['vendorContact']),
        expectedOn: parseDate(json['expectedOn']),
        remarks: asString(json['remarks']),
        by: asString(json['by']),
        at: parseDate(json['at']),
      );
}

/// It arrived, against which bill.
class LowValueReceipt {
  const LowValueReceipt({
    required this.billNo,
    required this.billDate,
    required this.remarks,
    required this.by,
    required this.at,
  });

  final String billNo;
  final DateTime? billDate;
  final String remarks;
  final String by;
  final DateTime? at;

  factory LowValueReceipt.fromJson(Map<String, dynamic> json) => LowValueReceipt(
        billNo: asString(json['billNo']),
        billDate: parseDate(json['billDate']),
        remarks: asString(json['remarks']),
        by: asString(json['by']),
        at: parseDate(json['at']),
      );
}

/// Rejected or withdrawn - the status says which - and why.
class LowValueClosure {
  const LowValueClosure({required this.reason, required this.by, required this.at});

  final String reason;
  final String by;
  final DateTime? at;

  factory LowValueClosure.fromJson(Map<String, dynamic> json) => LowValueClosure(
        reason: asString(json['reason']),
        by: asString(json['by']),
        at: parseDate(json['at']),
      );
}

/// The steps the signed-in person may take on this record now.
class LowValueSteps {
  const LowValueSteps({
    this.order = false,
    this.receive = false,
    this.reject = false,
    this.withdraw = false,
  });

  final bool order;
  final bool receive;
  final bool reject;
  final bool withdraw;

  bool get any => order || receive || reject || withdraw;

  factory LowValueSteps.fromJson(Map<String, dynamic> json) => LowValueSteps(
        order: json['order'] == true,
        receive: json['receive'] == true,
        reject: json['reject'] == true,
        withdraw: json['withdraw'] == true,
      );
}

class LowValuePurchase {
  const LowValuePurchase({
    required this.id,
    required this.plant,
    required this.department,
    required this.status,
    required this.waitingOn,
    required this.urgency,
    required this.requiredBy,
    required this.purpose,
    required this.raisedBy,
    required this.raisedAt,
    required this.estTotal,
    required this.total,
    required this.lines,
    required this.order,
    required this.received,
    required this.closed,
    required this.may,
    required this.updatedAt,
  });

  final String id;
  final String plant;
  final String department;
  final String status;

  /// Who or what it is sitting with, as the server words it. Empty once done.
  final String waitingOn;
  final String urgency;
  final DateTime? requiredBy;
  final String purpose;
  final String raisedBy;
  final DateTime? raisedAt;
  final double estTotal;

  /// What was actually paid. Zero until it is ordered.
  final double total;
  final List<LowValueLine> lines;
  final LowValueOrder? order;
  final LowValueReceipt? received;
  final LowValueClosure? closed;
  final LowValueSteps may;
  final DateTime? updatedAt;

  bool get isUrgent => urgency == 'Urgent';
  bool get isOpen => status == 'Requested' || status == 'Ordered';

  /// Bought, so [total] is what was paid rather than nothing yet.
  bool get hasActual => order != null && total > 0;

  factory LowValuePurchase.fromJson(Map<String, dynamic> json) {
    final order = _asMap(json['order']);
    final received = _asMap(json['received']);
    final closed = _asMap(json['closed']);
    return LowValuePurchase(
      id: asString(json['id']),
      plant: asString(json['plant']),
      department: asString(json['department']),
      status: asString(json['status'], 'Requested'),
      waitingOn: asString(json['waitingOn']),
      urgency: asString(json['urgency'], 'Normal'),
      requiredBy: parseDate(json['requiredBy']),
      purpose: asString(json['purpose']),
      raisedBy: asString(json['raisedBy']),
      raisedAt: parseDate(json['raisedAt']),
      estTotal: _asDouble(json['estTotal']),
      total: _asDouble(json['total']),
      lines: (json['lines'] as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .map(LowValueLine.fromJson)
          .toList(growable: false),
      order: order == null ? null : LowValueOrder.fromJson(order),
      received: received == null ? null : LowValueReceipt.fromJson(received),
      closed: closed == null ? null : LowValueClosure.fromJson(closed),
      may: LowValueSteps.fromJson(_asMap(json['may']) ?? const {}),
      updatedAt: parseDate(json['updatedAt']),
    );
  }
}

/// What the raise form offers, from `/low-value-purchases/options`.
class LowValueOptions {
  const LowValueOptions({
    required this.units,
    required this.statuses,
    required this.maxLines,
    required this.plants,
  });

  final List<String> units;
  final List<String> statuses;
  final int maxLines;

  /// Already narrowed by the server to the plants this person may raise for.
  final List<PlantOption> plants;

  factory LowValueOptions.fromJson(Map<String, dynamic> json) => LowValueOptions(
        units: _asStrings(json['units']),
        statuses: _asStrings(json['statuses']),
        maxLines: asInt(json['maxLines'], 30),
        plants: (json['plants'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map(PlantOption.fromJson)
            .toList(growable: false),
      );
}
