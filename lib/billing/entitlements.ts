import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import type { PlanTier } from "@/lib/billing/plans";

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

export async function getEntitlements(): Promise<Entitlements> {
  const profile = await getCurrentProfile();
  const tier = (profile?.subscription_tier ?? "free") as PlanTier;
  const status = profile?.subscription_status ?? null;

  // Free is always active; paid tiers only grant perks while active/trialing.
  const active = tier === "free" || (status ? ACTIVE_STATUSES.has(status) : false);
  const effectiveTier: PlanTier = active ? tier : "free";
  const perks: Perks = { ...BASE_PERKS, ...TIER_PERKS[effectiveTier] };

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
