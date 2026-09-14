"""
Exports every preventive-maintenance checklist to one workbook for review.

    python tools/export_checklists.py

Writes data/checklists/Checklists-for-review.xlsx - one sheet per frequency,
one row per checkpoint, with an empty column on the right to write changes in.

The point is to be markable. The checklists live in ERPNext as 62 separate
records, and reviewing them there means opening 62 forms; this puts every point
on one screen, grouped the way the work is actually scheduled, so a whole
frequency can be read in one pass and argued with.

Reads the ERPNext key from server/.env and never prints it. Nothing is written
back - this is a read-only export, and the workbook is a comment sheet rather
than an import format.
"""

import collections
import io
import json
import os
import urllib.parse
import urllib.request

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "data", "checklists")

ORANGE = "D14A0C"
INK = "2E2D30"
SAFETY_FILL = "FDE7E7"

FREQUENCIES = ["Daily", "Weekly", "Monthly", "Quarterly", "Half-Yearly", "Yearly"]


def erp_env():
    """The URL and key, straight out of server/.env. Never printed."""
    env = {}
    path = os.path.join(BASE, "server", ".env")
    for line in io.open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()

    missing = [
        k for k in ("ERPNEXT_URL", "ERPNEXT_API_KEY", "ERPNEXT_API_SECRET") if not env.get(k)
    ]
    if missing:
        raise SystemExit("server/.env is missing: " + ", ".join(missing))
    return env


ENV = erp_env()
AUTH = "token {0}:{1}".format(ENV["ERPNEXT_API_KEY"], ENV["ERPNEXT_API_SECRET"])


def get(path, params=None):
    url = ENV["ERPNEXT_URL"] + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"Authorization": AUTH})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode())


def fetch_checklists():
    """
    The list, then each record in full.

    Two calls per checklist rather than one big query, because the points are a
    child table and Frappe does not return child tables from a list call - a
    single query would give 62 headers and no content at all.
    """
    listing = get(
        "/api/resource/CMMS%20Checklist",
        {
            "fields": json.dumps(["name"]),
            "limit_page_length": 500,
            "order_by": "name asc",
        },
    )["data"]

    docs = []
    for i, row in enumerate(listing, 1):
        docs.append(get("/api/resource/CMMS%20Checklist/" + urllib.parse.quote(row["name"]))["data"])
        print("  read {0}/{1}".format(i, len(listing)), end="\r")
    print(" " * 40, end="\r")
    return docs


HEAD_FONT = Font(bold=True, color="FFFFFF", size=10)
HEAD_FILL = PatternFill("solid", fgColor=INK)
THIN = Side(style="thin", color="C9C2BA")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")
TOP = Alignment(vertical="top")

# The last column is the reason the file exists.
COLUMNS = [
    ("Checklist", 12),
    ("Title", 30),
    ("Asset", 26),
    ("Plant", 20),
    ("Done by", 14),
    ("Mins", 6),
    ("#", 5),
    ("What to check", 46),
    ("How", 34),
    ("Safety", 8),
    ("CHANGE REQUESTED", 40),
]

# Indices shift when Section and Acceptable come out of COLUMNS.
WRAPPED_COLUMNS = {2, 3, 7, 8, 11}


def write_sheet(workbook, frequency, docs):
    sheet = workbook.create_sheet(frequency)
    sheet.freeze_panes = "A2"

    for column, (label, width) in enumerate(COLUMNS, 1):
        cell = sheet.cell(row=1, column=column, value=label)
        cell.font = HEAD_FONT
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(vertical="center")
        sheet.column_dimensions[get_column_letter(column)].width = width

    row = 2
    for doc in docs:
        asset = (
            doc.get("machine_name")
            or doc.get("system_name")
            or doc.get("machine")
            or doc.get("electrical_system")
            or ""
        )
        points = doc.get("points") or []

        # A checklist with no points is the most useful thing this export can
        # surface: a scheduled round that tells nobody what to do.
        if not points:
            points = [{"point": "(this checklist has no points on it)"}]

        # "Before you start" goes above the points, not in a column. It is meant
        # to be read before anybody touches the machine, not at item nine.
        if doc.get("safety_note"):
            cell = sheet.cell(
                row=row,
                column=1,
                value="{0} - BEFORE YOU START: {1}".format(doc["name"], doc["safety_note"]),
            )
            cell.font = Font(bold=True, size=9, color="9B1C1C")
            cell.alignment = WRAP
            cell.fill = PatternFill("solid", fgColor=SAFETY_FILL)
            sheet.merge_cells(
                start_row=row, start_column=1, end_row=row, end_column=len(COLUMNS)
            )
            row += 1

        for number, point in enumerate(points, 1):
            values = [
                doc["name"],
                doc.get("title") or "",
                asset,
                doc.get("plant") or "",
                doc.get("responsibility") or "",
                doc.get("estimated_minutes") or "",
                number,
                point.get("point") or "",
                point.get("how_to_check") or "",
                "SAFETY" if point.get("is_safety") else "",
                "",
            ]
            for column, value in enumerate(values, 1):
                cell = sheet.cell(row=row, column=column, value=value)
                cell.border = BORDER
                cell.alignment = WRAP if column in WRAPPED_COLUMNS else TOP
                cell.font = Font(size=9, bold=(number == 1 and column == 2))
                if point.get("is_safety"):
                    cell.fill = PatternFill("solid", fgColor=SAFETY_FILL)
            row += 1

        # A blank row between checklists, so the eye finds the breaks.
        row += 1

    return sheet


def write_summary(workbook, docs):
    sheet = workbook.create_sheet("Summary", 0)
    for column, width in zip("ABCDE", (18, 12, 10, 10, 70)):
        sheet.column_dimensions[column].width = width

    sheet["A1"] = "Preventive maintenance checklists"
    sheet["A1"].font = Font(bold=True, size=14, color=INK)
    sheet["A2"] = (
        "One tab per frequency. Write what you want changed in the last column of each tab."
    )
    sheet["A2"].font = Font(size=10, italic=True, color="6B646C")

    row = 4
    for column, label in enumerate(
        ["Frequency", "Checklists", "Points", "Empty", "Assets covered"], 1
    ):
        cell = sheet.cell(row=row, column=column, value=label)
        cell.font = HEAD_FONT
        cell.fill = HEAD_FILL
    row += 1

    grouped = group_by_frequency(docs)
    for frequency in ordered_frequencies(grouped):
        group = grouped[frequency]
        points = sum(len(d.get("points") or []) for d in group)
        empty = sum(1 for d in group if not (d.get("points") or []))
        assets = sorted(
            {
                (d.get("machine_name") or d.get("system_name") or d.get("machine") or "?")
                for d in group
            }
        )
        values = [frequency, len(group), points, empty or "", ", ".join(assets)[:300]]
        for column, value in enumerate(values, 1):
            cell = sheet.cell(row=row, column=column, value=value)
            cell.font = Font(size=10, bold=(column == 1))
            cell.alignment = WRAP if column == 5 else TOP
        row += 1

    return sheet


def group_by_frequency(docs):
    grouped = collections.defaultdict(list)
    for doc in docs:
        grouped[doc.get("frequency") or "(blank)"].append(doc)
    return grouped


def ordered_frequencies(grouped):
    """Scheduled order first, then anything unexpected rather than dropping it."""
    known = [f for f in FREQUENCIES if f in grouped]
    return known + sorted(set(grouped) - set(FREQUENCIES))


def main():
    print("Reading checklists from ERPNext...")
    docs = fetch_checklists()
    print("  {0} checklists".format(len(docs)))

    workbook = Workbook()
    workbook.remove(workbook.active)

    grouped = group_by_frequency(docs)
    for frequency in ordered_frequencies(grouped):
        group = grouped[frequency]
        group.sort(key=lambda d: (d.get("plant") or "", d.get("title") or ""))
        write_sheet(workbook, frequency, group)
        print(
            "  {0}: {1} checklists, {2} points".format(
                frequency, len(group), sum(len(d.get("points") or []) for d in group)
            )
        )

    write_summary(workbook, docs)

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "Checklists-for-review.xlsx")
    workbook.save(out)
    print("\nwritten: " + out)


main()
