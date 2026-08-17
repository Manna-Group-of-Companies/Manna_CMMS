import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/core/update_config.dart';
import 'package:stockmaster/core/update_service.dart';

void main() {
  group('AppVersion', () {
    test('orders the release train 1.0.1 -> 1.0.2 -> 1.0.3 -> 1.0.4', () {
      final train = ['1.0.1', '1.0.2', '1.0.3', '1.0.4'].map(AppVersion.parse);
      final sorted = train.toList()..shuffle();
      sorted.sort();
      expect(sorted.map((v) => v.toString()).toList(),
          ['1.0.1', '1.0.2', '1.0.3', '1.0.4']);
    });

    test('compares segments numerically, not as text', () {
      // The trap a plain string comparison falls into.
      expect(AppVersion.parse('1.0.10') > AppVersion.parse('1.0.9'), isTrue);
      expect(AppVersion.parse('1.10.0') > AppVersion.parse('1.9.9'), isTrue);
      expect(AppVersion.parse('2.0.0') > AppVersion.parse('1.99.99'), isTrue);
    });

    test('pads missing segments with zero', () {
      expect(AppVersion.parse('1.1'), AppVersion.parse('1.1.0'));
      expect(AppVersion.parse('1.1.1') > AppVersion.parse('1.1'), isTrue);
    });

    test('falls back to the build number only when the version ties', () {
      expect(
        AppVersion.parse('1.0.0', build: 2) > AppVersion.parse('1.0.0', build: 1),
        isTrue,
      );
      // A newer version wins even with a lower build number.
      expect(
        AppVersion.parse('1.0.1', build: 1) > AppVersion.parse('1.0.0', build: 9),
        isTrue,
      );
    });

    test('tolerates the shapes people actually type', () {
      expect(AppVersion.parse('v1.0.2').toString(), '1.0.2');
      expect(AppVersion.parse(' 1.0.2 ').toString(), '1.0.2');
      expect(AppVersion.parse('1.0.2-hotfix').toString(), '1.0.2');
      expect(AppVersion.parse('1.0.2+7').build, 7);
      // Nonsense sorts below everything rather than blowing up mid-launch.
      expect(AppVersion.parse('') < AppVersion.parse('1.0.0'), isTrue);
      expect(AppVersion.parse('not a version') < AppVersion.parse('0.0.1'), isTrue);
    });
  });

  group('UpdateManifest', () {
    Map<String, dynamic> manifest([Map<String, dynamic> extra = const {}]) => {
          'latestVersion': '1.0.2',
          'apkUrl': 'downloads/stockmaster-1.0.2.apk',
          ...extra,
        };

    test('reads the documented shape', () {
      final parsed = UpdateManifest.fromJson(manifest({
        'versionCode': 3,
        'releaseNotes': 'Faster catalog',
        'fileSize': 24117248,
        'sha256': 'ABC123',
        'mandatory': true,
      }));

      expect(parsed.version, '1.0.2');
      expect(parsed.versionCode, 3);
      expect(parsed.releaseNotes, 'Faster catalog');
      expect(parsed.fileSize, 24117248);
      expect(parsed.sha256, 'abc123'); // normalised for comparison
      expect(parsed.mandatory, isTrue);
      expect(parsed.fileName, 'stockmaster-1.0.2.apk');
    });

    test('leaves an absolute apkUrl alone and resolves a relative one', () {
      expect(
        UpdateManifest.fromJson(manifest({'apkUrl': 'https://cdn.test/a.apk'}))
            .apkUrl
            .toString(),
        'https://cdn.test/a.apk',
      );
      // Asserted against the configured base rather than a literal path, so
      // moving the manifest to another host does not break the test.
      expect(
        UpdateManifest.fromJson(manifest()).apkUrl.toString(),
        '${UpdateConfig.baseUrl}/downloads/stockmaster-1.0.2.apk',
      );
    });

    test('accepts release notes as a list of bullet points', () {
      final parsed = UpdateManifest.fromJson(
        manifest({'releaseNotes': ['Faster catalog', 'Fixed returns filter']}),
      );
      expect(parsed.releaseNotes, '• Faster catalog\n• Fixed returns filter');
    });

    test('rejects a manifest missing the fields the updater needs', () {
      expect(
        () => UpdateManifest.fromJson({'latestVersion': '1.0.2'}),
        throwsA(isA<UpdateException>()),
      );
      expect(
        () => UpdateManifest.fromJson({'apkUrl': 'a.apk'}),
        throwsA(isA<UpdateException>()),
      );
    });
  });

  group('UpdateCheck', () {
    UpdateCheck check(String installed, Map<String, dynamic> latest) => UpdateCheck(
          installedVersion: installed,
          installedBuild: 1,
          latest: UpdateManifest.fromJson({'apkUrl': 'a.apk', ...latest}),
        );

    test('offers an update only when the hosted version is newer', () {
      expect(check('1.0.1', {'latestVersion': '1.0.2'}).updateAvailable, isTrue);
      expect(check('1.0.2', {'latestVersion': '1.0.2'}).updateAvailable, isFalse);
      // A rollback on the server must never downgrade a tablet.
      expect(check('1.0.3', {'latestVersion': '1.0.2'}).updateAvailable, isFalse);
    });

    test('has nothing to offer when the manifest could not be read', () {
      const offline = UpdateCheck(installedVersion: '1.0.1', installedBuild: 1);
      expect(offline.updateAvailable, isFalse);
      expect(offline.isMandatory, isFalse);
    });

    test('forces the update when flagged, or when below minSupportedVersion', () {
      expect(
        check('1.0.1', {'latestVersion': '1.0.2', 'mandatory': true}).isMandatory,
        isTrue,
      );
      expect(
        check('1.0.0', {'latestVersion': '1.0.2', 'minSupportedVersion': '1.0.1'})
            .isMandatory,
        isTrue,
      );
      expect(
        check('1.0.1', {'latestVersion': '1.0.2', 'minSupportedVersion': '1.0.1'})
            .isMandatory,
        isFalse,
      );
    });
  });

  group('formatBytes', () {
    test('reads the way a download progress line should', () {
      expect(formatBytes(0), '0 MB');
      expect(formatBytes(2048), '2 KB');
      expect(formatBytes(24117248), '23.0 MB');
    });
  });
}
