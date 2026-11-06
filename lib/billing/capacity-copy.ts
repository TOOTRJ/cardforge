import {
  CARD_CAPACITY,
  CARD_CAPACITY_UNLIMITED,
  capacityWord,
  nextCapacityTier,
  type PlanTier,
} from "@/lib/billing/plans";

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

/** Soft warning once this few slots remain — the floor of the rule below
 *  (an admin override of 10 still warns on the last 5). */
export const CAPACITY_WARN_AT = 5;

/** …and from this share of the cap (owner 2026-11-06, the research's "amber
 *  from 80 %"): 40 of 50 on Free, 400 of 500 on Plus. */
export const CAPACITY_WARN_FRACTION = 0.8;

/** The saved count from which the meter turns amber: whichever comes first
 *  of 80 % of the cap and the last CAPACITY_WARN_AT slots. */
export function capacityWarnFrom(cap: number): number {
  return Math.min(Math.ceil(cap * CAPACITY_WARN_FRACTION), Math.max(0, cap - CAPACITY_WARN_AT));
}

/** The meter's tone for a count: full or over = danger, near = warning. */
export function capacityTone(capacity: CardCapacity): CapacityMessage["tone"] {
  const remaining = remainingCapacity(capacity);
  if (remaining === null) return "info";
  if (remaining === 0) return "danger";
  return capacity.used >= capacityWarnFrom(capacity.cap) ? "warning" : "info";
}

const TIER_NAME: Record<PlanTier, string> = { free: "Free", plus: "Plus", pro: "Pro" };

/** The plan that lifts a tier's cap, as the meter's link: a Free account is
 *  sent to the storefront, a Plus account (whose /pricing redirects to its
 *  billing page) straight to the plan grid there. null on an unlimited
 *  tier. ONE answer for My Cards, the dashboard panel and the creator. */
export function capacityUpgradeLink(tier: PlanTier): { href: string; label: string; planName: string } | null {
  const next = nextCapacityTier(tier);
  if (!next) return null;
  const planName = TIER_NAME[next];
  return {
    href: tier === "free" ? "/pricing" : "/dashboard/billing#plans",
    label:
      CARD_CAPACITY[next] === CARD_CAPACITY_UNLIMITED
        ? `${planName} holds them all`
        : `${planName} holds ${capacityWord(next)} cards`,
    planName,
  };
}

/** "move to Plus (500 cards)" / "move to Pro (unlimited)" — the way out,
 *  as a clause. */
function moveUp(tier: PlanTier): string {
  const next = nextCapacityTier(tier);
  if (!next) return "move to a plan with space";
  return `move to ${TIER_NAME[next]} (${capacityWord(next)} cards)`;
}

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
      } needs room: delete ${room} card${over + adding === 1 ? "" : "s"}, or ${moveUp(capacity.tier)}.`,
    };
  }
  if (remaining === 0) {
    // The soft cap in words: the cards are safe, only this save needs room.
    return {
      tone: "danger",
      message:
        adding <= 1
          ? `Your ${plan} plan's ${cap}-card limit is full. Your cards are safe — saving this one needs room: delete a card, or ${moveUp(capacity.tier)}.`
          : `Your ${plan} plan's ${cap}-card limit is full. Your cards are safe — this can't add ${adding} cards until you delete some, or ${moveUp(capacity.tier)}.`,
    };
  }
  if (adding > remaining) {
    return {
      tone: "danger",
      message: `Adding ${adding} cards would take you over your ${plan} plan's ${cap}-card limit — you have ${slots(remaining)} left. Generate ${remaining} or fewer, delete cards, or ${moveUp(capacity.tier)}.`,
    };
  }
  if (capacity.used + adding >= capacityWarnFrom(capacity.cap)) {
    const after = remaining - adding;
    const next = nextCapacityTier(capacity.tier);
    const holds = next ? ` ${TIER_NAME[next]} holds ${capacityWord(next)}.` : "";
    return {
      tone: "warning",
      message:
        after === 0
          ? `This uses the last of your ${cap} card slots on ${plan}.${holds}`
          : `${slots(after)} left on your ${plan} plan after this (${capacity.used + adding} of ${cap}).${holds}`,
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
  const tone = capacityTone(capacity);
  const used = capacity.used.toLocaleString("en-US");
  const next = nextCapacityTier(capacity.tier);
  const holds = next ? `${TIER_NAME[next]} holds ${capacityWord(next)}.` : "";
  const message =
    tone === "danger"
      ? `Your ${plan} library is full — ${used} of ${cap} cards saved. They're safe to view, edit and download; the next save needs room, or ${moveUp(capacity.tier)}.`
      : tone === "warning"
        ? `${used} of ${cap} cards saved on ${plan} — ${remaining.toLocaleString("en-US")} left. Nothing is ever deleted at ${cap}; new saves past it need ${next ? TIER_NAME[next] : "a plan with space"}. ${holds}`.trim()
        : `${used} of ${cap} cards saved on ${plan}.`;
  return { tone, message };
}

/**
 * The decklist import's slot forecast (owner decision D2, 2026-10-28): an
 * imported card is a reference to a real card and takes NO saved-card slot;
 * it takes one when it is first customized (made into the user's own card),
 * and one customized card covers all its copies. So the import never blocks
 * — it says what customizing the list would use. `cards` is the copies the
 * review counts (its badge and its "Add N cards"), `distinct` the different
 * cards among them. null when there is nothing to say (no list, or no
 * capacity to read).
 */
export function describeImportSlots(
  capacity: CardCapacity | null,
  list: { cards: number; distinct: number },
): { message: string; short: boolean } | null {
  const { cards, distinct } = list;
  if (!capacity || cards <= 0 || distinct <= 0) return null;
  const n = (value: number) => value.toLocaleString("en-US");
  // Both numbers, so the line reads with the badge ("100 cards") beside it.
  const these =
    distinct === 1
      ? cards === 1
        ? "This card uses"
        : `These ${n(cards)} copies of one card use`
      : cards === distinct
        ? `These ${n(cards)} cards use`
        : `These ${n(cards)} cards (${n(distinct)} different) use`;
  const each =
    distinct === 1
      ? "Customizing it uses 1"
      : cards === distinct
        ? "Each one you customize uses 1"
        : "Each different card you customize uses 1";
  const remaining = remainingCapacity(capacity);
  if (remaining === null) {
    return { message: `${these} no saved-card slots.`, short: false };
  }
  return {
    message: `${these} no saved-card slots. ${each} — you have ${n(remaining)} left.`,
    // More different cards than slots: customizing the whole list needs room.
    short: distinct > remaining,
  };
}

/** The Postgres error raised by migration 0104's trigger. */
export function isCapacityViolation(message: string | null | undefined): boolean {
  return typeof message === "string" && message.includes("card_capacity_exceeded");
}
