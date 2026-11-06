import { z } from "zod";

// ---------------------------------------------------------------------------
// The referral program's SETTINGS, v2 (owner 2026-11-06): an admin switch,
// the activation bar, what the friend gets, the referrer's LADDER, and the
// friends cap — changeable without a deploy. ONE `site_settings` row, key
// `referrals` (0177 seeded v1; 0180 rewrites it to this shape; readable by
// everyone like every site setting; written by an admin through
// lib/admin/referral-settings-actions.ts). Client-safe: the dashboard copy
// and the server read the same parse.
//
//   enabled     false = the Refer-a-friend page says the program is paused
//               and its link is hidden, a signup through a link records
//               nothing, and a qualified friend rewards nobody until it is
//               on again (the row waits). Rewards already given stay.
//   activation  what a friend must do for the referral to QUALIFY: save
//               `cardsRequired` cards within `windowDays` of signing up AND
//               start a plan with a card on file (their first checkout —
//               lib/referrals/server.ts; the card is the fraud bar).
//   friend      days BANKED for the friend when the referral qualifies
//               (lib/billing/day-bank.ts: applied with their first checkout
//               when that is the qualifying moment, else waiting in their
//               bank). 0 = nothing.
//   ladder      the referrer's reward per QUALIFIED referral, by count:
//               step 1 for the first, step 2 for the second … — days into
//               their bank, AI credits at once, or nothing. Past the ladder
//               every further referral earns `tail`.
//   caps        friendsPerMonth: friends a referrer can bring a reward to in
//               a UTC month — past it neither side is rewarded (N confirmable
//               inboxes must not mint N rewards). Referrals themselves are
//               unlimited (owner 2026-11-06).
// ---------------------------------------------------------------------------

export const REFERRAL_SETTINGS_KEY = "referrals";

export const MAX_REWARD_DAYS = 730;

const daysStepSchema = z.object({ kind: z.literal("days"), days: z.number().int().min(1).max(MAX_REWARD_DAYS) });
const creditsStepSchema = z.object({ kind: z.literal("credits"), amount: z.number().int().min(1).max(1000) });
const noneStepSchema = z.object({ kind: z.literal("none") });

export const rewardStepSchema = z.discriminatedUnion("kind", [daysStepSchema, creditsStepSchema, noneStepSchema]);
export type RewardStep = z.infer<typeof rewardStepSchema>;

export const referralSettingsSchema = z.object({
  enabled: z.boolean(),
  activation: z.object({
    cardsRequired: z.number().int().min(1).max(50),
    windowDays: z.number().int().min(7).max(365),
  }),
  friend: z.object({ days: z.number().int().min(0).max(MAX_REWARD_DAYS) }),
  ladder: z.array(rewardStepSchema).max(50),
  tail: rewardStepSchema,
  caps: z.object({
    friendsPerMonth: z.number().int().min(0).max(1000),
  }),
});
export type ReferralSettings = z.infer<typeof referralSettingsSchema>;

/** The owner's ladder (2026-11-06): days and credits alternate, the big
 *  prizes at nine and ten; every referral past ten earns seven days. */
export const DEFAULT_REFERRAL_LADDER: RewardStep[] = [
  { kind: "days", days: 7 },
  { kind: "credits", amount: 5 },
  { kind: "days", days: 7 },
  { kind: "credits", amount: 10 },
  { kind: "days", days: 14 },
  { kind: "credits", amount: 20 },
  { kind: "days", days: 21 },
  { kind: "credits", amount: 50 },
  { kind: "days", days: 21 },
  { kind: "days", days: 30 },
];

export const DEFAULT_REFERRAL_SETTINGS: ReferralSettings = {
  enabled: true,
  activation: { cardsRequired: 5, windowDays: 30 },
  friend: { days: 7 },
  ladder: DEFAULT_REFERRAL_LADDER,
  tail: { kind: "days", days: 7 },
  caps: { friendsPerMonth: 5 },
};

/** The stored row's value, with the defaults for anything missing or
 *  malformed (a hand-edited row — or 0177's v1 shape — never turns the
 *  program into a crash). A v1 row keeps its switch and its friends cap. */
export function parseReferralSettings(value: unknown): ReferralSettings {
  const whole = referralSettingsSchema.safeParse(value);
  if (whole.success) return whole.data;
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const activation = referralSettingsSchema.shape.activation.safeParse(o.activation);
  const friend = referralSettingsSchema.shape.friend.safeParse(o.friend);
  const ladder = referralSettingsSchema.shape.ladder.safeParse(o.ladder);
  const tail = rewardStepSchema.safeParse(o.tail);
  const caps = o.caps && typeof o.caps === "object" ? (o.caps as Record<string, unknown>) : {};
  const friendsPerMonth = z.number().int().min(0).max(1000).safeParse(caps.friendsPerMonth);
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT_REFERRAL_SETTINGS.enabled,
    activation: activation.success ? activation.data : DEFAULT_REFERRAL_SETTINGS.activation,
    friend: friend.success ? friend.data : DEFAULT_REFERRAL_SETTINGS.friend,
    ladder: ladder.success ? ladder.data : DEFAULT_REFERRAL_SETTINGS.ladder,
    tail: tail.success ? tail.data : DEFAULT_REFERRAL_SETTINGS.tail,
    caps: { friendsPerMonth: friendsPerMonth.success ? friendsPerMonth.data : DEFAULT_REFERRAL_SETTINGS.caps.friendsPerMonth },
  };
}

export type { z };

/** The referrer's reward for their N-th qualified referral (1-based): the
 *  ladder's step, else the tail. */
export function ladderRewardFor(settings: Pick<ReferralSettings, "ladder" | "tail">, step: number): RewardStep {
  if (!Number.isInteger(step) || step < 1) return { kind: "none" };
  return settings.ladder[step - 1] ?? settings.tail;
}

/** "7 free days", "5 AI credits", "nothing" — one phrase for every surface. */
export function rewardStepPhrase(step: RewardStep): string {
  switch (step.kind) {
    case "days":
      return `${step.days} free day${step.days === 1 ? "" : "s"}`;
    case "credits":
      return `${step.amount} AI credit${step.amount === 1 ? "" : "s"}`;
    default:
      return "nothing";
  }
}

/** What the FRIEND gets, in words ("7 free days"; "nothing" at 0). */
export function friendRewardPhrase(settings: Pick<ReferralSettings, "friend">): string {
  return settings.friend.days > 0 ? rewardStepPhrase({ kind: "days", days: settings.friend.days }) : "nothing";
}
