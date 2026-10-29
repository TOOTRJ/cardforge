// ---------------------------------------------------------------------------
// Frame edge contract (TODO 7.7) — the borderless-safe twin of 7.6's
// art-window check. 7.6 asks "is the frame opaque outside the art window?";
// an edge-to-edge treatment needs the opposite at the card's edge. Each
// template declares every edge as
//
//   border — the frame is opaque (α ≥ 0.99) in the outer 2 % band;
//   art    — the art window touches that edge (0 / 100 %) and the frame is
//            see-through (α ≤ 0.05) in the band, outside any declared bar
//            that crosses it (`except`, % along the edge);
//   bar    — an opaque band at least `depthPct` deep (% of the card's
//            height for top/bottom, of its width for left/right);
//   design — the frame's own DESIGN runs to that edge with no border
//            (the Lord of the Rings ring's frame field, TODO 4.11): opaque
//            in the band like a border, but its corner is the design's
//            colour, never held dark — a borderless treatment whose edge
//            is frame, not art,
//
// the vocabulary of 6.1a's bleed recipe. It catches the flat #101015 "ring"
// a master with a transparent outer band bakes (the card root's background,
// in neither the art nor the print).
//
// The table below is hand-kept until 4.1's frame manifest carries it
// (TODO 7.7 asks for "a table in the test until then"; it lives here so the
// Card Conjurer importer can run the same check after its downscale).
//
// The corner check (TODO 3.26) is the other half of the contract at the card
// corner: on a border or bar edge, the pixels just inside the one card corner
// (lib/cards/card-corner.ts) must be the border — opaque and dark — or the
// cut shows a light crescent (the MSE masters' white paper) or a hole (a
// transparent ring). The edge check skips each corner by the same constant.
//
// This module imports only the import-free lib/cards/card-corner.ts, with an
// explicit .ts specifier: scripts/import-cc-frames.mjs loads it through
// Node's type stripping.
// ---------------------------------------------------------------------------

import { cardCornerRadiusPx } from "../cards/card-corner.ts";

export type EdgeName = "top" | "right" | "bottom" | "left";

export type EdgeSpec =
  | { kind: "border" }
  | { kind: "art"; except?: readonly (readonly [number, number])[] }
  | { kind: "bar"; depthPct: number }
  | { kind: "design" };

export type EdgeContract = Readonly<Record<EdgeName, EdgeSpec>>;

export const EDGE_NAMES: readonly EdgeName[] = ["top", "right", "bottom", "left"];

/** Band depth: 2 % of the card along the edge's normal. */
export const EDGE_BAND_PCT = 2;
/**
 * Each end of an edge is skipped for the card corner — the one constant's
 * radius on the SHORT side, rounded up, plus 2 px of margin: 67 px at
 * 1500×2100 and at 2100×1500. (It was 4 % of the width: 60 px, which reads
 * α 0.875 at (60, 0) of a 64.5 px cut, and 84 px on landscape masters.)
 */
export function edgeCornerSkipPx(width: number, height: number): number {
  return Math.ceil(cardCornerRadiusPx(width, height)) + 2;
}
export const OPAQUE_MIN = 0.99;
export const CLEAR_MAX = 0.05;
/**
 * The corner check reads the band CORNER_CHECK_FROM_PX … CORNER_CHECK_TO_PX
 * inside the card corner's arc (−8 ≤ d ≤ −0.5, d = the pixel centre's
 * distance past the arc): EVERY pixel the cut keeps whole (the mask leaves
 * d ≤ −0.5 at full alpha), out to 8 px. It started 2 px in until review
 * (2026-09-27): that hid a 1–2 px grey paper rim right at the arc on
 * adventure (luma ≤ 97) and expeditionland w/u/r/c/m (luma ≤ 85), which a
 * round bake shows as a light ring. Both are normalised (Phase B;
 * adventure joined the allow-list on 2026-09-28, owner); one α 0.97 speck
 * on alphaland/b is a known failure.
 */
export const CORNER_CHECK_FROM_PX = 0.5;
export const CORNER_CHECK_TO_PX = 8;
/** "Dark" for the corner check: Rec. 601 luma ≤ 48 (the borders are black,
 *  #000–#0d0d0d; the MSE paper is 225–255). */
export const CORNER_DARK_LUMA_MAX = 48;

const BORDER: EdgeSpec = { kind: "border" };
const ALL_BORDER: EdgeContract = { top: BORDER, right: BORDER, bottom: BORDER, left: BORDER };
const ALL_ART: EdgeContract = {
  top: { kind: "art" },
  right: { kind: "art" },
  bottom: { kind: "art" },
  left: { kind: "art" },
};
/** CC `m15/borderless` (measured on all nine masters): top and sides α 0,
 *  an opaque bottom bar 163 px (7.76 % H) deep, and its fins up the side
 *  edges from 78.67 % H. */
const BORDERLESS_M15: EdgeContract = {
  top: { kind: "art" },
  right: { kind: "art", except: [[78, 100]] },
  bottom: { kind: "bar", depthPct: 7.76 },
  left: { kind: "art", except: [[78, 100]] },
};

/** CC's borderless planeswalkers (4.33; measured on all fourteen masters,
 *  regular and tall): top and sides α 0, an opaque bottom bar 178 px
 *  (8.48 % H) deep, and fins up the side edges from 78.67 % H, as on
 *  `m15/borderless`. */
const BORDERLESS_PW: EdgeContract = {
  top: { kind: "art" },
  right: { kind: "art", except: [[78, 100]] },
  bottom: { kind: "bar", depthPct: 8.48 },
  left: { kind: "art", except: [[78, 100]] },
};

/** CC's accurate 'Extended Art Frames' (TODO 4.7; measured on every master
 *  at 1500 × 2100): the black border top and bottom; at the side edges the
 *  frame is opaque above row 189 (the title bar's border) and from row 1295
 *  (the type bar and the box's border), its soft shade over the art runs
 *  rows 183–236 and 1247–1301, and the art alone shows between — 11.24 → 59.38
 *  % H in the 2 % band. The prints: no border beside the art (WOE #325, TLA
 *  #367, BRO #376 …). */
const EXTENDED_ART_EDGES: EdgeContract = {
  top: BORDER,
  right: { kind: "art", except: [[0, 11.3], [59.2, 100]] },
  bottom: BORDER,
  left: { kind: "art", except: [[0, 11.3], [59.2, 100]] },
};

/** CC's 'Ring' pack (TODO 4.11; measured on all eight masters at 1500 ×
 *  2100): the frame field α 1.00 to the top and side edges — design, no
 *  border, its top corners the frame field's colour — and the black
 *  border's shoulders along the bottom (black from row 1658 at the sides,
 *  the whole bottom 2 % band). */
const RING_EDGES: EdgeContract = {
  top: { kind: "design" },
  right: { kind: "design" },
  bottom: BORDER,
  left: { kind: "design" },
};

/** CC's 'Mystical Archive (STA)' pack (TODO 4.11 wave 2; measured on all
 *  eight masters at 1500 × 2100, the 2 % band): the gold ornament α 1.00 to
 *  the top edge — design, no border (STA #1–63 are borderless on print);
 *  the art to the side edges but where the ornament reaches them (rows
 *  0–298 the title block, 1137–1317 the type bar's ends, 1432–1512 the box's
 *  side ornament, and from 1707 the footer's shoulders); the black footer
 *  along the bottom. */
const MYSTICAL_ARCHIVE_SIDE_EXCEPT: readonly (readonly [number, number])[] = [
  [0, 14.3],
  [54.1, 62.8],
  [68.1, 72.1],
  [81.2, 100],
];
const MYSTICAL_ARCHIVE_EDGES: EdgeContract = {
  top: { kind: "design" },
  right: { kind: "art", except: MYSTICAL_ARCHIVE_SIDE_EXCEPT },
  bottom: BORDER,
  left: { kind: "art", except: MYSTICAL_ARCHIVE_SIDE_EXCEPT },
};

/**
 * The declared edges of every frame template (FRAME_TEMPLATE_VALUES —
 * tests/unit/frames/edge-contract.test.ts fails for a template missing
 * here). Declared as PRINTED: a template whose master doesn't honour its
 * declaration today is an expected failure in the test (EDGE_CONTRACT_KNOWN
 * _FAILURES), never a weakened declaration.
 */
export const EDGE_CONTRACTS: Readonly<Record<string, EdgeContract>> = {
  // Card Conjurer M15 family (frames bucket) — black-bordered.
  m15: ALL_BORDER,
  m15land: ALL_BORDER,
  m15snowland: ALL_BORDER,
  m15token: ALL_BORDER,
  m15tokenartifact: ALL_BORDER,
  // The text-box tokens (TODO 4.49 (b), CC 'Regular (Bordered M15)', re-cut).
  m15tokentext: ALL_BORDER,
  m15tokenartifacttext: ALL_BORDER,
  // …and its tall box (TODO 4.55): the same masters' border, cut rows only.
  m15tokentall: ALL_BORDER,
  m15tokenartifacttall: ALL_BORDER,
  // The emblem (TODO 4.52, CC 'Planeswalker Emblems').
  emblem: ALL_BORDER,
  // The full-art tokens (TODO 4.48 / 4.50, CC 'Textless' / 'Short' / 'Tall'
  // token packs): the art runs to the 60 px black ring on every side.
  m20token: ALL_BORDER,
  m20tokentext: ALL_BORDER,
  m20tokentall: ALL_BORDER,
  m20tokenartifact: ALL_BORDER,
  m20tokenartifacttext: ALL_BORDER,
  m20tokenartifacttall: ALL_BORDER,
  // …and their Nyx dress (TODO 4.51): the same masters but the name pill.
  m20tokennyx: ALL_BORDER,
  m20tokennyxtext: ALL_BORDER,
  m20tokennyxtall: ALL_BORDER,
  m20tokenartifactnyx: ALL_BORDER,
  m20tokenartifactnyxtext: ALL_BORDER,
  m20tokenartifactnyxtall: ALL_BORDER,
  m15artifact: ALL_BORDER,
  // The Vehicle frame (TODO 4.5c, CC 'Vehicle Frame' through the M15 Border
  // and Frame masks): the M15 black border on every edge.
  m15vehicle: ALL_BORDER,
  // The Nyx dress (TODO 4.7, CC 'Nyx' of the accurate M15 pack: the M15
  // border and bars, the starfield in the frame field only): the M15 black
  // border on every edge.
  m15nyx: ALL_BORDER,
  // The station frame (TODO 4.27a): the parents' M15 black border, untouched
  // by the cut (the field ends at the border's inner edge).
  m15station: ALL_BORDER,
  m15stationland: ALL_BORDER,
  // The Universes Beyond frames (TODO 4.25, CC's accurate 'Universes
  // Beyond' pack — the accurate M15 pack's border): black on every edge.
  m15ub: ALL_BORDER,
  m15ubartifact: ALL_BORDER,
  m15ubland: ALL_BORDER,
  m15snow: ALL_BORDER,
  m15devoid: ALL_BORDER,
  m15pw: ALL_BORDER,
  // The transform bodies (TODO 5.1a, CC's 'Transform' packs): the M15
  // black border on every edge of every face, the land pair included.
  m15dfcfront: ALL_BORDER,
  m15dfcback: ALL_BORDER,
  m15dfcbackleft: ALL_BORDER,
  m15dfclandfront: ALL_BORDER,
  m15dfclandback: ALL_BORDER,
  // The modal bodies (TODO 5.1b, CC's 'Modal Regular' pack): the M15 black
  // border on every edge of every face, the land pair included (the land
  // tint replaces the body and the box only, inside the border).
  m15mdfcfront: ALL_BORDER,
  m15mdfcback: ALL_BORDER,
  m15mdfclandfront: ALL_BORDER,
  m15mdfclandback: ALL_BORDER,
  // MSE-derived, in git.
  agclassic: ALL_BORDER,
  alphaland: ALL_BORDER,
  retro: ALL_BORDER,
  retroland: ALL_BORDER,
  modern: ALL_BORDER,
  modernland: ALL_BORDER,
  saga: ALL_BORDER,
  // The double-faced saga front (TODO 5.5 (b)): the saga master with the
  // transform title bar and the tab — the same border.
  sagadfcfront: ALL_BORDER,
  // …and its back (TODO 5.5 (b), PR 2): the saga master's border, whole.
  sagadfcback: ALL_BORDER,
  // The saga creature (TODO 4.5d): the textured saga's border over the type
  // bar, m15nyx's (M15's) from the box down — black all round.
  sagacreature: ALL_BORDER,
  adventure: ALL_BORDER,
  // The Prepare frame (TODO 4.27): M15's own border, whole (its masters are
  // m15/<key> and m15artifact/c with the text area re-dressed).
  prepare: ALL_BORDER,
  flip: ALL_BORDER,
  aftermath: ALL_BORDER,
  fullart: ALL_BORDER,
  nyx: ALL_BORDER,
  // The Expeditions (TODO 4.11 wave 1, Card Conjurer's packs): the printed
  // black border all round, on both looks.
  expeditionland: ALL_BORDER,
  expeditionlandbfz: ALL_BORDER,
  // The extended-art frame (TODO 4.7, CC 'Extended Art Frames', frames
  // bucket): EXTENDED_ART_EDGES — the art runs to the side edges between the
  // title bar and the type bar, as every print runs it.
  extendedart: EXTENDED_ART_EDGES,
  // Its land dress (owner Round 63): the same pack's land frames, the same
  // edges.
  extendedartland: EXTENDED_ART_EDGES,
  // The Spacecraft's extended-art dress (TODO 4.27a step 2): the same pack
  // with the station's cuts, which never reach the border.
  extendedartstation: EXTENDED_ART_EDGES,
  // …and the Prepare frame's (TODO 4.27b): the pack's top over the Prepare
  // master's lower half, whose border is M15's.
  extendedartprepare: EXTENDED_ART_EDGES,
  // The black-bordered textless promos (TODO 4.35 / 4.42, CC 'Magic Fest
  // Promos', frames bucket): the black ring on every edge, as SCH / PF print
  // it. (The borderless textless printings are one-off designs that land
  // `nearest` here — lib/scryfall/frame-signatures.ts.)
  m15textless: ALL_BORDER,
  m15textlessland: ALL_BORDER,
  // The only edge-to-edge master today (4.35 (a): it stays borderless).
  fullartland: ALL_ART,
  // The landscape pair (TODO 4.21b, CC's 'Split' and 'Battle' packs, in the
  // frames bucket): a black border on every edge of the 2100 × 1500 master
  // — the split's turned from CC's portrait cut, the battle's scaled down
  // from 2814 × 2010 with its border kept (the MSE battle was a borderless
  // PNG whose ring baked the root's #101015, 7.7).
  split: ALL_BORDER,
  battle: ALL_BORDER,
  // The showcase families, declared as the treatment prints; each master's
  // transparent outer ring is 4.35's / 4.11's to fix.
  // The Bloomburrow anime (BLB #343–355), since TODO 4.11 / 4.35 (layout
  // v70): full-bleed art on three edges but where the strokes touch them
  // (the top corners' flourishes; the sides' at the name box and the type
  // line), and the footer MSE's border_pt_mask.png draws — a bar at least
  // 108 px deep (at the P/T box, x 1343) that also climbs both sides from
  // 75.24 % down.
  bloomanime: {
    top: { kind: "art", except: [[2.9, 7.7], [92.2, 97.1]] },
    right: { kind: "art", except: [[4, 10], [53.8, 58.8], [75.2, 100]] },
    bottom: { kind: "bar", depthPct: 5.1 },
    left: { kind: "art", except: [[3.9, 10.1], [53.6, 58.9], [75.2, 100]] },
  },
  // The ghostfire's black run, TDM #399–408: since TODO 4.11 (layout v68)
  // its MSE masters carry the black ring and footer MSE paints at render
  // time (scripts/lib/mse-showcase-borders.mjs), cut at the one card
  // corner. (The white halo-foil run, #409–418, is 4.30's.)
  tarkirghostfire: ALL_BORDER,
  // The New Capenna Art Deco showcase (TODO 4.11 wave 2, Card Conjurer's
  // 'Golden Age (SNC)' pack, frames bucket): the printed black border all
  // round, cut at the one card corner by the importer — its crowned twins
  // (`-legendary`) too.
  sncartdeco: ALL_BORDER,
  // Card Conjurer's 'Tarkir' pack since TODO 4.11 (frames bucket): the printed
  // black border all round, cut at the one card corner by the importer.
  tarkirdragon: ALL_BORDER,
  // The D&D Sourcebook showcase (TODO 4.11 wave 2, Card Conjurer's 'D&D
  // Sourcebook' pack, frames bucket): the printed black border all round the
  // parchment page, cut at the one card corner by the importer.
  dndsourcebook: ALL_BORDER,
  // The Dominaria United Stained Glass showcase (TODO 4.11 wave 2, Card
  // Conjurer's 'Stained Glass (DMU)' pack, frames bucket): the printed black
  // border all round the leaded glass, cut at the one card corner.
  stainedglass: ALL_BORDER,
  // The Tarkir draconic (TDM #292–326), since TODO 4.11 (layout v68): the
  // black border all round on print — painted under the MSE masters below
  // and beside the dragons, cut at the one card corner at the bottom — and
  // the dragons' own drawing to the side edges above it, their heads into
  // the TOP corners: the sides are `design` (opaque; their corner half the
  // drawing's colour), the top and bottom the border.
  tarkirdraconic: { top: BORDER, right: { kind: "design" }, bottom: BORDER, left: { kind: "design" } },
  // Card Conjurer's 'Ring' pack since TODO 4.11 (frames bucket): the frame
  // field runs to the top and side edges as every print has it (LTR #302–331,
  // #794–823: no border there), the black border's shoulders along the bottom
  // — the importer cuts the one card corner at the bottom only.
  lotr: RING_EDGES,
  // Card Conjurer's 'Scroll' pack since TODO 4.11 (frames bucket): a real black
  // border all round, cut at the one card corner by the importer.
  lotrscroll: ALL_BORDER,
  // The MKM dossier showcase (TODO 4.11 wave 2, Card Conjurer's 'Dossier'
  // pack, frames bucket): the printed black border at the top, right and
  // bottom, cut at the one card corner by the importer; the folder's tan
  // edge runs to the LEFT edge (design), as on every print (MKM #336–389:
  // the folder from x 1, the scan's own edge pixel aside) — its corners are
  // the border's black (the folder starts below the top one and ends above
  // the bottom one).
  dossier: { top: BORDER, right: BORDER, bottom: BORDER, left: { kind: "design" } },
  // Card Conjurer's 'Mystical Archive (STA)' pack since TODO 4.11 wave 2
  // (frames bucket): borderless — the ornament to the top edge, the art to
  // the sides between its pieces, the black footer; the importer cuts the
  // one card corner at the bottom only.
  mysticalarchive: MYSTICAL_ARCHIVE_EDGES,
  // The Doctor Who TARDIS showcase (TODO 4.11 wave 2, Card Conjurer's
  // 'TARDIS' pack, frames bucket): the printed black border at the top and
  // the bottom (0,0,0 on the pack and on WHO #535–564), cut at the one card
  // corner by the importer; the police box's blue sides run to the left and
  // right edges beside the art and the text box (borderless, as print draws
  // them), black beside the bars — `design`.
  tardis: { top: BORDER, right: { kind: "design" }, bottom: BORDER, left: { kind: "design" } },
  // The Enchanting Tales showcase (TODO 4.11 wave 2, Card Conjurer's
  // 'Enchanting Tales' pack, frames bucket): borderless as WOT #1–63 print
  // it — the swirled frame field to the top edge (design) and down the sides
  // above the art and beside the text box, the art to the side edges between
  // them, the dark footer in the colour's own tone to the bottom edge
  // (design: never held dark at the corner). Measured on all seven masters
  // in the 2 % band: the art from row 469–470 on the left (the top-left swirl
  // hangs lower) and 121–122 on the right, to 1382–1384 on both (the text box's
  // shoulders).
  enchantingtales: {
    top: { kind: "design" },
    right: { kind: "art", except: [[0, 5.8], [65.8, 100]] },
    bottom: { kind: "design" },
    left: { kind: "art", except: [[0, 22.4], [65.8, 100]] },
  },
  // The OTJ Breaking News showcase (TODO 4.11 wave 2, Card Conjurer's
  // 'Breaking News' pack, frames bucket): a borderless newspaper page — the
  // page to the top and side edges (design: its top corners the pack's
  // paper) and the charcoal strip under it to the bottom edge (design: print's
  // own 64,58,60 on every OTP scan, where OTJ's regular black border reads
  // 0,0,0 on the same scans — a coloured footer, never held dark at the
  // corner), cut at the one card corner by the importer.
  breakingnews: { top: { kind: "design" }, right: { kind: "design" }, bottom: { kind: "design" }, left: { kind: "design" } },
  // The Avatar elemental (TLA #336–353, TLE #305–317), since TODO 4.11
  // (layout v69): borderless — the art to the top edge and down both sides
  // to the frame (the masters see-through to 918 px on the left, 1101 on the
  // right) but for the ornate title bar (its ends at 50–1448 px in the top
  // band, rows 108–175 at the sides), the frame to the side edges below, the
  // black footer MSE paints at render time painted under the masters (from
  // 1952 px, 7 % of the height), cut at the one card corner.
  avatar: {
    top: { kind: "art", except: [[3.3, 96.6]] },
    right: { kind: "art", except: [[5.1, 8.4], [52.3, 100]] },
    bottom: { kind: "bar", depthPct: 7 },
    left: { kind: "art", except: [[5.1, 8.4], [43.5, 100]] },
  },
  // The Bloomburrow woodland (BLB #295–336), since TODO 4.11 (layout v69):
  // its leafy top band runs to the top and side edges (design), the art to
  // the side edges between the band and the medallions (519–846 px on both
  // sides), the footer in the colour's own tone to the bottom edge (design:
  // a coloured footer, never held dark at the corner).
  bloomburrow: {
    top: { kind: "design" },
    right: { kind: "art", except: [[0, 24.8], [40.2, 100]] },
    bottom: { kind: "design" },
    left: { kind: "art", except: [[0, 24.8], [40.2, 100]] },
  },
  // 4.32 / 4.39 (Card Conjurer, frames bucket).
  m15borderless: BORDERLESS_M15,
  // The artifact dress: CC's A frame (c) and the colour frames — the same
  // pack, the same edges.
  m15borderlessartifact: BORDERLESS_M15,
  // The nonbasic land (4.34): the same pack's frames, re-tinted inside —
  // the same edges.
  m15borderlessland: BORDERLESS_M15,
  // The Spacecraft's borderless dress (TODO 4.27a step 2): the artifact
  // dress's masters with the station box inside — the same edges.
  m15borderlessstation: BORDERLESS_M15,
  // The borderless double-faced bodies (TODO 5.7): m15borderless's masters
  // with the double-faced pieces grafted inside — the same edges.
  m15borderlessdfcfront: BORDERLESS_M15,
  m15borderlessdfcback: BORDERLESS_M15,
  m15borderlessmdfcfront: BORDERLESS_M15,
  m15borderlessmdfcback: BORDERLESS_M15,
  // 4.33's borderless planeswalkers, regular and tall (the same packs'
  // bottom bar and fins).
  m15borderlesspw: BORDERLESS_PW,
  m15borderlesspwtall: BORDERLESS_PW,
  // CC `textless/2022` composites keep their black ring (α 1.00 on all
  // seven masters); the re-sourced `fullartland` drops it (ALL_ART above;
  // its two bars float inside the card, clear of every edge band).
  m15fullartland: ALL_BORDER,
  // The older full-art basic designs (4.40 / 4.41; CC ZEN, SNC and THB
  // packs, frames bucket): an opaque black border on every edge.
  m15fullartlandzen: ALL_BORDER,
  m15fullartlandsnc: ALL_BORDER,
  m15fullartlandthb: ALL_BORDER,
};

/**
 * The edges of a template's CROWNED twins where they differ from its plain
 * masters' (TODO 4.6f, FrameProfile.crownMasters: `<key>-legendary.png`):
 * the borderless floating crown's peak — its outline from 1.72 %H, the
 * crown from 1.91 %H (rows 36–41 at HD) — reaches into the top band's 2 %
 * between 46.0 and 54.0 %W, as the print's crown does (FDN #294 / #309 /
 * #324: the peak at 1.4–1.9 %H @1040, on the art); everywhere else the
 * twin's edges are the plain master's. Declared as printed, like
 * EDGE_CONTRACTS; read through edgeContractFor.
 */
export const CROWNED_EDGE_CONTRACTS: Readonly<Record<string, EdgeContract>> = {
  m15borderless: { ...BORDERLESS_M15, top: { kind: "art", except: [[45, 55]] } },
  m15borderlessartifact: { ...BORDERLESS_M15, top: { kind: "art", except: [[45, 55]] } },
  m15borderlessstation: { ...BORDERLESS_M15, top: { kind: "art", except: [[45, 55]] } },
  m15borderlessdfcfront: { ...BORDERLESS_M15, top: { kind: "art", except: [[45, 55]] } },
  m15borderlessdfcback: { ...BORDERLESS_M15, top: { kind: "art", except: [[45, 55]] } },
  m15borderlessmdfcfront: { ...BORDERLESS_M15, top: { kind: "art", except: [[45, 55]] } },
  m15borderlessmdfcback: { ...BORDERLESS_M15, top: { kind: "art", except: [[45, 55]] } },
};

/** The suffix of a crowned twin's key (lib/cards/frame-reference-registry.ts
 *  LEGENDARY_MASTER_SUFFIX; repeated here because this module imports only
 *  the card corner — a unit test holds the two together). */
const LEGENDARY_SUFFIX = "-legendary";

/** The contract master `key` of `template` is held to: the crowned twins'
 *  own where they differ (CROWNED_EDGE_CONTRACTS), else the template's. */
export function edgeContractFor(template: string, key: string): EdgeContract | undefined {
  if (key.endsWith(LEGENDARY_SUFFIX) && CROWNED_EDGE_CONTRACTS[template]) return CROWNED_EDGE_CONTRACTS[template];
  return EDGE_CONTRACTS[template];
}

/** Templates × colour masters that fail their contract today, with why.
 *  The test asserts they STILL fail (it.fails), so fixing one flips the
 *  test red until it is struck from this list. Every entry's `why` carries
 *  a "corner" note (3.26): a ring is transparent at the arc, and the
 *  showcase families that paint their corner (Bloomburrow's pale corner,
 *  Tarkir's ornament) are design that Phase B never paints. (The Lord of
 *  the Rings ring left with TODO 4.11: its Card Conjurer masters declare
 *  their frame field as `design` edges, whose corner is never held dark.)
 *  The corner check adds one entry of its own — alphaland/b, whose edges
 *  pass. (It found adventure's grey paper rim too, luma ≤ 97: Phase B
 *  normalises it since the owner's 2026-09-28 call.) */
export const EDGE_CONTRACT_KNOWN_FAILURES: Readonly<Record<string, { keys: "all" | readonly string[]; why: string }>> = {
  // Found by the corner check's full band (3.26 review, 2026-09-27).
  alphaland: {
    keys: ["b"],
    why: "edges pass; corner: two α 0.97 specks just inside the arc (top-right, bottom-right), invisible",
  },
  // (bloomanime left with TODO 4.11 / 4.35's layout v70: one master in
  // print's look, its footer to the corner, full-bleed art.)
  // (avatar and bloomburrow, found by this check on 2026-09-26 — a
  // transparent outer band at the bottom and lower sides — left with TODO
  // 4.11's layout v69: their footers painted under the masters, their edges
  // declared borderless as printed.)
};

export function isKnownEdgeFailure(template: string, key: string): boolean {
  const entry = EDGE_CONTRACT_KNOWN_FAILURES[template];
  return Boolean(entry && (entry.keys === "all" || entry.keys.includes(key)));
}

/** A rectangle in card percent (the profile's artSlot). */
export type EdgeRect = { topPct: number; leftPct: number; widthPct: number; heightPct: number };

/** True when `rect` reaches `edge` of the card. */
export function rectTouchesEdge(rect: EdgeRect, edge: EdgeName): boolean {
  switch (edge) {
    case "top":
      return rect.topPct <= 0;
    case "left":
      return rect.leftPct <= 0;
    case "right":
      return rect.leftPct + rect.widthPct >= 100;
    case "bottom":
      return rect.topPct + rect.heightPct >= 100;
  }
}

/**
 * Every way a master (straight RGBA, `width × height`) breaks `contract`.
 * Pass the profile's art window to also check that each `art` edge is
 * touched by it. Empty = the master honours its contract.
 */
export function edgeContractViolations(
  contract: EdgeContract,
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  artSlot?: EdgeRect,
): string[] {
  const out: string[] = [];
  const corner = edgeCornerSkipPx(width, height);
  const alphaAt = (x: number, y: number) => rgba[(y * width + x) * 4 + 3] / 255;
  for (const edge of EDGE_NAMES) {
    const spec = contract[edge];
    const horizontal = edge === "top" || edge === "bottom";
    const length = horizontal ? width : height;
    const across = horizontal ? height : width;
    const depthPct = spec.kind === "bar" ? spec.depthPct : EDGE_BAND_PCT;
    const depth = Math.max(1, Math.round((depthPct / 100) * across));
    // (along, inward) → (x, y); inward 0 is the card's edge.
    const at = (along: number, inward: number): [number, number] => {
      switch (edge) {
        case "top":
          return [along, inward];
        case "bottom":
          return [along, height - 1 - inward];
        case "left":
          return [inward, along];
        case "right":
          return [width - 1 - inward, along];
      }
    };
    const skip = (along: number) =>
      spec.kind === "art" &&
      (spec.except ?? []).some(([from, to]) => {
        const pct = (along / length) * 100;
        return pct >= from && pct <= to;
      });
    let worst = spec.kind === "art" ? 0 : 1;
    let worstAt: [number, number] | null = null;
    for (let along = corner; along < length - corner; along += 1) {
      if (skip(along)) continue;
      for (let inward = 0; inward < depth; inward += 1) {
        const [x, y] = at(along, inward);
        const a = alphaAt(x, y);
        if (spec.kind === "art" ? a > worst : a < worst) {
          worst = a;
          worstAt = [x, y];
        }
      }
    }
    if (spec.kind === "art") {
      if (worst > CLEAR_MAX) {
        out.push(`${edge}: art edge, but the frame is α ${worst.toFixed(2)} at ${worstAt?.join(",")} (≤ ${CLEAR_MAX})`);
      }
      if (artSlot && !rectTouchesEdge(artSlot, edge)) out.push(`${edge}: art edge, but the art window doesn't reach it`);
    } else if (worst < OPAQUE_MIN) {
      const what = spec.kind === "bar" ? `bar (${spec.depthPct} %)` : spec.kind === "design" ? "design" : "border";
      out.push(`${edge}: ${what}, but the frame is α ${worst.toFixed(2)} at ${worstAt?.join(",")} (≥ ${OPAQUE_MIN})`);
    }
  }
  return out;
}

/** The two edges that meet at each card corner. */
const CORNER_EDGES = [
  { corner: "top-left", horizontal: "top", vertical: "left", fx: 0, fy: 0 },
  { corner: "top-right", horizontal: "top", vertical: "right", fx: 1, fy: 0 },
  { corner: "bottom-left", horizontal: "bottom", vertical: "left", fx: 0, fy: 1 },
  { corner: "bottom-right", horizontal: "bottom", vertical: "right", fx: 1, fy: 1 },
] as const;

/**
 * Every way a master's card corners break `contract` (TODO 3.26): on a
 * `border` or `bar` edge, each pixel just inside the one card corner's arc
 * (−CORNER_CHECK_TO_PX ≤ d ≤ −CORNER_CHECK_FROM_PX) must be opaque
 * (α ≥ OPAQUE_MIN) and dark
 * (luma ≤ CORNER_DARK_LUMA_MAX). Each arc is split on its diagonal: the half
 * nearer an edge belongs to that edge, and an `art` edge's half is skipped
 * (the art reaches the corner there). Empty = the corners honour it.
 */
export function cornerViolations(
  contract: EdgeContract,
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): string[] {
  const out: string[] = [];
  const r = cardCornerRadiusPx(width, height);
  const n = Math.ceil(r);
  for (const { corner, horizontal, vertical, fx, fy } of CORNER_EDGES) {
    for (const edge of [horizontal, vertical] as const) {
      const spec = contract[edge];
      if (spec.kind === "art") continue;
      let minAlpha = 1;
      let minAt: [number, number] | null = null;
      let maxLuma = 0;
      let lumaAt: [number, number] | null = null;
      for (let ly = 0; ly < n; ly += 1) {
        for (let lx = 0; lx < n; lx += 1) {
          const cx = r - lx - 0.5;
          const cy = r - ly - 0.5;
          if (cx <= 0 || cy <= 0) continue;
          // The half of the arc nearer the horizontal edge has cy ≥ cx.
          if ((edge === horizontal) !== cy >= cx) continue;
          const d = Math.hypot(cx, cy) - r;
          if (d > -CORNER_CHECK_FROM_PX || d < -CORNER_CHECK_TO_PX) continue;
          const x = fx ? width - 1 - lx : lx;
          const y = fy ? height - 1 - ly : ly;
          const o = (y * width + x) * 4;
          const a = rgba[o + 3] / 255;
          if (a < minAlpha) {
            minAlpha = a;
            minAt = [x, y];
          }
          // A see-through pixel's colour means nothing; α reports it.
          if (a < 0.5) continue;
          const luma = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
          if (luma > maxLuma) {
            maxLuma = luma;
            lumaAt = [x, y];
          }
        }
      }
      const what = spec.kind === "bar" ? "bar" : spec.kind === "design" ? "design" : "border";
      if (minAlpha < OPAQUE_MIN) {
        out.push(
          `${corner} corner (${edge} ${what}): the frame is α ${minAlpha.toFixed(2)} at ${minAt?.join(",")} just inside the arc (≥ ${OPAQUE_MIN})`,
        );
      }
      // A design edge's corner is the design's colour (the ring's frame
      // field): only its opacity is held.
      if (spec.kind !== "design" && maxLuma > CORNER_DARK_LUMA_MAX) {
        out.push(
          `${corner} corner (${edge} ${what}): luma ${Math.round(maxLuma)} at ${lumaAt?.join(",")} just inside the arc (≤ ${CORNER_DARK_LUMA_MAX}, the border)`,
        );
      }
    }
  }
  return out;
}
