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
  // The Vehicle plate (TODO 4.5c): Card Conjurer's brown m15PTV (381 × 209),
  // one image under every colour key, drawn at M15's plate box — the body
  // with its bevels, none of the soft shadow.
  "/frames/m15vehicle/pt/{color}.png": { left: 0.0761, top: 0.0526, right: 0.9922, bottom: 0.8613 },
  // The Nyx dress (TODO 4.7) prints M15's own plates: m15's seven images.
  "/frames/m15nyx/pt/{color}.png": { left: 0.0742, top: 0.0436, right: 0.9974, bottom: 0.8641 },
  // The Universes Beyond plates (TODO 4.25): Card Conjurer's smooth
  // `m15/ub/pt` set (282 × 154), drawn at M15's plate box — the same body
  // within a pixel of M15's at HD.
  "/frames/m15ub/pt/{color}.png": { left: 0.0744, top: 0.0454, right: 0.9965, bottom: 0.8637 },
  "/frames/m15ubartifact/pt/{color}.png": { left: 0.0744, top: 0.0454, right: 0.9965, bottom: 0.8637 },
  // The Zendikar Rising hedron showcase (TODO 4.11): its pack's plates and
  // the 'Nickname' pack's (282 × 154), drawn at M15's plate box.
  "/frames/fullart/pt/{color}.png": { left: 0.0744, top: 0.0454, right: 0.9965, bottom: 0.8637 },
  "/frames/m15snow/pt/{color}.png": { left: 0.0742, top: 0.0436, right: 0.9974, bottom: 0.8641 },
  "/frames/m15devoid/pt/{color}.png": { left: 0.0742, top: 0.0436, right: 0.9974, bottom: 0.8641 },
  // The transform backs' dark plates (TODO 5.1a; CC's transform pt<K>.png,
  // 285 × 156, drawn at M15's plate box by m15dfcback and m15dfcbackleft):
  // the body with its lit bevel, none of the soft shadow.
  "/frames/m15dfcback/pt/{color}.png": { left: 0.0736, top: 0.0512, right: 0.993, bottom: 0.8654 },
  "/frames/m15borderless/pt/{color}.png": { left: 0.051, top: 0.0071, right: 1, bottom: 0.9286 },
  "/frames/m15borderlessartifact/pt/{color}.png": { left: 0.051, top: 0.0071, right: 1, bottom: 0.9286 },
  // The flip creatures' plates (TODO 4.21a, layout v38): CC's two-plate image
  // cut into one per half (scripts/lib/cc-frames.mjs FLIP_PT_BOXES); the
  // bottom one is upside-down in the source and drawn unturned, so both
  // read the same box — the body with its bevels, none of the soft shadow.
  "/frames/flip/pt/{color}-top.png": { left: 0.0987, top: 0.0625, right: 0.9836, bottom: 0.85 },
  "/frames/flip/pt/{color}-bottom.png": { left: 0.0987, top: 0.0625, right: 0.9836, bottom: 0.85 },
  // The planeswalker's starting-loyalty shield (cut out of each master).
  "/frames/m15pw/loyalty/{color}.png": { left: 0.025, top: 0.0389, right: 0.975, bottom: 0.9611 },
  // …and the borderless planeswalkers' (4.33): CC's same shield, through
  // the same mask.
  "/frames/m15borderlesspw/loyalty/{color}.png": { left: 0.025, top: 0.0389, right: 0.975, bottom: 0.9611 },
  "/frames/m15borderlesspwtall/loyalty/{color}.png": { left: 0.025, top: 0.0389, right: 0.975, bottom: 0.9611 },
  // The 2003 frame's plates (TODO 4.10b): Card Conjurer's 8th pt/<K>.png
  // (322 × 176), drawn at MODERN.pt.plateRect — the body with its outline,
  // none of the soft shadow under and beside it.
  "/frames/modern/pt/{color}.png": { left: 0.0621, top: 0.0681, right: 0.9535, bottom: 0.9035 },
  // The Lord of the Rings scroll's plates (TODO 4.11): Card Conjurer's
  // scroll P/T (435 × 266), drawn at the pack's ptBounds — the rolled
  // parchment with its curls, none of the soft shadow round it.
  "/frames/lotrscroll/pt/{color}.png": { left: 0.1425, top: 0.1992, right: 0.9472, bottom: 0.9286 },
  // The Lord of the Rings ring's plates (TODO 4.11): Card Conjurer's ring
  // P/T (268 × 134), drawn at the pack's ptBounds — the bevelled plate with
  // its rim, none of the soft shadow left of and under it.
  "/frames/lotr/pt/{color}.png": { left: 0.0522, top: 0.0074, right: 1, bottom: 0.9254 },
  // The MUL Tarkir showcase's plates (TODO 4.11): Card Conjurer's Tarkir P/T
  // (274 × 150; the white one 273 × 150, stretched to them), drawn at the
  // pack's ptBounds (274 × 150) — the bevelled plate and its
  // coloured ends fill the image to every edge.
  "/frames/tarkirdragon/pt/{color}.png": { left: 0, top: 0, right: 1, bottom: 1 },
  // The Stained Glass showcase's plates (TODO 4.11 wave 2): Card Conjurer's
  // 'Power/Toughness' (262 × 127) per key, drawn at the pack's ptBounds —
  // the bronze-rimmed plate fills the image to every edge.
  "/frames/stainedglass/pt/{color}.png": { left: 0, top: 0, right: 1, bottom: 1 },
  // Git plates: the Tarkir showcases' plates / ribbon.
  "/frames/avatar/pt/{color}.png": { left: 0.0037, top: 0.007, right: 0.9963, bottom: 0.993 },
  "/frames/bloomburrow/pt/{color}.png": { left: 0.0022, top: 0.0076, right: 0.9978, bottom: 0.9924 },
  // The anime showcase's P/T outline (TODO 4.11, layout v70): MSE's pt.png
  // in the strokes' tone, one for every key.
  "/frames/bloomanime/pt/{color}.png": { left: 0.0078, top: 0, right: 0.9882, bottom: 0.9868 },
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
