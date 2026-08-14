import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/palette.dart';
import '../core/server_config.dart';
import '../core/toast.dart';
import '../state/server_provider.dart';

/// Shows the connection state to the API and lets the user fix it.
///
/// Renders nothing once the server answers, so it stays out of the way on a
/// healthy setup.
class ServerStatusBanner extends StatefulWidget {
  const ServerStatusBanner({super.key, this.autoDetectOnFailure = true});

  /// Kick off a network sweep automatically the first time the API is found
  /// to be unreachable, so a physical device finds the dev machine unaided.
  final bool autoDetectOnFailure;

  @override
  State<ServerStatusBanner> createState() => _ServerStatusBannerState();
}

class _ServerStatusBannerState extends State<ServerStatusBanner> {
  bool _autoDetectTried = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeAutoDetect());
  }

  void _maybeAutoDetect() {
    if (!mounted || !widget.autoDetectOnFailure || _autoDetectTried) return;
    final server = context.read<ServerProvider>();
    if (server.status != ServerStatus.unreachable || server.isPinned) return;
    _autoDetectTried = true;
    server.autoDetect();
  }

  @override
  Widget build(BuildContext context) {
    final server = context.watch<ServerProvider>();

    // The status can flip to unreachable after the first frame (e.g. a request
    // fails later), so keep watching for the chance to auto-detect.
    if (server.status == ServerStatus.unreachable) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _maybeAutoDetect());
    }

    if (server.status == ServerStatus.connected) return const SizedBox.shrink();

    final busy = server.status == ServerStatus.checking ||
        server.status == ServerStatus.scanning;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: (busy ? AppColors.warningDeep : AppColors.dangerDeep)
            .withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: (busy ? AppColors.warningDeep : AppColors.dangerDeep)
              .withValues(alpha: 0.28),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 16,
                height: 16,
                child: busy
                    ? const CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.warning,
                      )
                    : const Icon(Icons.cloud_off_outlined,
                        size: 16, color: AppColors.danger),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _message(server),
                  style: TextStyle(
                    color: busy ? AppColors.warning : AppColors.danger,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    height: 1.4,
                  ),
                ),
              ),
            ],
          ),
          if (server.status == ServerStatus.scanning) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: server.scanProgress == 0 ? null : server.scanProgress,
                minHeight: 4,
                backgroundColor: AppColors.border,
                color: AppColors.warningDeep,
              ),
            ),
          ],
          if (!busy) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                TextButton.icon(
                  onPressed: server.isPinned ? null : server.autoDetect,
                  icon: const Icon(Icons.wifi_find_outlined, size: 16),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.danger,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                  ),
                  label: const Text('Find server',
                      style: TextStyle(fontSize: 12)),
                ),
                const SizedBox(width: 4),
                TextButton.icon(
                  onPressed: () => showServerSettingsSheet(context),
                  icon: const Icon(Icons.dns_outlined, size: 16),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.textBody,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                  ),
                  label: const Text('Enter address',
                      style: TextStyle(fontSize: 12)),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  String _message(ServerProvider server) {
    switch (server.status) {
      case ServerStatus.checking:
        return 'Connecting to the server…';
      case ServerStatus.scanning:
        return 'Searching your Wi-Fi network for the StockMaster server…';
      case ServerStatus.unreachable:
        if (server.isPinned) {
          return 'Cannot reach ${server.host}. This build has a fixed server '
              'address, so start the API on that machine.';
        }
        if (server.host == ServerConfig.hostOf(ServerConfig.cloudUrl)) {
          return 'Cannot reach the hosted server at ${server.host}. Check this '
              'device’s internet connection — the server may also be waking '
              'up, so try again in a moment.';
        }
        return 'Cannot reach the server at ${server.host}. Make sure the API '
            'is running and that this device is on the same Wi-Fi network.';
      case ServerStatus.connected:
        return '';
    }
  }
}

/// [ServerStatusBanner] with the padding an authenticated screen needs, and
/// nothing at all (not even whitespace) while the server is reachable.
class ServerStatusBar extends StatelessWidget {
  const ServerStatusBar({super.key});

  @override
  Widget build(BuildContext context) {
    if (context.watch<ServerProvider>().status == ServerStatus.connected) {
      return const SizedBox.shrink();
    }
    return const Padding(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: ServerStatusBanner(),
    );
  }
}

/// Compact, tappable read-out of the current API address.
class ServerAddressChip extends StatelessWidget {
  const ServerAddressChip({super.key});

  @override
  Widget build(BuildContext context) {
    final server = context.watch<ServerProvider>();
    final connected = server.status == ServerStatus.connected;

    return TextButton.icon(
      onPressed: () => showServerSettingsSheet(context),
      icon: Icon(
        connected ? Icons.check_circle_outline : Icons.dns_outlined,
        size: 14,
        color: connected ? AppColors.success : AppColors.textMuted,
      ),
      style: TextButton.styleFrom(
        foregroundColor: AppColors.textMuted,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      ),
      label: Text(
        'Server: ${server.host}',
        style: const TextStyle(fontSize: 11),
      ),
    );
  }
}

Future<void> showServerSettingsSheet(BuildContext context) {
  final server = context.read<ServerProvider>();
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => ChangeNotifierProvider<ServerProvider>.value(
      value: server,
      child: const _ServerSettingsSheet(),
    ),
  );
}

class _ServerSettingsSheet extends StatefulWidget {
  const _ServerSettingsSheet();

  @override
  State<_ServerSettingsSheet> createState() => _ServerSettingsSheetState();
}

class _ServerSettingsSheetState extends State<_ServerSettingsSheet> {
  late final TextEditingController _address = TextEditingController(
    text: context.read<ServerProvider>().baseUrl,
  );
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });

    final server = context.read<ServerProvider>();
    final ok = await server.useAddress(_address.text);

    if (!mounted) return;
    setState(() => _saving = false);

    if (ok) {
      Navigator.of(context).pop();
      Toast.success('Connected to ${server.host}');
    } else {
      setState(() => _error =
          'No StockMaster API answered at that address. Check the IP, the '
          'port, and that the server is running.');
    }
  }

  /// One tap back to the deployed API, for a device that is off the office
  /// Wi-Fi or was pointed at a dev machine that has since gone away.
  Future<void> _useHosted() async {
    _address.text = ServerConfig.cloudUrl;
    await _save();
  }

  Future<void> _detect() async {
    FocusScope.of(context).unfocus();
    setState(() => _error = null);

    final server = context.read<ServerProvider>();
    final ok = await server.autoDetect();

    if (!mounted) return;
    if (ok) {
      _address.text = server.baseUrl;
      Navigator.of(context).pop();
      Toast.success('Found the server at ${server.host}');
    } else {
      setState(() => _error =
          'No server found on this network. Enter the address manually.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final server = context.watch<ServerProvider>();
    final scanning = server.status == ServerStatus.scanning;
    final busy = _saving || scanning || server.status == ServerStatus.checking;

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 18),
              decoration: BoxDecoration(
                color: AppColors.borderStrong,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const Text(
            'Server address',
            style: TextStyle(
              color: AppColors.textStrong,
              fontSize: 17,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'The app uses the hosted StockMaster server by default. To work '
            'against a server on this Wi-Fi network instead, enter that '
            'computer’s IP address — run "ipconfig" (Windows) or "ifconfig" '
            '(macOS/Linux) on it to find one.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.5),
          ),
          const SizedBox(height: 18),
          if (server.isPinned)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.surfaceMuted,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border),
              ),
              child: Text(
                'This build was compiled with --dart-define=API_URL, so the '
                'address is fixed at ${server.baseUrl}.',
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 12, height: 1.4),
              ),
            )
          else ...[
            TextField(
              controller: _address,
              enabled: !busy,
              autocorrect: false,
              keyboardType: TextInputType.url,
              style: const TextStyle(fontSize: 14, color: AppColors.textStrong),
              onSubmitted: (_) => busy ? null : _save(),
              decoration: const InputDecoration(
                hintText: '192.168.1.35',
                prefixIcon: Icon(Icons.dns_outlined, size: 18),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Saved as ${ServerConfig.normalize(_address.text)}',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: busy ? null : _useHosted,
                icon: const Icon(Icons.cloud_outlined, size: 15),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primaryDeep,
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                label: Text(
                  'Use hosted server (${ServerConfig.hostOf(ServerConfig.cloudUrl)})',
                  style: const TextStyle(fontSize: 11.5),
                ),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: const TextStyle(
                    color: AppColors.danger, fontSize: 12, height: 1.4),
              ),
            ],
            if (scanning) ...[
              const SizedBox(height: 16),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: server.scanProgress == 0 ? null : server.scanProgress,
                  minHeight: 4,
                  backgroundColor: AppColors.border,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Scanning the local network…',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
              ),
            ],
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: busy ? null : _detect,
                    icon: const Icon(Icons.wifi_find_outlined, size: 16),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.textBody,
                      side: const BorderSide(color: AppColors.borderStrong),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    label: const Text('Auto-detect',
                        style: TextStyle(fontSize: 13)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: busy ? null : _save,
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: _saving
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.2,
                              color: Colors.white,
                            ),
                          )
                        : const Text('Save & connect',
                            style: TextStyle(
                                fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
