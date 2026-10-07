// ---------------------------------------------------------------------------
// Per-frame layout profile — the single source of truth for WHERE every piece
// of a card is drawn, shared by the live preview (card-preview.tsx) and the
// Satori bake (card-image.tsx). Both renderers position every region from the
// same numbers, so the editor preview and the exported PNG are identical by
// construction instead of two hand-tuned approximations that drift apart.
//
// THE MODEL
// ---------
// Every frame master (1500×2100, 2100×1500 landscape — in git under
// public/frames/<template>/ or, for the Card Conjurer frames, only in the
// frames storage bucket; frameUrl() resolves both) paints its own title
// plate, type bar, text box, and (sometimes) a P/T plate. The art window is
// a transparent cut-out, so the user's art renders on a layer BELOW the
// frame and the painted slot border sits on top — exactly like a real
// printed card.
//
// We therefore DON'T draw any plates of our own. We only drop text and stat
// values onto the frame at measured, card-relative coordinates. Every region is
// a `Rect` in PERCENT of the full card (0–100, origin top-left) — the same
// coordinate space the frame PNG fills — and every font size is a fraction of
// the card WIDTH so it scales identically in the responsive preview (via `cqw`
// container units) and the fixed-size bake (via `px = sizePct × cardWidth`).
//
// ADDING A FRAME: docs/FRAMES.md "Adding a frame" — the masters, the
// template registration in types/card.ts, one entry in PROFILES below, the
// checks every master passes (edge contract, art window, square corners),
// the import registry, and verification. No renderer code changes — both
// consume this profile generically. A template is a BODY: the kind anatomy
// it draws (P/T, the walker shield + ability rows, defense, the chapter
// rail…) is declared here, on its own entry — a walker body through
// walkerAnatomy() — and decides which kinds it may dress
// (lib/cards/kind-anatomy.ts; docs/FRAMES.md "Kind anatomy and bodies").
// Never add a kind's anatomy to a template that already exists: that
// re-dresses its stored cards (tests/unit/cards/kind-capability-baseline
// .test.ts). An edge-to-edge or full-art frame opts
// into the pieces it needs (TODO 3.23 / 3.24): `brandMark:
// BRAND_MARK_ON_ART` and `footerOnArt` where the bottom corner is art,
// `basicSymbol` for a basic land's symbol socket, `type.split` for a
// two-box type line, `textless` for a frame with no text box. Etched is
// hidden on any frame whose art window reaches the card edge
// (artReachesCardEdge) until 4.28.
//
// TUNING happens in the admin visual editor (/admin/frame-compare → Edit
// layout): adjustments save to the frame_profile_overrides table and merge
// over these values at render time (lib/cards/profile-override.ts — extend
// its zod schema when adding new numeric fields here). Fold-back workflow:
// once a template's override is stable, use the editor's "Copy as TS",
// merge the values into the profile below, and delete the DB row so code
// stays the single source of truth. docs/mse-profile-report.md holds the
// original MSE baselines for comparison.
// ---------------------------------------------------------------------------

import type { FrameColorKey, FrameMasterKey } from "@/lib/cards/frame-reference-registry";
import {
  M15PW_HOLO_STAMP_KEEP_OUT,
  M15PW_HOLO_STAMP_OVAL,
  M15_HOLO_STAMP_KEEP_OUT,
  M15_HOLO_STAMP_OVAL,
  type HoloStampArt,
} from "@/lib/cards/holo-stamp";
import { baseMasterKey } from "@/lib/cards/master-key";
import type { FrameTemplate } from "@/types/card";
import {
  ADVENTURE_PANEL_COST_PCT,
  ADVENTURE_PANEL_PCT,
  COST_DISC_PCT,
  MDFC_STRIP_LINE_PX,
  MDFC_STRIP_WORD_PX,
  SET_SYMBOL_BOX_PCT,
  SET_SYMBOL_BOX_PCT_THIN_BAR,
  SPLIT_COST_DISC_PCT,
  SPLIT_SET_SYMBOL_BOX_PCT,
  SPLIT_TITLE_SIZE_PCT,
  SPLIT_TYPE_SIZE_PCT,
  TITLE_SIZE_PCT,
  RULES_SIZE_PX,
  TYPE_SIZE_PCT,
  displayPct,
  rulesPxToPct,
} from "@/lib/cards/typography";
import { walkerAnatomy } from "@/lib/cards/kind-anatomy";
import type { SymbolStyle } from "@/lib/cards/symbol-style";
import { TYPE_FACES, typeFace, type SlotFace } from "@/lib/cards/type-faces";

/** A rectangle in card-relative percent (0–100), origin top-left. The card's
 *  full outer rect (corner to corner, the area the frame PNG fills) is the
 *  reference box. */
export type Rect = {
  topPct: number;
  leftPct: number;
  widthPct: number;
  heightPct: number;
};

export type SlotAlign = "start" | "center" | "end";

/** A text region painted onto the frame. */
export type TextSlot = {
  rect: Rect;
  /** Font size as a fraction of card WIDTH (e.g. 0.05 = 5% of card width). */
  sizePct: number;
  colorHex: string;
  /** Horizontal alignment of the text within the rect. Default "start". */
  align?: SlotAlign;
  /** Vertical alignment within the rect. Default "center". */
  vAlign?: SlotAlign;
  weight?: number;
  italic?: boolean;
  uppercase?: boolean;
  letterSpacingEm?: number;
  lineHeight?: number;
  /** The face the slot's text is set in: "display" → CardDisplay (Beleren
   *  Bold: names, type lines, the footer), "body" → MPlantin (rules; and
   *  what the 1997 prints set their type and artist lines in). Every
   *  shipped slot names one; unset = "display" on a name, type line or strip
   *  word, "body" on a footer; a RULES box is always the body face (its
   *  lines are broken on MPlantin's advances). Read by BOTH renderers and every
   *  fit through lib/cards/type-faces.ts slotFace (TODO 4.8.0) — never by a
   *  renderer's own literal. Code-owned: not part of the override schema. */
  font?: SlotFace;
  /** FOOTER only (TODO 4.8.0): what the artist line starts with — "Art: "
   *  when unset (FOOTER_PREFIX; the 1993–2003 prints say "Illus. "). Both
   *  renderers build the line with lib/cards/card-display.ts
   *  footerArtistLine. The footer's `align` is read too: unset / "start" =
   *  the line at the rect's start and a clean download's custom mark at its
   *  end (every profile today); "center" = the line centred in the rect
   *  (the 1997 prints from Exodus on) — a custom mark then has no place on
   *  this line. Code-owned: not part of the override schema. */
  prefix?: string;
  /** CSS text-shadow for text sitting directly on the frame (e.g. agclassic
   *  P/T, planeswalker loyalty). */
  shadowCss?: string;
  /** Per-frame-master ink — see InkByColorKey. Honoured on the footer
   *  (footerInk), the stat slots (slotInk) and the title and type bands
   *  (bandTextStyle), identically in both renderers. */
  inkByColorKey?: InkByColorKey;
  /** Translucent fill drawn behind the text — used when a frame's text region
   *  is a transparent cut-out over the art (M15 planeswalker abilities) so the
   *  words stay legible regardless of the artwork underneath. */
  backdropHex?: string;
  /** Draw `backdropHex` even when the box has no text (TODO 4.33, owner
   *  round 15, 2026-09-29): a borderless walker's ability window is a
   *  see-through cut-out, so a walker with no ability text shows the first
   *  stripe's light ground instead of the bare art — in both renderers,
   *  which ask drawsRulesBackdrop (lib/cards/rules-backdrop.ts). Never under
   *  ability rows, the editor's hint rows or a saga rail, never on a
   *  textless frame. Code-owned: not part of the override schema. */
  backdropWhenEmpty?: boolean;
  /** TYPE LINE ONLY — print it in two boxes split at the em dash (TODO
   *  3.24): "Basic Land" in `leftRect`, "Forest" in `rightRect`, the way
   *  Zendikar-style basics print either side of their medallion. Both parts
   *  share one size (the smaller of their single-line fits), and the set
   *  symbol draws only in the profile's `symbolRect`. Code-owned: not part of
   *  the override schema. */
  split?: TypeLineSplit;
  /** Vertical nudge of the slot's TEXT only, as a fraction of card WIDTH
   *  (the unit of sizePct; negative = up) — TODO 4.20, layout v32. The rect
   *  stays put, and with it the mana cost (costDy moves that), an inline set
   *  symbol and any symbolRect: a slot whose size grows keeps its baseline,
   *  or moves onto the print's, without re-verifying what shares its band.
   *  The same mechanism as costDy: the preview translates the text span by
   *  dy in cqw, the bake by the whole px (Math.round(dy × width)).
   *  FRONT-FACE title and type line only (both halves of a `split` type
   *  line): a second face (FrameProfile.secondFace) and the adventure panel
   *  ignore it and keep centring their text in the rect — but a MEASURED
   *  unturned second face (split's right half, see `fit`), which reads its
   *  own slots' dy as the front reads its own. Code-owned: not part of the
   *  override schema. */
  dy?: number;
  /** How a single-line display slot (title / type line) fits its room —
   *  TODO 4.20, layout v32. "measured": shrink by the text's measured
   *  display width to the room the band really leaves it, instead of the
   *  character estimate and an ellipsis, down to 5 pt of the card's own
   *  orientation. Unset = the old path, byte for byte (every frame outside
   *  the M15-era family, and the full-art basics). Both renderers read it
   *  through the shared fits: a title (the front face's, the adventure
   *  panel's) through lib/cards/title-band.ts fitTitleBand, a type line
   *  through lib/cards/render-tiers.ts fitTypeLine. A second face fits
   *  with its own `fitLines` — unless its own title and type slots are
   *  measured (split's right half, TODO 4.21b): an UNTURNED second face
   *  (rotation 0) with measured slots draws its two bands exactly as the
   *  front draws its own — the same fit, the same `dy`, the pips at their
   *  own size — so both halves of a split card are set alike.
   *  Code-owned: not part of the override schema. */
  fit?: TextSlotFit;
  /** RULES boxes only (layout v33, TODO 3.29): the box's padding in HD px —
   *  px of the 1500 px portrait / 2100 px landscape card, one physical
   *  scale — `x` either side, `y` above and below. Unset, the consumer's
   *  default (lib/cards/rules-box.ts): RULES_BOX_PAD_PX (9 / 18, the old
   *  0.6 % / 1.2 %) on a main box, the adventure page's and a second face's
   *  own. M15 sets the prints' margins, 4 / 0: its printed text runs to
   *  within a few px of the box; split gives each side its own (its boxes
   *  hold the textbox border, SPLIT_RULES_PAD_PX). Code-owned: not part of
   *  the override schema. */
  padPx?: { x: number; y: number } | { left: number; right: number; top: number; bottom: number };
  /** RULES boxes only (TODO 4.49 (b)): "center" sets the text centred on
   *  its line when the shared wrap (lib/cards/rules-layout.ts) gives ONE
   *  line in all — rules text only, no flavor — as the token prints do
   *  ("Vigilance", TDOM #2; "Flying, vigilance", TM19 #1); two or more
   *  lines start at the box's left, as ever. The layout places the line
   *  (its whole-px indent at each target), so both renderers draw it where
   *  the fit checked it. Unset: every line starts at the left (every
   *  profile before 4.49 (b)). Code-owned: not part of the override schema. */
  alignSingleLine?: "center";
  /** RULES boxes only (TODO 4.48): the paragraph gap, HD px, a text may be
   *  squeezed to before its size steps down — the full-art token's TALL box,
   *  where the prints keep 9 pt by closing the gaps between abilities (TBLB
   *  #5: 10–13 px) instead of shrinking. The shared fit tries each size with
   *  the gaps from RULES_TEXT.paragraphGapPx down to this and takes the
   *  widest that fits (lib/cards/rules-layout.ts); the layout carries the
   *  gap it placed, so both renderers draw it. Unset: the gap never moves
   *  (every other box). Code-owned: not part of the override schema. */
  paragraphGapMinPx?: number;
};

/** TextSlot.fit's policies. */
export type TextSlotFit = "measured";

/** A type line printed in two boxes — see TextSlot.split. */
export type TypeLineSplit = {
  leftRect: Rect;
  rightRect: Rect;
  /** Default "start" (Card Conjurer's left type box). */
  leftAlign?: SlotAlign;
  /** Default "center" (Card Conjurer's right type box, packZendikarBasic-1.js). */
  rightAlign?: SlotAlign;
};

/** A stat value (P/T, loyalty, defense) drawn onto the frame, optionally with a
 *  color-keyed plate PNG behind it — or in a badge the frame master paints
 *  (`paintedRect`). */
export type StatSlot = {
  rect: Rect;
  sizePct: number;
  colorHex: string;
  weight?: number;
  /** The face the value is set in — TextSlot.font's twin (TODO 4.8.0):
   *  unset = "display". The stat fit measures the value in this face
   *  (lib/cards/stat-fit.ts) and both renderers draw it in it
   *  (lib/cards/type-faces.ts slotFace). Code-owned: not part of the
   *  override schema. */
  font?: SlotFace;
  /** Horizontal alignment of the value in `rect`. Default "center" (every
   *  plate and badge); "end" for a value set against a rect's right edge —
   *  the transform front's reverse P/T in its grey tab (TODO 5.1a). */
  align?: SlotAlign;
  /** Plate PNG template, {color} → frame color key. Renders behind the value
   *  (M15 P/T plate). */
  plateAssetPathTemplate?: string;
  shadowCss?: string;
  /** Per-frame-master ink — see InkByColorKey (resolved by slotInk). */
  inkByColorKey?: InkByColorKey;
  /** Vertical nudge of the value text within the plate, in em (negative = up).
   *  Corrects the display font's baseline asymmetry — digits sit low in their
   *  line box, so a geometrically-centered value reads too close to the bottom.
   *  Applied to the TEXT only, so the plate PNG stays aligned to the frame. */
  valueDyEm?: number;
  /** Horizontal nudge of the value text within the plate, in em (positive =
   *  right). Text-only, like valueDyEm. */
  valueDxEm?: number;
  /** The plate's own box when it differs from the value's (TODO 4.18): Card
   *  Conjurer measures the M15 P/T plate {75.73, 88.48, 18.8 × 7.33} and the
   *  digits' box separately {79.28, 90.2, 13.67 × 3.72}. Without it the plate
   *  fills `rect`. */
  plateRect?: Rect;
  /** The x-range (card %) the value's INK may cover — the face the frame
   *  draws for it, measured on the digits' rows: a plate's light interior up
   *  to its bevel, a strip up to its pinstripe. It may be wider or narrower
   *  than `rect` (the value stays centred in `rect` and never wraps), and
   *  lopsided about the value's centre. A value whose ink would run past it
   *  shrinks (lib/cards/stat-fit.ts). Without it the ink may fill `rect`. */
  inkSpanPct?: { leftPct: number; rightPct: number };
  /** The frame MASTER paints this stat's badge itself (TODO 4.21b: the
   *  battle's defense shield, part of Card Conjurer's master): the badge's
   *  ink box in card percents. The value is drawn in `rect` with no plate
   *  (the renderers draw no badge of their own), and the rules lines keep
   *  out of this box on EVERY card on the frame — the shield is on the
   *  master whether or not a value is drawn (lib/cards/rules-layout.ts
   *  statKeepOuts). Code-owned: not part of the override schema. */
  paintedRect?: Rect;
};

/** A frame colour key — the {color} of every frame asset
 *  (pickFrameColorKey: one colour → its letter, none → "c", several → "m"). */
export type { FrameColorKey };

/** A frame MASTER key — the file a render paints, public/frames/{template}/
 *  {key}.png (FRAME_MASTER_KEYS). Every colour key is one; "a" is the Alpha
 *  frame's colourless ARTIFACT card, which a profile paints instead of "c"
 *  for an artifact (FrameProfile.artifactMasterKeys, resolved by
 *  frameMasterKey in components/cards/frame-layer.tsx). Not a colour: the
 *  colour picker, the frame_reviews gate and the stat plates stay on the
 *  colour key. */
export type { FrameMasterKey };

/** The ink of text printed straight onto the frame. */
export type SlotInk = { colorHex: string; shadowCss?: string };

/** Ink per frame master, for a slot whose masters differ in tone: printed
 *  Alpha cards letter the P/T and "Illus." line in dark ink on the white
 *  frame but in embossed silver on every other colour. A key that is missing
 *  keeps the slot's own colorHex (and, on stat slots, shadowCss); an entry
 *  replaces both — except on the title and type bands, where an entry
 *  without a shadowCss keeps the band's own shadowCss (the text span
 *  inherits it; see bandTextStyle). Keyed by the MASTER the text sits on
 *  (frameMasterKey), so the Alpha artifact card ("a") and the grey
 *  colourless card ("c") can differ. */
export type InkByColorKey = Partial<Record<FrameMasterKey, SlotInk>>;

/** The ink a stat slot (P/T, loyalty, defense) prints in on master `masterKey`. */
export function slotInk(
  slot: { colorHex: string; shadowCss?: string; inkByColorKey?: InkByColorKey },
  masterKey: string,
): SlotInk {
  // A crowned twin (`w-legendary`, 4.6f) prints the plain master's ink.
  const entry = slot.inkByColorKey?.[baseMasterKey(masterKey) as FrameMasterKey];
  return entry
    ? { colorHex: entry.colorHex, shadowCss: entry.shadowCss }
    : { colorHex: slot.colorHex, shadowCss: slot.shadowCss };
}

/** The footer's ink on master `masterKey`. Like slotInk, except that the
 *  footer draws its own `shadowCss` only on a profile that prints it on the
 *  art (FrameProfile.footerOnArt, TODO 3.8 / 3.23) — ON_ART_OUTLINE when it
 *  declares none. Elsewhere only an inkByColorKey entry brings a shadow
 *  (FULLARTLAND declares one that has never printed; drawing it without the
 *  opt-in would change those bakes). */
export function footerInk(
  footer: TextSlot,
  masterKey: string,
  profile?: Pick<FrameProfile, "footerOnArt">,
): SlotInk {
  const ink = slotInk({ colorHex: footer.colorHex, inkByColorKey: footer.inkByColorKey }, masterKey);
  if (!profile?.footerOnArt || ink.shadowCss) return ink;
  return { colorHex: ink.colorHex, shadowCss: footer.shadowCss ?? ON_ART_OUTLINE };
}

/** The style a title or type band's TEXT (the name, the type line) adds on
 *  master `masterKey`: an inkByColorKey entry's colour and shadow, or
 *  nothing — the band keeps its own colorHex / shadowCss, as on every frame
 *  without an entry. An entry without a shadowCss sets only the colour, so
 *  the text keeps the band's own shadowCss (inherited from the band) rather
 *  than dropping it as slotInk would. Only the text span takes it: the mana
 *  pips and set symbol beside it keep their own discs and ink, and a
 *  band-level text-shadow would emboss the pip glyphs too (the browser and
 *  Satori both inherit it). */
export function bandTextStyle(slot: TextSlot, masterKey: string): { color?: string; textShadow?: string } {
  const entry = slot.inkByColorKey?.[baseMasterKey(masterKey) as FrameMasterKey];
  if (!entry) return {};
  return entry.shadowCss ? { color: entry.colorHex, textShadow: entry.shadowCss } : { color: entry.colorHex };
}

/** Art drawn UNDER the whole frame for see-through frames (TODO 4.17): CC's
 *  colourless "Eldrazi" frame, every devoid frame and the colourless token
 *  let the art show through their bars, borders and text box, like the
 *  printed cards. The art window keeps its exact crop (artSlot); this second
 *  layer covers `rect` with the same art (object-fit cover at the card's
 *  focal point) beneath it, and the frame's opaque window border hides the
 *  seam. `colors` limits it to some frame MASTER keys (M15's "c" only) —
 *  underFrameArtRect is given the master the card paints (frameMasterKey), so
 *  a profile that also dresses a colour by type (artifactMasterKeys) lists
 *  the dressed master too if that one is see-through as well.
 *
 *  The two layers are cropped separately (each its own cover fit), so where
 *  they meet the picture jumps: the join must lie on an OPAQUE part of the
 *  master — the window's own outline (m15/c, devoid; the art-window check
 *  holds every see-through master to it, lib/frames/art-window.ts). A
 *  see-through master whose window has no outline where the profile's slot
 *  ends draws its window in `artSlot` instead (layout v35): a slot of its
 *  own on that outline, or `rect` itself — ONE picture, the window a part of
 *  it and no second layer (m15pw/c: translucent from the border to the
 *  window, no outline down the ability box). (The colourless tokens' join
 *  lies in their silver too, but their arched window has translucent silver
 *  above it, so no rectangle would do — TODO 4.17c.) Only under art, like
 *  the under-frame layer: a card without art draws its empty-art box in the
 *  profile's own `artSlot`. */
export type UnderFrameArt = {
  rect: Rect;
  colors?: readonly string[];
  artSlot?: Rect;
};

/** The art a face paints under its frame on master `colorKey`, as both
 *  renderers and the foil mask draw it: the window's `slot` (a see-through
 *  master's own UnderFrameArt.artSlot when it has one and there is art) and
 *  the see-through master's `under` rect (only under art) — null when there
 *  is none, or when the slot IS that rect (one picture: no second layer). */
export function artLayersFor(
  profile: FrameProfile,
  colorKey: string,
  hasArt: boolean,
): { slot: Rect; under: Rect | null } {
  const under = hasArt ? underFrameArtRect(profile, colorKey) : null;
  if (!under) return { slot: profile.artSlot, under: null };
  const slot = underFrameArtSlot(profile, colorKey) ?? profile.artSlot;
  return { slot, under: sameRect(slot, under) ? null : under };
}

/** Two rects with the same four numbers. */
export function sameRect(a: Rect, b: Rect): boolean {
  return a.topPct === b.topPct && a.leftPct === b.leftPct && a.widthPct === b.widthPct && a.heightPct === b.heightPct;
}

/**
 * The box both renderers DRAW for a slot whose content is turned `turn`°
 * clockwise in place (FrameProfile.footerTurn — TODO 4.21b; 4.9d's collector
 * line on the same band reuses it): `band` is what the turned content covers
 * ON THE CARD, in card percents; the result is the unturned box centred on
 * it — for a quarter turn as wide as the band is tall and as tall as it is
 * wide, in px — which, rotated `turn`° about its centre, lands exactly on
 * the band. It may reach off the card before the turn (a tall band's box is
 * wide). `aspect` is the card's height ÷ width (7/5 portrait, 5/7 landscape).
 */
export function unturnedRect(band: Rect, turn: 0 | 90 | 180 | 270, aspect: number): Rect {
  if (turn === 0 || turn === 180) return band;
  // The band's px sides, in percents of the OTHER axis.
  const widthPct = band.heightPct * aspect;
  const heightPct = band.widthPct / aspect;
  return {
    leftPct: band.leftPct + band.widthPct / 2 - widthPct / 2,
    topPct: band.topPct + band.heightPct / 2 - heightPct / 2,
    widthPct,
    heightPct,
  };
}

/** A frame drawn in two halves for a two-colour card — see
 *  FrameProfile.twoColorSplit. */
export type TwoColorSplit = {
  /** The seam, as % of the card's width: the first colour's frame is drawn
   *  left of it, the second colour's right of it. */
  atPct: number;
};

/** How a two-colour card's frame prints (TODO 4.6b; lib/cards/anatomy.ts
 *  twoColorDressOf): "split" — the gold frame with a split pinline and text
 *  box, the printed look of any two-colour cost; "hybrid" — the split outer
 *  frame with grey bars, when every coloured pip is a two-colour hybrid (or
 *  a nonland has no coloured pip). */
export type TwoColorDress = "split" | "hybrid";

/** A piece of printed anatomy drawn OVER the frame master (TODO 4.6.0): the
 *  legendary crown band (4.6a), the transform icon glyph (5.1a), the
 *  holofoil stamp's notch (4.9c). One image per key, stretched over `rect`,
 *  right after the frame master in both renderers and inside both finish
 *  masks (lib/cards/anatomy.ts resolveFrameOverlays). `anatomy` is the
 *  discriminant: it names the rule that decides whether the card draws it
 *  and with which key — the crown: FrameStyle.crown === true on a Legendary
 *  card that is not a planeswalker, token, battle or emblem, keyed by the
 *  pinline of the master drawn; the icon rider: a double-faced face's icon
 *  family (CardPreviewData.dfc, lib/cards/faces.ts), keyed by the family's
 *  glyph for the face's role (lib/cards/dfc.ts DFC_ICON_GLYPHS), no
 *  per-card switch; the stamp: FrameStyle.stamp wanting it (lib/cards/
 *  holo-stamp.ts holoStampWanted), keyed by the colour key — each later
 *  rider adds its own member here and its own branch in
 *  resolveFrameOverlays. Code-owned: never part of the override schema.
 *  Set only on a PROFILES entry, never on a base another profile spreads
 *  (M15 is spread by 11 profiles, M15LAND by m15snowland), so a template
 *  gains an overlay only on purpose. */
export type FrameOverlaySlot =
  | (FrameOverlaySlotBase & { anatomy: "crown" })
  | (FrameOverlaySlotBase & { anatomy: "dfcIcon" })
  /** The modal flipside strip rider (TODO 5.1c): the OTHER face's colour's
   *  tab over the one the master paints, keyed by `dfc.otherFace.stripKey`
   *  (lib/cards/faces.ts) and drawn only when that key is not the master's
   *  own (lib/cards/anatomy.ts resolveFrameOverlays). */
  | (FrameOverlaySlotBase & { anatomy: "mdfcStrip" })
  | (FrameOverlaySlotBase & {
      anatomy: "holoStamp";
      /** The stamp this notch is cut for: its shape, the oval the art
       *  bitmap fills and the rules keep-out over the arch. */
      stamp: HoloStampArt;
    });

export type FrameOverlayAnatomy = FrameOverlaySlot["anatomy"];

type FrameOverlaySlotBase = {
  /** Where the image is stretched, in card percent. */
  rect: Rect;
  /** The image per key: `{key}` → the key, e.g. "/frames/m15crown/{key}.png"
   *  (a frames-bucket path, like the masters). */
  assetPathTemplate: string;
  /** Every key the slot publishes. A card whose key is not listed draws no
   *  overlay — never a stand-in ("c" was the masters' old fallback, which
   *  would crown a land in the Eldrazi colourless band). */
  keys: readonly string[];
  /** The frame colour key → the slot's key where they differ: the crown of
   *  a colourless artifact is the artifact silver ("c" → "a" on
   *  m15artifact), a colourless land's the land grey ("c" → "l" on
   *  m15land). */
  keyMap?: Readonly<Record<string, string>>;
};

/** A double-faced BODY (TODO 5.0a, design 2026-10-02 §2.2): the profile
 *  dresses one printed FACE of a transform or modal double-faced card. A
 *  front body is a card's `frame_style.template` (the kind gate reads
 *  `role`); a back body is stored in `back_face.frame_style.template` and is
 *  never a front (lib/cards/dfc.ts). Declared on a PROFILES entry only,
 *  never on a base another profile spreads; code-owned (the override schema
 *  refuses it). NO profile declares one yet — 5.1a brings the transform
 *  bodies, 5.1b the modal ones; the icon rider, the reverse P/T and the
 *  strip arrive with them. Declaring one changes no stored card: a legacy
 *  `back_face` (no body) keeps drawing on the front's template. */
export type DfcProfile = {
  /** The printed layout: a transform (the back has no cost, the front's tab
   *  prints the back's P/T) or a modal double-faced card (the strip). */
  layout: "transform" | "modal";
  /** Which face this body dresses. */
  role: "front" | "back";
  /** Which side of the title bar the icon well (transform) or the drop
   *  housing (modal) sits on — the side the glyph rider draws and the name's
   *  inset follows: `left` on every front and on the 2016–22 back, `right`
   *  on the ▼ back printed since 2022-11. */
  well: "left" | "right";
  /** A land body: no mana cost, and on the back no P/T or indicator. */
  land?: true;
};

/** The modal strip's two text slots (FrameProfile.flipside) and the painted
 *  strip's own rect, which the rules lines keep out of (DrawnStats.strip,
 *  lib/cards/rules-box.ts): the prints cut the strip INTO the text box's
 *  paper, so a long text's last lines end above it or stop at its chevron
 *  (KHM #15 Halvar, KHM #114 Valki) — judged glyph by glyph like a plate. */
export type FlipsideSlots = {
  word: TextSlot;
  line: TextSlot;
  keepOut: Rect;
};

export type FrameProfile = {
  label: string;
  /** How the frame's era drew its mana symbols — the cost discs, their
   *  shadow, the inline pips and {T} (TODO 4.8.0 / 4.24; lib/cards/
   *  symbol-style.ts). Unset = "modern", the only style there is today:
   *  M15's discs, hard offset shadow and tap. Profile data and a
   *  CORRECTION when a frame changes it — never a per-card switch (era
   *  design D8). Both renderers and both shadow models (the rules layout's
   *  inline pip, the cost row's) read it through symbolStyleOf. Code-owned:
   *  not part of the override schema. */
  symbolStyle?: SymbolStyle;
  /** Printed anatomy drawn over the frame master — see FrameOverlaySlot.
   *  Opt-in per card (FrameStyle.crown), so declaring one never changes a
   *  stored card. Code-owned. */
  overlays?: readonly FrameOverlaySlot[];
  /** This template is one FACE of a double-faced card — see DfcProfile.
   *  Code-owned; set only on PROFILES entries (none yet). */
  dfc?: DfcProfile;
  /** The two-colour dresses this template has pair masters for (TODO 4.6b):
   *  `<template>/<pair>.png` for "split", `<template>/<pair>-h.png` for
   *  "hybrid" (TWO_COLOR_MASTER_KEYS). A card with a stored colour pair and
   *  FrameStyle.twoColor === true paints its dress's pair master instead of
   *  the gold "m" (lib/cards/anatomy.ts resolveTwoColor). Unrelated to
   *  `twoColorSplit` (Dragon Wing's older two-halves rule, which reads the
   *  pair with no switch). Code-owned; set only on PROFILES entries. */
  twoColorMasters?: readonly TwoColorDress[];
  /** The pair masters are a LAND frame's split (m15land: the land frame and
   *  bars in the two land tints, MKM #259–271). A land card draws the
   *  two-colour frame only on a profile that says so: on m15 or m15artifact
   *  it would wear a nonland frame's gold-split (Shadowwood Hollow and
   *  Sunfade Citadel, lands stored with no template and drawn on m15), so
   *  the creator hides its switch there, the save drops it and the renderers
   *  don't draw it (owner round 17, 2026-09-30; lib/cards/anatomy.ts
   *  twoColorFits). Code-owned; set only on PROFILES entries. */
  twoColorForLands?: boolean;
  /** The legendary crown is baked INTO this template's masters (TODO 4.6f,
   *  wave 2a): beside each `<template>/<key>.png` a `<key>-legendary.png`
   *  draws the same frame with the crown — the borderless FLOATING crown,
   *  where Card Conjurer ERASES a strip of the frame under it (the master's
   *  title-bar ring), which no overlay can do. A Legendary card with
   *  FrameStyle.crown === true paints that twin instead (frameMasterKey →
   *  lib/cards/anatomy.ts crownedMasterKey), for its colour key or its pair
   *  (LEGENDARY_MASTER_KEYS); what is keyed by the master — ink, the
   *  under-frame art — reads the plain key (baseMasterKey; the
   *  square-corner table names no key of these templates). The crown's
   *  switch, hint, import rule and registry gap are the overlay crown's
   *  (frameAnatomyOf: `crown` is true either way). Opt-in per card:
   *  declaring it changes no stored card. Code-owned; set only on PROFILES
   *  entries (M15BORDERLESS is spread by the artifact and land dresses). */
  crownMasters?: true;
  /** Two-colour cards draw the frame SPLIT down a hard vertical seam — the
   *  first colour's PNG left of `atPct`, the second's right of it, in printed
   *  pair order (twoColorFrameKeys: WU WB UB UR BR BG RG RW GW GU) — instead
   *  of the gold "m" PNG. Mono, colourless, 3+ colour and "multicolor"
   *  identities are unaffected, and stat plates keep the "m" key. Code-owned:
   *  not part of the override schema. Both renderers draw it
   *  (FrameLayer's two clip-path halves; the bake's two overflow:hidden
   *  FrameSlice boxes), and the etched sheen
   *  masks with both halves. */
  twoColorSplit?: TwoColorSplit;
  /** Masters dressed by the card's TYPE as well as its colour: colour key →
   *  the master an ARTIFACT of that colour paints instead (isArtifactFrameType:
   *  the Artifact card type, or "Artifact" in the supertype). Alpha:
   *  { c: "a" } — a colourless artifact prints on the brown artifact card
   *  (agclassic/a.png), any other colourless card on the grey one (c.png).
   *  frameMasterKey (components/cards/frame-layer.tsx) resolves it for both
   *  renderers, the foil/etched masks, the bake's preload and the creator's
   *  frame tiles; the ink maps are keyed by the master. The colour key stays
   *  the card's colour everywhere else: the frame_reviews gate (verifying
   *  agclassic/c publishes both of its masters), the stat plates and the
   *  watermark tint. Code-owned: not part of the override schema. A profile
   *  that spreads one carrying this must decide whether it keeps it. */
  artifactMasterKeys?: Partial<Record<FrameColorKey, FrameMasterKey>>;
  /** Transparent art cut-out — the user's art renders here, below the frame. */
  artSlot: Rect;
  /** Art under the whole frame for see-through frames — see UnderFrameArt. */
  underFrameArt?: UnderFrameArt;
  /** Title band. Name renders left-aligned; mana cost right-aligned in the
   *  same band. */
  title: TextSlot;
  /** Type band. Type line left; rarity set-symbol right. */
  type: TextSlot;
  /** Rules + flavor text box. Its `sizePct` is one of the named HD-px
   *  ceilings in lib/cards/typography.ts RULES_SIZE_PX (rulesPxToPct — 76 px,
   *  the prints' 9 pt, on a full box; 68 / 64 on half boxes and walkers,
   *  layout v33); the fit ladder shrinks from there. `lineHeight` is left
   *  unset so the standard leading applies. */
  rules: TextSlot;
  /** Draw the M15-family hairline between rules and flavor text. Pre-M15
   *  frames (1997 retro, 2003 modern, Alpha-era) separate them with a gap
   *  only. Default true. */
  flavorDivider?: boolean;
  /** Bottom info line (artist credit + brand). */
  footer?: TextSlot;
  /** The footer's line is printed TURNED a quarter turn clockwise (TODO
   *  4.21b / 3.8): a landscape card's artist credit runs down its left
   *  border — the portrait card's bottom border, turned with the card
   *  (split, battle; MH2 #123, MOM #149) — reading from the top, its
   *  letters' heads toward the card. `footer.rect` is then the BAND the
   *  line covers on the card (narrow and tall); both renderers draw the
   *  footer in unturnedRect(rect, …) and turn it in place. Code-owned: not
   *  part of the override schema. */
  footerTurn?: 90;
  /** The printed collector line's slot (TODO 4.9b) — the two lines in the
   *  bottom border a card switches on (FrameStyle.collector, opt-in per
   *  card: declaring it changes no stored card). When the line is drawn it
   *  REPLACES the footer, and the brand mark moves into its © slot. Set only
   *  on PROFILES entries (COLLECTOR_TEMPLATES), never on a base another
   *  profile spreads; code-owned (the override schema refuses it). */
  collector?: CollectorSlot;
  pt?: StatSlot;
  loyalty?: StatSlot;
  defense?: StatSlot;
  /** A transform FRONT body's grey reverse P/T (TODO 5.1a; design 2026-10-02
   *  §2.2): the BACK face's P/T in the tab at the text box's bottom right,
   *  which the master paints — digits only (no plate), end-aligned, drawn by
   *  both renderers from CardPreviewData.dfc.otherFace and only when the
   *  back prints a P/T (`printsPt`); the tab prints empty otherwise (owner
   *  decision Q7). Code-owned; set on a PROFILES entry only. */
  reversePt?: StatSlot;
  /** The colour-indicator dot (TODO 5.1a; design D4, lib/cards/
   *  color-indicator.ts): "coloured" — drawn on every face whose colour
   *  identity names a colour (one disc, two split diagonally, three or more
   *  in wedges), with the type line indented past it, as every coloured
   *  transform back prints (INR #60, MOM #43); none on an artifact or
   *  colourless face. Intrinsic to the body, not a per-card switch (4.6c's
   *  switch for ordinary cards reuses the module). Code-owned. */
  indicator?: "coloured";
  /** A modal double-faced body's flipside STRIP texts (TODO 5.1b; design
   *  2026-10-02 §2.2, D9): two text slots in the strip CC paints into the
   *  master (its housing-coloured tab at the text box's bottom left) — the
   *  OTHER face's last type word (`word`: Beleren Bold, from the box's left
   *  edge) and its mana cost or, for a land, its mana ability (`line`: the
   *  rules font with inline pips, v36's run, set against the box's right
   *  edge). Both renderers draw them from CardPreviewData.dfc.otherFace
   *  (lib/cards/faces.ts typeWordOf / manaLineOf) and nothing else; white
   *  ink on a front's dark strip, dark on a back's light one. Code-owned;
   *  set on a PROFILES entry only. */
  flipside?: FlipsideSlots;
  /** When set, the mana cost renders absolutely inside THIS rect
   *  (right-aligned, vertically centered) instead of inline at the title
   *  band's right edge — lets the pips move independently of the name.
   *  Front face only; editable via the admin layout editor ("cost"). */
  costRect?: Rect;
  /** Mana-cost pip size — the visual DISC DIAMETER as a fraction of card
   *  width (MSE m15 spec: 15px on a 375px card = 0.04), right-aligned in the
   *  title band. Defaults to `title.sizePct`. Both renderers treat this as the
   *  disc size: the preview divides by mana-font's 1.3em disc ratio, the bake
   *  draws the disc at exactly this size. */
  costSizePct?: number;
  /** Vertical nudge of the mana cost, as a fraction of card WIDTH (the unit
   *  of costSizePct; negative = up). Moves the pips without moving the name
   *  (inline or in costRect) and keeps the name's ellipsis against the pips.
   *  Front face only. */
  costDy?: number;
  /** When set, the rarity set-symbol renders absolutely inside THIS rect
   *  (right-aligned, vertically centered) instead of inline at the type
   *  band's right edge — lets the symbol move independently of the type
   *  line. Front face only; editable via the layout editor ("set symbol"). */
  symbolRect?: Rect;
  /** Set-symbol BOX (fraction of card width), right-aligned in the type band
   *  or the symbolRect (layout v32, TODO 4.20; lib/cards/set-symbol-size.ts):
   *  an uploaded icon and the default mark draw contained in a square of
   *  this side, and a Keyrune glyph is fitted to it by its ink — font =
   *  min(box × KEYRUNE_EM_PER_BOX, box ÷ ink height, 0.12 W ÷ ink width).
   *  Unset, the box is `type.sizePct × 1.1` and a Keyrune glyph's font size
   *  equals it (every frame outside the M15-era family, unchanged). */
  symbolSizePct?: number;
  /** How a Keyrune glyph fills the set-symbol box (layout v32, TODO 4.20):
   *  "ink" draws it at the size its set PRINTS at when the set was measured
   *  (lib/cards/set-symbol-prints.ts, layout v36, TODO 4.46), else fits it
   *  to the box by its ink (lib/cards/set-symbol-size.ts); "ink-box" is the
   *  box fit alone (the full-art basics, whose glyph size 4.39 print-checked
   *  in their own pill); "ink-height" fills the box's height with the
   *  glyph's ink whatever its shape (the split card's thin type bar, TODO
   *  4.21b: its prints set every symbol 47–50 px tall); unset, its font size
   *  IS the box, as before v32. "ink" is set on the M15-era family only
   *  (lib/cards/m15-family.ts), "ink-height" on split alone. Code-owned: not
   *  part of the override schema, so an override's symbolSizePct resizes the
   *  box but never switches a frame outside the family to the ink fit. */
  setSymbolFit?: "ink" | "ink-box" | "ink-height";
  /** When true, never render the mana cost (tokens/emblems have none, and the
   *  frame's title bar has no cost area). */
  hideCost?: boolean;
  /** Card aspect. "portrait" (default) is the 5:7 every normal frame uses;
   *  "landscape" is the 7:5 rotated card used by Battle frames — it flips the
   *  preview container's aspect ratio and the bake's render dimensions. All
   *  rect/sizePct values are then relative to the landscape card. */
  orientation?: "portrait" | "landscape";
  /** Planeswalker ability rows. When set and the card is a planeswalker, the
   *  rules box renders as per-ability rows — a loyalty-cost badge rail on the
   *  left (+1 / -3 / 0) with alternating translucent row shading, exactly like
   *  printed M15 planeswalkers — instead of the plain text body. Lines without
   *  a leading loyalty cost (static abilities) render unbadged. */
  loyaltyRows?: {
    /** The walker text's ceiling (layout v33): the ability rows, and a
     *  walker drawn in the plain box, never set above this (nor above the
     *  rules slot's own size — lib/cards/rules-box.ts walkerSizePct). The
     *  rules slot's size is then what any OTHER card on the frame gets. */
    maxSizePct?: number;
    badgeTextHex: string;
    /** The face the loyalty-cost badges' numerals are set in (TODO 4.8.0;
     *  lib/cards/type-faces.ts faceOf "badge"). Unset = "display". */
    badgeFont?: SlotFace;
    /** Alternating row backdrops (odd/even), translucent over the art. */
    stripeAHex: string;
    stripeBHex: string;
  };
  /** Saga chapter rail (TODO 4.21c = 3.7). When set, the card's rules text is
   *  parsed into a reminder block and chapters (parseChapters in
   *  lib/cards/card-display) and drawn as the printed rail — REPLACING the
   *  normal rules box: the reminder (the intro) in its own block, then one
   *  row per chapter, each sized by its text and never shorter than its
   *  stack of chapter badges, a divider at each row's top. The geometry is
   *  the frame's (card percents, HD px in the comments); the layout that
   *  turns it into rows, lines, badges and dividers for both renderers is
   *  lib/cards/saga-rail.ts sagaRail(). The Saga's art is a separate
   *  right-column artSlot. */
  chapters?: {
    /** The chapter TEXT column, from the rail's top — where the rows start
     *  on a saga with no reminder block — to its foot. */
    rect: Rect;
    /** Chapter-text ceiling, as a fraction of card width: the top of the
     *  rules ladder the rows share. */
    sizePct: number;
    /** The chapter text's line pitch (× the size); RULES_TEXT's when unset. */
    lineHeight?: number;
    textColorHex: string;
    /** The reminder block above chapter I: its box (a long reminder steps
     *  down the ladder inside it; only one the box can't hold at the
     *  ladder's floor outgrows it — saga-rail.ts), its ceiling and its line
     *  pitch. `keepOuts` (card percents) are the parts of that box the frame
     *  paints: no line's ink may enter them, judged glyph by glyph like a
     *  stat badge's (RulesLayoutInput.keepOuts). */
    intro: { rect: Rect; sizePct: number; lineHeight?: number; keepOuts?: readonly Rect[] };
    /** Where the rows start UNDER a reminder block (card %H): the first
     *  divider. Without one they start at `rect`'s top. */
    rowsTopPct: number;
    /** The chapter badge — a bitmap both renderers draw (a frames-bucket
     *  object; frameAssetPathsFor preloads it): its left edge and size, the
     *  centre-to-centre pitch of a stack (roomy while the rows have room,
     *  down to the tight one before the text steps down), and its numeral. */
    badge: {
      assetPath: string;
      leftPct: number;
      widthPct: number;
      heightPct: number;
      /** Stack pitch, card %H: [tight, roomy]. */
      pitchPct: { min: number; max: number };
      /** The numeral's size (fraction of card width) and ink. */
      numeralSizePct: number;
      numeralColorHex: string;
      /** The face the chapter numerals are set in (TODO 4.8.0;
       *  lib/cards/type-faces.ts faceOf "numeral"). Unset = "body", the
       *  prints' MPlantin (the numeral's vertical centring is the bitmap
       *  badge's own, lib/cards/saga-rail.ts). */
      numeralFont?: SlotFace;
    };
    /** The row divider — the pack's bitmap, drawn centred on each row's top
     *  edge (a first row at the rail's own top has none). */
    divider: { assetPath: string; leftPct: number; widthPct: number; heightPct: number };
  };
  /** Adventure (Eldraine) sub-panel. When set, the frame is a creature whose
   *  lower text area is an open storybook: this LEFT page holds an "adventure"
   *  spell — a second name / type / cost / rules block sourced from the card's
   *  BACK-FACE content — while the creature's own `rules` box is the RIGHT page.
   *  Both show at once (the renderers suppress the DFC flip for adventure
   *  frames). The adventure name + type sit on the panel's colored bars, so
   *  they're light ink; the adventure rules sit on the cream page, so dark. */
  adventure?: {
    title: TextSlot;
    type: TextSlot;
    rules: TextSlot;
    /** Adventure mana-cost size (fraction of card width). Defaults to the
     *  adventure title's sizePct. */
    costSizePct?: number;
  };
  /** A second face/half drawn from the card's BACK-FACE content, optionally
   *  ROTATED — the multi-panel frames where two cards share one piece of
   *  cardboard. Each slot is positioned in normal card coordinates and then
   *  rotated `rotation`° in place (matching MSE's per-element `angle`):
   *    • Flip (180°): the upside-down bottom creature; shares the front art.
   *    • Aftermath (90°): the sideways bottom spell.
   *    • Split (0°, landscape): the right half; brings its own `artSlot`.
   *  Both renderers draw it inline (the DFC flip is suppressed). */
  secondFace?: {
    rotation: 0 | 90 | 180 | 270;
    title: TextSlot;
    type: TextSlot;
    rules: TextSlot;
    /** Mana-cost size (fraction of card width); when set, the title band
     *  renders name + cost (split/aftermath). Omit for flip (no second cost). */
    costSizePct?: number;
    /** P/T for a creature second face (flip). */
    pt?: StatSlot;
    /** A second art window (split); omit when the face shares the front art. */
    artSlot?: Rect;
    /** The name bar (name + cost, shrinking as one) and the type line fit
     *  their bars on one line, measured in Beleren's widths
     *  (secondFaceLineSizes), instead of ellipsizing at the profile's sizes
     *  — aftermath's sideways bars are short. Code-owned. */
    fitLines?: boolean;
  };
  /** Where the pipglyph.com brand mark sits, for frames whose bottom black
   *  border is thinner than M15's (Alpha, 1997, 2003, extended art, battle,
   *  split) — the default straddles their coloured frame edge. Values centre
   *  the mark's ink in the frame's own border. On a bar-less edge-to-edge
   *  treatment the mark lands on the art: set `pill` (BRAND_MARK_ON_ART).
   *  Omit for the default (BRAND_MARK_PLACEMENT). Code-owned: not part of the
   *  override schema. */
  brandMark?: BrandMarkPlacement;
  /** The artist line prints straight on the art (a bar-less edge-to-edge
   *  treatment, TODO 3.23 / 3.8): the footer draws its own `shadowCss` —
   *  ON_ART_OUTLINE when it declares none — in both renderers (footerInk).
   *  Without it a footer's `shadowCss` is not drawn (FULLARTLAND declares
   *  one that has never printed). Code-owned, opt-in. */
  footerOnArt?: boolean;
  /** A keyline around a preset Keyrune set symbol — a zero-blur multi-layer
   *  text shadow, SET_SYMBOL_KEYLINE (white) — for a profile whose type bar
   *  is dark (4.32's borderless bars). Keyrune glyphs print in flat rarity
   *  ink with no outline (RARITY_INK; common #0f0f12), so on a dark bar a
   *  common all but disappears; prints outline the symbol in white. The
   *  preview draws it as a CSS text-shadow, the bake as offset copies under
   *  the glyph (textShadowCopies: librsvg keeps only one layer of a
   *  multi-layer shadow, TODO 3.25). An uploaded icon (the owner's art) and
   *  the default PipGlyph mark (its own keyline) are drawn as before.
   *  Code-owned, opt-in: a profile without it bakes as before. */
  setSymbolKeyline?: string;
  /** A BASIC land's mana symbol in its own slot (TODO 3.24) instead of the
   *  automatic big watermark in the rules box — see BasicSymbolSlot.
   *  Profiles without it (m15land, modernland, alphaland …) are unchanged.
   *  Code-owned, opt-in. */
  basicSymbol?: BasicSymbolSlot;
  /** The frame prints no text box (TODO 3.24; real textless printings: SCH
   *  #3, P07 #1, PF19 #1): both renderers hide the type line, the rules and
   *  flavour text (and the rules box's backdrop, watermark, planeswalker rows
   *  and saga rail), and the set symbol unless `symbolRect` places it; they
   *  keep the title, cost, P/T, loyalty, footer, brand mark and basic-land
   *  symbol; the rules fit estimate is skipped. The card keeps its text (the
   *  Text step says so) and prints it on any other frame. Code-owned, opt-in. */
  textless?: boolean;
  /** A `textless` frame that still prints its TYPE LINE (and the set symbol
   *  beside it): the full-art token's textless height has no box but a type
   *  pill (TODO 4.48, TFDN #6 "Token Creature — Soldier"). Both renderers
   *  draw the type band as on any frame; the rules, flavour, watermark and
   *  their box stay hidden. Code-owned, opt-in; meaningless without
   *  `textless`. */
  textlessTypeLine?: boolean;
  /** The creator's frame tile (FrameThumb) draws its sample art in this
   *  profile's art slot under the master, as it does for every art-first
   *  frame (artFillsCard) — TODO 4.45, owner decision 2026-09-27. For a tall
   *  window whose master is see-through there, so the bare master read as a
   *  near-black tile on the tile's dark ground, although the art does not
   *  fill the card: Anime, Ghostfire, the ZNR hedron (`fullart`), both M15
   *  textless frames and Nyx. A hand-picked list, not a rule — M15
   *  planeswalker, the tokens and Expedition Land sit between these on both
   *  window size and tile brightness and keep their tiles. Picker-only:
   *  FrameThumb is its one reader; no card, preview, bake or finish reads
   *  it, so it never needs a layout bump. Code-owned, opt-in, and set on the
   *  PROFILES entry itself, never on a base another profile spreads (FULLART
   *  → M15TEXTLESS → M15TEXTLESSLAND), so no new profile inherits it. */
  pickerSampleArt?: boolean;
};

/** Where a basic land's symbol prints — FrameProfile.basicSymbol (TODO
 *  3.24). When a profile sets it, a BASIC land (basicLandManaKey ≠ null)
 *  draws its symbol here and the rules-box watermark is skipped; nothing is
 *  drawn centred on the art. An explicit watermark swaps into the slot: a
 *  mana watermark swaps the symbol, a preset or custom image is contained in
 *  it. Every other card on the profile keeps the rules-box watermark.
 *    • "disc"  — a filled disc in `rect` (under the frame, so a see-through
 *                socket's painted ring overlaps its edge — today's MSE
 *                fullartland master) with the symbol on it.
 *    • "glyph" — the symbol alone, above the frame: the frame paints its own
 *                disc or medallion (Card Conjurer's Fullart Basics 2022 disc
 *                at 4.13/83.43/11.2×8.0 %, the ZEN medallion).
 *    • "none"  — nothing: the frame master prints the symbol itself. */
export type BasicSymbolSlot = {
  rect: Rect;
  style: "disc" | "glyph" | "none";
  /** The symbol image per mana key, `{symbol}` → w/u/b/r/g/c (Card
   *  Conjurer's `textless/2022/s{w,u,b,r,g,c}.png`), contained in `rect`
   *  instead of the Mana-font glyph. A public/frames or frames-bucket path:
   *  frameAssetPathsFor lists it, so the bake preloads it on Vercel. */
  assetPathTemplate?: string;
};

/** Card Conjurer's Fullart Basics (2022) symbol box (`packTextlessBasics2022
 *  .js`: 62/1752 px, 168 × 168 on 1500 × 2100): the frame paints the disc,
 *  the symbol goes on top. For 4.39's `m15fullartland` / re-sourced
 *  `fullartland`; add `assetPathTemplate` once the `s?.png` symbols are
 *  published (frames bucket only — Card Conjurer art never enters git). */
export const BASIC_SYMBOL_CC_2022: BasicSymbolSlot = {
  rect: { topPct: 83.43, leftPct: 4.13, widthPct: 11.2, heightPct: 8.0 },
  style: "glyph",
};

/** Today's `fullartland` master (MSE `magic-m15-full-art-basic-land-symbol`)
 *  has a see-through socket at the left end of its type bar: clear from
 *  54–251 px × 1743–1929 px on 1500 × 2100, inside a dark painted ring. The
 *  disc runs 2 px under the ring all round. */
export const BASIC_SYMBOL_MSE_SOCKET: BasicSymbolSlot = {
  rect: { topPct: 82.62, leftPct: 3.47, widthPct: 13.47, heightPct: 9.62 },
  style: "disc",
};

/** Card Conjurer's Zendikar basic (`packZendikarBasic-1.js`): the medallion
 *  between the two halves of the type line (4.40). */
export const BASIC_SYMBOL_ZEN_MEDALLION: BasicSymbolSlot = {
  rect: { topPct: 78.67, leftPct: 42, widthPct: 16, heightPct: 11.43 },
  style: "glyph",
};

/** …and its type line: "Basic Land" left of the medallion, the subtype
 *  centred right of it (CC's `type` and `typeright` boxes, y 81.96 %). */
export const TYPE_SPLIT_ZEN: TypeLineSplit = {
  leftRect: { topPct: 81.96, leftPct: 8.54, widthPct: 33.47, heightPct: 5.43 },
  rightRect: { topPct: 81.96, leftPct: 58, widthPct: 28, heightPct: 5.43 },
};

/** The brand mark's box offsets from the card's right and bottom edges, as %
 *  of the card's width and height (the same CSS `right` / `bottom` both
 *  renderers set). `pill` backs the mark with a dark rounded pill
 *  (BRAND_MARK_PILL) for a mark that sits on the art; the offsets then place
 *  the pill's box. */
export type BrandMarkPlacement = { rightPct: number; bottomPct: number; pill?: boolean };

/**
 * The collector line's geometry (TODO 4.9b): where lib/cards/collector-
 * layout.ts sets its runs. Horizontal values are % of the card's width,
 * baselines % of its height, sizes fractions of the width (as every font
 * size is). The one slot is M15's (M15_COLLECTOR), measured on the prints.
 */
export type CollectorSlot = {
  /** The pen x of both lines. */
  leftPct: number;
  /** The © slot's right edge (the brand mark's, a clean download's footer
   *  text's). */
  rightPct: number;
  /** Line 1's baseline (the number line). */
  line1BaselinePct: number;
  /** Line 2's baseline (set • language, the brush, the artist). */
  line2BaselinePct: number;
  /** The brush's pen x — and the 2015 style's rarity-letter column. */
  brushLeftPct: number;
  /** The collector face's size (the number, the set and language codes). */
  sizePct: number;
  /** The artist's size (the display face's synthesized small caps). */
  artistSizePct: number;
  /** The © slot's text size (a clean download's footer text, body face). */
  markTextSizePct: number;
  /** The © slot's line where the FRAME's own art carries a stat shield in
   *  line 1's corner, whatever the card draws there: always 2. Unset, the
   *  slot is on line 2 only when the renderer draws a stat plate (a P/T, the
   *  loyalty shield, the defense badge) and on line 1 without one. */
  markLine?: 2;
};

/** Default placement: inside the M15 black border (≈73 px of black above the
 *  ink on a 1500×2100 card, 34 px below). */
export const BRAND_MARK_PLACEMENT: BrandMarkPlacement = { rightPct: 3.5, bottomPct: 1.8 };

/** The dark pill behind a brand mark on the art (TODO 3.23). Padding is a
 *  fraction of the card's width at portrait scale (brandMarkLayout's `scale`
 *  applies), so the preview (cqw) and the bake (px) draw the same pill. The
 *  watermark policy keeps the mark on every display surface; on bright art
 *  the plain 82 % white mark with its 1 px shadow all but vanishes. */
export const BRAND_MARK_PILL = {
  padXPct: 0.009,
  padYPct: 0.0035,
  /** Corner radius = this many em of the mark's font + the vertical padding:
   *  half the pill's height (the display face's line box is ≈1.2 em), so the
   *  ends are round in both renderers without relying on radius clamping. */
  radiusEm: 0.6,
  fill: "rgba(12,12,16,0.62)",
} as const;

/** Placement for a bar-less edge-to-edge treatment whose bottom-right corner
 *  is art (fullartland, 4.36 text-on-art, 4.37 tokens): the pill, inside the
 *  printed safe margin. Opt in with `brandMark: BRAND_MARK_ON_ART`. */
export const BRAND_MARK_ON_ART: BrandMarkPlacement = { rightPct: 3.5, bottomPct: 1.6, pill: true };

/** Brand-mark placement + size scale for a profile. The mark is sized off
 *  the card's SHORT side — 2.6% of a portrait card's width — so a landscape
 *  card (battle, split) prints it at the same physical size instead of 1.4×
 *  larger. Both renderers read this, so preview and bake can't drift. */
export function brandMarkLayout(
  profile: FrameProfile,
): BrandMarkPlacement & { scale: number } {
  return {
    ...(profile.brandMark ?? BRAND_MARK_PLACEMENT),
    scale: profile.orientation === "landscape" ? 5 / 7 : 1,
  };
}

/** True when the art window reaches a card edge (TODO 3.23) — an
 *  edge-to-edge treatment (borderless, full-art without a border). The same
 *  test 7.7's edge contract makes of an `art` edge. The etched finish masks
 *  by the frame's luminance, so on a mostly see-through frame it all but
 *  vanishes: the creator hides it on these frames until the etched frame
 *  treatment (4.28). */
export function artReachesCardEdge(profile: Pick<FrameProfile, "artSlot">): boolean {
  const a = profile.artSlot;
  return a.topPct <= 0 || a.leftPct <= 0 || a.leftPct + a.widthPct >= 100 || a.topPct + a.heightPct >= 100;
}

/** A full-art basic's window spans at least this much of the card on both
 *  axes: all of it inside the ring (m15fullartland: 92.14 × 89.29 %). */
const FULL_ART_WINDOW_MIN_PCT = 85;

/** True when the art is (nearly) the whole card, so the frame master is
 *  see-through almost everywhere and a thumbnail of the bare master reads as
 *  a black tile (TODO 4.45): an edge-to-edge treatment (artReachesCardEdge —
 *  the borderless M15 skins, the borderless full-art basic) or a full-art
 *  basic inside its ring (a basic land's symbol slot, `basicSymbol`, on a
 *  window of FULL_ART_WINDOW_MIN_PCT or more each way — m15fullartland).
 *  The creator's frame tiles draw a sample art under these masters
 *  (FrameThumb); cards, previews and bakes never read it. Six other
 *  tall-window frames whose tiles read as near-black (Anime, Ghostfire, the
 *  ZNR hedron, the two textless frames, Nyx) are not art-first: their tiles
 *  opt in by name (FrameProfile.pickerSampleArt, owner 2026-09-27). */
export function artFillsCard(profile: Pick<FrameProfile, "artSlot" | "basicSymbol">): boolean {
  if (artReachesCardEdge(profile)) return true;
  const a = profile.artSlot;
  return (
    profile.basicSymbol !== undefined &&
    a.widthPct >= FULL_ART_WINDOW_MIN_PCT &&
    a.heightPct >= FULL_ART_WINDOW_MIN_PCT
  );
}

/** Resolve a per-color asset path from a template like "/frames/m15/pt/{color}.png". */
export function resolveColorAsset(pathTemplate: string, colorKey: string): string {
  return pathTemplate.replace("{color}", colorKey);
}

// ---------------------------------------------------------------------------
// Shared ink colors. Painted MSE plates are warm cream/tan, so card text is
// near-black; values that sit directly on the frame (footer on a dark border,
// loyalty on a drawn badge) flip to a warm white.
// ---------------------------------------------------------------------------
// Printed-MTG loyalty badges — the real MSE mainframe-planeswalker shield
// assets (public/frames/m15pw/loyalty*.png, silver rim + black fill), shared
// by the live preview and the Satori bake so both draw identical icons.
// +N = peaked top, -N = pointed bottom, 0/static = flat hexagon.
const LOYALTY_BADGE_ASSETS = {
  up: "/frames/m15pw/loyaltyup.png",
  down: "/frames/m15pw/loyaltydown.png",
  zero: "/frames/m15pw/loyaltynaught.png",
} as const;

export function loyaltyBadgeShapeFor(
  cost: string,
): keyof typeof LOYALTY_BADGE_ASSETS {
  if (cost.startsWith("+")) return "up";
  if (cost.startsWith("-") || cost.startsWith("\u2212")) return "down";
  return "zero";
}

/** The badge PNG for a loyalty cost ("+1" → the peaked-top shield). */
export function loyaltyBadgeAssetFor(cost: string): string {
  return LOYALTY_BADGE_ASSETS[loyaltyBadgeShapeFor(cost)];
}

const INK_DARK = "#17120c";
const INK_DARK_SOFT = "#2a2118";
const INK_LIGHT = "#f4eee2";
const OUTLINE_SHADOW =
  "1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000";
/** Outline for small text set straight on the art (the footer of a bar-less
 *  treatment, TODO 3.8): in em, like ALPHA_EMBOSS, so the preview and the
 *  bake draw it at the same size at every scale (OUTLINE_SHADOW's 1 px is a
 *  hairline at HD and a smear on a 250 px tile). Card Conjurer outlines its
 *  bottom info the same way. */
export const ON_ART_OUTLINE =
  "0.06em 0.06em 0 #000, -0.06em 0.06em 0 #000, 0.06em -0.06em 0 #000, -0.06em -0.06em 0 #000";

/** The white keyline a printed set symbol wears on a dark type bar
 *  (FrameProfile.setSymbolKeyline, 4.32): eight zero-blur copies 0.05 em out
 *  — the width of Keyrune's own `.ss-border` outline (a 0.1 em stroke
 *  painted under the fill) — axis and diagonal, so the ring is even on
 *  every edge. In em, like ON_ART_OUTLINE: the same keyline at every render
 *  size in the preview (a CSS text-shadow) and the bake (offset copies,
 *  textShadowCopies). */
export const SET_SYMBOL_KEYLINE =
  "0.05em 0 0 #ffffff, -0.05em 0 0 #ffffff, 0 0.05em 0 #ffffff, 0 -0.05em 0 #ffffff, " +
  "0.035em 0.035em 0 #ffffff, -0.035em 0.035em 0 #ffffff, 0.035em -0.035em 0 #ffffff, -0.035em -0.035em 0 #ffffff";

/** One layer of a multi-layer text shadow, in px at the text's font size. */
export type TextShadowCopy = { dx: number; dy: number; color: string };

const SHADOW_LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(px|em)?$/;

/**
 * A text shadow of TWO OR MORE zero-blur layers (ON_ART_OUTLINE,
 * OUTLINE_SHADOW) as px offsets at `fontPx`, or null. The bake draws these
 * as offset copies of the text under it instead of a CSS text-shadow:
 * Satori writes one feDropShadow per layer and merges them, and the bake's
 * rasteriser (sharp → librsvg) keeps only the last layer, so a four-way
 * outline baked as a one-sided up-left shadow while the browser drew all
 * four (new-frames review 2026-09-26). A single layer rasterises correctly,
 * and a blurred one can't be drawn as a copy: both stay CSS (null).
 */
export function textShadowCopies(shadowCss: string, fontPx: number): TextShadowCopy[] | null {
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < shadowCss.length; i += 1) {
    const ch = shadowCss[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      layers.push(shadowCss.slice(start, i));
      start = i + 1;
    }
  }
  layers.push(shadowCss.slice(start));
  if (layers.length < 2) return null;
  const copies: TextShadowCopy[] = [];
  for (const layer of layers) {
    const tokens = layer.trim().match(/[a-z]+\([^)]*\)|[^\s]+/gi) ?? [];
    const lengths: number[] = [];
    let color: string | null = null;
    for (const token of tokens) {
      const m = SHADOW_LENGTH.exec(token);
      if (m) {
        if (m[2] === undefined && Number(m[1]) !== 0) return null;
        lengths.push(m[2] === "em" ? Number(m[1]) * fontPx : Number(m[1]));
      } else if (color === null) {
        color = token;
      } else {
        return null;
      }
    }
    // Offsets, then an optional blur that must be zero.
    if (lengths.length < 2 || lengths.length > 3 || (lengths[2] ?? 0) !== 0 || !color) return null;
    copies.push({ dx: lengths[0], dy: lengths[1], color });
  }
  return copies;
}

// Printed Alpha/Beta lettering on the frame — the P/T and the "Illus." line:
// dark ink on the white frame, an embossed silver-grey on every other colour
// (a dark lower-right edge, no highlight). Measured on 19 LEA/LEB scans (the
// brightest 0.7 % of the stroke cores after a 1 px blur; shadow = darkest):
//   u #b4c2c2 · b #969c9f–#a6aeae · r #939792–#9c9e98 · g #7a8585–#99a09f ·
//   artifact #76807f–#7e8c8e · shadow ≈ black at 75 % over the frame.
// Alpha printed no gold cards, so m takes the colours' median. The artifact
// master ("a", MSE's artifact card: dark warm brown like the print,
// scripts/build-alpha-frames.mjs) takes the print's artifact grey. Our grey
// colourless master ("c", a colourless NON-artifact, which Alpha never
// printed) is a mid-grey (strip ≈ 113) where the printed artifact frame is
// dark brown (≈ 79), so c keeps the print's CONTRAST (≈ 2.3 : 1) rather than
// its grey, which would all but vanish. The shadow is in em, so the preview
// and the bake draw it at the same size at every scale.
const ALPHA_EMBOSS = "0.035em 0.035em 0 rgba(0,0,0,0.75)";
/** Silver for a mid-tone frame (our grey colourless, the brown land). */
const ALPHA_SILVER_MID = "#b0b4b4";
const ALPHA_INK: InkByColorKey = {
  u: { colorHex: "#b4c0c2", shadowCss: ALPHA_EMBOSS },
  b: { colorHex: "#9da4a6", shadowCss: ALPHA_EMBOSS },
  r: { colorHex: "#989b96", shadowCss: ALPHA_EMBOSS },
  g: { colorHex: "#858c8c", shadowCss: ALPHA_EMBOSS },
  c: { colorHex: ALPHA_SILVER_MID, shadowCss: ALPHA_EMBOSS },
  a: { colorHex: "#7e888c", shadowCss: ALPHA_EMBOSS },
  m: { colorHex: "#989c9a", shadowCss: ALPHA_EMBOSS },
};
// The name and type line (bandTextStyle) print in the same silver only where
// the dark ink all but vanishes: the black frame's marble (title band: dark
// 1.15 : 1, silver 6.4 : 1) and the brown artifact card's (dark 1.44 : 1,
// silver 3.57 : 1). The print letters them silver on every colour, but on
// our blue the silver reads worse than the dark ink (2.4 : 1 against 4.1),
// and on red and green it changes little (2.4 vs 2.8, 2.3 vs 2.4), so those,
// white, gold and the grey colourless card keep the dark name and type line
// (owner decision 2026-09-25).
const ALPHA_BAND_INK: InkByColorKey = {
  b: ALPHA_INK.b,
  a: ALPHA_INK.a,
};

// ---------------------------------------------------------------------------
// M15-era display sizes (TODO 4.20, layout v32). Every frame in
// lib/cards/m15-family.ts prints its name, type line, pips and set symbol at
// the ONE set of sizes in lib/cards/typography.ts (TITLE_SIZE_PCT 80 px,
// TYPE_SIZE_PCT 68 px, COST_DISC_PCT 72.75 px, SET_SYMBOL_BOX_PCT 86 px at
// HD) — Card Conjurer's, which match the prints — instead of per-frame
// literals that ran 5–24 % small. The rects did not move: the bands, the
// pips (costDy) and the set symbol stay where v24–v31 verified them, and a
// band whose text grew keeps its BASELINE with TextSlot.dy (keepBaseline).
// Only the Card Conjurer masters' type line also moves onto the prints'
// baseline (CC_M15_TYPE_DY); the MSE-framed spreads keep theirs until the
// Card Conjurer re-source (TODO 4.21).
// ---------------------------------------------------------------------------

/** Beleren Bold's baseline below the centre of its line box, per em:
 *  (hhea ascender 1917 − descender 552) ÷ 2 ÷ 2048 units — the display
 *  face's own, from the generated table (lib/cards/type-faces.ts, TODO
 *  4.8.0). Both renderers centre a band's single line box (line-height
 *  normal = the hhea box, 1.2056 em) in its rect, so a band whose font
 *  grows by Δ (a fraction of the card's width) lowers its baseline by
 *  this × Δ. tests/unit/cards/m15-text-sizes.test.ts re-reads the TTF. */
export const DISPLAY_BASELINE_BELOW_CENTRE_EM = TYPE_FACES.display.baselineBelowCentreEm;

/** The TextSlot.dy that keeps a centred band's baseline where it printed at
 *  `fromPct` once its size is `toPct` (both fractions of the card's width,
 *  the unit of dy): the text moves up by the baseline's drop. Exact in the
 *  preview; the bake rounds it to whole pixels (≤ 1 px from the old
 *  baseline at 750 and 1500 px, measured on bakes of every family slot). */
function keepBaseline(fromPct: number, toPct: number, font?: SlotFace): number {
  return -typeFace(font).baselineBelowCentreEm * (toPct - fromPct);
}

/**
 * The dy a front-face band's text is drawn with at `drawnSizePct` (both
 * renderers — the preview's textDy, the bake's textDyBake; layout v32): the
 * slot's own dy while it prints at its size, and for a measured line the
 * fit SHRANK, the same baseline — keepBaseline from the slot's size to the
 * drawn one, on top of the slot's dy — as a print sets a condensed name or
 * type line on its band's common baseline (a centred shrunk line used to
 * climb ≈ 0.33 px per px it lost: Vinnie 'Goldfang' Lupo at 46 px sat 11 px
 * above every full-size name). The bake passes its whole-px size.
 */
export function slotTextDy(slot: Pick<TextSlot, "dy" | "fit" | "sizePct" | "font">, drawnSizePct: number): number {
  const dy = slot.dy ?? 0;
  if (slot.fit !== "measured" || !(drawnSizePct < slot.sizePct)) return dy;
  // The baseline is the slot's own face's (TODO 4.8.0).
  return dy + keepBaseline(slot.sizePct, drawnSizePct, slot.font);
}

/** The M15 name: 0.05 → TITLE_SIZE_PCT, baseline kept — it already sits on
 *  the prints' (188.7 vs 188.0–188.2 px on 2023+ prints at HD). Spread with
 *  M15.title by every frame on the M15 skeleton. */
const M15_TITLE_DY = keepBaseline(0.05, TITLE_SIZE_PCT);
/** The M15 type line: 0.0435 → TYPE_SIZE_PCT, baseline kept. The MSE-framed
 *  spreads (adventure, extended art, Expedition, Nyx) keep it; their print
 *  offsets belong to the Card Conjurer re-source (TODO 4.21). */
const M15_TYPE_DY = keepBaseline(0.0435, TYPE_SIZE_PCT);
/** Card Conjurer's M15 masters (frames swap 4.4) print the type line ~4 px
 *  lower than the cards: 1263.7 px at HD vs 1259.6 on 22 black-bordered and
 *  borderless 2023+ prints (4.20 print review; pre-2023 prints sit at
 *  1262.2). The correction lifts it 4.2 px at HD (0.2 %H, the review's
 *  rendered check: 1259.7) onto the print's baseline — only on the
 *  profiles that draw those masters (the registry m15 entry, land, snow
 *  land, artifact, snow, devoid, borderless and its artifact, the
 *  planeswalker's M15 type slot), NOT on M15 itself, whose geometry the
 *  MSE-framed families spread (as with CC_M15_COST_DY). The tokens' pill
 *  prints LOWER than ours (1800.4 vs 1796 px): TODO 4.49 (d) moves their
 *  type line down instead (TOKEN_TYPE_PRINT_DY). */
const CC_M15_TYPE_PRINT_DY = -0.0028;
const CC_M15_TYPE_DY = M15_TYPE_DY + CC_M15_TYPE_PRINT_DY;
/** The art slot of the Card Conjurer M15 masters (TODO 4.4 (2), layout v35):
 *  their window is 116–1384 × 238–1165 px on every colour of m15, land,
 *  snow land, artifact, snow and devoid, 1–1.6 px wider and taller on every
 *  side than the inherited MSE slot 7.8/11.4/84.4 × 44.0 (117–1383 ×
 *  239.4–1163.4), so a #101015 hairline framed every such card's art. CC's
 *  own artBounds (packM15RegularNew.js: 7.67/11.29/84.76 × 44.29 →
 *  115.05–1386.45 × 237.09–1167.18) cover it but for the top: 0.91 px of
 *  overscan there, and the art-window check (TODO 7.6) asks 1.05 px. So:
 *  CC's left, width and bottom edge, the top 0.04 % higher (11.25 %,
 *  236.25 px). Overscan 0.95 / 2.45 / 1.75 / 2.18 px (left, right, top,
 *  bottom). Only on the profiles that draw those masters, NOT on M15, whose
 *  slot the MSE-framed adventure spreads (as with CC_M15_COST_DY). */
const CC_M15_ART_SLOT: Rect = { topPct: 11.25, leftPct: 7.67, widthPct: 84.76, heightPct: 44.33 };

// ---------------------------------------------------------------------------
// Profiles. Coordinates measured from the 1500×2100 white frame PNGs by
// scanning the center column for transparent (art) and painted (plate) runs;
// every color variant shares the same slots (same MSE template).
// ---------------------------------------------------------------------------

// M15 — the Magic 2015 modern frame. Painted title plate (5–10%), art window
// (11–55%), type bar (56–61%), text box (63–93%), dark bottom border, and a
// painted P/T plate via the pt/ asset set.
const M15: FrameProfile = {
  label: "M15",
  // Pip disc measured on a real DOM Serra Angel scan (frame-compare tool,
  // 745px PNG): ~34px ≈ 4.6% of card width; 0.0485 lands our disc there.
  costSizePct: COST_DISC_PCT,
  artSlot: { topPct: 11.4, leftPct: 7.8, widthPct: 84.4, heightPct: 44.0 },
  // Card Conjurer's M15 symbol box (setSymbolBounds 0.12 W × 0.041 H, 86 px
  // at HD; layout v32): the default mark and an uploaded icon fill it, a
  // Keyrune glyph is fitted to it by its ink (lib/cards/set-symbol-size.ts,
  // setSymbolFit "ink") — 0.83–1.07 of the prints' keyline-inclusive height
  // on compact and medium glyphs (DOM, BFZ, KTK, TLA, SPM, IKO, FIN, EOE,
  // MSC; print checks 2026-09-28), where type.sizePct × 1.1 drew 0.60–0.82;
  // wide ones (M20/M21/SLD, DSK, NEO, OTJ, WOE, MH3, LTR) stay 0.51–0.62,
  // capped by box × KEYRUNE_EM_PER_BOX (TODO 4.46). Every profile that
  // spreads M15 inherits it.
  symbolSizePct: SET_SYMBOL_BOX_PCT,
  setSymbolFit: "ink",
  title: {
    // 7-card scan sweep: title ink starts at 8.3–8.9% of card width (avg
    // 8.55). Cost pips end at 92.2%W — the dark cluster at ~94% that an
    // earlier pass took for the pip edge is the name bar's right bevel
    // shading (identical in every card's title AND type band).
    rect: { topPct: 4.8, leftPct: 8.5, widthPct: 83.7, heightPct: 6.0 },
    sizePct: TITLE_SIZE_PCT,
    dy: M15_TITLE_DY,
    fit: "measured",
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    letterSpacingEm: 0.01,
  },
  type: {
    // Measured on the scan: type ink center sits at 59.13% of card height and
    // its cap height is ~86% of the title's — real M15 type lines are much
    // larger than the old 0.034. Long lines shrink via fitSingleLineSizePct
    // instead of ellipsizing. Shared by snow/devoid.
    // Right edge 92.2%W: the real set symbol's ink ends at ~92%W (685px on
    // the 745px scans), well left of the bar's bevel shading.
    rect: { topPct: 56.5, leftPct: 8.5, widthPct: 83.7, heightPct: 5.2 },
    sizePct: TYPE_SIZE_PCT,
    dy: M15_TYPE_DY,
    fit: "measured",
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    // Top 63.6 centers the block at 77.6% of card height — the measured
    // block center across all seven reference scans (77.2–78.0 regardless
    // of text length).
    rect: { topPct: 63.6, leftPct: 8.5, widthPct: 83, heightPct: 28.0 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_DARK,
    // Real M15 cards vertically center the rules block when it doesn't fill
    // the box (see any short-text printing, e.g. DOM Serra Angel) — full
    // boxes render identically either way.
    vAlign: "center",
    font: "body",
    // The prints' margins (layout v33, TODO 3.29): full-box print ink runs
    // y 1333–1927 and from x 134 on an HD card, within a few px of this box
    // (1335.6–1923.6, x 127.5) — not the 18 / 9 px the old padding kept. No
    // vertical padding at all: a 0.98 em line box already holds 0.07 em of
    // air above its ascenders and 0.016 em below its descenders, so the
    // first ascender lands at y ≈ 1340 (the prints' 1333–1343) and the last
    // descender ends ≈ 1.4 px inside the box; an accented capital's extra
    // height is the layout's headroom (insetTop), never clipped. (6 px, the
    // first cut, left ≈ 23 px of the prints' box unused: 113 of 706 public
    // boxes and 5 of 25 prints one 2 px step small — layout v33 review.) The
    // profiles that spread M15 inherit them; borderless and extended art,
    // whose drawn boxes differ, keep the default (a by-eye item on the
    // round-9 sheet).
    padPx: { x: 4, y: 0 },
  },
  footer: {
    // The real artist line's ink centers at ~96.2% of card height and its
    // bright text starts at ~6.4% of width (7-card sweep); ours sat a full
    // 1% higher and 1.6% right.
    rect: { topPct: 94.6, leftPct: 6.5, widthPct: 87, heightPct: 3.2 },
    sizePct: 0.019,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.06,
    font: "display",
  },
  pt: {
    // Card Conjurer's measured M15 geometry (TODO 4.18, frames swap 4.4):
    // the plate is its own box at its native 2.04 aspect — the old single
    // rect (23 × 5.8 %) stretched it ~40 % too wide — and the digits centre
    // in CC's text box, which lands them on the printed (86.1 %W, 91.9 %H).
    rect: { topPct: 90.2, leftPct: 79.28, widthPct: 13.67, heightPct: 3.72 },
    plateRect: { topPct: 88.48, leftPct: 75.73, widthPct: 18.8, heightPct: 7.33 },
    // The plate's face on the digits' rows: from 1185 px (past the lit
    // bevel) to the shaded bevel, whose half-way line bows from 1392.5 to
    // 1396.4 px and averages 1395.4 — the same on every colour and on the
    // artifact / snow / devoid plates.
    inkSpanPct: { leftPct: 79, rightPct: 93.027 },
    sizePct: 0.05,
    colorHex: INK_DARK,
    weight: 700,
    plateAssetPathTemplate: "/frames/m15/pt/{color}.png",
    valueDyEm: -0.04,
  },
};

// M15 Land — M15 card geometry (art window, type bar, text box, dark bottom
// border, P/T plate) with the stone land texture. Two land-specific tweaks:
//   • hideCost — the MSE land frame paints no cost box, so suppress the cost for
//     ANY card type on this frame (matches ALPHALAND; lands have no cost anyway).
//     Without this, a non-land card placed on the land frame would still paint a
//     cost into dead space.
//   • title inset — the MSE land frame once painted a color-indicator orb at
//     the left of the title bar, which pushed the name to 14%. The orb was
//     removed from the PNGs (f15273e) and the name moved back to 8.4% — a DB
//     override on production since 2026-07-08, folded into code 2026-09-25
//     (migration 0114). The band keeps its 77.5% width; keep the right edge
//     with M15 (14 + 77.5 = 91.5 ≈ 8.5 + 83).
// A Card Conjurer master (4.4): the type line sits on the prints' baseline
// (CC_M15_TYPE_DY), the art on CC's window (CC_M15_ART_SLOT, layout v35).
const M15LAND: FrameProfile = {
  ...M15,
  label: "M15 Land",
  hideCost: true,
  artSlot: CC_M15_ART_SLOT,
  title: {
    ...M15.title,
    rect: { ...M15.title.rect, leftPct: 8.4, widthPct: 77.5 },
  },
  type: { ...M15.type, dy: CC_M15_TYPE_DY },
};

// Snow land — the frosted land skin. Its title bar starts a touch further
// right than the plain land's (measured in the compare tool; production
// override since 2026-07-08, folded 2026-09-25).
const M15SNOWLAND: FrameProfile = {
  ...M15LAND,
  label: "M15 Snow Land",
  title: {
    ...M15LAND.title,
    rect: { ...M15LAND.title.rect, leftPct: 9.1 },
  },
};

// AgClassic — the 1993 Alpha/Beta frame. MSE's magic-agclassic art, re-cut
// to the printed card's proportions and lines (scripts/build-alpha-frames.mjs;
// HD px on 1500 × 2100, measured on 19 LEA/LEB scans): black border 80 px at
// the sides, 89 above and 100 below the frame (its pinstripe = the outer
// ~10 px, one dark line); title band 100–198; art opening 178–1319 ×
// 219–1138; type band 1164–1247; text box 186–1318 × 1247–1855 (one outline,
// then a bevel to the textured area 201–1300 × 1265–1835); P/T strip
// 1855–1991. Rules are dark ink; the "Illus." line and the P/T share one line
// in the strip, silver on every frame colour but white (ALPHA_INK); the name
// and type line are dark but on the black frame and the artifact card
// (ALPHA_BAND_INK). A colourless ARTIFACT paints the brown artifact card
// (a.png, from MSE's acard.jpg) — every colourless card Alpha printed is one
// (Sol Ring, Juggernaut) — and any other colourless card the grey c.png
// (ccard.jpg).
const AGCLASSIC: FrameProfile = {
  flavorDivider: false,
  label: "Alpha (1993)",
  artifactMasterKeys: { c: "a" },
  // The mark's ink centred in the 100 px black band below the frame.
  brandMark: { rightPct: 3.5, bottomPct: 1.5 },
  // Owner review, round 4: name and pips 15 % smaller than round 3 (54 px
  // discs, were 63; the print's are ~69 px but pale and thin-lined).
  costSizePct: 0.0357,
  // Pip discs centred on the name's caps (~140 px; 2 px above the rect's
  // middle at HD).
  costDy: -0.0013,
  // Covers the 178–1319 × 219–1138 opening with ~6 px under the bevel.
  artSlot: { topPct: 10.15, leftPct: 11.45, widthPct: 76.9, heightPct: 44.3 },
  // Round 4 (owner's pick "B2"): the name starts on the type line's left
  // margin, the art window's edge (~178 px; it started at ~114), with Beleren
  // caps ~41 px (were 48; the print's lighter face has ~57 px caps but a
  // ~34 px x-height, ours ~30). Caps centred at ~141 px. The rect still ends
  // where the cost pips end (~1362 px, 90.8 %W), so a long name ellipsises
  // before them.
  title: {
    rect: { topPct: 4.36, leftPct: 11.87, widthPct: 78.93, heightPct: 4.8 },
    sizePct: 0.0391,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    // Embossed silver where the dark ink all but vanishes (the black frame,
    // the artifact card).
    inkByColorKey: ALPHA_BAND_INK,
  },
  // Starts on the name's left margin (~178 px, the art window's edge — the
  // owner moved it in from the print's ~157) with caps centred at ~1198 px
  // (the type band's middle); the set symbol ends ~4 px inside the text
  // box's outline (1314 vs 1318).
  type: {
    rect: { topPct: 55.1, leftPct: 11.87, widthPct: 75.73, heightPct: 4.0 },
    sizePct: 0.03,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    inkByColorKey: ALPHA_BAND_INK,
  },
  // Inside the textured area with ~30 px at the sides, ~20 above, ~12 below.
  rules: {
    rect: { topPct: 61.2, leftPct: 15.4, widthPct: 69.2, heightPct: 25.6 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
  },
  // Artist line and P/T share one line in the strip under the text box, like
  // the printed "Illus. ©" line: caps centred at ~1920 px, starting ~157 px.
  footer: {
    rect: { topPct: 89.9, leftPct: 10.4, widthPct: 52, heightPct: 3.0 },
    sizePct: 0.016,
    colorHex: INK_DARK,
    uppercase: true,
    letterSpacingEm: 0.05,
    font: "display",
    inkByColorKey: ALPHA_INK,
  },
  // Official 1993 cards print P/T on the frame strip BELOW the text box, not
  // on a plate: digits centred at ~1921 px (0.45 of the 1855–2000 strip,
  // pinstripe included) and ~88 %W, under the text box's right corner.
  // The rect runs on to 1432 px, past the pinstripe's dark line (~1405 on
  // alphaland, ~1410 here), so a long value (`*+1/*+1`) shrinks to the
  // 1236–1404 px it can use centred on 1320 (TODO 4.31); `90/90` fits.
  pt: {
    rect: { topPct: 88.74, leftPct: 80.5, widthPct: 15, heightPct: 5.6 },
    inkSpanPct: { leftPct: 82.4, rightPct: 93.6 },
    sizePct: 0.04,
    colorHex: INK_DARK,
    weight: 700,
    inkByColorKey: ALPHA_INK,
  },
};

/**
 * Card Conjurer's starting-loyalty shield, drawn on every CC-cut walker body
 * (m15pw, the borderless walkers) with THAT body's plate: the value's box is
 * CC's loyalty box (packPlaneswalkerRegular.js: x .806, y .902, 14 × 3.72 %;
 * digits 0.0372 of the card HEIGHT = 0.052 of the width). CC draws the
 * ability stripes BEFORE the frame, so the shield painted into its masters
 * sits on top of them; ours are an overlay above the frame and washed the
 * shield out (owner review 2026-09-25). The importer cuts each master's
 * shield out (SHIELD_BOX in scripts/lib/cc-frames.mjs — plateRect is that
 * box in percent) and it is drawn again here, above the stripes,
 * pixel-for-pixel on the frame's. A walker body is built with
 * walkerAnatomy() (lib/cards/kind-anatomy.ts, TODO 4.5.0).
 */
function ccWalkerShield(plateAssetPathTemplate: string): StatSlot {
  return {
    rect: { topPct: 90.2, leftPct: 80.6, widthPct: 14, heightPct: 3.72 },
    // The shield's dark face is 1233–1395 px wide on the digits' upper rows
    // and tapers to its point below them, so the ink keeps to 1239–1389 px
    // (three digits fit) instead of printing over the silver rim.
    inkSpanPct: { leftPct: 82.6, rightPct: 92.6 },
    plateRect: { topPct: 87.667, leftPct: 79.6, widthPct: 16, heightPct: 7.333 },
    plateAssetPathTemplate,
    sizePct: 0.052,
    colorHex: "#ffffff",
    weight: 700,
    shadowCss: OUTLINE_SHADOW,
  };
}
/** The M15 walker's badge ink and text ceiling (layout v33: the walker
 *  prints' 7.5 pt), shared by every CC walker body. */
const WALKER_BADGE_TEXT_HEX = "#f5f0e4";
const WALKER_MAX_SIZE_PCT = rulesPxToPct(RULES_SIZE_PX.compact);

// Printed planeswalkers stripe each ability row and badge its loyalty cost
// in the left rail; parseLoyaltyAbilities supplies the rows. The lower
// window is a transparent cut-out, so the rules slot gets a translucent
// cream backdrop for legibility (a walker's rows, or any other card's
// rules on the frame).
const M15PW_WALKER = walkerAnatomy({
  shield: ccWalkerShield("/frames/m15pw/loyalty/{color}.png"),
  stripes: { a: "rgba(244,238,226,0.78)", b: "rgba(229,221,202,0.78)" },
  badgeTextHex: WALKER_BADGE_TEXT_HEX,
  maxSizePct: WALKER_MAX_SIZE_PCT,
  rulesBackdropHex: "rgba(244,238,226,0.72)",
});

// M15 Planeswalker — title plate (3.5–8.5%), upper art window (10–55%), type
// bar (56–61%), and a LOWER cut-out (63–91%) that is also transparent: the art
// fills both windows and the abilities text floats over the art, so its rules
// slot gets a translucent cream backdrop for legibility. The loyalty shield is
// the frame's own, redrawn above that backdrop (see `loyalty`). Its walker
// anatomy (shield, rows, backdrop) is M15PW_WALKER above.
const M15PW: FrameProfile = {
  label: "M15 Planeswalker",
  // MSE m15-planeswalker spec: name 23–46px, image 52–479.5, type 296–316,
  // text 330–478 (indented past the loyalty badge rail), loyalty 462+.
  artSlot: { topPct: 9.9, leftPct: 6.7, widthPct: 86.4, heightPct: 81.7 },
  // Title/type tops, the detached cost box and the set-symbol box were tuned
  // in the compare tool (production override 2026-07-09, folded 2026-09-25).
  // Layout v32 (TODO 4.20): the box ends where the printed walkers' pips do
  // — 1380–1383 px at HD on all four measured prints (BFZ #29, DOM #1, KLD
  // #110, AKH #97), and where M15's inline pips end (its band's right edge,
  // 92.2 %W) — not 15 px short of them (91.2 %, tuned on the MSE frame's
  // 64 px discs). With the family's 72.75 px discs that is what lets a name
  // as long as the print's "Chandra, Torch of Defiance" keep full size
  // (owner decision 2026-09-28; lib/cards/title-band.ts fitTitleBand).
  costRect: { topPct: 3.8, leftPct: 52.2, widthPct: 40, heightPct: 4.4 },
  // That box was tuned on the MSE frame. Card Conjurer's planeswalker title
  // bar (frames swap 4.4) runs ~9 px lower at HD (plate 77–192 px vs
  // 73–183 on eight printed M15 planeswalkers, 1500 × 2100), so the pips —
  // centred at 126 px — sat high in it (owner review, round 3). Printed pips
  // centre 48.0 % of the way down the plate (47.3–48.8 %); 6 px down puts
  // ours there (132 px).
  costDy: 0.004,
  // Layout v32: the M15 disc (the prints' pips are ~70 px on a planeswalker
  // as on M15; the old default, the 64 px name size, left them small under
  // an 80 px name — owner decision 2026-09-28). The row stays centred in
  // costRect, so the pips' centre does not move.
  costSizePct: COST_DISC_PCT,
  // Layout v36 (TODO 4.47): the symbol ends where M15's does (92.2 %W, 1383
  // px at HD) — the walker prints put it where their set's regular cards do
  // (BFZ #29, DOM #1, WAR #1, DMU #1, M19 #3, M20 #2, M21 #1: +0.1 px from
  // the regular prints on average, −3.1 … +4.7), 1380–1392 px; at 79 %W it
  // ended 18 px short (1365).
  symbolRect: { topPct: 56.9, leftPct: 80.2, widthPct: 12, heightPct: 3.8 },
  // CC's planeswalker symbol box (0.12 W × 0.0381 H = 80 px, the rect's
  // height; layout v32) — see M15's symbolSizePct.
  symbolSizePct: SET_SYMBOL_BOX_PCT_THIN_BAR,
  setSymbolFit: "ink",
  title: {
    // The name sat just as high: caps centre 125.5 px = 42 % of the plate,
    // level with the old pips. Printed names centre 49–51 % down (126.8–129.2
    // px on eleven M15 walkers), about 2 px below their pips. 3.8 → 4.18
    // (8 px lower at HD) puts ours at 133.5 px = 49 %, 2 px below the pips,
    // the print's relation.
    // Layout v32 grows it 64 → 80 px and keeps it CENTRED on the plate (no
    // dy): CC's plate sits 6–9 px lower than the prints', so the prints'
    // absolute baseline (156 px) would lift the caps ~6 px above the pips.
    // Centred, the caps stay level with the pips, as the owner placed them
    // in round 3 (plate-relative, owner decision 2026-09-28).
    rect: { topPct: 4.18, leftPct: 8.5, widthPct: 80, heightPct: 4.4 },
    sizePct: TITLE_SIZE_PCT,
    fit: "measured",
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    letterSpacingEm: 0.01,
  },
  // Layout v32: M15's type slot. Printed planeswalkers put the type line on
  // M15's baseline (1259.6 px at HD, three BFZ/DOM/AKH walkers) starting at
  // 8.5 %W; ours sat 10 px higher, 8 px right and a quarter small.
  type: { ...M15.type, dy: CC_M15_TYPE_DY },
  // Layout v33: a planeswalker's text (its ability rows, or the plain box
  // with its shield drawn) is capped at loyaltyRows.maxSizePct — the walker
  // prints' 7.5 pt; this 8 pt ceiling is for any other card on the frame
  // (v32's 67 px → 68, never a shrink).
  rules: {
    rect: { topPct: 63.1, leftPct: 8.5, widthPct: 83.5, heightPct: 28.3 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.reduced),
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    ...M15PW_WALKER.rulesPatch,
  },
  loyaltyRows: M15PW_WALKER.loyaltyRows,
  footer: {
    rect: { topPct: 93.4, leftPct: 9, widthPct: 70, heightPct: 3.0 },
    sizePct: 0.016,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.05,
    font: "display",
  },
  loyalty: M15PW_WALKER.loyalty,
};

// M15 Token — the 2014–19 arch token frame (CC 'Textless (Bordered M15)').
// A dark title bar (light, centered name, no cost), a large arched art
// window (12–81%), a cream type pill at the bottom, and the M15 P/T plate
// on the lower band. Token abilities render over the lower art on a dark
// scrim (until 4.49 (b)'s text-box template). The arched top of the window
// is covered by the frame; the artSlot is the bounding box.
// Layout v32: the M15 name and type sizes (the prints' type line is M15's
// ~68 px; the name's Beleren Small Caps is 4.53); the set symbol in M15's
// 86 px box, inside the ~101 px pill.
// TODO 4.49 (a) + (d): the type line starts at CC's 8.54 %W and the set
// symbol is right-anchored in CC's box (below), as every 2014–19 token
// prints them (TDOM #3, TM19 #6, TBFZ #1 …); the P/T sits on M15's plate.
/** How far the token's type band moved up onto the CC pill's centre (82.6 →
 *  82.14 %H, layout v32), as a fraction of card WIDTH (dy's unit): 0.46 %H ×
 *  7/5. The type text's dy moves it back down by exactly this. */
const TOKEN_PILL_LIFT_PCT = (0.46 / 100) * (7 / 5);
/** TODO 4.49, owner decision 2026-09-29: the textless token masters are
 *  RE-CUT (scripts/lib/cc-frames.mjs TOKEN_TEXTLESS_RECUT, whose `shift` a
 *  unit test holds to this): CC's window edge, type pill and the pill's
 *  shadow move down as one piece onto the fifteen 2014–19 textless pins,
 *  which print them 8.2 px below CC's on average (the title bar, the
 *  texture under the pill and the border stay). HD px; the art slot's
 *  bottom, the type band and the set symbol's box move with it. */
export const TOKEN_RECUT_PX = 8;
/** TOKEN_RECUT_PX in card %H. */
const TOKEN_RECUT_PCT = (TOKEN_RECUT_PX / 2100) * 100;
/** CC's textless token pill after the re-cut (card px at HD, interior rows,
 *  inclusive): CC's interior 1716–1822 (between the dark outline's rising
 *  edge at 1715.5 and the bottom bevel's first shaded row, 1823) moved down
 *  TOKEN_RECUT_PX. The prints' interiors run ~1724–1828 (mean of the fifteen
 *  pins; their bottom bevel prints a little higher than CC's). The set
 *  symbol keeps clear of both ends (a unit test holds it). */
export const TOKEN_PILL_INTERIOR_PX = { top: 1716 + TOKEN_RECUT_PX, bottom: 1822 + TOKEN_RECUT_PX };
/** CC's type band on its own (un-moved) pill: layout v32 centred the band
 *  on CC's pill (82.6 → 82.14 %H, TOKEN_PILL_LIFT_PCT). A frame that draws
 *  CC's pill somewhere else (4.49 (b)'s text-box token) derives its band
 *  from this one. */
const TOKEN_CC_TYPE_TOP_PCT = 82.14;
/** TODO 4.49 (d) on CC's own (un-moved) pill: the band rule drew the type
 *  line's baseline at 1796 px, and 4.49 (d) moved it down to the prints'
 *  1800 (+0.0027, a fraction of card WIDTH, dy's unit). A frame that draws
 *  CC's pill somewhere else (4.49 (b)'s text-box token) derives its dy from
 *  this one, with TOKEN_CC_TYPE_TOP_PCT. */
const TOKEN_CC_TYPE_PRINT_DY = 0.0027;
/** TODO 4.49 (d), re-derived for the re-cut: the band rides the moved pill
 *  (TOKEN_RECUT_PX lower), and the text comes back UP onto the prints'
 *  type-line baseline, as a fraction of card WIDTH (dy's unit). The band
 *  rule sets the baseline 4 px lower in its pill than the prints do: on
 *  CC's un-moved pill it drew 1796 px and 4.49 (d) moved it down to 1800
 *  (TOKEN_CC_TYPE_PRINT_DY, +0.0027); the pill moved 8 px, the baseline
 *  does not — 0.0027 − 8/1500. Fifteen 2014–19 token prints (TDOM #2–#11,
 *  TM19, TBFZ, TWAR, TMH1, TKLD, TC18, TEMN; Scryfall PNGs at 1500 × 2100)
 *  print it at 1797–1803, mean 1800.4; the type line's pixels are the same
 *  as before the re-cut. */
const TOKEN_TYPE_PRINT_DY = TOKEN_CC_TYPE_PRINT_DY - TOKEN_RECUT_PX / 1500;
/** CC's setSymbolBounds on its textless token (packTokenTextlessM15.js):
 *  right edge 92.13 %W, centred on 84.39 %H — its own pill's centre. A
 *  frame that moves CC's pill with the symbol (a re-cut master: 4.49 (b)'s
 *  text-box token, and M15TOKEN's own re-cut) derives its box from this
 *  one. */
const TOKEN_CC_SYMBOL_RECT: Rect = { topPct: 82.34, leftPct: 80.13, widthPct: 12, heightPct: 4.1 };
/** TODO 4.49 (a), print pass: M15's plate box (CC's 88.48 %H top) 0.13 %H
 *  (2.7 px at HD) lower on the token frames — where the prints put the
 *  plate. Each of the fifteen prints' plate profile (rim, inner line and
 *  bottom bevel over the plate's flat middle, x 1255–1335 px) aligned to
 *  ours by correlation: CC's plate sits 2.7 px above them on average
 *  (median 3.75; −5.5 to +3.5 print to print, as the prints are cut). The
 *  value box stays M15's (4.18) — the digits were already on the prints
 *  (1291 × 1929.8 px, 15 prints; ours 1291.5 × 1928.5). */
const TOKEN_PLATE_PRINT_DY_PCT = 0.13;
const M15TOKEN: FrameProfile = {
  label: "M15 Token",
  hideCost: true,
  // The window's bottom edge moved down with the re-cut (TOKEN_RECUT_PX), and
  // the slot's bottom with it (1701 → 1709 px): the window's last clear row
  // is 1708 on the see-through and coloured-artifact masters (1704 on the
  // opaque ones), as 1700 / 1696 were on CC's. The art's cover fit follows
  // the taller slot (+0.55 %).
  artSlot: { topPct: 12.0, leftPct: 6.5, widthPct: 87, heightPct: 69.0 + TOKEN_RECUT_PCT },
  // CC's token symbol box, M15's (0.041 H = 86 px; layout v32).
  symbolSizePct: SET_SYMBOL_BOX_PCT,
  setSymbolFit: "ink",
  // CC's setSymbolBounds (TOKEN_CC_SYMBOL_RECT), right edge 92.13 %W (TODO
  // 4.49 (d); it rode the end of a centred type line before), moved down
  // with the re-cut pill: centred on the pill again, 84.77 %H (1780.2 px).
  // The prints centre their symbols on their pill the same way (ink centre
  // 1781.0 px, mean of the fifteen pins; their pill's outline centres on
  // 1780.7); the print pass's 84.78 %H on CC's un-moved pill put tall glyphs
  // on its bottom bevel, 8 px above the prints'.
  symbolRect: { ...TOKEN_CC_SYMBOL_RECT, topPct: TOKEN_CC_SYMBOL_RECT.topPct + TOKEN_RECUT_PCT },
  title: {
    rect: { topPct: 4.6, leftPct: 9, widthPct: 82, heightPct: 6.4 },
    sizePct: TITLE_SIZE_PCT,
    dy: keepBaseline(0.05, TITLE_SIZE_PCT),
    fit: "measured",
    colorHex: INK_LIGHT,
    weight: 600,
    align: "center",
    font: "display",
    letterSpacingEm: 0.01,
  },
  // Measured: the cream type pill spans 82.2–87.0% (was rendered at 87.5+,
  // a band too low); MSE token type font is 14/375.
  // Layout v32: the band is centred on Card Conjurer's pill (interior 1716–
  // 1822 px at HD on every m15token / m15tokenartifact master; at 82.6 %H it
  // centred 9.7 px below it — hidden by the old 55 px symbol, but the 86 px
  // one sat on the pill's bottom bevel, 4.20 print review); the type line
  // kept its baseline — its dy takes the move back as well as the size
  // change.
  // TODO 4.49 (d): left-aligned from CC's 8.54 %W to the set symbol's box
  // (symbolRect, 92.13 %W; the measured fit keeps TYPE_SYMBOL_GAP_PCT before
  // its ink). The band rides the re-cut pill (TOKEN_RECUT_PX lower) and the
  // text sits TOKEN_TYPE_PRINT_DY from the band rule, on the prints'
  // baseline.
  type: {
    rect: { topPct: TOKEN_CC_TYPE_TOP_PCT + TOKEN_RECUT_PCT, leftPct: 8.54, widthPct: 83.59, heightPct: 4.2 },
    sizePct: TYPE_SIZE_PCT,
    dy: keepBaseline(0.034, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT_PCT + TOKEN_TYPE_PRINT_DY,
    fit: "measured",
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  // A textless token prints no text (TDOM #3, TM19 #6): its text goes to the
  // text-box arch (M15TOKENTEXT) — automatically in the creator, the import
  // and the AI jobs, and migration 0129 moved the stored cards with text
  // there (TODO 4.49 (b), owner decision 5). This box and its scrim are the
  // FALLBACK for a card that carries text on this frame anyway — a variation
  // the user picked by hand (it sticks), an older client's save — so the
  // text is never lost nor set straight on the art. Both renderers draw them
  // only when there is text (hasRulesBoxText).
  rules: {
    rect: { topPct: 60.5, leftPct: 12, widthPct: 76, heightPct: 12 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_LIGHT,
    vAlign: "center",
    font: "body",
    backdropHex: "rgba(10,8,6,0.5)",
  },
  footer: {
    rect: { topPct: 94.0, leftPct: 10, widthPct: 80, heightPct: 3.0 },
    sizePct: 0.016,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.05,
    font: "display",
  },
  // TODO 4.49 (a): every 2014–19 token prints its P/T on the M15 plate
  // (78.1–93.6 %W × 89.7–94.6 %H of ink, TDOM #3, TM19 #6, TBFZ #1 …), not
  // on the band's edge (MSE's 88.6–94.8 %H rect put the digits into the
  // black border at ~1948 px). M15's slot as a whole: CC's plate box, the
  // value box (4.18), its ink span, size and dark ink; the plate masters are
  // M15's own (m15/pt, and m15artifact/pt on the artifact token below).
  // The plate box alone moves down onto the prints (TOKEN_PLATE_PRINT_DY_PCT):
  // the digits centre in the value box, not the plate's.
  pt: {
    ...M15.pt!,
    plateRect: { ...M15.pt!.plateRect!, topPct: M15.pt!.plateRect!.topPct + TOKEN_PLATE_PRINT_DY_PCT },
  },
};

// M15 Token with a text box — TODO 4.49 (b): Card Conjurer 'Regular
// (Bordered M15)' (packTokenRegularM15.js), re-cut onto the prints by the
// importer (scripts/lib/cc-frames.mjs TOKEN_REGULAR_RECUT: the lower band
// 64 px down). The same arch, title bar, P/T plate and footer as M15TOKEN;
// the window ends at 1404 px (66.9 %H) and the type pill sits 292 px above
// the textless one, over a cream text box (74.2–92.7 %H) that replaces the
// scrim over the art — the prints: TDOM #2 Knight, TM19 #1 Angel, TC17 #9
// Cat Dragon, TXLN #7 / #10 Treasure, TC16 #9 Thopter.
/** How far the text-box token's pill sits above CC's textless one's: 292 px
 *  at HD (1712 → 1420 px, the pill's top outline; the prints' 1420–1422),
 *  in %H. CC's un-moved textless pill: the textless masters' own re-cut
 *  (TOKEN_RECUT_PX) puts M15TOKEN's 8 px lower, which this one ignores. */
const TOKEN_TEXT_PILL_UP_PCT = (292 / 2100) * 100;
/** Twelve 2014–19 text-box prints set the type line's baseline at 1500 px
 *  (the "Token" ink ends 1498–1505, mean 1501.6, Scryfall PNGs at 1500 ×
 *  2100): 8 px higher against the pill than the textless prints' 1800, so
 *  the text rises 8 px at HD after the band moves up with the pill (a
 *  fraction of card WIDTH, dy's unit). */
const TOKEN_TEXT_TYPE_PRINT_DY = -8 / 1500;
const M15TOKENTEXT: FrameProfile = {
  ...M15TOKEN,
  label: "M15 Token, text box",
  // The re-cut window runs 111–1389 px across and ends at 1408 px (the `c`
  // composite; 1404 on the opaque masters): M15TOKEN's slot, ending 3 px
  // below it (7.6's overscan).
  artSlot: { topPct: 12.0, leftPct: 6.5, widthPct: 87, heightPct: 55.2 },
  // CC's setSymbolBounds (y 0.6743, centre) moved down with the band:
  // centred 70.48 %H on the pill, right edge 92.13 %W as on M15TOKEN. From
  // CC's own box (TOKEN_CC_SYMBOL_RECT), not M15TOKEN's: the re-cut moved
  // CC's pill onto the prints with the symbol, so M15TOKEN's print pass
  // (its symbol 8 px lower on CC's un-moved pill) does not apply here.
  symbolRect: { ...TOKEN_CC_SYMBOL_RECT, topPct: TOKEN_CC_SYMBOL_RECT.topPct - TOKEN_TEXT_PILL_UP_PCT },
  // CC's token band (TOKEN_CC_TYPE_TOP_PCT, centred on CC's textless pill)
  // on this pill, 292 px up (the pill's interior 1424–1530 px), left-aligned
  // from 8.54 %W as on M15TOKEN; the text on CC's pill's print offset
  // (TOKEN_CC_TYPE_PRINT_DY) and 8 px higher to the prints' baseline. From
  // CC's band, not M15TOKEN's: that one rides the textless master's own
  // re-cut (TOKEN_RECUT_PX lower, its dy as much higher), which this master
  // does not have — its own re-cut (TOKEN_REGULAR_RECUT) already put CC's
  // pill on the prints.
  type: {
    ...M15TOKEN.type,
    rect: { ...M15TOKEN.type.rect, topPct: TOKEN_CC_TYPE_TOP_PCT - TOKEN_TEXT_PILL_UP_PCT },
    dy: keepBaseline(0.034, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT_PCT + TOKEN_CC_TYPE_PRINT_DY + TOKEN_TEXT_TYPE_PRINT_DY,
  },
  // CC's rules box (8.6 / 71.43 / 82.8 × 20.48) with its top moved down
  // with the band (1564 px), 5 px inside the drawn box (1559–1947 px) at
  // both ends — CC's ended at 1930, so a centred line sat 5 px above the
  // prints' (their single lines centre on 1751–1753, the drawn box's
  // centre). Dark ink on the cream box, no scrim, the text centred in the
  // box and ONE line centred on it (the prints: "Vigilance" TDOM #2,
  // "Flying" TC17 #9, "This creature is all colors." TWAR #16); two or more
  // lines start at the left (TWAR #6, TM19 #9, TXLN #7). The prints' ink
  // runs x 130–1372: 2 px of padding either side.
  rules: {
    rect: { topPct: 74.48, leftPct: 8.6, widthPct: 82.8, heightPct: 18 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_DARK,
    vAlign: "center",
    alignSingleLine: "center",
    font: "body",
    padPx: { x: 2, y: 0 },
  },
  // The P/T: M15TOKEN's slot as is (by the spread) — M15's value box, and
  // CC's plate box 0.13 %H lower (TOKEN_PLATE_PRINT_DY_PCT). The text-box
  // prints put their plate where the textless ones do: on CC's 88.48 %H
  // box the plate sat 4.1 px above TDOM #2 / TM19 #1 / TC16 #9 (2.5 on
  // average over nine text-box prints), 1.4 px after the move.
};

// The emblem — TODO 4.52: Card Conjurer 'Planeswalker Emblems'
// (packEmblem.js), the M20 design every emblem since 2019-07-12 prints (TM20
// #11, TFDN #24 / #25, TBLB #30, TDSK #17, TFRA #16). One silver master for
// every colour (CR 114: an emblem is colourless; the emblem kind forces c).
// CC's master sits on the prints as it is (feature registration over those
// six plus TKHM #20 and TAFR #16: the title bar, type bar, box bottom and
// sides within 3 px), so it is imported 1:1 — no re-cut. CC's box runs to
// 1946 px (92.67 %H) like the prints' (1947); 4.52's "90.24 %H" was where
// the spark's tail ends inside it.
/** The emblem's slots, measured on the master and the prints (HD px):
 *  the type pill's interior (between its outlines) and the text box's. */
export const EMBLEM_TYPE_PILL_INTERIOR_PX = { top: 1422, bottom: 1528 };
export const EMBLEM_BOX_INTERIOR_PX = { top: 1556, bottom: 1937 };
/** Scryfall's emblem art_crop box on the card (HD px): a 603 × 576 crop at
 *  72.5 / 124 of the 744 × 1040 scan. */
export const EMBLEM_SCRYFALL_CROP_PX = { x: 146.2, y: 250.4, width: 1215.7, height: 1163.1 };
/** The art window: that box exactly, so the art_crop an import brings is
 *  drawn at the print's own scale and place (owner evidence 2026-09-29: the
 *  box grown up to 232 px, 1.6 % taller and wider, drew the art 1.6–1.8 %
 *  larger than the prints; the registration's best fit is now 1.002 — the
 *  744 × 1040 scan's own 0.16 % stretch). */
const EMBLEM_ART_SLOT: Rect = {
  topPct: (EMBLEM_SCRYFALL_CROP_PX.y / 2100) * 100,
  leftPct: (EMBLEM_SCRYFALL_CROP_PX.x / 1500) * 100,
  widthPct: (EMBLEM_SCRYFALL_CROP_PX.width / 1500) * 100,
  heightPct: (EMBLEM_SCRYFALL_CROP_PX.height / 2100) * 100,
};
/** The name's print offset: the band rule's baseline (193 px) up to the
 *  prints' 190, as a fraction of card WIDTH (dy's unit). */
const EMBLEM_TITLE_PRINT_DY = -3 / 1500;
/** The type line's print offset: the pill-centred band's baseline (1498 px)
 *  up to the prints' 1496. */
const EMBLEM_TYPE_PRINT_DY = -2 / 1500;
/** CC's rules box (82.8 %W) plus 10 px on the right: 129–1381 px. */
const EMBLEM_RULES_WIDTH_PCT = ((1381 - 129) / 1500) * 100;
const EMBLEM: FrameProfile = {
  label: "Emblem",
  // No cost, P/T, loyalty or defense slot: an emblem has none (CR 114).
  hideCost: true,
  // The art window is Scryfall's emblem art_crop box, which IS a crop of the
  // printed card around the spark (603 × 576 px at 72.5 / 124 on the 744 px
  // scans of TFDN #24 / #25 and TDSK #17, matched pixel for pixel at scale
  // 1: 146 / 250 px, 1216 × 1163 at HD), so an imported emblem's art lands
  // where it printed, at its printed size. The spark's clear cut-out is
  // inside it: CC's centre ray (732–767 px across) ran on up to the bar,
  // above the crop, where an art_crop has no pixels; the master's silver
  // closes over its top instead and the ray ends at 251 px (owner decision
  // 2026-09-29; scripts/lib/cc-frames.mjs EMBLEM_RAY_BRIDGE), so no second
  // picture shows there. CC's artBounds (14.2 / 4.96 / 71.6 × 85.48 — a
  // tall box, which blew a landscape art up ~2.3× past the prints') is the
  // under-frame layer: the spark's tail runs on through the type bar and
  // the box as CC's 80 % white (α 204) to 1896 px, and the art shows
  // faintly there, as on the prints.
  artSlot: EMBLEM_ART_SLOT,
  underFrameArt: { rect: { topPct: 4.96, leftPct: 14.2, widthPct: 71.6, heightPct: 85.48 } },
  // M15's 86 px symbol box with the ink fit, in CC's setSymbolBounds (right
  // edge 92.13 %W, centred on 70.43 %H — the pill's centre). The symbol is
  // black on the prints; ours keeps the card's rarity ink (an emblem saves
  // as common — 4.9's E and black symbol come later).
  symbolSizePct: SET_SYMBOL_BOX_PCT,
  setSymbolFit: "ink",
  symbolRect: { topPct: 70.43 - 4.1 / 2, leftPct: 80.13, widthPct: 12, heightPct: 4.1 },
  // The source's name, white and centred on the dark bar (CC: 8.54 / 5.22 /
  // 82.92 × 5.43, Beleren Small Caps at 0.0381 H = 80 px = TITLE_SIZE_PCT;
  // small caps are 4.8). The band rule sets the baseline at 193 px; the
  // prints' is 190 (the name's last ink row 189 on TFDN #24 / #25, TBLB #30,
  // TDSK #17, TFRA #16 and TKHM #20; 192 on TM20 #11), so the text rises
  // 3 px (EMBLEM_TITLE_PRINT_DY).
  title: {
    rect: { topPct: 5.22, leftPct: 8.54, widthPct: 82.92, heightPct: 5.43 },
    sizePct: TITLE_SIZE_PCT,
    dy: EMBLEM_TITLE_PRINT_DY,
    fit: "measured",
    colorHex: INK_LIGHT,
    weight: 600,
    align: "center",
    font: "display",
    letterSpacingEm: 0.01,
  },
  // "Emblem", left from CC's 8.54 %W on the light pill, in dark ink, fitted
  // to the set symbol's box. The band is the pill's interior
  // (EMBLEM_TYPE_PILL_INTERIOR_PX), whose centre sets the baseline at
  // 1498 px; the prints' "Emblem" ends at 1495–1496 on all eight, so the
  // text rises 2 px (EMBLEM_TYPE_PRINT_DY).
  type: {
    rect: {
      topPct: (EMBLEM_TYPE_PILL_INTERIOR_PX.top / 2100) * 100,
      leftPct: 8.54,
      widthPct: 83.59,
      heightPct: ((EMBLEM_TYPE_PILL_INTERIOR_PX.bottom - EMBLEM_TYPE_PILL_INTERIOR_PX.top) / 2100) * 100,
    },
    sizePct: TYPE_SIZE_PCT,
    dy: EMBLEM_TYPE_PRINT_DY,
    fit: "measured",
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  // CC's rules box (8.6 / 74.43 / 82.8 × 17.48), dark ink on the light box,
  // centred vertically, ONE line centred on it (TDSK #17 "Ninjas you control
  // get +1/+1.", TFRA #16) and two or more from the left (TFDN #24, TBLB
  // #30) — 4.49 (b)'s alignSingleLine. The prints' ink starts at 131–134 px
  // and a centred line centres on 751–753 px (TDSK #17, TFRA #16), 10 px
  // right of the drawn box's own centre (its inner lines run 95–1385):
  // CC's box, 1242 px wide, centred ours on 745–748. The rect keeps CC's
  // left edge and runs 10 px further right (1381 px, still inside the box's
  // inner line), which puts a centred line on 751–753 and changes no wrap
  // of the prints' texts. Vertically the lines land within 2 px of the
  // prints' (one, two and three lines).
  rules: {
    rect: { topPct: 74.43, leftPct: 8.6, widthPct: EMBLEM_RULES_WIDTH_PCT, heightPct: 17.48 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_DARK,
    vAlign: "center",
    alignSingleLine: "center",
    font: "body",
    padPx: { x: 2, y: 0 },
  },
  // The artist line in the black border under the box (the prints' collector
  // line sits at 1995–2030 px); the brand mark keeps its default place,
  // bottom right in the same border.
  footer: M15.footer,
};

// ---------------------------------------------------------------------------
// The full-art token design, M20 (2019-07-12) → today — TODO 4.48 / 4.50:
// Card Conjurer's 'Textless', 'Short' and 'Tall' token packs
// (packTokenTextless-1.js, packTokenShort-1.js, packTokenTall-1.js; the
// importer's m20TokenTemplate). The art runs to the 60 px black ring; a name
// pill in the token's colour (89–232 px), a light type pill, and — on the two
// text heights — a translucent box down to the colour strip (1937–1948 px);
// the P/T on M15's plate, the artist line in the bottom border. Three
// printed heights, one design: the type pill's top at 81.0 %H (textless,
// re-cut 5 px onto the prints: M20_TOKEN_TEXTLESS_RECUT), 66.9 (the regular
// box: CC 'Short') and 55.7 (the tall box). New templates, no stored card:
// no layout bump (4.48 "Rollout").
// ---------------------------------------------------------------------------

/** The printed heights of the full-art token (TODO 4.48). */
export type M20TokenHeight = "textless" | "regular" | "tall";

/** The textless master's re-cut (scripts/lib/cc-frames.mjs
 *  M20_TOKEN_TEXTLESS_RECUT, whose `shift` a unit test holds to this): its
 *  type pill 5 px below CC's, where 28 M20+ prints put it. HD px. */
export const M20_TOKEN_TEXTLESS_RECUT_PX = 5;

/** Each height's type pill on its master, HD px (interior rows, inclusive:
 *  below the rim's dark top line, down to the bottom outline). The type band
 *  centres on it; a unit test reads the masters. */
export const M20_TOKEN_PILL_INTERIOR_PX: Readonly<Record<M20TokenHeight, { top: number; bottom: number }>> = {
  textless: { top: 1719 + M20_TOKEN_TEXTLESS_RECUT_PX, bottom: 1829 + M20_TOKEN_TEXTLESS_RECUT_PX },
  regular: { top: 1422, bottom: 1532 },
  tall: { top: 1188, bottom: 1298 },
};

/** The name's ink on the dark pills: white, as printed (CC's title colour). */
const M20_TOKEN_TITLE_INK = "#ffffff";
/** The name's baseline, onto the prints': centred in CC's name box the
 *  line sets it at 194 px; 63 M20+ prints (Scryfall PNGs at 1500 × 2100,
 *  every height) set it at 190 (median; the ink's last full row). A fraction
 *  of card WIDTH (dy's unit): 4 px up at HD, 2 at 750. */
const M20_TOKEN_TITLE_PRINT_DY = -4 / 1500;
/** The type line's baseline per height, onto the prints': the band centres
 *  its line box on the pill (M20_TOKEN_PILL_INTERIOR_PX), which sets the
 *  baseline at 1803 / 1501 / 1267 px; the prints set it at 1797 (28
 *  textless), 1496 (19 regular) and 1261 (16 tall) — medians, ~18 px below
 *  the pill's centre on all three. Whole HD px, as fractions of card WIDTH. */
const M20_TOKEN_TYPE_PRINT_DY: Readonly<Record<M20TokenHeight, number>> = {
  textless: -6 / 1500,
  regular: -5 / 1500,
  tall: -6 / 1500,
};
/** Each height's set-symbol centre, HD px: the prints' (the symbol's ink box
 *  centre inside the pill, medians of 22 / 16 / 14 prints from 2023 on;
 *  Keyrune glyphs differ by set, so the box centre, not the ink, is what a
 *  frame fixes). CC's setSymbolBounds centres are 1772 + the 5 px re-cut
 *  (1777), 1475 and 1241. */
export const M20_TOKEN_SYMBOL_CENTRE_PX: Readonly<Record<M20TokenHeight, number>> = {
  textless: 1775,
  regular: 1476,
  tall: 1241.5,
};
/** The P/T digits sit 3.5 px higher on the M20 prints than M15's value box
 *  sets them (the digits' ink box, 14 / 12 / 28 regular / tall / textless
 *  prints with a P/T: +3.5 px median at HD), on M15's plate, which the
 *  prints put where CC's box does (its profile within ±1 px). An em of the
 *  value's 0.05 W (75 px at HD) size, on top of M15's valueDyEm. */
const M20_TOKEN_PT_PRINT_DY_EM = -3.5 / 75;

/** Card %H of an HD px row (2100 px card). */
const hdRowPct = (px: number) => (px / 2100) * 100;

/** The name band's box, HD px: CC's name box (109.62 + 114.03 px) on whole
 *  px at both bake targets — even HD rows, so the 750 px bake's box is whole
 *  px too (55 + 57). A unit test holds every full-art token to it. */
export const M20_TOKEN_TITLE_BOX_PX = { top: 110, height: 114 } as const;

/** CC's set-symbol box (0.12 W × 0.041 H — M15's 86 px box, layout v32),
 *  its right edge at CC's 92.13 %W (setSymbolBounds x 0.9213,
 *  right-anchored), centred where the prints centre theirs
 *  (M20_TOKEN_SYMBOL_CENTRE_PX). */
function m20TokenSymbolRect(height: M20TokenHeight): Rect {
  return { topPct: hdRowPct(M20_TOKEN_SYMBOL_CENTRE_PX[height]) - 2.05, leftPct: 80.13, widthPct: 12, heightPct: 4.1 };
}

/** The type band on a pill: its interior, left from CC's 8.54 %W to the
 *  symbol box's right edge (92.13 %W; the measured fit keeps
 *  TYPE_SYMBOL_GAP_PCT before the glyph's ink), dark ink. The band centres
 *  its line box on the pill, and `dy` sets the baseline where the prints
 *  do (M20_TOKEN_TYPE_PRINT_DY). */
function m20TokenTypeSlot(height: M20TokenHeight): TextSlot {
  const { top, bottom } = M20_TOKEN_PILL_INTERIOR_PX[height];
  return {
    rect: { topPct: hdRowPct(top), leftPct: 8.54, widthPct: 83.59, heightPct: hdRowPct(bottom + 1 - top) },
    sizePct: TYPE_SIZE_PCT,
    dy: M20_TOKEN_TYPE_PRINT_DY[height],
    fit: "measured",
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  };
}

/** The name pill's ink (4.48): white on the blue, black, red, green, gold
 *  and colourless pills and on every artifact template's silver pill; dark
 *  on the white pill (TFDN #6 / #27). Keyed by frame master. */
const M20_TOKEN_TITLE_INK_DARK_ON: InkByColorKey = { w: { colorHex: INK_DARK } };

/** The regular box (CC 'Short'): the base the other heights spread. */
const M20TOKENTEXT: FrameProfile = {
  label: "Token, text box",
  hideCost: true,
  // CC artBounds 4 / 2.86 / 92 × 89.53 (the black ring's inner edge, 60 px,
  // to the colour strip), with 7.6's overscan: the clear window runs
  // 60–1439 × 60–1936 px on every master.
  artSlot: { topPct: 2.8, leftPct: 3.9, widthPct: 92.2, heightPct: 89.6 },
  symbolSizePct: SET_SYMBOL_BOX_PCT,
  setSymbolFit: "ink",
  symbolRect: m20TokenSymbolRect("regular"),
  // CC's name box (x 0.0854, y 0.0522, 0.8292 × 0.0543 — the name pill's
  // interior, 104–217 px), centred, the M15 name size (CC 0.0381 H =
  // TITLE_SIZE_PCT); Beleren Small Caps waits for 4.8. Its rows snapped to
  // whole px at BOTH bake targets (M20_TOKEN_TITLE_BOX_PX: 110 + 114 px at
  // HD, 55 + 57 at 750): CC's 109.62 + 114.03 px put the band's edges
  // between pixels, and the browser and Satori round a fractional box
  // differently — the preview's name sat 2 px above the 750 bake's (1 px
  // on the arch token's whole-px box). The bake's baseline is unchanged.
  title: {
    rect: {
      topPct: hdRowPct(M20_TOKEN_TITLE_BOX_PX.top),
      leftPct: 8.54,
      widthPct: 82.92,
      heightPct: hdRowPct(M20_TOKEN_TITLE_BOX_PX.height),
    },
    sizePct: TITLE_SIZE_PCT,
    dy: M20_TOKEN_TITLE_PRINT_DY,
    fit: "measured",
    colorHex: M20_TOKEN_TITLE_INK,
    inkByColorKey: M20_TOKEN_TITLE_INK_DARK_ON,
    weight: 600,
    align: "center",
    font: "display",
    letterSpacingEm: 0.01,
  },
  type: m20TokenTypeSlot("regular"),
  // The translucent box (1548–1936 px on every master), 7 px inside its top
  // and 2 px inside its bottom, CC's 8.6 / 82.8 %W across (CC's rules y
  // 74.24 %H, 17.67 %H tall, sat 11 px inside the top and 6 px inside the
  // bottom): dark ink, the block centred in the box, ONE line centred on it
  // (TFDN #7 "Flying", TFDN #30 "This token can't block."), two or more from
  // the left (TFDN #27). The prints centre their block 2 px lower than the
  // box's middle (single lines and the regular prints' multi-line blocks,
  // 15 prints: our block 2–3 px high in the drawn box's middle), so the rect
  // sits 2 px below it.
  rules: {
    rect: { topPct: hdRowPct(1555), leftPct: 8.6, widthPct: 82.8, heightPct: hdRowPct(1934 - 1555) },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_DARK,
    vAlign: "center",
    alignSingleLine: "center",
    font: "body",
    padPx: { x: 2, y: 0 },
  },
  // The artist line in the bottom border, as on M15.
  footer: M15.footer,
  // M15's P/T slot: CC's plate box (the token packs' bounds 0.7573 / 0.8848
  // / 0.188 × 0.0733 — where the prints put the plate: its profile within
  // ±1 px on 63 prints), the 4.18 value box, its ink span and dark ink; the
  // digits 3.5 px higher, as the M20 prints set them.
  pt: { ...M15.pt!, valueDyEm: (M15.pt!.valueDyEm ?? 0) + M20_TOKEN_PT_PRINT_DY_EM },
};

/** The textless height (no box): `textless` hides the rules, flavour and
 *  watermark — the card keeps its text, and the Text step says so — and
 *  `textlessTypeLine` keeps the type pill's line (TFDN #6). */
const M20TOKEN: FrameProfile = {
  ...M20TOKENTEXT,
  label: "Token",
  symbolRect: m20TokenSymbolRect("textless"),
  type: m20TokenTypeSlot("textless"),
  textless: true,
  textlessTypeLine: true,
};

/** The tall box's rules rect, HD px: 1326–1922, 596 px — the fullest tall
 *  prints' text block (TLCI #17 / TBIG #7 Map: eight lines at 9 pt, ink
 *  1335–1920; no tall print sets more), on even rows so the 750 px bake's
 *  box is whole px too, centred 1 px above the box's middle (1314–1936).
 *  Calibrated on the tall prints set at 9 pt with our line breaks (TBIG #7,
 *  TBLB #11 / #21, TLCI #17, TDRC #2, TMKC #5; Scryfall PNGs at 1500 × 2100,
 *  2026-09-29): centred on the box's middle our first and last baselines sat
 *  +2 / +2.5 px below theirs (median); here +0.5 / +1. The 1319–1932 rect
 *  let a text run right up to the box's top edge (TBLB #9, squeezed into
 *  eight lines), where the prints keep ≥ 20 px. */
export const M20_TOKEN_TALL_RULES_PX = { top: 1326, bottom: 1922 } as const;
/** The tall box closes the gaps between abilities before its text shrinks
 *  (TextSlot.paragraphGapMinPx): TBLB #5 Warren Warleader prints its modes
 *  and reminder at 9 pt with 10–13 px gaps, where the standard 24 px ran its
 *  last line into the P/T plate and stepped it down to 70 px. */
export const M20_TOKEN_TALL_PARAGRAPH_GAP_MIN_PX = 10;

/** The tall box (TLCI #17 Map, TBLB #5): the pill at 55.7 %H, the box
 *  1314–1936 px, the rules rect M20_TOKEN_TALL_RULES_PX (CC's rules 63.03
 *  %H, 28.75 %H tall), its paragraph gaps squeezed before a size step
 *  (M20_TOKEN_TALL_PARAGRAPH_GAP_MIN_PX). */
const M20TOKENTALL: FrameProfile = {
  ...M20TOKENTEXT,
  label: "Token, tall text box",
  symbolRect: m20TokenSymbolRect("tall"),
  type: m20TokenTypeSlot("tall"),
  rules: {
    ...M20TOKENTEXT.rules,
    rect: {
      topPct: hdRowPct(M20_TOKEN_TALL_RULES_PX.top),
      leftPct: 8.6,
      widthPct: 82.8,
      heightPct: hdRowPct(M20_TOKEN_TALL_RULES_PX.bottom - M20_TOKEN_TALL_RULES_PX.top),
    },
    paragraphGapMinPx: M20_TOKEN_TALL_PARAGRAPH_GAP_MIN_PX,
  },
};

/** An artifact token template (4.50): the silver pills take white name ink
 *  on every colour, and the plates are M15's artifact set (CC's silver
 *  m15PTa for colourless — TEOC #14 Golem — the colour's plate on a
 *  coloured one, TDSK #7 Toy, TMOC #25 Gremlin). */
function m20ArtifactToken(profile: FrameProfile, label: string): FrameProfile {
  const title: TextSlot = { ...profile.title };
  delete title.inkByColorKey;
  return {
    ...profile,
    label,
    title,
    pt: { ...profile.pt!, plateAssetPathTemplate: "/frames/m15artifact/pt/{color}.png" },
  };
}

// M15 Snow (Kaldheim/Coldsnap frosty frame) and M15 Devoid (Eldrazi washed-out
// colorless frame) share the M15 geometry exactly — same title/art/type/text
// regions and the same painted P/T plate — so they're straight clones with a
// different frame PNG. Their plates are light (silver/pale), so the dark M15
// ink reads on them unchanged.
//
// Card Conjurer's M15 title bar (frames swap 4.4) ends higher, with a darker
// bottom bevel, than the MSE bar the band was tuned on: pips centred in the
// band (7.8 %H) sat 0.5–0.7 % of the card height below six real printings
// (owner review 2026-09-25). Lift them 0.55 %H on the CC-framed profiles —
// NOT on M15 itself, whose geometry the older MSE-framed families spread.
// The same profiles put the type line on the prints' baseline
// (CC_M15_TYPE_DY, layout v32) and the art on CC's window (CC_M15_ART_SLOT,
// layout v35).
const CC_M15_COST_DY = -0.0077;
const M15ARTIFACT: FrameProfile = {
  ...M15,
  label: "M15 Artifact",
  costDy: CC_M15_COST_DY,
  artSlot: CC_M15_ART_SLOT,
  type: { ...M15.type, dy: CC_M15_TYPE_DY },
  pt: { ...M15.pt!, plateAssetPathTemplate: "/frames/m15artifact/pt/{color}.png" },
};
const M15SNOW: FrameProfile = {
  ...M15,
  label: "M15 Snow",
  costDy: CC_M15_COST_DY,
  artSlot: CC_M15_ART_SLOT,
  type: { ...M15.type, dy: CC_M15_TYPE_DY },
  pt: { ...M15.pt!, plateAssetPathTemplate: "/frames/m15snow/pt/{color}.png" },
};

/** Where the art runs under see-through frames: from the black border's
 *  inner edge (TODO 4.17a, layout v35) — 55.5–1444.5 × 56.7–2016 px. The
 *  see-through body of CC's colourless M15 / devoid / token / planeswalker
 *  masters starts at the border's inner edge, 58–59 px in (α 7–89 between the
 *  border and the title bar); v24's 4/4/92 × 92 started 84 px down and left
 *  a 25 px #101015 band above every such title bar. The prints' border ends
 *  2.69–2.88 %H down and 3.76–4.16 %W in (BFZ #10/#15/#57, OGW #13, TBFZ
 *  #1/#2, DOM #1, M21 #1, STX #4, measured 2026-09-29), so this starts at or
 *  outside every one of them; the bottom stays at 96 %, under the opaque
 *  bottom border. The art-window check (lib/frames/art-window.ts) holds it
 *  to the window and the whole see-through body with 0.05 % to spare. */
const UNDER_FRAME_RECT: Rect = { topPct: 2.7, leftPct: 3.7, widthPct: 92.6, heightPct: 93.3 };
// Devoid re-dresses the M15 frame; the Eldrazi type bar sits 0.1% higher
// than the plain frame's and the set symbol lives in its own box
// (production override 2026-07-14, folded 2026-09-25).
const M15DEVOID: FrameProfile = {
  ...M15,
  label: "M15 Devoid (Eldrazi)",
  costDy: CC_M15_COST_DY,
  artSlot: CC_M15_ART_SLOT,
  // Every devoid frame is see-through (CC text box alpha ~179): the art
  // runs under the whole frame like printed devoid cards (4.17).
  underFrameArt: { rect: UNDER_FRAME_RECT },
  pt: { ...M15.pt!, plateAssetPathTemplate: "/frames/m15devoid/pt/{color}.png" },
  type: { ...M15.type, rect: { ...M15.type.rect, topPct: 56.4 }, dy: CC_M15_TYPE_DY },
  symbolRect: { topPct: 56.2, leftPct: 80.2, widthPct: 12, heightPct: 5.2 },
};

// M15 Borderless — the 2019+ borderless frame (frames plan 4.32; Card
// Conjurer 'Borderless (Alt)', packBorderless.js @2fcddba, frames bucket
// only). The art runs to the card's top and side edges (CC artBounds 0/0/100
// × 92.24) under dark translucent bars and text box (the box is RGBA
// 0,0,0,128, baked into the master), above an opaque black bottom bar that
// carries the artist line and the brand mark (the default placement lands
// in it). CC's text bounds are its regular M15 bounds (title y 5.22, type y
// 56.64, rules 63.03 h 28.75), so the measured M15 slots carry over, with
// CC's white ink on the title, type line, rules and P/T. The set symbol
// keeps M15's inline place: right edge 92.2, centred 59.1 (CC 92.13 /
// 59.10). The P/T plate is the pack's own 274 × 140 (CC bounds 1146/1861 on
// 1500 × 2100 = 76.4/88.62/18.27 × 6.67, its native 1.96 aspect); the
// digits keep M15's box (CC's pt box 79.28/90.2/13.67 × 3.72) and may use
// the plate's face from 1188 px (past the lit bevel) to 1394 px (the shaded
// bevel), measured on the digits' rows of the plates. Colourless is CC's
// see-through C frame: the art is under it already, so no underFrameArt.
// The cost gets the Card Conjurer lift (CC mana y 0.0613, as on M15). The
// set symbol wears the prints' white keyline (SET_SYMBOL_KEYLINE): a
// common's #0f0f12 ink vanished on the dark type bar (owner evidence
// 2026-09-26).
const BORDERLESS_INK = "#ffffff";
const M15BORDERLESS: FrameProfile = {
  ...M15,
  label: "M15 Borderless",
  costDy: CC_M15_COST_DY,
  setSymbolKeyline: SET_SYMBOL_KEYLINE,
  artSlot: { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 92.24 },
  title: { ...M15.title, colorHex: BORDERLESS_INK },
  type: { ...M15.type, colorHex: BORDERLESS_INK, dy: CC_M15_TYPE_DY },
  // The default rules padding, not M15's print margins (layout v33): the
  // translucent box is drawn differently.
  rules: { ...M15.rules, colorHex: BORDERLESS_INK, padPx: undefined },
  pt: {
    ...M15.pt!,
    plateRect: { topPct: 88.62, leftPct: 76.4, widthPct: 18.27, heightPct: 6.67 },
    inkSpanPct: { leftPct: 79.2, rightPct: 92.93 },
    colorHex: BORDERLESS_INK,
    plateAssetPathTemplate: "/frames/m15borderless/pt/{color}.png",
  },
};
// …and its artifact dress: CC's A frame for a colourless artifact (with
// the pack's artifact plate), the colour frames for a coloured one — a
// borderless frame has no body for 4.16's artifact interior, and the prints
// (FDN #295, FRA #327) wear the colour's bars. Same geometry.
const M15BORDERLESSARTIFACT: FrameProfile = {
  ...M15BORDERLESS,
  label: "M15 Borderless Artifact",
  pt: { ...M15BORDERLESS.pt!, plateAssetPathTemplate: "/frames/m15borderlessartifact/pt/{color}.png" },
};
// …and its nonbasic land (frames plan 4.34): the same pack and geometry —
// the land prints' title bar, type bar and text box sit where the spells'
// do (outline rows 88–89 / 222, 1167 / 1300 and 1950 px at HD on 14
// borderless land prints and 5 spells, 2026-09-29) — with the land's
// tinted type bar and box in the master (scripts/lib/cc-frames.mjs
// borderlessLandLayers) and M15 Land's anatomy: no cost, and the rules
// centred in the box (M15's vAlign, kept). The name keeps the borderless
// band (8.5–92.2 %W): with no pips the prints set a long name across it
// (Meduseld, Golden Hall of Edoras LTC #361). A land creature prints on
// the borderless plates (m15borderless's, in the land's colour key).
// ONE rules line starts at the box's left, like M15's (no alignSingleLine;
// owner round 15, 2026-09-29): the only non-SLD borderless nonbasic lands
// that print a single line, the ZNR / KHM pathways (#284, #286, #290,
// #293: "{T}: Add {X}."), start it 35 px inside the box, 142–147 px at HD,
// with ~900 px of room on its right. Only Secret Lair centres one — the
// artifact lands SLD #300–304, ink centred on 748–756 px.
const M15BORDERLESSLAND: FrameProfile = {
  ...M15BORDERLESS,
  label: "M15 Borderless Land",
  hideCost: true,
};

// M15 Borderless Planeswalker — the light borderless walker (frames plan
// 4.33; Card Conjurer 'Borderless' planeswalker pack, packPlaneswalker
// Borderless.js @2fcddba, frames bucket only; 199 of the 245 non-showcase
// borderless walker printings, e.g. Oko ELD #271, Basri Ket M21 #280). Card
// Conjurer's regular planeswalker master with the frame body and border
// taken away: the same title bar (57–211 px), type bar (1160–1313 px),
// ability window (x 180–1383, from 1315 px), badge rim and shield, over art
// that runs to the top and side edges (CC artBounds 0/0/100 × 91.53) down to
// an opaque black bottom bar from 1922 px, with fins up the side edges from
// ~80 % H. So m15pw's anatomy carries over whole (4.19 / 3.13 — the rail,
// the rows sized by their text, the detached cost, M15's type slot, the
// footer and brand mark in the bottom bar), with the full-bleed art slot and
// the master's own shield (cut out of each master like m15pw's, loyalty/, and
// drawn above the stripes). The rows are Card Conjurer's NEUTRAL light
// stripes (versionPlaneswalker.js: white at 0.608, #a4a4a4 at 0.706), as the
// light prints show them (Oko ELD #271: a white row, then a grey one) — not
// m15pw's cream, which 4.19 still owes the bordered frame. Dark ink on the
// light bars and rows, as on m15pw. Printings with `inverted` rows (dark
// stripes, white ink: Ashiok WOE #297) resolve to this frame as `nearest`
// (owner decision 2026-09-26).
const BORDERLESS_PW_STRIPE_A = "rgba(255,255,255,0.608)";
const BORDERLESS_PW_STRIPE_B = "rgba(164,164,164,0.706)";
/** The borderless walkers' anatomy (4.5b b1, through walkerAnatomy): the
 *  CC shield cut from their own masters, the neutral stripes, and the plain
 *  box on the first stripe's light ground — a walker whose text isn't
 *  ability rows, another card forced onto the frame, and a walker with NO
 *  ability text (owner round 15, 2026-09-29): the window is a see-through
 *  cut-out, never left showing the bare art. The editor still shows its
 *  hint rows there (as on m15pw). */
function borderlessWalker(plateAssetPathTemplate: string) {
  return walkerAnatomy({
    shield: ccWalkerShield(plateAssetPathTemplate),
    stripes: { a: BORDERLESS_PW_STRIPE_A, b: BORDERLESS_PW_STRIPE_B },
    badgeTextHex: WALKER_BADGE_TEXT_HEX,
    maxSizePct: WALKER_MAX_SIZE_PCT,
    rulesBackdropHex: BORDERLESS_PW_STRIPE_A,
    rulesBackdropWhenEmpty: true,
  });
}
const M15BORDERLESSPW_WALKER = borderlessWalker("/frames/m15borderlesspw/loyalty/{color}.png");
const M15BORDERLESSPWTALL_WALKER = borderlessWalker("/frames/m15borderlesspwtall/loyalty/{color}.png");
const M15BORDERLESSPW: FrameProfile = {
  ...M15PW,
  label: "M15 Borderless Planeswalker",
  artSlot: { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 91.53 },
  rules: { ...M15PW.rules, ...M15BORDERLESSPW_WALKER.rulesPatch },
  loyaltyRows: M15BORDERLESSPW_WALKER.loyaltyRows,
  loyalty: M15BORDERLESSPW_WALKER.loyalty,
};
/** How far Card Conjurer's TALL planeswalker masters draw the type bar and
 *  the ability window above the regular ones: the type bar's top edge at
 *  1022 px vs 1160 px on every colour of both packs (CC type y 0.4967 vs
 *  0.5625, first ability 0.5581 vs 0.6239, set symbol 0.5234 vs 0.5891), as
 *  a percent of the card's height. */
export const TALL_WALKER_SHIFT_PCT = (138 / 2100) * 100;
// …and its tall twin (Card Conjurer 'Tall Borderless', packPlaneswalker
// TallBorderless.js): the same master with the type bar and the ability
// window's top 138 px higher, for four ability rows (Teferi, Master of Time
// M21 #281; Liliana, Dreadhorde General FDN #359; Ajani, Sleeper Agent DMU
// #375). The title, rail, shield, bottom bar and footer stay put; the type
// slot, the set symbol and the rules box's top move up with the bar.
const M15BORDERLESSPWTALL: FrameProfile = {
  ...M15BORDERLESSPW,
  label: "M15 Borderless Planeswalker, tall",
  type: {
    ...M15BORDERLESSPW.type,
    rect: { ...M15BORDERLESSPW.type.rect, topPct: M15BORDERLESSPW.type.rect.topPct - TALL_WALKER_SHIFT_PCT },
  },
  symbolRect: {
    ...M15BORDERLESSPW.symbolRect!,
    topPct: M15BORDERLESSPW.symbolRect!.topPct - TALL_WALKER_SHIFT_PCT,
  },
  rules: {
    ...M15BORDERLESSPW.rules,
    rect: {
      ...M15BORDERLESSPW.rules.rect,
      topPct: M15BORDERLESSPW.rules.rect.topPct - TALL_WALKER_SHIFT_PCT,
      heightPct: M15BORDERLESSPW.rules.rect.heightPct + TALL_WALKER_SHIFT_PCT,
    },
  },
  // Its own walker anatomy: the same rows and backdrop as the regular
  // borderless walker, the shield cut from the tall masters.
  loyaltyRows: M15BORDERLESSPWTALL_WALKER.loyaltyRows,
  loyalty: M15BORDERLESSPWTALL_WALKER.loyalty,
};

// Alpha Land — the 1993 frame's land variant ({color}lcard from
// magic-agclassic.mse-style, re-cut by the same build-alpha-frames.mjs):
// agclassic's opening and text layout, a land treatment and no cost. Its
// lines follow the land print (7 LEA/LEB basics): pinstripe, art-box border
// and text-box ring are dark · colour · dark in the land's colour, the art
// border OUTSIDE the non-land outline (art box 145–1356.5 × 189.5–1172; type
// band 1172–1249; text box 187–1318 × 1249–1854.5, ring 12–17 px; strip
// 1854.5–1984.5). Its frame is the same brown land texture on every colour
// key (strip ≈ #7e6657), so the "Illus." line and a P/T print in the one
// silver on all seven. The name and "Land" keep the dark ink: the land print
// letters them silver too, but on our brown the silver reads no better
// (≈ 2.8 : 1 against the dark ink's 3.1), so like red and green they stay
// dark (owner decision 2026-09-25: silver name and type line on the black
// frame only).
const ALPHA_LAND_INK: InkByColorKey = Object.fromEntries(
  (["w", "u", "b", "r", "g", "c", "m"] as const).map((k) => [
    k,
    { colorHex: ALPHA_SILVER_MID, shadowCss: ALPHA_EMBOSS },
  ]),
);
const ALPHALAND: FrameProfile = {
  ...AGCLASSIC,
  label: "Alpha Land",
  hideCost: true,
  // One brown land frame for every colour: no artifact card (Alpha printed
  // no artifact land, and MSE has no artifact land card).
  artifactMasterKeys: undefined,
  // The land's brown is neither the black frame nor the artifact card.
  title: { ...AGCLASSIC.title, inkByColorKey: undefined },
  // 5 px lower than agclassic's, clear of the wider art border (caps centred
  // at ~1204 px, as "Land" prints on the basics).
  type: {
    ...AGCLASSIC.type,
    rect: { ...AGCLASSIC.type.rect, topPct: 55.35 },
    inkByColorKey: undefined,
  },
  footer: { ...AGCLASSIC.footer!, inkByColorKey: ALPHA_LAND_INK },
  pt: { ...AGCLASSIC.pt!, inkByColorKey: ALPHA_LAND_INK },
};

// Alpha Token — the 1993 token frame (magic-agclassic-token.mse-style). Silver
// stone border, a large white art window (cut to transparent), and a green
// panel with a tan type box at the bottom. No title plate (the name sits in the
// dark top border in light ink) and no cost. P/T is white text over the tan box
// bottom-right; token abilities render over the lower art on a dark scrim.
const ALPHATOKEN: FrameProfile = {
  flavorDivider: false,
  label: "Alpha Token",
  brandMark: { rightPct: 3.5, bottomPct: 0.55 },
  hideCost: true,
  artSlot: { topPct: 9.0, leftPct: 10, widthPct: 80, heightPct: 52.5 },
  title: {
    rect: { topPct: 3.2, leftPct: 12, widthPct: 76, heightPct: 5.2 },
    sizePct: 0.044,
    colorHex: INK_LIGHT,
    weight: 600,
    align: "center",
    font: "display",
    shadowCss: OUTLINE_SHADOW,
  },
  type: {
    rect: { topPct: 70.5, leftPct: 18, widthPct: 64, heightPct: 7 },
    sizePct: 0.03,
    colorHex: INK_DARK,
    weight: 600,
    align: "center",
    font: "display",
  },
  rules: {
    rect: { topPct: 49.0, leftPct: 12, widthPct: 76, heightPct: 11 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.compact),
    colorHex: INK_LIGHT,
    vAlign: "center",
    font: "body",
    backdropHex: "rgba(10,8,6,0.5)",
  },
  footer: {
    rect: { topPct: 96.5, leftPct: 10, widthPct: 80, heightPct: 3 },
    sizePct: 0.015,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.05,
    font: "display",
  },
  pt: {
    rect: { topPct: 82.5, leftPct: 75, widthPct: 19, heightPct: 6.5 },
    sizePct: 0.04,
    colorHex: "#ffffff",
    weight: 700,
    shadowCss: OUTLINE_SHADOW,
  },
};

// ---------------------------------------------------------------------------
// Retro (1997, magic-old.mse-style) — the pre-8th-Edition "old border": a tan
// marble frame with the name + type printed directly on the border (no plates),
// a white art window (cut to transparent), a cream text box, and the P/T at
// the bottom-right. Structurally like AGCLASSIC but with the MSE magic-old
// geometry. This PROFILE draws every line of text in dark ink; the prints do
// not: on the 1997 frame the name, type line, P/T and artist line are white
// with a hard black shadow on EVERY frame colour, white included (104 prints
// read, Mirage 1996 → Scourge 2003, no exception — the era design of
// 2026-10-06). TODO 4.10a corrects the ink, the footer and the sizes; nothing
// is ticked or stored on this pair until then.
// MSE magic-old spec (375×523): name 42,24 (23h); image 45,51 286×233;
// type 39,291 (20h); text 43,318 289×143; pt 295,470 47×27.
// ---------------------------------------------------------------------------
const RETRO: FrameProfile = {
  flavorDivider: false,
  label: "Retro (1997)",
  // Frame edge at 96.38%H: the default mark touched it.
  brandMark: { rightPct: 3.5, bottomPct: 0.95 },
  costSizePct: 0.04,
  artSlot: { topPct: 9.6, leftPct: 11.7, widthPct: 76.6, heightPct: 44.8 },
  title: {
    rect: { topPct: 4.2, leftPct: 11, widthPct: 78, heightPct: 4.6 },
    sizePct: 0.044,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 55.4, leftPct: 10.4, widthPct: 74, heightPct: 3.9 },
    sizePct: 0.03,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 60.6, leftPct: 11.5, widthPct: 77, heightPct: 27.2 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_DARK,
    vAlign: "center",
    font: "body",
  },
  footer: {
    rect: { topPct: 95.3, leftPct: 11, widthPct: 78, heightPct: 2.6 },
    sizePct: 0.015,
    colorHex: "#efe9dd",
    uppercase: true,
    letterSpacingEm: 0.04,
    font: "display",
  },
  // Dark ink today, which is NOT the printed look: 1997-frame cards print the
  // P/T white with a black shadow (MSE's "white" note was right; an earlier
  // comment here said the prints were dark). TODO 4.10a corrects it.
  // The strip is free on both sides of the value up to the frame's bevel
  // shading at ~1410 px, so the ink may run 1125–1410 px (`100/100` fits).
  pt: {
    rect: { topPct: 89.5, leftPct: 77.5, widthPct: 14, heightPct: 5.6 },
    inkSpanPct: { leftPct: 75, rightPct: 94 },
    sizePct: 0.042,
    colorHex: INK_DARK,
    weight: 700,
  },
};

// Retro land — the 1997 nonbasic land frame (magic-old-unland): same geometry,
// no mana cost.
const RETROLAND: FrameProfile = {
  ...RETRO,
  label: "Retro Land",
  hideCost: true,
};

// ---------------------------------------------------------------------------
// Modern border (2003, magic-new.mse-style) — the 8th-Edition–M14 frame: a
// light beveled border with a title bar, a type bar, and a separate beveled
// P/T box bottom-right (a real plate PNG, like M15). Names/type use the squared
// display face (Beleren stands in for Matrix, which it was designed to evoke).
// MSE magic-new spec (375×523): name 30 (23h); image 32,62 311×228;
// type 298 (20h); text 31,328 311×142; pt box 284,466 60×28 (+plate overlay).
// ---------------------------------------------------------------------------
const MODERN: FrameProfile = {
  flavorDivider: false,
  label: "Modern border (2003)",
  // Frame edge at 96.71%H (10E / RAV scans: 96.6%): the default mark
  // straddled it; 0.8 centres the ink in the black border (owner review).
  brandMark: { rightPct: 3.5, bottomPct: 0.8 },
  costSizePct: 0.04,
  // Title, footer and P/T positions plus the detached cost / set-symbol
  // boxes were tuned in the compare tool against the M12 Serra Angel scan
  // (production override 2026-07-27, folded 2026-09-25).
  costRect: { topPct: 5.6, leftPct: 52.3, widthPct: 39, heightPct: 4.4 },
  symbolRect: { topPct: 56.95, leftPct: 78.2, widthPct: 12, heightPct: 3.9 },
  artSlot: { topPct: 11.6, leftPct: 8.3, widthPct: 83.2, heightPct: 43.8 },
  title: {
    rect: { topPct: 6, leftPct: 8.9, widthPct: 78, heightPct: 4.4 },
    sizePct: 0.044,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    // Nudged down ~2px (center 58.55% → 58.9%) to true-center on the 2003
    // type bar — it read high.
    rect: { topPct: 56.95, leftPct: 9, widthPct: 74, heightPct: 3.9 },
    sizePct: 0.0347,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 62.5, leftPct: 8.3, widthPct: 83, heightPct: 27 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_DARK,
    vAlign: "center",
    font: "body",
  },
  footer: {
    rect: { topPct: 92.2, leftPct: 15.5, widthPct: 58, heightPct: 2.6 },
    sizePct: 0.015,
    colorHex: INK_DARK,
    uppercase: true,
    letterSpacingEm: 0.04,
    font: "display",
  },
  // The 2003 P/T box is a separate beveled plate (magic-new {color}pt.jpg),
  // upscaled to /frames/modern/pt/{color}.png. Drawn behind the dark value.
  // The plate fills the rect, but its light face on the digits' rows is
  // 1143–1373 px on every colour: a longer value shrinks to that rather than
  // print over the bevel.
  pt: {
    rect: { topPct: 88.4, leftPct: 73.3, widthPct: 21, heightPct: 6.8 },
    inkSpanPct: { leftPct: 76.2, rightPct: 91.53 },
    sizePct: 0.044,
    colorHex: INK_DARK,
    weight: 700,
    plateAssetPathTemplate: "/frames/modern/pt/{color}.png",
  },
};

// Modern land — the 2003 nonbasic land frame (magic-new land variants): same
// geometry, no mana cost.
const MODERNLAND: FrameProfile = {
  ...MODERN,
  label: "Modern Land",
  hideCost: true,
};

// ---------------------------------------------------------------------------
// The landscape layouts (TODO 4.21b, layout v43): battle and split on Card
// Conjurer's masters (the frames bucket, scripts/lib/cc-frames.mjs), each
// 2100 × 1500. Every rect below is % of the LANDSCAPE card; every px is HD
// (2100 × 1500). Placement rule for both: a text or a value sits where the
// PRINTS set it RELATIVE TO ITS OWN BAR of the master (a baseline below its
// bar's face, a name's start past its bar's left end, a cost's end before
// its bar's right end), measured on Scryfall PNGs registered bar by bar —
// so the card reads right on the frame it is drawn on. Where Card
// Conjurer's pack itself leaves the prints, the importer moves whole blocks
// of the master onto them through its flat border (SPLIT_RECUT_PX,
// BATTLE_LOWER_RECUT_PX — the px below are the PACK's, and ride those
// moves as the tokens ride TOKEN_RECUT_PX); what a block move can't reach
// (the battle's bars end 8–11 px short of the prints') the slot follows on
// the master, not at the print's absolute column (docs/FRAMES.md "The
// landscape layouts").
// ---------------------------------------------------------------------------

/** How far the importer moves Card Conjurer's two split halves onto the
 *  prints, HD px (negative = left; scripts/lib/cc-frames.mjs
 *  SPLIT_HALF_RECUT — a unit test holds the two together): the pack's
 *  collector border is 160 px where the prints' is 147–148, so the left
 *  half moves 11 px and the right half 3. */
export const SPLIT_RECUT_PX = { left: -11, right: -3 } as const;
/** How far the importer moves the battle's lower block (type bar, text box,
 *  shield) DOWN onto the prints, HD px (BATTLE_LOWER_RECUT). */
export const BATTLE_LOWER_RECUT_PX = 4;

/** A portrait footer slot as a LANDSCAPE card carries it (TODO 4.21b; 3.8's
 *  slice for split and battle): the printed card is the portrait card turned
 *  a quarter turn clockwise, so its bottom border — where M15 prints the
 *  artist line — is the landscape card's LEFT border, and the line runs
 *  down it from the top, its letters' heads toward the card (MH2 #123, TSR
 *  #186, MOM #149: the prints' second border line is centred 75–79 px from
 *  the left edge and starts 97–99 px down; M15's slot, turned, is centred on
 *  79.8 px and starts at 97.5). The result's `rect` is the BAND the turned
 *  line covers (FrameProfile.footerTurn draws it), its size the same px. */
function footerTurnedWithCard(footer: TextSlot): TextSlot {
  const r = footer.rect;
  return {
    ...footer,
    rect: { topPct: r.leftPct, heightPct: r.widthPct, leftPct: 100 - (r.topPct + r.heightPct), widthPct: r.heightPct },
    sizePct: displayPct(footer.sizePct, "landscape"),
  };
}

// Battle — the March of the Machine Siege frame, FRONT face (LANDSCAPE, 7:5;
// MOM #149 Invasion of Tarkir and the 36 MOM battles). Card Conjurer's
// 'Battle' master (packBattle.js, 2814 × 2010 → 2100 × 1500 in one Lanczos
// pass) replaces the MSE 'm15 mainframe battles' one, which had no border,
// no siege arc, no battle icon and no defense shield (a transparent ring
// round a drawn disc). On every colour the master is: the black border
// (its inner edge the window's: 168–2039 × 61 px, the arc bulging left),
// the battle icon's ring at x 220–362, the name pill's face 375–1967 ×
// 76–181, and — in the PACK's rows, which the importer moves
// BATTLE_LOWER_RECUT_PX (4 px) down onto the prints — the type bar's face
// 242–1967 × 871–975, the text box's paper 253–1943 × 1006–1430, the
// defense shield 1881–2045 × 1300–1466 (its black interior 1920–2007 on the
// digits' rows) and the bottom border from 1442. Nine MOM prints set the
// type bar 5.3–5.5 px, the box's top 4.6, its bottom 2.5 and the shield
// 2.8–5.0 px lower than the pack: within 1.5 px of their mean after the
// move (2.3 px of any one print). (Their name pill, type bar and box also
// end 8–11 px further right and their shield sits 12 px right — the
// pack's, kept: no flat zone crosses the bars.)
//   • Art — ONE rect for every colour, from the border's inner edge to the
//     bottom border (BATTLE_ART_RECT): on the master the full-art window is
//     clear from 168 to 2039 px across and from 61 down to 1387, and again
//     in a sliver between the shield's right point and the border down to
//     1433 (α < 250 over 166–2041 × 59–1436), which a slot ending at the
//     text box's row would leave on #101015. Card Conjurer's own artBounds
//     (167–2040 × 60–1431) run the art under the text box the same way, as
//     the printed card does.
//   • Colourless — CC's see-through 'Colorless Frame' (MOM #1 Invasion of
//     Ravnica): its pill, type bar and text box are translucent (α 190–250)
//     down to the bottom border, so the PROFILES entry declares the same
//     rect as its under-frame art (ONE picture: nothing to seam).
//   • The name — the pill's face rows (76–181.5), from 392 px: the prints
//     start it 20–23 px past the pill's left end, right of the icon (3.28:
//     the MSE rect began 269 px in, under the icon). Its baseline is the
//     prints' 158.4 px (nine prints, 157.4–159.3), 2 px below the row a
//     centred 80 px line sets it on (dy: a whole px at HD and at 750, so
//     the bake and the preview move it alike).
//   • The cost — at the family's disc, right-aligned to 1942.3 px: the
//     prints end their last disc 24 px before the pill's face ends (MOM #22
//     / #147 / #149: 1952–1953 px on prints whose pill ends 10–11 px right of
//     this master's), and centre the discs on the pill's face (128.5–129.3
//     px; the rect's centre is 128.75: no costDy).
//   • The type line — the type bar's face rows (the pack's 871–975.5),
//     from 268 px (the prints' "Battle — Siege" starts 271.2–272.2), its
//     baseline 76.9 px below the face's top as on the prints, 2 px below
//     centred (dy).
//   • The set symbol — CC's box (180 × 86 px, the family's), its right edge
//     25 px before the type bar's face ends as on the prints (1942 px),
//     centred on the bar's face (the pack's 925 px); a Keyrune glyph takes
//     the family's ink fit.
//   • Rules — CC's box (the pack's 272–1933 × 1008–1422), the block centred
//     in it as the prints centre theirs (their six-line blocks centre 209 px
//     below the box's top ± 1), the lines from 273 px (the prints' 272–275),
//     at the 9 pt ladder top (the prints' line pitch is 74–75 px on MOM
//     #21, a 76 px text; #147 sets 72 px, #63 67, the fuller boxes 59–66).
//   • Defense — in the shield the MASTER paints (`paintedRect`: the pack's
//     Defense mask, the rules keep-out on every battle): the value in white
//     at 78 px, centred where the prints centre their digit in the shield
//     (81 px right of its left point and 82 px below its top one; the digit
//     57–58 px tall on nine prints, ours 56–59). The drawn disc and its
//     outline are gone (owner 2026-09-29).
//   • The artist credit — M15's footer line turned with the card, down the
//     left border (footerTurnedWithCard). The collector number, set and
//     language beside it are TODO 4.9d's.
//   • The brand mark — in the 54 px bottom border, its right end clear of
//     the shield's left point (1881 px).
export const BATTLE_ART_RECT: Rect = { topPct: 3.88, leftPct: 7.85, widthPct: 89.4, heightPct: 91.91 };
/** A row of the battle PACK's lower block (the type bar, the text box, the
 *  shield, everything on them), where the master has it: % of the card's
 *  height. */
const battleLowerPct = (packPx: number) => (packPx + BATTLE_LOWER_RECUT_PX) / 15;
/** The defense shield the battle master paints, in card percents: the
 *  pack's Defense mask at the master's size, moved with the lower block
 *  (scripts/lib/cc-frames.mjs BATTLE_SHIELD.box — a unit test keeps the two
 *  in step). */
export const BATTLE_SHIELD_RECT: Rect = { topPct: battleLowerPct(1300), leftPct: 1881 / 21, widthPct: 164 / 21, heightPct: 166 / 15 };
const LANDSCAPE_FOOTER: TextSlot = footerTurnedWithCard({
  rect: { topPct: 94.6, leftPct: 6.5, widthPct: 87, heightPct: 3.2 },
  sizePct: 0.019,
  colorHex: INK_LIGHT,
  uppercase: true,
  letterSpacingEm: 0.06,
  font: "display",
});
const BATTLE: FrameProfile = {
  label: "Battle (Siege)",
  // The bottom border is 54 px (1446–1500): the mark's 38 px of ink
  // (1454–1492) centred in it; right 11 % ends it at 1865 px, 16 px short of
  // the shield's left point. (The MSE master had no border: 0.8 % sat the
  // mark on the art's last rows.)
  brandMark: { rightPct: 11, bottomPct: 0.47 },
  orientation: "landscape",
  artSlot: BATTLE_ART_RECT,
  costSizePct: displayPct(COST_DISC_PCT, "landscape"),
  symbolSizePct: displayPct(SET_SYMBOL_BOX_PCT, "landscape"),
  setSymbolFit: "ink",
  symbolRect: { topPct: battleLowerPct(925 - 43), leftPct: (1942 - 180) / 21, widthPct: 180 / 21, heightPct: 86 / 15 },
  title: {
    rect: { topPct: 76 / 15, leftPct: 392 / 21, widthPct: (1942.3 - 392) / 21, heightPct: 105.5 / 15 },
    sizePct: displayPct(TITLE_SIZE_PCT, "landscape"),
    dy: 2 / 2100,
    fit: "measured",
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    // M15's own tracking: untracked, an 80 px name came out 2.5–2.8 % short
    // of the nine prints' at the same cap height (MOM #149 632 px against
    // 615); tracked it is within 0.5 %.
    letterSpacingEm: 0.01,
  },
  type: {
    rect: { topPct: battleLowerPct(871), leftPct: 268 / 21, widthPct: (1935 - 268) / 21, heightPct: 104.5 / 15 },
    sizePct: displayPct(TYPE_SIZE_PCT, "landscape"),
    dy: 2 / 2100,
    fit: "measured",
    // The family's type-line ink (M15's), as its size.
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: battleLowerPct(1008), leftPct: 272 / 21, widthPct: (1933 - 272) / 21, heightPct: 414 / 15 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard, "landscape"),
    colorHex: INK_DARK,
    vAlign: "center",
    font: "body",
    padPx: { x: 1, y: 0 },
  },
  footer: LANDSCAPE_FOOTER,
  footerTurn: 90,
  defense: {
    rect: { topPct: battleLowerPct(1382.9 - 61.5), leftPct: (1962 - 43) / 21, widthPct: 86 / 21, heightPct: 123 / 15 },
    paintedRect: BATTLE_SHIELD_RECT,
    // The shield's black interior on the digits' rows (the pack's 1350–1412).
    inkSpanPct: { leftPct: 1920 / 21, rightPct: 2007 / 21 },
    sizePct: 78 / 2100,
    colorHex: "#ffffff",
    weight: 700,
  },
};

/** The saga's chapter-badge stack pitch, HD px (centre to centre): tight
 *  (LTC #58, WHO #99) and roomy (DOM #21, THB #160) — see SAGA.chapters. Even,
 *  so the 750 px bake draws exactly half. */
export const SAGA_BADGE_PITCH_PX = { min: 138, max: 160 } as const;
/** The chapter numeral's size, HD px (MPlantin; the prints' Plantin semibold
 *  is TODO 4.8). */
export const SAGA_NUMERAL_SIZE_PX = 72;
/** The fold's corner inside the saga's reminder box, HD px: [the paper's
 *  first column, from row, to row] — the curve's steps (see SAGA.chapters
 *  .intro.keepOuts). */
const SAGA_FOLD_CORNER_PX: readonly (readonly [right: number, top: number, bottom: number])[] = [
  [138, 572, 580],
  [144, 580, 588],
  [152, 588, 597],
];
/** The saga type line's print offset, a fraction of the card's width
 *  (TextSlot.dy): 9.3 px down at HD (see SAGA.type). */
const SAGA_TYPE_PRINT_DY = 9.3 / 1500;

// Saga — the M15 Saga frame: the chapter rail on the LEFT (the reminder
// block, then the chapters down a ribbon that carries their numbered badges —
// they replace the normal rules box) and a tall art column on the RIGHT, with
// a title bar (name + cost) on top and a type bar at the bottom. Masters:
// Card Conjurer's 'Regular Frames' saga pack, native 1500 × 2100 (TODO 4.21c
// = 3.7, scripts/lib/cc-frames.mjs CC_TEMPLATES.saga) — the 375 px MSE cut
// had no ribbon and a window that started 26 px left of the prints'.
// Layout v32: printed sagas set the name and type line at M15's sizes (81 /
// 68 px on DOM #21 / #90 / #122; ours were 64 / 52) and their pips at M15's
// ~70 px (owner decision 2026-09-28). The name keeps the prints' baseline
// (184.7 px); the type line took its print offset with the CC masters.
const SAGA: FrameProfile = {
  label: "Saga",
  costSizePct: COST_DISC_PCT,
  // The saga's title bar is M15's (the pack's Title mask is m15MaskTitle; the
  // masters' bar faces span 104–210 px against M15's 104–208), and the prints
  // set the pips where M15's are: the generic disc centres on 151.5 px on DOM
  // #122 and 153 px on 40K #126 (segmented by its colour), the band's centre
  // lifted by CC_M15_COST_DY puts ours on 152.25.
  costDy: CC_M15_COST_DY,
  // The masters' window + 0.1 % (752–1384 × 237–1758 px on every colour,
  // the land saga included; packSagaRegular.js artBounds 0.5 / 0.1124 /
  // 0.4247 × 0.7253 sit flush with it).
  artSlot: { topPct: 11.19, leftPct: 50.03, widthPct: 42.4, heightPct: 72.68 },
  // CC's saga symbol box (packSagaRegular 0.12 W × 0.0381 H = 80 px; layout
  // v32) — see M15's symbolSizePct.
  symbolSizePct: SET_SYMBOL_BOX_PCT_THIN_BAR,
  setSymbolFit: "ink",
  // The pack's symbol box: its right edge at 92.27 %W (1384 px), centred on
  // 87.39 %H (1835 px) — the prints' symbols end at 1380–1384 px and centre
  // on 1835–1836.5 (DOM #122, 40K #126, THB #160), where the type band's own
  // centre put them 8 px high and 23 px left.
  symbolRect: { topPct: 87.39 - 3.81 / 2, leftPct: 92.27 - 12, widthPct: 12, heightPct: 3.81 },
  title: {
    // Ends where M15's band does (92.2 %W, 1383 px): the prints' last disc
    // ends at 1383.5–1386 px (DOM #90 / #122 / #173, LTC #58).
    rect: { topPct: 5.4, leftPct: 8.5, widthPct: 83.7, heightPct: 4.8 },
    sizePct: TITLE_SIZE_PCT,
    dy: keepBaseline(0.0427, TITLE_SIZE_PCT),
    fit: "measured",
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    // 85.1, not the MSE 84.9: production override 2026-07-08, folded 2026-09-25.
    // From 8.5 %W (the prints' type line starts 5–9 px left of the old 8.8)
    // to M15's 92.2.
    rect: { topPct: 85.1, leftPct: 8.5, widthPct: 83.7, heightPct: 3.9 },
    sizePct: TYPE_SIZE_PCT,
    // …and on the prints' baseline: 1854–1857 px on DOM #21 / #42 / #90 /
    // #122 / #173 (mean 1855.3), 9.3 px below where the MSE bar's centre had
    // it (the +0.0065 W the 4.20 review measured).
    dy: keepBaseline(0.0347, TYPE_SIZE_PCT) + SAGA_TYPE_PRINT_DY,
    fit: "measured",
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  // Required by the type, but the chapter rail replaces it (rendered only when
  // a frame has no `chapters`).
  rules: {
    rect: { topPct: 11.5, leftPct: 8, widthPct: 41, heightPct: 72 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.compact),
    colorHex: INK_DARK,
    font: "body",
  },
  // The printed rail (TODO 4.21c; lib/cards/saga-rail.ts lays it out). HD px
  // of a 1500 × 2100 card; prints are Scryfall PNGs at that size.
  chapters: {
    // The chapter text column: x 203–728 — the pack's 0.35 W column (ability
    // text 0.1334 / 0.35 W), 3 px right of it: the prints' ink starts at
    // 204–206 px (DOM #21, #90, LTC #58, 40K #126), ours from 200 started at
    // 201–202 — from the rail's top at 237 px (11.29 %H: where the rows start
    // on a saga with no reminder, owner decision 2026-09-29) to its foot at
    // 1759 px (83.76 %H, the window's and the paper's bottom edge).
    rect: { topPct: 11.29, leftPct: 13.53, widthPct: 35, heightPct: 72.47 },
    // 64 px on a 62 px pitch: the prints' chapter text (DOM #21's "Create a
    // 2/2 white" 504 px wide against our 503 at 64; x-height 29–30 px; the
    // line pitch 62.0 px on DOM #21 / #42 / #90 / #122 / #173, 59.7 on LTC
    // #58's 62 px text — 0.969 em, not the rules standard's 0.98).
    sizePct: rulesPxToPct(RULES_SIZE_PX.compact),
    lineHeight: 0.97,
    textColorHex: INK_DARK,
    intro: {
      // x 132–736 (the pack's 0.0867 / 0.404 W box from 130; the prints'
      // "(" inks from 133, ours from 130 at 131), from the rail's top; 360 px
      // tall, its text centred — the standard four-line reminder then sits
      // on the prints' baselines (341 / 403 / 465 / 527 px on DOM #21, LTC
      // #58, WHO #99, MH2 #259).
      rect: { topPct: 11.29, leftPct: 8.8, widthPct: 40.27, heightPct: 17.14 },
      // 62 px on a 62 px pitch. The prints set the reminder at the chapters'
      // 64 px, but in an italic narrower than ours (public/fonts/
      // mplantin-italic.ttf sets "step, add a lore counter." 614 px wide at
      // 64 px; the prints' is 591): at 62 px ours is 594 and breaks into the
      // prints' four lines, where 64 px took five.
      sizePct: rulesPxToPct(62),
      lineHeight: 1,
      // The fold's corner. The ribbon folds out of the frame's left edge
      // under the reminder, and its edge bulges into the box's bottom-left
      // corner: on every master the paper starts at x 133 at y 572, 138 at
      // 580, 144 at 588 and 151 at 596 px (169 at the first divider). A
      // reminder that fills its box (six lines or more: 120 characters and
      // up) would start its last line ON the fold — three steps of the
      // curve the lines keep out of.
      keepOuts: SAGA_FOLD_CORNER_PX.map(([right, top, bottom]) => ({ leftPct: 0, widthPct: right / 15, topPct: top / 21, heightPct: (bottom - top) / 21 })),
    },
    // 621 px: the divider under the reminder block on every print measured
    // (619–621 on 50 of the 54 prints measured, DOM → MH3 — 613.6–622.8 over
    // all, mean 620.1; the pack starts its rows at 608).
    rowsTopPct: 29.57,
    badge: {
      assetPath: "/frames/saga/chapter/badge.png",
      // The pack's box (0.0386 W, 0.0787 W × 0.0629 H): 118 × 132 px from
      // x 58, centred on x 117 over the ribbon — the prints' badge reads
      // 119–120 × 130–132 px, centred on x 117 ± 1.5.
      leftPct: 3.86,
      widthPct: 7.87,
      heightPct: 6.29,
      // A stack's pitch: 160 px on DOM, THB, KHM, 40K, WOE and PIP (DOM #21
      // 159.8, DOM #173 160.1, THB #160 161), 134–142 px on LTR, LTC, WHO
      // and MH3 (LTC #58 138.3 / 138.6, WHO #99's five 138.0) — the pack's
      // 150 is neither. Roomy while the rows have room, tight before the
      // text steps down (saga-rail.ts).
      pitchPct: { min: SAGA_BADGE_PITCH_PX.min / 21, max: SAGA_BADGE_PITCH_PX.max / 21 },
      numeralSizePct: SAGA_NUMERAL_SIZE_PX / 1500,
      numeralColorHex: INK_DARK,
    },
    divider: {
      assetPath: "/frames/saga/chapter/divider.png",
      // The pack's: x 150–742 (0.1 / 0.3947 W), 0.0029 H = 6 px tall.
      leftPct: 10,
      widthPct: 39.47,
      heightPct: 0.29,
    },
  },
  // Standard M15-family bottom border — same artist line as M15.
  footer: {
    rect: { topPct: 94.6, leftPct: 6.5, widthPct: 87, heightPct: 3.2 },
    sizePct: 0.019,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.06,
    font: "display",
  },
};

// Adventure — the M15 Eldraine frame. The creature uses the M15 title + type
// bars and art window, but the lower text area is an open storybook: the
// adventure spell (name/type/cost/rules from the card's back-face) fills the
// LEFT page, and the creature's own rules move to the narrow RIGHT page. The
// adventure name + type sit on the page's colored bars (light ink + a soft
// shadow so they read on any color); the rules sit on the cream page (dark ink).
//
// Layout v38 (TODO 4.21a): Card Conjurer's 'Adventure' master (the frames
// bucket, scripts/lib/cc-frames.mjs) — the M15 frame with the storybook as
// the ELD / WOE / MKM prints draw it — replacing the MSE composite (the MSE
// m15 master + double_page + null_page) whose window ran 10 / 6 px narrow.
// Geometry is packAdventure.js's, in percent:
//   • art 7.57/11.19/84.87 × 44.44 — PINNED (design 2026-09-29 D4): the
//     masters' window is 115–1385 × 237–1166 px on every colour, covered
//     with 1.45 / 1.6 / 2.0 / 2.2 px to spare; neither M15's MSE slot nor
//     CC_M15_ART_SLOT is inherited, so a later move of either is not an
//     adventure bake change;
//   • the panel's name and type line from 8.14 to 48.14 %W at 62 px, its
//     pips right-aligned to 48.14 (60 px); the pages: the adventure's rules
//     8.54–48.01 × 73.58–88.58, the creature's 52.67–91.34 × 65.0–88.58
//     (both clear of the P/T plate);
//   • the title, type line, pips and set symbol are M15's (the master's bars
//     ARE CC's M15 bars: symbol right 92.13 %W, centred 59.10 %H — M15's
//     inline band), with the Card Conjurer type-line baseline and cost lift
//     the CC-framed M15 profiles print (CC_M15_TYPE_DY, CC_M15_COST_DY).
// The panel's bars onto ELD #115 Bonecrusher Giant (Scryfall PNG at
// 1500 × 2100): the panel ignores dy (it centres its text), so its name
// band is centred where the print's name sits (baseline 1388 px: band
// centre 1367.3) and its type band on the print's type line (baseline
// 1481: centre 1460.3) — 6 and 7 px above CC's box centres, which CC fills
// from the top. P/T plate: M15's, as the pack draws it (m15PT<K>.png at
// M15's bounds).
const ADV_SHADOW = "0 1px 2px rgba(0,0,0,0.6), 0 0 2px rgba(0,0,0,0.5)";
const ADVENTURE_PANEL_BAND_PCT = 4.0;
const ADVENTURE: FrameProfile = {
  ...M15,
  label: "Adventure",
  costDy: CC_M15_COST_DY,
  type: { ...M15.type, dy: CC_M15_TYPE_DY },
  artSlot: { topPct: 11.19, leftPct: 7.57, widthPct: 84.87, heightPct: 44.44 },
  // Creature rules → the RIGHT page (CC rules2). Both pages centre their
  // text, as the prints do (ELD #115: the creature's two abilities and
  // flavour run 1391–1815 px in the 1365–1860 page, the adventure's three
  // lines 1611–1803 in the 1545–1860 page — centred, not from the top).
  rules: {
    rect: { topPct: 65.0, leftPct: 52.67, widthPct: 38.67, heightPct: 23.58 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.reduced),
    colorHex: INK_DARK,
    vAlign: "center",
    font: "body",
  },
  // Layout v32: the panel's name and type line at Card Conjurer's name2 /
  // type2 (ADVENTURE_PANEL_PCT, 62 px at HD; were 48 / 38) and its pips at
  // mana2 (ADVENTURE_PANEL_COST_PCT, 60 px; were 45). The panel keeps
  // centring its text on its bars (TextSlot.dy is front-face only).
  adventure: {
    // Adventure name (+ its cost) — CC title2 / mana2: 8.14–48.14 %W,
    // centred on the print's name (1367.3 px).
    title: {
      rect: { topPct: 1367.3 / 21 - ADVENTURE_PANEL_BAND_PCT / 2, leftPct: 8.14, widthPct: 40.0, heightPct: ADVENTURE_PANEL_BAND_PCT },
      sizePct: ADVENTURE_PANEL_PCT,
      fit: "measured",
      colorHex: INK_LIGHT,
      weight: 700,
      font: "display",
      shadowCss: ADV_SHADOW,
    },
    // Adventure type line — CC type2, centred on the print's (1460.3 px).
    type: {
      rect: { topPct: 1460.3 / 21 - ADVENTURE_PANEL_BAND_PCT / 2, leftPct: 8.14, widthPct: 40.0, heightPct: ADVENTURE_PANEL_BAND_PCT },
      sizePct: ADVENTURE_PANEL_PCT,
      fit: "measured",
      colorHex: INK_LIGHT,
      weight: 600,
      font: "display",
      shadowCss: ADV_SHADOW,
    },
    // Adventure rules — the LEFT page (CC rules), centred like the print's.
    rules: {
      rect: { topPct: 73.58, leftPct: 8.54, widthPct: 39.47, heightPct: 15.0 },
      sizePct: rulesPxToPct(RULES_SIZE_PX.compact),
      colorHex: INK_DARK,
      vAlign: "center",
      font: "body",
    },
    costSizePct: ADVENTURE_PANEL_COST_PCT,
  },
};

// Flip — the M15 Kamigawa flip frame. ONE card, two creatures: the top reads
// normally (name → small text box → type bar) and the bottom is printed
// UPSIDE-DOWN — its name / type / rules / P-T come from the back-face content
// and render rotated 180° in place (matching MSE's per-element `angle: 180`).
// They share the single middle art window.
//
// Layout v38 (TODO 4.21a): Card Conjurer's 'Flip' master (the frames
// bucket, scripts/lib/cc-frames.mjs), replacing the 375 px MSE composite
// that sat 30–80 px low from the title bar down (its window 648–1393 px
// against the prints' 626–1308). Every rect is packFlip.js's, in percent of
// the 1500×2100 card (a rotation-180 box spans x − w … x, y − h … y):
//   • art 7.57/29.57/84.87 × 32.91 — the masters' window 115–1385 ×
//     623–1310 px on every colour with 1.45 / 1.6 / 2.0 / 2.1 px to spare
//     (7.6's 0.05 %). Layout v39 (TODO 4.21a follow-up, owner decision
//     2026-10-02): CC drew the bottom half as the top half turned, and the
//     prints are not that symmetric — on C18 #134 and CM2 #71 the window's
//     inner line and the upside-down type bar's dark top band sit 7 px
//     higher than CC's (the line centred 1311 against 1318.5), the bar's
//     bottom outline and the text box's top edge 5 px higher (1444.7 against
//     1449.7; 1466.5 against 1470.8), the upside-down name bar where CC has
//     it — so the importer re-cuts the masters' lower half in two pieces
//     (scripts/lib/cc-frames.mjs FLIP_LOWER_RECUT): the window now ends at
//     1310 px (was 1317; the slot's bottom follows, 33.25 → 32.91 %H), the
//     bar's face spans 1339–1444 (was 1344–1449) and the box's paper starts
//     at 1467 (was 1472; the rules rect follows). The top half, the cost and
//     the plates are v38's;
//   • the top name bar 3.86–9.29 %H and type bar 23.53–28.96, the text box
//     10.2–22.2; the bottom name bar 83.05–88.48, type bar 63.43–68.86 (its
//     face 1339–1444 px since v39), text box 70.1–82.1 (its paper from
//     69.86 %H since v39); the set symbol's box ends at 78.4 %W, centred on
//     26.0 %H (setSymbolBounds);
//   • the P/T plates — every printed M15 flip creature carries one per half
//     (C18 #134 Budoka Gardener, CM2 #71 Nezumi Graverobber; owner decision
//     2026-09-29: a correction, not the vehicle plate's opt-in): CC's pack
//     draws both plates from one image, cut by the importer into
//     pt/<k>-top.png and pt/<k>-bottom.png (FLIP_PT_BOXES, 1176–1419 ×
//     475–635 and 53–296 × 1321–1481 px: the boxes here); a plate draws only
//     when its half has a P/T. The bottom plate is upside-down in the
//     source, so both renderers draw it at its box UNTURNED and turn only
//     the value, as the printed card shows it. The value boxes are CC's pt
//     / pt2 widths centred where the prints centre their digits' ink (1311
//     px on the top plate, both prints — 13.5 px right of CC's box centre;
//     the box centres at 1313.5, Beleren's "1" sitting 2.5 px inside its
//     advance; 191 px on the bottom one — the bottom box widened to
//     6.2–19.27 %W so its ink span lies inside it, as every second face's
//     must); the ink spans are each plate's light face on the digits' rows
//     (1215–1395 and 93–272 px, measured on every colour).
// Text onto the prints (C18 #134 and CM2 #71, Scryfall PNGs at 1500 × 2100;
// the two scans agree within 3–5 px, the mean taken): the top name's
// baseline 155.5 px where CC's box centres ours at 164.7 (dy −9.2 px), the
// top type line's 569 against 573.9 (−4.9 px); the pips centred on the
// name's capitals (128.5 px: costDy −9.6 px from CC's box centre) and ending
// where the prints' do: the last disc's right edge is 1387 px on C18 #134
// and 1388.5 on CM2 #71 — packFlip.js right-aligns its MANA box at 92.92 %W,
// not at its title box's 91.46 (1372 px) — so the title rect, which carries
// the cost at its right end, runs to 92.5 %W (1387.5 px; M15's to 92.2, its
// ELD prints' discs ending 3–5 px further right). The upside-down
// half ignores dy (a second face centres its text), so its bars
// are placed where the prints' text centres: the type line's baseline
// 1370.5 px and the name's 1783.5 (in card space, the text reading up from
// them), 4 px and 9 px below CC's box centres — and stay there through
// v39: the re-cut moves the bar under the line, not the line (the prints
// set their type line's body 30–34 px below the bar's face top; ours
// 32–33). Sizes are the family's on both halves (layout v32); the
// upside-down name bar and type line fit their bars (fitLines); the type
// line starts after the bottom plate.
// Colourless = CC's see-through 'Colorless Frame' (the PROFILES entry draws
// the art under it, underFrameArt); no crown (the C18 / CM2 legendary
// halves print none). The artist credit sits on M15's footer line (3.8's
// slice; the prints' second border line centres at 2019–2020 px).
const FLIP_PT_SIZE_PCT = 0.05;
const FLIP: FrameProfile = {
  label: "Flip",
  costSizePct: COST_DISC_PCT,
  costDy: -0.0064,
  // The window's bottom moved up 7 px with the v39 re-cut: 1310 px on
  // every colour, the slot's bottom at 1312.1 (2.1 px to spare).
  artSlot: { topPct: 29.57, leftPct: 7.57, widthPct: 84.87, heightPct: 32.91 },
  // CC's flip symbol box, M15's (packFlip 0.12 W × 0.041 H = 86 px; layout
  // v32) — see M15's symbolSizePct — in its own box left of the plate.
  symbolSizePct: SET_SYMBOL_BOX_PCT,
  setSymbolFit: "ink",
  symbolRect: { topPct: 23.95, leftPct: 66.4, widthPct: 12, heightPct: 4.1 },
  title: {
    // CC's title box from its left edge (8.54) to where the prints' cost
    // ends (92.5 %W — the pack's mana box, not its 91.46 title box).
    rect: { topPct: 3.86, leftPct: 8.54, widthPct: 83.96, heightPct: 5.43 },
    sizePct: TITLE_SIZE_PCT,
    dy: -9.2 / 1500,
    fit: "measured",
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 23.53, leftPct: 8.54, widthPct: 82.92, heightPct: 5.43 },
    sizePct: TYPE_SIZE_PCT,
    dy: -4.9 / 1500,
    fit: "measured",
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 10.2, leftPct: 8.6, widthPct: 82.8, heightPct: 12.0 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.compact),
    colorHex: INK_DARK,
    vAlign: "center",
    font: "body",
  },
  pt: {
    rect: { topPct: 24.48, leftPct: 82.73, widthPct: 9.67, heightPct: 3.72 },
    plateRect: { topPct: 475 / 21, leftPct: 1176 / 15, widthPct: 243 / 15, heightPct: 160 / 21 },
    inkSpanPct: { leftPct: 81.0, rightPct: 93.0 },
    sizePct: FLIP_PT_SIZE_PCT,
    colorHex: INK_DARK,
    weight: 700,
    plateAssetPathTemplate: "/frames/flip/pt/{color}-top.png",
    valueDyEm: -0.04,
  },
  footer: M15.footer,
  secondFace: {
    rotation: 180,
    // Layout v32 (TODO 4.20): the upside-down name and type line fit their
    // bars as the front's do (secondFaceLineSizes), instead of ellipsizing
    // at the profile's sizes — at the family's name size a long flip name
    // ("Rune-Tail, Kitsune Ascendant") reaches its bar's end.
    fitLines: true,
    title: {
      rect: { topPct: 83.49, leftPct: 8.53, widthPct: 82.94, heightPct: 5.43 },
      sizePct: TITLE_SIZE_PCT,
      colorHex: INK_DARK,
      weight: 600,
      font: "display",
    },
    // From the bottom plate's box (19.73 %W) to CC's bar end: turned, the
    // line runs from the card's right edge and ends before the plate.
    type: {
      rect: { topPct: 63.63, leftPct: 20.6, widthPct: 70.87, heightPct: 5.43 },
      sizePct: TYPE_SIZE_PCT,
      colorHex: INK_DARK_SOFT,
      weight: 600,
      font: "display",
    },
    // CC's rules2 box started on its paper's first row (1472 px); the v39
    // re-cut moved the box's top edge up 5 px (the paper from 1467), so the
    // rect follows it — the text, centred, with it.
    rules: {
      rect: { topPct: 69.86, leftPct: 8.6, widthPct: 82.8, heightPct: 12.24 },
      sizePct: rulesPxToPct(RULES_SIZE_PX.compact),
      colorHex: INK_DARK,
      vAlign: "center",
      font: "body",
    },
    pt: {
      rect: { topPct: 64.19, leftPct: 6.2, widthPct: 13.07, heightPct: 3.72 },
      plateRect: { topPct: 1321 / 21, leftPct: 53 / 15, widthPct: 243 / 15, heightPct: 160 / 21 },
      inkSpanPct: { leftPct: 6.2, rightPct: 18.13 },
      sizePct: FLIP_PT_SIZE_PCT,
      colorHex: INK_DARK,
      weight: 700,
      plateAssetPathTemplate: "/frames/flip/pt/{color}-bottom.png",
      // No nudge: the prints centre the bottom digits' ink on this box
      // (1386.5–1387 px against its 1387), where the top plate's sit 4 px
      // above theirs (549.5 against 553: the front's −0.04 em). A nudge
      // here moves the ink the other way in card space (the value is
      // drawn in the turned frame).
      valueDyEm: 0,
    },
  },
};

// Split — the M15 split frame (LANDSCAPE, layout v43, TODO 4.21b): two
// upright half-cards side by side, each a small card of its own (name +
// cost → art → type → rules). The LEFT half is the front content; the RIGHT
// half is the back-face content — a second face with rotation 0 and its OWN
// art window. Both halves share the card's colour (per-part colour is TODO
// 4.26). Card Conjurer's 'Split' master (packSplit.js, drawn portrait and
// turned a quarter turn clockwise by the importer, no resample) replaces the
// MSE composite (two magic-m15-split-fusable half-frames on a black canvas),
// which drew no coloured body round either half and set the title bars 31 px
// and both windows 37 px above the prints' (the left window 69 px left of
// theirs: 133–952 × 201–800 px against 202–1018 × 238–796).
// On every colour the PACK's left half is: the body 160–1080 px, the name
// bar's face 200–1049 × 105–210, the window 215–1028 × 239–795, the thin
// type bar's face 204–1046 × 814–882, the text box's paper 211–1025 ×
// 913–1431; its right half is the same 958 px over (its window 1174–1986).
// The importer moves the left half 11 px left and the right half 3 px
// (SPLIT_RECUT_PX: the pack's collector border is 160 px, the prints'
// 147–148), so on the MASTER the left window is 204–1017 and the right one
// 1171–1983, every edge of both halves within 3.6 px of the mean of MH2
// #123 / #60 and TSR #161 / #186 (5.4 px of any one; rows within 2.7 px,
// untouched). Every px below is the pack's and rides the move
// (splitLeftPct / splitRightPct).
//   • Art — the windows + 0.1 % (2.1 px across, 1.5 px down, to spare).
//   • Sizes — the prints', smaller than the M15 family's on every line
//     (lib/cards/typography.ts: the name 76 px, the type line 53 px on its
//     69 px bar, the pips 68 px, the set symbol's box 48 px), which is why
//     split is not in lib/cards/m15-family.ts.
//   • The name and the cost — the name bar's face rows (104.5–209.5): at 76
//     px a centred name's baseline is 182.3 px, the prints' 182.7 (nine
//     halves of MH2 #123, MH2 #60, TSR #161 / #186, GRN #224: 180.8–184.4),
//     and the pips centre on 157.0, the prints' 156.6 (circle fits) — no dy,
//     no costDy on either half. From 226 px (the prints' names start 30–32
//     px past the bar's left end; ours 4 px into its rect) to 1030 px (the
//     prints' last disc ends 19 px before the bar's face does).
//   • The type line — rows 815–884 (its baseline the prints' 867.9 px, a
//     centred 53 px line's 867.2), from 226 px; the left half's set symbol
//     inline at 1030 px (MH2's ends 20–21 px before the bar's face ends).
//     The right half draws no symbol (TODO 3.9).
//   • Rules — 228–1008 × 927–1426 inside the paper, the lines from the
//     rect's edge (the prints' left-aligned text starts 17.7–18.3 px inside
//     the paper: GRN #224, WHO #77, MH2 #60), the block centred as the
//     prints centre theirs (ink centred on 1178.5 px ± 2), at the 9 pt
//     ladder top (TSR #161 and #186 set two and three lines at 76 px, a
//     74–75 px pitch; MH2's halves 69–74). Some prints also CENTRE a
//     text's lines (MH2 #123, TSR #156 / #161 / #186, C16 #239), others
//     set theirs left (MH2 #60, GRN #224, DMR #209's one- and two-line
//     texts): ours is always left-aligned — a rules layout rule of its
//     own, not this correction's.
//   • Both halves are set ALIKE: the right half's title and type slots are
//     `fit: "measured"` too, which an unturned second face draws exactly as
//     the front draws its own (both renderers).
//   • The artist credit and the brand mark — as the battle's.
/** How far the frame's textbox border reaches into a half's rules rect, HD
 *  px: none — the Card Conjurer rules rects lie inside the paper (17–20 px
 *  from its sides: the pack's 211–1025 round 228–1008, 1169–1983 round
 *  1186–1966), where the MSE profile's spanned the window's width and held
 *  33 / 38 px of border. tests/unit/cards/rules-box.test.ts measures the
 *  paper on every colour master. */
export const SPLIT_TEXTBOX_BORDER_PX = { left: 0, right: 0 } as const;
const SPLIT_RULES_PAD_PX = {
  left: SPLIT_TEXTBOX_BORDER_PX.left,
  right: SPLIT_TEXTBOX_BORDER_PX.right,
  top: 0,
  bottom: 0,
} as const;
/** A column of the split PACK's left half, where the master has it: % of
 *  the card's width. */
const splitLeftPct = (packPx: number) => (packPx + SPLIT_RECUT_PX.left) / 21;
/** The same for a column of the pack's RIGHT half. */
const splitRightPct = (packPx: number) => (packPx + SPLIT_RECUT_PX.right) / 21;
/** The right half's slots: the left half's, one half over — the pack's
 *  958 px and the 8 px the two halves' moves differ by (966 px). */
export const SPLIT_HALF_DX_PCT = (958 + SPLIT_RECUT_PX.right - SPLIT_RECUT_PX.left) / 21;
const SPLIT_TITLE: TextSlot = {
  rect: { topPct: 104.5 / 15, leftPct: splitLeftPct(226), widthPct: 804 / 21, heightPct: 105 / 15 },
  sizePct: SPLIT_TITLE_SIZE_PCT,
  fit: "measured",
  colorHex: INK_DARK,
  weight: 600,
  font: "display",
};
const SPLIT_TYPE: TextSlot = {
  rect: { topPct: 815 / 15, leftPct: splitLeftPct(226), widthPct: 804 / 21, heightPct: 69 / 15 },
  sizePct: SPLIT_TYPE_SIZE_PCT,
  fit: "measured",
  colorHex: INK_DARK_SOFT,
  weight: 600,
  font: "display",
};
const SPLIT_RULES: TextSlot = {
  rect: { topPct: 927 / 15, leftPct: splitLeftPct(228), widthPct: 780 / 21, heightPct: 499 / 15 },
  sizePct: rulesPxToPct(RULES_SIZE_PX.standard, "landscape"),
  colorHex: INK_DARK,
  vAlign: "center",
  font: "body",
  padPx: SPLIT_RULES_PAD_PX,
};
const rightHalf = (slot: TextSlot): TextSlot => ({ ...slot, rect: { ...slot.rect, leftPct: slot.rect.leftPct + SPLIT_HALF_DX_PCT } });

const SPLIT: FrameProfile = {
  label: "Split",
  orientation: "landscape",
  // The bottom border is 57 px (1443–1500): the mark's 38 px of ink centred
  // in it (1452.5–1490.5), under the right half's text box — its right end
  // (2023 px) 12 px inside that half's body (2035).
  brandMark: { rightPct: 3.5, bottomPct: 0.57 },
  // The pack's left window 215–1028 × 239–795, + 0.1 % each side.
  artSlot: { topPct: 15.83, leftPct: splitLeftPct(212.9), widthPct: 817.2 / 21, heightPct: 37.27 },
  costSizePct: SPLIT_COST_DISC_PCT,
  symbolSizePct: SPLIT_SET_SYMBOL_BOX_PCT,
  setSymbolFit: "ink-height",
  title: SPLIT_TITLE,
  type: SPLIT_TYPE,
  rules: SPLIT_RULES,
  footer: LANDSCAPE_FOOTER,
  footerTurn: 90,
  secondFace: {
    rotation: 0,
    costSizePct: SPLIT_COST_DISC_PCT,
    // The pack's right window 1174–1986 × 239–795, + 0.1 % each side.
    artSlot: { topPct: 15.83, leftPct: splitRightPct(1171.9), widthPct: 816.2 / 21, heightPct: 37.27 },
    title: rightHalf(SPLIT_TITLE),
    type: rightHalf(SPLIT_TYPE),
    rules: rightHalf(SPLIT_RULES),
  },
};

// Aftermath — the M15 Aftermath frame. A normal TOP half (cast from hand) over a
// BOTTOM half rotated 90° (cast from the graveyard). The top half is a standard
// spell layout (name/cost → small art → type → rules); the bottom half is the
// back-face content rendered ROTATED 90° CLOCKWISE (read by turning the card
// anticlockwise), like the printed Cut // Ribbons and Card Conjurer: the name
// reads top → bottom with its cost at the bottom. (MSE measures its
// `angle: 270` anticlockwise — the same quarter turn — but CSS rotate() turns
// clockwise, so copying it as rotate(270°) turned the half the wrong way,
// TODO 0.22.) The bottom slots are WIDE boxes centered on the rotated bars —
// rotate(90°) around each center lands it on the vertical bar (the box may
// extend off-card before rotation, which is fine). The master is Card
// Conjurer's (layout v38, below); the MSE stack's builder is retired.
//
// Both halves print their text at ONE set of sizes (AFTERMATH_TEXT), like the
// printed cards and Card Conjurer (title/title2, type/type2, rules/rules2 and
// mana/mana2 each share a size). Measured on the 745 px Cut // Ribbons and
// Commit // Memory scans (word widths fitted in our Beleren, cross-checked on
// glyph heights): the name is 0.049–0.053 of the card's width on EITHER half,
// the type line 0.043–0.045, the cost discs ≈ 35 px on both — a regular M15
// card's sizes (DOM Serra Angel measures 0.0525 / 0.0443 the same way), so
// both halves take M15's scan-calibrated title / type / cost sizes. The old
// top half (0.04 / 0.0347 / 0.04) printed a fifth under the card. Rules start
// at the 9 pt standard on both halves and shrink on the ladder. The sideways
// bars are a third of the card long, so a name + cost too long for them at
// these sizes shrinks as one (pips with the name), and a long type line
// shrinks alone (fitLines); the printed cards keep the full sizes.
// Layout v32: M15's sizes are now the shared display sizes (80 / 68 px,
// 72.75 px discs; were 75 / 65 px); the top half keeps its baselines
// (TextSlot.dy), the sideways half keeps centring its text in its bars.
// Layout v38 (TODO 4.21a): Card Conjurer's 'Aftermath' master (the frames
// bucket, scripts/lib/cc-frames.mjs) with its textured cream text boxes,
// replacing the MSE stack of two per-colour pieces with flat white boxes.
// The art slots are the masters' windows + 0.1 %: the top window 115–1385 ×
// 237–704 px on every colour (7.57/11.19/84.87 × 22.44, 1.45 / 1.6 / 2.0 /
// 2.2 px to spare), the sideways window 828–1252 × 1181–1918 (the
// pre-rotation box 44.63/63.62/49.41 × 20.33 centred on it: turned, 826.5–
// 1253.5 × 1178.9–1920.1, 1.5 / 2.1 px to spare). The set symbol draws in
// CC's box (setSymbolBounds: right edge 92.13 %W, centred 37.1 %H) — the
// text slots stay as today (print-matched in 0.22 and v32). The artist
// credit sits on M15's footer line (3.8's slice; AKH Insult // Injury
// centres its second border line at 2015 px, M15's 2020). Colourless = CC's
// artifact frame as a render stand-in, never offered (owner 2026-09-29).
const AFTERMATH_TEXT = {
  titleSizePct: TITLE_SIZE_PCT,
  typeSizePct: TYPE_SIZE_PCT,
  costSizePct: COST_DISC_PCT,
  rulesSizePct: rulesPxToPct(RULES_SIZE_PX.standard),
} as const;

const AFTERMATH: FrameProfile = {
  label: "Aftermath",
  // CC's aftermath symbol box, M15's (packAftermath 0.12 W × 0.041 H = 86 px;
  // layout v32) — see M15's symbolSizePct — in CC's own box (v38).
  symbolSizePct: SET_SYMBOL_BOX_PCT,
  setSymbolFit: "ink",
  symbolRect: { topPct: 37.1 - 4.1 / 2, leftPct: 80.13, widthPct: 12, heightPct: 4.1 },
  artSlot: { topPct: 11.19, leftPct: 7.57, widthPct: 84.87, heightPct: 22.44 },
  footer: M15.footer,
  costSizePct: AFTERMATH_TEXT.costSizePct,
  // Layout v39 (TODO 4.21a follow-up, owner decision 2026-10-02): the top
  // half's cost onto the prints. AKH #210–214 and HOU #157 (Scryfall PNGs
  // at 1500 × 2100) end their last disc at 1383–1385 px (mean 1384.0) and
  // centre the discs on row 158–161 (mean 159.4); v38's rect ended at
  // 90.5 %W (1357.5 px — the last disc's edge at 1357, 27 px short) with the
  // discs centred 168 px (8.6 px low). The rect runs to 92.3 %W (1384.5
  // px: the cost right-aligns at its end) and costDy lifts the discs 8.6
  // px; the name's baseline (dy) and left edge do not move.
  costDy: -8.6 / 1500,
  title: {
    rect: { topPct: 5.7, leftPct: 8.5, widthPct: 83.8, heightPct: 4.4 },
    sizePct: AFTERMATH_TEXT.titleSizePct,
    dy: keepBaseline(0.05, AFTERMATH_TEXT.titleSizePct),
    fit: "measured",
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 35.4, leftPct: 8, widthPct: 82.7, heightPct: 3.8 },
    sizePct: AFTERMATH_TEXT.typeSizePct,
    dy: keepBaseline(0.0435, AFTERMATH_TEXT.typeSizePct),
    fit: "measured",
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 40.9, leftPct: 7.5, widthPct: 84.5, heightPct: 13.0 },
    sizePct: AFTERMATH_TEXT.rulesSizePct,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
  },
  secondFace: {
    rotation: 90,
    costSizePct: AFTERMATH_TEXT.costSizePct,
    fitLines: true,
    // The bottom half's art window (CC's master: 828–1252 × 1181–1918 px in
    // card space). Like the text slots this is the PRE-rotation wide box
    // centered on the window — rotate(90°) in place lands exactly on it and
    // the art reads upright when the card is turned (layout v38).
    artSlot: { topPct: 63.62, leftPct: 44.63, widthPct: 49.41, heightPct: 20.33 },
    // Wide boxes centered on each rotated bar (rotate 90° → vertical bar).
    // Turned, the name and the type line both start at y 56.5% and the cost
    // ends at 90.8% (Card Conjurer's title2, and the print); the type box is
    // centred on its bar (x 46.4–54.8%).
    title: {
      rect: { topPct: 70.125, leftPct: 64.5, widthPct: 48, heightPct: 7 },
      sizePct: AFTERMATH_TEXT.titleSizePct,
      colorHex: INK_DARK,
      weight: 600,
      font: "display",
    },
    type: {
      rect: { topPct: 70.125, leftPct: 26.6, widthPct: 48, heightPct: 7 },
      sizePct: AFTERMATH_TEXT.typeSizePct,
      colorHex: INK_DARK_SOFT,
      weight: 600,
      font: "display",
    },
    // Card Conjurer's rotated rules box: x 6.94–44.94%, y 57.0–90.57% once
    // turned. Its long side is the line length (47% W = 705 px), its short
    // side the stack of lines (27.15% H = 570 px), so wide text stays inside
    // the white box instead of running into the type bar and off the card.
    rules: {
      rect: { topPct: 60.21, leftPct: 2.44, widthPct: 47, heightPct: 27.15 },
      sizePct: AFTERMATH_TEXT.rulesSizePct,
      colorHex: INK_DARK,
      vAlign: "center",
      font: "body",
    },
  },
};

// ---------------------------------------------------------------------------
// Showcase set families — per-set "showcase" frame treatments from popular
// recent sets. The MSE pieces ship with their art window already transparent
// (built by scripts/build-showcase-frames.mjs), so these are layout-only
// profiles. Several share an "art-forward" layout (art bleeds to the top; a
// name bar ~57%; type + textbox below), captured by a factory.
// ---------------------------------------------------------------------------
const SHOWCASE_SHADOW = "0 1px 2px rgba(0,0,0,0.65), 0 0 2px rgba(0,0,0,0.5)";

function artForwardShowcase(
  label: string,
  nameHex: string,
  nameShadow = true,
): FrameProfile {
  return {
    label,
    artSlot: { topPct: 2.5, leftPct: 6, widthPct: 88, heightPct: 54 },
    costSizePct: 0.034,
    title: {
      rect: { topPct: 56.4, leftPct: 11, widthPct: 78, heightPct: 6 },
      sizePct: 0.042,
      colorHex: nameHex,
      weight: 600,
      font: "display",
      ...(nameShadow ? { shadowCss: SHOWCASE_SHADOW } : {}),
    },
    type: {
      rect: { topPct: 63.4, leftPct: 11, widthPct: 78, heightPct: 4 },
      sizePct: 0.026,
      colorHex: INK_DARK,
      weight: 600,
      font: "display",
    },
    rules: {
      rect: { topPct: 67.6, leftPct: 8, widthPct: 84, heightPct: 24.5 },
      sizePct: rulesPxToPct(RULES_SIZE_PX.reduced),
      colorHex: INK_DARK,
      vAlign: "start",
      font: "body",
    },
    pt: {
      rect: { topPct: 87.2, leftPct: 71.5, widthPct: 23, heightPct: 7 },
      sizePct: 0.04,
      colorHex: "#ffffff",
      weight: 700,
      shadowCss: OUTLINE_SHADOW,
    },
  };
}

// Art-forward showcases (art bleeds to the top; name bar lower-middle).
const AVATAR = artForwardShowcase("Avatar", INK_LIGHT);
const BLOOMBURROW = artForwardShowcase("Bloomburrow", INK_LIGHT);

// Tarkir card showcases — m15-style (name top, art, type, textbox). Each slot
// gets its own ink because the frames invert per band: Draconic's title sits
// over dark art (light ink + shadow) while its type + parchment textbox take
// dark ink. Dragon Wing overrides the geometry below.
function tarkirCard(
  label: string,
  inks: { title: string; type: string; rules: string },
): FrameProfile {
  const slotInk = (hex: string) => ({
    colorHex: hex,
    ...(hex === INK_LIGHT ? { shadowCss: SHOWCASE_SHADOW } : {}),
  });
  return {
    label,
    costSizePct: 0.038,
    artSlot: { topPct: 12, leftPct: 9, widthPct: 82, heightPct: 46 },
    title: {
      rect: { topPct: 4.6, leftPct: 11, widthPct: 78, heightPct: 6 },
      sizePct: 0.044,
      weight: 600,
      font: "display",
      ...slotInk(inks.title),
    },
    // Measured: the painted type band spans ~56.3–61.5% on both frames.
    type: {
      rect: { topPct: 56.6, leftPct: 11, widthPct: 78, heightPct: 4.8 },
      sizePct: 0.03,
      weight: 600,
      font: "display",
      ...slotInk(inks.type),
    },
    rules: {
      rect: { topPct: 66, leftPct: 9, widthPct: 82, heightPct: 26 },
      sizePct: rulesPxToPct(RULES_SIZE_PX.reduced),
      colorHex: inks.rules,
      vAlign: "start",
      font: "body",
    },
    pt: {
      rect: { topPct: 87, leftPct: 71, widthPct: 23, heightPct: 7.5 },
      sizePct: 0.043,
      colorHex: "#ffffff",
      weight: 700,
      shadowCss: OUTLINE_SHADOW,
    },
  };
}
// Dragon Wing is the Multiverse Legends (MOM, 2023) Tarkir frame — printed on
// MUL #1 Anafenza (W) and #60 Taigam (W/U) only; it is not a Tarkir:
// Dragonstorm frame (those are Draconic, Ghostfire and the borderless clan
// frame). It is SILVER with colour-keyed dragon wings; there is no gold
// version anywhere (MSE and Card Conjurer ship the same art), so a gold (3+
// colour) card shows gold wings on silver and a two-colour card splits its
// wings (twoColorSplit below). Its name and type bars are LIGHT silver
// (median 200,200,200) and take black ink — MSE's own swap_fonts: name, type
// and P/T black, rules white on the dark text box. Measured on the two MUL
// scans and this PNG's window (owner review 2026-09-25: the old light title
// read at 1.46:1, the art stopped 19 px short of the window, no P/T plate).
const TARKIRDRAGON: FrameProfile = {
  ...tarkirCard("Dragon Wing", { title: INK_DARK, type: INK_DARK, rules: INK_LIGHT }),
  // Two-colour cards split the wings like the one printed two-colour card,
  // MUL #60 Taigam (W/U): white wings left, blue right, gold P/T plate (owner
  // decision 2026-09-25). It is MSE's own recipe for this style —
  // `masked_blend(mask: "special_blend_card.png", dark: template(colors.0),
  // light: template(colors.1))`, and that mask is a HARD vertical split. The
  // w/u/b/r/g PNGs differ in the 35–65 %W band only by texture noise (at
  // most ~18/255, none above 24/255), and the seam step at 50 % is at most
  // 11/255, within the frame's own column-to-column variation (up to 17), so
  // a hard seam at 50 % reads the same as MSE's mask, which flips at
  // x=378/646 (58.5 %). 3+ colours
  // keep the gold "m" wings — a look that was never printed.
  twoColorSplit: { atPct: 50 },
  // Pips: Ø 67 px and right edge 92.3 %W on the scans.
  costSizePct: 0.0445,
  // The PNG's transparent window is 8.8–91.1 %W × 11.1–55.3 %H.
  artSlot: { topPct: 10.9, leftPct: 8.6, widthPct: 82.8, heightPct: 44.5 },
  title: {
    rect: { topPct: 4.55, leftPct: 8.3, widthPct: 84, heightPct: 6.0 },
    sizePct: 0.053,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 56.3, leftPct: 8.55, widthPct: 83.7, heightPct: 5.0 },
    sizePct: 0.045,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  // MSE's text box (52,566)–(594,823) on 646×902 less its padding, centred
  // like MSE; 9 pt, the platform rules base.
  rules: {
    rect: { topPct: 62.75, leftPct: 8.7, widthPct: 82.6, heightPct: 28.5 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_LIGHT,
    vAlign: "center",
    font: "body",
  },
  // MSE's pt field (516,810 80×36 on 646×902) and its plate — MSE pt/<c>pt.png
  // cropped by scripts/build-showcase-frames.mjs to 1156,1850 271×149 on the
  // 1500×2100 card. Written out, not spread from M15.pt: that one follows the
  // Card Conjurer M15 plate and its own layout versions.
  // The plate's light face runs 1193–1388 px on the digits' rows, inside
  // its black outline — wider than MSE's field, so 10/10–18/18 print at
  // full size on it and 20/20, which reaches the outline, shrinks.
  pt: {
    rect: { topPct: 89.8, leftPct: 79.88, widthPct: 12.38, heightPct: 3.99 },
    inkSpanPct: { leftPct: 79.5333, rightPct: 92.5333 },
    plateRect: { topPct: 88.095, leftPct: 77.067, widthPct: 18.067, heightPct: 7.095 },
    plateAssetPathTemplate: "/frames/tarkirdragon/pt/{color}.png",
    sizePct: 0.05,
    colorHex: INK_DARK,
    weight: 700,
  },
};
// Draconic is the gold Tarkir: Dragonstorm dragon frame (TDM #292–323). Its
// P/T prints in black on a light box ringed by serpents (TDM #321 Ureni
// "10/10", #301 Magmatic Hellkite): MSE's pt/<c>pt.png, cropped by
// scripts/build-showcase-frames.mjs to 1132,1813 368×188 on the 1500×2100
// card (it runs to the card's right edge). Without it the P/T was white on
// the light parchment and could not be read (owner review 2026-09-25).
const TARKIRDRACONIC: FrameProfile = {
  ...tarkirCard("Draconic", { title: INK_DARK, type: INK_DARK, rules: INK_DARK }),
  // MSE's pt field (516,811 82×34 on 646×902) centres the value at
  // 1293 × 1928 px, where both scans print it (86.0 %W, 91.7 %H); the ink
  // may use the box's light face inside the serpents, 1187–1398 px, so
  // `10/10` and `20/20` print at full size like Ureni's.
  pt: {
    rect: { topPct: 89.911, leftPct: 79.876, widthPct: 12.693, heightPct: 3.769 },
    inkSpanPct: { leftPct: 79.1333, rightPct: 93.2 },
    plateRect: { topPct: 86.3333, leftPct: 75.4667, widthPct: 24.5333, heightPct: 8.9524 },
    plateAssetPathTemplate: "/frames/tarkirdraconic/pt/{color}.png",
    sizePct: 0.05,
    colorHex: INK_DARK,
    weight: 700,
  },
};

// LOTR — title bar (top), CIRCULAR art window (the One Ring), type bar, textbox.
// The artSlot is the circle's bounding box; the frame's opaque corners hide the
// rectangular art outside the circle.
const LOTR: FrameProfile = {
  label: "Ring",
  costSizePct: 0.038,
  artSlot: { topPct: 13, leftPct: 14, widthPct: 72, heightPct: 45 },
  title: {
    rect: { topPct: 4.5, leftPct: 9, widthPct: 82, heightPct: 6 },
    sizePct: 0.044,
    colorHex: INK_LIGHT,
    weight: 600,
    font: "display",
    shadowCss: SHOWCASE_SHADOW,
  },
  type: {
    rect: { topPct: 59, leftPct: 9, widthPct: 82, heightPct: 5 },
    sizePct: 0.028,
    colorHex: INK_LIGHT,
    weight: 600,
    font: "display",
    shadowCss: SHOWCASE_SHADOW,
  },
  rules: {
    rect: { topPct: 66, leftPct: 8.5, widthPct: 83, heightPct: 26 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.reduced),
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
  },
  pt: {
    rect: { topPct: 86.5, leftPct: 71, widthPct: 23, heightPct: 7.5 },
    sizePct: 0.043,
    colorHex: "#ffffff",
    weight: 700,
    shadowCss: OUTLINE_SHADOW,
  },
};

// LOTR Scroll — m15-ish (title top, rectangular art, type, textbox) on a scroll.
// The scroll's ribbon + type band are light parchment in every color variant,
// so both take dark ink (the official LTC scrolls print dark).
const LOTRSCROLL: FrameProfile = {
  ...LOTR,
  label: "Scroll",
  artSlot: { topPct: 11.5, leftPct: 8, widthPct: 84, heightPct: 45 },
  rules: {
    ...LOTR.rules,
    rect: { topPct: 65.5, leftPct: 8.5, widthPct: 83, heightPct: 21 },
  },
  title: {
    rect: { topPct: 4.5, leftPct: 9, widthPct: 82, heightPct: 6 },
    sizePct: 0.044,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 59, leftPct: 9, widthPct: 82, heightPct: 5 },
    sizePct: 0.028,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
};

// Borderless showcases — art fills nearly the whole card; the name + rules sit
// on translucent panels over the art (scrim for legibility).
function borderlessShowcase(
  label: string,
  opts: { typeInk?: string; ptInk?: string } = {},
): FrameProfile {
  const typeInk = opts.typeInk ?? INK_LIGHT;
  const ptInk = opts.ptInk ?? "#ffffff";
  return {
    label,
    artSlot: { topPct: 2.5, leftPct: 3.5, widthPct: 93, heightPct: 92 },
    costSizePct: 0.034,
    title: {
      rect: { topPct: 5, leftPct: 8, widthPct: 84, heightPct: 6 },
      sizePct: 0.044,
      colorHex: INK_LIGHT,
      weight: 600,
      font: "display",
      shadowCss: OUTLINE_SHADOW,
    },
    type: {
      rect: { topPct: 56, leftPct: 8, widthPct: 84, heightPct: 4.5 },
      sizePct: 0.026,
      colorHex: typeInk,
      weight: 600,
      font: "display",
      ...(typeInk === INK_LIGHT ? { shadowCss: OUTLINE_SHADOW } : {}),
    },
    rules: {
      rect: { topPct: 62, leftPct: 7, widthPct: 86, heightPct: 28 },
      sizePct: rulesPxToPct(RULES_SIZE_PX.reduced),
      colorHex: INK_LIGHT,
      vAlign: "center",
      font: "body",
      backdropHex: "rgba(8,8,12,0.55)",
    },
    pt: {
      rect: { topPct: 89, leftPct: 73, widthPct: 21, heightPct: 7 },
      sizePct: 0.04,
      colorHex: ptInk,
      weight: 700,
      ...(ptInk === "#ffffff" ? { shadowCss: OUTLINE_SHADOW } : {}),
    },
  };
}
const BLOOMANIME = borderlessShowcase("Anime");

// Ghostfire — the Tarkir: Dragonstorm borderless ghostfire showcase (TDM
// #399–418). MSE's style (magic-m15-showcase-tarkir-ghostfire) draws its
// namebox / typebox / textbox in teal (#03586b) at 60 % opacity UNDER the
// pale-cyan outline, puts a teal ribbon under the P/T, and sets every font
// white. scripts/build-showcase-frames.mjs bakes the three boxes into the
// PNGs and crops the ribbon to pt/<c>.png, so the bars are dark translucent
// teal and take white ink (owner review 2026-09-25: the old outline-only
// PNG left "Enchantment" in dark ink on the type band's lower rim, over the
// art). Geometry measured on the new c.png's bands (name 5.05–10.43 %H,
// type 51.38–56.86, text box 57.3–87.4) and on the real TDM #400 scan.
// MSE's swap_fonts are all "white" and the scan's ink is (255,255,255) —
// pure white, not the house cream (INK_LIGHT).
const GHOSTFIRE_INK = "#ffffff";
const TARKIRGHOSTFIRE: FrameProfile = {
  label: "Ghostfire",
  artSlot: { topPct: 2.5, leftPct: 3.5, widthPct: 93, heightPct: 92 },
  // Pips: Ø 70 px, 82.5–92.4 %W, centred at 7.52 %H on the scan. The pips
  // centre in the title rect, which sits 0.09 %H above the name band's
  // centre so name and pips each land within 2 px of the scan (no costDy:
  // that nudge is kept for the Card Conjurer frames).
  costSizePct: 0.0465,
  // Title and type sizes land the scan's ink widths ("Clarion Conqueror"
  // 659 px, "Creature — Dragon" 561 px at 1500 wide).
  title: {
    rect: { topPct: 4.96, leftPct: 8.55, widthPct: 83.85, heightPct: 5.38 },
    sizePct: 0.0535,
    colorHex: GHOSTFIRE_INK,
    weight: 600,
    font: "display",
    shadowCss: OUTLINE_SHADOW,
  },
  type: {
    rect: { topPct: 51.38, leftPct: 8.5, widthPct: 83.5, heightPct: 5.48 },
    sizePct: 0.0445,
    colorHex: GHOSTFIRE_INK,
    weight: 600,
    font: "display",
    shadowCss: OUTLINE_SHADOW,
  },
  // MSE's text field (66,610)–(678,905) on 744 × 1039, widened so the ink
  // starts at the scan's 9.0 %W past our box padding. 9 pt, the platform
  // rules base (the scan's short text prints larger). No scrim: the baked
  // textbox is the backdrop now.
  rules: {
    rect: { topPct: 58.71, leftPct: 8.3, widthPct: 83.4, heightPct: 28.39 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: GHOSTFIRE_INK,
    vAlign: "center",
    font: "body",
  },
  // MSE's pt field (590,917 99 × 46 on 744 × 1039) on the ribbon, which the
  // build crops at 1093,1768 385 × 208 on the 1500 × 2100 card. The white
  // ink may use the ribbon from its pale left flare (1153 px) to its cyan rim
  // (1404 px, where it curves in lowest on the digits' rows).
  pt: {
    rect: { topPct: 88.26, leftPct: 79.3, widthPct: 13.31, heightPct: 4.43 },
    inkSpanPct: { leftPct: 76.8667, rightPct: 93.6 },
    plateRect: { topPct: 84.1905, leftPct: 72.8667, widthPct: 25.6667, heightPct: 9.9048 },
    plateAssetPathTemplate: "/frames/tarkirghostfire/pt/{color}.png",
    sizePct: 0.05,
    colorHex: "#ffffff",
    weight: 700,
    shadowCss: OUTLINE_SHADOW,
  },
};

// ---------------------------------------------------------------------------
// 2026-07 variation frames (scripts/build-variation-frames.mjs). Geometry
// from the MSE style specs (375×523 / 750×1046 → percent); fine-tune in the
// admin layout editor before verifying — all five start unpublished.
// ---------------------------------------------------------------------------

// Extended Art — M15 skeleton; the art window is tall and the frame has no
// side borders, so art bleeds to the card edges beside the white text box.
const EXTENDEDART: FrameProfile = {
  ...M15,
  label: "Extended Art",
  // Frame edge at 96.76%H (lower than M15's 92.86%).
  brandMark: { rightPct: 3.5, bottomPct: 0.8 },
  artSlot: { topPct: 11.9, leftPct: 4, widthPct: 92, heightPct: 48.4 },
  // The default rules padding, not M15's print margins (layout v33).
  rules: {
    ...M15.rules,
    rect: { topPct: 60.5, leftPct: 9.1, widthPct: 82.9, heightPct: 29 },
    padPx: undefined,
  },
};

// Zendikar Expedition land — dark stone frame, art fills the upper 2/3,
// translucent dark text box over the art (MSE text 29,315 314×112).
const EXPEDITIONLAND: FrameProfile = {
  ...M15,
  label: "Expedition Land",
  hideCost: true,
  artSlot: { topPct: 11.5, leftPct: 4, widthPct: 92, heightPct: 70 },
  title: {
    ...M15.title,
    colorHex: INK_LIGHT,
    shadowCss: SHOWCASE_SHADOW,
  },
  type: {
    ...M15.type,
    colorHex: INK_LIGHT,
    shadowCss: SHOWCASE_SHADOW,
  },
  rules: {
    rect: { topPct: 60.5, leftPct: 8, widthPct: 83.5, heightPct: 21 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_LIGHT,
    vAlign: "start",
    font: "body",
    backdropHex: "rgba(8,8,10,0.72)",
  },
  footer: { ...M15.footer!, colorHex: INK_LIGHT },
};

// Nyx constellation — M15 layout at 750×1046 with a starfield border and a
// baked-in translucent dark text box (light ink).
// The art runs under the WHOLE translucent type bar and text box, as on the
// Theros Beyond Death constellation prints (THB #258 Daxos, #259 Heliod,
// #268 Klothys — one picture from the window to the box's bottom; owner
// decision 2026-09-29, TODO 4.17b, layout v35). The box runs 110–1391 ×
// 1319–1946 px; the slot used to end at 81.2 % (1705 px), so the box's top
// showed the art and its last 241 px #101015 — a seam across the rules text.
// It now ends at 93 % (1953 px), under the opaque bottom border. Since layout
// v37 (TODO 4.17e) the masters' black is the prints' darkness: α 171 in the
// box (a third of the art shows through; the prints 0.28–0.39) and α 150 on
// the type bar (0.41; the prints 0.36–0.46), where MSE painted both at α ≈
// 128 (scripts/lib/nyx-tone.mjs).
const NYX: FrameProfile = {
  ...M15,
  label: "Nyx Constellation",
  artSlot: { topPct: 11.2, leftPct: 6, widthPct: 88, heightPct: 81.8 },
  title: { ...M15.title, colorHex: INK_LIGHT, shadowCss: SHOWCASE_SHADOW },
  type: { ...M15.type, colorHex: INK_LIGHT, shadowCss: SHOWCASE_SHADOW },
  rules: { ...M15.rules, colorHex: INK_LIGHT },
  footer: { ...M15.footer!, colorHex: INK_LIGHT },
};

// Zendikar Rising showcase (the hedron frame; key `fullart` for history, not
// full art) — a tall art window inside the border, floating title bar, and a
// baked-in translucent text box in the bottom quarter.
// The art fills the whole translucent text box (α ≈ 179, 59–1442 ×
// 1239–1946 px): the slot used to end at 91.2 % (1915 px), leaving a 31 px
// #101015 strip along the box's bottom (TODO 4.17b, layout v35); it ends at
// 93 % (1953 px) now, under the opaque bottom border. (The ZNR prints paint
// that box as an opaque hedron panel — a re-source question, not this fix.)
// Its left, top and right edges moved out to whole pixels past the hedron
// ring's anti-aliased rim too (v35): 57–1443 × 56.7 px (was 60–1440 × 60.9),
// where the ring (α 128–249 on rows 59–60 and columns 59 / 1440–1441) left
// 7,956 px half-dark over #101015 — a thin line along the art's top.
const FULLART: FrameProfile = {
  ...M15,
  label: "Zendikar Rising Hedron",
  artSlot: { topPct: 2.7, leftPct: 3.8, widthPct: 92.4, heightPct: 90.3 },
  title: {
    ...M15.title,
    rect: { topPct: 5.4, leftPct: 8.5, widthPct: 83, heightPct: 5 },
  },
  // Layout v32: M15's type size (was 0.0347, 52 px), on its old baseline.
  type: {
    rect: { topPct: 73.6, leftPct: 8.5, widthPct: 83, heightPct: 4.2 },
    sizePct: TYPE_SIZE_PCT,
    dy: keepBaseline(0.0347, TYPE_SIZE_PCT),
    fit: "measured",
    colorHex: INK_LIGHT,
    weight: 600,
    font: "display",
    shadowCss: SHOWCASE_SHADOW,
  },
  rules: {
    rect: { topPct: 78.6, leftPct: 8, widthPct: 84, heightPct: 13.5 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.reduced),
    colorHex: INK_LIGHT,
    vAlign: "start",
    font: "body",
  },
  footer: { ...M15.footer!, colorHex: INK_LIGHT },
};

// Full-art basic lands — Card Conjurer 'Fullart Basics (2022)' (frames plan
// 4.39; packTextlessBasics2022.js @2fcddba, frames bucket only): a light
// title bar, then a "Basic Land — Plains" bar with the mana symbol's disc
// at its left end, as printed since P23 (ONE, MOM, LTR … FDN, HOB). The bars
// measure 4.24–11.10 and 83.95–90.81 % H on the masters (CC title y 5.22,
// type x 18.87 / y 84.81). The text slots are Card Conjurer's (title x
// 0.0854, size 0.0381 H = 80 px at HD; type x 283/1500, size 0.0324 H = 68
// px), measured against 17 prints (FDN #282–290, TDM/DSK/DFT #272–276, FRA
// #382–394, FIN #309; new-frames print review 2026-09-26): the name's ink
// then starts within 1 px of the print at its width (M15's slots, kept from
// the old MSE master, set it 7–9 px right and ~6 % small, the type line
// 10–12 px left, 6 px low and 5 % small). The set symbol prints at the
// print's size (78–91 px of ink; type.sizePct × 1.1 gave 57–60). Dark ink
// on the light bars (M15's). Basic lands only (0.26's
// BASIC_ONLY_TEMPLATES, lib/creator/card-kinds.ts): no cost, and a basic
// prints no rules — its symbol goes in the frame's own disc (3.24's
// basicSymbol, "glyph": CC paints the disc, its 168 px s?.png symbol is
// drawn on it; frames bucket), never across the art. The set symbol is
// right-anchored at 92.13 %W and centred on 87.39 %H (CC setSymbolBounds).
// `rules` only places a non-basic's text and watermark, which the basic-only
// gate keeps off these frames.
// Layout v32: these slots already print at the family's sizes (they ARE
// TITLE_SIZE_PCT / TYPE_SIZE_PCT) on print-verified rects, so they take
// none of M15's v32 text changes: no baseline dy and the old fit path (both
// set explicitly — the slots spread M15's). The set symbol's box is M15's
// (SET_SYMBOL_BOX_PCT, 86 px, inside the 4.1 %H symbolRect): a Keyrune
// glyph keeps its print-checked 0.065 font (box × KEYRUNE_EM_PER_BOX), the
// default mark and an uploaded icon fill the box (they drew 97.5 px).
const FULL_ART_BASIC: FrameProfile = {
  ...M15,
  hideCost: true,
  title: {
    ...M15.title,
    rect: { topPct: 5.4, leftPct: 8.54, widthPct: 80.46, heightPct: 4.6 },
    sizePct: TITLE_SIZE_PCT,
    dy: 0,
    fit: undefined,
  },
  type: {
    ...M15.type,
    rect: { topPct: 85.1, leftPct: 18.87, widthPct: 65.13, heightPct: 4.2 },
    sizePct: TYPE_SIZE_PCT,
    dy: 0,
    fit: undefined,
  },
  symbolRect: { topPct: 85.34, leftPct: 80.13, widthPct: 12, heightPct: 4.1 },
  // CC's box, the rect's height (layout v32; it was a 0.065 font size, which
  // drew the mark and an icon at 97.5 px, past the rect). A Keyrune glyph
  // still draws at 0.065 W unless its ink would stand taller than the box —
  // never at the type bars' printed sizes (layout v36, TODO 4.46): its size
  // here was print-checked on the basics' own pill (4.39).
  symbolSizePct: SET_SYMBOL_BOX_PCT,
  setSymbolFit: "ink-box",
  rules: {
    rect: { topPct: 16, leftPct: 15, widthPct: 70, heightPct: 62 },
    sizePct: rulesPxToPct(RULES_SIZE_PX.standard),
    colorHex: INK_LIGHT,
    font: "body",
  },
};

/** The basic-symbol slot of a Fullart Basics (2022) template: CC's disc box,
 *  with the template's own copy of CC's symbols (bucket objects
 *  `<template>/symbol/{w,u,b,r,g,c}.png`, 168 × 168 — the box's exact size). */
function fullArtBasicSymbol(template: "m15fullartland" | "fullartland"): BasicSymbolSlot {
  return { ...BASIC_SYMBOL_CC_2022, assetPathTemplate: `/frames/${template}/symbol/{symbol}.png` };
}

// …black-bordered (NEW, 4.39): the pack's full composite. The art sits
// inside the black ring (CC artBounds 3.94/2.81/92.14 × 89.29; the ring
// measures 3.93 % at the sides, 2.86 % on top, from 92.10 % H below), and
// the artist line and brand mark print in the bottom border, as on M15.
const M15FULLARTLAND: FrameProfile = {
  ...FULL_ART_BASIC,
  label: "Full-Art Basic Land",
  artSlot: { topPct: 2.81, leftPct: 3.94, widthPct: 92.14, heightPct: 89.29 },
  basicSymbol: fullArtBasicSymbol("m15fullartland"),
};

// …borderless (re-sourced by 4.39; owner decision 4.35(a): it stays
// borderless, with light bars): the same composite without the pack's Border
// mask, so the art runs to every edge (FRA #382–396 print this layout with
// dark bars — a colour treatment built only when the 1.6 log asks). The
// artist line and the brand mark print on the art (3.23): the footer in
// ON_ART_OUTLINE, the mark on its dark pill.
const FULLARTLAND: FrameProfile = {
  ...FULL_ART_BASIC,
  label: "Borderless Full-Art Basic Land",
  artSlot: { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 100 },
  basicSymbol: fullArtBasicSymbol("fullartland"),
  brandMark: BRAND_MARK_ON_ART,
  footerOnArt: true,
  footer: {
    ...M15.footer!,
    rect: { topPct: 93.2, leftPct: 6.5, widthPct: 87, heightPct: 3 },
    colorHex: INK_LIGHT,
  },
};

// M15 Textless — the plain M15 border around a tall art window (no type
// plate, no text box painted). Shares FULLART's over-art ink treatment: light
// type and light rules straight on the art. FULLART has no `backdropHex`, so
// no scrim backs the rules yet. The art window is inset to the M15 border
// rather than bleeding to the card edge.
const M15TEXTLESS: FrameProfile = {
  ...FULLART,
  label: "M15 Textless",
  artSlot: { topPct: 11.3, leftPct: 7.7, widthPct: 84.0, heightPct: 80.7 },
};

const M15TEXTLESSLAND: FrameProfile = {
  ...M15TEXTLESS,
  label: "M15 Textless Land",
  hideCost: true,
};

/**
 * The standard legendary crown (TODO 4.6a; design 2026-09-29 §1.1) — Card
 * Conjurer's M15 crown over its black "Legend Crown Border Cover", built by
 * scripts/import-cc-frames.mjs (`--only m15crown`) as ONE band per key: the
 * top 410 px of the 1500 × 2100 card (the crown's arms run down the frame
 * beside the art to 19.4 %H), stretched over the card's full width. It
 * repaints the frame's top border and draws the crown's scallops, arms and
 * a soft shadow over the top of the art — α ≤ 79 on the art you can see,
 * rows 238–244 px (α ≤ 119 inside the art slot only where the frame's own
 * window edge sits on top of it; the importer refuses a band above 127;
 * measured on all 19 bands after v35) — and nothing moves:
 * the title bar, the art window and every slot keep their place (the band
 * has a hole for the title bar). The prints: FDN #2 / #45 / #72 / #91 / #106
 * (mono), #243 (gold), NEO #266–278 (lands), UMA #241 (colourless land),
 * FDN #677 (colourless artifact) — peak at row 42 ± 2 at HD.
 *
 * Keys (resolveFrameOverlays: the pinline of the master actually drawn):
 * the colour (w u b r g), "m" gold (three or more colours, or a pair drawn
 * gold), "c" the colourless grey (m15's see-through Eldrazi frame, UMA #6),
 * "a" the artifact silver and "l" the land grey (the entries' keyMap maps a
 * colourless card there), and the ten pairs (the first colour's crown on the
 * left, split through the untilted 45→55 %W ramp) — drawn only where the
 * two-colour frame is (FrameProfile.twoColorMasters, 4.6b). Opt-in per card
 * (FrameStyle.crown === true): declaring it changes no stored card.
 *
 * Set only on the PROFILES entries m15, m15artifact and m15land — and, since
 * 4.6f wave 2c, m15snow (c → a) and m15snowland (c → l), whose Card Conjurer
 * masters share the M15 pack's geometry row for row, so the band registers
 * on their title bar as it does on m15's (KHM #224 / #223 / #230, J22 #12,
 * PH19 #5, DMR #244) — never on M15 / M15LAND, which 12 other profiles
 * spread (devoid draws no crown by the owner's call; borderless and
 * extended art draw the floating crown; the showcases and the layouts
 * none yet, 4.6f).
 */
export const M15_CROWN: FrameOverlaySlot = {
  anatomy: "crown",
  // Rows 0–409 of the HD card, exactly (410 / 2100).
  rect: { topPct: 0, leftPct: 0, widthPct: 100, heightPct: (410 / 2100) * 100 },
  assetPathTemplate: "/frames/m15crown/{key}.png",
  // CROWN_BAND_KEYS in scripts/lib/cc-frames.mjs — the importer's list (a
  // unit test holds them together); the pairs in printed order
  // (TWO_COLOR_PAIRS).
  keys: ["w", "u", "b", "r", "g", "m", "a", "l", "c", "wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"],
};

/**
 * The extended-art frame's legendary crown (TODO 4.6f, wave 2b): Card
 * Conjurer's FLOATING crown as an overlay band, `extendedcrown/<key>.png`
 * (1500 × 260): CC's black 'Crown Border Cover' strip (3.94/2.77/92.14×1.77 %,
 * drawn — not erased, as on the borderless frame), the crown
 * (3.07/1.91/93.87×10.24 %) and its outline ON TOP (2.8/1.72/94.4×10.62 %;
 * autoExtendedArtFrame pushes it first and drawFrames draws the list
 * reversed), all 1500-native, 1:1. The prints (FDN #442 / #455 / #463 /
 * #466 / #470) stop the crown under the title bar with art beside and below
 * it. Keys: the seven colour keys — a pair wears the gold crown (this frame
 * draws no pair masters), the colourless card CC's grey C crown over our MSE
 * colourless master.
 *
 * The slot sits 10 px (0.476 %H) LOWER than CC's bounds: our extendedart
 * master is MSE-built, and its title bar's top edge sits 0.45 %H below the
 * print's (FDN #442 / #455 and CC's m15/new/extended put the bar's outline at
 * 4.98 %H, ours at 5.43), so the crown's hole hugs OUR bar — the peak lands
 * at 2.2 %H against the print's 2.0. 4.7's CC-built master takes the offset
 * back to 0. Set on the extendedart entry only.
 */
export const EXTENDED_CROWN: FrameOverlaySlot = {
  anatomy: "crown",
  rect: { topPct: (10 / 2100) * 100, leftPct: 0, widthPct: 100, heightPct: (260 / 2100) * 100 },
  assetPathTemplate: "/frames/extendedcrown/{key}.png",
  // EXTENDED_CROWN_BAND.keys in scripts/lib/cc-frames.mjs (a unit test holds
  // them together).
  keys: ["w", "u", "b", "r", "g", "m", "c"],
};

/**
 * The double-faced bodies' legendary crown (TODO 5.1d; the 4.6f note of the
 * 5.0 design): the m15crown band CUT round the icon well or the housing —
 * `m15dfccrown/<key>` for the faces whose well is at the LEFT (the
 * transform front, the transform land front, the 2016–22 transform back),
 * `m15dfccrownright/<key>` for the ▼ transform back (its well at the
 * right), `m15mdfccrown/<key>` for the modal front and back (the housing).
 * Each piece is the m15crown band byte for byte outside the well's columns;
 * inside them the alpha is Card Conjurer's own DFC crown twin's (the well
 * cleared, the crown round it — the prints wrap the crown round the well
 * with the ring on top: MID #246 Tovolar, VOW #21 Katilda, MOM #190
 * Zilortha's ▼ back, KHM #112 Tergrid both faces) and the colour the band's
 * own leg texture, since the band's hole is the plain M15 bar's (scripts/lib/
 * cc-frames.mjs DFC_CROWN_WELLS, cutCrownBand). The same rows as M15_CROWN
 * (0–409 at HD); keys: the colours, gold, the artifact silver (`a`: a DFC
 * body's colourless is the artifact master standing in, `c` → `a`), the
 * land grey (`l`: the land front, `c` → `l`) and the ten pairs (DFC_CROWN_KEYS
 * in the importer; a unit test holds them together) — never `c`. Opt-in per
 * card like M15's: declaring it changes no stored card. The icon rider draws
 * AFTER the crown on a face that has one (the well is cleared, so they never
 * meet; the order keeps the glyph on top).
 */
const DFC_CROWN_KEYS: readonly string[] = ["w", "u", "b", "r", "g", "m", "a", "l", "wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"];
export const DFC_CROWN_LEFT: FrameOverlaySlot = {
  anatomy: "crown",
  rect: M15_CROWN.rect,
  assetPathTemplate: "/frames/m15dfccrown/{key}.png",
  keys: DFC_CROWN_KEYS,
};
export const DFC_CROWN_RIGHT: FrameOverlaySlot = {
  anatomy: "crown",
  rect: M15_CROWN.rect,
  assetPathTemplate: "/frames/m15dfccrownright/{key}.png",
  keys: DFC_CROWN_KEYS,
};
export const MDFC_CROWN: FrameOverlaySlot = {
  anatomy: "crown",
  rect: M15_CROWN.rect,
  assetPathTemplate: "/frames/m15mdfccrown/{key}.png",
  keys: DFC_CROWN_KEYS,
};

/**
 * The collector line on the black-bordered M15 family (TODO 4.9b): one slot
 * for every wave-1 template — the tokens, the planeswalker and the emblem
 * print their lines at M15's positions (TDOM #1, DOM #1, TFDN #24), so they
 * take this slot, not M15TOKEN.footer's. Measured at 1500 × 2100 on the
 * thirteen print scans of 2026-09-30 (DMU #107, DOM #1, FDN #1 / #280, KLD
 * #265, MOC #1, ONC #114 / #29, ONE #19, SLD #1207 / #1242, TDOM #1, TFDN
 * #24; scratchpad collector-line/measure2.json):
 *   • both lines start at 96–101 px — Card Conjurer's pen x 0.0647 W
 *     (creator-23.js:147–148) = 97 px;
 *   • line 1's baseline (the flat-bottomed digits and capitals) at
 *     1989–1999 px, mean 1993.5; line 2's at 2027–2038, mean 2032 — 38.5 px
 *     apart on the prints where CC's two bands (y 0.9377 / 0.9548 H, the
 *     baseline 0.7 of the 0.0171 H size below each) sit 35.9 apart;
 *   • capitals 24–26 px tall: the 0.0171 H = 36 px size (0.024 W; the
 *     collector face's 0.700 em cap height prints 25.2 px);
 *   • the brush's ink at 287–290 px, 40 px wide, from 27 px above the
 *     baseline to 3 above it; the artist's first capital 46–48 px after the
 *     brush's left edge, its capitals 27 px tall (CC: the size + 0.001 H =
 *     38 px, Beleren small caps);
 *   • the © line (MPlantin, CC 0.0162 H = 34 px) ends at 1395–1405 px,
 *     mean 1403 = CC's 0.0647 + 0.8707 = 0.9354 W.
 * Set only on the PROFILES entries below — never on M15 / M15LAND /
 * M15TOKEN, which other profiles spread (lib/cards/collector-line.ts
 * COLLECTOR_TEMPLATES; tests/unit/cards/collector-profiles.test.ts).
 */
export const M15_COLLECTOR: CollectorSlot = {
  leftPct: 6.47,
  rightPct: 93.54,
  line1BaselinePct: (1993.5 / 2100) * 100,
  line2BaselinePct: (2032 / 2100) * 100,
  brushLeftPct: (287 / 1500) * 100,
  sizePct: 36 / 1500,
  artistSizePct: 38 / 1500,
  markTextSizePct: 34 / 1500,
};

/**
 * The holofoil stamp's notch on the black-bordered M15 family (TODO 4.9c):
 * Card Conjurer's `m15/holoStamps` arch — the text box's bottom pinline
 * lifted over the stamp with its bevel, 192 × 96 px, 1:1 at HD, 2 px below
 * CC's bounds 43.6 / 90.34 / 12.8 × 4.58 % (654–846 × 1899–1995; the prints'
 * arch bottoms out at 1910–1912 px at the centre, CC's rim 5–7 px lower) —
 * built by the importer from ONE piece's geometry (CC's U, the one flat
 * saturated arc) with the rim tinted to OUR master's own bar colour (CC's
 * pieces predate its accurate M15 pack: its W rim is a bluish white against
 * our cream, its R and G more saturated) and the oval region cut clear
 * (scripts/lib/cc-frames.mjs HOLO_STAMP_NOTCHES). Keys: the colour's bar
 * (w u b r g, m gold, c the colourless grey — the snow and devoid frames'
 * bars are the same pixels, so they map onto these), a the artifact silver
 * and l the land taupe (the entries' keyMap), and since the 4.9c follow-up
 * (owner round 26, 2026-10-03) the ten PAIRS in printed order: a card
 * drawn as its pair master (either dress) asks for the pair's notch
 * (resolveFrameOverlays keys an overlay by the master drawn, as the crown
 * is), whose rim is tinted PER COLUMN to the pair master's own bar — the
 * pinline lerped 40→60 %W, which the notch's 654–846 px sit inside — so
 * the arch is that bar lifted and both feet meet it pixel for pixel. One
 * piece per pair serves the m15 split and hybrid, m15artifact and m15land
 * pair masters: their bar under the notch is the same pixels (the hybrid
 * dress's grey L bars are its title and type bars), which the importer
 * checks. Opt-in per card (FrameStyle.stamp): declaring it changes no
 * stored card.
 *
 * Set only on the PROFILES entries m15, m15land, m15artifact, m15snow,
 * m15snowland and m15devoid — never on M15 / M15LAND, which other profiles
 * spread.
 */
export const M15_HOLO_STAMP: FrameOverlaySlot = {
  anatomy: "holoStamp",
  // 2 px (0.095 %H) BELOW CC's bounds (y 0.9034): the piece's rim foot is 11
  // rows, cut for CC's older M15 bar, and our accurate-pack bar is 12 (rows
  // 1938–1949 at HD). At CC's bounds the foot stood 1 px proud of the bar's
  // top and the piece's black covered the bar's last two rows — a step at
  // both feet; 2 px lower the foot's bottom edge is the bar's own (the
  // importer builds the cut at the same offset, scripts/lib/cc-frames.mjs
  // HOLO_STAMP_NOTCHES). The arch's rim then bottoms out at 1917 px at the
  // centre against the prints' 1910–1912.
  rect: { leftPct: 43.6, topPct: 90.34 + (2 / 2100) * 100, widthPct: 12.8, heightPct: 4.58 },
  assetPathTemplate: "/frames/m15holostamp/{key}.png",
  // HOLO_STAMP_NOTCHES.m15holostamp.keys in scripts/lib/cc-frames.mjs (a
  // unit test holds them together); the pairs in printed order
  // (TWO_COLOR_PAIRS), as M15_CROWN lists them.
  keys: ["w", "u", "b", "r", "g", "m", "a", "l", "c", "wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"],
  stamp: { shape: "oval", oval: M15_HOLO_STAMP_OVAL, keepOut: M15_HOLO_STAMP_KEEP_OUT },
};

/** The planeswalker's notch (TODO 4.9c): CC's `planeswalker/holo` piece —
 *  a flat rim with a black line above it, no bevel, as the walker's box
 *  prints — 182 × 107 px at 43.94 / 90.15 / 12.14 × 5.1 % (659–841 ×
 *  1893–2000), the same recipe over the walker masters' bars (CC's own
 *  walker rims match them exactly; the colourless walker's grey, which CC
 *  has no piece for, is sampled like the rest). The oval sits 7 px higher
 *  than M15's, where CC's piece holds its hologram. The keep-out is read by
 *  the plain box only; the ability rows keep their shield rule (4.9d). */
export const M15PW_HOLO_STAMP: FrameOverlaySlot = {
  anatomy: "holoStamp",
  rect: { leftPct: 43.94, topPct: 90.15, widthPct: 12.14, heightPct: 5.1 },
  assetPathTemplate: "/frames/m15pwholostamp/{key}.png",
  keys: ["w", "u", "b", "r", "g", "m", "c"],
  stamp: { shape: "oval", oval: M15PW_HOLO_STAMP_OVAL, keepOut: M15PW_HOLO_STAMP_KEEP_OUT },
};

/** The planeswalker's collector slot: M15's, with the © slot ALWAYS on line
 *  2. Every walker master draws the loyalty shield's outline itself (x
 *  1202–1427, y 1847–1984 px on all seven colour keys), so a walker saved
 *  without a loyalty value — which draws no plate — would put the brand mark
 *  (or a clean download's footer text) across that outline on line 1 (its
 *  ink spans y ≈ 1967–2003); the editor's preview, which shows the empty
 *  shield, already puts it on line 2 (DOM #1 prints its © line there). */
export const M15PW_COLLECTOR: CollectorSlot = { ...M15_COLLECTOR, markLine: 2 };

// ---------------------------------------------------------------------------
// The transform bodies (TODO 5.1a; design 2026-10-02, design-next/5/final.md
// §2.2, frames.md §3 / §4.3): Card Conjurer's 'Transform (Front)',
// 'Transform (Back)' (2016–22, the icon well EMPTY at the left) and
// 'Transform (Back) (New)' (the ▼ baked at the right, every transform
// printed since 2022-11) packs — the M15 skeleton (the bands within 1–4 px
// of the prints: MID #169, INR #60, ZNR #12), so each body is the registry's
// m15 entry (the CC cost lift, type baseline and art slot; the family sizes,
// `fit: "measured"`; M15's rules ladder, footer, plate box and collector
// slot) with these deltas, measured on the scans at 1500 × 2100:
//   • the name on a face with the icon at the LEFT starts at 16.7 %W (prints
//     249–252 px on SOI #203, MID #169, INR #60 / #193, XLN #22; CC's pack
//     says 0.16 = 240, the design's D5), right edge M15's 92.2; a face with
//     the ▼ at the right keeps M15's 8.5 % start (prints 131–134) and ends
//     at 82.0 (the well's circle starts at 84.7 %W: 1271 px);
//   • the icon rider (DFC_ICON_RIDER): CC's icon bounds 5.94 / 5.05 /
//     7.34 × 5.24 % (89 / 106, 110 × 110 px) inside the master's well, the
//     glyph white on its black disc, keyed by the family's glyph for the
//     face's role (lib/cards/dfc.ts) — the front's glyph overdraws the
//     master's own ▲; the 2016–22 back's fills its empty well; the ▼ back
//     carries no rider (the ▼ is in its master);
//   • the front's reverse P/T (DFC_REVERSE_PT): CC's 'Reverse PT' box
//     8.6 / 84.2 / 83.8 × 3.62 %, 61 px (0.0407 W → 43 px caps, the prints'
//     43), end-aligned so the digits end at 1386 px (the prints' 1389–1392),
//     in #777 (the prints' neutral grey, luma 107–125; CC's #666 reads
//     darker), no plate — the grey pentagonal tab is the master's;
//   • a back: no cost; WHITE name, type and P/T ink (247–254 on every print),
//     dark rules ink on the greyed box; the pack's dark plates
//     (`m15dfcback/pt/<k>.png`, 285 × 156 at M15's plate box, the digits'
//     room re-measured on them: the lit face from 79.3 to 93.0 %W); the
//     colour-indicator dot on every coloured back (`indicator: "coloured"`,
//     lib/cards/color-indicator.ts: Ø 3.5 %W at 9.3 / 59.0 %, the type line
//     from 13.4 %W while it draws — INR #60's type ink starts at 200–204 px);
//   • the land pair (one master under every key, verified on `c`): no cost,
//     the front keeps its tab (INR #287 prints Ormendahl's 9/7), the back
//     prints no P/T and no indicator and — the one FIN / TLA print, FIN #31
//     Cooking Campsite: light tan bars toned onto it, the name and type in
//     DARK ink — dark band ink.
// Additions (the owner rule): no stored card sits on them, no bump. Set on
// the PROFILES entries only (`dfc` declares the body). The crown and the
// pair masters came with TODO 5.1d (DFC_CROWN_LEFT / DFC_CROWN_RIGHT on the
// PROFILES entries, `twoColorMasters: ["split"]` on the spell faces — the
// prints split a two-colour BACK's rings and box over its gold bars too,
// MOM #43 / MID #218 / MID #246; the land pair draws neither: no printed
// legendary land back on this frame, no two-colour land face in print); no
// holoStamp on a DFC body, ever.
// ---------------------------------------------------------------------------

/** The name band's start on a face whose icon well is at the LEFT (design
 *  D5: the prints' ink starts at 249–252 px, 16.6–16.8 %W, where CC's pack
 *  sets its box at 0.16 = 240). The BAND starts 4 px before the ink: Beleren
 *  Bold's first capital carries ~4 px of side bearing at the family's 80 px
 *  (a bake with the band at 16.7 put the ink at 255), so the band at
 *  246.75 px lands the ink at 250–251 — measured on real bakes at HD and 750
 *  (tests/unit/render/dfc-bodies-bake.test.tsx). */
export const DFC_ICON_FACE_TITLE_LEFT_PCT = 16.45;
/** The name band's right edge on a face whose ▼ well is at the RIGHT, %W
 *  (the well's circle starts at 84.7 %W). */
export const DFC_RIGHT_WELL_TITLE_RIGHT_PCT = 82.0;

/** The icon rider's slot: CC's icon bounds (packM15TransformTypes.js
 *  0.0594 / 0.0505 / 0.0734 × 0.0524), the 12 glyph keys the importer
 *  publishes (scripts/lib/cc-frames.mjs DFC_ICON_FILES; a unit test holds
 *  them together). Keyed by the glyph, never the colour. */
export const DFC_ICON_RIDER: FrameOverlaySlot = {
  anatomy: "dfcIcon",
  rect: { leftPct: 5.94, topPct: 5.05, widthPct: 7.34, heightPct: 5.24 },
  assetPathTemplate: "/frames/dfcicon/{key}.png",
  keys: ["default", "downarrow", "sun", "moon", "fullmoon", "emrakul", "compass", "land", "spark", "planeswalker", "fanclosed", "fanopen"],
};

/** The front's reverse P/T: CC's 'Reverse PT' text box (8.6 / 84.2 / 83.8 ×
 *  3.62 %), 61 px at HD — its right edge run 7 px past CC's 1386 to 1393
 *  (92.87 %W), where the builder read the prints' digits ending (1389–1392
 *  on MID #169, INR #60 / #193, SOI #203, MOM #43; a bake with CC's edge
 *  ended at 1384), the tab's paper running on to 1438–1441. End-aligned;
 *  measured on real bakes (tests/unit/render/dfc-bodies-bake.test.tsx).
 *  OPEN (the #460 skeptic, 2026-10-02): measured inside the caps' rows
 *  only (1788–1822, clear of the tab's shaded notch, which the 1389–1392
 *  reading took in), the prints' digits end at 1378–1390 (median 1382 on
 *  13 scans: INR #60 1382, MID #169 1384, INR #287 1380, SOI #203 1384,
 *  LCI #60 1380, MOM #43 1390 …) and ours at 1387–1389 — 3 to 8 px right
 *  of the same digits; CC's own edge (92.4 %W) would land them at ≈ 1384.
 *  A 0.4 %W owner call beside the dot's nudge, left as built. */
export const DFC_REVERSE_PT: StatSlot = {
  rect: { topPct: 84.2, leftPct: 8.6, widthPct: 92.87 - 8.6, heightPct: 3.62 },
  sizePct: 61 / 1500,
  colorHex: "#777777",
  weight: 700,
  align: "end",
};

const DFC_BACK_INK = "#ffffff";
/** M15's plate box and the dark plates' lit face on the digits' rows
 *  (measured on the pack's pt<K>.png: from 55 to 262 of 285 px, drawn at
 *  the box 75.73 → 94.53 %W). */
const DFC_BACK_PT: StatSlot = {
  ...M15.pt!,
  plateAssetPathTemplate: "/frames/m15dfcback/pt/{color}.png",
  inkSpanPct: { leftPct: 79.3, rightPct: 93.0 },
  colorHex: DFC_BACK_INK,
};

/** The transform masters' art window (layout v35's rule, lib/frames/
 *  art-window.ts): CC's 'Transform' packs cut their window at 115–1385 ×
 *  237–1166 px on every colour of every face — ONE px wider than the plain
 *  M15 masters' 116–1384 × 238–1165 on every side — so CC_M15_ART_SLOT
 *  (115.05 / 236.25) misses the 0.05 % the check asks by 0.8 / 0.3 px.
 *  This slot: 114 / 235.2 to 1386.45 / 1167.18 — overscan 1 / 1.45 / 1.8 /
 *  1.18 px (left, right, top, bottom); the wells and the tab are in the
 *  frame's opaque outline, outside it. */
const DFC_ART_SLOT: Rect = { topPct: 11.2, leftPct: 7.6, widthPct: 84.83, heightPct: 44.38 };

/** The CC-framed M15 skeleton every transform body starts from: the
 *  registry's m15 geometry (cost lift, type baseline), its own art window,
 *  no crown, no pairs, no see-through colourless (the `c` stand-in is the
 *  opaque artifact master). */
const DFC_SKELETON: FrameProfile = {
  ...M15,
  costDy: CC_M15_COST_DY,
  artSlot: DFC_ART_SLOT,
  type: { ...M15.type, dy: CC_M15_TYPE_DY },
  artifactMasterKeys: { c: "a" },
};

const M15DFCFRONT: FrameProfile = {
  ...DFC_SKELETON,
  label: "Transform front",
  dfc: { layout: "transform", role: "front", well: "left" },
  title: { ...M15.title, rect: { ...M15.title.rect, leftPct: DFC_ICON_FACE_TITLE_LEFT_PCT, widthPct: 92.2 - DFC_ICON_FACE_TITLE_LEFT_PCT } },
  overlays: [DFC_ICON_RIDER],
  reversePt: DFC_REVERSE_PT,
};

const M15DFCBACK: FrameProfile = {
  ...DFC_SKELETON,
  label: "Transform back (2022–)",
  dfc: { layout: "transform", role: "back", well: "right" },
  hideCost: true,
  title: {
    ...M15.title,
    rect: { ...M15.title.rect, widthPct: DFC_RIGHT_WELL_TITLE_RIGHT_PCT - M15.title.rect.leftPct },
    colorHex: DFC_BACK_INK,
  },
  type: { ...DFC_SKELETON.type, colorHex: DFC_BACK_INK },
  pt: DFC_BACK_PT,
  indicator: "coloured",
};

const M15DFCBACKLEFT: FrameProfile = {
  ...M15DFCBACK,
  label: "Transform back (2016–2022)",
  dfc: { layout: "transform", role: "back", well: "left" },
  title: { ...M15DFCBACK.title, rect: M15DFCFRONT.title.rect },
  overlays: [DFC_ICON_RIDER],
};

const M15DFCLANDFRONT: FrameProfile = {
  ...M15DFCFRONT,
  label: "Transform land front",
  dfc: { layout: "transform", role: "front", well: "left", land: true },
  hideCost: true,
  // One master under every key: no artifact dress.
  artifactMasterKeys: undefined,
};

/** The land back: the skeleton without M15's P/T slot (a land back prints
 *  none — and no indicator), the ▼ back's name band in M15's DARK ink. */
const { pt: _landBackPt, ...DFC_LAND_BACK_SKELETON } = DFC_SKELETON;
void _landBackPt;
const M15DFCLANDBACK: FrameProfile = {
  ...DFC_LAND_BACK_SKELETON,
  label: "Transform land back",
  dfc: { layout: "transform", role: "back", well: "right", land: true },
  hideCost: true,
  artifactMasterKeys: undefined,
  title: { ...M15.title, rect: M15DFCBACK.title.rect },
};

// ---------------------------------------------------------------------------
// The modal (MDFC) bodies (TODO 5.1b; design 2026-10-02 §2.2, frames.md
// §1.5 / §3.5 / §4.3): Card Conjurer's 'Modal Regular' pack over the same
// CC-framed M15 skeleton as the transform bodies — the drop housing with its
// ▲ (front) / ▲▼ (back), its ring and the flipside strip are the masters'.
//   • the name starts at the icon face's inset on BOTH faces (the housing
//     is at the left of every modal face; the prints' ink at 247–252 px);
//   • the strip's two texts (MDFC_STRIP_WORD / MDFC_STRIP_LINE) in CC's
//     flipside box 6.8 / 89.2 / 36.4 × 3.91 % (102–648 × 1873–1955 px): the
//     word in Beleren Bold at MDFC_STRIP_WORD_PX from the left edge (the
//     prints' ink from 103–110 px, capitals 35–36 px tall), the line in the
//     rules font with inline pips at MDFC_STRIP_LINE_PX against the right
//     edge (the prints' last ink at 647–650 px) — white on a front's dark
//     strip, dark (INK_DARK) on a back's light one;
//   • a back: a cost prints as on any card (KHM / STX / MSH backs carry one),
//     WHITE name, type and P/T ink on the toned dark bars, the transform
//     pack's dark plates, no indicator (no modal back prints one), no rider;
//   • the land pair: no cost and no P/T on either face (a land face prints
//     none); w u b r g from the five land tints, `c` CC's grey land modal and
//     `m` the gold tint, both stand-ins never offered (no reference) — no
//     artifact dress on a land.
// The crown (MDFC_CROWN, cut round the housing) and the pair masters (the
// split dress on both spell faces — STX #149 Extus and MSH #219 King
// T'Challa print it, and their backs; the hybrid dress on the front — MH3
// #252–261) came with TODO 5.1d, on the PROFILES entries; the land pair
// draws neither (no print). No holoStamp. Additions: no stored card sits on
// them, no bump.
// ---------------------------------------------------------------------------

/** CC's flipside text box (packModalRegular.js flipsideType /
 *  flipSideReminder: x 0.068 y 0.892 w 0.364 h 0.0391), inside the painted
 *  strip (64–690 × 1866–1948 px at HD). */
const MDFC_STRIP_BOX: Rect = { leftPct: 6.8, topPct: 89.2, widthPct: 36.4, heightPct: 3.91 };
const MDFC_STRIP_INK_FRONT = "#ffffff";
/** The other face's type word: Beleren Bold from the box's left edge. */
const MDFC_STRIP_WORD: TextSlot = {
  rect: MDFC_STRIP_BOX,
  sizePct: rulesPxToPct(MDFC_STRIP_WORD_PX),
  colorHex: MDFC_STRIP_INK_FRONT,
  weight: 700,
  font: "display",
  align: "start",
};
/** The other face's cost or mana line: the rules font (its pips the inline
 *  run's) against the box's right edge. */
const MDFC_STRIP_LINE: TextSlot = {
  rect: MDFC_STRIP_BOX,
  sizePct: rulesPxToPct(MDFC_STRIP_LINE_PX),
  colorHex: MDFC_STRIP_INK_FRONT,
  font: "body",
  align: "end",
};
/** The painted strip: CC's Flipside mask spans x 45–701 × y 1866–1955 at
 *  HD (the tab from the border's inner edge to its chevron's tip; the
 *  prints' 64–694 × 1861–1948), with 4 px of air above it for the lines'
 *  descenders. */
const MDFC_STRIP_KEEP_OUT: Rect = { leftPct: 3.0, topPct: 88.67, widthPct: 43.8, heightPct: 4.43 };
export const MDFC_FLIPSIDE_FRONT: FlipsideSlots = { word: MDFC_STRIP_WORD, line: MDFC_STRIP_LINE, keepOut: MDFC_STRIP_KEEP_OUT };
export const MDFC_FLIPSIDE_BACK: FlipsideSlots = {
  word: { ...MDFC_STRIP_WORD, colorHex: INK_DARK },
  line: { ...MDFC_STRIP_LINE, colorHex: INK_DARK },
  keepOut: MDFC_STRIP_KEEP_OUT,
};

/** The flipside strip RIDER (TODO 5.1c): the prints paint the strip in the
 *  colour of the face it DESCRIBES (STX #147's green front carries a blue
 *  strip for its blue back; the pathways' fronts their back's colour; KHM
 *  #114 Valki's front the B/R back's gold), the masters in their own — so
 *  each modal template publishes its masters' tabs as pieces,
 *  `<template>/strip/<key>.png` (scripts/lib/cc-frames.mjs MDFC_STRIP_CUTS:
 *  CC's Flipside mask's interior eroded 1 px and snapped to the HD grid's
 *  2 × 2 px blocks, the tab's own pixels), and
 *  both renderers draw the OTHER face's key's piece over the strip the
 *  master paints, under the strip's texts, when it differs from the
 *  master's own (a mono-colour card's bake is the master's bytes). The slot
 *  is the piece's box at HD, x 44–701 × y 1866–1955 (the mask's bbox grown
 *  to an even origin and size: 1:1 at HD, 2:1 at the 750 bake). Keys: the
 *  template's own colour keys and, on the spell bodies, `l` — the grey land
 *  modal's tab for a two-colour LAND other face (MH3 #252–261's hybrid
 *  fronts print the land grey) and, on a back, a front in the hybrid dress
 *  (MH3's land backs: a warm light grey, never gold); the land bodies map
 *  `l` to their own grey `c`. A two-colour spell other face is gold `m`
 *  (STX #149, KHM #114 / #168 / #179, MSH #18 / #219); a colourless one
 *  the artifact stand-in (`c` → `a`, no print). */
const MDFC_STRIP_RIDER_RECT: Rect = { leftPct: 44 / 15, topPct: 1866 / 21, widthPct: 658 / 15, heightPct: 90 / 21 };
const MDFC_STRIP_RIDER_SPELL_KEYS = ["w", "u", "b", "r", "g", "m", "a", "l"] as const;
const MDFC_STRIP_RIDER_LAND_KEYS = ["w", "u", "b", "r", "g", "m", "c"] as const;
export const MDFC_STRIP_RIDER_FRONT: FrameOverlaySlot = {
  anatomy: "mdfcStrip",
  rect: MDFC_STRIP_RIDER_RECT,
  assetPathTemplate: "/frames/m15mdfcfront/strip/{key}.png",
  keys: MDFC_STRIP_RIDER_SPELL_KEYS,
  keyMap: { c: "a" },
};
export const MDFC_STRIP_RIDER_BACK: FrameOverlaySlot = {
  ...MDFC_STRIP_RIDER_FRONT,
  assetPathTemplate: "/frames/m15mdfcback/strip/{key}.png",
};
export const MDFC_STRIP_RIDER_LAND_FRONT: FrameOverlaySlot = {
  anatomy: "mdfcStrip",
  rect: MDFC_STRIP_RIDER_RECT,
  assetPathTemplate: "/frames/m15mdfclandfront/strip/{key}.png",
  keys: MDFC_STRIP_RIDER_LAND_KEYS,
  keyMap: { l: "c" },
};
export const MDFC_STRIP_RIDER_LAND_BACK: FrameOverlaySlot = {
  ...MDFC_STRIP_RIDER_LAND_FRONT,
  assetPathTemplate: "/frames/m15mdfclandback/strip/{key}.png",
};

const M15MDFCFRONT: FrameProfile = {
  ...DFC_SKELETON,
  label: "Modal front",
  dfc: { layout: "modal", role: "front", well: "left" },
  title: M15DFCFRONT.title,
  flipside: MDFC_FLIPSIDE_FRONT,
};

const M15MDFCBACK: FrameProfile = {
  ...M15MDFCFRONT,
  label: "Modal back",
  dfc: { layout: "modal", role: "back", well: "left" },
  title: { ...M15MDFCFRONT.title, colorHex: DFC_BACK_INK },
  type: { ...DFC_SKELETON.type, colorHex: DFC_BACK_INK },
  pt: DFC_BACK_PT,
  flipside: MDFC_FLIPSIDE_BACK,
};

/** The land pair: the two above with no cost and no P/T slot, one of the
 *  five land tints under every colour (no artifact dress). */
const { pt: _mdfcLandFrontPt, ...M15MDFCFRONT_NO_PT } = M15MDFCFRONT;
void _mdfcLandFrontPt;
const M15MDFCLANDFRONT: FrameProfile = {
  ...M15MDFCFRONT_NO_PT,
  label: "Modal land front",
  dfc: { layout: "modal", role: "front", well: "left", land: true },
  hideCost: true,
  artifactMasterKeys: undefined,
};

const { pt: _mdfcLandBackPt, ...M15MDFCBACK_NO_PT } = M15MDFCBACK;
void _mdfcLandBackPt;
const M15MDFCLANDBACK: FrameProfile = {
  ...M15MDFCBACK_NO_PT,
  label: "Modal land back",
  dfc: { layout: "modal", role: "back", well: "left", land: true },
  hideCost: true,
  artifactMasterKeys: undefined,
};

const PROFILES: Record<FrameTemplate, FrameProfile> = {
  // Colourless M15 is CC's see-through "Eldrazi" frame: art under the frame
  // for "c" only (4.17). Set here, not on M15, so the many profiles that
  // spread M15 don't inherit it.
  // The CC cost lift, type-line baseline and art slot (CC_M15_COST_DY /
  // CC_M15_TYPE_DY / CC_M15_ART_SLOT) are set here too, for the same reason.
  // The legendary crown (TODO 4.6a) is set here too, and on the m15land
  // and m15artifact entries below — never on a base another profile spreads.
  // The two-colour pair masters (TODO 4.6b; `twoColorMasters`, opt-in per
  // card — FrameStyle.twoColor): declared on these three PROFILES entries
  // only, never on the M15 / M15LAND / M15ARTIFACT bases other profiles
  // spread (M15 by 11, M15LAND by m15snowland). m15 draws print's gold-split
  // (<pair>.png) and hybrid (<pair>-h.png) dresses; m15artifact and m15land
  // the split only (a hybrid artifact has no hybrid plate yet, so it falls
  // back to the gold-split master — lib/cards/anatomy.ts resolveTwoColor).
  // The masters are Card Conjurer recipes over the verified masters' own
  // files (scripts/lib/cc-frames.mjs pairMasterLayers), so a pair rides its
  // template's "m" tick (owner decision 2026-09-29, V-A). A card drawn as a
  // pair master wears the matching split crown band (m15crown/<pair>).
  m15: {
    ...M15,
    costDy: CC_M15_COST_DY,
    artSlot: CC_M15_ART_SLOT,
    type: { ...M15.type, dy: CC_M15_TYPE_DY },
    underFrameArt: { rect: UNDER_FRAME_RECT, colors: ["c"] },
    overlays: [M15_CROWN, M15_HOLO_STAMP],
    twoColorMasters: ["split", "hybrid"],
    collector: M15_COLLECTOR,
  },
  // A land's crown is its colour (NEO #266–278); a colourless land's the
  // land grey "l" (UMA #241 Dark Depths).
  m15land: {
    ...M15LAND,
    overlays: [{ ...M15_CROWN, keyMap: { c: "l" } }, { ...M15_HOLO_STAMP, keyMap: { c: "l" } }],
    twoColorMasters: ["split"],
    // Its pairs are a land's (the only frame a two-colour LAND draws them
    // on — owner round 17, 2026-09-30).
    twoColorForLands: true,
    collector: M15_COLLECTOR,
  },
  // The collector line (TODO 4.9b, M15_COLLECTOR) is set on each wave-1
  // entry here, like the crown — never on the M15 / M15LAND / M15TOKEN /
  // M15TOKENTEXT bases, which other profiles spread.
  // The snow land (TODO 4.6f, wave 2c; owner round 20, 2026-10-01): the
  // standard crown band over the snow bars, as the land entry has it (the
  // colourless crown is the land grey "l": DMR #244 Dark Depths, the one
  // crowned snow-frame land), and the land's split pairs over the snow land
  // files (m15snowland/<pair>: KHM's ten snow duals, #248–274). Declared on
  // the entry, never on M15SNOWLAND / M15LAND. The snow frames' bars are
  // M15's pixels (a colourless snow land's the land taupe), so the stamp's
  // notch (TODO 4.9c) is M15's, keyed the same.
  m15snowland: {
    ...M15SNOWLAND,
    overlays: [{ ...M15_CROWN, keyMap: { c: "l" } }, { ...M15_HOLO_STAMP, keyMap: { c: "l" } }],
    twoColorMasters: ["split"],
    twoColorForLands: true,
    collector: M15_COLLECTOR,
  },
  // Colourless creature tokens print a see-through frame (BFZ, MH1, WAR).
  m15token: { ...M15TOKEN, underFrameArt: { rect: UNDER_FRAME_RECT, colors: ["c"] }, collector: M15_COLLECTOR },
  // The artifact token's plate is M15's artifact set (TODO 4.49 (a)): CC's
  // silver m15PTa for colourless (TKLD #2, TMH1 #18), the colour's plate on
  // a coloured one (TC18 #7), as on m15artifact.
  m15tokenartifact: {
    ...M15TOKEN,
    label: "M15 Artifact Token",
    pt: { ...M15TOKEN.pt!, plateAssetPathTemplate: "/frames/m15artifact/pt/{color}.png" },
    collector: M15_COLLECTOR,
  },
  // TODO 4.49 (b): the text-box token; its colourless master is see-through
  // like m15token's (BFZ #2 / OGW #1 Eldrazi Scion), the artifact dress's
  // silver (TXLN #7 Treasure) and its plates M15's artifact set.
  m15tokentext: { ...M15TOKENTEXT, underFrameArt: { rect: UNDER_FRAME_RECT, colors: ["c"] }, collector: M15_COLLECTOR },
  m15tokenartifacttext: {
    ...M15TOKENTEXT,
    label: "M15 Artifact Token, text box",
    pt: { ...M15TOKENTEXT.pt!, plateAssetPathTemplate: "/frames/m15artifact/pt/{color}.png" },
    collector: M15_COLLECTOR,
  },
  // TODO 4.52: the emblem (M20 design); its collector line (E, the © slot
  // on line 1: no stat plate) through M15's slot (4.9b).
  emblem: { ...EMBLEM, collector: M15_COLLECTOR },
  // TODO 4.48 / 4.50: the full-art tokens, labelled plain "Token" now that
  // they are verified (4.48a). Their masters are clear almost everywhere,
  // so the creator's tile draws its sample art (4.45).
  m20token: { ...M20TOKEN, pickerSampleArt: true },
  m20tokentext: { ...M20TOKENTEXT, pickerSampleArt: true },
  m20tokentall: { ...M20TOKENTALL, pickerSampleArt: true },
  m20tokenartifact: { ...m20ArtifactToken(M20TOKEN, "Artifact Token"), pickerSampleArt: true },
  m20tokenartifacttext: { ...m20ArtifactToken(M20TOKENTEXT, "Artifact Token, text box"), pickerSampleArt: true },
  m20tokenartifacttall: { ...m20ArtifactToken(M20TOKENTALL, "Artifact Token, tall text box"), pickerSampleArt: true },
  // A coloured artifact's crown is its colour (NEO #74, M20 #131); a
  // colourless artifact's the artifact silver "a" (FDN #677).
  m15artifact: {
    ...M15ARTIFACT,
    overlays: [{ ...M15_CROWN, keyMap: { c: "a" } }, { ...M15_HOLO_STAMP, keyMap: { c: "a" } }],
    twoColorMasters: ["split"],
    collector: M15_COLLECTOR,
  },
  // The borderless frame's crown (TODO 4.6f, wave 2a) is CC's FLOATING crown
  // baked into `<key>-legendary` masters (crownMasters — an overlay can't
  // erase the title-bar ring CC erases under it), and its two-colour dress
  // the pinline-only split (`<pair>.png`: the gold M frame, the pinline
  // lerped between the pair's frames — FRA #376 / #377, HOB #213, TLA #306,
  // BLC #86, MH2 #321, FRA #461). Declared on the two entries only, never on
  // M15BORDERLESS, which the land dress spreads (its pairs are its own:
  // 4.56, below) — opt-in per card, so no stored card changes. A hybrid
  // cost prints the same split pinline over GREY bars (2X2 #374 / #385, SPG
  // #142 / #144, ECL #292–296: Card Conjurer's 'Land Frame' bars for a
  // hybrid pair), so m15borderless draws print's hybrid dress too
  // (`<pair>-h.png`, the grey plate `pt/c` = the pack's colourless plate).
  m15borderless: { ...M15BORDERLESS, crownMasters: true, twoColorMasters: ["split", "hybrid"] },
  // The artifact dress: the same crowned twins and split pairs (its
  // colourless twin wears CC's artifact crown on the artifact frame); a
  // hybrid artifact falls back to the split, like m15artifact. Its `m`
  // tick's references print this pinline split (frame-references.json).
  m15borderlessartifact: { ...M15BORDERLESSARTIFACT, crownMasters: true, twoColorMasters: ["split"] },
  // The borderless land's two-colour dress (TODO 4.56): ten pair masters
  // `<pair>.png` — the grey 'Land Frame' bars with the pinline AND the text
  // box split between the two colours across one ramp (39→61 %W), as MID
  // #281, OTJ #304, the RVR shocks and the MKM surveil lands print
  // (scripts/lib/cc-frames.mjs borderlessLandLayers with a letter pair).
  // Its pairs are a land's (twoColorForLands, like m15land), and the kind
  // gate keeps every other kind off the frame. Opt-in per card: a stored
  // two-colour land on this frame keeps the gold `m` master until its owner
  // switches the two-colour frame on. No crown (the frame has no crowned
  // twins: the crowned and nicknamed two-colour prints stay `nearest`), no
  // stamp notch, no collector line here.
  m15borderlessland: { ...M15BORDERLESSLAND, twoColorMasters: ["split"], twoColorForLands: true },
  m15borderlesspw: M15BORDERLESSPW,
  m15borderlesspwtall: M15BORDERLESSPWTALL,
  // The transform bodies (TODO 5.1a): each declares its `dfc` on its own
  // profile; the collector line (4.9b) on the entries here, like every
  // other — both faces print the card's one line (D8). The legendary crown
  // and the two-colour pairs (TODO 5.1d) on the entries here too, opt-in
  // per card as on m15: the crown cut round the well (the icon rider drawn
  // after it), its colourless key the artifact stand-in's silver (`c` →
  // `a`) or, on the land front, the land grey (`c` → `l`); the split pair
  // masters on every spell face — the prints split a BACK's rings and box
  // over its gold bars as the front's (MOM #43 G|W, MID #218 W|U, MID #246
  // R|G) — never on the land pair (no two-colour land face in print), and
  // no crown on the ▼ land back (no legendary land back was printed on this
  // frame: LCI's and XLN's are the parchment back, SLX #9's the 2016–22
  // one). No holoStamp here.
  m15dfcfront: { ...M15DFCFRONT, collector: M15_COLLECTOR, overlays: [{ ...DFC_CROWN_LEFT, keyMap: { c: "a" } }, DFC_ICON_RIDER], twoColorMasters: ["split"] },
  m15dfcback: { ...M15DFCBACK, collector: M15_COLLECTOR, overlays: [{ ...DFC_CROWN_RIGHT, keyMap: { c: "a" } }], twoColorMasters: ["split"] },
  m15dfcbackleft: { ...M15DFCBACKLEFT, collector: M15_COLLECTOR, overlays: [{ ...DFC_CROWN_LEFT, keyMap: { c: "a" } }, DFC_ICON_RIDER], twoColorMasters: ["split"] },
  m15dfclandfront: { ...M15DFCLANDFRONT, collector: M15_COLLECTOR, overlays: [{ ...DFC_CROWN_LEFT, keyMap: { c: "l" } }, DFC_ICON_RIDER] },
  m15dfclandback: { ...M15DFCLANDBACK, collector: M15_COLLECTOR },
  // The modal bodies (TODO 5.1b): the collector line as every M15 face; the
  // crown cut round the housing and the pairs (5.1d) on the spell faces —
  // the front draws both dresses (STX #149 / MSH #219 the split, MH3's ten
  // hybrid fronts the hybrid), the back the split (STX #149's back, MSH's
  // crowned pair backs); the land pair draws neither (no print).
  m15mdfcfront: { ...M15MDFCFRONT, collector: M15_COLLECTOR, overlays: [{ ...MDFC_CROWN, keyMap: { c: "a" } }, MDFC_STRIP_RIDER_FRONT], twoColorMasters: ["split", "hybrid"] },
  m15mdfcback: { ...M15MDFCBACK, collector: M15_COLLECTOR, overlays: [{ ...MDFC_CROWN, keyMap: { c: "a" } }, MDFC_STRIP_RIDER_BACK], twoColorMasters: ["split"] },
  m15mdfclandfront: { ...M15MDFCLANDFRONT, collector: M15_COLLECTOR, overlays: [MDFC_STRIP_RIDER_LAND_FRONT] },
  m15mdfclandback: { ...M15MDFCLANDBACK, collector: M15_COLLECTOR, overlays: [MDFC_STRIP_RIDER_LAND_BACK] },
  // The snow frame (TODO 4.6f, wave 2c; owner round 20, 2026-10-01, option
  // A): the STANDARD crown band over the snow bars — KHM #224 / #223 / #230,
  // J22 #12, PH19 #5 print the standard crown's shape and registration
  // (the snow pack's title bar sits where the M15 pack's does, row for row)
  // with a speckled texture; a colourless snow card's master is CC's snow
  // ARTIFACT frame, so its crown is the artifact silver "a" — and the
  // white-bar split pairs (m15snow/<pair>: the gold snow body and plate,
  // white bars, the split pinline and box; no hybrid snow print exists).
  // Declared on the entry, never on M15SNOW / M15. Its bars are M15's
  // pixels (the colourless one's the grey 223,224,224 of m15/c's bar), so
  // the stamp's notch (TODO 4.9c) is M15's, keyed the same.
  m15snow: {
    ...M15SNOW,
    overlays: [{ ...M15_CROWN, keyMap: { c: "a" } }, M15_HOLO_STAMP],
    twoColorMasters: ["split"],
    collector: M15_COLLECTOR,
  },
  // Devoid draws neither (owner round 20, 2026-10-01, option (i): no crown —
  // the one crowned devoid printing, M3C #4, is the see-through Eldrazi
  // frame with gold bars, not this patterned frame; and no pairs — every
  // two-colour devoid printing, BFZ #199–207, OGW #148–150, MH3 #177 / #204
  // / #206 / #208 and their reprints, prints the UNIFORM gold devoid frame,
  // the `m` master this entry already draws: measured 2026-10-02 on eight of
  // them, the title ring reads gold (R − B 65–119) at every x; the registry
  // imports them exact, lib/scryfall/frame-signatures.ts GOLD_PAIR_TEMPLATES).
  // Every devoid master's bar is the colourless grey (223,224,225), so its
  // stamp notch (TODO 4.9c) is the grey one whatever the card's colour.
  m15devoid: {
    ...M15DEVOID,
    overlays: [{ ...M15_HOLO_STAMP, keyMap: { w: "c", u: "c", b: "c", r: "c", g: "c", m: "c" } }],
    collector: M15_COLLECTOR,
  },
  // CC's colourless planeswalker is see-through like m15/c (body α ≈ 180,
  // a translucent type bar; DOM #1 Karn, M21 #1 Ugin show the art through
  // it): the art runs under the whole frame for "c" (TODO 4.17b, layout v35)
  // as ONE picture — the window drawn in the under-frame rect too. Its body
  // is translucent from the border to the window and has no outline down
  // the ability box, so M15PW's slot (5 px into the silver) and a second,
  // separately cropped layer met in a seam the frame showed all round
  // (x ≈ 100 / 1397, y ≈ 207; the art-window check's seam rule). The window
  // shows ~14 % more of the picture's zoom than on the coloured walkers
  // (a 1959 px cover height, not 1716).
  // …and its collector line through M15's slot (4.9b: DOM #1 prints the
  // lines at M15's positions; the loyalty shield counts as a stat plate —
  // and is part of the master, so the © slot is always on line 2:
  // M15PW_COLLECTOR).
  // …and the stamp's notch through its own piece (M15PW_HOLO_STAMP, 4.9c).
  m15pw: {
    ...M15PW,
    underFrameArt: { rect: UNDER_FRAME_RECT, colors: ["c"], artSlot: UNDER_FRAME_RECT },
    overlays: [M15PW_HOLO_STAMP],
    collector: M15PW_COLLECTOR,
  },
  agclassic: AGCLASSIC,
  alphaland: ALPHALAND,
  alphatoken: ALPHATOKEN,
  // CC's colourless battle frame is see-through (layout v43, TODO 4.21b;
  // owner decision 2026-09-29; MOM #1 Invasion of Ravnica): its name pill,
  // type bar and text box are translucent (α 190–250) from the border down
  // to the bottom border at 1432 px. The art runs under the whole frame for
  // "c" in the LANDSCAPE rect — never the portrait UNDER_FRAME_RECT — and
  // the window draws in the same rect: ONE picture (the full-art window
  // has no outline to hide a second crop's seam on, and the profile's art
  // slot is that rect on every colour already). The art-window check holds
  // the rect to every see-through pixel of the master.
  battle: { ...BATTLE, underFrameArt: { rect: BATTLE_ART_RECT, colors: ["c"], artSlot: BATTLE_ART_RECT } },
  saga: SAGA,
  adventure: ADVENTURE,
  // CC's colourless flip frame is see-through (layout v38, TODO 4.21a; owner
  // decision 2026-09-29): bars at α 191–248, the body between the border and
  // the pinline clear, a 15 px opaque pinline round the window — the art
  // runs under the frame for "c" from the border's inner edge (4.17a's
  // rect), the window's own crop meeting it on that pinline.
  flip: { ...FLIP, underFrameArt: { rect: UNDER_FRAME_RECT, colors: ["c"] } },
  split: SPLIT,
  aftermath: AFTERMATH,
  avatar: AVATAR,
  bloomburrow: BLOOMBURROW,
  // The six near-black picker tiles that are not art-first get the tile's
  // sample art (pickerSampleArt, 4.45) on their entries here, not on their
  // bases: M15TEXTLESS spreads FULLART and M15TEXTLESSLAND spreads
  // M15TEXTLESS, so a flag on a base would reach whatever spreads it next.
  bloomanime: { ...BLOOMANIME, pickerSampleArt: true },
  lotr: LOTR,
  lotrscroll: LOTRSCROLL,
  tarkirdragon: TARKIRDRAGON,
  tarkirdraconic: TARKIRDRACONIC,
  tarkirghostfire: { ...TARKIRGHOSTFIRE, pickerSampleArt: true },
  // The extended-art frame draws the floating crown as an overlay band
  // (TODO 4.6f, wave 2b; EXTENDED_CROWN) — opt-in per card, so no stored
  // card changes (and production holds none on this frame). No pairs: a
  // two-colour legend wears the gold crown.
  extendedart: { ...EXTENDEDART, overlays: [EXTENDED_CROWN] },
  fullart: { ...FULLART, pickerSampleArt: true },
  m15fullartland: M15FULLARTLAND,
  fullartland: FULLARTLAND,
  m15textless: { ...M15TEXTLESS, pickerSampleArt: true },
  m15textlessland: { ...M15TEXTLESSLAND, pickerSampleArt: true },
  expeditionland: EXPEDITIONLAND,
  nyx: { ...NYX, pickerSampleArt: true },
  retro: RETRO,
  retroland: RETROLAND,
  modern: MODERN,
  modernland: MODERNLAND,
};

/** Resolve a frame profile, defaulting to M15 for unknown/legacy templates
 *  (e.g. the retired "regular" placeholder on older saved cards). */
export function getFrameProfile(
  template: FrameTemplate | string | undefined,
): FrameProfile {
  // The registry's m15 entry, not the bare M15 base: legacy templates draw
  // the m15 frame, so they need its CC cost lift and see-through colourless.
  if (!template) return PROFILES.m15;
  return PROFILES[template as FrameTemplate] ?? PROFILES.m15;
}

/** The under-frame art rect for a profile + frame colour key, or null. */
export function underFrameArtRect(profile: FrameProfile, colorKey: string): Rect | null {
  const u = profile.underFrameArt;
  if (!u) return null;
  // A crowned twin (`c-legendary`, 4.6f) is as see-through as its master.
  if (u.colors && !u.colors.includes(baseMasterKey(colorKey))) return null;
  return u.rect;
}

/** A see-through master's own window slot (UnderFrameArt.artSlot) for a
 *  profile + frame colour key, or null (the profile's artSlot paints it). */
export function underFrameArtSlot(profile: FrameProfile, colorKey: string): Rect | null {
  if (!underFrameArtRect(profile, colorKey)) return null;
  return profile.underFrameArt?.artSlot ?? null;
}
