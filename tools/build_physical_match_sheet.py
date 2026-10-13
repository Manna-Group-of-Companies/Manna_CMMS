"""
Builds the physical stock matching workbooks for the Manna Rubber Products store.

    node server/scripts/matchPhysicalStock.js physical.json match.json          # the matching
    python tools/build_physical_match_sheet.py match.json matched.xlsx [standard.xlsx]

matched.xlsx  - the review workbook: one sheet per kind of match, so each pile
                can be worked on its own -
                  Exact matches     Exact + Strong: the same item once both names are
                                    read the same way (same sizes, same words)
                  Possible matches  Likely + Possible: something agrees; check each one
                  No match          nothing in SAP is close: probably not in SAP yet
                  SAP items not counted
                The Maintenance Manager confirms each row in the Decision column;
                nothing is applied from here.
standard.xlsx - the physical stock list itself with every item under its name in
                the SOI1/SOP1 standard format, the name as counted beside it, and
                the SAP item it is (exact) or is suspected to be (possible).
"""

import json
import sys

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

SRC, OUT = sys.argv[1], sys.argv[2]
OUT_STANDARD = sys.argv[3] if len(sys.argv) > 3 else None
data = json.load(open(SRC, encoding="utf-8"))
rows, unmatched = data["rows"], data["unmatchedSap"]

FONT = "Arial"
HEAD_FILL = PatternFill("solid", fgColor="1F3A4D")
HEAD_FONT = Font(name=FONT, bold=True, color="FFFFFF", size=10)
BODY = Font(name=FONT, size=10)
INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")
GRID = Border(bottom=Side(style="thin", color="D9D9D9"))
BAND_FILL = {"Exact": "C6EFCE", "Strong": "D9EAD3", "Likely": "FFF2CC", "Possible": "FCE4D6", "No match": "F2F2F2"}
SUGGEST = {
    "Exact": "Accept match",
    "Strong": "Accept match",
    "Likely": "Check, then accept or pick other",
    "Possible": "Check - probably a different item",
    "No match": "Not in SAP - add as new item",
}
DECISIONS = ["Accept match", "Pick other SAP item", "Not in SAP - add as new item", "Not an engineering item"]
PILES = [
    ("Exact matches", ("Exact", "Strong")),
    ("Possible matches", ("Likely", "Possible")),
    ("No match", ("No match",)),
]


def header(ws, cols):
    for i, (h, w) in enumerate(cols, 1):
        c = ws.cell(row=1, column=i, value=h)
        c.font, c.fill = HEAD_FONT, HEAD_FILL
        c.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 32
    return {h: i for i, (h, _) in enumerate(cols, 1)}


def put(ws, row, col, value, number_format=None):
    c = ws.cell(row=row, column=col, value=value)
    c.font, c.border = BODY, GRID
    if number_format:
        c.number_format = number_format
    return c


COUNT_COLS = [
    ("Old ID", 9), ("Name as counted", 34), ("Standard name", 34), ("Meets convention", 11), ("What the name still needs", 30),
    ("Category (count)", 18), ("Sub-category (count)", 18), ("Brand", 14), ("Location", 14), ("Condition", 13),
    ("Physical qty", 10), ("UOM", 8), ("Unit cost (Rs)", 11),
]
MATCH_COLS = [
    ("Match", 10), ("Score", 7), ("Caution", 18), ("Suggested action", 26),
    ("SAP code", 12), ("SAP item name", 34), ("SAP name, standard", 34), ("CMMS item", 16), ("SAP item group", 16), ("Sub-category A", 16),
    ("Qty in CMMS", 10), ("Physical - CMMS", 11), ("Also matched to", 16), ("Other candidates", 50),
]
NOMATCH_COLS = [("Match", 10), ("Suggested action", 26), ("Closest SAP items (none close enough)", 60)]
INPUT_COLS = [("Decision", 24), ("SAP code if picking other", 16), ("Notes", 28)]


def count_values(r):
    return {
        "Old ID": r["oldId"], "Name as counted": r["physicalName"], "Standard name": r["standardName"],
        "Meets convention": "Yes" if r["compliant"] else "No", "What the name still needs": r["issues"],
        "Category (count)": r["category"], "Sub-category (count)": r["subCategory"], "Brand": r["brand"],
        "Location": r["location"], "Condition": r["condition"], "Physical qty": r["physicalQty"], "UOM": r["uom"],
        "Unit cost (Rs)": r["unitCost"],
    }


def candidates(r):
    best = r.get("match")
    first = [f'{best["sapCode"] or best["code"]} {best["name"]} ({r["score"]})'] if best else []
    return "; ".join(first + (r.get("others") or []))


wb = Workbook()
wb.remove(wb.active)
ws0 = wb.create_sheet("Summary")

pile_refs = {}
for title, bands in PILES:
    ws = wb.create_sheet(title)
    is_none = bands == ("No match",)
    cols = COUNT_COLS + (NOMATCH_COLS if is_none else MATCH_COLS) + INPUT_COLS
    COL = header(ws, cols)
    pile = [r for r in rows if r["band"] in bands]
    for n, r in enumerate(pile, 2):
        for h, v in count_values(r).items():
            put(ws, n, COL[h], v, "#,##0.00" if h == "Unit cost (Rs)" else None)
        put(ws, n, COL["Match"], r["band"])
        put(ws, n, COL["Suggested action"], SUGGEST[r["band"]])
        if is_none:
            put(ws, n, COL["Closest SAP items (none close enough)"], candidates(r))
        else:
            m = r["match"]
            for h, v in {
                "Score": r["score"], "Caution": r.get("caution", ""), "SAP code": m["sapCode"], "SAP item name": m["name"],
                "SAP name, standard": m["standardName"], "CMMS item": m["code"], "SAP item group": m["group"],
                "Sub-category A": m["subA"], "Qty in CMMS": m["qty"], "Also matched to": r.get("sharedWith", ""),
                "Other candidates": "; ".join(r.get("others") or []),
            }.items():
                put(ws, n, COL[h], v)
            phys, cmms = get_column_letter(COL["Physical qty"]), get_column_letter(COL["Qty in CMMS"])
            put(ws, n, COL["Physical - CMMS"], f'=IF(AND(ISNUMBER({phys}{n}),ISNUMBER({cmms}{n})),{phys}{n}-{cmms}{n},"")')
        for h, _ in INPUT_COLS:
            ws.cell(row=n, column=COL[h]).fill = INPUT_FILL
            ws.cell(row=n, column=COL[h]).font = BODY
    last = max(len(pile) + 1, 2)
    mcol = get_column_letter(COL["Match"])
    for band in bands:
        ws.conditional_formatting.add(
            f"{mcol}2:{mcol}{last}",
            FormulaRule(formula=[f'${mcol}2="{band}"'], fill=PatternFill("solid", fgColor=BAND_FILL[band])),
        )
    dcol = get_column_letter(COL["Decision"])
    dv = DataValidation(type="list", formula1='"' + ",".join(DECISIONS) + '"', allow_blank=True)
    dv.error = "Pick one of the listed decisions."
    ws.add_data_validation(dv)
    dv.add(f"{dcol}2:{dcol}{last}")
    ws.freeze_panes = "D2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}{last}"
    ws.cell(row=1, column=COL["Decision"]).comment = Comment(
        "Yellow columns are yours to fill: Accept match / Pick other SAP item (give its code) / "
        "Not in SAP - add as new item / Not an engineering item.", "CMMS")
    pile_refs[title] = (mcol, dcol, last, get_column_letter(COL["Meets convention"]))

# ------------------------------------------------------------------ SAP items not counted
ws2 = wb.create_sheet("SAP items not counted")
COL2 = header(ws2, [("SAP code", 12), ("SAP item name", 40), ("SAP name, standard", 40), ("CMMS item", 18), ("SAP item group", 18), ("Sub-category A", 18), ("Qty in CMMS", 11), ("UOM", 8), ("Notes", 30)])
for n, u in enumerate(unmatched, 2):
    for i, v in enumerate([u["sapCode"], u["name"], u["standardName"], u["code"], u["group"], u["subA"], u["qty"], u["unit"]], 1):
        put(ws2, n, i, v)
    ws2.cell(row=n, column=9).fill = INPUT_FILL
ws2.freeze_panes = "B2"
ws2.auto_filter.ref = f"A1:I{len(unmatched) + 1}"

# ------------------------------------------------------------------ Summary
ws0.column_dimensions["A"].width = 34
ws0.column_dimensions["B"].width = 12
ws0.column_dimensions["C"].width = 80
ws0["A1"] = "Physical stock inspection - Manna Rubber Products store"
ws0["A1"].font = Font(name=FONT, bold=True, size=13)
ws0["A2"] = "Matched against the engineering items SAP holds for MANNA_RUBBER_LIVE (as mirrored in the CMMS)."
ws0["A2"].font = Font(name=FONT, italic=True, size=10, color="595959")
for c, v in zip(("A4", "B4", "C4"), ("Sheet / match", "Rows", "What it means")):
    ws0[c] = v
    ws0[c].font, ws0[c].fill = HEAD_FONT, HEAD_FILL
meaning = {
    "Exact": "Exact matches sheet. Same name once both are in the standard format.",
    "Strong": "Exact matches sheet. Same sizes, most words the same, no material clash - the same item, named differently.",
    "Likely": "Possible matches sheet. Same sizes and most words; worth a glance.",
    "Possible": "Possible matches sheet. Something agrees, but a size, material or key word differs - usually a different item.",
    "No match": "No match sheet. No SAP item is close: probably not in SAP yet - add it in Engineering Stock with its opening quantity.",
}
sheet_of = {b: t for t, bands in PILES for b in bands}
r0 = 5
for i, (band, text) in enumerate(meaning.items()):
    row = r0 + i
    mcol = pile_refs[sheet_of[band]][0]
    ws0.cell(row=row, column=1, value=band).fill = PatternFill("solid", fgColor=BAND_FILL[band])
    ws0.cell(row=row, column=2, value=f"=COUNTIF('{sheet_of[band]}'!{mcol}:{mcol},A{row})")
    ws0.cell(row=row, column=3, value=text)
total = r0 + len(meaning)
ws0.cell(row=total, column=1, value="Total counted")
ws0.cell(row=total, column=2, value=f"=SUM(B{r0}:B{total - 1})")
conv = "+".join(f"COUNTIF('{t}'!{ref[3]}:{ref[3]},\"Yes\")" for t, ref in pile_refs.items())
ws0.cell(row=total + 2, column=1, value="Standard names meeting the convention")
ws0.cell(row=total + 2, column=2, value=f"={conv}")
ws0.cell(row=total + 2, column=3, value="The rest carry no size in the counted name - the size has to be read off the item.")
ws0.cell(row=total + 3, column=1, value="SAP items not found in the count")
ws0.cell(row=total + 3, column=2, value="=COUNTA('SAP items not counted'!A:A)-1")
ws0.cell(row=total + 4, column=1, value="Decisions made so far")
decided = "+".join(f"COUNTA('{t}'!{ref[1]}2:{ref[1]}{ref[2]})" for t, ref in pile_refs.items())
ws0.cell(row=total + 4, column=2, value=f"={decided}")
notes = [
    "How to use: work through the three match sheets. The yellow columns are yours; everything else is generated.",
    "A different size or material is treated as a different item: those never score above Possible.",
    "'Also matched to' lists other counted rows matched to the same SAP item - two counted items cannot both be one SAP item.",
    "Qty in CMMS is the stock SAP gave the CMMS (opening stock, 24 Sep 2026); Physical - CMMS is the difference the count found.",
    "Source: PhysicalStock.xlsx (Downloads), 654 rows SAP1-SAP654; SAP items from ERPNext, read 9 Oct 2026.",
]
for i, t in enumerate(notes):
    ws0.cell(row=total + 6 + i, column=1, value=t).font = Font(name=FONT, size=10, color="404040")
for row in ws0.iter_rows(min_row=4, max_row=total + 4):
    for c in row:
        if not (c.font and c.font.bold):
            c.font = Font(name=FONT, size=10)

wb.save(OUT)
print("wrote", OUT, "-", ", ".join(f"{t}: {sum(1 for r in rows if r['band'] in b)}" for t, b in PILES), f"- SAP items not counted: {len(unmatched)}")

# ------------------------------------------------------------------ the physical stock under standard names
if OUT_STANDARD:
    MATCH_KIND = {"Exact": "Exact", "Strong": "Exact", "Likely": "Suspected", "Possible": "Suspected", "No match": "None"}
    wb2 = Workbook()
    ws = wb2.active
    ws.title = "Physical stock"
    cols = [
        ("SAPID", 9), ("Product Name (standard)", 36), ("Name as counted", 32), ("Meets convention", 11),
        ("Main Category", 18), ("Sub-Category", 18), ("Status", 14), ("Brand", 14), ("Location", 14),
        ("Stock Available", 10), ("UOM", 8), ("Unit Cost", 11),
        ("SAP match", 11), ("SAP code", 12), ("SAP item name", 34), ("CMMS item", 16), ("Match score", 9), ("Caution", 20),
    ]
    COL = header(ws, cols)
    fills = {"Exact": "C6EFCE", "Suspected": "FFF2CC", "None": "F2F2F2"}
    for n, r in enumerate(rows, 2):
        kind = MATCH_KIND[r["band"]]
        m = r.get("match") if kind != "None" else None
        values = [
            r["oldId"], r["standardName"], r["physicalName"], "Yes" if r["compliant"] else "No",
            r["category"], r["subCategory"], r["condition"], r["brand"], r["location"],
            r["physicalQty"], r["uom"], r["unitCost"],
            kind, m and m["sapCode"], m and m["name"], m and m["code"], r["score"] if m else None, r.get("caution", "") if m else "",
        ]
        for i, v in enumerate(values, 1):
            put(ws, n, i, v, "#,##0.00" if i == COL["Unit Cost"] else None)
    last = len(rows) + 1
    kcol = get_column_letter(COL["SAP match"])
    for kind, color in fills.items():
        ws.conditional_formatting.add(f"{kcol}2:{kcol}{last}", FormulaRule(formula=[f'${kcol}2="{kind}"'], fill=PatternFill("solid", fgColor=color)))
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}{last}"
    ws.cell(row=1, column=COL["Product Name (standard)"]).comment = Comment(
        "The counted name in the SOI1/SOP1 format: sizes first, then the item name, type, material and serial "
        "number. Sizes are never invented - where none was counted the name is marked 'No' in Meets convention.", "CMMS")
    ws.cell(row=1, column=COL["SAP match"]).comment = Comment(
        "Exact = the same SAP item (Exact or Strong in the review workbook). Suspected = probably, check it "
        "(Likely or Possible). None = no SAP item is close.", "CMMS")
    legend = wb2.create_sheet("Read me")
    legend.column_dimensions["A"].width = 110
    for i, t in enumerate([
        "The physical stock inspection of the Manna Rubber Products store, every item under its standard name.",
        "SAP match - Exact: the SAP item it is. Suspected: the SAP item it probably is - confirm before relying on it. None: not found in SAP.",
        "The review workbook (PhysicalStock-MRPPL-Matched.xlsx) has the same rows split by match, with alternatives and a Decision column.",
        "Source: PhysicalStock.xlsx (Downloads), 654 rows SAP1-SAP654; SAP items from ERPNext, read 9 Oct 2026.",
    ], 1):
        legend.cell(row=i, column=1, value=t).font = Font(name=FONT, size=10, bold=(i == 1))
    wb2.save(OUT_STANDARD)
    print("wrote", OUT_STANDARD, "-", ", ".join(f"{k}: {sum(1 for r in rows if MATCH_KIND[r['band']] == k)}" for k in fills))
