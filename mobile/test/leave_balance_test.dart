// The leave balance card draws what the server works out.
//
// The arithmetic itself - the running accrual - lives on the server and is
// pinned to HR's sheet in server/tests/attendanceRules.test.js. What the phone
// owns is the derived figures and the one distinction every screen has to
// keep: "not on the scheme" is a different card from "0 days left".

import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/core/leave_balance.dart';

void main() {
  test('a member on the scheme has every figure the card shows', () {
    final b = LeaveBalance.fromJson({
      'onScheme': true,
      'opening': 22,
      'accrued': 5,
      'taken': 4,
      'pending': 2,
    });
    expect(b.onScheme, isTrue);
    expect(b.opening, 22);
    expect(b.accrued, 5);
    expect(b.entitlement, 27);
    expect(b.taken, 4);
    expect(b.pending, 2);
    expect(b.remaining, 23);
    expect(b.overdrawn, isFalse);
  });

  test('a member NOT on the scheme is a different card, not a zero one', () {
    // Drawing 0 for somebody never enrolled reads as "you have used them
    // all", which would have them treat every day as unpaid.
    for (final json in [null, <String, dynamic>{}, {'onScheme': false, 'opening': 3}]) {
      final b = LeaveBalance.fromJson(json);
      expect(b.onScheme, isFalse, reason: '$json');
      expect(b.entitlement, 0);
    }
  });

  test('an overdrawn member shows the excess, and it is positive', () {
    final b = LeaveBalance.fromJson({'onScheme': true, 'opening': 0, 'accrued': 5, 'taken': 8, 'pending': 0});
    expect(b.overdrawn, isTrue);
    expect(b.remaining, 0, reason: 'never reads negative');
    expect(b.taken - b.entitlement, 3);
  });

  test('taking exactly the entitlement is not overdrawn', () {
    final b = LeaveBalance.fromJson({'onScheme': true, 'opening': 0, 'accrued': 5, 'taken': 5, 'pending': 0});
    expect(b.remaining, 0);
    expect(b.overdrawn, isFalse);
  });

  test('pending is shown but not deducted', () {
    final b = LeaveBalance.fromJson({'onScheme': true, 'opening': 0, 'accrued': 5, 'taken': 1, 'pending': 2});
    expect(b.pending, 2);
    expect(b.remaining, 4);
  });

  test('figures arrive as numbers or strings and read the same', () {
    final b = LeaveBalance.fromJson({'onScheme': true, 'opening': '17.5', 'accrued': 5, 'taken': '0.5', 'pending': 0});
    expect(b.entitlement, 22.5);
    expect(b.remaining, 22);
  });

  test('day counts drop a pointless .0', () {
    expect(LeaveBalance.days(5), '5');
    expect(LeaveBalance.days(22.5), '22.5');
    expect(LeaveBalance.days(0.5), '0.5');
  });
}
