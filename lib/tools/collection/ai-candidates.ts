import type { CollectionCard } from "./card-row";
import { cardThemes, eligiblePool, isLand, roleOf, type DeckRole, type DraftPlan } from "./builder";

// ---------------------------------------------------------------------------
// What the AI build is shown (pure, tested): a balanced slice of the user's
// eligible cards — the drafter's ranking, but with room kept for each role
// the deck needs (a collection of 3,000 creatures still shows the model its
// ramp, draw and removal), lands apart — each card under a short id ("c12",
// never a bare number beside a mana value), and the way back from the
// model's ids to collection rows.
// ---------------------------------------------------------------------------

/** Most spells / lands one prompt lists (a 25,000-card collection would not
 *  fit a prompt; the ranking and the role quotas pick which). */
export const AI_MAX_SPELLS = 250;
export const AI_MAX_LANDS = 60;
/** Below this many eligible cards the AI has nothing to choose between:
 *  the route refuses before any charge. */
export const AI_MIN_POOL = 30;

/** Spells kept for each role before the rest of the list fills by the
 *  ranking (numbers to tune; the deck itself wants about 10 / 10 / 8 / 3). */
export const AI_ROLE_QUOTAS: Record<"ramp" | "draw" | "removal" | "wipe", number> = {
  ramp: 30,
  draw: 30,
  removal: 30,
  wipe: 12,
};

/** With a deck type or creature type picked, this many on-type spells are
 *  kept first (the type's whole point), before the role quotas. */
export const AI_THEME_QUOTA = 110;

/** Candidates are shuffled within runs of this many, in ranking order: a
 *  model favours what it reads first, so each build sees a fresh order of
 *  equally good cards, while the best still come before the rest. */
export const AI_SHUFFLE_TIER = 40;

function shuffledWithinTiers<T>(items: readonly T[], tier: number, random: () => number): T[] {
  const out: T[] = [];
  for (let start = 0; start < items.length; start += tier) {
    const chunk = items.slice(start, start + tier);
    for (let i = chunk.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [chunk[i], chunk[j]] = [chunk[j], chunk[i]];
    }
    out.push(...chunk);
  }
  return out;
}

/**
 * The cards one AI build is shown, spells then lands — under the plan's
 * bracket rules and ranking when there is one. With `random` the order is
 * shuffled within ranking tiers (each build); without it, the ranking's
 * order (the route's pool-size check, tests).
 */
export function aiCandidates(
  commander: CollectionCard,
  collection: readonly CollectionCard[],
  options: { random?: () => number; plan?: DraftPlan | null } = {},
): CollectionCard[] {
  const { random, plan = null } = options;
  const pool = eligiblePool(commander, collection, plan);
  const spells = pool.filter((c) => !isLand(c));
  const lands = pool.filter((c) => isLand(c)).slice(0, AI_MAX_LANDS);

  const kept = new Set<string>();
  const onPlan = (card: CollectionCard) => !!(plan?.type?.matches(card) || plan?.tribe?.matches(card));
  if (plan?.type || plan?.tribe) {
    for (const card of spells) {
      if (kept.size >= AI_THEME_QUOTA) break;
      if (onPlan(card)) kept.add(card.id);
    }
  }
  for (const [role, quota] of Object.entries(AI_ROLE_QUOTAS) as Array<[DeckRole, number]>) {
    let taken = 0;
    for (const card of spells) {
      if (taken >= quota || kept.size >= AI_MAX_SPELLS) break;
      if (roleOf(card) !== role || kept.has(card.id)) continue;
      kept.add(card.id);
      taken += 1;
    }
  }
  for (const card of spells) {
    if (kept.size >= AI_MAX_SPELLS) break;
    kept.add(card.id);
  }
  // In the ranking's order: the quota cards sit where they rank.
  const chosen = spells.filter((c) => kept.has(c.id));
  if (!random) return [...chosen, ...lands];
  return [...shuffledWithinTiers(chosen, AI_SHUFFLE_TIER, random), ...shuffledWithinTiers(lands, AI_SHUFFLE_TIER, random)];
}

function oneLine(text: string | null, max: number): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The rules' reading of a card, in the words the answer's role uses. */
const ROLE_HINT: Record<DeckRole, string> = {
  ramp: "ramp",
  draw: "draw",
  removal: "removal",
  wipe: "wipe",
  land: "land",
  core: "—",
};

/** A candidate's id in the prompt: "c12". */
export function candidateId(index: number): string {
  return `c${index}`;
}

/**
 * "c12 | Sol Ring | mv1 | Artifact | role: ramp | themes: — | {T}: Add {C}{C}."
 * — one card a line: the drafter's own read of its role and themes (hints
 * the model may overrule), the text cut short (the gist is enough; the
 * prompt stays small).
 */
export function aiCandidateLines(candidates: readonly CollectionCard[]): string {
  return candidates
    .map((c, i) => {
      const themes = isLand(c) ? [] : cardThemes(c);
      return [
        candidateId(i),
        oneLine(c.name, 80),
        `mv${c.manaValue ?? 0}`,
        oneLine(c.typeLine, 60),
        `role: ${ROLE_HINT[roleOf(c)]}`,
        `themes: ${themes.length ? themes.join(", ") : "—"}`,
        oneLine(c.oracleText, 160),
      ].join(" | ");
    })
    .join("\n");
}

/** The model's ids → collection row ids, in its order. An id off the list
 *  or named twice is dropped — and counted, so a bad answer can be told
 *  apart from a short one. */
export function picksFromIds(
  ids: readonly string[],
  candidates: readonly CollectionCard[],
): { rowIds: string[]; unknown: number } {
  const seen = new Set<number>();
  const rowIds: string[] = [];
  let unknown = 0;
  for (const raw of ids) {
    const match = /^c(\d{1,4})$/i.exec(String(raw).trim());
    const i = match ? Number(match[1]) : -1;
    if (i < 0 || i >= candidates.length) {
      unknown += 1;
      continue;
    }
    if (seen.has(i)) continue;
    seen.add(i);
    rowIds.push(candidates[i].id);
  }
  return { rowIds, unknown };
}
