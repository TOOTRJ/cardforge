import { typedForMatching } from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// Design variety — why two AI cards with the same options are never the
// same card (2026-10-28).
//
// The design model is asked at temperature 0.9, but an IDENTICAL prompt
// still collapses onto the same design: the creator's "Start with AI" tile
// ticks every field, so a blank form sends the same words every time, and
// the owner got the same card twice (two jobs, 93 s apart on production;
// only the frame differed, because "random" frame is drawn per job). A
// temperature alone never fixes that.
//
// Every single-card design (the per-field fill, the single-card job, the
// "Get ideas" batch) therefore carries:
//   - a fresh SPARK: a random setting, subject angle and mechanical angle
//     plus a nonce, so no two prompts are the same — inspiration only, below
//     every pinned value and the user's own theme;
//   - the user's RECENT AI titles, named as off-limits, so the model doesn't
//     hand back a design it already gave them;
// and the caller re-designs ONCE (plan time, before any credit is reserved)
// when a fresh title still repeats a recent one (`repeatsRecentTitle`).
//
// Pure: no Supabase, no AI SDK — the recent titles are read by the caller.
// ---------------------------------------------------------------------------

/** Where the card's story is set. Original, generic fantasy — no Wizards or
 *  real-world proper nouns. */
export const VARIETY_SETTINGS = [
  "a drowned cathedral city",
  "a canyon of singing glass",
  "a floating market above the clouds",
  "a frozen battlefield where time stopped",
  "a jungle growing over a fallen colossus",
  "a clockwork monastery",
  "a desert of bone-white salt",
  "a lantern-lit swamp village",
  "a library that rewrites itself at night",
  "an orchard tended by giants",
  "a volcanic forge-island",
  "a coral fortress in a dying sea",
  "a moonlit graveyard of ships",
  "a mountain pass guarded by statues",
  "a city built inside a sleeping beast",
  "a storm-wracked lighthouse chain",
  "a mirrored court of masks",
  "a moss-covered ruin of a sky empire",
  "a caravan crossing a sea of dunes",
  "a hedge maze that hunts trespassers",
  "a cavern lit by fungal stars",
  "an academy of rival elementalists",
  "a borderland of warring tribes",
  "a plague-quiet harbour town",
  "a celestial observatory on a peak",
  "a marsh where the dead keep shops",
  "a tundra of migrating mammoths",
  "a tower that grows a floor each dawn",
  "a river of molten copper",
  "a carnival that appears at midnight",
] as const;

/** Who or what the card is about. */
export const VARIETY_SUBJECTS = [
  "an unlikely hero",
  "a cunning trickster",
  "a weary veteran",
  "a reckless apprentice",
  "a monstrous guardian",
  "a swarm acting as one",
  "a forbidden ritual",
  "a cursed heirloom",
  "a sudden betrayal",
  "a desperate bargain",
  "a joyful celebration",
  "an ancient treaty",
  "a beast of burden turned hunter",
  "a sacred place under siege",
  "a machine that dreams",
  "a twin pair of rivals",
  "a mentor and their student",
  "a smuggler's secret cargo",
  "a storm given a will",
  "a quiet act of mercy",
  "a doomed last stand",
  "a prophecy gone wrong",
  "an elder spirit waking",
  "a thief of memories",
  "a pilgrimage's end",
] as const;

/** A mechanical angle — the design space to explore, not a rule. */
export const VARIETY_MECHANICS = [
  "a trigger on entering or leaving the battlefield",
  "an activated ability with a real cost",
  "a payoff for casting noncreature spells",
  "graveyard recursion with a catch",
  "token making",
  "+1/+1 counters",
  "a modal choice",
  "card draw with a drawback",
  "life gain or life payment",
  "combat tricks and blocking",
  "sacrifice as a resource",
  "mana ramp or fixing",
  "a cost reduction",
  "an upkeep or end-step trigger",
  "copying or redirecting",
  "tapping and untapping",
  "a keyword with a twist",
  "punishing the opponent's choices",
  "a slow-building engine",
  "a one-shot dramatic effect",
] as const;

/** At most this many recent titles are named as off-limits. */
export const VARIETY_AVOID_MAX = 15;

export type DesignVariety = {
  /** Random token: no two prompts are ever byte-identical. */
  nonce: string;
  setting: string;
  subject: string;
  mechanic: string;
  /** Recent titles the design must not reuse (deduplicated, capped). */
  avoidTitles: string[];
};

const pick = <T>(list: readonly T[], random: () => number): T =>
  list[Math.floor(random() * list.length) % list.length];

function randomNonce(random: () => number): string {
  return Array.from({ length: 8 }, () => Math.floor(random() * 16).toString(16)).join("");
}

/** A fresh variety block for one design. `random` is injectable for tests. */
export function designVariety(
  recentTitles: readonly string[] = [],
  random: () => number = Math.random,
): DesignVariety {
  const seen = new Set<string>();
  const avoidTitles: string[] = [];
  for (const raw of recentTitles) {
    const title = raw?.trim();
    if (!title) continue;
    const key = foldTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);
    avoidTitles.push(title.slice(0, 80));
    if (avoidTitles.length >= VARIETY_AVOID_MAX) break;
  }
  return {
    nonce: randomNonce(random),
    setting: pick(VARIETY_SETTINGS, random),
    subject: pick(VARIETY_SUBJECTS, random),
    mechanic: pick(VARIETY_MECHANICS, random),
    avoidTitles,
  };
}

/**
 * The prompt lines for a variety block. The spark is inspiration ONLY: a
 * pinned value, a requested card type / colour / rarity and the user's own
 * theme all win over it (the note says so, so a fill never rewrites what
 * the maker kept).
 */
export function varietyPromptLines(variety: DesignVariety): string[] {
  const lines = [
    `Fresh design #${variety.nonce}: this must be a NEW card, unlike any obvious first idea. Spark (inspiration only — every pinned value, requested type, colour, rarity and the theme above win over it): ${variety.setting}; ${variety.subject}; ${variety.mechanic}.`,
  ];
  if (variety.avoidTitles.length > 0) {
    lines.push(
      `This user already received these AI cards — do NOT reuse or echo their names or concepts: ${variety.avoidTitles
        .map((title) => `"${title.replace(/"/g, "'")}"`)
        .join(", ")}.`,
    );
  }
  return lines;
}

/** A title as people type it, folded for comparison (curly quotes, case,
 *  spacing) — the same fold every typed-vs-stored title match uses. */
export function foldTitle(title: string): string {
  return typedForMatching(title).trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when a freshly designed title repeats one of the recent ones. */
export function repeatsRecentTitle(title: string | null | undefined, recent: readonly string[]): boolean {
  if (!title?.trim()) return false;
  const key = foldTitle(title);
  return recent.some((other) => other?.trim() && foldTitle(other) === key);
}

/** A design the caller can't use (its `acceptable` check failed twice) —
 *  today a card type with no published frame. Plan time: nothing reserved. */
export class DesignNotUsableError extends Error {
  readonly code = "type_unavailable" as const;
  constructor() {
    super("The design came back as a card that can't be made here yet.");
    this.name = "DesignNotUsableError";
  }
}

/**
 * Design with a fresh variety block; when the result's title still repeats
 * a recent one — or the caller can't use it (`acceptable`) — design ONCE
 * more with another spark and that title added to the avoid list. Plan time
 * only: nothing is reserved yet, so the second call costs the user nothing.
 *
 *   - a second answer that still repeats a title is kept (its spark and
 *     avoid list differ; a title alone never fails a generation);
 *   - a second call that throws keeps a usable first answer;
 *   - no usable answer at all throws DesignNotUsableError.
 */
export async function designFreshly<T>(
  recentTitles: readonly string[],
  design: (variety: DesignVariety) => Promise<T>,
  titleOf: (result: T) => string | null | undefined,
  options: {
    acceptable?: (result: T) => boolean;
    /** A looser test, read only when NEITHER answer is `acceptable`: the
     *  first answer that passes it is kept rather than refused (frame-first
     *  design: a card that follows its own words onto a dress of the frame
     *  picked). Without it, no usable answer throws, as before. */
    fallbackAcceptable?: (result: T) => boolean;
    random?: () => number;
    /** Whether a second design still fits the caller's time budget, given
     *  how long the first took (a sync route: structured-output.ts
     *  retryFitsBudget). Without it a second design is always allowed. */
    secondFits?: (firstMs: number) => boolean;
  } = {},
): Promise<T> {
  const random = options.random ?? Math.random;
  const usable = (result: T) => options.acceptable?.(result) ?? true;
  const startedAt = Date.now();
  const first = await design(designVariety(recentTitles, random));
  const firstTitle = titleOf(first);
  if (usable(first) && !repeatsRecentTitle(firstTitle, recentTitles)) return first;
  const kept = (...results: T[]): T => {
    const loose = options.fallbackAcceptable;
    const found = loose ? results.find((result) => loose(result)) : undefined;
    if (found !== undefined) return found;
    throw new DesignNotUsableError();
  };
  if (options.secondFits && !options.secondFits(Date.now() - startedAt)) {
    if (usable(first)) return first;
    return kept(first);
  }
  let second: T;
  try {
    second = await design(designVariety([firstTitle ?? "", ...recentTitles], random));
  } catch (error) {
    if (usable(first)) return first;
    if (options.fallbackAcceptable?.(first)) return first;
    throw error;
  }
  if (usable(second)) return second;
  if (usable(first)) return first;
  return kept(second, first);
}
