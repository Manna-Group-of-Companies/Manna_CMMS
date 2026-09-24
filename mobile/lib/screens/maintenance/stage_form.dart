import 'package:flutter/material.dart';

import '../../core/palette.dart';
import '../../models/maintenance.dart';
import '../../widgets/common.dart';

/// The form for whatever step a breakdown or request is sitting on.
///
/// The server sends each stage's field list, which fields are required and what
/// to call them; this decides how to draw each one. Deliberately a lookup by
/// field name rather than a type sent from the server: the web client does the
/// same, and the two have to agree on what "failure_mode" looks like or the
/// same record reads differently on a phone and a desk.
///
/// Whether the step may be taken at all is settled before this is built - the
/// screens check `stage.allows(role)` against the list the server sends.
/// Drawing a button the server will refuse is the bug this exists to avoid.

const _failureModes = [
  'Mechanical',
  'Electrical',
  'Hydraulic',
  'Pneumatic',
  'Instrumentation',
  'Operational',
  'Other',
];

/// Fields that are a child table rather than a single value.
const _tableFields = {
  'spares_required',
  'repaired_by',
  'prevention_actions',
  'materials_used',
  'worked_by',
};

String _stamp(DateTime when) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${when.year}-${two(when.month)}-${two(when.day)} '
      '${two(when.hour)}:${two(when.minute)}:00';
}

class StageForm extends StatefulWidget {
  const StageForm({
    super.key,
    required this.stage,
    required this.busy,
    required this.onSubmit,
    this.initial = const {},
  });

  final WorkStage stage;
  final bool busy;

  /// Values already on the record, so a half-filled step reopens where it was.
  final Map<String, dynamic> initial;

  /// Returns an error message to show, or null when it went through.
  final Future<String?> Function(Map<String, dynamic> fields) onSubmit;

  @override
  State<StageForm> createState() => _StageFormState();
}

class _StageFormState extends State<StageForm> {
  final Map<String, dynamic> _values = {};
  final Map<String, TextEditingController> _text = {};
  List<String> _missing = const [];
  String _problem = '';

  @override
  void initState() {
    super.initState();
    for (final field in widget.stage.fields) {
      if (_tableFields.contains(field)) {
        _values[field] = <Map<String, dynamic>>[];
        continue;
      }
      final existing = widget.initial[field];
      if (field.endsWith('_at') || field.endsWith('_date')) {
        // Times default to now. The commonest answer by far is "just then", and
        // a blank box invites a guess typed in a hurry.
        _values[field] = existing is String && existing.isNotEmpty
            ? existing
            : _stamp(DateTime.now());
      } else if (field == 'repeat_failure' || field == 'satisfied') {
        _values[field] = existing == true;
      } else {
        final text = existing?.toString() ?? '';
        _values[field] = text;
        _text[field] = TextEditingController(text: text);
      }
    }
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  bool _given(String field) {
    final value = _values[field];
    if (value is List) return value.isNotEmpty;
    if (value is bool) return true;
    return value != null && value.toString().trim().isNotEmpty;
  }

  Future<void> _submit() async {
    final missing = widget.stage.required.where((f) => !_given(f)).toList();
    if (missing.isNotEmpty) {
      setState(() {
        _missing = missing;
        _problem = 'Fill in ${missing.map(widget.stage.labelFor).join(', ')}.';
      });
      return;
    }

    setState(() {
      _missing = const [];
      _problem = '';
    });

    final error = await widget.onSubmit(Map<String, dynamic>.from(_values));
    if (error != null && mounted) setState(() => _problem = error);
  }

  @override
  Widget build(BuildContext context) {
    final stage = widget.stage;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(stage.title, style: Theme.of(context).textTheme.titleMedium),
          if (stage.blurb.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              stage.blurb,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted),
            ),
          ],
          const SizedBox(height: 12),
          for (final field in stage.fields) ...[
            _field(field),
            const SizedBox(height: 12),
          ],
          if (_problem.isNotEmpty) ...[
            Text(_problem, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
            const SizedBox(height: 10),
          ],
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: widget.busy ? null : _submit,
              child: Text(widget.busy ? 'Saving…' : stage.title),
            ),
          ),
        ],
      ),
    );
  }

  Widget _field(String field) {
    final label = widget.stage.labelFor(field);
    final required = widget.stage.required.contains(field);
    final invalid = _missing.contains(field);

    if (field == 'repeat_failure' || field == 'satisfied') {
      return _Check(
        label: label,
        value: _values[field] == true,
        onChanged: (v) => setState(() => _values[field] = v),
      );
    }

    if (field == 'failure_mode') {
      return _Labelled(
        label: label,
        required: required,
        invalid: invalid,
        child: AppDropdown<String>(
          // A leading blank, so a mode is chosen rather than inherited from
          // whatever happens to sort first. Frappe Selects default to their
          // first option, which is how every breakdown once came out Critical.
          value: (_values[field] as String?) ?? '',
          items: const ['', ..._failureModes],
          labelBuilder: (m) => m.isEmpty ? 'Choose…' : m,
          onChanged: (v) => setState(() => _values[field] = v ?? ''),
        ),
      );
    }

    if (field.endsWith('_at') || field.endsWith('_date')) {
      return _Labelled(
        label: label,
        required: required,
        invalid: invalid,
        child: _WhenField(
          value: _values[field] as String? ?? '',
          onChanged: (v) => setState(() => _values[field] = v),
        ),
      );
    }

    if (field == 'spares_required' || field == 'materials_used') {
      return _RowsField(
        label: label,
        addLabel: field == 'spares_required' ? 'Add a spare' : 'Add a material',
        rows: (_values[field] as List).cast<Map<String, dynamic>>(),
        columns: const [
          _Col('description', 'What was used', flex: 3),
          _Col('qty_required', 'Qty', numeric: true),
        ],
        blank: () => {'item_code': '', 'description': '', 'qty_required': 1},
        onChanged: (rows) => setState(() => _values[field] = rows),
      );
    }

    if (field == 'repaired_by' || field == 'worked_by') {
      return _RowsField(
        label: label,
        addLabel: 'Add a person',
        rows: (_values[field] as List).cast<Map<String, dynamic>>(),
        // Free text, not a picker: most of the maintenance team have no login,
        // and a list that only offers accounts leaves them off the record.
        columns: const [
          _Col('name', 'Name', flex: 3),
          _Col('hours', 'Hours', numeric: true),
        ],
        blank: () => {'name': '', 'hours': 0},
        onChanged: (rows) => setState(() => _values[field] = rows),
      );
    }

    if (field == 'prevention_actions') {
      return _RowsField(
        label: label,
        addLabel: 'Add an action',
        rows: (_values[field] as List).cast<Map<String, dynamic>>(),
        columns: const [_Col('description', 'What should change', flex: 1)],
        blank: () => {'action_type': 'Other', 'description': '', 'owner_user': ''},
        onChanged: (rows) => setState(() => _values[field] = rows),
      );
    }

    // Everything else is prose. The long ones get room to write in.
    final long = field == 'actions_performed' ||
        field == 'root_cause' ||
        field == 'work_done' ||
        field == 'plan_notes' ||
        field == 'closing_remarks' ||
        field == 'cancel_reason';

    return _Labelled(
      label: label,
      required: required,
      invalid: invalid,
      child: TextField(
        controller: _text[field],
        maxLines: long ? 3 : 1,
        onChanged: (v) => _values[field] = v,
        decoration: InputDecoration(
          border: const OutlineInputBorder(),
          isDense: true,
          errorText: invalid ? 'Needed' : null,
        ),
      ),
    );
  }
}

class _Labelled extends StatelessWidget {
  const _Labelled({
    required this.label,
    required this.child,
    this.required = false,
    this.invalid = false,
  });

  final String label;
  final Widget child;
  final bool required;
  final bool invalid;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            required ? '$label *' : label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: invalid ? AppColors.danger : AppColors.textMuted,
            ),
          ),
          const SizedBox(height: 6),
          child,
        ],
      );
}

class _Check extends StatelessWidget {
  const _Check({required this.label, required this.value, required this.onChanged});

  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: () => onChanged(!value),
        child: Row(
          children: [
            Checkbox(value: value, onChanged: (v) => onChanged(v ?? false)),
            Expanded(child: Text(label, style: const TextStyle(fontSize: 14))),
          ],
        ),
      );
}

/// A date and a time, kept in the format the API stores.
class _WhenField extends StatelessWidget {
  const _WhenField({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  DateTime get _parsed => DateTime.tryParse(value.replaceFirst(' ', 'T')) ?? DateTime.now();

  @override
  Widget build(BuildContext context) {
    final when = _parsed;
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            icon: const Icon(Icons.event_outlined, size: 18),
            label: Text(
              '${when.day}/${when.month}/${when.year}  '
              '${when.hour.toString().padLeft(2, '0')}:${when.minute.toString().padLeft(2, '0')}',
            ),
            onPressed: () async {
              final date = await showDatePicker(
                context: context,
                initialDate: when,
                firstDate: DateTime(when.year - 2),
                lastDate: DateTime.now().add(const Duration(days: 1)),
              );
              if (date == null || !context.mounted) return;
              final time = await showTimePicker(
                context: context,
                initialTime: TimeOfDay.fromDateTime(when),
              );
              if (time == null) return;
              onChanged(_stamp(DateTime(
                date.year,
                date.month,
                date.day,
                time.hour,
                time.minute,
              )));
            },
          ),
        ),
        const SizedBox(width: 8),
        OutlinedButton(
          onPressed: () => onChanged(_stamp(DateTime.now())),
          child: const Text('Now'),
        ),
      ],
    );
  }
}

class _Col {
  const _Col(this.key, this.label, {this.numeric = false, this.flex = 2});

  final String key;
  final String label;
  final bool numeric;
  final int flex;
}

/// A child table, as rows somebody adds one at a time.
class _RowsField extends StatelessWidget {
  const _RowsField({
    required this.label,
    required this.addLabel,
    required this.rows,
    required this.columns,
    required this.blank,
    required this.onChanged,
  });

  final String label;
  final String addLabel;
  final List<Map<String, dynamic>> rows;
  final List<_Col> columns;
  final Map<String, dynamic> Function() blank;
  final ValueChanged<List<Map<String, dynamic>>> onChanged;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.textMuted,
            ),
          ),
          const SizedBox(height: 6),
          for (var i = 0; i < rows.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  for (final col in columns) ...[
                    Expanded(
                      flex: col.flex,
                      child: TextFormField(
                        initialValue: rows[i][col.key]?.toString() ?? '',
                        keyboardType: col.numeric ? TextInputType.number : TextInputType.text,
                        decoration: InputDecoration(
                          labelText: col.label,
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                        onChanged: (v) {
                          final next = [...rows];
                          next[i] = {
                            ...next[i],
                            col.key: col.numeric ? (num.tryParse(v) ?? 0) : v,
                          };
                          onChanged(next);
                        },
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                  IconButton(
                    tooltip: 'Remove',
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => onChanged([...rows]..removeAt(i)),
                  ),
                ],
              ),
            ),
          TextButton.icon(
            icon: const Icon(Icons.add, size: 18),
            label: Text(addLabel),
            onPressed: () => onChanged([...rows, blank()]),
          ),
        ],
      );
}
