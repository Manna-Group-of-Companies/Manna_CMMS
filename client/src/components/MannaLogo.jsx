import { useState } from "react";
import { Boxes } from "lucide-react";

/**
 * The Manna Group mark.
 *
 * Reads the real artwork from `public/manna-logo.png`. If that file is not
 * there it falls back to the plain brand tile this application used before —
 * deliberately, rather than drawing an approximation of the logo. A hand-drawn
 * near-miss of a registered mark is worse than no mark at all: it looks like
 * the real thing to anybody who is not looking closely, and wrong to everybody
 * who is.
 *
 * Size it by height only — `h-6 w-auto`, never a fixed width. The mark is
 * 2.5:1 and pinning both axes either squashes it or floats it in a box it does
 * not fill. That was the original bug here: a 52x36 plate around a 2.5:1 image
 * left the artwork hanging over both plate edges.
 *
 * `onDark` puts the artwork on a white plate that shrink-wraps it. The mark is
 * charcoal and orange, and the ellipse and the two centre letters vanish
 * against the charcoal sidebar. A white plate keeps the brand exactly as drawn
 * instead of inventing a light variant of somebody else's logo.
 */
const MannaLogo = ({ className = "h-6 w-auto", onDark = false, alt = "Manna Group" }) => {
  const [missing, setMissing] = useState(false);

  if (missing) {
    // `aspect-square` so the tile takes its width from whatever height the
    // caller asked for, rather than needing a second set of sizes per caller.
    return (
      <div
        className={`bg-brand-600 grid place-items-center rounded-lg shadow-lg shadow-brand-900/40 shrink-0 aspect-square ${className}`}
      >
        <Boxes className="h-1/2 w-1/2 text-white" />
      </div>
    );
  }

  const img = (
    <img
      src="/manna-logo.png"
      alt={alt}
      onError={() => setMissing(true)}
      className={`object-contain shrink-0 ${className}`}
    />
  );

  if (!onDark) return img;

  return (
    <div className="bg-white rounded-lg px-2 py-1.5 shrink-0 inline-flex items-center">{img}</div>
  );
};

export default MannaLogo;
