import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
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

/** The billing-relevant slice of a profile row — shared by the viewer path
 *  (getEntitlements) and the owner path (removesWatermarkForOwner) so the
 *  tier resolution can never drift between them. */
type BillingProfileSlice = {
  subscription_tier: string | null;
  subscription_status: string | null;
  is_admin: boolean | null;
  comp_tier: string | null;
  comp_expires_at: string | null;
};

/** Resolve which tier's perks actually apply for a profile row: subscription
 *  must be active/trialing, and an unexpired admin comp takes the HIGHER of
 *  the two (a comp can never demote a paying user). */
function effectiveTierForProfile(profile: BillingProfileSlice): PlanTier {
  const tier = (profile.subscription_tier ?? "free") as PlanTier;
  const status = profile.subscription_status ?? null;

  // Free is always active; paid tiers only grant perks while active/trialing.
  const active = tier === "free" || (status ? ACTIVE_STATUSES.has(status) : false);
  const subscribedTier: PlanTier = active ? tier : "free";

  const compTier = (profile.comp_tier ?? null) as PlanTier | null;
  const compActive =
    compTier != null &&
    (profile.comp_expires_at == null ||
      new Date(profile.comp_expires_at) > new Date());
  return compActive && RANK[compTier] > RANK[subscribedTier]
    ? compTier
    : subscribedTier;
}

export async function getEntitlements(): Promise<Entitlements> {
  if (!isBillingEnabled()) return UNLOCKED;
  const profile = await getCurrentProfile();

  // Admins have no caps or limits anywhere (owner decision, 2026-07-10) —
  // same shape as billing-off. is_admin is trigger-protected, so this isn't
  // client-forgeable.
  if (profile?.is_admin) return UNLOCKED;

  const tier = (profile?.subscription_tier ?? "free") as PlanTier;
  const status = profile?.subscription_status ?? null;
  const effectiveTier = profile
    ? effectiveTierForProfile(profile)
    : ("free" as PlanTier);

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

/** What the card OWNER's plan stamps onto their rendered cards. */
export type OwnerExportStamp = {
  /** Show the free-tier pipglyph.com brand-mark overlay. */
  brandMark: boolean;
  /** The owner's custom footer mark (paid perk) — null renders nothing. */
  footerText: string | null;
};

/**
 * The brand mark and custom footer mark follow the card OWNER's plan, not
 * the viewer's capability — a paid creator's cards render clean (with their
 * own optional mark) everywhere: OG images, bakes, other people's downloads.
 * A free creator's cards carry the pipglyph.com mark and no custom footer.
 * Uses the cookie-free public client so viewer-independent callers (OG
 * route, deferred bake, rebake) stay ISR-eligible; fails toward showing the
 * brand mark on lookup problems.
 */
export async function ownerExportStamp(
  ownerId: string,
): Promise<OwnerExportStamp> {
  try {
    const supabase = createPublicClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "subscription_tier, subscription_status, is_admin, comp_tier, comp_expires_at, export_watermark_text",
      )
      .eq("id", ownerId)
      .maybeSingle();
    if (!profile) return { brandMark: isBillingEnabled(), footerText: null };

    const customText = profile.export_watermark_text?.trim() || null;
    // Billing off = everything unlocked: no brand mark, custom mark honored.
    if (!isBillingEnabled() || profile.is_admin) {
      return { brandMark: false, footerText: customText };
    }
    const perks = { ...BASE_PERKS, ...TIER_PERKS[effectiveTierForProfile(profile)] };
    return perks.removeWatermark
      ? { brandMark: false, footerText: customText }
      : { brandMark: true, footerText: null };
  } catch {
    return { brandMark: isBillingEnabled(), footerText: null };
  }
}

/** Back-compat convenience: does the owner's plan remove the brand mark? */
export async function removesWatermarkForOwner(
  ownerId: string,
): Promise<boolean> {
  return !(await ownerExportStamp(ownerId)).brandMark;
}
