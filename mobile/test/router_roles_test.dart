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
      'Maintenance Member': false,
    };
    const expectRequests = {
      'Manager': true,
      'Maintenance Manager': true,
      'Higher Management': false,
      'Production Manager': true,
      'Supervisor': true,
      'VP Operations': false,
      'Maintenance Member': false,
    };
    const expectAttendance = {
      'Manager': false,
      'Maintenance Manager': false,
      'Higher Management': false,
      'Production Manager': false,
      'Supervisor': false,
      'VP Operations': false,
      'Maintenance Member': true,
    };
    expectBreakdowns.forEach((role, want) => expect(canSeeBreakdowns(role), want, reason: role));
    expectRequests.forEach((role, want) => expect(canSeeRequests(role), want, reason: role));
    expectAttendance.forEach((role, want) => expect(canSeeAttendance(role), want, reason: role));
  });

  test('VP Operations - on neither screen - goes to no-access, not the store', () {
    expect(homePathFor('VP Operations'), noAccessHome);
  });

  test('Higher Management sees Breakdowns only, so that is home', () {
    expect(homePathFor('Higher Management'), breakdownsHome);
  });

  test('a Maintenance Member lands on Attendance, which is their whole app', () {
    expect(homePathFor('Maintenance Member'), attendanceHome);
    expect(worksInMaintenance('Maintenance Member'), isTrue);
    expect(isMaintenanceMember('Maintenance Member'), isTrue);
    expect(canApproveAttendance('Maintenance Member'), isFalse,
        reason: 'a member asks; they do not decide their own request');
  });

  test('the managers phones are Breakdowns and Requests only', () {
    for (final role in ['Maintenance Manager', 'Manager']) {
      expect(canSeeAttendance(role), isFalse, reason: role);
      expect(isMaintenanceMember(role), isFalse, reason: role);
      expect(homePathFor(role), breakdownsHome, reason: role);
    }
    for (final role in ['Supervisor', 'Production Manager', 'Higher Management', 'VP Operations']) {
      expect(canApproveAttendance(role), isFalse, reason: role);
    }
  });

  test('the Maintenance Manager only looks on the phone; the steps are done on the computer', () {
    expect(isViewOnly('Maintenance Manager'), isTrue);
    for (final role in ['Manager', 'Production Manager', 'Supervisor', 'Higher Management']) {
      expect(isViewOnly(role), isFalse, reason: role);
    }
  });
}
