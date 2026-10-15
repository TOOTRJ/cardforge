import type { RegionMetrics } from "./compare";

// ---------------------------------------------------------------------------
// What the preview may differ from the bake by (TODO 3.11) — three layers,
// each stricter than the one before:
//
//   1. LIMITS — what ANY region of ANY case may measure: an offset of at most
//      one CSS pixel, and the difference two rasterisers leave on the same
//      layout. Derived from the first full measurement (2026-10-12, the table
//      in the PR) plus a margin.
//   2. KNOWN_DIFFERENCES — the measurements that are over a limit TODAY. Each
//      is a real, described difference between the two renderers with its
//      numbers and the bounds it may not leave — the suite's list of open
//      findings (as ART_WINDOW_KNOWN_FAILURES is the art window's). Fixing
//      one means striking it: an entry nothing needs any more fails the run.
//      Never raise a LIMIT to make a case pass — describe the difference
//      here, or fix it.
//   3. tests/parity/baseline/<platform>/<case>.json (tests/parity/baseline.ts)
//      — every region's offset as recorded on the platform the run is on. Today's offset must be within ±1 px of it and
//      its difference within BASELINE_MARGIN: a text 2 px from where it was
//      is caught whichever way it moved, including "towards the bake" (a
//      one-sided limit would let a preview-only nudge through whenever it
//      happens to cancel a known offset). Re-record it with
//      `npm run test:parity -- --update` (CI's numbers: the red run prints
//      them; tests/parity/README.md) — the update rewrites only the cases
//      that are new or left this tolerance, and refuses a value over a LIMIT
//      that no known difference names.
// ---------------------------------------------------------------------------

export type SizeName = "750" | "hd";

export type Measured = {
  id: string;
  size: SizeName;
  regions: Record<string, RegionMetrics>;
  /** The whole card (mad and hot only). */
  card: RegionMetrics;
  /** The worst tile of the whole card. */
  tile: { mad: number; x: number; y: number };
  /** The named regions as fractions of the card (failure texts only). */
  rects?: Record<string, { x: number; y: number; w: number; h: number }>;
  /** Every tile's mad, row by row (tests/parity/compare.ts tileMap). */
  tiles: { tile: number; cols: number; rows: number; mads: number[] };
};

/** The shift search's reach, px. */
export function searchRadius(size: SizeName): number {
  return size === "hd" ? 8 : 5;
}

/** The whole-card tile, px (a thirtieth of a portrait card's width — about
 *  the size of an inline pip). */
export function tileSize(size: SizeName): number {
  return size === "hd" ? 50 : 25;
}

export type Limits = {
  /** |dx| and |dy| of a region, px — one CSS pixel. */
  shift: number;
  /** A region's mean absolute difference, 0–255. */
  mad: number;
  /** A region's share of "another picture" pixels, 0–1. */
  hot: number;
  /** The whole card's mean absolute difference. */
  cardMad: number;
  /** The worst whole-card tile's mean absolute difference. */
  tileMad: number;
};

/**
 * Measured 2026-10-12 on CI's runner (linux; macOS measures the same to
 * within a pixel) over the 34 cases, 276 regions a size:
 *
 *   750  offsets: 0 px on 178 regions across / 201 down, ±1 on 58 / 59,
 *        ±2 on 31 / 16, more on 9 (the known differences below);
 *        region mad ≤ 27.0, hot ≤ 21 %, card mad ≤ 6.4, worst tile ≤ 84.0
 *   hd   offsets: 0 px on 203 / 117, ±1 on 68 / 68, ±2 on 5 / 58, −3 down
 *        on 33 (the known difference below);
 *        region mad ≤ 15.5, hot ≤ 14 %, card mad ≤ 4.9, worst tile ≤ 56.9
 *
 * The offset limit is 2 px at both sizes (at HD: one CSS pixel). The
 * difference limits are the worst measured plus about 15 %.
 */
export const LIMITS: Record<SizeName, Limits> = {
  "750": { shift: 2, mad: 31, hot: 0.25, cardMad: 7.5, tileMad: 95 },
  hd: { shift: 2, mad: 18, hot: 0.17, cardMad: 5.8, tileMad: 65 },
};

export type Metric = "dx" | "dy" | "mad" | "hot" | "cardMad" | "tileMad";

export type KnownDifference = {
  /** A short name (the report and a stale-entry failure print it). */
  name: string;
  size: SizeName;
  /** The cases it is measured on. */
  cases: RegExp;
  /** The regions ("card" for cardMad / tileMad). */
  regions: readonly string[];
  metric: Metric;
  /** The bounds the measurement may not leave (inclusive). */
  min: number;
  max: number;
  /** What differs, and why it is believed to — a finding, not an excuse. */
  why: string;
};

const ZOOMED_ART_CASES = /^m15\/r\/creature-short@(art-zero|art-zoom|art-zoom-3|exif6-stored|exif6-upload)$/;
const ZOOMED_ART_WHY =
  "Art at a zoom above 1 sits further RIGHT in the preview: +1 px at 750 and +2 at HD (+1 on one HD case on macOS) on every zoomed case — zooms 1.2, 1.3, 1.6 and 3, focal points 0, 0.3, 0.5 and 0.8 — and 0 at zoom 1 whatever the focal point. Measured on the coded picture's grid lines (2026-10-13, darwin): the BAKE's zoomed picture is where the arithmetic puts it in the whole-pixel window yoga lays out (58 + 635 px for the M15 window's 57.525 + 635.7 at 750: the centre line of a 3× zoom at 377.95 against 377.88 computed); the PREVIEW's is +0.6 CSS px from that at zoom 1.3, +0.7 at 1.6 and +1.0 at 3, the same at both sizes. Both renderers are given the same three declarations (object-position, scale(), transform-origin), so it is not a disagreement of ours in one line: Chromium snaps an untransformed picture's box to whole pixels (as yoga does — hence 0 at zoom 1) and scales a transformed one from its fractional box, and the zoom magnifies that sub-pixel difference. It grows slowly with the zoom, so at the maximum (4) it may pass the HD limit — no case measures that yet. Not fixed here: either renderer's fix is a layout question.";

/** Every text slot a profile can name (tests/parity/regions.ts). */
const TEXT_REGIONS = ["title", "cost", "type", "symbol", "rules", "stat", "second.title", "second.type", "second.rules", "page.title", "page.rules"] as const;

/**
 * Every entry is a difference between the two renderers that exists TODAY
 * (measured 2026-10-12, CI's runner and macOS alike) — nothing here was
 * introduced or excused by this suite. Bounds: the measured value, and one
 * pixel further out. "Why" says what is seen; where the cause was not traced
 * it says so.
 */
export const KNOWN_DIFFERENCES: readonly KnownDifference[] = [
  {
    name: "hd-text-rise",
    size: "hd",
    cases: /./,
    regions: TEXT_REGIONS,
    metric: "dy",
    min: -4,
    max: -3,
    why:
      "At HD the preview's text sits ABOVE the bake's: by 1 px on 57 regions, 2 px on 58 and 3 px (1.5 CSS px) on 33 of 276 — names, type lines, rules and set symbols on most templates (the short M15 creature: name, type line and rules all −3). The 750 px comparison shows the same rise as −1 / −2. Seen on every text face; not traced further (the two engines place a line's baseline from the font's metrics independently). The frame, the art and the plates do not move with it.",
  },
  {
    name: "750-cost-row-width",
    size: "750",
    cases: /^m15(borderless|textless|ub)?\//,
    regions: ["cost"],
    metric: "dx",
    min: -4,
    max: -3,
    why:
      "At 750 px a cost row of five or more pips starts 2–3 px further LEFT in the preview than in the bake (its right end agrees): the preview's row is wider by about half a pixel a pip. The HD comparison of the same cards measures 0, which points at the 750 px bake's whole-pixel disc and gap sizes (the preview keeps fractions); not traced to the line. Measured −3 on the M15 long card (collector, symbols, etched), m15borderless and m15textless, and on the Universes Beyond long pair card (TODO 4.25: m15's cost row on the m15ub frame — its M15 twin, m15/wu/creature-long@stamp-pair-crown, measures −2); −2 on four more.",
  },
  {
    name: "750-emblem-title-end",
    size: "750",
    cases: /^emblem\//,
    regions: ["cost"],
    metric: "dx",
    min: 4,
    max: 5,
    why:
      "The emblem's long name (it has no cost: this region is the name band's right end) runs 4 px further RIGHT in the preview at 750 px — the line is that much wider there than in the 750 px bake; the two agree across at HD (0). Like the other 750-only entries it is a width difference of the 750 px bake, seen here on a line that fills its band; not traced to a constant.",
  },
  {
    name: "750-retro-type-line-end",
    size: "750",
    cases: /^retro\//,
    regions: ["symbol"],
    metric: "dx",
    min: 5,
    max: 6,
    why:
      "On the 1997 frame the type line (MPlantin, white with a hard shadow) ends 5 px further RIGHT in the preview at 750 px; the set symbol beside it does not move. At HD the line's end agrees (0 across, 3 px up — the rise above). A width difference of the 750 px bake's type line, not traced to a constant.",
  },
  {
    name: "750-token-flavour-end",
    size: "750",
    cases: /^m15tokentext\//,
    regions: ["stat"],
    metric: "dx",
    min: -4,
    max: -3,
    why:
      "On the arch token with a text box the last flavour line (italic; it runs into the P/T plate's region) ends 3 px further LEFT in the preview at 750 px: the italic line is narrower there than in the 750 px bake. The P/T digits themselves agree; at HD the region measures 0 across.",
  },
  {
    name: "750-artist-line-end",
    size: "750",
    // (The two arch-token cases of TODO 4.53 draw the same artist line as
    // m15tokentext's: the footer is M15TOKEN's on all four arch frames.)
    cases: /^(agclassic|m15tokentext)\/|^m15token\/c\/token-long@small-caps$|^m15tokenartifact\/u\/token-long@small-caps-lower$/,
    regions: ["footer"],
    metric: "dx",
    min: 3,
    max: 4,
    why:
      "The artist line (letter-spaced small capitals; `Illus. …` on the 1993 frame) is WIDER in the preview at 750 px: it ends 2 px further right on most cases and 3 px on the 1993 frame (and on the arch token on macOS). At HD the same line is NARROWER in the preview by about 6 px — within the limits there, but the worst tile of most HD cases (56.9). Both renderers start the line at the same x; they disagree about its letter-spacing or advances. Not traced.",
  },
  // --- TODO 3.37: seen by #514, measured again 2026-10-13 (after #523's
  // large pips; the numbers did not move) and listed with their case. -------
  {
    name: "750-walker-phyrexian-cost-start",
    size: "750",
    cases: /^m15pw\/w\/planeswalker-long@phyrexian-cost-5$/,
    regions: ["cost"],
    metric: "dx",
    min: -5,
    max: -3,
    why:
      "The walker's detached cost of five Phyrexian symbols (×1.2 discs) starts 4 px further LEFT in the preview at 750 px than in the 750 px bake (the name is cut at the same word in both, #514). It is 750-cost-row-width on the widest row the matrix has — five discs of about 44 px where a plain pip is 36 — and like it gone at HD (0 across, 1 down). The 2003 frame's twin (modern/w/…@phyrexian-cost-5) measures +1. Not traced past that entry's guess: the 750 px bake draws whole-pixel discs and gaps, the preview keeps the fractions.",
  },
  {
    name: "750-walker-phyrexian-cost-mad",
    size: "750",
    cases: /^m15pw\/w\/planeswalker-long@phyrexian-cost-5$/,
    regions: ["cost"],
    metric: "mad",
    min: 31,
    max: 35,
    why:
      "The same row as 750-walker-phyrexian-cost-start, seen as a difference: with the row 4 px out of register the cost region's mean absolute difference is 32.9 against a limit of 31 (a quarter of the region reads as another picture: hot 24.8 %, a hair inside its limit of 25 %). At HD the region measures 5.2. It goes when the row's start does.",
  },
];

/**
 * Differences that are INSIDE the limits and still not noise (TODO 3.37):
 * systematic, described, and recorded on every case they name. Nothing
 * judges a run by them — the baseline already holds each of these offsets
 * to ±1 px and the limit is one step past them — but the unit run
 * (parity-matrix.test.ts) fails when a named case no longer records the
 * offset: fixed means struck, like a known difference.
 */
export const WITHIN_LIMIT_DIFFERENCES: readonly KnownDifference[] = [
  {
    name: "750-zoomed-art-right",
    size: "750",
    cases: ZOOMED_ART_CASES,
    regions: ["art"],
    metric: "dx",
    min: 1,
    max: 2,
    why: ZOOMED_ART_WHY,
  },
  {
    name: "hd-zoomed-art-right",
    size: "hd",
    cases: ZOOMED_ART_CASES,
    regions: ["art"],
    metric: "dx",
    min: 1,
    max: 2,
    why: ZOOMED_ART_WHY,
  },
];

/** How far a measurement may be from its recorded baseline. */
export const BASELINE_MARGIN = {
  /** dx and dy, px, either way. */
  shift: 1,
  mad: (recorded: number) => recorded * 1.5 + 2,
  hot: (recorded: number) => recorded * 1.5 + 0.03,
  cardMad: (recorded: number) => recorded * 1.3 + 0.5,
  /** One tile against its recorded step's upper bound. */
  tileMad: (recorded: number) => recorded * 1.3 + 4,
} as const;

/** A tile's mad as ONE character of the baseline: steps of TILE_STEP, the
 *  last step open-ended. */
const TILE_STEP = 2;
const TILE_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const encodeTile = (mad: number) => TILE_DIGITS[Math.min(TILE_DIGITS.length - 1, Math.floor(mad / TILE_STEP))];
/** The upper bound of a recorded tile's step. */
const decodeTile = (digit: string) => (TILE_DIGITS.indexOf(digit) + 1) * TILE_STEP;

/** One case at one size as the baseline records it (one line of
 *  tests/parity/baseline/<platform>/<case>.json): per region
 *  [dx, dy, mad, hot]; the card's [mad, hot]; every tile's mad as one
 *  character (rows joined). */
export type BaselineCase = {
  regions: Record<string, [number, number, number, number]>;
  card: [number, number];
  tiles: string;
};

const round = (value: number, digits: number) => Number(value.toFixed(digits));

export function baselineKey(m: Pick<Measured, "id" | "size">): string {
  return `${m.id}@${m.size}`;
}

export function toBaselineCase(m: Measured): BaselineCase {
  return {
    regions: Object.fromEntries(
      Object.entries(m.regions).map(([name, r]) => [name, [r.dx, r.dy, round(r.mad, 1), round(r.hot, 3)] as [number, number, number, number]]),
    ),
    card: [round(m.card.mad, 2), round(m.card.hot, 3)],
    tiles: m.tiles.mads.map(encodeTile).join(""),
  };
}

export type OverLimit = { region: string; metric: Metric; value: number; limit: number };

/** Layer 1: every measurement of a case that is over a LIMIT. */
export function overLimits(m: Measured): OverLimit[] {
  const limits = LIMITS[m.size];
  const out: OverLimit[] = [];
  for (const [region, r] of Object.entries(m.regions)) {
    if (Math.abs(r.dx) > limits.shift) out.push({ region, metric: "dx", value: r.dx, limit: limits.shift });
    if (Math.abs(r.dy) > limits.shift) out.push({ region, metric: "dy", value: r.dy, limit: limits.shift });
    if (r.mad > limits.mad) out.push({ region, metric: "mad", value: r.mad, limit: limits.mad });
    if (r.hot > limits.hot) out.push({ region, metric: "hot", value: r.hot, limit: limits.hot });
  }
  if (m.card.mad > limits.cardMad) out.push({ region: "card", metric: "cardMad", value: m.card.mad, limit: limits.cardMad });
  if (m.tile.mad > limits.tileMad) out.push({ region: "card", metric: "tileMad", value: m.tile.mad, limit: limits.tileMad });
  return out;
}

/** The known differences that name this over-limit measurement at all. */
export function knownFor(m: Pick<Measured, "id" | "size">, over: Pick<OverLimit, "region" | "metric">): KnownDifference[] {
  return KNOWN_DIFFERENCES.filter(
    (k) => k.size === m.size && k.metric === over.metric && k.regions.includes(over.region) && k.cases.test(m.id),
  );
}

const fmt = (metric: Metric, value: number) =>
  metric === "dx" || metric === "dy" ? `${value > 0 ? "+" : ""}${value} px` : metric === "hot" ? `${(value * 100).toFixed(1)} %` : value.toFixed(1);

/** Layers 1 + 2: the over-limit measurements no known difference covers. */
export function limitFailures(m: Measured): string[] {
  const out: string[] = [];
  for (const over of overLimits(m)) {
    const known = knownFor(m, over);
    if (known.some((k) => over.value >= k.min && over.value <= k.max)) continue;
    const limit = over.metric === "dx" || over.metric === "dy" ? `±${over.limit} px` : fmt(over.metric, over.limit);
    out.push(
      known.length
        ? `${over.region}: ${over.metric} ${fmt(over.metric, over.value)} is outside the known difference "${known[0].name}" (${fmt(over.metric, known[0].min)} … ${fmt(over.metric, known[0].max)}; limit ${limit})`
        : `${over.region}: ${over.metric} ${fmt(over.metric, over.value)} is over the limit (${limit}) and no known difference names it`,
    );
  }
  return out;
}

/** The named regions a tile at (x, y) px touches — for the failure text. */
function regionsAt(m: Measured, x: number, y: number): string {
  const width = m.tiles.cols * m.tiles.tile;
  const height = (width * m.tiles.rows) / m.tiles.cols;
  const names = Object.keys(m.rects ?? {}).filter((name) => {
    const r = m.rects![name];
    return x + m.tiles.tile > r.x * width && x < (r.x + r.w) * width && y + m.tiles.tile > r.y * height && y < (r.y + r.h) * height;
  });
  return names.length ? names.join("+") : "no named region";
}

/** Layer 3: the measurements that left their recorded baseline. */
export function baselineFailures(m: Measured, base: BaselineCase | undefined): string[] {
  if (!base) return [`not in tests/parity/baseline/ for this platform — record it (npm run test:parity -- --update; CI's half: tests/parity/README.md)`];
  const out: string[] = [];
  const margin = BASELINE_MARGIN;
  for (const [region, r] of Object.entries(m.regions)) {
    const b = base.regions[region];
    if (!b) {
      out.push(`${region}: a region the baseline has not got — record it`);
      continue;
    }
    const [dx, dy, mad, hot] = b;
    if (Math.abs(r.dx - dx) > margin.shift || Math.abs(r.dy - dy) > margin.shift) {
      out.push(`${region}: the preview sits at ${r.dx},${r.dy} px against the bake — it was ${dx},${dy} (±${margin.shift})`);
    }
    if (r.mad > margin.mad(mad)) out.push(`${region}: mad ${r.mad.toFixed(1)} — it was ${mad} (at most ${margin.mad(mad).toFixed(1)})`);
    if (r.hot > margin.hot(hot)) out.push(`${region}: hot ${(r.hot * 100).toFixed(1)} % — it was ${(hot * 100).toFixed(1)} % (at most ${(margin.hot(hot) * 100).toFixed(1)} %)`);
  }
  if (m.card.mad > margin.cardMad(base.card[0])) {
    out.push(`card: mad ${m.card.mad.toFixed(2)} — it was ${base.card[0]} (at most ${margin.cardMad(base.card[0]).toFixed(2)})`);
  }
  if (typeof base.tiles !== "string" || base.tiles.length !== m.tiles.mads.length) {
    out.push("card: the baseline's tile grid is not this run's — record it");
    return out;
  }
  // The tiles that left their recorded step: the worst few, by how far.
  const moved = m.tiles.mads
    .map((mad, i) => ({ mad, i, most: margin.tileMad(decodeTile(base.tiles[i])) }))
    .filter((t) => t.mad > t.most)
    .sort((a, b) => b.mad - b.most - (a.mad - a.most));
  if (moved.length) {
    const where = moved
      .slice(0, 4)
      .map((t) => {
        const x = (t.i % m.tiles.cols) * m.tiles.tile;
        const y = Math.floor(t.i / m.tiles.cols) * m.tiles.tile;
        return `${x},${y} (${regionsAt(m, x, y)}: ${t.mad.toFixed(1)}, at most ${t.most.toFixed(1)})`;
      })
      .join("; ");
    out.push(`tiles: ${moved.length} of ${m.tiles.mads.length} differ more than recorded — ${where}`);
  }
  return out;
}

/** Everything wrong with one case. `base` is null on a platform the baseline
 *  has no section for (layers 1 and 2 still hold). */
export function judge(m: Measured, base: BaselineCase | undefined | null): string[] {
  return [...limitFailures(m), ...(base === null ? [] : baselineFailures(m, base))];
}

/** The known differences no measurement of a FULL run needs any more. */
export function staleKnownDifferences(run: readonly Measured[]): KnownDifference[] {
  return KNOWN_DIFFERENCES.filter(
    (k) => !run.some((m) => overLimits(m).some((over) => knownFor(m, over).includes(k) && over.value >= k.min && over.value <= k.max)),
  );
}
