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
//   3. tests/parity/baseline.json — every region's offset as recorded on the
//      platform the run is on. Today's offset must be within ±1 px of it and
//      its difference within BASELINE_MARGIN: a text 2 px from where it was
//      is caught whichever way it moved, including "towards the bake" (a
//      one-sided limit would let a preview-only nudge through whenever it
//      happens to cancel a known offset). Re-record it with
//      `npm run test:parity -- --update` (CI's numbers: the `parity-baseline`
//      artifact) — the update refuses a value over a LIMIT that no known
//      difference names.
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

export const LIMITS: Record<SizeName, Limits> = {
  "750": { shift: 2, mad: 24, hot: 0.2, cardMad: 7.5, tileMad: 95 },
  hd: { shift: 2, mad: 18, hot: 0.16, cardMad: 5.8, tileMad: 65 },
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

/** Every text slot a profile can name (tests/parity/regions.ts). */
const TEXT_REGIONS = ["title", "cost", "type", "symbol", "rules", "stat", "second.title", "second.type", "second.rules", "page.title", "page.rules"] as const;

export const KNOWN_DIFFERENCES: readonly KnownDifference[] = [
  {
    name: "hd-text-rise",
    size: "hd",
    cases: /./,
    regions: TEXT_REGIONS,
    metric: "dy",
    min: -3,
    max: -3,
    why: "PROVISIONAL",
  },
  { name: "750-cost-row", size: "750", cases: /^m15(borderless|textless)?\//, regions: ["cost"], metric: "dx", min: -4, max: -3, why: "PROVISIONAL" },
  { name: "750-emblem-title", size: "750", cases: /^emblem\//, regions: ["cost"], metric: "dx", min: 3, max: 5, why: "PROVISIONAL" },
  { name: "750-emblem-title-mad", size: "750", cases: /^emblem\//, regions: ["cost"], metric: "mad", min: 0, max: 30, why: "PROVISIONAL" },
  { name: "750-emblem-title-hot", size: "750", cases: /^emblem\//, regions: ["cost"], metric: "hot", min: 0, max: 0.24, why: "PROVISIONAL" },
  { name: "750-retro-type-line", size: "750", cases: /^retro\//, regions: ["symbol"], metric: "dx", min: 4, max: 6, why: "PROVISIONAL" },
  { name: "750-token-flavour-end", size: "750", cases: /^m15tokentext\//, regions: ["stat"], metric: "dx", min: -4, max: -3, why: "PROVISIONAL" },
  { name: "750-footer", size: "750", cases: /^(agclassic|m15tokentext)\//, regions: ["footer"], metric: "dx", min: 3, max: 3, why: "PROVISIONAL" },
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

/** One case as tests/parity/baseline.json records it: per region
 *  [dx, dy, mad, hot]; the card's [mad, hot]; every tile's mad as one
 *  character (rows joined). */
export type BaselineCase = {
  regions: Record<string, [number, number, number, number]>;
  card: [number, number];
  tiles: string;
};

export type BaselineFile = {
  note: string;
  platforms: Record<string, { recorded: string; cases: Record<string, BaselineCase> }>;
};

/** The baseline file's text: one line per case, so a re-record reads as a
 *  list of the cases that moved. */
export function serializeBaseline(file: BaselineFile): string {
  const platforms = Object.keys(file.platforms)
    .sort()
    .map((name) => {
      const platform = file.platforms[name];
      const cases = Object.keys(platform.cases)
        .sort()
        .map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(platform.cases[key])}`)
        .join(",\n");
      return `  ${JSON.stringify(name)}: {\n   "recorded": ${JSON.stringify(platform.recorded)},\n   "cases": {\n${cases}\n   }\n  }`;
    })
    .join(",\n");
  return `{\n "note": ${JSON.stringify(file.note)},\n "platforms": {\n${platforms}\n }\n}\n`;
}

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
  if (!base) return [`not in tests/parity/baseline.json for this platform — record it (npm run test:parity -- --update)`];
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
