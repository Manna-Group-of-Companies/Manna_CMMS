# Attendance and leave for the maintenance team

Brought across from the field-sales app (`SALES_DASHBOARD/app`) on 12 October
2026, for the maintenance team — Sunny, Ramesh and Saji. Same journey, same
vocabulary, same rules; the phone app has an Attendance tab and the server
holds the rules.

| Record | What it is | Who writes it |
| --- | --- | --- |
| `CMMS Attendance Log` | One day's punches | the member, by punching; an approved correction |
| `CMMS Attendance Regularization` | "Please correct my day" | the member asks, the manager decides |
| `CMMS Leave Request` | One day of leave, or half | the member asks, the manager decides; the manager can also record one directly |
| `CMMS Leave Scheme` | When paid leave accrues from, and the balance carried forward | the manager, from the Team tab |

The sales app keeps the same four facts in `Attendance Log`, `Attendance
Regularization`, `Leave Request` and two custom fields on `Sales Person`. The
maintenance team are not sales people, and making them Sales Person records to
share those tables would put three fitters into every sales headcount. So these
are the CMMS's own copies, keyed by the ERPNext `User`.

## Who

| Role in ERPNext | Role in the CMMS | What they get |
| --- | --- | --- |
| `Store Maintenance Member` | Maintenance Member | Attendance, and nothing else: punch in and out, their month, leave |
| `Store Maintenance Manager` | Maintenance Manager | the corrections and leave waiting on a decision, the team, the leave schemes |
| `Store Manager` | Manager | the same as the Maintenance Manager, as the usual fallback |

Who is on the team is the role. Giving somebody `Store Maintenance Member` is
the whole of adding them; there is no second list.

## Setting it up

```bash
cd server
node scripts/syncAttendance.js --dry-run
node scripts/syncAttendance.js --member sunny@mannarubber.com --member ramesh@mannarubber.com
```

The script creates the role, the four doctypes and their permissions, and
gives the role to every `--member`. It does not create ERPNext users: an
account for a real person is a decision for whoever administers ERPNext.
Sunny (`sunny@mannarubber.com`) and Ramesh (`ramesh@mannarubber.com`) already
have accounts. **Saji on the maintenance team does not** — the only Saji in
ERPNext is Saji Kumar, the plant manager, who is a different person. Create
the account in Desk, then run the script again with `--member <that email>`.

Nobody is on the leave scheme until the maintenance manager puts them on it:
Team tab → the pencil beside a name → the month accrual starts from and the
days carried forward. Until then the member's Leave screen says so plainly
rather than showing a zero.

## The rules, and where they live

Every rule is in `server/utils/attendanceRules.js`, tested by
`server/tests/attendanceRules.test.js` (`npm run test:rules`). The phone
mirrors the two window numbers so it does not offer a punch the server will
refuse, and nothing else.

- **Punch-in opens at 05:00; punch-out closes at 21:30.** Outside that, the
  member is pointed at a regularization request instead.
- **The time is the server's.** The phone sends no timestamp with a punch —
  only where it was, when it can tell. The sales app could not do this: its
  reps wrote straight to ERPNext from a phone whose clock they controlled, and
  the Server Script meant to fix that was never installable on that plan.
- **Punching out again replaces the punch-out.** The last one is official and
  the hours are recomputed.
- **Working hours** are measured between the two stamps; a day with a missing
  punch has no hours rather than zero.
- **A correction keeps what it does not change.** Approving a regularization
  that asked only for a punch-out leaves the real punch-in alone. The sales app
  overwrote both.
- **Leave** is applied for today or later; a half day for today before noon;
  one request per day. The manager records earlier days directly, already
  approved.
- **Leave balance** is a running accrual: the balance carried forward plus one
  day for every month since the scheme started, less what was approved. Pending
  days are shown and not deducted. Not being on the scheme is a different
  answer from a zero balance, and every screen keeps it different.

## Where the GPS went

The sales app refuses a punch without a GPS fix, because a rep's punch is also
evidence of where they were. A maintenance member punches from inside a steel
shed. The phone asks for a fix for up to ten seconds and records it when it
comes; a refused permission or no fix never blocks the punch. The time is what
matters, and that comes from the server either way.

## On the phone

- `lib/screens/attendance/attendance_screen.dart` — a member's day: the punch
  card, the month so far, and the way to the calendar and to leave.
- `lib/screens/attendance/attendance_calendar_screen.dart` — the month, one
  colour per day (`dayStatusOf` in `core/attendance_rules.dart` is the rule),
  and the regularization form.
- `lib/screens/leave/*` — the balance and requests, applying, and the manager's
  direct entry.
- `lib/screens/attendance/team_attendance_screen.dart` — the manager's queue
  and the team.
