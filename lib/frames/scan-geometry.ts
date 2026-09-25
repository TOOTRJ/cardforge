// ---------------------------------------------------------------------------
// Scan geometry for the frame-compare tool and the alignment score.
//
// Scryfall's `png` image is ALWAYS a 745×1040 portrait file, even for the
// landscape (7:5) frames: a printed battle is a portrait card whose layout is
// rotated, so the scan shows the title bar along the LEFT edge (the content
// is turned 90° counter-clockwise). Our battle/split renders are true
// landscape images, so before the two can be overlaid or diffed the scan has
// to be turned 90° clockwise and the comparison grid swapped to 1040×745.
//
// Pure + client-safe: the compare component uses it for CSS placement, the
// score route for the sharp pipeline, and the unit tests pin the numbers.
// ---------------------------------------------------------------------------

/** Scryfall `png` dimensions (the CDN serves every printing at this size). */
export const SCAN_WIDTH = 745;
export const SCAN_HEIGHT = 1040;

export type CardOrientation = "portrait" | "landscape";

/** The on-screen box a card of `widthPx` occupies — 5:7 portrait or 7:5
 *  landscape, matching CardPreview's aspect classes. */
export function cardBoxFor(
  widthPx: number,
  orientation: CardOrientation,
): { width: number; height: number } {
  const height =
    orientation === "landscape" ? (widthPx * 5) / 7 : (widthPx * 7) / 5;
  return { width: widthPx, height };
}

export type ScanPlacement = {
  boxWidth: number;
  boxHeight: number;
  /** Rendered size of the <img> BEFORE rotation. */
  imgWidth: number;
  imgHeight: number;
  /** Offsets that centre the (pre-rotation) image on the box, so a 90°
   *  turn about its centre lands exactly on the box. */
  imgLeft: number;
  imgTop: number;
  /** Clockwise degrees to apply (0 or 90). */
  rotateDeg: 0 | 90;
};

/** How to lay the portrait scan over a card box of the given orientation. */
export function scanPlacement(
  widthPx: number,
  orientation: CardOrientation,
): ScanPlacement {
  const box = cardBoxFor(widthPx, orientation);
  if (orientation === "portrait") {
    return {
      boxWidth: box.width,
      boxHeight: box.height,
      imgWidth: box.width,
      imgHeight: box.height,
      imgLeft: 0,
      imgTop: 0,
      rotateDeg: 0,
    };
  }
  // Landscape: size the image as the box turned on its side and centre it;
  // rotating 90° clockwise then fills the box with the title bar on top.
  const imgWidth = box.height;
  const imgHeight = box.width;
  return {
    boxWidth: box.width,
    boxHeight: box.height,
    imgWidth,
    imgHeight,
    imgLeft: (box.width - imgWidth) / 2,
    imgTop: (box.height - imgHeight) / 2,
    rotateDeg: 90,
  };
}

/** The pixel grid the score route compares on, plus the rotation the SCAN
 *  needs to land on it (our render is already in the card's orientation). */
export function scanGridFor(orientation: CardOrientation): {
  width: number;
  height: number;
  rotateDeg: 0 | 90;
} {
  return orientation === "landscape"
    ? { width: SCAN_HEIGHT, height: SCAN_WIDTH, rotateDeg: 90 }
    : { width: SCAN_WIDTH, height: SCAN_HEIGHT, rotateDeg: 0 };
}
