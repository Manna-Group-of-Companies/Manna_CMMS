"""
Builds the machine data-collection workbook for Manna Rubber Products Pvt Ltd.

The sheet is the input to Module 2: nothing in maintenance planning can be
built until every machine is registered and classified, so this is the first
real step rather than a formality.

Rows are pre-filled with the 23 machines named, and with the utility equipment
a reclaim plant must have but which was not in that list — because shared
utilities cause a disproportionate share of downtime and are the equipment
nobody feels ownership of.
"""

import os

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

# Manna orange, from the group logo, and the charcoal that sits with it.
ORANGE = "D14A0C"
ORANGE_SOFT = "FBEDE4"
CHARCOAL = "2E2D30"
GREY = "6B646C"
GREY_SOFT = "EDE8E3"

HEAD = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
SUBHEAD = Font(name="Calibri", size=9, bold=True, color=CHARCOAL)
BODY = Font(name="Calibri", size=10)
NOTE = Font(name="Calibri", size=9, color=GREY, italic=True)
TITLE = Font(name="Calibri", size=14, bold=True, color=CHARCOAL)

FILL_REQ = PatternFill("solid", fgColor=ORANGE)
FILL_OPT = PatternFill("solid", fgColor=GREY)
FILL_PRE = PatternFill("solid", fgColor=GREY_SOFT)
FILL_BAND = PatternFill("solid", fgColor=ORANGE_SOFT)

THIN = Side(style="thin", color="D9D2CB")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

wb = Workbook()

# ---------------------------------------------------------------- machines --
# code prefix, label, how many, the area it usually sits in
# The names are the ones used on the floor. The heating type of a press and the
# "Digester" and "Nylon Tyre" qualifiers live in Machine Type, not in the name -
# nobody says "Press - Thermic Fluid Heated 3" out loud.
#
# Presses run 1-11 straight through: the thermic and the coil sets both used to
# start at 1, so shortening both names produced two machines called "Press 3".
FLEET = [
    ("CRK", "Cracker Mill", "Cracker Mill", ["Cracker Mill 1"], "Size Reduction"),
    ("GRD", "Grinder", "Grinder", ["Grinder 1", "Grinder 2", "Grinder 3"], "Size Reduction"),
    ("AUT", "Autoclave", "Autoclave", ["Autoclave A", "Autoclave M"], "Devulcanising"),
    ("PRF", "Pre-Refiner Mill", "Pre-Refiner Mill", ["Pre-Refiner Mill 1", "Pre-Refiner Mill 2"], "Refining"),
    ("REF", "Refiner Mill", "Refiner Mill", [f"Refiner Mill {n}" for n in range(1, 5)], "Refining"),
    ("PRT", "Press", "Press - Thermic Fluid Heated", [f"Press {n}" for n in range(1, 7)], "Moulding"),
    ("PRE", "Press", "Press - Electric Coil Heated", [f"Press {n}" for n in range(7, 12)], "Moulding"),
]

# (header, width, required?, help text shown under the header)
MACHINE_COLS = [
    ("Machine Code", 14, "pre", "Already filled. Do not change - the system uses it."),
    ("Machine Name", 30, "pre", "Rename if the plant calls it something else."),
    ("Machine Type", 26, "pre", ""),
    ("Area / Section", 18, "req", "Where it physically sits."),
    ("Criticality", 12, "req", "A = stops the plant. B = stops one line. C = work moves elsewhere."),
    ("Make / Manufacturer", 20, "req", ""),
    ("Model", 16, "opt", ""),
    ("Serial No.", 16, "opt", "From the nameplate."),
    ("Year Made", 10, "opt", ""),
    ("Commissioned On", 15, "opt", "When it started running here."),
    ("Capacity / Size", 20, "req", 'Mill roll size, press tonnage, autoclave volume.'),
    ("Main Motor kW", 13, "opt", ""),
    ("Voltage / Phase", 14, "opt", ""),
    ("Shifts/Day", 11, "req", "1, 2 or 3."),
    ("Running Hrs/Day", 14, "req", "Actual, not theoretical."),
    ("Output per Hour", 15, "opt", "Kg, sheets or pieces - say which."),
    ("Loss per Hour (INR)", 17, "req", "Worked out on the Loss Working sheet. Do not type over the formula."),
    ("Standby Available?", 16, "req", "Is there another machine that can take the work?"),
    ("Stops Whole Plant?", 17, "req", "If this stops, does everything stop?"),
    ("Needs Power", 12, "req", ""),
    ("Needs Steam", 12, "req", ""),
    ("Needs Thermic Fluid", 17, "req", ""),
    ("Needs Compressed Air", 18, "req", ""),
    ("Needs Cooling Water", 17, "req", ""),
    ("Existing PM Schedule?", 19, "req", "Is any planned maintenance done on it today?"),
    ("Last Major Overhaul", 18, "opt", ""),
    ("Recurring Problems", 40, "req", "What keeps going wrong. Plain words are fine."),
    ("Typical Failure Modes", 40, "opt", "Bearings, seals, heaters, drives, controls..."),
    ("Lubrication Points & Frequency", 30, "opt", ""),
    ("Statutory Inspection?", 18, "req", "Pressure vessels and boilers need certification."),
    ("Statutory Due Date", 17, "opt", ""),
    ("Operating Department", 19, "opt", ""),
    ("Maintained By", 15, "req", "In-house, AMC or Both."),
    ("Supplier / Service Contact", 26, "opt", "Name and phone."),
    ("AMC Valid Until", 15, "opt", ""),
    ("Manual Available?", 16, "opt", ""),
    ("Drawings Available?", 17, "opt", ""),
    ("Notes", 40, "opt", ""),
]


def style_header(ws, cols, start_row=1):
    """Two rows: the header itself, and the help line under it."""
    for i, (name, width, kind, help_text) in enumerate(cols, start=1):
        letter = get_column_letter(i)
        ws.column_dimensions[letter].width = width

        head = ws.cell(row=start_row, column=i, value=name)
        head.font = HEAD
        head.fill = FILL_REQ if kind == "req" else (FILL_PRE if kind == "pre" else FILL_OPT)
        if kind == "pre":
            head.font = SUBHEAD
        head.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        head.border = BOX

        note = ws.cell(row=start_row + 1, column=i, value=help_text)
        note.font = NOTE
        note.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        note.border = BOX

    ws.row_dimensions[start_row].height = 30
    ws.row_dimensions[start_row + 1].height = 34
    ws.freeze_panes = ws.cell(row=start_row + 2, column=4)


ws = wb.active
ws.title = "Machines"
style_header(ws, MACHINE_COLS)

row = 3
for prefix, _short, kind, names, area in FLEET:
    for n, machine_name in enumerate(names, start=1):
        ws.cell(row=row, column=1, value=f"MRP-{prefix}-{n:02d}").font = BODY
        ws.cell(row=row, column=2, value=machine_name).font = BODY
        ws.cell(row=row, column=3, value=kind).font = BODY
        ws.cell(row=row, column=4, value=area).font = BODY
        for c in range(1, len(MACHINE_COLS) + 1):
            ws.cell(row=row, column=c).border = BOX
            ws.cell(row=row, column=c).alignment = Alignment(vertical="top", wrap_text=True)
        row += 1
LAST_MACHINE_ROW = row - 1

# ------------------------------------------------------------ loss working --
#
# The one figure the whole reliability report rests on, and the one people
# guess at. Asking for "loss per hour" gets a round number somebody invented;
# asking for the four things it is made of gets an answer that can be argued
# with and corrected.
#
# Filled in per machine, and the Machines sheet reads its total back, so the
# working stays visible instead of collapsing into a number nobody can defend.

LOSS_COLS = [
    ("Machine Code", 14, "pre", "Matches the Machines sheet."),
    ("Machine Name", 26, "pre", ""),
    ("Output per Hour", 15, "req", "How much it makes in an hour, running normally. Kg or pieces."),
    ("Unit", 10, "req", "Kg, sheets, pieces."),
    ("Contribution per Unit (INR)", 22, "req",
     "Selling price less the material that goes into it. NOT the selling price - "
     "material not consumed during a stoppage is not lost."),
    ("Idle Labour per Hour (INR)", 22, "req",
     "People standing by this machine who cannot do anything else. Wages, not headcount."),
    ("Utilities Still Running (INR/hr)", 24, "opt",
     "Heaters, hot oil and compressors that stay on while it is stopped."),
    ("Spoilage per Stoppage (INR)", 22, "opt",
     "Work in progress ruined when it stops mid-cycle. An autoclave batch, a press load."),
    ("Typical Stoppage (hrs)", 18, "opt", "Used to spread spoilage across an hour. Leave blank if none."),
    ("= Loss per Hour (INR)", 20, "pre", "Worked out. Do not type here."),
    ("How it was arrived at", 34, "opt", "Anything the numbers above do not capture."),
]

wlw = wb.create_sheet("Loss Working")
style_header(wlw, LOSS_COLS)

lrow = 3
for prefix, _short, _kind, names, _area in FLEET:
    for n, machine_name in enumerate(names, start=1):
        code = f"MRP-{prefix}-{n:02d}"
        wlw.cell(row=lrow, column=1, value=code).font = BODY
        wlw.cell(row=lrow, column=2, value=machine_name).font = BODY

        # Output x contribution, plus the labour and utilities that keep being
        # paid for while nothing comes out, plus spoilage spread over a typical
        # stoppage. IFERROR so a blank stoppage length reads as no spoilage
        # rather than #DIV/0!.
        wlw.cell(row=lrow, column=10).value = (
            f"=IFERROR(ROUND(C{lrow}*E{lrow} + F{lrow} + G{lrow} + "
            f"IF(I{lrow}>0, H{lrow}/I{lrow}, 0), 0), \"\")"
        )
        wlw.cell(row=lrow, column=10).font = Font(name="Calibri", size=10, bold=True)
        wlw.cell(row=lrow, column=10).fill = FILL_BAND

        for c in range(1, len(LOSS_COLS) + 1):
            wlw.cell(row=lrow, column=c).border = BOX
            wlw.cell(row=lrow, column=c).alignment = Alignment(vertical="top", wrap_text=True)
        lrow += 1

# The Machines sheet reads the answer back, so there is one place to change it.
for i, r in enumerate(range(3, LAST_MACHINE_ROW + 1)):
    ws.cell(row=r, column=17).value = f"='Loss Working'!J{3 + i}"
    ws.cell(row=r, column=17).font = Font(name="Calibri", size=10, bold=True)

# --------------------------------------------------------------- utilities --
UTIL_COLS = [
    ("Equipment Code", 16, "pre", ""),
    ("Equipment", 30, "pre", "Confirm it exists, correct the name, or delete the row."),
    ("Exists Here?", 13, "req", "Yes / No"),
    ("How Many", 11, "req", ""),
    ("Area / Section", 18, "req", ""),
    ("Criticality", 12, "req", "Most of these are A - they feed several machines."),
    ("Make / Model", 22, "req", ""),
    ("Capacity / Rating", 20, "req", "Boiler TPH, compressor CFM, DG kVA, heater kcal/hr."),
    ("Commissioned On", 15, "opt", ""),
    ("Feeds Which Machines", 34, "req", "Machine codes from the Machines sheet."),
    ("Statutory Inspection?", 18, "req", "Boilers and pressure vessels almost always."),
    ("Statutory Due Date", 17, "opt", ""),
    ("Existing PM Schedule?", 19, "req", ""),
    ("Recurring Problems", 38, "req", ""),
    ("Maintained By", 15, "req", "In-house, AMC or Both."),
    ("Supplier / Service Contact", 26, "opt", ""),
    ("Loss per Hour (INR)", 17, "req", "If this stops, what does the whole plant lose per hour?"),
    ("Notes", 34, "opt", ""),
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

wu = wb.create_sheet("Utilities")
style_header(wu, UTIL_COLS)
row = 3
for code, name in UTILITIES:
    wu.cell(row=row, column=1, value=code).font = BODY
    wu.cell(row=row, column=2, value=name).font = BODY
    for c in range(1, len(UTIL_COLS) + 1):
        wu.cell(row=row, column=c).border = BOX
        wu.cell(row=row, column=c).alignment = Alignment(vertical="top", wrap_text=True)
    row += 1
LAST_UTIL_ROW = row - 1

# ------------------------------------------------------------------ spares --
SPARE_COLS = [
    ("Machine Code", 14, "req", "From the Machines or Utilities sheet."),
    ("Spare Description", 34, "req", "What the store would call it."),
    ("Store Item Code", 18, "opt", "If it is already in the store catalog."),
    ("Spare Class", 13, "req", "Vital / Essential / Desirable - see Read me."),
    ("Qty Held Today", 14, "req", ""),
    ("Min Qty to Hold", 15, "req", "What you want on the shelf at all times."),
    ("Lead Time (days)", 15, "req", "How long to get one if you have none."),
    ("Typical Life", 15, "opt", "Months, or cycles, or kg processed."),
    ("Last Replaced", 14, "opt", ""),
    ("Supplier", 24, "req", ""),
    ("Unit Cost (INR)", 15, "opt", ""),
    ("Notes", 34, "opt", ""),
]

wsp = wb.create_sheet("Critical Spares")
style_header(wsp, SPARE_COLS)
for row in range(3, 203):
    for c in range(1, len(SPARE_COLS) + 1):
        wsp.cell(row=row, column=c).border = BOX
        wsp.cell(row=row, column=c).alignment = Alignment(vertical="top", wrap_text=True)

# ------------------------------------------------------------------- lists --
wl = wb.create_sheet("Lists")
LISTS = {
    "A": ("Criticality", ["A - Critical", "B - Important", "C - Ordinary"]),
    "B": ("Yes/No", ["Yes", "No"]),
    "C": ("Spare Class", ["Vital", "Essential", "Desirable"]),
    "D": ("Maintained By", ["In-house", "AMC", "Both"]),
    "E": ("Shifts", ["1", "2", "3"]),
}
for col, (title, values) in LISTS.items():
    c = wl[f"{col}1"]
    c.value, c.font, c.fill = title, HEAD, FILL_REQ
    wl.column_dimensions[col].width = 18
    for i, v in enumerate(values, start=2):
        wl[f"{col}{i}"] = v
        wl[f"{col}{i}"].font = BODY

def dv(formula, cells, sheet):
    d = DataValidation(type="list", formula1=formula, allow_blank=True, showDropDown=False)
    sheet.add_data_validation(d)
    for ref in cells:
        d.add(ref)

END = LAST_MACHINE_ROW
dv("=Lists!$A$2:$A$4", [f"E3:E{END}"], ws)                       # criticality
dv("=Lists!$E$2:$E$4", [f"N3:N{END}"], ws)                       # shifts
dv("=Lists!$D$2:$D$4", [f"AG3:AG{END}"], ws)                     # maintained by
for col in ["R", "S", "T", "U", "V", "W", "X", "Y", "AD", "AJ", "AK"]:
    dv("=Lists!$B$2:$B$3", [f"{col}3:{col}{END}"], ws)           # yes/no columns

dv("=Lists!$B$2:$B$3", [f"C3:C{LAST_UTIL_ROW}", f"K3:K{LAST_UTIL_ROW}", f"M3:M{LAST_UTIL_ROW}"], wu)
dv("=Lists!$A$2:$A$4", [f"F3:F{LAST_UTIL_ROW}"], wu)
dv("=Lists!$D$2:$D$4", [f"O3:O{LAST_UTIL_ROW}"], wu)
dv("=Lists!$C$2:$C$4", ["D3:D202"], wsp)

# ----------------------------------------------------------------- read me --
wr = wb.create_sheet("Read me", 0)
wr.column_dimensions["A"].width = 4
wr.column_dimensions["B"].width = 104

LINES = [
    ("title", "Machine data collection - Manna Rubber Products Pvt Ltd"),
    ("note", "Everything Module 2 needs before maintenance planning can be built."),
    ("gap", ""),
    ("h", "What to do"),
    ("p", "Fill the Machines sheet first. Orange headers are needed before anything can be built; grey ones can follow later. The first three columns are already filled - please do not change the Machine Code, the system will use it."),
    ("p", "Then the Utilities sheet. These were not in your list, but a reclaim plant cannot run without them and they are usually the equipment that causes the most downtime, because they are shared and nobody owns them. Confirm which exist, correct the names, delete anything you do not have."),
    ("p", "Critical Spares last, and only for the class A and B machines to begin with. This is the sheet that links the store you already have to the machines, and it is the highest-return part of the whole exercise."),
    ("gap", ""),
    ("h", "Criticality - the most important column"),
    ("p", "A - Critical: if it stops, the plant stops, or it is a safety or statutory item. Expect only a handful."),
    ("p", "B - Important: if it stops, one line or one process step stops. Work continues elsewhere."),
    ("p", "C - Ordinary: work moves to another machine. Losing it costs little."),
    ("p", "This is not a ranking of how expensive a machine was. It is purely: what happens to production when this stops? A cheap pump feeding six machines is class A. An idle spare press is class C."),
    ("p", "It matters because the system will ask for more detail on class A failures than class C. Without it, every broken hand tool demands a root cause analysis and people stop using the system."),
    ("gap", ""),
    ("h", "Loss per Hour - how to work it out"),
    ("p", "What one hour of this machine being stopped costs. A rough, honest figure beats a precise, invented one. Two ways:"),
    ("p", "1. Lost output: units per hour x contribution per unit. Best where the machine sets the pace."),
    ("p", "2. Idle cost: people standing idle + fixed cost per hour, where output can be caught up later."),
    ("p", "If a stoppage also spoils work in progress - an autoclave failing mid-cycle - note that in Recurring Problems. It is often the larger loss and it is easy to forget."),
    ("p", "Set it once per machine, review yearly. It does not need to be exact; it needs to be consistent, so that comparing two machines means something."),
    ("gap", ""),
    ("h", "Spare Class"),
    ("p", "Vital: without it the machine is down and cannot be worked around. Hold it whatever the cost, even if it is used once in three years."),
    ("p", "Essential: needed soon, but the machine can run for a while or at reduced rate."),
    ("p", "Desirable: convenient to have. Order it when needed."),
    ("p", "Judge by the consequence of NOT having it, not by how often it is used or what it costs."),
    ("gap", ""),
    ("h", "Two things worth checking while you walk round"),
    ("p", "Statutory inspection. Autoclaves are pressure vessels and a boiler is a boiler - both usually need certification, and an expired certificate stops you regardless of machine condition. Please capture the due dates."),
    ("p", "Dust extraction on the grinders. Nylon tyre grinding produces a great deal of dust. If extraction fails it is a health and fire matter before it is a production one, which is why it is on the Utilities sheet."),
    ("gap", ""),
    ("h", "What is already filled in"),
    ("p", "23 machines: 1 cracker, 3 grinders, 2 autoclaves, 2 pre-refiners, 4 refiners, 6 thermic fluid presses, 5 electric coil presses."),
    ("p", "Codes follow MRP-TYPE-NN, so MRP-REF-03 is the third refiner. They will become the machine identifiers in the application."),
    ("gap", ""),
    ("h", "If a column does not apply"),
    ("p", "Leave it blank rather than guessing. A blank is honest and can be filled later; a guess becomes a number somebody trusts."),
]

r = 2
for kind, text in LINES:
    cell = wr.cell(row=r, column=2, value=text)
    if kind == "title":
        cell.font = TITLE
    elif kind == "h":
        cell.font = Font(name="Calibri", size=11, bold=True, color=ORANGE)
    elif kind == "note":
        cell.font = NOTE
    else:
        cell.font = BODY
    cell.alignment = Alignment(wrap_text=True, vertical="top")
    wr.row_dimensions[r].height = 15 if kind == "gap" else (32 if kind == "p" else 22)
    r += 1

wr.sheet_view.showGridLines = False

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "machine-survey", "MRPPL-Machine-Data-Collection.xlsx")
wb.save(OUT)
print("saved:", OUT)
print("machines rows:", LAST_MACHINE_ROW - 2)
print("utility rows :", LAST_UTIL_ROW - 2)
print("sheets       :", ", ".join(wb.sheetnames))
