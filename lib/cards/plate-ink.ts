// ---------------------------------------------------------------------------
// Where each stat PLATE master puts ink (layout v33, TODO 3.29) — the keep-out
// the rules layout holds its lines to (lib/cards/rules-layout.ts
// statKeepOuts): a rules line whose ink would run under the P/T plate or the
// planeswalker's loyalty shield steps the text down a size instead.
//
// Measured by scripts/measure-plate-ink.mjs on every colour of every plate a
// profile draws (`plateAssetPathTemplate`): the bounding box of the pixels at
// least half opaque — the plate's body, not its faint drop shadow — united
// over the colours, as fractions of the plate image (rounded outward). Both
// renderers stretch the image over the plate's box (StatSlot.plateRect, else
// the stat's rect; objectFit "fill"), so the fractions place the ink wherever
// a profile or an override puts that box. Bucket plates were read from a
// sha256-verified local build (FRAMES_BUILD_DIR), git plates from
// public/frames; tests/unit/cards/plate-ink.test.ts re-measures whichever it
// can read. Re-run the script (and update this table) when a plate changes.
// No imports: the client preview and the server bake share it.
// ---------------------------------------------------------------------------

type InkBox = { left: number; top: number; right: number; bottom: number };

/** A plate's ink as fractions of its image, keyed by the profile's
 *  plateAssetPathTemplate. */
export const PLATE_INK: Readonly<Record<string, InkBox>> = {
  // Card Conjurer's M15 plate and its skins: ink from 1156.9 / 1864.8 px of an
  // HD card (the body's lit bevel), nothing of it in the soft shadow below.
  "/frames/m15/pt/{color}.png": { left: 0.0742, top: 0.0436, right: 0.9974, bottom: 0.8641 },
  "/frames/m15artifact/pt/{color}.png": { left: 0.0742, top: 0.0436, right: 0.9974, bottom: 0.8641 },
  "/frames/m15snow/pt/{color}.png": { left: 0.0742, top: 0.0436, right: 0.9974, bottom: 0.8641 },
  "/frames/m15devoid/pt/{color}.png": { left: 0.0742, top: 0.0436, right: 0.9974, bottom: 0.8641 },
  "/frames/m15borderless/pt/{color}.png": { left: 0.051, top: 0.0071, right: 1, bottom: 0.9286 },
  "/frames/m15borderlessartifact/pt/{color}.png": { left: 0.051, top: 0.0071, right: 1, bottom: 0.9286 },
  // The planeswalker's starting-loyalty shield (cut out of each master).
  "/frames/m15pw/loyalty/{color}.png": { left: 0.025, top: 0.0389, right: 0.975, bottom: 0.9611 },
  // Git plates: MSE's 2003 box and the Tarkir showcases' plates / ribbon.
  "/frames/modern/pt/{color}.png": { left: 0, top: 0, right: 1, bottom: 1 },
  "/frames/tarkirdragon/pt/{color}.png": { left: 0.0036, top: 0.0067, right: 0.9964, bottom: 0.9933 },
  "/frames/tarkirdraconic/pt/{color}.png": { left: 0.0054, top: 0.0106, right: 0.9973, bottom: 0.9841 },
  "/frames/tarkirghostfire/pt/{color}.png": { left: 0.0051, top: 0.0048, right: 0.9949, bottom: 0.9952 },
};

type Rect = { topPct: number; leftPct: number; widthPct: number; heightPct: number };

/** A plate's ink in card percents, drawn over `box` (the plate's box), or
 *  null for a plate the table doesn't know. */
export function plateInkRect(assetPathTemplate: string, box: Rect): Rect | null {
  const ink = PLATE_INK[assetPathTemplate];
  if (!ink) return null;
  return {
    leftPct: box.leftPct + ink.left * box.widthPct,
    topPct: box.topPct + ink.top * box.heightPct,
    widthPct: (ink.right - ink.left) * box.widthPct,
    heightPct: (ink.bottom - ink.top) * box.heightPct,
  };
}
