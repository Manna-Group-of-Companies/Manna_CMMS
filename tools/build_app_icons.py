"""
Builds the Android launcher icon from the Manna Group logo.

    python tools/build_app_icons.py

Writes into mobile/android/app/src/main/res/:

    mipmap-<density>/ic_launcher.png             the legacy square icon
    mipmap-<density>/ic_launcher_foreground.png  the adaptive icon's front layer

The icon was a teal tile with a generic boxes glyph on it - teal being a colour
that is nowhere in the brand, left over from before the palette changed. This
puts the real mark on it.

The logo is 2.5:1 and a launcher icon is square, so it cannot simply be scaled:
squeezed to fit it distorts, and fitted by width it becomes a thin strip in a
big empty square. It is centred at a size that fills the width it can and left
with honest white around it, which is how the mark is used everywhere else on a
light ground.

Two layers, because Android needs both:

    legacy      the whole square, white, mark centred. Used below API 26 and by
                launchers that ignore adaptive icons.
    foreground  transparent, mark inside the safe zone. Android crops an
                adaptive icon to whatever shape the launcher wants - a circle, a
                squircle - and only the middle ~66% is guaranteed to survive, so
                anything outside that is drawn at its own risk.

Rendered through headless Chrome rather than an image library: it is already
used to produce the printed sheets, and it gets the scaling and the alpha right
without adding a dependency for one job.
"""

import base64
import io
import os
import shutil
import struct
import subprocess
import sys
import zlib

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO = os.path.join(BASE, "client", "public", "manna-logo.png")
RES = os.path.join(BASE, "mobile", "android", "app", "src", "main", "res")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# Android's density buckets. The legacy icon is 48dp, the adaptive layers 108dp.
DENSITIES = {
    "mdpi": 1,
    "hdpi": 1.5,
    "xhdpi": 2,
    "xxhdpi": 3,
    "xxxhdpi": 4,
}

LEGACY_DP = 48
ADAPTIVE_DP = 108

# How much of the square the mark takes. The legacy icon has the whole face to
# work with; the adaptive foreground has to stay inside the safe zone, so the
# mark is smaller and the padding around it is doing real work.
LEGACY_WIDTH = 86
FOREGROUND_WIDTH = 58


def logo_data_uri():
    if not os.path.exists(LOGO):
        raise SystemExit(f"logo not found: {LOGO}")
    return "data:image/png;base64," + base64.b64encode(io.open(LOGO, "rb").read()).decode()


# Chrome will not open a window narrower than roughly 500px, so a screenshot
# asked for at 48px is not a small render - it is the top-left corner of a
# 500px one. That silently produced a launcher icon cropped to half the "M".
# Everything is rendered once at this size and scaled down here instead.
MASTER = 1024


def read_png(path):
    """Decode an 8-bit RGB or RGBA PNG to raw bytes."""
    raw = io.open(path, "rb").read()
    pos, idat, ihdr = 8, b"", None
    while pos < len(raw):
        length = struct.unpack(">I", raw[pos:pos + 4])[0]
        kind = raw[pos + 4:pos + 8]
        if kind == b"IHDR":
            ihdr = raw[pos + 8:pos + 8 + length]
        elif kind == b"IDAT":
            idat += raw[pos + 8:pos + 8 + length]
        pos += 12 + length

    width, height, depth, colour = struct.unpack(">IIBB", ihdr[:10])
    if depth != 8 or colour not in (2, 6):
        raise SystemExit(f"expected 8-bit RGB/RGBA, got depth={depth} colour={colour}")

    channels = 4 if colour == 6 else 3
    stride = width * channels
    buf = zlib.decompress(idat)

    out, prev, p = bytearray(), bytearray(stride), 0
    for _ in range(height):
        filt = buf[p]
        p += 1
        line = bytearray(buf[p:p + stride])
        p += stride
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if filt == 1:
                line[i] = (line[i] + a) & 255
            elif filt == 2:
                line[i] = (line[i] + b) & 255
            elif filt == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif filt == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 255
        out += line
        prev = line

    # Normalise to RGBA so the resampler has one shape to deal with.
    if channels == 3:
        rgba = bytearray()
        for i in range(0, len(out), 3):
            rgba += out[i:i + 3] + bytes([255])
        return width, height, rgba
    return width, height, out


def resample(width, height, pixels, size):
    """Area average down to size x size, weighting colour by alpha."""
    out = bytearray()
    for oy in range(size):
        y0, y1 = oy * height // size, max(oy * height // size + 1, (oy + 1) * height // size)
        for ox in range(size):
            x0, x1 = ox * width // size, max(ox * width // size + 1, (ox + 1) * width // size)
            sa = sr = sg = sb = count = 0
            for y in range(y0, y1):
                for x in range(x0, x1):
                    i = (y * width + x) * 4
                    alpha = pixels[i + 3]
                    sr += pixels[i] * alpha
                    sg += pixels[i + 1] * alpha
                    sb += pixels[i + 2] * alpha
                    sa += alpha
                    count += 1
            if sa:
                out += bytes((sr // sa, sg // sa, sb // sa, sa // count))
            else:
                out += bytes((0, 0, 0, 0))
    return out


def write_png(path, size, rgba):
    lines = bytearray()
    for y in range(size):
        lines.append(0)
        lines += rgba[y * size * 4:(y + 1) * size * 4]

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data +
                struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    png = bytes([137, 80, 78, 71, 13, 10, 26, 10])  # the PNG signature
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(lines), 9))
    png += chunk(b"IEND", b"")
    io.open(path, "wb").write(png)


def render_master(html, out_path, transparent):
    """One big square PNG, well clear of Chrome's minimum window size."""
    page = os.path.join(os.path.dirname(out_path), "_icon.html")
    io.open(page, "w", encoding="utf-8").write(html)

    command = [
        CHROME,
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        f"--screenshot={out_path}",
        f"--window-size={MASTER},{MASTER}",
        "--force-device-scale-factor=1",
    ]
    if transparent:
        command.append("--default-background-color=00000000")
    command.append("file:///" + page.replace("\\", "/"))

    subprocess.run(command, capture_output=True, timeout=180)
    os.remove(page)
    if not os.path.exists(out_path):
        raise SystemExit(f"Chrome produced nothing for {out_path}")


def page_html(uri, width_percent, background):
    """The mark centred in a square, at the width this layer is allowed."""
    return (
        '<!doctype html><html><head><meta charset="utf-8"><style>'
        'html,body{margin:0;padding:0;width:100%;height:100%;background:' + background + ';}'
        '.wrap{width:100%;height:100%;display:flex;align-items:center;'
        'justify-content:center;}'
        'img{width:' + str(width_percent) + '%;height:auto;}'
        '</style></head><body><div class="wrap"><img src="' + uri + '"></div></body></html>'
    )


def main():
    uri = logo_data_uri()
    scratch = os.path.join(RES, "_master")
    os.makedirs(scratch, exist_ok=True)

    legacy_master = os.path.join(scratch, "legacy.png")
    front_master = os.path.join(scratch, "front.png")
    render_master(page_html(uri, LEGACY_WIDTH, "#FFFFFF"), legacy_master, transparent=False)
    render_master(page_html(uri, FOREGROUND_WIDTH, "transparent"), front_master, transparent=True)

    lw, lh, legacy_px = read_png(legacy_master)
    fw, fh, front_px = read_png(front_master)

    for density, scale in DENSITIES.items():
        folder = os.path.join(RES, f"mipmap-{density}")
        os.makedirs(folder, exist_ok=True)

        size = round(LEGACY_DP * scale)
        write_png(os.path.join(folder, "ic_launcher.png"), size,
                  resample(lw, lh, legacy_px, size))

        front = round(ADAPTIVE_DP * scale)
        write_png(os.path.join(folder, "ic_launcher_foreground.png"), front,
                  resample(fw, fh, front_px, front))

        print(f"  mipmap-{density:8} legacy {size}px, foreground {front}px")

    shutil.rmtree(scratch, ignore_errors=True)

    stale = os.path.join(RES, "drawable", "ic_launcher_foreground.xml")
    if os.path.exists(stale):
        os.remove(stale)
        print("  removed drawable/ic_launcher_foreground.xml (the old glyph)")

    print("written into " + RES)


if __name__ == "__main__":
    if not os.path.exists(CHROME):
        sys.exit(f"Chrome not found at {CHROME}")
    if shutil.which("python") is None:
        pass
    main()
