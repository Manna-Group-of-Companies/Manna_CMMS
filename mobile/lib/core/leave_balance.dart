// How much paid leave a member actually has, as the server works it out.
//
// The field-sales app computed this on the phone (its `core/leave_balance.dart`)
// because nothing else could. Here the arithmetic lives once, in
// `server/utils/attendanceRules.js`, and this is only the shape the phone
// draws — the running accrual is a rule about money, and two copies of it
// would eventually pay two different figures for the same month.
//
// What the figures mean, so the screens say the right thing:
//
//  - A balance carried forward from before the scheme started, plus one day a
//    month since, minus what has been taken.
//  - NOT EVERYONE IS ON IT. `onScheme` being false is not an opening balance
//    of zero: somebody carrying nothing forward still accrues a day a month,
//    while somebody off the scheme accrues nothing and must not be told their
//    leave is unpaid. Every screen says "no leave scheme", never "0 days left".

class LeaveBalance {
  const LeaveBalance({
    required this.onScheme,
    required this.opening,
    required this.accrued,
    required this.taken,
    required this.pending,
  });

  /// False when the member is not on the leave scheme at all. Everything
  /// below is zero in that case and means nothing.
  final bool onScheme;

  /// Carried forward from before accrual started, net of anything taken then.
  final double opening;

  /// Days credited since accrual began, including the current month.
  final double accrued;

  /// Approved leave since accrual began.
  final double taken;

  /// Applied for and not yet decided. Not deducted — a request that is
  /// refused was never leave — but shown, so nobody applies twice for days
  /// they have already asked for.
  final double pending;

  static const LeaveBalance none =
      LeaveBalance(onScheme: false, opening: 0, accrued: 0, taken: 0, pending: 0);

  /// Everything earned so far.
  double get entitlement => opening + accrued;

  /// What is left to take. Never below zero on screen — an over-drawn balance
  /// is real, but "-2 days remaining" invites working out what can still be
  /// taken, and the answer is nothing.
  double get remaining {
    final left = entitlement - taken;
    return left < 0 ? 0 : left;
  }

  /// True when more has been taken than earned. Shown plainly rather than
  /// hidden behind the clamp above: it means days already granted were unpaid.
  bool get overdrawn => entitlement - taken < -0.0001;

  static double _num(dynamic v) {
    if (v is num) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0;
    return 0;
  }

  factory LeaveBalance.fromJson(Map<String, dynamic>? json) {
    if (json == null || json['onScheme'] != true) return none;
    return LeaveBalance(
      onScheme: true,
      opening: _num(json['opening']),
      accrued: _num(json['accrued']),
      taken: _num(json['taken']),
      pending: _num(json['pending']),
    );
  }

  /// "1.5" or "5" — a day count without a pointless ".0".
  static String days(double d) =>
      d == d.roundToDouble() ? d.toStringAsFixed(0) : d.toStringAsFixed(1);
}
