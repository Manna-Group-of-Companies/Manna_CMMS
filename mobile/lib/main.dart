import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'core/api_client.dart';
import 'core/theme.dart';
import 'core/toast.dart';
import 'data/repository.dart';
import 'router.dart';
import 'state/auth_provider.dart';
import 'state/notification_provider.dart';
import 'state/server_provider.dart';
import 'widgets/update_dialog.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const StockMasterApp());
}

class StockMasterApp extends StatefulWidget {
  const StockMasterApp({super.key, this.apiClient});

  /// Injected by tests; production builds create their own client.
  final ApiClient? apiClient;

  @override
  State<StockMasterApp> createState() => _StockMasterAppState();
}

class _StockMasterAppState extends State<StockMasterApp> {
  late final ApiClient _api = widget.apiClient ?? ApiClient();
  late final StockRepository _repository = StockRepository(_api);
  late final ServerProvider _server =
      ServerProvider(_api, enabled: widget.apiClient == null);
  late final AuthProvider _auth = AuthProvider(_api);
  late final GoRouter _router = buildRouter(_auth);

  @override
  void initState() {
    super.initState();
    // Settle on a reachable API address *before* restoring the session,
    // otherwise `/auth/me` would fire at an address that cannot answer.
    // The update prompt comes last, once the router has left the splash.
    _server.start().whenComplete(_auth.initialize).whenComplete(_checkForUpdate);
  }

  /// The once-per-launch check against the hosted `version.json`.
  ///
  /// Failure is silent by design — a tablet with no signal, or a build with no
  /// update URL configured, simply carries on with the app it has.
  Future<void> _checkForUpdate() async {
    // Tests inject a client and must not reach the network or the platform
    // channels, the same rule ServerProvider follows.
    if (widget.apiClient != null) return;

    // A dialog raised over the splash is torn down with it when the redirect
    // swaps in the login or home screen, so wait for that to have happened.
    await Future<void>.delayed(const Duration(milliseconds: 600));
    final context = rootNavigatorKey.currentContext;
    if (context == null || !context.mounted) return;

    await checkForUpdateOnStartup(context);
  }

  @override
  void dispose() {
    _api.dispose();
    _server.dispose();
    _auth.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: _api),
        Provider<StockRepository>.value(value: _repository),
        ChangeNotifierProvider<ServerProvider>.value(value: _server),
        ChangeNotifierProvider<AuthProvider>.value(value: _auth),
        ChangeNotifierProxyProvider<AuthProvider, NotificationProvider>(
          create: (_) => NotificationProvider(_repository),
          update: (_, auth, notifications) => notifications!..syncUser(auth.user),
        ),
      ],
      child: MaterialApp.router(
        title: 'StockMaster',
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(),
        scaffoldMessengerKey: Toast.messengerKey,
        routerConfig: _router,
      ),
    );
  }
}
