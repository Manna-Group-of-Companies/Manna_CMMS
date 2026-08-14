import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/core/theme.dart';
import 'package:stockmaster/screens/login_screen.dart';
import 'package:stockmaster/state/auth_provider.dart';
import 'package:stockmaster/state/server_provider.dart';

Widget _wrap(Widget child) {
  final api = ApiClient(baseUrl: 'http://localhost:5000/api');
  return MultiProvider(
    providers: [
      Provider<ApiClient>.value(value: api),
      // `enabled: false` keeps discovery (and its real sockets) out of tests.
      ChangeNotifierProvider<ServerProvider>(
        create: (_) => ServerProvider(api, enabled: false)..start(),
      ),
      ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider(api)),
    ],
    child: MaterialApp(theme: buildAppTheme(), home: child),
  );
}

void main() {
  testWidgets('renders the sign-in form', (tester) async {
    await tester.pumpWidget(_wrap(const LoginScreen()));

    expect(find.text('StockMaster'), findsOneWidget);
    expect(find.text('Sign In to Portal'), findsOneWidget);
  });

  testWidgets('rejects an empty submission before calling the API', (tester) async {
    await tester.pumpWidget(_wrap(const LoginScreen()));

    await tester.ensureVisible(find.text('Sign In'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign In'));
    await tester.pump();

    expect(find.text('Please fill in all fields'), findsOneWidget);
  });
}
