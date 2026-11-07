import type { CollectionCard } from "./card-row";
import { eligiblePool, isLand } from "./builder";

// ---------------------------------------------------------------------------
// What the AI build is shown (pure, tested): the rules' best eligible cards,
// numbered — spells and lands apart so a pool of 3,000 creatures still shows
// the model the lands — and the way back from its numbers to rows.
// ---------------------------------------------------------------------------

/** Most spells / lands one prompt lists (a 25,000-card collection would not
 *  fit a prompt; the rules' ranking picks which). */
export const AI_MAX_SPELLS = 360;
export const AI_MAX_LANDS = 60;
/** Below this many eligible cards the AI has nothing to choose between:
 *  the route refuses before any charge. */
export const AI_MIN_POOL = 30;

export function aiCandidates(commander: CollectionCard, collection: readonly CollectionCard[]): CollectionCard[] {
  const pool = eligiblePool(commander, collection);
  const spells = pool.filter((c) => !isLand(c)).slice(0, AI_MAX_SPELLS);
  const lands = pool.filter((c) => isLand(c)).slice(0, AI_MAX_LANDS);
  return [...spells, ...lands];
}

function oneLine(text: string | null, max: number): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** "12 | Sol Ring | 1 | Artifact | {T}: Add {C}{C}." — one card a line;
 *  the text cut short (the model needs the gist, the prompt stays small). */
export function aiCandidateLines(candidates: readonly CollectionCard[]): string {
  return candidates
    .map((c, i) =>
      [i, oneLine(c.name, 80), c.manaValue ?? 0, oneLine(c.typeLine, 60), oneLine(c.oracleText, 160)].join(" | "),
    )
    .join("\n");
}

/** The model's numbers → collection row ids, in its order; a number off the
 *  list or named twice is dropped. */
export function picksFromIndexes(indexes: readonly number[], candidates: readonly CollectionCard[]): string[] {
  const seen = new Set<number>();
  const ids: string[] = [];
  for (const i of indexes) {
    if (!Number.isInteger(i) || i < 0 || i >= candidates.length || seen.has(i)) continue;
    seen.add(i);
    ids.push(candidates[i].id);
  }
  return ids;
}
