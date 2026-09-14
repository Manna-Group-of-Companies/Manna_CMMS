"""
Builds a printable survey form - one page per machine - for the maintenance
manager to fill in by hand while walking the plant.

Written as HTML and handed to Word to convert, because no docx library is
installed and Word is. The layout is deliberately constrained to a single A4
page per machine: a form that runs onto a second page gets separated, and half
the answers come back without knowing which machine they belong to.

Every field maps to a column in MRPPL-Machine-Data-Collection.xlsx, in the
same order, so transcribing afterwards is left-to-right with no hunting.
"""

import io
import os

# The only page break Word reliably honours when importing HTML.
PAGE_BREAK = '<p class="brk">FORMBREAK</p>'

ORANGE = "#D14A0C"
CHARCOAL = "#2E2D30"
GREY = "#6B646C"
RULE = "#BDB3AA"
SOFT = "#F2EDE9"

FLEET = [
    # The names people use, spelled out rather than numbered mechanically:
    # the autoclaves are A and M, and the presses run 1-11 across both heating
    # types so no two carry the same name.
    ("CRK", "Cracker Mill", ["Cracker Mill 1"], "Size Reduction"),
    ("GRD", "Grinder", ["Grinder 1", "Grinder 2", "Grinder 3"], "Size Reduction"),
    ("AUT", "Autoclave", ["Autoclave A", "Autoclave M"], "Devulcanising"),
    ("PRF", "Pre-Refiner Mill", ["Pre-Refiner Mill 1", "Pre-Refiner Mill 2"], "Refining"),
    ("REF", "Refiner Mill", [f"Refiner Mill {n}" for n in range(1, 5)], "Refining"),
    ("PRT", "Press - Thermic Fluid Heated", [f"Press {n}" for n in range(1, 7)], "Moulding"),
    ("PRE", "Press - Electric Coil Heated", [f"Press {n}" for n in range(7, 12)], "Moulding"),
]

UTILITIES = [
    ("UTL-TFH", "Thermic Fluid Heater (hot oil)"),
    ("UTL-BLR", "Steam Boiler"),
    ("UTL-CMP", "Air Compressor"),
    ("UTL-ADR", "Compressed Air Dryer"),
    ("UTL-CLT", "Cooling Tower / Chiller"),
    ("UTL-DUS", "Dust Extraction / Cyclone"),
    ("UTL-DGS", "DG Set"),
    ("UTL-TRF", "Transformer / Main LT Panel"),
    ("UTL-WTP", "Water Pump / Overhead Tank"),
    ("UTL-HST", "Hoists / Cranes / Material Handling"),
    ("UTL-CNV", "Conveyors"),
    ("UTL-WGH", "Weighing Scales"),
]

CSS = f"""
@page {{ size: A4 portrait; margin: 1.4cm 1.5cm; }}
body {{ font-family: Calibri, Arial, sans-serif; font-size: 9.5pt; color: {CHARCOAL}; }}
table {{ border-collapse: collapse; width: 100%; }}
td, th {{ vertical-align: top; }}

.page {{ page-break-inside: avoid; }}
.brk {{ page-break-before: always; font-size: 1pt; line-height: 1pt;
        margin: 0; padding: 0; color: #FFFFFF; }}

.hd {{ border-bottom: 2.5pt solid {ORANGE}; padding-bottom: 3pt; margin-bottom: 5pt; }}
.eyebrow {{ font-size: 7.5pt; letter-spacing: 1pt; color: {GREY}; text-transform: uppercase; }}
.code {{ font-size: 17pt; font-weight: bold; color: {ORANGE}; }}
.mname {{ font-size: 11pt; font-weight: bold; }}
.marea {{ font-size: 9pt; color: {GREY}; }}

.sec {{ font-size: 8pt; font-weight: bold; letter-spacing: 0.8pt; text-transform: uppercase;
       color: #FFFFFF; background: {CHARCOAL}; padding: 2pt 6pt; margin: 6pt 0 0 0; }}

.g td {{ border-bottom: 0.75pt solid {RULE}; padding: 2pt 5pt 2pt 0; }}
.lbl {{ font-size: 7.5pt; color: {GREY}; white-space: nowrap; padding-right: 6pt !important;
        border-bottom: 0.75pt solid {RULE}; }}
.fill {{ height: 15pt; }}

.box {{ border: 0.75pt solid {RULE}; height: 40pt; padding: 3pt 5pt; }}
.boxlbl {{ font-size: 7.5pt; color: {GREY}; padding: 3pt 0 1pt 0; }}

.tick {{ display: inline-block; width: 10pt; height: 10pt; border: 0.9pt solid {CHARCOAL};
         margin: 0 3pt 0 0; }}
.opt {{ font-size: 8.5pt; padding-right: 14pt; white-space: nowrap; }}

.sp th {{ background: {SOFT}; font-size: 7pt; letter-spacing: 0.5pt; text-transform: uppercase;
          color: {GREY}; border: 0.75pt solid {RULE}; padding: 3pt 4pt; text-align: left; }}
.sp td {{ border: 0.75pt solid {RULE}; height: 15pt; }}

.ft {{ margin-top: 7pt; border-top: 0.75pt solid {RULE}; padding-top: 5pt;
       font-size: 7.5pt; color: {GREY}; }}
.hint {{ font-size: 7.5pt; color: {GREY}; font-style: italic; }}
"""


def tick(label):
    return f'<span class="opt"><span class="tick"></span>{label}</span>'


def rows(pairs):
    """Label/blank pairs, two to a line."""
    out = []
    for i in range(0, len(pairs), 2):
        chunk = pairs[i:i + 2]
        cells = ""
        for label in chunk:
            cells += f'<td class="lbl" width="17%">{label}</td><td class="fill" width="33%"></td>'
        if len(chunk) == 1:
            cells += '<td class="lbl" width="17%"></td><td class="fill" width="33%"></td>'
        out.append(f"<tr>{cells}</tr>")
    return f'<table class="g">{"".join(out)}</table>'


def page(code, name, kind, area, is_utility=False):
    what = "Utility / Common Equipment" if is_utility else "Machine"

    exists = ""
    if is_utility:
        exists = (
            f'<div class="sec">Does this exist at MRPPL?</div>'
            f'<table class="g"><tr><td width="60%" style="padding-top:4pt">'
            f'{tick("Yes")}{tick("No - cross out this page")}</td>'
            f'<td class="lbl" width="14%">How many</td><td class="fill" width="26%"></td></tr></table>'
        )

    return f"""
<div class="page">
  <div class="hd">
    <table><tr>
      <td width="62%">
        <div class="eyebrow">Manna Rubber Products Pvt Ltd &nbsp;&middot;&nbsp; {what} Survey</div>
        <div class="code">{code}</div>
        <div class="mname">{name}</div>
        <div class="marea">{kind}{(" &middot; " + area) if area else ""}</div>
      </td>
      <td width="38%" style="text-align:right">
        <div class="eyebrow">Filled by</div>
        <div style="border-bottom:0.75pt solid {RULE}; height:15pt"></div>
        <div class="eyebrow" style="padding-top:5pt">Date</div>
        <div style="border-bottom:0.75pt solid {RULE}; height:15pt"></div>
      </td>
    </tr></table>
  </div>
  {exists}

  <div class="sec">1 &nbsp; Nameplate &mdash; copy from the plate on the machine</div>
  {rows(["Make", "Model", "Serial No.", "Year made",
         "Capacity / size", "Main motor kW", "Voltage / phase", "Commissioned on"])}

  <div class="sec">2 &nbsp; How critical is it?</div>
  <table class="g"><tr><td style="padding-top:4pt; border:none">
    {tick("A &mdash; plant stops, or safety / statutory")}
    {tick("B &mdash; one line stops")}
    {tick("C &mdash; work moves elsewhere")}
  </td></tr></table>
  <div class="hint">Ask only: what happens to production when this stops? Not what it cost to buy.</div>
  <table class="g"><tr>
    <td class="lbl" width="24%">Is there a standby?</td>
    <td width="26%" style="border-bottom:0.75pt solid {RULE}">{tick("Yes")}{tick("No")}</td>
    <td class="lbl" width="24%">Does the whole plant stop?</td>
    <td width="26%" style="border-bottom:0.75pt solid {RULE}">{tick("Yes")}{tick("No")}</td>
  </tr></table>

  <div class="sec">3 &nbsp; Running and loss</div>
  {rows(["Shifts per day", "Running hrs / day", "Output per hour", "Unit (kg / pieces)"])}
  {rows(["Contribution per unit (Rs)", "Idle labour per hour (Rs)"])}
  {rows(["Utilities still running (Rs/hr)", "Spoilage per stoppage (Rs)"])}
  {rows(["Typical stoppage length (hrs)", "Loss per hour (Rs) &mdash; office use"])}

  <div class="sec">4 &nbsp; What it needs to run &mdash; tick all that apply</div>
  <table class="g"><tr><td style="padding-top:3pt; border:none">
    {tick("Power")}{tick("Steam")}{tick("Thermic fluid")}{tick("Compressed air")}{tick("Cooling water")}
  </td></tr></table>

  <div class="sec">5 &nbsp; Maintenance today</div>
  <table class="g"><tr>
    <td class="lbl" width="27%">Any planned maintenance done?</td>
    <td width="23%" style="border-bottom:0.75pt solid {RULE}">{tick("Yes")}{tick("No")}</td>
    <td class="lbl" width="22%">Last major overhaul</td>
    <td class="fill" width="28%"></td>
  </tr></table>
  <div class="boxlbl">What keeps going wrong, and which parts fail &mdash; bearings, seals, heaters, drives, controls?</div>
  <div class="box"></div>

  <div class="sec">6 &nbsp; Statutory and ownership</div>
  <table class="g"><tr>
    <td class="lbl" width="27%">Statutory inspection needed?</td>
    <td width="23%" style="border-bottom:0.75pt solid {RULE}">{tick("Yes")}{tick("No")}</td>
    <td class="lbl" width="22%">Certificate due date</td>
    <td class="fill" width="28%"></td>
  </tr></table>
  {rows(["Operating department", "Maintained by", "Supplier / service contact", "AMC valid until"])}
  <div class="hint">Autoclaves and boilers are pressure vessels &mdash; please do not leave the certificate date blank.</div>

  <div class="sec">7 &nbsp; Critical spares &mdash; what must be on the shelf for this machine</div>
  <table class="sp">
    <tr><th width="34%">Spare description</th><th width="14%">Vital / Ess / Des</th>
        <th width="10%">Held now</th><th width="10%">Min to hold</th>
        <th width="12%">Lead time</th><th width="20%">Supplier</th></tr>
    {"".join("<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>" for _ in range(3 if is_utility else 4))}
  </table>
  <div class="hint">Vital = machine is down without it, whatever it costs. Judge by what happens if you do NOT have it.</div>

  <div class="ft">
    Transcribe into MRPPL-Machine-Data-Collection.xlsx &mdash; the sections above follow the
    columns left to right. Leave anything you are unsure of blank rather than guessing.
  </div>
</div>
"""


pages = []

pages.append(f"""
<div class="page">
  <div class="hd">
    <div class="eyebrow">Manna Rubber Products Pvt Ltd</div>
    <div class="code" style="font-size:24pt">Machine Survey</div>
    <div class="mname">Manna CMMS &mdash; maintenance module setup</div>
  </div>
  <p style="font-size:10pt">One page per machine. Walk the plant with these, fill them in at the
  machine, and hand them back for entry into the spreadsheet.</p>

  <div class="sec">What is in this pack</div>
  <table class="g">
    <tr><td class="lbl" width="30%">Machines</td><td>23 pages &mdash; 1 cracker, 3 grinders, 2 autoclaves,
        2 pre-refiners, 4 refiners, 6 thermic fluid presses, 5 electric coil presses</td></tr>
    <tr><td class="lbl">Utilities</td><td>12 pages &mdash; shared equipment. Some may not exist here;
        cross out the page if so</td></tr>
  </table>

  <div class="sec">Two things people get wrong</div>
  <p style="font-size:9.5pt"><b>Criticality</b> is not how expensive the machine was. It is only:
  what happens to production when it stops? A cheap pump feeding six machines is A.
  A spare press sitting idle is C. This decides how much the system will ask for when
  the machine fails, so a wrong answer here is felt every day afterwards.</p>
  <p style="font-size:9.5pt"><b>Loss per hour is worked out, not guessed.</b> Fill in the figures
  in section 3 and the office calculates it:<br>
  &nbsp;&nbsp;(output per hour &times; contribution per unit) + idle labour + utilities still
  running + (spoilage &divide; typical stoppage length)<br>
  <b>Contribution per unit</b> is the selling price <i>less the material that goes into it</i> &mdash;
  not the selling price. Material not consumed while the machine is stopped is not lost.</p>
  <p style="font-size:9.5pt">The figure
  consistent, so that two machines can be compared. Either output lost times contribution,
  or the cost of people standing idle. If a stoppage also spoils work in progress &mdash; an
  autoclave failing mid-cycle &mdash; write that in section 5; it is often the bigger loss.</p>

  <div class="sec">Please do not</div>
  <p style="font-size:9.5pt">Guess. A blank can be filled in next week; a guess becomes a number
  somebody trusts and acts on. Leave it empty and note why.</p>

  <div class="ft">Machine codes are printed on each page and are already in the system. Please do not change them.</div>
</div>
""")

for prefix, kind, names, area in FLEET:
    for n, machine_name in enumerate(names, start=1):
        pages.append(page(f"MRP-{prefix}-{n:02d}", machine_name, kind, area))

for code, name in UTILITIES:
    pages.append(page(code, name, "Utility / common equipment", "", is_utility=True))

html = f"""<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8">
<title>MRPPL Machine Survey</title>
<style>{CSS}</style></head>
<body>{PAGE_BREAK.join(pages)}</body></html>"""

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data", "machine-survey", "MRPPL-Machine-Survey.html")
io.open(OUT, "w", encoding="utf-8").write(html)
print("html written:", OUT)
print("pages:", len(pages), "(1 cover +", len(pages) - 1, "forms)")
