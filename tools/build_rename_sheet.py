"""
Builds the item renaming approval workbook.

Input:  data/renaming/proposed-names.json   (written by server/scripts/proposeItemNames.js)
Output: data/renaming/MRPPL-Item-Renaming.xlsx

    node server/scripts/proposeItemNames.js && python tools/build_rename_sheet.py

The sheet is a decision document, not a report. Every row the Maintenance
Manager has to look at carries the current name, what it would become, and why
it is changing at all - and a Decision column to overrule any single row
without holding up the other four hundred.

Sheets are split by what is being asked of the reader rather than by item
category, because the four questions are genuinely different: "is this rename
right", "what size is this", "what should we do with this one", and "do you
want this tidy-up at all". Mixed into one list, the hundred-odd rows that need
a human fact get lost among the ones that need nothing.
"""

import json
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

# Manna orange from the group logo, and the charcoal that sits with it.
ORANGE = "D14A0C"
ORANGE_SOFT = "FBEDE4"
CHARCOAL = "2E2D30"
GREY = "6B646C"
GREY_SOFT = "F2EDE9"
GREEN_SOFT = "E8F3EC"
AMBER_SOFT = "FDF3E2"
RED_SOFT = "FBEAEA"

HEAD = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
TITLE = Font(name="Calibri", size=14, bold=True, color=ORANGE)
BODY = Font(name="Calibri", size=10)
BODY_GREY = Font(name="Calibri", size=9, color=GREY)
MONO = Font(name="Consolas", size=9)
BOLD = Font(name="Calibri", size=10, bold=True, color=CHARCOAL)

HEAD_FILL = PatternFill("solid", fgColor=CHARCOAL)
THIN = Side(style="thin", color="D8D0C8")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(vertical="top", wrap_text=True)
TOP = Alignment(vertical="top")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "..", "data", "renaming"))

DECISIONS = '"Approve,Reject,Amend"'


def write_header(ws, columns, title, blurb):
    """Title, one line of context, then the header row. Frozen and filtered."""
    ws["A1"] = title
    ws["A1"].font = TITLE
    ws["A2"] = blurb
    ws["A2"].font = BODY_GREY
    ws["A2"].alignment = Alignment(vertical="top", wrap_text=True)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(columns))
    ws.row_dimensions[2].height = 30

    for i, (label, width) in enumerate(columns, start=1):
        cell = ws.cell(row=4, column=i, value=label)
        cell.font = HEAD
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.border = BOX
        ws.column_dimensions[get_column_letter(i)].width = width

    ws.row_dimensions[4].height = 26
    ws.freeze_panes = "A5"
    ws.auto_filter.ref = f"A4:{get_column_letter(len(columns))}4"


def write_rows(ws, rows, fields, start=5, fill=None):
    for r, row in enumerate(rows, start=start):
        for c, key in enumerate(fields, start=1):
            cell = ws.cell(row=r, column=c, value=row.get(key, ""))
            cell.font = MONO if key in ("code", "current", "proposed", "optional") else BODY
            cell.alignment = WRAP if key in ("note", "remaining") else TOP
            cell.border = BOX
            if fill:
                cell.fill = fill
    return start + len(rows)


def decision_column(ws, column, first_row, last_row):
    """A dropdown, so a decision is one of three things and not free text."""
    if last_row < first_row:
        return
    dv = DataValidation(type="list", formula1=DECISIONS, allow_blank=True)
    dv.error = "Choose Approve, Reject or Amend."
    dv.prompt = "Leave blank to accept the proposal."
    ws.add_data_validation(dv)
    letter = get_column_letter(column)
    dv.add(f"{letter}{first_row}:{letter}{last_row}")


def main():
    with open(os.path.join(DATA, "proposed-names.json"), encoding="utf-8") as f:
        rows = json.load(f)

    band = lambda name: [r for r in rows if r["band"] == name]

    wb = Workbook()

    # ------------------------------------------------------------- summary
    ws = wb.active
    ws.title = "Summary"
    ws["A1"] = "Engineering Stock — Item Renaming for Approval"
    ws["A1"].font = Font(name="Calibri", size=16, bold=True, color=ORANGE)
    ws["A2"] = (
        "Every name in the catalog checked against the SOI1/SOP1 naming convention. "
        "Nothing has been changed in ERPNext — this workbook is the proposal."
    )
    ws["A2"].font = BODY_GREY
    ws.merge_cells("A2:E2")

    changing = [r for r in rows if r["changed"]]
    lines = [
        ("", ""),
        ("Items in the catalog", len(rows)),
        ("Compliant today", sum(1 for r in rows if r["wasCompliant"])),
        ("Compliant if this is approved", sum(1 for r in rows if r["nowCompliant"])),
        ("Names that would change", len(changing)),
        ("", ""),
        ("SHEET", "WHAT IT ASKS OF YOU"),
        (
            "Renaming",
            "The main list. These become compliant. Review and approve — "
            "leave Decision blank to accept.",
        ),
        (
            "Needs the size",
            "Tidied, but the name carries no dimension or rating. Only you know the "
            "size — write it in and I will rebuild these.",
        ),
        (
            "Needs a decision",
            "Could not be fixed mechanically. Each one needs a name written by hand.",
        ),
        (
            "Optional field order",
            "Already correct and NOT being changed. The standard would put the material "
            "last. Opt in only if you want it.",
        ),
        (
            "Duplicates",
            "Two or more items sharing a name. Not caused by the renaming — worth "
            "merging separately.",
        ),
    ]
    for i, (label, value) in enumerate(lines, start=4):
        ws.cell(row=i, column=1, value=label).font = BOLD if label else BODY
        c = ws.cell(row=i, column=2, value=value)
        c.font = BODY
        c.alignment = Alignment(vertical="top", wrap_text=True)
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 86
    for i in range(11, 16):
        ws.row_dimensions[i].height = 30

    # ------------------------------------------------------------ renaming
    main_rows = band("Fix - safe") + band("Fix - reordered")
    main_rows.sort(key=lambda r: (r["band"], r["code"]))
    ws = wb.create_sheet("Renaming")
    columns = [
        ("Item code", 11), ("Current name", 46), ("Proposed name", 46),
        ("What changed", 18), ("Why", 42), ("Decision", 12),
        ("Your name, if amending", 32), ("Category", 20), ("UOM", 8),
        ("Qty", 8), ("Rack", 10),
    ]
    write_header(
        ws, columns, "Renaming — for approval",
        "These are non-compliant today and become compliant with the change shown. "
        "Leave Decision blank to accept a row; choose Reject to keep the current name, "
        "or Amend and write your own name in the next column.",
    )
    r = 5
    for row in main_rows:
        fill = PatternFill("solid", fgColor=GREEN_SOFT if row["band"] == "Fix - safe" else AMBER_SOFT)
        write_rows(
            ws, [{
                "code": row["code"], "current": row["current"], "proposed": row["proposed"],
                "what": "Case / spacing" if row["band"] == "Fix - safe" else "Words moved",
                "note": row["note"], "decision": "", "amended": "",
                "category": row["category"], "unit": row["unit"],
                "quantity": row["quantity"], "rack": row["rack"],
            }],
            ["code", "current", "proposed", "what", "note", "decision", "amended",
             "category", "unit", "quantity", "rack"],
            start=r, fill=fill,
        )
        r += 1
    decision_column(ws, 6, 5, r - 1)

    # ------------------------------------------------------- needs the size
    size_rows = band("Fix - needs the size")
    ws = wb.create_sheet("Needs the size")
    columns = [
        ("Item code", 11), ("Current name", 46), ("Tidied name", 46),
        ("Size / rating to add", 26), ("Category", 22), ("Sub-category", 22),
        ("UOM", 8), ("Qty", 8), ("Rack", 10),
    ]
    write_header(
        ws, columns, "Needs the size — please fill in",
        "The convention says a name with no dimension or rating is not unique. These "
        "carry none anywhere in the name, and the size is a fact about the shelf that "
        "cannot be derived. Write the size in and I will rebuild the name; leave it "
        "blank and the item keeps the tidied name shown.",
    )
    write_rows(
        ws,
        [{
            "code": x["code"], "current": x["current"], "proposed": x["proposed"],
            "size": "", "category": x["category"], "sub": x["subCategory"],
            "unit": x["unit"], "quantity": x["quantity"], "rack": x["rack"],
        } for x in size_rows],
        ["code", "current", "proposed", "size", "category", "sub", "unit", "quantity", "rack"],
        fill=PatternFill("solid", fgColor=GREY_SOFT),
    )

    # ---------------------------------------------------- needs a decision
    hard_rows = band("Fix - needs a decision")
    ws = wb.create_sheet("Needs a decision")
    columns = [
        ("Item code", 11), ("Current name", 44), ("Best attempt", 44),
        ("Why it could not be fixed", 60), ("Your name", 36),
    ]
    write_header(
        ws, columns, "Needs a decision — write the name yourself",
        "Each of these breaks the convention in a way no rule can settle. The best "
        "attempt is shown, but none of them is right without a person deciding.",
    )
    write_rows(
        ws,
        [{
            "code": x["code"], "current": x["current"], "proposed": x["proposed"],
            "remaining": x["remaining"], "yours": "",
        } for x in hard_rows],
        ["code", "current", "proposed", "remaining", "yours"],
        fill=PatternFill("solid", fgColor=RED_SOFT),
    )

    # ------------------------------------------------- optional field order
    opt_rows = band("Optional - field order")
    ws = wb.create_sheet("Optional field order")
    columns = [
        ("Item code", 11), ("Current name (correct)", 46),
        ("If you want strict field order", 46), ("Decision", 12), ("Category", 22),
    ]
    write_header(
        ws, columns, "Optional — field order only",
        "These are already compliant and are NOT being changed. The written standard "
        "puts the material after the item name, so \"1 1/2\\\" GI Union\" would become "
        "\"1 1/2\\\" Union GI\". Nothing enforces it and the store reads these daily, so "
        "it is offered rather than applied. Mark Approve on any row you want changed.",
    )
    r = write_rows(
        ws,
        [{
            "code": x["code"], "current": x["current"], "optional": x["optional"],
            "decision": "", "category": x["category"],
        } for x in opt_rows],
        ["code", "current", "optional", "decision", "category"],
        fill=PatternFill("solid", fgColor=ORANGE_SOFT),
    )
    decision_column(ws, 4, 5, r - 1)

    # ----------------------------------------------------------- duplicates
    groups = {}
    for row in rows:
        groups.setdefault(row["proposed"].upper(), []).append(row)
    dupes = [(k, v) for k, v in groups.items() if len(v) > 1]
    dupes.sort(key=lambda kv: -len(kv[1]))

    ws = wb.create_sheet("Duplicates")
    columns = [
        ("Name", 46), ("Item codes", 26), ("Already duplicated today", 22),
        ("Qty on hand", 14), ("Racks", 20),
    ]
    write_header(
        ws, columns, "Items sharing a name",
        "Two or more catalog entries that would carry the same name. Almost all of "
        "these are duplicated today as well, so the renaming is revealing them rather "
        "than creating them. Worth merging, separately from this exercise.",
    )
    write_rows(
        ws,
        [{
            "name": items[0]["proposed"],
            "codes": ", ".join(x["code"] for x in items),
            "already": "Yes" if len({x["current"].upper() for x in items}) == 1 else "No — new",
            "qty": sum(x["quantity"] for x in items),
            "racks": ", ".join(sorted({x["rack"] for x in items if x["rack"]})) or "—",
        } for _, items in dupes],
        ["name", "codes", "already", "qty", "racks"],
        fill=PatternFill("solid", fgColor=GREY_SOFT),
    )

    out = os.path.join(DATA, "MRPPL-Item-Renaming.xlsx")
    wb.save(out)

    print(f"Wrote {out}")
    print(f"  Renaming              {len(main_rows)}")
    print(f"  Needs the size        {len(size_rows)}")
    print(f"  Needs a decision      {len(hard_rows)}")
    print(f"  Optional field order  {len(opt_rows)}")
    print(f"  Duplicates            {len(dupes)} sets")


if __name__ == "__main__":
    main()
