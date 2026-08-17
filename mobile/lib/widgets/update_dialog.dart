import 'package:flutter/material.dart';

import '../core/palette.dart';
import '../core/toast.dart';
import '../core/update_service.dart';

/// Runs the version check the app performs on every launch.
///
/// Deliberately quiet: a failed check (no Wi-Fi on the shop floor, Hosting
/// unreachable, no update URL configured in this build) is logged and dropped,
/// and the user carries on with the app they already have. A release the user
/// dismissed with "Later" is not raised again either — unless it is mandatory.
Future<void> checkForUpdateOnStartup(BuildContext context) async {
  final UpdateCheck result;
  try {
    result = await UpdateService.check();
  } on UpdateException catch (error) {
    debugPrint('Startup update check skipped: $error');
    return;
  }

  if (!result.updateAvailable) return;

  final latest = result.latest!;
  if (!result.isMandatory && await UpdateService.skippedVersion() == latest.version) {
    return;
  }
  if (!context.mounted) return;

  await showUpdateDialog(context, result);
}

/// The "Check for Updates" button in Settings. Unlike the startup check this
/// one always has something to say — including "you are up to date" and why a
/// check failed.
Future<void> checkForUpdateFromSettings(BuildContext context) async {
  final UpdateCheck result;
  try {
    result = await UpdateService.check();
  } on UpdateException catch (error) {
    Toast.error(error.message);
    return;
  }

  if (!context.mounted) return;

  if (!result.updateAvailable) {
    Toast.success('StockMaster ${result.installedVersion} is up to date.');
    return;
  }

  await showUpdateDialog(context, result);
}

Future<void> showUpdateDialog(BuildContext context, UpdateCheck check) {
  return showDialog<void>(
    context: context,
    // A mandatory release cannot be tapped away.
    barrierDismissible: !check.isMandatory,
    builder: (_) => UpdateDialog(check: check),
  );
}

/// The update prompt: what is installed, what is available, what changed, and
/// the download progress once the user commits to it.
class UpdateDialog extends StatefulWidget {
  const UpdateDialog({super.key, required this.check});

  final UpdateCheck check;

  @override
  State<UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<UpdateDialog> {
  final _service = UpdateService();

  @override
  void initState() {
    super.initState();
    _service.addListener(_onServiceChanged);
  }

  @override
  void dispose() {
    _service.removeListener(_onServiceChanged);
    _service.dispose();
    super.dispose();
  }

  void _onServiceChanged() {
    if (mounted) setState(() {});
  }

  UpdateManifest get _latest => widget.check.latest!;

  Future<void> _startDownload() async {
    final opened = await _service.downloadAndInstall(_latest);
    if (!mounted || !opened) return;
    // The installer is up — Android owns the screen now, so get out of its way.
    Navigator.of(context).pop();
    Toast.success('Opening the Android installer…');
  }

  void _later() {
    UpdateService.skipVersion(_latest.version);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final busy = _service.isBusy;
    final mandatory = widget.check.isMandatory;

    return PopScope(
      // Back button must not dismiss a mandatory update, nor abandon a
      // download half-written to disk.
      canPop: !mandatory && !busy,
      child: AlertDialog(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        titlePadding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
        contentPadding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
        actionsPadding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        title: _Header(mandatory: mandatory),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _VersionTile(
                        label: 'Current version',
                        value: widget.check.installedVersion,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 8),
                      child: Icon(Icons.arrow_forward,
                          size: 16, color: AppColors.textFaint),
                    ),
                    Expanded(
                      child: _VersionTile(
                        label: 'Latest version',
                        value: _latest.version,
                        color: AppColors.primaryDeep,
                      ),
                    ),
                  ],
                ),
                if (_latest.releaseNotes.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  const _SectionLabel("What's new"),
                  const SizedBox(height: 6),
                  Container(
                    width: double.infinity,
                    constraints: const BoxConstraints(maxHeight: 168),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceMuted,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: SingleChildScrollView(
                      child: Text(
                        _latest.releaseNotes,
                        style: const TextStyle(
                          color: AppColors.textBody,
                          fontSize: 12.5,
                          height: 1.55,
                        ),
                      ),
                    ),
                  ),
                ],
                if (mandatory) ...[
                  const SizedBox(height: 14),
                  const _Notice(
                    icon: Icons.priority_high,
                    color: AppColors.warning,
                    message:
                        'This is a required update — StockMaster needs it to keep '
                        'working with the server.',
                  ),
                ],
                if (_service.error != null) ...[
                  const SizedBox(height: 14),
                  _Notice(
                    icon: Icons.error_outline,
                    color: AppColors.danger,
                    message: _service.error!,
                  ),
                ],
                if (busy) ...[
                  const SizedBox(height: 18),
                  _DownloadProgress(service: _service),
                ],
                const SizedBox(height: 4),
              ],
            ),
          ),
        ),
        actions: _actions(mandatory: mandatory, busy: busy),
      ),
    );
  }

  List<Widget> _actions({required bool mandatory, required bool busy}) {
    if (busy) {
      return [
        TextButton(
          // Verifying and opening the installer are both near-instant; only a
          // download is worth interrupting.
          onPressed: _service.stage == UpdateStage.downloading
              ? _service.cancel
              : null,
          style: TextButton.styleFrom(foregroundColor: AppColors.textSecondary),
          child: const Text('Cancel'),
        ),
      ];
    }

    final retrying = _service.stage == UpdateStage.failed;
    return [
      if (!mandatory)
        TextButton(
          onPressed: _later,
          style: TextButton.styleFrom(foregroundColor: AppColors.textSecondary),
          child: const Text('Later'),
        ),
      FilledButton.icon(
        onPressed: UpdateService.canInstall ? _startDownload : null,
        icon: Icon(retrying ? Icons.refresh : Icons.system_update_alt, size: 18),
        label: Text(retrying ? 'Try Again' : 'Update Now'),
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primary,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        ),
      ),
    ];
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.mandatory});

  final bool mandatory;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          height: 40,
          width: 40,
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.12),
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.primary.withValues(alpha: 0.22)),
          ),
          child: const Icon(Icons.system_update,
              size: 21, color: AppColors.primaryDeep),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'New Update Available',
                style: TextStyle(
                  color: AppColors.textStrong,
                  fontSize: 16.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                mandatory ? 'Required update' : 'StockMaster',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _VersionTile extends StatelessWidget {
  const _VersionTile({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label,
              style: const TextStyle(color: AppColors.textMuted, fontSize: 10.5)),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: color,
              fontSize: 15,
              fontWeight: FontWeight.w700,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(
          color: AppColors.textSecondary,
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
        ),
      );
}

/// The progress bar, the percentage, and how much of the APK has landed.
class _DownloadProgress extends StatelessWidget {
  const _DownloadProgress({required this.service});

  final UpdateService service;

  @override
  Widget build(BuildContext context) {
    final progress = service.progress;
    final percent = progress == null ? null : (progress * 100).round();

    final caption = switch (service.stage) {
      UpdateStage.verifying => 'Verifying download…',
      UpdateStage.opening => 'Opening the installer…',
      _ => service.totalBytes > 0
          ? '${formatBytes(service.receivedBytes)} of '
              '${formatBytes(service.totalBytes)}'
          // Hosting normally sends Content-Length; if it did not, show what has
          // arrived rather than a size we cannot know.
          : '${formatBytes(service.receivedBytes)} downloaded',
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Downloading update',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
            Text(
              percent == null ? '' : '$percent%',
              style: const TextStyle(
                color: AppColors.primaryDeep,
                fontSize: 13,
                fontWeight: FontWeight.w700,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            // Null while the size is unknown, which renders the indeterminate
            // sweep instead of a bar stuck at zero.
            value: service.stage == UpdateStage.downloading ? progress : null,
            minHeight: 7,
            backgroundColor: AppColors.surfaceMuted,
            valueColor: const AlwaysStoppedAnimation(AppColors.primary),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          caption,
          style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
        ),
      ],
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.icon,
    required this.color,
    required this.message,
  });

  final IconData icon;
  final Color color;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.24)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: color, fontSize: 11.5, height: 1.45),
            ),
          ),
        ],
      ),
    );
  }
}
