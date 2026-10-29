import { CARD_CAPACITY_UNLIMITED, type PlanTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Saved-card capacity, as words. Client-safe (no server imports) so the
// creator, the deck wizard, the in-deck AI panel and My Cards all say the
// same thing about the same numbers.
// ---------------------------------------------------------------------------

export type CardCapacity = {
  /** Cards the user has saved (drafts count — they are rows). */
  used: number;
  /** The plan cap, or CARD_CAPACITY_UNLIMITED. */
  cap: number;
  /** The tier the cap comes from (after comps + overrides). */
  tier: PlanTier;
};

/** Soft warning once this few slots remain. */
export const CAPACITY_WARN_AT = 5;

const TIER_NAME: Record<PlanTier, string> = { free: "Free", plus: "Plus", pro: "Pro" };

export function remainingCapacity(capacity: CardCapacity): number | null {
  if (capacity.cap === CARD_CAPACITY_UNLIMITED) return null;
  return Math.max(0, capacity.cap - capacity.used);
}

/** How many cards the user holds BEYOND the cap — a lapsed Plus/Pro
 *  subscriber keeps every card (the capacity trigger fires on insert only),
 *  so this is the honest number to show instead of "212 of 50 used". */
export function overCapacity(capacity: CardCapacity): number {
  if (capacity.cap === CARD_CAPACITY_UNLIMITED) return 0;
  return Math.max(0, capacity.used - capacity.cap);
}

export type CapacityMessage = {
  tone: "danger" | "warning" | "info";
  message: string;
};

/**
 * What to tell the user before an action that would add `adding` cards.
 * null = nothing worth saying (unlimited plan, or plenty of room).
 */
export function describeCapacity(
  capacity: CardCapacity | null,
  adding: number,
): CapacityMessage | null {
  if (!capacity) return null;
  const remaining = remainingCapacity(capacity);
  if (remaining === null) return null;
  const cap = capacity.cap.toLocaleString("en-US");
  const plan = TIER_NAME[capacity.tier];
  const slots = (n: number) => `${n} slot${n === 1 ? "" : "s"}`;

  const over = overCapacity(capacity);
  if (over > 0) {
    // Over the cap (a lapsed plan, or an admin override that was lowered):
    // the cards are safe; only new saves are blocked.
    const room = (over + adding).toLocaleString("en-US");
    return {
      tone: "danger",
      message: `You have ${capacity.used.toLocaleString("en-US")} cards — ${over.toLocaleString("en-US")} over your ${plan} plan's ${cap}-card limit. They're safe, but ${
        adding <= 1 ? "saving this card" : `adding ${adding} cards`
      } needs room: delete ${room} card${over + adding === 1 ? "" : "s"}, or move to a plan with space.`,
    };
  }
  if (remaining === 0) {
    return {
      tone: "danger",
      message:
        adding <= 1
          ? `Your ${plan} plan's ${cap}-card limit is full — saving this card will fail until you delete a card or upgrade.`
          : `Your ${plan} plan's ${cap}-card limit is full — this can't add ${adding} cards until you delete some or upgrade.`,
    };
  }
  if (adding > remaining) {
    return {
      tone: "danger",
      message: `Adding ${adding} cards would take you over your ${plan} plan's ${cap}-card limit — you have ${slots(remaining)} left. Generate ${remaining} or fewer, delete cards, or upgrade.`,
    };
  }
  if (remaining - adding <= CAPACITY_WARN_AT) {
    const after = remaining - adding;
    return {
      tone: "warning",
      message:
        after === 0
          ? `This uses the last of your ${cap} card slots on ${plan}.`
          : `${slots(after)} left on your ${plan} plan after this (${capacity.used + adding} of ${cap}).`,
    };
  }
  return null;
}

/** The always-on usage line for My Cards. */
export function describeUsage(capacity: CardCapacity | null): CapacityMessage | null {
  if (!capacity) return null;
  const remaining = remainingCapacity(capacity);
  if (remaining === null) return null;
  const cap = capacity.cap.toLocaleString("en-US");
  const plan = TIER_NAME[capacity.tier];
  const over = overCapacity(capacity);
  if (over > 0) {
    return {
      tone: "danger",
      message: `You have ${capacity.used.toLocaleString("en-US")} cards, ${over.toLocaleString("en-US")} over the ${plan} plan's ${cap}-card limit. They're safe — new saves need room or a plan with space.`,
    };
  }
  const message = `${capacity.used.toLocaleString("en-US")} of ${cap} card slots used on ${plan}.`;
  return {
    tone: remaining === 0 ? "danger" : remaining <= CAPACITY_WARN_AT ? "warning" : "info",
    message,
  };
}

/**
 * The decklist import's slot forecast (owner decision D2, 2026-10-28): an
 * imported card is a reference to a real card and takes NO saved-card slot;
 * it takes one when it is first customized (made into the user's own card).
 * So the import never blocks — it says what customizing the list would use.
 * `distinctCards` is the number of different cards in the list. null when
 * there is nothing to say (no list, or no capacity to read).
 */
export function describeImportSlots(
  capacity: CardCapacity | null,
  distinctCards: number,
): { message: string; short: boolean } | null {
  if (!capacity || distinctCards <= 0) return null;
  const these = distinctCards === 1 ? "This card doesn't" : `These ${distinctCards.toLocaleString("en-US")} cards don't`;
  const remaining = remainingCapacity(capacity);
  if (remaining === null) {
    return { message: `${these} use any saved-card slots.`, short: false };
  }
  return {
    message: `${these} use any saved-card slots. Each one you customize uses 1 — you have ${remaining.toLocaleString("en-US")} left.`,
    // More different cards than slots: customizing the whole list needs room.
    short: distinctCards > remaining,
  };
}

/** The Postgres error raised by migration 0104's trigger. */
export function isCapacityViolation(message: string | null | undefined): boolean {
  return typeof message === "string" && message.includes("card_capacity_exceeded");
}
