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

/** DTK #224 Kolaghan's Command's Oracle text (TODO 3.16's acceptance case):
 *  "Choose two —" and four bullet modes, two of them two lines. */
const KOLAGHANS_COMMAND =
  "Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• Kolaghan’s Command deals 2 damage to any target.";

const PICKS: readonly Pick[] = [
  // --- M15 and its symbols -------------------------------------------------
  { from: "m15/b/creature-edge", why: "100/100, a four-mode Command, reversed-hybrid and unknown symbols" },
  {
    from: "m15/r/creature-long",
    as: "@command",
    why: "a four-mode Command (DTK #224): its modes hung where their first word starts, the bullet gap apart, and the flavour bar under them — 96 % of the column, faded ends (3.16 / 3.19, v74)",
    row: () => ({ rules_text: KOLAGHANS_COMMAND, flavor_text: "“Hesitation is a sign of weakness.”\n—Kolaghan" }),
  },
  {
    from: "m15/g/creature-long",
    as: "@symbols",
    why: "a nine-pip cost and every symbol kind in cost and rules (v49)",
    row: () => ({ cost: SYMBOL_COST, rules_text: SYMBOL_RULES, flavor_text: null }),
  },
  { from: "m15/c/creature-long", why: "the see-through colourless master: art under the frame" },
  { from: "m15/w/creature-long@centred", why: "centred rules (held lines, per-line indents)" },
  {
    from: "m15/g/creature-long@flavor-upright",
    why: "flavour's upright *…* spans: roman words inside the italic, glued pieces of a word, no stars (v71)",
  },
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
    why: "Nyx Constellation: the crown band over the starfield master (Card Conjurer's 'Nyx Showcase' since 4.17f), its arms faded into the master's rim, light ink on the translucent bars",
    row: () => ({ cost: "{2}{G}" }),
  },
  // The constellation's text on its prints (TODO 4.11, layout v66): the
  // five-pip row at the CC-framed family's 70 px disc and 78 px pitch, the
  // name 2 px up, the type band (line + inline set symbol) 10 px down.
  { from: "nyx/u/creature-long", why: "v66 Nyx Constellation: the 70 px cost row on print's, the name on its baseline, the type line and set symbol low in their bar" },
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
  // The Prepare frame's stamp, collector line and extended-art dress (TODO
  // 4.27b): the lifted-foot notch over the creature's box and the strip, the
  // hybrid dress's own piece, the collector line beside the plate, and the
  // extended-art dress (the extended-art top over the Prepare master's lower
  // half) with its page in another colour.
  { from: "prepare/g/prepare-long@stamp-collector-hd", why: "prepare: the lifted-foot arch across the box and the strip, the oval, the collector line with the mark on line 2 beside the plate" },
  { from: "prepare/wu/prepare-short@stamp-pair-hybrid", why: "prepare: the hybrid pair master's own notch piece (its strip under the arch's edge)" },
  // (At the default size, as extended art's own cases: at HD the art
  // region's shift estimate reads the full-width coded picture 3 px off with
  // the pixels agreeing, as on the Spacecraft's extended-art dress.)
  { from: "extendedartprepare/u/prepare-short@stamp", why: "extended-art prepare: the art to the side edges, the black type bar's white ink, the Prepare page and the same notch" },
  { from: "extendedartprepare/u/prepare-short@collector-2015", why: "extended-art prepare: the 2015 collector line under the Prepare page, the mark beside the plate" },
  { from: "extendedartprepare/r/prepare-short@part-u", why: "extended-art prepare: the spell's blue page overlay over the red dress" },
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
  // The Lord of the Rings ring from Card Conjurer (TODO 4.11, layout v65).
  { from: "lotr/w/creature-long@crown", why: "v65 LOTR ring: CC's 'Ring' master, the M15 pack's slots under its lower title bar (the cost row centred on it), its scalloped crown band, the ring plate with its digits on the face" },
  // The MUL Tarkir dragon wings from Card Conjurer (TODO 4.11, layout v67).
  { from: "tarkirdragon/wu/creature-long@crown", why: "v67 MUL Tarkir: CC's 'Tarkir' masters split at the seam, the M15 pack's slots on the pack's own bars (name and cost row 7 px up, the type band 4.5 px up and 5 px left), the pair's ramped crown band over the halves, the gold plate with its digits on the face" },
  // The Tarkir: Dragonstorm showcases on their MSE masters (TODO 4.11 / 4.35, layout v68).
  { from: "tarkirdraconic/u/creature-short@stamp", why: "v68 Tarkir draconic: the black border painted under the MSE master, M15's slots at the family's sizes, the CC M15 cost row, the serpent plate, MSE's own oval notch with our oval" },
  { from: "tarkirghostfire/g/creature-long@collector", why: "v68 Tarkir ghostfire: the painted black ring and footer, its own bars at the family's sizes (the name and type line measured), the 70 px disc, the art inside the ring, the collector line on the footer" },
  // The Avatar elemental and Bloomburrow woodland showcases on their MSE masters (TODO 4.11 / 4.35, layout v69).
  { from: "avatar/g/creature-long@collector", why: "v69 Avatar elemental: MSE's title bar and the black footer built into the master, M15's slots at the family's sizes in white, the CC M15 cost row, art from the top edge, MSE's plate, the collector line on the footer" },
  { from: "bloomburrow/g/creature-long@crown", why: "v69 Bloomburrow woodland: the footer in the colour's own tone, M15's slots in white, the art across the card, MSE's crown band (opt-in)" },
  { from: "bloomburrow/u/creature-short@stamp", why: "v69 Bloomburrow woodland: MSE's own stamp notch with its rim per colour and our oval in its well, MSE's plate" },
  // The Bloomburrow anime on one MSE master in print's look (TODO 4.11 / 4.35, layout v70).
  { from: "bloomanime/g/creature-long@crown", why: "v70 Bloomburrow anime: the strokes in print's flat tone, the slate name and text boxes at print's opacity over full-bleed art, its own layout on M15's slots in white, the CC M15 disc on print's row, MSE's flourish (opt-in)" },
  { from: "bloomanime/u/creature-short@stamp", why: "v70 Bloomburrow anime: the footer in print's tone, MSE's P/T outline as the plate, MSE's stamp notch on the footer's well with our oval" },
  // The New Capenna Art Deco showcase from Card Conjurer (TODO 4.11 wave 2, an addition).
  { from: "sncartdeco/wub/creature-long@stamp-crown", why: "New Capenna Art Deco: CC's 'Golden Age' gold toned onto print, the art under the translucent bars and box (underFrameArt) beside the window's own layer, the crowned twin (the arch), our lifted-rim notch with our oval, white ink, the CC M15 row 8 px lower" },
  { from: "sncartdeco/u/creature-short@collector-2015", why: "New Capenna Art Deco: one gold master under a mono colour key, the pack's plate with white digits, the name 1 px up and the type line 4.5 px under the CC baseline, M15's collector line" },
  // The Enchanting Tales showcase from Card Conjurer (TODO 4.11 wave 2, an addition).
  { from: "enchantingtales/u/enchantment-long@stamp", why: "Enchanting Tales: the art under the whole frame and its translucent box, white rules in CC's rect 3 px up with the moved lower block, the name riding the pack's bar, the CC M15 row 3 px right, the pack's oval notch per colour with our oval and no black ring" },
  { from: "enchantingtales/g/creature-long@collector", why: "Enchanting Tales: the matrix's creature row (its primary kind; the renderers draw any card — the kind gate keeps the frame to Enchantment Creatures) on the pack's plate (3 px up), the 2023 collector line on the run's rows (1990 / 2029) in the colour's footer" },
  // The Zendikar Rising hedron showcase from Card Conjurer (TODO 4.11, layout v63).
  { from: "fullart/w/creature-short", why: "v63 ZNR hedron: black name and type ink on the white key's ivory bars, the art under the whole frame, the light plate's dark digits" },
  { from: "fullart/wu/creature-long@crown", why: "v63 ZNR hedron: white ink with its shadow on the gold bars, the pair's split crown band over the gold master (pairCrownOnGold)" },
  { from: "fullart/u/creature-short@stamp", why: "v63 ZNR hedron: the notch split off CC's master drawn back over the plain one, our oval in its cut, white digits on the blue plate" },
  // The Expeditions from Card Conjurer (TODO 4.11 wave 1, layout v64).
  { from: "expeditionland/g/land-long@collector", why: "v64 Expedition (ZNE): the art under the light rules panel, dark ink, the re-cut bars (the type band on 1805), the set symbol's own box, the collector line on ZNE's rows" },
  { from: "expeditionlandbfz/u/land-short@collector-2015", why: "2015 Expedition (EXP): the panel under the arched window, the 2015 collector line 6.5 px above M15's rows" },
  // The D&D Sourcebook showcase from Card Conjurer (TODO 4.11 wave 2, an addition).
  { from: "dndsourcebook/u/creature-short@collector-2015", why: "D&D Sourcebook: CC's one parchment master under every key, M15's slots on the page's own lines (the name 1.5 px up, the cost row 3 px up and 10 px right, the type band 7 px down), the rules box ending above the page's rounded foot, the parchment plate, the 2015 collector line 4 px below M15's rows" },
  { from: "dndsourcebook/wub/creature-long@stamp-m", why: "D&D Sourcebook: the pack's one oval notch over the page's foot with our oval in its cut, a three-colour legend on the one page" },
  // The MKM dossier showcase from Card Conjurer (TODO 4.11 wave 2, an addition).
  { from: "dossier/u/creature-short@collector-2015", why: "MKM dossier: CC's folder masters downscaled once, M15's slots on the folder's bands (the name 2 px up, the cost row 38 px in from the clip and 19 px down, the set symbol 17 px left, the type line 4 px down), the paper tag, the collector line 4–5 px above M15's rows" },
  { from: "dossier/wu/creature-long@pair-crown", why: "MKM dossier: a two-colour legend — the pair master lerped across print's ramp under the crown band's lerped pair" },
  // The Strixhaven Mystical Archive from Card Conjurer (TODO 4.11 wave 2, an addition).
  { from: "mysticalarchive/r/instant-long@stamp", why: "Mystical Archive: CC's 2010 px masters downscaled once and toned onto print, the art under the frame edge to edge, M15's slots on the run's own lines (the name 5 px up, the cost row 6 px up and 4 px right, the type line 1 px down, the rules block 3 px up), our own black arch with the oval in its cut" },
  { from: "mysticalarchive/wu/instant-long@pair", why: "Mystical Archive: the pair master on an instant — the gold frame with the two colours' lines split right of centre — the type pen 5 px left, the set symbol on M15's box" },
  // The Dominaria United Stained Glass showcase from Card Conjurer (TODO 4.11 wave 2, an addition).
  { from: "stainedglass/u/creature-short@collector-2015", why: "Stained Glass: CC's leaded-glass master (the arch split off: the box's foot straight), M15's slots on the pack's bars (the name 4.5 px up, the cost row 1 px up and 9.5 px right, the type line 1 px down), the box 8.5 px shorter at each end, white ink, the pack's plate, the 2015 collector line 4 px below M15's rows" },
  { from: "stainedglass/wu/creature-long@pair-crown", why: "Stained Glass: the pair master (gold frame, the box split across 46→57 %W) under the pair's crown (the gold dome split across 47→53 %W)" },
  { from: "stainedglass/wub/creature-long@stamp-m", why: "Stained Glass: the arch split off the gold master, laid back over its straight foot, our oval in its cut" },
  // The Doctor Who TARDIS showcase from Card Conjurer (TODO 4.11 wave 2, an addition).
  { from: "tardis/u/creature-short@collector-2015", why: "Doctor Who TARDIS: CC's police-box masters with the brace drawn in, white ink on M15's slots on the pack's bars (the name 3 px up, the cost row 4 px down, the type line 2 px down, the set symbol centred in the ring), the pack's P/T box, the collector line 6 / 5 px above M15's rows" },
  { from: "tardis/wub/creature-long@stamp-m", why: "Doctor Who TARDIS: the pack's trapezoid notch with our triangle in the Universes Beyond hole, a three-colour legend on the gold master" },
  // The OTJ Breaking News showcase from Card Conjurer (TODO 4.11 wave 2, an addition).
  { from: "breakingnews/u/creature-short@collector-2015", why: "OTJ Breaking News: CC's page masters downscaled once, the name CENTRED in capitals on its own band under the masthead, the cost in a box of its own in the masthead (off the name's rows: the name keeps its band), the type line in capitals, the set symbol in its box, the page's rules box, the P/T box, the collector line in the charcoal strip" },
  { from: "breakingnews/wu/creature-long@pair-crown", why: "OTJ Breaking News: a two-colour legend — the pair master lerped across print's split under the crown band's lerped pair (the notched rule at the page's top); its five-pip cost slides right to the masthead's end, the chevron's paper piece over the chevron (lib/cards/masthead.ts)" },
  { from: "breakingnews/wub/sorcery-short@masthead-shift-foil", why: "OTJ Breaking News: the seven-pip masthead under the foil — both pieces inside the finish mask, the paper clipped to its window, so the sheen follows the slid wordmark in both renderers" },
  { from: "breakingnews/wub/sorcery-short@masthead-shift-etched", why: "OTJ Breaking News: the seven-pip masthead etched — the same pieces and window in the etched mask" },
  { from: "breakingnews/wub/sorcery-short@masthead-shift", why: "OTJ Breaking News: a seven-pip cost — the row slid right, the wordmark piece slid 156 px left over the cut icon box and the paper piece in a window that follows it (OTP #40; both renderers clip the same images at the same even px)" },
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
