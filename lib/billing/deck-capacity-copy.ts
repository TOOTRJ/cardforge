import {
  CAPPED_DECK_VISIBILITIES,
  CARD_CAPACITY_UNLIMITED,
  type PlanTier,
} from "@/lib/billing/plans";
import type { CapacityMessage } from "@/lib/billing/capacity-copy";

// ---------------------------------------------------------------------------
// Private-deck capacity, as words (owner decision D1, 2026-10-28: Free 1,
// Plus 3, Pro unlimited PRIVATE or UNLISTED decks; public decks unlimited on
// every plan). Client-safe (no server imports) so the deck create flow, the
// deck details form, My Decks and — later — the account menu say the same
// thing about the same numbers. The database enforces the cap (migration
// 0145); this is the friendly layer in front of it, like capacity-copy.ts is
// for saved cards.
// ---------------------------------------------------------------------------

export type DeckCapacity = {
  /** The owner's private + unlisted decks (grandfathered ones included). */
  used: number;
  /** The plan cap, or CARD_CAPACITY_UNLIMITED (the shared sentinel). */
  cap: number;
  /** The tier the cap comes from (after comps). */
  tier: PlanTier;
};

const TIER_NAME: Record<PlanTier, string> = { free: "Free", plus: "Plus", pro: "Pro" };

/** True for a visibility the cap counts — private or unlisted, never public. */
export function deckCountsTowardCap(visibility: string): boolean {
  return (CAPPED_DECK_VISIBILITIES as readonly string[]).includes(visibility);
}

export function remainingDeckCapacity(capacity: DeckCapacity): number | null {
  if (capacity.cap === CARD_CAPACITY_UNLIMITED) return null;
  return Math.max(0, capacity.cap - capacity.used);
}

/** Private decks held BEYOND the cap — a lapsed plan keeps every deck (the
 *  trigger checks only a deck that joins the count), so this is the honest
 *  number instead of "3 of 1". */
export function overDeckCapacity(capacity: DeckCapacity): number {
  if (capacity.cap === CARD_CAPACITY_UNLIMITED) return 0;
  return Math.max(0, capacity.used - capacity.cap);
}

/** No room for one more private or unlisted deck. */
export function deckCapacityFull(capacity: DeckCapacity | null): boolean {
  if (!capacity) return false;
  const remaining = remainingDeckCapacity(capacity);
  return remaining !== null && remaining === 0;
}

/** Would making a deck `visibility` be refused? Only a capped visibility on
 *  a full plan — a public deck never is. `alreadyCounted` is true for a deck
 *  that is private or unlisted already (switching between the two adds
 *  nothing). */
export function deckCapBlocks(
  capacity: DeckCapacity | null,
  visibility: string,
  alreadyCounted = false,
): boolean {
  return !alreadyCounted && deckCountsTowardCap(visibility) && deckCapacityFull(capacity);
}

/** "Private decks: 1 of 1" — the meter's label; null on an unlimited plan. */
export function deckUsageLabel(capacity: DeckCapacity | null): string | null {
  if (!capacity || capacity.cap === CARD_CAPACITY_UNLIMITED) return null;
  return `Private decks: ${capacity.used} of ${capacity.cap}`;
}

const decks = (n: number) => `${n} private or unlisted deck${n === 1 ? "" : "s"}`;

/**
 * The always-on meter's sentence, read after its label ("Private decks: 1
 * of 1") — so it never repeats the two numbers. null on an unlimited plan.
 */
export function describeDeckUsage(capacity: DeckCapacity | null): CapacityMessage | null {
  if (!capacity) return null;
  const remaining = remainingDeckCapacity(capacity);
  if (remaining === null) return null;
  const plan = TIER_NAME[capacity.tier];
  const over = overDeckCapacity(capacity);
  if (over > 0) {
    return {
      tone: "danger",
      message: `${over} over ${plan}'s ${capacity.cap} — they're safe and stay editable, but a new private deck needs room. Public decks are unlimited.`,
    };
  }
  if (remaining === 0) {
    return { tone: "danger", message: `All in use on ${plan}. Public decks are unlimited.` };
  }
  return {
    // Small caps: the warning is the last slot of more than one (Plus at 2
    // of 3); Free's single slot reads as plain information until it's used.
    tone: remaining === 1 && capacity.cap > 1 ? "warning" : "info",
    message: `${remaining} left on ${plan}. Public decks are unlimited.`,
  };
}

/**
 * What to say before a deck is made (or turned) `visibility`. null = nothing
 * worth saying: a public deck, an unlimited plan, or room to spare.
 * `alreadyCounted` as in deckCapBlocks.
 */
export function describeDeckCapacity(
  capacity: DeckCapacity | null,
  visibility: string,
  alreadyCounted = false,
): CapacityMessage | null {
  if (!capacity || alreadyCounted || !deckCountsTowardCap(visibility)) return null;
  const remaining = remainingDeckCapacity(capacity);
  if (remaining === null) return null;
  const plan = TIER_NAME[capacity.tier];
  if (remaining === 0) {
    const over = overDeckCapacity(capacity);
    return {
      tone: "danger",
      message:
        over > 0
          ? `You have ${decks(capacity.used)}, more than ${plan}'s ${capacity.cap}. Make this deck public, or free a private slot — make another deck public or delete one — or upgrade.`
          : `${plan} includes ${decks(capacity.cap)}, and yours ${capacity.cap === 1 ? "is" : "are"} in use. Make this deck public, or free a slot — make another deck public or delete one — or upgrade.`,
    };
  }
  if (remaining === 1) {
    return {
      tone: "warning",
      message: `This uses your last private deck on ${plan} (${capacity.used + 1} of ${capacity.cap}). Public decks are unlimited.`,
    };
  }
  return null;
}

/** The Postgres error raised by migration 0145's trigger. */
export function isDeckCapacityViolation(message: string | null | undefined): boolean {
  return typeof message === "string" && message.includes("deck_capacity_exceeded");
}

/** The refusal's words (the action's formError, the toast). */
export function deckCapacityRefusal(capacity: Pick<DeckCapacity, "cap" | "tier"> | null): string {
  if (!capacity || capacity.cap === CARD_CAPACITY_UNLIMITED) {
    return "Your plan's private decks are all in use. Make this deck public, make another one public or delete it, or upgrade.";
  }
  return `${TIER_NAME[capacity.tier]} includes ${decks(capacity.cap)}, and ${capacity.cap === 1 ? "yours is" : "yours are"} in use. Make this deck public, make another one public or delete it, or upgrade.`;
}
