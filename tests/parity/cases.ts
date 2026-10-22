import type { CardRowForBake } from "@/lib/cards/bake-core";
import { visualCases, type VisualCase, type VisualFace } from "../visual/matrix";
import { parityFileName } from "./shared";

// ---------------------------------------------------------------------------
// The preview ⇄ bake parity matrix (TODO 3.11): the cards BOTH renderers draw
// — components/cards/card-preview.tsx in headless Chromium and
// lib/render/card-image.tsx through Satori — and tests/parity compares, at
// 750 px and at HD.
//
// Every case is a row of tests/visual/matrix.ts, taken BY ID (a renamed or
// removed case fails here, so the two harnesses cannot drift apart), a few of
// them with fields laid over the row for what the hash matrix has no reason
// to hold: the prints' symbols in one cost and one rules box, and art away
// from its default position. One case per template FAMILY and per feature
// that has drifted between the renderers before — not every template: the
// hash gate (7.1) already holds every bake still; this suite holds the
// preview to the bake.
//
// Adding a case costs about 3 s of CI. Add one in the PR that adds a new
// rendering feature to both renderers (a new overlay, a new slot, a new
// symbol kind).
// ---------------------------------------------------------------------------

export type ParityCase = {
  /** Stable id (file names, thresholds, the report). */
  id: string;
  /** Which face both renderers draw. */
  face: VisualFace;
  /** The stored row (lib/cards/bake-core.ts rowToPreviewData). */
  row: CardRowForBake;
  /** What the case is there to hold (the report prints it). */
  why: string;
  /** The art both renderers are given instead of the coded PNG (TODO 3.14):
   *  "tagged-jpeg" — a JPEG stored sideways with EXIF Orientation 6, as a
   *  row saved before 3.14 holds it (Chrome turns it; the bake must too);
   *  "uploaded-jpeg" — the same photo through prepareUploadBytes, as every
   *  upload is stored today (upright pixels, no tag). */
  /** "stripes" — a high-contrast picture (TODO 4.27a): black, white and
   *  saturated bars down the whole card, under the station frame's
   *  see-through box — where a blend that differs between the renderers
   *  would show in every band. */
  art?: "tagged-jpeg" | "uploaded-jpeg" | "stripes";
};

type Pick = {
  /** The visual matrix case whose row this is. */
  from: string;
  why: string;
  /** A suffix for the id when the row is changed (`row`). */
  as?: string;
  row?: (row: CardRowForBake) => Partial<CardRowForBake>;
  art?: ParityCase["art"];
};

/** Every symbol kind lib/cards/mana-gem.ts draws its own way (layout v49),
 *  in ONE cost: a generic, X, a hybrid, a two-generic hybrid, a Phyrexian
 *  (×1.2 disc), a two-colour Phyrexian, snow, colourless and a colour. */
const SYMBOL_COST = "{X}{2}{W/U}{2/B}{R/P}{G/U/P}{S}{C}{G}";
/** …and in rules text: tap, untap, energy (no disc), the same hybrids and
 *  Phyrexian symbols inline, a loyalty-free plain line and a dash. */
const SYMBOL_RULES =
  "{T}, {Q}: Add {W/U}{2/B} or {R/P}{G/U/P}. You get {E}{E}.\n{S}{C}, {T}: Draw a card — then discard a card unless you pay {X}{G}.\nFlying, trample";

const PICKS: readonly Pick[] = [
  // --- M15 and its symbols -------------------------------------------------
  { from: "m15/b/creature-edge", why: "100/100, a four-mode Command, reversed-hybrid and unknown symbols" },
  {
    from: "m15/g/creature-long",
    as: "@symbols",
    why: "a nine-pip cost and every symbol kind in cost and rules (v49)",
    row: () => ({ cost: SYMBOL_COST, rules_text: SYMBOL_RULES, flavor_text: null }),
  },
  { from: "m15/c/creature-long", why: "the see-through colourless master: art under the frame" },
  { from: "m15/w/creature-long@centred", why: "centred rules (held lines, per-line indents)" },
  { from: "m15/g/creature-long@collector", why: "the collector line and the © slot's mark" },
  { from: "m15/wu/creature-long@stamp-pair-crown", why: "crown + holofoil stamp + the two-colour pair, one card" },
  // --- the nickname (TODO 6.3): the plate, its rim and the name on it -------
  { from: "m15/g/creature-long@nickname", why: "the nickname in the title bar, the name on its plate (a long name)" },
  { from: "m15/wu/creature-short@nickname-pair", why: "the nickname plate's rim in the pair's two colours" },
  { from: "m15land/c/land-short@nickname", why: "the nickname plate on the land frame (the land grey)" },
  // --- CARDNAME / ~ (TODO 6.2): substituted before either layout -----------
  { from: "m15/g/creature-short@selfname-nickname", why: "~ and CARDNAME drawn as the nickname, laid out by both renderers" },
  { from: "m15/r/creature-short@foil", why: "foil: the sheen and its art mask" },
  { from: "m15/u/creature-long@etched", why: "etched: the frame-only sheen" },
  // --- the Vehicle frame (TODO 4.5c): its own plate, white digits -----------
  { from: "m15vehicle/c/artifact-short@wide", why: "Vehicle: the brown plate under white digits at their widest (12/12), the bronze frame" },
  { from: "m15vehicle/wu/artifact-long@pair-crown", why: "Vehicle: the two-colour pair master and the crown over the bronze frame" },
  // --- the Nyx dress (TODO 4.7): the starfield masters, their own crown band --
  { from: "m15nyx/w/creature-short", why: "Nyx: the starfield master under M15's slots and plate" },
  { from: "m15nyx/wu/creature-long@pair-crown", why: "Nyx: the two-colour pair master and the Nyx crown band (the starfield strip inside the crown)" },
  // --- the Nyx Constellation frame's crown (owner 2026-10-13) ---------------
  {
    from: "nyx/g/creature-long@crown",
    as: "@three-pips",
    // A three-pip cost: the long card's five-pip row is the M15 cost row's
    // own 750 px difference ("750-cost-row-width", struck at layout v61), not this frame's.
    why: "Nyx Constellation: the crown band over the MSE starfield master, its arms faded into the master's rim, light ink on the translucent bars",
    row: () => ({ cost: "{2}{G}" }),
  },
  // --- Beleren's ligatures: ffi and ffl, all its GSUB 'liga' holds ----------
  // A browser sets them by default on a line with no letter-spacing (M15's
  // type line; its name is tracked 0.01 em, which switches them off by
  // itself); Satori never forms one, so the preview switches them off
  // (font-variant-ligatures: none on CardPreview's root). Found by the
  // independent check of #542 on "Enchantment Creature — Griffin" (a worst
  // HD tile of 75.5 against 65, then a known difference; "Shuffler" measured
  // 82). These two cases fail again if the preview ever forms either.
  {
    from: "m15/w/creature-short",
    as: "@ffi-ligature",
    why: "a type line with \"ffi\" (Griffin): the preview sets f, f, i as the bake does, never Beleren's ffi ligature",
    row: () => ({ supertype: "Enchantment", subtypes: ["Griffin"] }),
  },
  {
    from: "m15/w/creature-short",
    as: "@ffl-ligature",
    why: "a type line with \"ffl\" (Shuffler), and a name with it twice (Baffling Scuffle): the preview sets f, f, l as the bake does, never Beleren's ffl ligature",
    row: () => ({ title: "Baffling Scuffle", subtypes: ["Shuffler"] }),
  },
  // --- the station frame (TODO 4.27a): stacked translucency, drawn pieces ---
  {
    from: "m15station/u/artifact-short",
    as: "@stripes",
    why: "station: the see-through box and two tier washes over black / white / saturated bars (blue key), badges, the plate",
    art: "stripes",
    row: () => ({}),
  },
  {
    from: "m15station/r/artifact-short@tiers-three",
    as: "@stripes",
    why: "station: three tiers (0.25 / 0.57 / 0.78) over the bars on the red key, the plate on the middle tier",
    art: "stripes",
    row: () => ({}),
  },
  { from: "m15station/u/artifact-short@tiers-one", why: "station: one tier, the plate and the reminder's top band over the coded picture" },
  {
    from: "m15station/g/artifact-long@crown",
    as: "@full-box",
    // A three-pip cost: the long card's five-pip row is the M15 cost row's
    // own 750 px difference ("750-cost-row-width", struck at layout v61), not this frame's.
    why: "station: the crown over the cut master, a fuller box (a two-paragraph plated tier, 10/10 on the plate)",
    row: () => ({ cost: "{2}{G}" }),
  },
  { from: "m15station/r/artifact-short@foil", why: "station: the foil sheen over the box, the bands and the drawn pieces — ink above it" },
  { from: "m15stationland/g/land-short", why: "station: a Planet — the land master, one tier, no plate" },
  // --- its Spacecraft dresses (TODO 4.27a step 2) ----------------------------
  // (The coded picture, not the stripes: on this frame's 1500 px wide picture
  // the stripes are cropped top and bottom, and the art region's shift
  // estimate aliases on their period — dy −3 at HD with the pixels agreeing,
  // mean difference 1.0. The box over the stripes is m15station's case: the
  // same master pixels from row 1320 down.)
  {
    from: "extendedartstation/u/artifact-short",
    why: "extended-art station: the art to the side edges, the see-through box and two tier washes over the coded picture, the black type bar's white ink",
  },
  { from: "extendedartstation/w/artifact-long@crown", why: "extended-art station: the extended-art crown band over the cut master, a fuller box" },
  {
    from: "m15borderlessstation/r/artifact-short@tiers-three",
    as: "@stripes",
    why: "borderless station: the floating bars, the station box swapped in, three tiers over the bars, the plate on the middle tier",
    art: "stripes",
    row: () => ({}),
  },
  { from: "m15borderlessstation/wub/artifact-long@crown", why: "borderless station: the crowned twin (its key `m-legendary`: the bands in gold), white title ink" },
  // --- the Universes Beyond frames (TODO 4.25): the triangle stamp ----------
  { from: "m15ub/wu/creature-long@stamp-pair-crown", why: "Universes Beyond: the triangle stamp's notch and art (a new shape in both renderers), the pair master and the split crown band" },
  { from: "m15ub/g/creature-short@wide", why: "Universes Beyond: the pack's own plate under 12/12" },
  // --- art away from its default position (a coded picture) ----------------
  {
    from: "m15/r/creature-short",
    as: "@art-zero",
    why: "focal exactly 0 with zoom (#506): the art's left edge on the window's",
    row: () => ({ art_position: { focalX: 0, focalY: 0.3, scale: 1.3 } }),
  },
  {
    from: "m15/r/creature-short",
    as: "@art-zoom",
    why: "an off-centre focal point at zoom 1.6",
    row: () => ({ art_position: { focalX: 0.8, focalY: 0.2, scale: 1.6 } }),
  },
  {
    from: "m15/r/creature-short",
    as: "@art-zoom-3",
    why: "zoom 3 about the centre: the zoomed art's offset (3.37) where it is largest in the matrix",
    row: () => ({ art_position: { focalX: 0.5, focalY: 0.5, scale: 3 } }),
  },
  // --- an EXIF-turned photo as art (TODO 3.14) ------------------------------
  {
    from: "m15/r/creature-short",
    as: "@exif6-stored",
    why: "an orientation-6 JPEG as stored before 3.14: Chrome obeys the tag, the bake follows",
    art: "tagged-jpeg",
    row: () => ({ art_position: { focalX: 0.3, focalY: 0.4, scale: 1.2 } }),
  },
  {
    from: "m15/r/creature-short",
    as: "@exif6-upload",
    why: "the same photo through prepareUploadBytes: both renderers read the uprighted bytes",
    art: "uploaded-jpeg",
    row: () => ({ art_position: { focalX: 0.3, focalY: 0.4, scale: 1.2 } }),
  },
  // --- the other bodies ----------------------------------------------------
  { from: "m15pw/g/planeswalker-long", why: "walker: loyalty rows, badges, the shield" },
  { from: "saga/g/saga-long", why: "saga: the rail, chapter badges, the reminder block" },
  { from: "split/r/split-long", why: "split: two turned halves (landscape master)" },
  { from: "aftermath/b/aftermath-long", why: "aftermath: the turned second half and its art" },
  { from: "adventure/g/adventure-long", why: "adventure: the inline page" },
  // The Prepare frame (TODO 4.27): the adventure's page anatomy on its own
  // rects — the spell's page on the RIGHT, white ink on its bars, the
  // creature's rules in the left box.
  { from: "prepare/r/prepare-short", why: "prepare: the spell's page on the right (name, cost and type on its bars, rules in its box), the creature's box on the left" },
  { from: "prepare/b/prepare-long", why: "prepare: a long name before the page's pips, two full boxes" },
  { from: "prepare/wub/prepare-long@crown", why: "prepare: M15's crown over the Prepare master, gold" },
  // Each part in its own colour (TODO 4.26): the page overlay in the
  // spell's colour over the creature's master, the two-colour Prepare's pair
  // master under a hybrid page, and the seam on split (vertical) and
  // aftermath (horizontal).
  { from: "prepare/r/prepare-short@part-u", why: "part colour: the spell's blue page over a red Prepare master (the page overlay)" },
  { from: "prepare/w/prepare-short@part-gw-h", why: "part colour: a hybrid spell's grey page, its box ramped green → white" },
  { from: "prepare/wu/prepare-long@pair-part-hybrid", why: "part colour: the two-colour Prepare (its pair master, the crown) under a hybrid page" },
  { from: "split/r/split-long@part-u-hd", why: "part colour: split's right half in its own colour, a vertical seam (the long card: the short split's turned footer sits 3 px off at 750 on main already)" },
  { from: "aftermath/r/aftermath-short@part-b", why: "part colour: aftermath's lower part in its own colour, a horizontal seam" },
  // …and the adventure's storybook page in its spell's colour (owner
  // decision 2026-10-22: the pre-cut `adventure/page/<key>` through the
  // same partPage slot — WOE #221's red page beside a black frame).
  { from: "adventure/b/adventure-short@part-r", why: "part colour: the adventure spell's red page over a black master (the page overlay, bookLeft's soft edge)" },
  // …and owner decision M2 (N3): the card's colour the WHOLE card's (gold),
  // its first half's on frame_style.firstPartColor — the left half red from
  // it, the right blue (the long split: the short one's turned footer is
  // 3 px off at 750 on main already, TODO 3.37 (c)).
  {
    from: "split/r/split-long@part-u-hd",
    as: "@first-part",
    why: "part colour (M2): a gold card's first half from firstPartColor, red | blue",
    row: (row) => ({ color_identity: ["multicolor"], frame_style: { ...(row.frame_style as Record<string, unknown>), firstPartColor: ["red"] } as never }),
  },
  { from: "flip/u/flip-long", why: "flip: the upside-down second face" },
  { from: "battle/g/battle-long", why: "battle: landscape, the painted defense shield, the turned credit" },
  { from: "m15dfcfront/g/transform-long", why: "transform front: icon rider, reverse P/T float" },
  { from: "m15dfcback/g/transform-long", why: "transform back: its own body, through the flip" },
  { from: "battle/w/battle-short@back", why: "battle with a back of its own (5.5): the back's P/T in the master's tab, a rules float" },
  { from: "m15dfcback/b/battle-long@crown-battle", why: "a battle's back (5.5): the portrait ▼ back behind a landscape front, its legendary crown" },
  { from: "sagadfcfront/g/saga-long@fan", why: "double-faced saga front (5.5 (b)): the fan rider, the rail ending at the tab, the back's P/T left-aligned in it" },
  { from: "sagadfcfront/r/saga-short@fan-wide-pt", why: "double-faced saga front (5.5 (b)): a two-digit reverse P/T left-aligned at the tab" },
  { from: "sagadfcback/u/transform-short", why: "double-faced saga back (5.5 (b) PR 2): the saga rail from plain text under the ▼ back's white name and type line, the colour dot on the saga's type row" },
  { from: "sagadfcback/wub/transform-long", why: "double-faced saga back (5.5 (b) PR 2): four chapters, a long name before the well, the dot in three wedges" },
  { from: "m15mdfcfront/w/mdfc-long@strip-u", why: "modal front: the flipside strip in the other face's colour" },
  { from: "m15mdfcback/g/mdfc-long", why: "modal back: the strip on a back, through the flip" },
  // The borderless double-faced bodies (TODO 5.7): the grafted masters'
  // crowned twin under the borderless rider (6 px right, × 0.95) and the
  // borderless reverse P/T; the ▼ back's indicator and white ink; the modal
  // pair's split pinline with the floating crown and the strip's texts.
  { from: "m15borderlessdfcfront/r/transform-long@crown", why: "borderless transform front: the crowned twin, the moved rider, the borderless reverse P/T" },
  { from: "m15borderlessdfcback/u/transform-long", why: "borderless transform back: the ▼ well in the master, the indicator, white ink on the dark bars" },
  { from: "m15borderlessmdfcfront/wu/mdfc-long@pair-crown", why: "borderless modal front: the split pinline's crowned twin, the housing, the strip's white texts" },
  { from: "m15borderlessmdfcback/g/mdfc-long", why: "borderless modal back: its own cost, the light strip's dark texts, through the flip" },
  { from: "m15tokentext/g/token-long", why: "token with a text box" },
  // Double-sided tokens (TODO 5.5 (c)): the back on its own token template
  // and colour, in the front's design — through the flip.
  { from: "m15tokentext/w/token-short@two-sided", why: "double-sided token (5.5 (c)): the back on its own arch token template and colour, through the flip" },
  { from: "m20tokenartifacttext/c/token-short@two-sided", why: "double-sided token (5.5 (c)): a full-art artifact token's back behind a red full-art front, through the flip" },
  // The arch's tall box (TODO 4.55): the pill, the symbol and the type line
  // 238 px up, the taller box's rules centred clear of the plate — and its
  // artifact dress (a Clue's silver frame).
  { from: "m15tokentall/w/token-long", why: "4.55: the arch token's tall text box — the moved pill, the taller box" },
  { from: "m15tokenartifacttall/c/token-short", why: "4.55: the tall box's artifact dress (a Clue's silver frame)" },
  // The arch token's gold small-caps name (TODO 4.53, v59): the runs on one
  // baseline, a word gap, the see-through c's own art slot; and a name all
  // in lower case — every run small, each lifted onto the full-size baseline.
  {
    from: "m15token/c/token-long",
    as: "@small-caps",
    why: "4.53: two words in synthesized small caps, the see-through c's own window slot",
    row: () => ({ title: "Eldrazi Scion" }),
  },
  {
    from: "m15tokenartifact/u/token-long",
    as: "@small-caps-lower",
    why: "4.53: a name typed all in lower case — every run small, lifted onto the full-size baseline",
    row: () => ({ title: "thopter" }),
  },
  // The kerning (owner Round 65): a pair kerned inside a run ("-W", −0.198
  // em), the capital → small pair across runs (W·A, V·A: −0.22 em at the
  // small size, a negative margin in both renderers), a capital the line
  // tables don't list (Æ).
  {
    from: "m15tokentext/w/token-long",
    as: "@small-caps-kerned",
    why: "4.53: kerned runs and the capital→small pair across runs (a negative margin), Æ's own advance",
    row: () => ({ title: "Æther Vampire Long-Winded" }),
  },
  { from: "m20tokentall/g/token-long", why: "M20 token, tall box (squeezed paragraph gaps)" },
  // TODO 4.48's last pieces: the full-art token's floating crown band and
  // its two-colour pair master with the grey colourless plate.
  { from: "m20token/u/token-short@crown", why: "4.48: the full-art token's floating crown round the name pill (a Legendary token)" },
  { from: "m20tokentext/wu/token-short@pair-crown", why: "4.48: a crowned two-colour token — the pair master, the pair's crown, the grey plate" },
  { from: "m20tokenartifact/c/token-short@crown", why: "4.48: the artifact template's colourless crown, CC's silver A (keyMap c → a)" },
  { from: "m20tokennyx/w/token-short@token-nyx", why: "4.51: the Nyx dress — the starfield in a white name pill, dark name ink (TDSK #4 Glimmer)" },
  { from: "m20tokennyxtext/w/token-short@token-nyx-aura", why: "4.51: the Nyx dress at the regular box, an Aura with no P/T (TSOC #3 Contract)" },
  { from: "m20tokenartifactnyx/c/token-short@token-nyx-artifact", why: "4.51: the artifact Nyx dress — the starry slate pill (TEOC #13 Golem)" },
  { from: "emblem/g/emblem-long", why: "emblem: the toned master, the walker's name, no cost or stats" },
  // 3.24's cases, by name — the Zendikar split type line since 4.40, the
  // first profile to use `type.split`.
  { from: "fullartland/w/land-short", why: "3.24: the full-art Plains — the basic symbol disc, footer on the art" },
  { from: "m15fullartlandzen/w/land-short", why: "3.24 / 4.40: the Zendikar split type line — \"Basic Land\" left, the subtype centred right — and the medallion's symbol" },
  { from: "m15fullartlandsnc/u/land-short", why: "4.40: the split bar and the medallion moved apart onto SNC's prints (the symbol box rides the medallion)" },
  { from: "m15fullartlandthb/g/land-short", why: "4.41: the plain bar — a basic's symbol slot that draws nothing, no watermark on the art" },
  { from: "m15land/w/land-short", why: "3.24: the m15land Plains — its watermark, unchanged by the disc slot" },
  { from: "m15textless/g/creature-long", why: "3.24: a textless creature — rules kept in the data, hidden in both renderers" },
  // The extended-art frame from Card Conjurer (TODO 4.7, layout v58).
  { from: "extendedart/w/creature-long@crown", why: "v58 extended art: the window to the side edges, white type ink + keyline, the crown at CC's bounds" },
  { from: "extendedart/c/creature-long", why: "v58 extended art: the see-through colourless master, the art under it as one picture" },
  { from: "extendedart/c/artifact-short", why: "v58 extended art: a colourless artifact paints the silver `a` master (artifactMasterKeys)" },
  // Its follow-ups (owner Round 63): the two-colour pair and the textless crown.
  { from: "extendedart/wu/creature-long@pair-crown", why: "extended art: the gold-split pair master and the split floating crown (4.7 follow-up)" },
  { from: "m15textless/u/creature-long@crown", why: "textless promo: the standard crown band over the promo master (4.35 follow-up)" },
  // The Lord of the Rings scroll from Card Conjurer (TODO 4.11, layout v62).
  { from: "lotrscroll/w/creature-long@crown", why: "v62 LOTR scroll: CC's 'Scroll' master, the M15 pack's slots on the scroll, its own crown band, the scroll plate" },
  { from: "lotrscroll/c/artifact-long@stamp-c", why: "v62 LOTR scroll: the pack's own triangle notch per key over the `a` master, the matte or silver triangle art in its cut" },
  { from: "m15borderless/b/creature-long", why: "borderless: art to the edge, white ink, the keylined set symbol" },
  // --- the borderless stamp and collector line (TODO 4.9d) -----------------
  { from: "m15borderless/r/creature-long@stamp-collector-hd", why: "borderless: the lifted-pinline arch, the oval over the black, the collector line with the mark on line 2 beside the plate" },
  { from: "m15borderless/b/instant-short@stamp-collector-2015", why: "borderless: the 2015 style's letter column and, with no plate, the mark on line 1 beside the arch" },
  { from: "m15borderlessland/wu/land-short@stamp-pair-split", why: "borderless land: the pair's own piece (the box and pinline split across the ramp) under the stamp" },
  { from: "m15borderlessstation/u/artifact-short@stamp", why: "borderless station: the arch over the station box, the tier washes over it as on m15station" },
  // --- the borderless walkers' stamp and collector line (TODO 4.9d, owner Round 70)
  { from: "m15borderlesspw/u/planeswalker-long@stamp-arch", why: "borderless walker: the window's arch drawn ABOVE the rows, the last row's text held up over it (its bottom padding)" },
  { from: "m15borderlesspw/r/planeswalker-long@stamp-collector-hd", why: "borderless walker: the arch, the oval and the collector line with the mark on line 2 beside the shield" },
  { from: "m15borderlesspwtall/r/planeswalker-long@stamp-hd", why: "tall borderless walker: the same piece under the tall window's four rows" },
  { from: "m15borderlesspw/w/planeswalker-short@stamp-foil", why: "borderless walker foil: the notch's own sheen over the stripes' (as a plate's)" },
  { from: "m15borderlesspw/g/planeswalker-short@stamp-etched", why: "borderless walker etched: the frame's hatch over the notch drawn above the rows (owner Round 72)" },
  // --- the old frames (era symbol styles, footers, © slots) ----------------
  { from: "agclassic/g/creature-long", why: "1993: image pips, the Illus. line, right-set P/T" },
  { from: "retro/r/creature-long", why: "1997: shadowed white ink, flat discs, centred © slot" },
  { from: "modern/g/creature-long", why: "2003: shadowed cost discs, the brush, two-line footer" },
  { from: "modern/wu/creature-short@pair", why: "the synthesised old-frame pair master" },
  // --- a name fitted against a DETACHED cost of ×1.2 discs (TODO 6.16d, v52) -
  // The walker's twin (TODO 3.37): at 750 px its row of five ×1.2 discs is
  // the widest cost row of the matrix; the two renderers disagreed about it
  // by more than a limit (the "750-walker-phyrexian-cost" known differences,
  // struck at layout v61, whose 70 px disc is a whole 35 px at 750).
  { from: "m15pw/w/planeswalker-long@phyrexian-cost-5", why: "v52: a long name's room before five Phyrexian discs in the walker's detached cost (and 3.37's cost-row difference at its largest)" },
  { from: "m15/u/creature-short@large-pips-hd", why: "v53: the large pips on the M15 frame — a hybrid, a twobrid and a Phyrexian disc at 88 px in the cost, 77 px in rules text" },
  { from: "modern/u/creature-short@large-pips-hd", why: "v53: the large pips on the 2003 frame — 85 px discs in a detached cost, ×1.28 in rules text" },
  { from: "retro/u/creature-short@large-pips-hd", why: "v53: the large pips on the 1997 frame — ×1.2 kept in the cost, ×1.28 in rules text, flat discs" },
  { from: "modern/w/creature-long@phyrexian-cost-5", why: "v52: a long name's room before five Phyrexian discs in a detached cost (2003 frame)" },
];

export { parityFileName };

/** The matrix, in order. Throws when a pick names no visual case. */
export function parityCases(): ParityCase[] {
  const byId = new Map<string, VisualCase>(visualCases().map((c) => [c.id, c]));
  const out: ParityCase[] = [];
  const seen = new Set<string>();
  for (const pick of PICKS) {
    const source = byId.get(pick.from);
    if (!source) throw new Error(`tests/parity/cases.ts: no visual case "${pick.from}" in tests/visual/matrix.ts`);
    if (pick.row && !pick.as) throw new Error(`tests/parity/cases.ts: "${pick.from}" changes its row — give it an "as" suffix`);
    const id = `${pick.from}${pick.as ?? ""}`;
    if (seen.has(id)) throw new Error(`tests/parity/cases.ts: duplicate case "${id}"`);
    seen.add(id);
    out.push({
      id,
      face: source.face,
      row: { ...source.row, ...(pick.row ? pick.row(source.row) : {}) },
      why: pick.why,
      ...(pick.art ? { art: pick.art } : {}),
    });
  }
  return out;
}
