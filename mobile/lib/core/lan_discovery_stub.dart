/// Web fallback: browsers cannot open raw sockets, so there is nothing to scan.
/// See `lan_discovery_io.dart` for the real implementation.
Future<List<String>> localIPv4s() async => const [];

Future<List<String>> localSubnets({int maxSubnets = 2}) async => const [];

Future<List<String>> discoverLanHosts({
  int port = 5000,
  Duration probeTimeout = const Duration(milliseconds: 400),
  int maxSubnets = 2,
  void Function(double progress)? onProgress,
}) async {
  onProgress?.call(1);
  return const [];
}
