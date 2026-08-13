import 'dart:async';
import 'dart:io';

/// Every non-loopback IPv4 address this device holds.
Future<List<String>> localIPv4s() async {
  try {
    final interfaces = await NetworkInterface.list(
      includeLoopback: false,
      type: InternetAddressType.IPv4,
    );
    return [
      for (final interface in interfaces)
        for (final address in interface.addresses) address.address,
    ];
  } catch (_) {
    // Some platforms refuse interface enumeration; discovery just yields nothing.
    return const [];
  }
}

/// RFC 1918 ranges — the only ones worth sweeping for a dev server.
bool _isPrivateV4(List<String> octets) {
  final a = int.tryParse(octets[0]);
  final b = int.tryParse(octets[1]);
  if (a == null || b == null) return false;
  if (a == 10) return true;
  if (a == 172 && b >= 16 && b <= 31) return true;
  if (a == 192 && b == 168) return true;
  return false;
}

/// The /24 prefixes this device sits on, e.g. `192.168.1`.
Future<List<String>> localSubnets({int maxSubnets = 2}) async {
  final subnets = <String>{};
  for (final ip in await localIPv4s()) {
    final octets = ip.split('.');
    if (octets.length != 4 || !_isPrivateV4(octets)) continue;
    subnets.add('${octets[0]}.${octets[1]}.${octets[2]}');
    if (subnets.length >= maxSubnets) break;
  }
  return subnets.toList();
}

Future<bool> _portOpen(String host, int port, Duration timeout) async {
  Socket? socket;
  try {
    socket = await Socket.connect(host, port, timeout: timeout);
    return true;
  } catch (_) {
    return false;
  } finally {
    socket?.destroy();
  }
}

/// Sweeps the device's own /24 subnet(s) for hosts listening on [port].
///
/// A plain TCP connect is used rather than an HTTP request because it is an
/// order of magnitude cheaper; callers are expected to confirm each hit is
/// really the StockMaster API (see `ServerConfig.ping`).
///
/// Hosts are probed in batches so a /24 sweep stays a couple of seconds rather
/// than opening 254 sockets at once.
Future<List<String>> discoverLanHosts({
  int port = 5000,
  Duration probeTimeout = const Duration(milliseconds: 400),
  int maxSubnets = 2,
  void Function(double progress)? onProgress,
}) async {
  final subnets = await localSubnets(maxSubnets: maxSubnets);
  if (subnets.isEmpty) {
    onProgress?.call(1);
    return const [];
  }

  const batchSize = 48;
  final hits = <String>[];
  final total = subnets.length * 254;
  var probed = 0;

  for (final subnet in subnets) {
    final hosts = [for (var i = 1; i <= 254; i++) '$subnet.$i'];
    for (var start = 0; start < hosts.length; start += batchSize) {
      final batch = hosts.sublist(
        start,
        (start + batchSize).clamp(0, hosts.length),
      );
      final results = await Future.wait(
        batch.map((host) => _portOpen(host, port, probeTimeout)),
      );
      for (var i = 0; i < batch.length; i++) {
        if (results[i]) hits.add(batch[i]);
      }
      probed += batch.length;
      onProgress?.call(probed / total);
    }
  }

  onProgress?.call(1);
  return hits;
}
