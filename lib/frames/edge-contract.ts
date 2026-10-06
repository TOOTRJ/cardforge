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
//            height for top/bottom, of its width for left/right),
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
  | { kind: "bar"; depthPct: number };

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
  m15artifact: ALL_BORDER,
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
  alphatoken: ALL_BORDER,
  retro: ALL_BORDER,
  retroland: ALL_BORDER,
  modern: ALL_BORDER,
  modernland: ALL_BORDER,
  saga: ALL_BORDER,
  adventure: ALL_BORDER,
  flip: ALL_BORDER,
  split: ALL_BORDER,
  aftermath: ALL_BORDER,
  extendedart: ALL_BORDER,
  fullart: ALL_BORDER,
  nyx: ALL_BORDER,
  expeditionland: ALL_BORDER,
  // Printed black-bordered: 4.35 re-sources these borderless (decision (a)
  // for m15textless*), when their contract becomes ALL_ART.
  m15textless: ALL_BORDER,
  m15textlessland: ALL_BORDER,
  // The only edge-to-edge master today (4.35 (a): it stays borderless).
  fullartland: ALL_ART,
  // Battles print a black border (4.21 / 7.6).
  battle: ALL_BORDER,
  // The showcase families, declared as the treatment prints; each master's
  // transparent outer ring is 4.35's / 4.11's to fix.
  bloomanime: {
    // MSE's source runs the image 0/0/100 × 91.6 (4.35): art on three
    // edges over a bottom bar. The bar's reach up the sides is 4.35's to
    // measure when it re-cuts the master.
    top: { kind: "art" },
    right: { kind: "art", except: [[80, 100]] },
    bottom: { kind: "bar", depthPct: 8.4 },
    left: { kind: "art", except: [[80, 100]] },
  },
  tarkirghostfire: ALL_BORDER, // the black run, TDM #399–408 (4.35)
  tarkirdragon: ALL_BORDER, // MUL references are black-bordered (4.35)
  tarkirdraconic: ALL_BORDER,
  lotr: ALL_BORDER,
  lotrscroll: ALL_BORDER,
  avatar: ALL_BORDER,
  bloomburrow: ALL_BORDER,
  // 4.32 / 4.39 (Card Conjurer, frames bucket).
  m15borderless: BORDERLESS_M15,
  // The artifact dress: CC's A frame (c) and the colour frames — the same
  // pack, the same edges.
  m15borderlessartifact: BORDERLESS_M15,
  // The nonbasic land (4.34): the same pack's frames, re-tinted inside —
  // the same edges.
  m15borderlessland: BORDERLESS_M15,
  // 4.33's borderless planeswalkers, regular and tall (the same packs'
  // bottom bar and fins).
  m15borderlesspw: BORDERLESS_PW,
  m15borderlesspwtall: BORDERLESS_PW,
  // CC `textless/2022` composites keep their black ring (α 1.00 on all
  // seven masters); the re-sourced `fullartland` drops it (ALL_ART above;
  // its two bars float inside the card, clear of every edge band).
  m15fullartland: ALL_BORDER,
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
 *  LOTR's tan, Tarkir's ornament) are design that Phase B never paints.
 *  The corner check adds one entry of its own — alphaland/b, whose edges
 *  pass. (It found adventure's grey paper rim too, luma ≤ 97: Phase B
 *  normalises it since the owner's 2026-09-28 call.) */
export const EDGE_CONTRACT_KNOWN_FAILURES: Readonly<Record<string, { keys: "all" | readonly string[]; why: string }>> = {
  // Found by the corner check's full band (3.26 review, 2026-09-27).
  alphaland: {
    keys: ["b"],
    why: "edges pass; corner: two α 0.97 specks just inside the arc (top-right, bottom-right), invisible",
  },
  bloomanime: {
    keys: "all",
    why: "transparent outer ring + inset art slot 2.5/3.5/93×92 (4.35); corner: the bottom bar is transparent at the arc",
  },
  tarkirghostfire: {
    keys: "all",
    why: "transparent outer ring bakes #101015; the black run needs a real ring (4.35); corner: transparent at the arc",
  },
  tarkirdragon: {
    keys: "all",
    why: "the ring bakes #101015 (16,16,21), not the MUL print's black (4.35); corner: transparent at the arc",
  },
  lotrscroll: { keys: "all", why: "borderless scroll PNG, transparent ring (7.6 / 4.21); corner: transparent at the arc" },
  battle: { keys: "all", why: "borderless PNG, transparent ring (7.6 / 4.21); corner: transparent at the arc" },
  expeditionland: {
    keys: ["b", "g"],
    why: "the black flood fill leaked through the dark stone: no ring, no text box (4.35 (3)); corner: transparent at the arc",
  },
  // Found by this check on 2026-09-26 (the borderless research sampled the
  // side band at 20–80 % H only): transparent bottom band and lower sides.
  avatar: {
    keys: "all",
    why: "transparent outer band at the bottom and lower sides (found 2026-09-26); corner: transparent at the arc",
  },
  bloomburrow: {
    keys: "all",
    why: "transparent outer band at the bottom and lower sides (found 2026-09-26); corner: the pale design corner (never normalised, 3.26)",
  },
  lotr: {
    keys: "all",
    why: "transparent outer band at the bottom and lower sides (found 2026-09-26); corner: the tan design corner on top (never normalised, 3.26)",
  },
  tarkirdraconic: {
    keys: "all",
    why: "transparent outer band at the bottom and lower sides (found 2026-09-26); corner: the dragon ornament on top (never normalised, 3.26)",
  },
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
      const what = spec.kind === "bar" ? `bar (${spec.depthPct} %)` : "border";
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
      const what = spec.kind === "bar" ? "bar" : "border";
      if (minAlpha < OPAQUE_MIN) {
        out.push(
          `${corner} corner (${edge} ${what}): the frame is α ${minAlpha.toFixed(2)} at ${minAt?.join(",")} just inside the arc (≥ ${OPAQUE_MIN})`,
        );
      }
      if (maxLuma > CORNER_DARK_LUMA_MAX) {
        out.push(
          `${corner} corner (${edge} ${what}): luma ${Math.round(maxLuma)} at ${lumaAt?.join(",")} just inside the arc (≤ ${CORNER_DARK_LUMA_MAX}, the border)`,
        );
      }
    }
  }
  return out;
}
