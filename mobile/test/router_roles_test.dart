import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/router.dart';

void main() {
  test('manager@mannarubber.com (Production Manager) lands on Breakdowns, not the store', () {
    expect(homePathFor('Production Manager'), breakdownsHome);
  });

  test('every role the server matrix names is served by the app', () {
    const expectBreakdowns = {
      'Manager': true,
      'Maintenance Manager': true,
      'Higher Management': true,
      'Production Manager': true,
      'Supervisor': true,
      'VP Operations': false,
    };
    const expectRequests = {
      'Manager': true,
      'Maintenance Manager': true,
      'Higher Management': false,
      'Production Manager': true,
      'Supervisor': true,
      'VP Operations': false,
    };
    expectBreakdowns.forEach((role, want) => expect(canSeeBreakdowns(role), want, reason: role));
    expectRequests.forEach((role, want) => expect(canSeeRequests(role), want, reason: role));
  });

  test('VP Operations - on neither screen - goes to no-access, not the store', () {
    expect(homePathFor('VP Operations'), noAccessHome);
  });

  test('Higher Management sees Breakdowns only, so that is home', () {
    expect(homePathFor('Higher Management'), breakdownsHome);
  });
}
