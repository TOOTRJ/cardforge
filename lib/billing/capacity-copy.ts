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
  const message = `${capacity.used.toLocaleString("en-US")} of ${cap} card slots used on ${plan}.`;
  return {
    tone: remaining === 0 ? "danger" : remaining <= CAPACITY_WARN_AT ? "warning" : "info",
    message,
  };
}

/** The Postgres error raised by migration 0104's trigger. */
export function isCapacityViolation(message: string | null | undefined): boolean {
  return typeof message === "string" && message.includes("card_capacity_exceeded");
}
