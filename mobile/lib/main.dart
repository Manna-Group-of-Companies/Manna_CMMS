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
    _server.start().whenComplete(_auth.initialize);
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
