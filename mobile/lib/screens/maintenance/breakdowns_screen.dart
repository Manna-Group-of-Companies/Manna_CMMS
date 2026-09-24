import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/palette.dart';
import '../../data/maintenance_repository.dart';
import '../../models/maintenance.dart';
import '../../state/auth_provider.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/common.dart';

/// Machines that have stopped.
///
/// The phone half of `Breakdowns.jsx`, and deliberately the same three figures:
/// open, work not started, and downtime so far. Downtime counts only the
/// machines that are stopped *now* - a breakdown stays open after the repair
/// while the root cause is written up, and counting those reports hours against
/// a machine that is back in production.
class BreakdownsScreen extends StatefulWidget {
  const BreakdownsScreen({super.key});

  @override
  State<BreakdownsScreen> createState() => _BreakdownsScreenState();
}

class _BreakdownsScreenState extends State<BreakdownsScreen> {
  late final MaintenanceRepository _repo = MaintenanceRepository(context.read<ApiClient>());

  List<Breakdown> _rows = const [];
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
      final rows = await _repo.breakdowns(openOnly: _openOnly);
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

  Future<void> _report() async {
    final made = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => ReportBreakdownSheet(repo: _repo),
    );
    if (made == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final open = _rows.where((r) => r.isOpen).length;
    final notStarted = _rows.where((r) => r.state == 'Reported').length;
    final downtime = _rows.where((r) => r.isDown).fold<double>(
          0,
          (sum, r) => sum + r.stoppedForHours,
        );

    /// Who may report one in the first place.
    ///
    /// Reporting used to be open to everyone this screen is shown to, which put
    /// the Maintenance Manager - the person who fixes a breakdown - in a
    /// position to also raise one. Mirrors the server's guard on POST
    /// /breakdowns; a button the server would refuse is worse than no button.
    final role = context.watch<AuthProvider>().user?.role;
    final canReport = role == 'Manager' || role == 'Production Manager';

    return AppShell(
      title: 'Breakdowns',
      floatingActionButton: canReport
          ? FloatingActionButton.extended(
              onPressed: _report,
              icon: const Icon(Icons.add),
              label: const Text('Report'),
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
                    icon: Icons.build_outlined,
                    accent: AppColors.primary,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: MetricCard(
                    title: 'Not started',
                    value: notStarted,
                    icon: Icons.pending_outlined,
                    accent: notStarted > 0 ? AppColors.danger : AppColors.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            // Hours are not a count, so this one is the card that takes a
            // formatted value rather than an integer.
            HeroStatCard(
              label: 'Downtime so far',
              value: _hours(downtime),
              caption: 'machines stopped right now',
              icon: Icons.timelapse_outlined,
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
                child: LoadingView(message: 'Loading breakdowns…'),
              )
            else if (_error.isNotEmpty)
              EmptyState(
                title: 'Could not load breakdowns',
                message: _error,
                icon: Icons.error_outline,
                iconColor: AppColors.danger,
              )
            else if (_rows.isEmpty)
              EmptyState(
                title: 'Nothing stopped',
                message: canReport
                    ? 'No breakdowns to show. Report one with the button below.'
                    : 'No breakdowns to show.',
                icon: Icons.check_circle_outline,
              )
            else
              for (final row in _rows) ...[
                _BreakdownTile(row: row, onOpen: () => _open(row)),
                const SizedBox(height: 10),
              ],
          ],
        ),
      ),
    );
  }

  Future<void> _open(Breakdown row) async {
    final changed = await context.push<bool>('/maintenance/breakdowns/${row.id}');
    if (changed == true) _load();
  }
}

String _hours(double h) {
  if (h <= 0) return '0 hr';
  if (h < 1) return '${(h * 60).round()} min';
  if (h < 72) return '${(h * 10).round() / 10} hr';
  return '${(h / 24).round()} days';
}

class _BreakdownTile extends StatelessWidget {
  const _BreakdownTile({required this.row, required this.onOpen});

  final Breakdown row;
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
                    row.machineName.isEmpty ? row.machine : row.machineName,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                  ),
                ),
                StatusBadge(row.state),
              ],
            ),
            const SizedBox(height: 2),
            MonoText(row.id),
            const SizedBox(height: 8),
            Text(
              row.whatHappened,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, color: AppColors.textBody),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                SoftChip(row.plant),
                if (row.priority.isNotEmpty) SoftChip(row.priority),
                SoftChip('Stopped for ${_hours(row.stoppedForHours)}'),
                if (row.repeatFailure)
                  const AppBadge('repeat', color: AppColors.danger),
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

/// Reporting a stopped machine.
///
/// Asks only what the person standing at the machine can see. Everything else -
/// what was done, the root cause - is recorded after the repair.
class ReportBreakdownSheet extends StatefulWidget {
  const ReportBreakdownSheet({super.key, required this.repo});

  final MaintenanceRepository repo;

  @override
  State<ReportBreakdownSheet> createState() => _ReportBreakdownSheetState();
}

class _ReportBreakdownSheetState extends State<ReportBreakdownSheet> {
  final _what = TextEditingController();

  List<MachineOption> _machines = const [];
  String _plantFilter = '';
  String _machine = '';
  String _priority = 'High';
  late DateTime _stoppedAt = DateTime.now();
  bool _saving = false;
  bool _loading = true;
  String _problem = '';

  /// A photo of the machine, taken while reporting - not asked for on the web,
  /// where nobody is standing at the machine with a camera in hand. Held as
  /// bytes rather than uploaded immediately: the breakdown record has to exist
  /// first, since a file attaches *to* something.
  XFile? _photo;
  Uint8List? _photoBytes;

  static const _maxPhotoBytes = 5 * 1024 * 1024;

  @override
  void initState() {
    super.initState();
    _loadMachines();
  }

  Future<void> _pickPhoto(ImageSource source) async {
    FocusScope.of(context).unfocus();
    try {
      final picked = await ImagePicker().pickImage(
        source: source,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 75,
      );
      if (picked == null) return;

      final bytes = await picked.readAsBytes();
      if (bytes.lengthInBytes > _maxPhotoBytes) {
        if (mounted) {
          setState(() => _problem = 'That photo is too large (max 5 MB). Try another one.');
        }
        return;
      }
      if (!mounted) return;
      setState(() {
        _photo = picked;
        _photoBytes = bytes;
        _problem = '';
      });
    } on PlatformException catch (e) {
      if (mounted) {
        setState(
          () => _problem = e.message ??
              'Could not open the ${source == ImageSource.camera ? 'camera' : 'gallery'}',
        );
      }
    } catch (_) {
      if (mounted) setState(() => _problem = 'Could not attach that photo.');
    }
  }

  String _mimeOf(XFile file) {
    final mimeType = file.mimeType;
    if (mimeType != null && mimeType.startsWith('image/')) return mimeType;
    return switch (file.name.toLowerCase().split('.').last) {
      'png' => 'image/png',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      _ => 'image/jpeg',
    };
  }

  Future<void> _loadMachines() async {
    try {
      final machines = await widget.repo.breakdownMachines();
      if (!mounted) return;
      setState(() => _machines = machines);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _what.dispose();
    super.dispose();
  }

  /// The companies represented in the machines this account may report against.
  /// A plant head is served one, so there is nothing to choose and no filter.
  List<String> get _plants =>
      (_machines.map((m) => m.plant).toSet().toList()..sort());

  List<MachineOption> get _shown =>
      _plantFilter.isEmpty ? _machines : _machines.where((m) => m.plant == _plantFilter).toList();

  Future<void> _submit() async {
    if (_machine.isEmpty || _what.text.trim().isEmpty) {
      setState(() => _problem = 'Choose the machine and say what happened.');
      return;
    }
    setState(() {
      _saving = true;
      _problem = '';
    });
    try {
      String two(int n) => n.toString().padLeft(2, '0');
      final created = await widget.repo.reportBreakdown(
        machine: _machine,
        stoppedAt: '${_stoppedAt.year}-${two(_stoppedAt.month)}-${two(_stoppedAt.day)} '
            '${two(_stoppedAt.hour)}:${two(_stoppedAt.minute)}:00',
        whatHappened: _what.text.trim(),
        priority: _priority,
      );

      // The photo goes up after the breakdown exists - a file attaches to a
      // record, so there is nothing to attach it to beforehand. A failure here
      // does not undo the report: the breakdown is real and reported either
      // way, and losing the photo is a smaller problem than losing the report.
      if (_photo != null && _photoBytes != null) {
        try {
          await widget.repo.attachToBreakdown(
            created.id,
            fileName: _photo!.name,
            contentType: _mimeOf(_photo!),
            dataBase64: base64Encode(_photoBytes!),
          );
        } on ApiException catch (e) {
          if (mounted) {
            // Reported, but say so: a silent photo failure reads as "it must
            // have worked" until someone opens the record later and finds it
            // missing.
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('${created.id} reported, but the photo failed: ${e.message}')),
            );
          }
        }
      }

      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
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
              Text('Report a breakdown', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              if (_loading)
                const LoadingView(message: 'Loading machines…')
              else ...[
                if (_plants.length > 1) ...[
                  const _Label('Company'),
                  AppDropdown<String>(
                    value: _plantFilter,
                    items: ['', ..._plants],
                    labelBuilder: (p) => p.isEmpty ? 'All companies' : p,
                    onChanged: (v) => setState(() {
                      _plantFilter = v ?? '';
                      // The machine already picked may not be in this company.
                      _machine = '';
                    }),
                  ),
                  const SizedBox(height: 12),
                ],
                const _Label('Machine'),
                AppDropdown<String>(
                  value: _machine,
                  items: ['', ..._shown.map((m) => m.code)],
                  labelBuilder: (code) {
                    if (code.isEmpty) return 'Choose the machine…';
                    final m = _shown.firstWhere((x) => x.code == code);
                    return '${m.name} — ${m.code}';
                  },
                  onChanged: (v) => setState(() => _machine = v ?? ''),
                ),
                const SizedBox(height: 12),
                const _Label('When did it stop?'),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.event_outlined, size: 18),
                        label: Text(
                          '${_stoppedAt.day}/${_stoppedAt.month}  '
                          '${_stoppedAt.hour.toString().padLeft(2, '0')}:'
                          '${_stoppedAt.minute.toString().padLeft(2, '0')}',
                        ),
                        onPressed: _pickWhen,
                      ),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      onPressed: () => setState(() => _stoppedAt = DateTime.now()),
                      child: const Text('Now'),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const _Label('What happened?'),
                TextField(
                  controller: _what,
                  maxLines: 3,
                  decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
                ),
                const SizedBox(height: 12),
                const _Label('How urgent'),
                AppDropdown<String>(
                  value: _priority,
                  items: const ['Critical', 'High', 'Medium', 'Low'],
                  labelBuilder: (p) => p,
                  onChanged: (v) => setState(() => _priority = v ?? 'High'),
                ),
                const SizedBox(height: 12),
                const _Label('Photo (optional)'),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.photo_camera_outlined, size: 18),
                        label: const Text('Camera'),
                        onPressed: () => _pickPhoto(ImageSource.camera),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.photo_library_outlined, size: 18),
                        label: const Text('Gallery'),
                        onPressed: () => _pickPhoto(ImageSource.gallery),
                      ),
                    ),
                  ],
                ),
                if (_photoBytes != null) ...[
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.memory(
                          _photoBytes!,
                          width: 56,
                          height: 56,
                          fit: BoxFit.cover,
                        ),
                      ),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Photo attached.',
                          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Remove',
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () => setState(() {
                          _photo = null;
                          _photoBytes = null;
                        }),
                      ),
                    ],
                  ),
                ],
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
                      child: Text(_saving ? 'Reporting…' : 'Report it'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      );

  Future<void> _pickWhen() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _stoppedAt,
      firstDate: DateTime.now().subtract(const Duration(days: 30)),
      lastDate: DateTime.now(),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_stoppedAt),
    );
    if (time == null) return;
    setState(() {
      _stoppedAt = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    });
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

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
