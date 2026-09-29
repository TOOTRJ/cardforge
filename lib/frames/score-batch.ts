import {
  FRAME_COLOR_KEYS,
  frameComboKey,
  type FrameColorKey,
} from "@/lib/cards/frame-reference-registry";
import {
  pickFrameReferenceFrom,
  type PinnedReferenceRow,
} from "@/lib/cards/frame-reference-pick";
import { slotKindFor, type Rect, type SlotScore } from "@/lib/frames/align";
import {
  FRAME_TEMPLATE_SET,
  FRAME_TEMPLATE_VALUES,
  type FrameSet,
  type FrameTemplate,
} from "@/types/card";

// ---------------------------------------------------------------------------
// Verification throughput (TODO 4.12): score every colour of a template — or
// every colour of every template in a treatment — against its reference
// printing in ONE job, and read the results as a table of per-slot scores
// with the nudges they suggest.
//
// The job is POST /api/admin/frame-score-batch: the server plans the combos
// (planScoreBatch — a colour with no real printing is skipped, it can't be
// scored), scores them a couple at a time (runScoreBatch) and streams one
// NDJSON event per step, so the sign-off view shows progress as it goes.
// Every score is recorded as a "score" event exactly like the per-colour
// Score button; NOTHING here ticks a colour — publishing stays the owner's
// click (the per-colour checkbox or the template sign-off).
//
// A run that reaches its time budget stops STARTING combos, finishes the
// ones in flight and ends with the rest as `remaining`; the client store
// (components/admin/score-batch-store.ts) sends those in a follow-up request,
// so a whole treatment (up to ~120 combos) is still one click.
//
// "Batch by treatment": a treatment is a frame set (FRAME_TEMPLATE_SET — the
// Borderless, Full Art, Extended Art… families; the M15 set is the regular
// treatment). Until 4.5's overlay model exists, a kind's frame inherits its
// slots by spreading its base profile (M15BORDERLESSARTIFACT = {
// ...M15BORDERLESS }), so treatmentSlotConsensus pools the measurements of
// every template whose slot sits on the SAME rect: one measured slot, many
// kinds' colours as samples.
//
// Pure and client-safe (no server-only imports): the route, the store, the
// sign-off view and the unit tests share it.
// ---------------------------------------------------------------------------

export type ScoreBatchCombo = { template: FrameTemplate; colorKey: FrameColorKey };

export type ScoreBatchResult =
  | {
      ok: true;
      overall: number;
      global: { dxPct: number; dyPct: number; confidence: number };
      slots: Record<string, SlotScore>;
      referenceId: string;
      /** The "score" event was written — an unrecorded score can't count
       *  towards the sign-off. */
      recorded: boolean;
    }
  | { ok: false; error: string };

export type ScoreBatchSkip = ScoreBatchCombo & { reason: string };

export type ScoreBatchStop = "budget" | "cancelled" | null;

export type ScoreBatchEvent =
  | { type: "start"; combos: ScoreBatchCombo[]; skipped: ScoreBatchSkip[] }
  | ({ type: "scoring" } & ScoreBatchCombo)
  | ({ type: "result" } & ScoreBatchCombo & ScoreBatchResult)
  | {
      type: "done";
      scored: number;
      failed: number;
      /** Combos the run never started (budget reached, or cancelled). */
      remaining: ScoreBatchCombo[];
      stopped: ScoreBatchStop;
    }
  | { type: "error"; error: string };

/** Most combos one request may name: every template × colour, with room. */
export const SCORE_BATCH_MAX_COMBOS = 320;
/** Combos scored at once: each renders a card (Satori) and fetches a card
 *  and a scan from Scryfall (throttled client) — two overlap the network
 *  with the render without stacking renders in memory. */
export const SCORE_BATCH_CONCURRENCY = 2;
/** A run stops STARTING combos after this long; the route's maxDuration is
 *  300 s and one combo takes a few seconds (≤ ~60 s with Scryfall retries). */
export const SCORE_BATCH_BUDGET_MS = 200_000;

export function comboKey(combo: ScoreBatchCombo): string {
  return frameComboKey(combo.template, combo.colorKey);
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** The templates of a treatment (frame set), in the catalogue's order — the
 *  set's base frame first. */
export function templatesForTreatment(treatment: FrameSet): FrameTemplate[] {
  return FRAME_TEMPLATE_VALUES.filter((t) => FRAME_TEMPLATE_SET[t] === treatment);
}

/** Every (template, colour) of the given templates, colours in W U B R G C M
 *  order. */
export function combosForTemplates(templates: readonly FrameTemplate[]): ScoreBatchCombo[] {
  return templates.flatMap((template) =>
    FRAME_COLOR_KEYS.map((colorKey) => ({ template, colorKey })),
  );
}

/** Split the requested combos into the ones that can be scored (with the
 *  reference each is scored against — the combo's own: admin-pinned, else
 *  the registry default, like the sign-off counts it) and the ones that
 *  can't. Duplicates are dropped; order is kept. */
export function planScoreBatch(
  combos: readonly ScoreBatchCombo[],
  reviews: ReadonlyMap<string, PinnedReferenceRow>,
): { toScore: Array<ScoreBatchCombo & { referenceId: string }>; skipped: ScoreBatchSkip[] } {
  const seen = new Set<string>();
  const toScore: Array<ScoreBatchCombo & { referenceId: string }> = [];
  const skipped: ScoreBatchSkip[] = [];
  for (const combo of combos) {
    const key = comboKey(combo);
    if (seen.has(key)) continue;
    seen.add(key);
    const reference = pickFrameReferenceFrom(reviews, combo.template, combo.colorKey);
    if (!reference) {
      skipped.push({
        template: combo.template,
        colorKey: combo.colorKey,
        reason: "No real printing — walk the sample and tick it on its own.",
      });
      continue;
    }
    toScore.push({ template: combo.template, colorKey: combo.colorKey, referenceId: reference.scryfallId });
  }
  return { toScore, skipped };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Score the planned combos a few at a time, sending a "scoring" and a
 *  "result" event per combo. Stops starting new combos once `budgetMs` has
 *  passed or `isCancelled()` says so; the ones in flight always finish (their
 *  score is recorded either way). Never throws: a failing `scoreOne` becomes
 *  a failed result. */
export async function runScoreBatch<C extends ScoreBatchCombo>(input: {
  combos: readonly C[];
  scoreOne: (combo: C) => Promise<ScoreBatchResult>;
  send: (event: ScoreBatchEvent) => void;
  budgetMs?: number;
  concurrency?: number;
  now?: () => number;
  isCancelled?: () => boolean;
}): Promise<{ scored: number; failed: number; remaining: ScoreBatchCombo[]; stopped: ScoreBatchStop }> {
  const now = input.now ?? Date.now;
  const budgetMs = input.budgetMs ?? SCORE_BATCH_BUDGET_MS;
  const concurrency = Math.max(1, input.concurrency ?? SCORE_BATCH_CONCURRENCY);
  const startedAt = now();
  let next = 0;
  let scored = 0;
  let failed = 0;
  let stopped: ScoreBatchStop = null;

  const worker = async () => {
    while (next < input.combos.length && stopped === null) {
      if (input.isCancelled?.()) {
        stopped = "cancelled";
        break;
      }
      if (now() - startedAt >= budgetMs) {
        stopped = "budget";
        break;
      }
      const combo = input.combos[next];
      next += 1;
      input.send({ type: "scoring", template: combo.template, colorKey: combo.colorKey });
      let result: ScoreBatchResult;
      try {
        result = await input.scoreOne(combo);
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : "Scoring failed." };
      }
      if (result.ok && result.recorded) scored += 1;
      else failed += 1;
      input.send({ type: "result", template: combo.template, colorKey: combo.colorKey, ...result });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, input.combos.length) }, worker));

  const remaining = input.combos
    .slice(next)
    .map((c) => ({ template: c.template, colorKey: c.colorKey }));
  return { scored, failed, remaining, stopped: remaining.length > 0 ? stopped : null };
}

// ---------------------------------------------------------------------------
// The wire format — one JSON object per line
// ---------------------------------------------------------------------------

export function encodeScoreBatchEvent(event: ScoreBatchEvent): string {
  return `${JSON.stringify(event)}\n`;
}

const EVENT_TYPES = new Set(["start", "scoring", "result", "done", "error"]);

/** Incremental NDJSON decoder: feed it text chunks as they arrive, get the
 *  complete events back. Lines that aren't a known event are dropped. */
export function createScoreBatchDecoder() {
  let buffer = "";
  const parse = (line: string): ScoreBatchEvent | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const value = JSON.parse(trimmed) as { type?: unknown };
      return value && typeof value.type === "string" && EVENT_TYPES.has(value.type)
        ? (value as ScoreBatchEvent)
        : null;
    } catch {
      return null;
    }
  };
  return {
    push(chunk: string): ScoreBatchEvent[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.map(parse).filter((e): e is ScoreBatchEvent => e !== null);
    },
    flush(): ScoreBatchEvent[] {
      const last = parse(buffer);
      buffer = "";
      return last ? [last] : [];
    },
  };
}

// ---------------------------------------------------------------------------
// Reading results: recorded scores, nudges, consensus
// ---------------------------------------------------------------------------

export type RecordedScoreDetail = {
  overall: number;
  global: { dxPct: number; dyPct: number; confidence: number } | null;
  slots: Record<string, SlotScore>;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The overall, registration and per-slot scores a "score" (or scored
 *  "verify") event recorded, or null when it holds no score. Slots that
 *  don't read as a SlotScore are dropped. */
export function parseRecordedScore(scoreJson: unknown): RecordedScoreDetail | null {
  if (!scoreJson || typeof scoreJson !== "object") return null;
  const json = scoreJson as { overall?: unknown; global?: unknown; slots?: unknown };
  if (!isNum(json.overall)) return null;
  const g = json.global as { dxPct?: unknown; dyPct?: unknown; confidence?: unknown } | undefined;
  const global =
    g && isNum(g.dxPct) && isNum(g.dyPct) && isNum(g.confidence)
      ? { dxPct: g.dxPct, dyPct: g.dyPct, confidence: g.confidence }
      : null;
  const slots: Record<string, SlotScore> = {};
  if (json.slots && typeof json.slots === "object") {
    for (const [path, raw] of Object.entries(json.slots as Record<string, unknown>)) {
      const s = raw as Partial<SlotScore> | null;
      if (s && isNum(s.score) && isNum(s.best) && isNum(s.dxPct) && isNum(s.dyPct)) {
        slots[path] = { score: s.score, best: s.best, dxPct: s.dxPct, dyPct: s.dyPct };
      }
    }
  }
  return { overall: json.overall, global, slots };
}

/** A slot whose local search found a better place: the nudge is worth
 *  showing (the same test as the compare view's "Apply nudge"). */
export function slotWantsNudge(slot: SlotScore): boolean {
  return (slot.dxPct !== 0 || slot.dyPct !== 0) && slot.best < slot.score;
}

export type ConsensusNudge = {
  /** Suggested move for the TEMPLATE (its layout override moves every
   *  colour at once), percent of the card. */
  dxPct: number;
  dyPct: number;
  /** Samples whose own nudge points the same way on every moved axis. */
  agree: number;
  /** Samples considered. */
  of: number;
  /** Mean slot score now, and mean at each sample's own best shift. */
  meanScore: number;
  meanBest: number;
};

const round1 = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? 0 : r;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The nudge most samples of one slot agree on — each colour's scan is a
 *  vote, and a colour whose search found nothing better votes "stay". The
 *  median per axis (so one odd scan can't drag it), kept only when a strict
 *  majority points the same way; null = leave the slot where it is. */
export function consensusNudge(samples: readonly SlotScore[], minPct = 0.1): ConsensusNudge | null {
  if (samples.length === 0) return null;
  const moves = samples.map((s) => (slotWantsNudge(s) ? { dx: s.dxPct, dy: s.dyPct } : { dx: 0, dy: 0 }));
  const dx = round1(median(moves.map((m) => m.dx)));
  const dy = round1(median(moves.map((m) => m.dy)));
  const useDx = Math.abs(dx) >= minPct ? dx : 0;
  const useDy = Math.abs(dy) >= minPct ? dy : 0;
  if (useDx === 0 && useDy === 0) return null;
  const agree = moves.filter(
    (m) =>
      (useDx === 0 || Math.sign(m.dx) === Math.sign(useDx)) &&
      (useDy === 0 || Math.sign(m.dy) === Math.sign(useDy)),
  ).length;
  if (agree * 2 <= samples.length) return null;
  const mean = (values: number[]) => round1(values.reduce((a, b) => a + b, 0) / values.length);
  return {
    dxPct: useDx,
    dyPct: useDy,
    agree,
    of: samples.length,
    meanScore: mean(samples.map((s) => s.score)),
    meanBest: mean(samples.map((s) => s.best)),
  };
}

export type SharedSlotRow = {
  path: string;
  /** Templates of the treatment that draw this slot on the same rect. */
  templates: string[];
  /** Current colour scores pooled across those templates. */
  samples: number;
  meanScore: number;
  nudge: ConsensusNudge | null;
};

/** Stable key for a slot rect (0.01 % of the card). */
export function rectKey(rect: Rect): string {
  return [rect.topPct, rect.leftPct, rect.widthPct, rect.heightPct].map((v) => v.toFixed(2)).join("|");
}

/** Treatment batching: the slots two or more templates of a treatment draw
 *  on the SAME rect (a kind's frame spreading its base profile) are one
 *  measured slot — pool every current colour score of those templates and
 *  suggest one nudge for all of them. Art windows are left out (they're
 *  never nudged). Rows follow the order slots first appear. */
export function treatmentSlotConsensus(
  inputs: ReadonlyArray<{
    template: string;
    rects: Readonly<Record<string, Rect>>;
    /** One entry per colour whose score counts today. */
    scores: ReadonlyArray<Readonly<Record<string, SlotScore>>>;
  }>,
): SharedSlotRow[] {
  const groups = new Map<string, { path: string; templates: string[]; samples: SlotScore[] }>();
  for (const input of inputs) {
    for (const [path, rect] of Object.entries(input.rects)) {
      if (slotKindFor(path) === "art") continue;
      const key = `${path}@${rectKey(rect)}`;
      const group = groups.get(key) ?? { path, templates: [], samples: [] };
      group.templates.push(input.template);
      for (const colour of input.scores) {
        const slot = colour[path];
        if (slot) group.samples.push(slot);
      }
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .filter((g) => g.templates.length >= 2)
    .map((g) => ({
      path: g.path,
      templates: g.templates,
      samples: g.samples.length,
      meanScore:
        g.samples.length === 0
          ? 0
          : round1(g.samples.reduce((a, s) => a + s.score, 0) / g.samples.length),
      nudge: consensusNudge(g.samples),
    }));
}

/** "+0.2" / "−0.1" / "0" — the sign-off's nudge notation (true minus). */
export function formatNudgePct(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}
