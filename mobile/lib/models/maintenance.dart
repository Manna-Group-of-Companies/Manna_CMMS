import '../core/formatters.dart';

/// Breakdowns and maintenance requests, as the API sends them.
///
/// Kept apart from `models.dart`, which is the store catalog. The two share
/// nothing: a breakdown is a stopped machine and a product is a part on a
/// shelf, and putting them in one file only makes both harder to read.
///
/// Every field here is one a screen actually draws. The API sends a good deal
/// more on the detail record - timings, crew, spares - and those are added when
/// a screen needs them rather than mapped now and left unused.

double _asDouble(dynamic value, [double fallback = 0]) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? fallback;
  return fallback;
}

bool _asBool(dynamic value) => value == true || value == 1 || value == '1';

List<String> _asStrings(dynamic value) =>
    (value as List? ?? []).map((e) => asString(e)).where((e) => e.isNotEmpty).toList();

/// One step a record can be moved on by, as `/breakdowns/stages` describes it.
///
/// `allowedRoles` is the important part. Transitions are applied by the server
/// as the integration account, so ERPNext never sees who clicked - the server
/// checks the real user against this list, and the screens read the same list
/// to decide whether to offer the button at all. Drawing a button the server
/// will refuse is the failure this avoids.
class WorkStage {
  const WorkStage({
    required this.action,
    required this.from,
    required this.to,
    required this.title,
    required this.blurb,
    required this.fields,
    required this.required,
    required this.allowedRoles,
    required this.labels,
  });

  final String action;
  final String from;
  final String to;
  final String title;
  final String blurb;
  final List<String> fields;
  final List<String> required;
  final List<String> allowedRoles;
  final Map<String, String> labels;

  bool allows(String? role) => role != null && allowedRoles.contains(role);

  /// The label the API gave a field, falling back to the field name tidied up.
  String labelFor(String field) =>
      labels[field] ?? field.replaceAll('_', ' ').replaceFirstMapped(
            RegExp(r'^[a-z]'),
            (m) => m[0]!.toUpperCase(),
          );

  factory WorkStage.fromJson(String action, Map<String, dynamic> json) => WorkStage(
        action: action,
        from: asString(json['from']),
        to: asString(json['to']),
        title: asString(json['title']),
        blurb: asString(json['blurb']),
        fields: _asStrings(json['fields']),
        required: _asStrings(json['required']),
        allowedRoles: _asStrings(json['allowedRoles']),
        labels: (json['labels'] as Map?)?.map(
              (k, v) => MapEntry(asString(k), asString(v)),
            ) ??
            const {},
      );
}

/// A machine, as the report form's picker needs it.
class MachineOption {
  const MachineOption({
    required this.code,
    required this.name,
    required this.plant,
    required this.status,
  });

  final String code;
  final String name;
  final String plant;
  final String status;

  factory MachineOption.fromJson(Map<String, dynamic> json) => MachineOption(
        code: asString(json['code']),
        name: asString(json['name']),
        plant: asString(json['plant']),
        status: asString(json['status']),
      );
}

/// A plant, for the company filter.
class PlantOption {
  const PlantOption({required this.name, required this.code});

  final String name;
  final String code;

  factory PlantOption.fromJson(Map<String, dynamic> json) => PlantOption(
        name: asString(json['name']),
        code: asString(json['code']),
      );
}

/// A machine that has stopped.
class Breakdown {
  const Breakdown({
    required this.id,
    required this.machine,
    required this.machineName,
    required this.plant,
    required this.state,
    required this.waitingOn,
    required this.priority,
    required this.whatHappened,
    required this.reportedBy,
    required this.stoppedAt,
    required this.completedAt,
    required this.stoppedForHours,
    required this.nextAction,
    required this.failureMode,
    required this.actionsPerformed,
    required this.rootCause,
    required this.repeatFailure,
  });

  final String id;
  final String machine;
  final String machineName;
  final String plant;
  final String state;
  final String waitingOn;
  final String priority;
  final String whatHappened;
  final String reportedBy;
  final DateTime? stoppedAt;
  final DateTime? completedAt;
  final double stoppedForHours;

  /// The step this record is sitting on, as the server works it out. Empty once
  /// there is nothing left to do.
  final String nextAction;

  final String failureMode;
  final String actionsPerformed;
  final String rootCause;
  final bool repeatFailure;

  /// The machine is stopped right now.
  ///
  /// Not the same as open: a breakdown stays open after the repair while the
  /// root cause is written up, but the machine is running again the moment it
  /// reaches Repaired. Counting those as down reports hours against a machine
  /// that is back in production.
  bool get isDown => state == 'Reported' || state == 'Under Repair';

  bool get isOpen => state != 'Closed' && state != 'Cancelled';

  factory Breakdown.fromJson(Map<String, dynamic> json) => Breakdown(
        id: asString(json['id']),
        machine: asString(json['machine']),
        machineName: asString(json['machineName']),
        plant: asString(json['plant']),
        state: asString(json['state']),
        waitingOn: asString(json['waitingOn']),
        priority: asString(json['priority']),
        whatHappened: asString(json['whatHappened']),
        reportedBy: asString(json['reportedBy']),
        stoppedAt: parseDate(json['stoppedAt']),
        completedAt: parseDate(json['completedAt']),
        stoppedForHours: _asDouble(json['stoppedForHours']),
        nextAction: asString(json['nextAction']),
        failureMode: asString(json['failureMode']),
        actionsPerformed: asString(json['actionsPerformed']),
        rootCause: asString(json['rootCause']),
        repeatFailure: _asBool(json['repeatFailure']),
      );
}

/// Planned work: everything that is not a breakdown.
class MaintenanceRequest {
  const MaintenanceRequest({
    required this.id,
    required this.title,
    required this.machine,
    required this.machineName,
    required this.plant,
    required this.state,
    required this.waitingOn,
    required this.priority,
    required this.whatIsNeeded,
    required this.whyNeeded,
    required this.requestedBy,
    required this.requestedAt,
    required this.neededBy,
    required this.ageDays,
    required this.nextAction,
    required this.workDone,
  });

  final String id;
  final String title;
  final String machine;
  final String machineName;
  final String plant;
  final String state;
  final String waitingOn;
  final String priority;
  final String whatIsNeeded;
  final String whyNeeded;
  final String requestedBy;
  final DateTime? requestedAt;
  final DateTime? neededBy;

  /// How long it has been waiting, which is what a queue is read to answer.
  final int ageDays;

  final String nextAction;
  final String workDone;

  bool get isOpen => state != 'Closed' && state != 'Cancelled';

  factory MaintenanceRequest.fromJson(Map<String, dynamic> json) => MaintenanceRequest(
        id: asString(json['id']),
        title: asString(json['title']),
        machine: asString(json['machine']),
        machineName: asString(json['machineName']),
        plant: asString(json['plant']),
        state: asString(json['state']),
        waitingOn: asString(json['waitingOn']),
        priority: asString(json['priority']),
        whatIsNeeded: asString(json['whatIsNeeded']),
        whyNeeded: asString(json['whyNeeded']),
        requestedBy: asString(json['requestedBy']),
        requestedAt: parseDate(json['requestedAt']),
        neededBy: parseDate(json['neededBy']),
        ageDays: asInt(json['ageDays']),
        nextAction: asString(json['nextAction']),
        workDone: asString(json['workDone']),
      );
}
