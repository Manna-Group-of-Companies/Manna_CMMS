import 'package:geolocator/geolocator.dart';

/// A position, or nothing.
typedef Fix = ({double latitude, double longitude});

/// Where the phone is right now, if it can say within [timeout].
///
/// Best effort, and deliberately so. The field-sales app refuses a punch
/// without a GPS fix, because a rep's punch is also evidence of where they
/// were. A maintenance member punches from inside a steel shed where a fix can
/// take a minute or never come, and refusing the punch there would make the
/// one screen they have unusable. So the coordinates are recorded when the
/// phone can give them and left blank when it cannot — the time, which is the
/// part that matters, comes from the server either way.
///
/// Never throws: a missing plugin (widget tests), location switched off, a
/// refused permission and a timeout all read as "no fix".
Future<Fix?> bestEffortFix({Duration timeout = const Duration(seconds: 10)}) async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) return null;

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      return null;
    }

    final position = await Geolocator.getCurrentPosition(
      locationSettings: LocationSettings(accuracy: LocationAccuracy.high, timeLimit: timeout),
    );
    return (latitude: position.latitude, longitude: position.longitude);
  } catch (_) {
    return null;
  }
}
