import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/palette.dart';
import '../../data/maintenance_repository.dart';
import '../../models/maintenance.dart';
import '../../state/auth_provider.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';

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
  bool _openOnly = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final rows = await _repo.requests(openOnly: _openOnly);
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

  @override
  Widget build(BuildContext context) {
    final open = _rows.where((r) => r.isOpen).length;
    final waiting = _rows.where((r) => r.state == 'Requested').length;

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
              label: const Text('Raise'),
            )
          : null,
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          children: [
            Row(
              children: [
                Expanded(
                  child: MetricCard(
                    title: 'Open',
                    value: open,
                    icon: Icons.assignment_outlined,
                    accent: AppColors.primary,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: MetricCard(
                    title: 'Not started',
                    value: waiting,
                    icon: Icons.pending_outlined,
                    accent: waiting > 0 ? AppColors.warning : AppColors.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: Text(
                    _openOnly ? 'Showing open' : 'Showing all',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                TextButton(
                  onPressed: () {
                    setState(() => _openOnly = !_openOnly);
                    _load();
                  },
                  child: Text(_openOnly ? 'Show all' : 'Show open'),
                ),
              ],
            ),
            const SizedBox(height: 4),
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
            else if (_rows.isEmpty)
              EmptyState(
                title: 'Nothing waiting',
                message: canRaise
                    ? 'No maintenance requests to show. Raise one with the button below.'
                    : 'No maintenance requests to show.',
                icon: Icons.inbox_outlined,
              )
            else
              for (final row in _rows) ...[
                _RequestTile(row: row, onOpen: () => _open(row)),
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

class _RequestTile extends StatelessWidget {
  const _RequestTile({required this.row, required this.onOpen});

  final MaintenanceRequest row;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) => AppCard(
        onTap: onOpen,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    row.title,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                  ),
                ),
                StatusBadge(row.state),
              ],
            ),
            const SizedBox(height: 2),
            MonoText(row.id),
            if (row.whatIsNeeded.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                row.whatIsNeeded,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, color: AppColors.textBody),
              ),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                SoftChip(row.plant),
                if (row.priority.isNotEmpty) SoftChip(row.priority),
                if (row.machineName.isNotEmpty) SoftChip(row.machineName),
                SoftChip(row.ageDays == 0 ? 'Today' : '${row.ageDays} days waiting'),
              ],
            ),
            if (row.waitingOn.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'Waiting on: ${row.waitingOn}',
                style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
            ],
          ],
        ),
      );
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
  final _title = TextEditingController();
  final _needed = TextEditingController();
  final _why = TextEditingController();

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
    _title.dispose();
    _needed.dispose();
    _why.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_title.text.trim().isEmpty || _needed.text.trim().isEmpty || _plant.isEmpty) {
      setState(() => _problem = 'A description, a plant and what is needed.');
      return;
    }
    setState(() {
      _saving = true;
      _problem = '';
    });
    try {
      await widget.repo.raiseRequest(
        title: _title.text.trim(),
        plant: _plant,
        whatIsNeeded: _needed.text.trim(),
        priority: _priority,
        machine: _machine,
        whyNeeded: _why.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
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
              const _FieldLabel('What do you want done?'),
              TextField(
                controller: _title,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  isDense: true,
                  hintText: 'Description',
                ),
              ),
              const SizedBox(height: 12),
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
              const SizedBox(height: 12),
              const _FieldLabel('Why'),
              TextField(
                controller: _why,
                maxLines: 2,
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
