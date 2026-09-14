"""
Trims the empty margin off the Manna Group logo.

    python tools/crop_logo.py <source.png> <destination.png>

The artwork as supplied sits in a 1241x622 canvas but only occupies
1013x386 of it, and not centred - 104px of white above and 132px below. Laying
that out by the file's box makes the mark about 60% of the height it should be
and sits it high in its container, which is why the header spacing looked wrong
however the CSS was adjusted. The margin was in the image, not the layout.

This finds the real bounds, keeps a small even margin, and writes a tight PNG.
Pure zlib and struct: adding Pillow to the toolchain for one crop is not worth
the dependency.
"""

import io
import os
import struct
import sys
import zlib

# A little air so the mark never looks clipped against its container's edge.
MARGIN = 16
NEAR_WHITE = 240


def read_png(path):
    raw = io.open(path, "rb").read()
    pos, idat, ihdr = 8, b"", None
    while pos < len(raw):
        ln = struct.unpack(">I", raw[pos : pos + 4])[0]
        typ = raw[pos + 4 : pos + 8]
        data = raw[pos + 8 : pos + 8 + ln]
        if typ == b"IHDR":
            ihdr = data
        elif typ == b"IDAT":
            idat += data
        pos += 12 + ln

    w, h, depth, ctype = struct.unpack(">IIBB", ihdr[:10])
    if depth != 8 or ctype not in (2, 6):
        raise SystemExit(f"expected 8-bit RGB or RGBA, got depth={depth} colour-type={ctype}")

    channels = 4 if ctype == 6 else 3
    stride = w * channels
    buf = zlib.decompress(idat)

    # Undo the per-scanline filters. Every PNG uses them; there is no raw mode.
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        f = buf[p]
        p += 1
        line = bytearray(buf[p : p + stride])
        p += stride
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out += line
        prev = line

    return w, h, channels, out


def bounds(w, h, channels, pixels):
    """Where the ink actually is: anything not near-white and not transparent."""
    stride = w * channels
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        row = pixels[y * stride : (y + 1) * stride]
        for x in range(w):
            px = row[x * channels : (x + 1) * channels]
            if channels == 4 and px[3] <= 16:
                continue
            if px[0] > NEAR_WHITE and px[1] > NEAR_WHITE and px[2] > NEAR_WHITE:
                continue
            minx = min(minx, x)
            maxx = max(maxx, x)
            miny = min(miny, y)
            maxy = max(maxy, y)
    return minx, miny, maxx, maxy


def write_png(path, w, h, channels, pixels):
    stride = w * channels
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter 0: the image is small, the saving is not worth it
        raw += pixels[y * stride : (y + 1) * stride]

    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6 if channels == 4 else 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    io.open(path, "wb").write(png)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: python tools/crop_logo.py <source.png> <destination.png>")
    src, dst = sys.argv[1], sys.argv[2]

    w, h, channels, pixels = read_png(src)
    minx, miny, maxx, maxy = bounds(w, h, channels, pixels)
    print(f"source {w}x{h}, artwork at x {minx}..{maxx} y {miny}..{maxy}")

    x0 = max(0, minx - MARGIN)
    y0 = max(0, miny - MARGIN)
    x1 = min(w - 1, maxx + MARGIN)
    y1 = min(h - 1, maxy + MARGIN)
    nw, nh = x1 - x0 + 1, y1 - y0 + 1

    stride = w * channels
    cropped = bytearray()
    for y in range(y0, y1 + 1):
        cropped += pixels[y * stride + x0 * channels : y * stride + (x1 + 1) * channels]

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    write_png(dst, nw, nh, channels, cropped)
    print(f"written {dst}  {nw}x{nh}  ratio {nw/nh:.2f}:1")


main()
