// Renders every screen of the app to a PNG, against sample data, for the
// screen gallery page. Not part of the suite: run it on its own with
//   flutter test test/gallery --update-goldens
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmaster/core/api_client.dart';
import 'package:stockmaster/main.dart';

const _fonts = r'C:\flutter_windows_3.44.6-stable\flutter\bin\cache\artifacts\material_fonts';

Future<void> _loadFonts() async {
  Future<ByteData> read(String name) async =>
      ByteData.view(Uint8List.fromList(await File('$_fonts\\$name').readAsBytes()).buffer);

  // 'FlutterTest' is the test renderer's default for a style naming no
  // family - the app bar titles - where a phone would use Roboto.
  for (final family in ['Roboto', 'FlutterTest', 'Ahem', 'sans-serif', 'packages/flutter_test/Ahem']) {
    final roboto = FontLoader(family);
    for (final f in [
      'roboto-regular.ttf',
      'roboto-medium.ttf',
      'roboto-bold.ttf',
      'roboto-black.ttf',
      'roboto-light.ttf',
    ]) {
      roboto.addFont(read(f));
    }
    await roboto.load();
  }
  // The codes are set in 'monospace'; Roboto Condensed stands in for it here.
  for (final family in ['monospace', 'Courier New']) {
    final mono = FontLoader(family)
      ..addFont(read('robotocondensed-regular.ttf'))
      ..addFont(read('robotocondensed-bold.ttf'));
    await mono.load();
  }
  final icons = FontLoader('MaterialIcons')..addFont(read('materialicons-regular.otf'));
  await icons.load();
}

Map<String, dynamic> _bd(String id, String machine, String state, String priority, String day,
        double hours, String what, {String plant = 'Plant 2 - Extruder Section'}) =>
    {
      'id': id,
      'machine': 'MC-${id.substring(id.length - 3)}',
      'machineName': machine,
      'plant': plant,
      'state': state,
      'waitingOn': state == 'Reported' ? 'Maintenance' : '',
      'priority': priority,
      'whatHappened': what,
      'reportedBy': 'Biju T Den',
      'stoppedAt': '2026-10-$day 09:45:00',
      'stoppedForHours': hours,
      'nextAction': state == 'Reported' ? 'Attend' : '',
      'failureMode': '',
      'actionsPerformed': '',
      'rootCause': '',
      'repeatFailure': false,
    };

Map<String, dynamic> _mr(String id, String title, String state, String priority, String day,
        String needed, {String machine = ''}) =>
    {
      'id': id,
      'title': title,
      'machine': machine.isEmpty ? '' : 'MC-001',
      'machineName': machine,
      'plant': 'Plant 1 - Machine Section',
      'state': state,
      'waitingOn': '',
      'priority': priority,
      'whatIsNeeded': needed,
      'whyNeeded': '',
      'requestedBy': 'Biju T Den',
      'requestedAt': '2026-10-$day 10:24:00',
      'ageDays': 22 - int.parse(day),
      'nextAction': state == 'Requested' ? 'Attend' : '',
      'workDone': '',
    };

final _breakdowns = [
  _bd('BD-2026-00314', 'Extruder line', 'Under Repair', 'Low', '18', 3.5,
      'Machine not running properly. Check heating and motor.'),
  _bd('BD-2026-00277', 'Banbury', 'Reported', 'High', '16', 6, 'Rotor seal leaking, mixer stopped.'),
  _bd('BD-2026-00270', 'Compressor 1', 'Attended', 'Medium', '10', 2,
      'Pressure drops below 6 bar under load.'),
  _bd('BD-2026-00266', 'Hydraulic Press', 'Under Repair', 'Medium', '08', 4,
      'Ram not returning after the cycle.'),
  _bd('BD-2026-00260', 'Generator Set', 'Closed', 'Low', '05', 0, 'Battery would not crank.'),
  _bd('BD-2026-00258', 'Air Dryer', 'Repaired', 'Medium', '03', 0, 'Dew point alarm.'),
];

final _requests = [
  _mr('MR-2026-00318', 'v groove wheel 2 inch-4no', 'Requested', 'High', '20',
      'Need 4 nos of v groove wheels for conveyor line 2 inch size.'),
  _mr('MR-2026-00316', 'Table fabrication', 'Requested', 'High', '20',
      'Fabricate MS table with 6ft x 3ft size for packing section.'),
  _mr('MR-2026-00316', 'Crumb Line Installation', 'Attended', 'Medium', '19',
      'Install the new crumb line beside the mill.'),
  _mr('MR-2026-00315', 'Shot Blasting Machine Installation', 'In Progress', 'Medium', '19',
      'Foundation and power for the shot blaster.'),
  _mr('MR-2026-00310', 'Extruder line guard', 'Completed', 'Low', '16',
      'Fix a guard over the extruder drive belt.', machine: 'Extruder line'),
];

final _purchases = [
  for (final (i, d, t, p, a, s) in [
    ('LVP-0018', 'Table fabrication material', 'Purchase Request', 'High', 'Pending', 'Not Ordered'),
    ('LVP-0016', 'Crumb Line Installation bolts', 'Purchase Request', 'Medium', 'Approved', 'Ordered'),
    ('LVP-0015', 'Shot blasting nozzle repair', 'Repair Request', 'Medium', 'Approved', 'Ordered'),
    ('LVP-0014', 'Extruder line heater band', 'Purchase Request', 'Low', 'Approved', 'Received'),
    ('LVP-0012', 'Banbury door seal', 'Repair Request', 'High', 'Pending', 'Not Ordered'),
  ])
    {
      'id': i,
      'date': '2026-10-20',
      'type': t,
      'company': 'Manna Rubber',
      'raisedByName': 'Biju T Den',
      'description': d,
      'purpose': 'Production',
      'priority': p,
      'approvalStatus': a,
      'purchaseStatus': s,
      'done': s == 'Received',
      'files': 0,
      'editable': <String>[],
      'deletable': false,
      'images': <Object>[],
    },
];

Map<String, dynamic> _stage(String from, String to, String title) => {
      'from': from,
      'to': to,
      'title': title,
      'blurb': '',
      'fields': <String>[],
      'required': <String>[],
      'allowedRoles': ['Maintenance Manager'],
      'labels': <String, String>{},
    };

ApiClient _client() {
  final mock = MockClient((request) async {
    final path = request.url.path.replaceFirst('/api', '');
    http.Response ok(Object body) => http.Response(jsonEncode(body), 200,
        headers: {'content-type': 'application/json; charset=utf-8'});

    if (path == '/session/login') {
      return ok({
        'email': 'maintenance@mannarubber.com',
        'name': 'Biju T Den',
        'role': 'Manager',
        'erpRoles': <String>[],
        'token': 'gallery',
      });
    }
    if (path == '/notifications') return ok(<Object>[]);
    if (path == '/breakdowns') return ok(_breakdowns);
    if (path == '/breakdowns/stages') return ok({'Attend': _stage('Reported', 'Attended', 'Attend')});
    if (path == '/breakdowns/machines') {
      return ok([
        for (final b in _breakdowns)
          {'code': b['machine'], 'name': b['machineName'], 'plant': 'Plant 2', 'status': 'Active'},
      ]);
    }
    if (path == '/breakdowns/plants') return ok([{'name': 'Plant 1', 'code': 'P1'}]);
    if (path.startsWith('/breakdowns/')) {
      return ok(_breakdowns.firstWhere((b) => b['id'] == path.split('/').last));
    }
    if (path == '/maintenance-requests') return ok(_requests);
    if (path == '/maintenance-requests/stages') {
      return ok({'Attend': _stage('Requested', 'Attended', 'Attend')});
    }
    if (path.startsWith('/maintenance-requests/')) {
      return ok(_requests.firstWhere((r) => r['id'] == path.split('/').last));
    }
    if (path == '/low-value-purchases') return ok(_purchases);
    return http.Response(jsonEncode({'message': 'none'}), 404);
  });
  return ApiClient(baseUrl: 'http://localhost:5000/api', httpClient: mock);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(_loadFonts);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('gallery', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    final app = find.byType(MaterialApp);
    Future<void> shot(String name) async {
      await tester.pumpAndSettle();
      await expectLater(app, matchesGoldenFile('out/$name.png'));
    }

    BuildContext ctx() => tester.element(find.byType(Scaffold).last);
    Future<void> go(String path) async {
      GoRouter.of(ctx()).go(path);
      await tester.pumpAndSettle();
    }

    await tester.pumpWidget(StockMasterApp(apiClient: _client()));
    // The first frame, before the session check has finished.
    await expectLater(app, matchesGoldenFile('out/01_splash.png'));

    await shot('02_login');

    await tester.enterText(
        find.widgetWithText(TextFormField, 'you@mannarubber.com'), 'maintenance@mannarubber.com');
    await tester.enterText(find.widgetWithText(TextFormField, 'Your ERPNext password'), 'x');
    await tester.tap(find.text('Sign In'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 5));
    await shot('03_dashboard');

    await tester.tap(find.byTooltip('Menu').first);
    await shot('04_drawer');
    Navigator.of(ctx()).pop();
    await tester.pumpAndSettle();

    await go('/maintenance/breakdowns');
    await shot('05_breakdowns');
    GoRouter.of(ctx()).push('/maintenance/breakdowns/BD-2026-00314');
    await shot('06_breakdown_detail');

    await go('/maintenance/requests');
    await shot('07_requests');
    GoRouter.of(ctx()).push('/maintenance/requests/MR-2026-00318');
    await shot('08_request_detail');

    await go('/maintenance/requests');
    await tester.tap(find.text('New request'));
    await shot('09_new_request');
    Navigator.of(ctx()).pop();
    await tester.pumpAndSettle();

    await go('/maintenance/breakdowns');
    await tester.tap(find.text('New breakdown'));
    await shot('10_report_breakdown');
    Navigator.of(ctx()).pop();
    await tester.pumpAndSettle();

    await go('/purchases/low-value');
    await shot('11_miscellaneous');

    await go('/maintenance/settings');
    await shot('12_profile');
  });
}
