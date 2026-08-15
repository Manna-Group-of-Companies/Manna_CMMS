/**
 * Gives every product a thumbnail, keyed on its category.
 *
 * The catalog imported from the transaction ledger carries no photographs, and
 * there is no honest way to invent one per part — a picture of the wrong belt
 * is worse than no picture at all. What each product does have is a category,
 * so this draws one colour-coded tile per category and stores it inline on the
 * product. A store keeper scanning a list gets a usable visual grouping, and
 * nothing claims to be a photograph of that specific item.
 *
 *   node scripts/addProductImages.js [--all] [--dry-run] [--write-samples <dir>]
 *
 *   --all              Also replace images on products that already have one
 *   --dry-run          Report what would change; write nothing
 *   --write-samples    Save the generated PNGs to a folder so they can be eyeballed
 *
 * PNG rather than SVG, and inline rather than a URL, for two reasons that are
 * easy to trip over:
 *
 *   The Flutter client decodes inline images with `Image.memory` (see
 *   ProductThumb in mobile/lib/widgets/common.dart), which handles raster
 *   formats only. An SVG data URI would decode to nothing and quietly fall
 *   back to the placeholder icon.
 *
 *   The store runs on the shop floor. Inline images render with no network and
 *   no third-party host that can rot, unlike the Unsplash links the original
 *   seed data used.
 */
import path from "path";
import { mkdirSync, writeFileSync } from "fs";
import zlib from "zlib";
import mongoose from "mongoose";
import dotenv from "dotenv";

import Product from "../models/Product.js";

dotenv.config();

const SIZE = 128;

/**
 * Category → tile colour and short code. Hues are spread so that two
 * categories are never a glance apart in a list; the code is what actually
 * identifies the tile, the colour just groups it.
 */
const CATEGORY_STYLES = {
  "Anchor Bolts": { code: "ANC", color: "#B45309" },
  Bearings: { code: "BRG", color: "#0F766E" },
  Belts: { code: "BLT", color: "#4338CA" },
  "Cutting and Grinding Equipments": { code: "CUT", color: "#BE123C" },
  // Darker than the rest of the amber family on purpose: white on #CA8A04
  // measures under 3:1 and the code stops being readable on a phone outdoors.
  "Electrical Equipments": { code: "ELE", color: "#A16207" },
  "Fasteners(INCH)": { code: "FIN", color: "#0369A1" },
  "Fasteners(MM)": { code: "FMM", color: "#1D4ED8" },
  "Pipe Fittings": { code: "PIP", color: "#15803D" },
  Tools: { code: "TLS", color: "#6D28D9" },
  "Welding Equipments and Accessories": { code: "WLD", color: "#EA580C" },
};

/** Anything the list above does not name still gets a tile rather than a blank. */
const FALLBACK_STYLE = { code: "GEN", color: "#475569" };

// A 5x7 bitmap face. Hand-held here because pulling in a font renderer to draw
// three letters would be a heavier dependency than the drawing code itself.
const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
};

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Moves a colour towards black; used for the border and the inner shade. */
const darken = ([r, g, b], amount) => [
  Math.round(r * (1 - amount)),
  Math.round(g * (1 - amount)),
  Math.round(b * (1 - amount)),
];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** Encodes RGBA pixels as a PNG. Filter 0 on every scanline; zlib does the rest. */
const encodePng = (pixels, width, height) => {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/** Draws the tile: rounded body, darker rim, category code centred in white. */
const renderTile = ({ code, color }) => {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const base = hexToRgb(color);
  const rim = darken(base, 0.35);
  const radius = 18;

  const set = (x, y, [r, g, b], a = 255) => {
    const i = (y * SIZE + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  };

  // Rounded square. Corners outside the radius stay fully transparent so the
  // tile sits cleanly on any background the two clients use.
  const inCorner = (x, y) => {
    const cx = x < radius ? radius : x >= SIZE - radius ? SIZE - 1 - radius : x;
    const cy = y < radius ? radius : y >= SIZE - radius ? SIZE - 1 - radius : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!inCorner(x, y)) continue;
      const edge = x < 3 || y < 3 || x >= SIZE - 3 || y >= SIZE - 3;
      set(x, y, edge ? rim : base);
    }
  }

  const glyphs = [...code].map((char) => FONT[char]).filter(Boolean);
  const scale = 5;
  const gap = scale;
  const textWidth = glyphs.length * 5 * scale + (glyphs.length - 1) * gap;
  const textHeight = 7 * scale;
  let originX = Math.round((SIZE - textWidth) / 2);
  const originY = Math.round((SIZE - textHeight) / 2);

  for (const glyph of glyphs) {
    glyph.forEach((rowBits, row) => {
      [...rowBits].forEach((bit, column) => {
        if (bit !== "1") return;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            set(originX + column * scale + dx, originY + row * scale + dy, [255, 255, 255]);
          }
        }
      });
    });
    originX += 5 * scale + gap;
  }

  return encodePng(pixels, SIZE, SIZE);
};

const styleFor = (category) => CATEGORY_STYLES[category] || FALLBACK_STYLE;

const run = async () => {
  const argv = process.argv.slice(2);
  const all = argv.includes("--all");
  const dryRun = argv.includes("--dry-run");
  const samplesAt = argv.includes("--write-samples") ? argv[argv.indexOf("--write-samples") + 1] : null;

  // Rendered once per category, not once per product: the tiles are identical
  // within a category and encoding is the slow part.
  const tiles = new Map();
  const tileFor = (category) => {
    const style = styleFor(category);
    if (!tiles.has(style.code)) {
      const png = renderTile(style);
      tiles.set(style.code, { style, png, dataUri: `data:image/png;base64,${png.toString("base64")}` });
    }
    return tiles.get(style.code);
  };

  if (samplesAt) {
    const dir = path.resolve(samplesAt);
    mkdirSync(dir, { recursive: true });
    for (const category of [...Object.keys(CATEGORY_STYLES), "__fallback__"]) {
      const tile = tileFor(category);
      writeFileSync(path.join(dir, `${tile.style.code}.png`), tile.png);
    }
    console.log(`Wrote ${tiles.size} sample tile(s) to ${dir}`);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB Connected");

  const filter = all ? {} : { $or: [{ image: "" }, { image: { $exists: false } }, { image: null }] };
  const products = await Product.find(filter).select("code name category image");

  console.log(`${products.length} product(s) ${all ? "in the catalog" : "without an image"}.`);

  const counts = new Map();
  for (const product of products) {
    const tile = tileFor(product.category);
    counts.set(tile.style.code, (counts.get(tile.style.code) || 0) + 1);
    if (!dryRun) {
      await Product.updateOne({ _id: product._id }, { $set: { image: tile.dataUri } });
    }
  }

  console.table(
    [...counts.entries()].map(([code, n]) => {
      const category =
        Object.keys(CATEGORY_STYLES).find((key) => CATEGORY_STYLES[key].code === code) || "(other)";
      const tile = [...tiles.values()].find((t) => t.style.code === code);
      return { code, category, products: n, color: tile.style.color, bytes: tile.png.length };
    })
  );

  console.log(
    dryRun
      ? "Dry run: nothing was written."
      : `Updated ${products.length} product(s) with a category thumbnail.`
  );
};

run()
  .catch((error) => {
    console.error(`\nFailed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
