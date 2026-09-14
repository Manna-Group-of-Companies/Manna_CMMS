# Splitting planned work out of breakdowns

Three records now, where there was one.

| Record | What it is | Journey |
| --- | --- | --- |
| `CMMS Breakdown` | A machine has stopped | Reported → Under Repair → Repaired → Closed |
| `CMMS Maintenance Request` | Everything else the plant asks for | Requested → In Progress → Completed → Closed |
| `CMMS Checklist` | What gets inspected, and how often | no workflow — it is master data |

## Why they are separate

A fabrication job logged as a breakdown was making both records worse.

It hurt the reliability figures first. MTBF, availability and "how long before
anybody started" are only meaningful over *unplanned* stoppages. A guard being
welded counted as a failure of the machine it was welded to, and dragged every
number attached to it.

It hurt the planned job second. The breakdown record asks for a failure mode, a
root cause and a prevention action, because a breakdown that closes without them
is one that will be reported again. A planned job has none of those. People
wrote "n/a" to get past the form, and an "n/a" recorded as a root cause is worse
than a blank — it looks like an answer.

So a maintenance request has a shorter journey and asks nothing it cannot know.
The only thing it asks for that a breakdown does not is what the job consumed:
**materials** and **labour with hours**, both required at completion, because on
a fabrication job the material is most of the cost and nowhere else records it.

**Closing belongs to the requester.** Not to a role — to the one person who
raised it. A workflow cannot express that, so it is checked against the signed-in
user in `maintenanceRequestStages.js` (`requesterOnly`). It is the difference
between a queue and a to-do list: the person who asked for the work is the only
one who can say it is what they wanted. `Close as Manager` exists for the case
where that person has left, and records plainly that somebody else signed it off.

## Three other changes to the breakdown record

**"Running Again At" is now "Hand Over Time."** Those are two different moments
and only one of them ends the stoppage — a machine can be mechanically finished
and still waiting on a trial run, a mould change or an operator. Downtime is
measured to the hand-over because that is when production got its machine back.
The fieldname is still `completed_at`; renaming it would orphan every breakdown
already recorded. Only the label moved, via a Property Setter.

**Repeat failures.** `repeat_failure` and `repeat_of`, asked at closing and
nowhere else. At the moment a machine stops nobody has its history in front of
them; at closing they do, and the closing form lists the machine's earlier
failures so the question is answered by looking rather than by remembering.

Not required, deliberately. A forced answer gets a tick from whoever wanted the
form closed, and a false repeat is worse than a missing one — the report
highlights on it. It counts only what a person judged to be a recurrence, never
a guess made by matching text, so it will undercount while the habit forms. That
is the right way for this number to be wrong.

The breakdown report gains a **Repeat failures** section above the machine
table. Everything else in that report describes how bad the period was; this one
names the problems that were not solved the last time they were repaired.

**Prevention actions per machine.** Every prevention action a machine has ever
had, on its page in Asset Management, with a tick box. They already existed —
one per closed breakdown — but each lived a click deep inside an individual
breakdown, which is the same as not existing. An action nobody can find is an
action nobody chases.

Read straight from the child table in one query (`listChildRows`), because doing
it by reading each breakdown whole would cost forty document fetches on a machine
with a year of history, and a page that slow does not get opened. There is a
fallback to whole documents, bounded to fifteen, for Frappe builds that refuse
the child-table query.

## The work sheet

`tools/build_log_sheet.py` now writes two blank pads instead of one:

```
data/log-sheet/Maintenance-Log-Sheet.html       a breakdown
data/log-sheet/Maintenance-Request-Sheet.html   planned work
```

Same layout, three real differences. The reference box asks for an MR number
rather than a BD number, because writing the wrong one at the top is how a
signed sheet goes into the wrong file. The material table has a **unit** column,
because a fabrication job consumes angle iron by the metre and "4" with no unit
against it is an entry nobody can cost afterwards. And the verification wording
differs, because the two are attesting to different things — that the breakdown
procedure was followed, against that the work and the materials are as recorded.

Completing a request in the application also produces a filled copy of the same
sheet, from the **Work sheet** button on the request. The blank pad is what is
carried to the job; the filled one is the record copy.

## Preventive maintenance checklists

One checklist per machine per frequency: Daily, Weekly, Monthly, Quarterly,
Half-Yearly, Yearly.

This is a **template**, not a record of an inspection. It is the sheet that gets
printed, carried to the machine and filled in with a pen. A screen demanding
every daily check be ticked on a tablet next to a running mill would be ignored
within a week, and the checklist would go back to being a Word file on somebody's
laptop.

So the system owns the *content* — the points, their order, who may add one,
which revision is current — and the paper owns the *event*. That split is what
keeps a checklist current: adding a point is a two-second job, and the next print
carries it.

Each point has three columns: what to check, how to tell, and what counts as
right. "Check the belt" gets a tick from anybody who saw a belt. "Belt tension —
press mid-span by hand — 10 to 15 mm deflection" gets a tick from somebody who
measured, and a blank from somebody who did not know how, which is itself worth
knowing.

Two printed layouts, chosen by frequency and overridable:

- **round** — a column per visit (31 for daily, 12 for monthly). A daily list has
  to be this. A single-visit sheet for a daily round means 31 printouts a month,
  and a plant that has to print 31 sheets prints none.
- **single visit** — room per point for a reading and a remark. What a yearly
  overhaul list needs, where the answer is a measurement.

Print, or Save as PDF from the same dialog. No PDF library on the server: the
browser already produces both.

The **Coverage** tab is the one that changes anything. A list of the checklists
that exist can only say what is there; the coverage grid shows the empty cells,
which is the actual question behind "a checklist for every machine". Machines
with A-criticality and no checklist at all are counted separately and
highlighted, because that is the only line on the screen anybody should act on
today.

## Deploying

Order matters — a Link or Table pointing at a doctype that does not exist yet is
refused on insert.

```bash
cd server

# 1. repeat-failure fields, the output-lost fields, and the Hand Over Time
#    relabel. Custom Field and Property Setter, because syncMaintenance.js never
#    overwrites an existing DocType — pushing one drops any column the new
#    definition omits, and dropping a column drops the data in it.
#
#    Not optional. Frappe refuses a query naming a field it does not have —
#    the whole query, not the field — so until this has run, the machine
#    picker, the breakdown list and the reliability report all fail outright.
npm run erp:sync-breakdown-extras:dry
npm run erp:sync-breakdown-extras

# 2. the maintenance request record and its workflow.
#    Needs CMMS Plant, CMMS Machine and CMMS Breakdown Worker.
npm run erp:sync-requests:dry
npm run erp:sync-requests

# 3. the checklist doctypes. Needs CMMS Machine.
npm run erp:sync-preventive:dry
npm run erp:sync-preventive

# or all three, in order
npm run erp:sync-maintenance-all
```

Every one is safe to run again: anything already present is left alone.

**A caution worth keeping.** ERPNext does not ignore a field it has never heard
of — it refuses the entire query with `Field not permitted in query`. So a
rename in a repository file that has not been matched by a migration does not
degrade one column; it takes down every screen reading that doctype. That is
what happened when `loss_per_hour` became `output_per_hour` and `output_uom`
ahead of the migration: the machine picker, the breakdown list and the report
all returned 500, and the screens that caught the error and set an empty list
reported it as "no machines". Add the Custom Field in the same change as the
rename.

Until step 1 has run, the breakdown list will fail — `repeat_failure` is in the
field list it asks ERPNext for. Until steps 2 and 3 have run, the two new screens
say so in plain words and name the command, rather than showing a generic error.

## What has not been done

**No checklist content is seeded.** The points on a mixing mill's weekly round
are a matter of fact about that mill, and a plausible-looking list generated by a
script would be signed off by somebody assuming it came from the manufacturer.
The existing checklists have to be entered or imported.

"Copy to another machine" exists because that is the only realistic way a plant
ever gets a full set — three of the mills are the same mill, and typing the same
fourteen points three times is how the third ends up with eleven of them.
