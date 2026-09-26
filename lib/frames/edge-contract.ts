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
// Card Conjurer importer can run the same check after its downscale). This
// module has NO imports — scripts/import-cc-frames.mjs loads it as .ts.
// ---------------------------------------------------------------------------

export type EdgeName = "top" | "right" | "bottom" | "left";

export type EdgeSpec =
  | { kind: "border" }
  | { kind: "art"; except?: readonly (readonly [number, number])[] }
  | { kind: "bar"; depthPct: number };

export type EdgeContract = Readonly<Record<EdgeName, EdgeSpec>>;

export const EDGE_NAMES: readonly EdgeName[] = ["top", "right", "bottom", "left"];

/** Band depth: 2 % of the card along the edge's normal. */
export const EDGE_BAND_PCT = 2;
/** Each end of an edge is skipped for this % of the card's WIDTH — the
 *  rounded corner (39 px Card Conjurer cut, ~65 px printed) plus margin. */
export const EDGE_CORNER_PCT = 4;
export const OPAQUE_MIN = 0.99;
export const CLEAR_MAX = 0.05;

const BORDER: EdgeSpec = { kind: "border" };
const ALL_BORDER: EdgeContract = { top: BORDER, right: BORDER, bottom: BORDER, left: BORDER };
const ALL_ART: EdgeContract = {
  top: { kind: "art" },
  right: { kind: "art" },
  bottom: { kind: "art" },
  left: { kind: "art" },
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
  m15artifact: ALL_BORDER,
  m15snow: ALL_BORDER,
  m15devoid: ALL_BORDER,
  m15pw: ALL_BORDER,
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
  // Declared ahead of their templates (4.32 / 4.39) — ready for the new
  // frames; the test checks them once their template key exists.
  m15borderless: {
    // CC `m15/borderless` (measured on all nine masters): top and sides α 0,
    // an opaque bottom bar 163 px (7.76 % H) deep, and its fins up the side
    // edges from 78.67 % H.
    top: { kind: "art" },
    right: { kind: "art", except: [[78, 100]] },
    bottom: { kind: "bar", depthPct: 7.76 },
    left: { kind: "art", except: [[78, 100]] },
  },
  // CC `textless/2022` composites keep their black ring (α 1.00 on all
  // seven masters); the re-sourced `fullartland` drops it (ALL_ART above).
  m15fullartland: ALL_BORDER,
};

/** Templates × colour masters that fail their contract today, with why.
 *  The test asserts they STILL fail (it.fails), so fixing one flips the
 *  test red until it is struck from this list. */
export const EDGE_CONTRACT_KNOWN_FAILURES: Readonly<Record<string, { keys: "all" | readonly string[]; why: string }>> = {
  bloomanime: { keys: "all", why: "transparent outer ring + inset art slot 2.5/3.5/93×92 (4.35)" },
  tarkirghostfire: { keys: "all", why: "transparent outer ring bakes #101015; the black run needs a real ring (4.35)" },
  tarkirdragon: { keys: "all", why: "the ring bakes #101015 (16,16,21), not the MUL print's black (4.35)" },
  lotrscroll: { keys: "all", why: "borderless scroll PNG, transparent ring (7.6 / 4.21)" },
  battle: { keys: "all", why: "borderless PNG, transparent ring (7.6 / 4.21)" },
  expeditionland: {
    keys: ["b", "g"],
    why: "the black flood fill leaked through the dark stone: no ring, no text box (4.35 (3))",
  },
  // Found by this check on 2026-09-26 (the borderless research sampled the
  // side band at 20–80 % H only): transparent bottom band and lower sides.
  avatar: { keys: "all", why: "transparent outer band at the bottom and lower sides (found 2026-09-26)" },
  bloomburrow: { keys: "all", why: "transparent outer band at the bottom and lower sides (found 2026-09-26)" },
  lotr: { keys: "all", why: "transparent outer band at the bottom and lower sides (found 2026-09-26)" },
  tarkirdraconic: { keys: "all", why: "transparent outer band at the bottom and lower sides (found 2026-09-26)" },
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
  const corner = Math.round((EDGE_CORNER_PCT / 100) * width);
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
