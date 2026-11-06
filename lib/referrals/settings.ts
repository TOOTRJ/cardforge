import { z } from "zod";
import { REFERRAL_LIFETIME_CAP, REFERRAL_MONTHLY_CAP } from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// The referral program's SETTINGS (owner 2026-11-05): an admin switch, and
// what each side is rewarded with — changeable without a deploy. ONE
// `site_settings` row, key `referrals` (0177 seeds the default; readable by
// everyone like every site setting; written by an admin through
// lib/admin/referral-settings-actions.ts). Client-safe: the dashboard copy
// and the server read the same parse.
//
//   enabled   false = the Refer-a-friend page says the program is paused and
//             its link is hidden, a signup through a link records nothing,
//             and a friend's first card rewards nobody (the row is settled
//             `blocked` / `program_off`). Rewards already given stay.
//   friend    what the referred FRIEND gets at their first saved card;
//   referrer  what the REFERRER gets for it;
//             kind "free_days": N units of 30 free days of a tier
//               (lib/billing/free-days.ts — on a paying plan the days are
//               added to the paid time; "own" = the referrer's own paid tier,
//               Plus for a free account); "credits": N AI credits, once;
//               "none": nothing (the side still records and counts).
//   caps      perMonth / lifetime: rewarded referrals a referrer earns their
//             reward for (a UTC month / ever); friendsPerMonth: friends a
//             referrer can bring a reward to in a month — past it the friend
//             gets nothing either (the independent check's P2: N confirmable
//             inboxes must not mint N rewards).
// ---------------------------------------------------------------------------

export const REFERRAL_SETTINGS_KEY = "referrals";

/** The friend's reward tier: a fixed tier. The referrer's: "own" as well. */
const tierSchema = z.enum(["plus", "pro"]);

const freeDaysSchema = z.object({
  kind: z.literal("free_days"),
  tier: z.enum(["plus", "pro", "own"]),
  /** 30-day units, 1 … 12. */
  units: z.number().int().min(1).max(12),
});
const creditsSchema = z.object({ kind: z.literal("credits"), amount: z.number().int().min(1).max(1000) });
const noneSchema = z.object({ kind: z.literal("none") });

export const rewardSpecSchema = z.discriminatedUnion("kind", [freeDaysSchema, creditsSchema, noneSchema]);
export type RewardSpec = z.infer<typeof rewardSpecSchema>;

export const referralSettingsSchema = z.object({
  enabled: z.boolean(),
  friend: rewardSpecSchema,
  referrer: rewardSpecSchema,
  caps: z.object({
    perMonth: z.number().int().min(0).max(100),
    lifetime: z.number().int().min(0).max(1000),
    friendsPerMonth: z.number().int().min(0).max(100),
  }),
});
export type ReferralSettings = z.infer<typeof referralSettingsSchema>;

export const DEFAULT_REFERRAL_SETTINGS: ReferralSettings = {
  enabled: true,
  friend: { kind: "free_days", tier: "plus", units: 1 },
  referrer: { kind: "free_days", tier: "own", units: 1 },
  caps: { perMonth: REFERRAL_MONTHLY_CAP, lifetime: REFERRAL_LIFETIME_CAP, friendsPerMonth: 5 },
};

/** The stored row's value, with the defaults for anything missing or
 *  malformed (a hand-edited row never turns the program into a crash). */
export function parseReferralSettings(value: unknown): ReferralSettings {
  const whole = referralSettingsSchema.safeParse(value);
  if (whole.success) return whole.data;
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const side = (v: unknown, fallback: RewardSpec): RewardSpec => {
    const r = rewardSpecSchema.safeParse(v);
    return r.success ? r.data : fallback;
  };
  const caps = referralSettingsSchema.shape.caps.safeParse(o.caps);
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT_REFERRAL_SETTINGS.enabled,
    friend: side(o.friend, DEFAULT_REFERRAL_SETTINGS.friend),
    referrer: side(o.referrer, DEFAULT_REFERRAL_SETTINGS.referrer),
    caps: caps.success ? caps.data : DEFAULT_REFERRAL_SETTINGS.caps,
  };
}

export type { z };
export const REWARD_TIER_VALUES = tierSchema.options;

/** "30 free days of Plus", "20 AI credits", "nothing" — one phrase for the
 *  dashboard, the link box, the admin form and the notifications. `own`
 *  reads as "your plan" (the referrer's own tier). */
export function rewardPhrase(spec: RewardSpec, opts: { ownTierWord?: string } = {}): string {
  switch (spec.kind) {
    case "free_days": {
      const days = spec.units * 30;
      const tier = spec.tier === "own" ? (opts.ownTierWord ?? "your plan") : spec.tier === "pro" ? "Pro" : "Plus";
      return `${days} free days of ${tier}`;
    }
    case "credits":
      return `${spec.amount} AI credit${spec.amount === 1 ? "" : "s"}`;
    default:
      return "nothing";
  }
}
