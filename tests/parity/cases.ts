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
  { from: "m15/r/creature-short@foil", why: "foil: the sheen and its art mask" },
  { from: "m15/u/creature-long@etched", why: "etched: the frame-only sheen" },
  // --- the Vehicle frame (TODO 4.5c): its own plate, white digits -----------
  { from: "m15vehicle/c/artifact-short@wide", why: "Vehicle: the brown plate under white digits at their widest (12/12), the bronze frame" },
  { from: "m15vehicle/wu/artifact-long@pair-crown", why: "Vehicle: the two-colour pair master and the crown over the bronze frame" },
  // --- the Nyx dress (TODO 4.7): the starfield masters, their own crown band --
  { from: "m15nyx/w/creature-short", why: "Nyx: the starfield master under M15's slots and plate" },
  { from: "m15nyx/wu/creature-long@pair-crown", why: "Nyx: the two-colour pair master and the Nyx crown band (the starfield strip inside the crown)" },
  // --- Beleren's ffi ligature (found by the independent check of #542) -------
  // The Nyx dress's first case ("Enchantment Creature — Griffin") measured a
  // worst tile over the HD limit and was swapped for a plainer card. It is
  // not the frame: the same line on plain m15 measures the same, and a line
  // of the same length without "ffi" does not. Held here on the plain frame
  // (tests/parity/thresholds.ts "hd-beleren-ffi-ligature").
  {
    from: "m15/w/creature-short",
    as: "@ffi-ligature",
    why: "a type line with \"ffi\" (Griffin): Chromium sets Beleren's ffi ligature, Satori never forms it",
    row: () => ({ supertype: "Enchantment", subtypes: ["Griffin"] }),
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
    // own 750 px difference ("750-cost-row-width"), not this frame's.
    why: "station: the crown over the cut master, a fuller box (a two-paragraph plated tier, 10/10 on the plate)",
    row: () => ({ cost: "{2}{G}" }),
  },
  { from: "m15station/r/artifact-short@foil", why: "station: the foil sheen over the box, the bands and the drawn pieces — ink above it" },
  { from: "m15stationland/g/land-short", why: "station: a Planet — the land master, one tier, no plate" },
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
  { from: "flip/u/flip-long", why: "flip: the upside-down second face" },
  { from: "battle/g/battle-long", why: "battle: landscape, the painted defense shield, the turned credit" },
  { from: "m15dfcfront/g/transform-long", why: "transform front: icon rider, reverse P/T float" },
  { from: "m15dfcback/g/transform-long", why: "transform back: its own body, through the flip" },
  { from: "m15mdfcfront/w/mdfc-long@strip-u", why: "modal front: the flipside strip in the other face's colour" },
  { from: "m15mdfcback/g/mdfc-long", why: "modal back: the strip on a back, through the flip" },
  { from: "m15tokentext/g/token-long", why: "token with a text box" },
  { from: "m20tokentall/g/token-long", why: "M20 token, tall box (squeezed paragraph gaps)" },
  { from: "emblem/g/emblem-long", why: "emblem: the toned master, the walker's name, no cost or stats" },
  // 3.24's cases, by name (the Zendikar split type line waits for 4.40, the
  // first profile to use `type.split`).
  { from: "fullartland/w/land-short", why: "3.24: the full-art Plains — the basic symbol disc, footer on the art" },
  { from: "m15land/w/land-short", why: "3.24: the m15land Plains — its watermark, unchanged by the disc slot" },
  { from: "m15textless/g/creature-long", why: "3.24: a textless creature — rules kept in the data, hidden in both renderers" },
  { from: "m15borderless/b/creature-long", why: "borderless: art to the edge, white ink, the keylined set symbol" },
  // --- the old frames (era symbol styles, footers, © slots) ----------------
  { from: "agclassic/g/creature-long", why: "1993: image pips, the Illus. line, right-set P/T" },
  { from: "retro/r/creature-long", why: "1997: shadowed white ink, flat discs, centred © slot" },
  { from: "modern/g/creature-long", why: "2003: shadowed cost discs, the brush, two-line footer" },
  { from: "modern/wu/creature-short@pair", why: "the synthesised old-frame pair master" },
  // --- a name fitted against a DETACHED cost of ×1.2 discs (TODO 6.16d, v52) -
  // The walker's twin (TODO 3.37): at 750 px its row of five ×1.2 discs is
  // the widest cost row of the matrix and the two renderers disagree about
  // it by more than a limit — the two "750-walker-phyrexian-cost" known
  // differences (tests/parity/thresholds.ts) describe and bound it.
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
