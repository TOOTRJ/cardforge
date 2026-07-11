import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import type { PlanTier } from "@/lib/billing/plans";
import { isBillingEnabled } from "@/lib/billing/flags";

// The single server-side source of truth for what a user is allowed to do.
// Reads the (React-cached) profile, which the Stripe webhook keeps in sync.
// NEVER trust a client-supplied tier — always gate via these helpers on the
// server (server actions, route handlers, the render pipeline).

export type Entitlements = {
  /** The plan the user is subscribed to (for display, even if lapsed). */
  tier: PlanTier;
  /** The plan whose perks actually apply (lapsed paid → "free"). */
  effectiveTier: PlanTier;
  isPaid: boolean;
  status: string | null;
  credits: number;
  removeWatermark: boolean;
  maxExportPreset: "default" | "hd";
  allowBatchExport: boolean;
  allowDeckGen: boolean;
  premiumFrames: boolean;
  /** Max saved cards. -1 = unlimited. */
  cardCapacity: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type Perks = Pick<
  Entitlements,
  | "removeWatermark"
  | "maxExportPreset"
  | "allowBatchExport"
  | "allowDeckGen"
  | "premiumFrames"
  | "cardCapacity"
>;

const BASE_PERKS: Perks = {
  removeWatermark: false,
  maxExportPreset: "default",
  allowBatchExport: false,
  allowDeckGen: false,
  premiumFrames: false,
  cardCapacity: 50,
};

const TIER_PERKS: Record<PlanTier, Partial<Perks>> = {
  free: {},
  plus: {
    removeWatermark: true,
    maxExportPreset: "hd",
    premiumFrames: true,
    cardCapacity: 500,
  },
  pro: {
    removeWatermark: true,
    maxExportPreset: "hd",
    premiumFrames: true,
    allowBatchExport: true,
    allowDeckGen: true,
    cardCapacity: -1,
  },
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

const RANK: Record<PlanTier, number> = { free: 0, plus: 1, pro: 2 };

export class UpgradeRequiredError extends Error {
  constructor(public readonly required: PlanTier) {
    super("UPGRADE_REQUIRED");
    this.name = "UpgradeRequiredError";
  }
}

// When billing is disabled (the default) everyone is fully unlocked — the app
// behaves as a free tool. effectiveTier "pro" means requireTier() also passes.
const UNLOCKED: Entitlements = {
  tier: "free",
  effectiveTier: "pro",
  isPaid: true,
  status: null,
  credits: Number.MAX_SAFE_INTEGER,
  removeWatermark: true,
  maxExportPreset: "hd",
  allowBatchExport: true,
  allowDeckGen: true,
  premiumFrames: true,
  cardCapacity: -1,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

export async function getEntitlements(): Promise<Entitlements> {
  if (!isBillingEnabled()) return UNLOCKED;
  const profile = await getCurrentProfile();

  // Admins have no caps or limits anywhere (owner decision, 2026-07-10) —
  // same shape as billing-off. is_admin is trigger-protected, so this isn't
  // client-forgeable.
  if (profile?.is_admin) return UNLOCKED;

  const tier = (profile?.subscription_tier ?? "free") as PlanTier;
  const status = profile?.subscription_status ?? null;

  // Free is always active; paid tiers only grant perks while active/trialing.
  const active = tier === "free" || (status ? ACTIVE_STATUSES.has(status) : false);
  const subscribedTier: PlanTier = active ? tier : "free";

  // Admin-granted comp: the HIGHER of the Stripe tier and the comp tier wins
  // while the comp is unexpired, so a comp can never demote a paying user.
  const compTier = (profile?.comp_tier ?? null) as PlanTier | null;
  const compActive =
    compTier != null &&
    (profile?.comp_expires_at == null ||
      new Date(profile.comp_expires_at) > new Date());
  const effectiveTier: PlanTier =
    compActive && RANK[compTier] > RANK[subscribedTier] ? compTier : subscribedTier;

  const perks: Perks = { ...BASE_PERKS, ...TIER_PERKS[effectiveTier] };

  // Admin-raised card cap: the HIGHER of the tier cap and the override, so an
  // override can only add headroom (-1 = unlimited always wins).
  const override = profile?.card_limit_override ?? null;
  if (override != null && perks.cardCapacity !== -1) {
    perks.cardCapacity = Math.max(perks.cardCapacity, override);
  }

  return {
    tier,
    effectiveTier,
    isPaid: effectiveTier !== "free",
    status,
    credits: profile?.credits ?? 0,
    currentPeriodEnd: profile?.current_period_end ?? null,
    cancelAtPeriodEnd: profile?.cancel_at_period_end ?? false,
    ...perks,
  };
}

/** Throws UpgradeRequiredError if the user's effective tier is below `min`. */
export async function requireTier(min: PlanTier): Promise<Entitlements> {
  const entitlements = await getEntitlements();
  if (RANK[entitlements.effectiveTier] < RANK[min]) {
    throw new UpgradeRequiredError(min);
  }
  return entitlements;
}
