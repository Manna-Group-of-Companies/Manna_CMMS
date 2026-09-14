"""
Builds the blank log sheets for the Manna Group.

    python tools/build_log_sheet.py

Two sheets, one per record type:

    Maintenance-Log-Sheet.html          a breakdown - a machine has stopped
    Maintenance-Request-Sheet.html      planned work - fabrication, a routine,
                                        an improvement

Writes HTML to data/log-sheet/. Both carry Word's namespaces, so Word opens them
as editable documents if the wording needs changing, and both print to a single
A4 page from any browser.

Deliberately short. A sheet records only what paper is better at than a screen:
what was physically taken from the store, who was on the job, and their
signatures. Times, downtime, priority, failure mode, root cause and prevention
are all held in the Manna CMMS and worked out from it - copying
them onto paper would only create a second version to disagree with the first.

The reference box at the top is what ties the two together. It is the one piece
of the application that has to appear here.

The two sheets are almost the same, and the differences are the point of having
two. A breakdown consumes *spares* by the piece and its sheet says so; a
fabrication job consumes *material* by the metre and the kilo, so its sheet asks
for a unit. And the verification wording differs because the two are attesting
to different things - that the breakdown procedure was followed, against that
the work and the materials are as recorded.
"""

import base64
import io
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ORANGE = "#d14a0c"
INK = "#2e2d30"
RULE = "#b9b1a8"
FAINT = "#e6e0d9"

# Generous rows, because the sheet is carried to the machine and there is no
# second page to spill onto. With so little else on it, the space is free.
SPARE_ROWS = 10
TEAM_ROWS = 6

CSS = f"""
@page {{ size: A4 portrait; margin: 14mm 14mm 12mm 14mm; }}
body {{ font-family: Calibri, "Segoe UI", Arial, sans-serif; color: {INK};
        font-size: 10pt; line-height: 1.3; margin: 0; }}
table {{ border-collapse: collapse; width: 100%; }}
td, th {{ border: 0.75pt solid {RULE}; padding: 3pt 5pt; vertical-align: top; }}
th {{ background: {FAINT}; font-size: 8.5pt; font-weight: bold; text-align: left;
      text-transform: uppercase; letter-spacing: 0.03em; }}

.head {{ border-bottom: 2pt solid {INK}; padding-bottom: 6pt; margin-bottom: 10pt; }}
.brand {{ width: auto; }}
.brand td {{ border: 0; padding: 0; vertical-align: middle; }}
.title {{ font-size: 17pt; font-weight: bold; letter-spacing: -0.01em; }}
.sub {{ font-size: 9pt; color: #6b646c; }}
.ref {{ float: right; text-align: right; }}
.refbox {{ border: 1pt solid {INK}; padding: 4pt 12pt; font-family: Consolas, monospace;
           font-size: 12pt; min-width: 110pt; text-align: center; }}

.sec {{ font-size: 8.5pt; font-weight: bold; text-transform: uppercase;
        letter-spacing: 0.06em; color: {ORANGE}; margin: 12pt 0 3pt; }}
.fill {{ height: 19pt; }}

.signrow {{ margin-top: 16pt; width: 100%; }}
.signrow td {{ border: 0; padding: 0 14pt 0 0; }}
.sigline {{ border-bottom: 0.75pt solid {INK}; height: 34pt; }}
.siglabel {{ font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em;
             color: #6b646c; padding-top: 3pt; }}

.verify {{ border: 1.5pt solid {INK}; padding: 8pt 10pt; margin-top: 14pt; }}
.verify .cap {{ font-size: 8.5pt; font-weight: bold; text-transform: uppercase;
                letter-spacing: 0.05em; }}
.verify .says {{ font-size: 9pt; color: #4a444c; margin: 2pt 0 14pt; }}
.foot {{ margin-top: 10pt; font-size: 8pt; color: #8b848c; }}
"""


def logo_tag(height_pt=26):
    """
    The Manna Group mark, embedded as a data URI.

    Read from the one place the artwork lives - the web client's public folder -
    so there is a single file to replace rather than a copy per output. Returns
    empty when it is not there: a printed form with no logo is fine, a printed
    form with a broken-image box is not.

    Height only, never a width: the mark is 2.5:1 and pinning both axes
    distorts it.
    """
    path = os.path.join(BASE, "client", "public", "manna-logo.png")
    if not os.path.exists(path):
        return ""
    data = base64.b64encode(io.open(path, "rb").read()).decode()
    return (
        f'<img src="data:image/png;base64,{data}" alt="Manna Group" '
        f'style="height:{height_pt}pt;width:auto;display:block" />'
    )


def rows(count, columns):
    """Blank rows. A sheet with no room to write is a sheet nobody uses."""
    return "".join(
        "<tr><td style='text-align:center'>%d</td>%s</tr>"
        % (i, "".join('<td class="fill"></td>' for _ in range(columns)))
        for i in range(1, count + 1)
    )


def sheet(title, ref_label, context_row, what_header, what_columns, verify_says, footer):
    """
    One sheet.

    Everything that differs between a breakdown and a planned job is a
    parameter, and everything that does not is shared - because the two have to
    look like the same document to the people signing them. A crew that reads
    one as unfamiliar paperwork reads it more slowly and fills it in worse.
    """
    return f"""<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>{title}</title>
<style>{CSS}</style></head>
<body>

<div class="head">
  <div class="ref">
    <div class="sub" style="margin-bottom:3pt">{ref_label}</div>
    <div class="refbox">&nbsp;</div>
  </div>
  <table class="brand">
    <tr>
      <td style="padding-right:10pt">{logo_tag()}</td>
      <td>
        <div class="title">{title}</div>
        <div class="sub">Manna Group of Companies &middot; Engineering &amp; Maintenance</div>
      </td>
    </tr>
  </table>
</div>

{context_row}

<div class="sec">{what_header}</div>
<table>
  <tr>{what_columns}</tr>
  {rows(SPARE_ROWS, what_columns.count("<th") - 1)}
</table>

<div class="sec">Team</div>
<table>
  <tr>
    <th style="width:6%">#</th>
    <th>Name</th>
    <th style="width:20%">Hours</th>
    <th style="width:30%">Signature</th>
  </tr>
  {rows(TEAM_ROWS, 3)}
</table>

<table class="signrow">
  <tr>
    <td style="width:50%"><div class="sigline"></div>
        <div class="siglabel">Maintenance manager &mdash; name, sign, date</div></td>
    <td style="width:50%"><div class="sigline"></div>
        <div class="siglabel">Plant / production &mdash; name, sign, date</div></td>
  </tr>
</table>

<div class="verify">
  <div class="cap">Verified by the maintenance head</div>
  <div class="says">{verify_says}</div>
  <table class="signrow" style="margin-top:0">
    <tr>
      <td style="width:40%"><div class="sigline"></div><div class="siglabel">Name</div></td>
      <td style="width:35%"><div class="sigline"></div><div class="siglabel">Signature</div></td>
      <td style="width:25%"><div class="sigline"></div><div class="siglabel">Date</div></td>
    </tr>
  </table>
</div>

<div class="foot">{footer}</div>

</body></html>"""


BREAKDOWN = sheet(
    title="Maintenance Log Sheet",
    ref_label="Breakdown ref.",
    context_row="""<table>
  <tr>
    <th style="width:12%">Plant</th><td style="width:40%" class="fill"></td>
    <th style="width:12%">Machine</th><td class="fill"></td>
  </tr>
</table>""",
    what_header="Spares used",
    what_columns="""
    <th style="width:6%">#</th>
    <th>Description</th>
    <th style="width:14%">Qty</th>
    <th style="width:24%">Issued by</th>
  """,
    verify_says="I have read this sheet and confirm the breakdown procedure was followed.",
    footer="""
  One sheet per breakdown. Write the breakdown reference from the Manna CMMS at the
  top right, then file the signed original. Times, downtime and the root cause are recorded in the
  application &mdash; they are not written here.
""",
)

# The planned-work sheet.
#
# Not the breakdown sheet with a different heading. Three things genuinely
# differ:
#
#   the reference    an MR number, not a BD number - and writing the wrong one
#                    at the top is how a signed sheet goes into the wrong file
#   the material     by the metre and the kilo rather than by the piece, so
#                    there is a unit column; "4" with no unit against it is an
#                    entry nobody can cost afterwards
#   the work         a planned job is described by what was asked for, which the
#                    breakdown sheet has no room for and no need of
#
# There is no root cause and no downtime here, because a planned job has neither.
REQUEST = sheet(
    title="Maintenance Work Sheet",
    ref_label="Request ref.",
    context_row="""<table>
  <tr>
    <th style="width:12%">Plant</th><td style="width:40%" class="fill"></td>
    <th style="width:14%">Machine / area</th><td class="fill"></td>
  </tr>
  <tr>
    <th>Work</th><td class="fill" colspan="3"></td>
  </tr>
</table>""",
    what_header="Materials and items used",
    what_columns="""
    <th style="width:6%">#</th>
    <th>Description</th>
    <th style="width:10%">Qty</th>
    <th style="width:10%">Unit</th>
    <th style="width:22%">Issued by</th>
  """,
    verify_says="I have read this sheet and confirm the work and the materials are as recorded.",
    footer="""
  One sheet per maintenance request &mdash; fabrication, a preventive job, a routine, an
  improvement. Write the request reference from the Manna CMMS at the top right,
  then file the signed original. Dates and the labour total are recorded in the application
  &mdash; they are not written here.
""",
)

OUT_DIR = os.path.join(BASE, "data", "log-sheet")
os.makedirs(OUT_DIR, exist_ok=True)

for filename, html in (
    ("Maintenance-Log-Sheet.html", BREAKDOWN),
    ("Maintenance-Request-Sheet.html", REQUEST),
):
    path = os.path.join(OUT_DIR, filename)
    io.open(path, "w", encoding="utf-8").write(html)
    print("written:", path)

print(f"spares/material rows: {SPARE_ROWS} | team rows: {TEAM_ROWS}")
