"""
Builds the blank machine dossier - the Word document the maintenance manager
fills in for one machine and uploads against it in Asset Management.

Headings only. Nothing about any machine is stated here and no field is given a
suggested answer, because the point of the exercise is that somebody stands in
front of the machine and writes down what is actually there. A template that
pre-supplies plausible content gets returned with the pre-supplied content
still in it.

The structure is the whole contribution: the same sections in the same order
for every machine, so twenty-three dossiers can be read against each other and
a missing section is visible as a missing section rather than as an omission
nobody notices.

Written as a real .docx rather than HTML handed to Word - unlike the survey
form next to it. A .docx is a zip of XML and `zipfile` is in the standard
library, so this needs no python-docx and produces a file that opens, fills in
and uploads without a conversion step in the middle.

    python tools/build_machine_dossier.py

Output: data/machine-dossier/MRPPL-Machine-Dossier-Template.docx
"""

import os
import zipfile

# Manna orange from the group logo, and the charcoal that sits with it. Same
# palette as the survey form and the log sheet.
ORANGE = "D14A0C"
CHARCOAL = "2E2D30"
GREY = "6B646C"
RULE = "BDB3AA"

# ---------------------------------------------------------------- the content

INTRO = (
    "One dossier per machine. Complete every section; where a section does not "
    "apply to this machine, write “not applicable” rather than leaving it "
    "blank, so that a gap can be told from an omission. Upload the finished "
    "file against the machine in Asset Management."
)

IDENTIFICATION = [
    "Machine code",
    "Machine name",
    "Plant",
    "Area / section",
    "Prepared by",
    "Date",
    "Revision",
]

# Each sub-assembly is described the same way, so that the fourth one is
# recorded to the same depth as the first.
SUB_ASSEMBLY_HEADINGS = [
    "Function",
    "Components",
    "Wear parts and expected life",
    "Lubrication",
    "Known failure modes",
]

SUB_ASSEMBLY_BLOCKS = 3

SECTIONS = [
    "Function and Process Role",
    "Location and Installation",
    "Technical Specification",
    "Drive and Power Transmission",
    "Electrical Supply, Control and Instrumentation",
    "Utilities and Services",
    "Safety Devices and Guarding",
    "Sub-Assemblies and Components",  # expanded below; kept in place for order
    "Lubrication",
    "Wear Parts and Spares",
    "Operating Parameters and Limits",
    "Start-up, Shutdown and Isolation",
    "Known Problems and Failure History",
    "Drawings, Manuals and Documents Held",
    "Supplier and Service Contacts",
    "Additional Notes",
]

SUB_ASSEMBLY_SECTION = "Sub-Assemblies and Components"

SUB_ASSEMBLY_NOTE = (
    "Copy the block below for each further sub-assembly. A machine with more "
    "sub-assemblies than blocks is the normal case, not an exception."
)

# ------------------------------------------------------------------- the xml

def esc(text):
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def para(text="", style=None, spacing_after=None):
    """One paragraph. Empty text gives the blank line somebody writes on."""
    props = []
    if style:
        props.append(f'<w:pStyle w:val="{style}"/>')
    if spacing_after is not None:
        props.append(f'<w:spacing w:after="{spacing_after}"/>')
    p_pr = f"<w:pPr>{''.join(props)}</w:pPr>" if props else ""
    run = f"<w:r><w:t xml:space=\"preserve\">{esc(text)}</w:t></w:r>" if text else ""
    return f"<w:p>{p_pr}{run}</w:p>"


def blank(count=1):
    return "".join(para() for _ in range(count))


def rule():
    """A thin ruled line: writing space that reads as writing space."""
    return (
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" '
        f'w:color="{RULE}"/></w:pBdr><w:spacing w:before="0" w:after="220"/>'
        "</w:pPr></w:p>"
    )


def lines(count):
    return "".join(rule() for _ in range(count))


def identification_table(labels):
    """Labels down the left, empty cells to fill on the right."""
    rows = []
    for label in labels:
        rows.append(
            "<w:tr>"
            '<w:tc><w:tcPr><w:tcW w:w="1800" w:type="pct"/>'
            f'<w:shd w:val="clear" w:fill="F7F3F0"/></w:tcPr>'
            f'{para(label, style="FieldLabel")}</w:tc>'
            '<w:tc><w:tcPr><w:tcW w:w="3200" w:type="pct"/></w:tcPr>'
            f"{para()}</w:tc>"
            "</w:tr>"
        )
    return (
        "<w:tbl><w:tblPr>"
        '<w:tblW w:w="5000" w:type="pct"/>'
        "<w:tblBorders>"
        + "".join(
            f'<w:{edge} w:val="single" w:sz="4" w:space="0" w:color="{RULE}"/>'
            for edge in ("top", "left", "bottom", "right", "insideH", "insideV")
        )
        + "</w:tblBorders>"
        '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/>'
        '<w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>'
        "</w:tblPr>"
        '<w:tblGrid><w:gridCol w:w="3100"/><w:gridCol w:w="6260"/></w:tblGrid>'
        + "".join(rows)
        + "</w:tbl>"
    )


def build_body():
    out = [
        para("Machine Dossier", style="DocTitle"),
        para(INTRO, style="Intro"),
        identification_table(IDENTIFICATION),
        blank(1),
    ]

    for number, heading in enumerate(SECTIONS, start=1):
        out.append(para(f"{number}.  {heading}", style="Heading1"))

        if heading == SUB_ASSEMBLY_SECTION:
            out.append(para(SUB_ASSEMBLY_NOTE, style="Intro"))
            for block in range(1, SUB_ASSEMBLY_BLOCKS + 1):
                out.append(para(f"{number}.{block}  Sub-assembly", style="Heading2"))
                out.append(lines(1))
                for sub in SUB_ASSEMBLY_HEADINGS:
                    out.append(para(sub, style="Heading3"))
                    out.append(lines(2))
            continue

        out.append(lines(4))

    # A4 portrait, 20 mm margins.
    out.append(
        "<w:sectPr>"
        '<w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" '
        'w:header="708" w:footer="708" w:gutter="0"/>'
        "</w:sectPr>"
    )
    return "".join(out)


DOCUMENT = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    "<w:body>{body}</w:body></w:document>"
)


def style(style_id, name, *, size, color, bold=False, before=0, after=120,
          outline=None, italic=False, caps=False):
    """One paragraph style. Half-points for size, twentieths for spacing."""
    outline_xml = f'<w:outlineLvl w:val="{outline}"/>' if outline is not None else ""
    return (
        f'<w:style w:type="paragraph" w:styleId="{style_id}">'
        f'<w:name w:val="{name}"/><w:basedOn w:val="Normal"/><w:qFormat/>'
        f'<w:pPr><w:spacing w:before="{before}" w:after="{after}"/>{outline_xml}</w:pPr>'
        f"<w:rPr>"
        f'<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>'
        + ("<w:b/>" if bold else "")
        + ("<w:i/>" if italic else "")
        + ("<w:caps/>" if caps else "")
        + f'<w:color w:val="{color}"/><w:sz w:val="{size * 2}"/>'
        f"</w:rPr></w:style>"
    )


STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    "<w:docDefaults><w:rPrDefault><w:rPr>"
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/>'
    f'<w:color w:val="{CHARCOAL}"/>'
    "</w:rPr></w:rPrDefault></w:docDefaults>"
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
    '<w:name w:val="Normal"/><w:qFormat/>'
    '<w:pPr><w:spacing w:after="120"/></w:pPr></w:style>'
    # `w:name` values matter: Word maps its built-in heading styles by name, so
    # these appear in the Navigation Pane and in a generated contents page.
    + style("DocTitle", "Title", size=20, color=ORANGE, bold=True, after=80, caps=True)
    + style("Intro", "Subtitle", size=9, color=GREY, italic=True, after=280)
    + style("Heading1", "heading 1", size=13, color=ORANGE, bold=True,
            before=320, after=140, outline=0)
    + style("Heading2", "heading 2", size=11, color=CHARCOAL, bold=True,
            before=200, after=100, outline=1)
    + style("Heading3", "heading 3", size=9, color=GREY, bold=True,
            before=120, after=80, outline=2, caps=True)
    + style("FieldLabel", "Field Label", size=9, color=GREY, bold=True, after=0)
    + "</w:styles>"
)

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    "</Types>"
)

ROOT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    "</Relationships>"
)

DOC_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    "</Relationships>"
)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "data", "machine-dossier")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.abspath(
        os.path.join(out_dir, "MRPPL-Machine-Dossier-Template.docx")
    )

    parts = {
        "[Content_Types].xml": CONTENT_TYPES,
        "_rels/.rels": ROOT_RELS,
        "word/_rels/document.xml.rels": DOC_RELS,
        "word/document.xml": DOCUMENT.format(body=build_body()),
        "word/styles.xml": STYLES,
    }

    # [Content_Types].xml has to be the first entry in the archive; Word is
    # forgiving about it and other readers are not.
    order = [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/_rels/document.xml.rels",
        "word/document.xml",
        "word/styles.xml",
    ]

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in order:
            z.writestr(name, parts[name].encode("utf-8"))

    print(f"Wrote {out_path}")
    print(f"  {len(SECTIONS)} sections, {SUB_ASSEMBLY_BLOCKS} sub-assembly blocks")


if __name__ == "__main__":
    main()
