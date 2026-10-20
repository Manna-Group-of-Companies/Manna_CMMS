import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'core/api_client.dart';
import 'core/incoming_alerts.dart';
import 'core/push_messages.dart';
import 'core/theme.dart';
import 'core/toast.dart';
import 'data/repository.dart';
import 'router.dart';
import 'state/auth_provider.dart';
import 'state/incoming_watcher.dart';
import 'state/notification_provider.dart';
import 'state/server_provider.dart';
import 'widgets/update_dialog.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Before the first frame, so a push can reach the app the moment it is
  // sent to the background. Silent and instant when Firebase is not set up.
  await PushMessages.start();
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
  late final IncomingWatcher _incoming =
      IncomingWatcher(_api, enabled: widget.apiClient == null);

  @override
  void initState() {
    super.initState();
    // Settle on a reachable API address *before* restoring the session,
    // otherwise `/auth/me` would fire at an address that cannot answer.
    // The update prompt comes last, once the router has left the splash.
    // Sign-out takes the phone off the push list while it can still sign
    // the request.
    _auth.beforeLogout = _incoming.unregisterPush;
    _server
        .start()
        .whenComplete(_auth.initialize)
        .whenComplete(_openLaunchNotification)
        .whenComplete(_checkForUpdate);
  }

  /// A tapped notification opens the breakdown or request it announced. The
  /// router's own guards still apply, so a phone that has since signed out
  /// lands on the login screen instead.
  Future<void> _openLaunchNotification() async {
    if (widget.apiClient != null) return;
    IncomingAlerts.onOpen = (path) => _router.push(path);

    // The app was closed and the notification started it: go there once the
    // session is restored and the splash has given way to the home screen.
    final path = await IncomingAlerts.launchPath();
    if (path == null) return;
    await Future<void>.delayed(const Duration(milliseconds: 300));
    _router.push(path);
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
        // The Maintenance Manager's phone notifications. Idle for every other
        // role. Not lazy: no screen reads it, and a lazy provider is only built
        // when something does - so it never started, and never rang.
        ChangeNotifierProxyProvider<AuthProvider, IncomingWatcher>(
          lazy: false,
          create: (_) => _incoming,
          update: (_, auth, watcher) => watcher!..syncUser(auth.user),
        ),
      ],
      child: MaterialApp.router(
        title: 'CMMS',
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(),
        scaffoldMessengerKey: Toast.messengerKey,
        routerConfig: _router,
      ),
    );
  }
}
