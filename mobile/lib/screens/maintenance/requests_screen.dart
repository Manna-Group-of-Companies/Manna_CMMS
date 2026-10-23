import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/formatters.dart';
import '../../core/palette.dart';
import '../../data/maintenance_repository.dart';
import '../../models/maintenance.dart';
import '../../state/auth_provider.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';
import '../../widgets/work_widgets.dart';

/// Planned work: everything that is not a breakdown.
///
/// Ordered as the API sends it - by urgency, then by age. The point of this
/// list is that planned work gets picked up between the breakdowns, and a list
/// in date order tells nobody which to pick up first.
class RequestsScreen extends StatefulWidget {
  const RequestsScreen({super.key});

  @override
  State<RequestsScreen> createState() => _RequestsScreenState();
}

class _RequestsScreenState extends State<RequestsScreen> {
  late final MaintenanceRepository _repo = MaintenanceRepository(context.read<ApiClient>());

  List<MaintenanceRequest> _rows = const [];
  bool _loading = true;
  String _filter = 'Open';
  String _search = '';
  String _error = '';

  static const _filters = ['Open', 'Not Started', 'In Progress', 'Closed', 'All'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  /// Everything, open or not: the pills choose between them on the phone.
  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final rows = await _repo.requests();
      if (!mounted) return;
      setState(() {
        _rows = rows;
        _error = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _raise() async {
    final made = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => RaiseRequestSheet(repo: _repo),
    );
    if (made == true) _load();
  }

  static bool _notStarted(MaintenanceRequest r) =>
      r.state == 'Requested' || r.state == 'Attended';

  /// Kept in the API's order - urgency, then age - within whichever pill.
  List<MaintenanceRequest> get _shown {
    final q = _search.trim().toLowerCase();
    return _rows.where((r) {
      final inFilter = switch (_filter) {
        'Open' => r.isOpen,
        'Not Started' => _notStarted(r),
        'In Progress' => r.isOpen && !_notStarted(r),
        'Closed' => !r.isOpen,
        _ => true,
      };
      if (!inFilter) return false;
      if (q.isEmpty) return true;
      return '${r.title} ${r.id} ${r.plant} ${r.machineName} ${r.whatIsNeeded}'
          .toLowerCase()
          .contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final shown = _shown;

    /// Who may raise one — the plant's own job, not maintenance's. Mirrors
    /// the server's guard on POST /maintenance-requests.
    final role = context.watch<AuthProvider>().user?.role;
    final canRaise = role == 'Manager' || role == 'Production Manager';

    return AppShell(
      title: 'Maintenance Requests',
      floatingActionButton: canRaise
          ? FloatingActionButton.extended(
              onPressed: _raise,
              icon: const Icon(Icons.add),
              label: const Text('New request'),
            )
          : null,
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          children: [
            SearchBox(
              hint: 'Search requests…',
              onChanged: (v) => setState(() => _search = v),
            ),
            const SizedBox(height: 12),
            PillFilters(
              options: _filters,
              selected: _filter,
              onChanged: (v) => setState(() => _filter = v),
            ),
            const SizedBox(height: 14),
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 40),
                child: LoadingView(message: 'Loading requests…'),
              )
            else if (_error.isNotEmpty)
              EmptyState(
                title: 'Could not load requests',
                message: _error,
                icon: Icons.error_outline,
                iconColor: AppColors.danger,
              )
            else if (shown.isEmpty)
              EmptyState(
                title: 'Nothing here',
                message: canRaise && _rows.isEmpty
                    ? 'No maintenance requests to show. Raise one with the button below.'
                    : 'No maintenance requests match.',
                icon: Icons.inbox_outlined,
              )
            else
              for (final row in shown) ...[
                WorkListTile(
                  icon: Icons.handyman_outlined,
                  title: row.title,
                  code: row.id,
                  date: formatDate(row.requestedAt),
                  priority: row.priority,
                  state: row.state,
                  subtitle: [
                    row.machineName.isEmpty ? row.plant : row.machineName,
                    if (row.isOpen) row.ageDays == 0 ? 'today' : '${row.ageDays} days waiting',
                  ].where((s) => s.isNotEmpty).join('  •  '),
                  onTap: () => _open(row),
                ),
                const SizedBox(height: 10),
              ],
          ],
        ),
      ),
    );
  }

  Future<void> _open(MaintenanceRequest row) async {
    final changed = await context.push<bool>('/maintenance/requests/${row.id}');
    if (changed == true) _load();
  }
}

/// Raising planned work.
///
/// The plant is filled in for anyone whose account covers one site - the server
/// narrows the list, so one entry means there is nothing to choose.
class RaiseRequestSheet extends StatefulWidget {
  const RaiseRequestSheet({super.key, required this.repo});

  final MaintenanceRepository repo;

  @override
  State<RaiseRequestSheet> createState() => _RaiseRequestSheetState();
}

class _RaiseRequestSheetState extends State<RaiseRequestSheet> {
  final _needed = TextEditingController();

  List<MachineOption> _machines = const [];
  List<PlantOption> _plants = const [];
  String _plant = '';
  String _machine = '';
  String _priority = 'Medium';
  bool _loading = true;
  bool _saving = false;
  String _problem = '';

  @override
  void initState() {
    super.initState();
    _loadOptions();
  }

  Future<void> _loadOptions() async {
    try {
      final machines = await widget.repo.breakdownMachines();
      final plants = await widget.repo.plants();
      if (!mounted) return;
      setState(() {
        _machines = machines;
        _plants = plants;
        // One plant means the account covers one site: not a choice.
        if (plants.length == 1) _plant = plants.first.name;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _needed.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final needed = _needed.text.trim();
    if (needed.isEmpty || _plant.isEmpty) {
      setState(() => _problem = 'A plant and what is needed.');
      return;
    }
    setState(() {
      _saving = true;
      _problem = '';
    });
    try {
      await widget.repo.raiseRequest(
        title: _titleFrom(needed),
        plant: _plant,
        whatIsNeeded: needed,
        priority: _priority,
        machine: _machine,
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// The request's headline, taken from what is needed.
  ///
  /// The phone no longer asks "What do you want done?" separately - it was the
  /// same answer typed twice - but the server still files every request under
  /// a title and the lists show it. So the first line of what is needed stands
  /// in, cut short enough for a list row.
  static String _titleFrom(String needed) {
    final line = needed.split('\n').first.trim();
    return line.length <= 80 ? line : '${line.substring(0, 79).trimRight()}…';
  }

  @override
  Widget build(BuildContext context) {
    final machines =
        _plant.isEmpty ? _machines : _machines.where((m) => m.plant == _plant).toList();

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Raise a maintenance request', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            if (_loading)
              const LoadingView(message: 'Loading…')
            else ...[
              const _FieldLabel('How urgent'),
              AppDropdown<String>(
                value: _priority,
                items: const ['High', 'Medium', 'Low'],
                labelBuilder: (p) => p,
                onChanged: (v) => setState(() => _priority = v ?? 'Medium'),
              ),
              const SizedBox(height: 12),
              const _FieldLabel('Which machine (if any)'),
              AppDropdown<String>(
                value: _machine,
                items: ['', ...machines.map((m) => m.code)],
                labelBuilder: (code) {
                  if (code.isEmpty) return 'Not about one machine';
                  final m = machines.firstWhere((x) => x.code == code);
                  return '${m.name} — ${m.code}';
                },
                onChanged: (v) => setState(() {
                  _machine = v ?? '';
                  final picked = machines.where((m) => m.code == _machine);
                  if (picked.isNotEmpty) _plant = picked.first.plant;
                }),
              ),
              if (_plants.length > 1) ...[
                const SizedBox(height: 12),
                const _FieldLabel('Plant'),
                AppDropdown<String>(
                  value: _plant,
                  items: ['', ..._plants.map((p) => p.name)],
                  labelBuilder: (p) => p.isEmpty ? 'Choose…' : p,
                  onChanged: (v) => setState(() => _plant = v ?? ''),
                ),
              ],
              const SizedBox(height: 12),
              const _FieldLabel('What is needed'),
              TextField(
                controller: _needed,
                maxLines: 3,
                decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
              ),
            ],
            if (_problem.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(_problem, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
            ],
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _saving ? null : () => Navigator.of(context).pop(false),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: _saving || _loading ? null : _submit,
                    child: Text(_saving ? 'Raising…' : 'Raise it'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.textMuted,
          ),
        ),
      );
}
