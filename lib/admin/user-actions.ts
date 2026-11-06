"use server";

import { z } from "zod";
import type Stripe from "stripe";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import {
  findLiveSubscription,
  grantCreditsForSync,
  isLiveStatus,
  resolveSubscriptionTier,
  syncSubscriptionForUser,
} from "@/lib/stripe/subscription-sync";
import { grantFreeDays, revokeFreeDays } from "@/lib/billing/free-days-apply";
import { MAX_BANK_DAYS_APPLIED, MIN_ADMIN_BANK_DAYS, adminBankReference, bankDays, readBank, revokeBankedEntry } from "@/lib/billing/day-bank";

// Admin user tools — grant credits, bank free days (a comp, owner
// 2026-11-06: banked days the user applies with a card on file), staff
// access with no end, raise the saved-card cap. Every write goes through the
// service-role client because the target columns (credits via
// grant_credits, comp_tier/comp_expires_at/card_limit_override, plan_grants,
// day_bank_entries) are pinned by the protect_billing_columns trigger
// (migration 0060) or service-role only (0176, 0179).

type ActionError = { ok: false; error: string };

/** Shared gate: caller must be an is_admin profile AND the service-role
 *  client must be configured. Returns the admin client, or an error result. */
async function requireAdmin(): Promise<
  | { ok: true; admin: ReturnType<typeof createAdminClient>; adminId: string }
  | ActionError
> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) {
    return { ok: false, error: "Admin client isn't configured." };
  }
  return { ok: true, admin: createAdminClient(), adminId: profile.id };
}

/**
 * Tell the affected user what an admin just did. Service-role insert (the
 * table has no INSERT policy for end users); Realtime delivers it to their
 * open tab as a toast + bell badge (components/notifications/realtime-alerts).
 * Best-effort: a failed notification never fails the grant itself.
 */
async function notifyUser(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    recipientId: string;
    actorId: string;
    type: "credit_grant" | "comp_plan" | "card_limit" | "banked_days";
    payload: Record<string, string | number | null>;
  },
): Promise<void> {
  const { error } = await admin.from("notifications").insert({
    recipient_id: input.recipientId,
    actor_id: input.actorId,
    type: input.type,
    payload: input.payload,
  });
  if (error) {
    console.warn(`notifyUser(${input.type}): insert error`, error.message);
  }
}

async function targetExists(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Grant credits
// ---------------------------------------------------------------------------

const grantCreditsSchema = z.object({
  userId: z.string().uuid("Invalid user id."),
  amount: z
    .number()
    .int("Amount must be a whole number.")
    .min(1, "Grant at least 1 credit.")
    .max(10_000, "Grant at most 10,000 credits at a time."),
  note: z
    .string()
    .trim()
    .max(200, "Note must be 200 characters or fewer.")
    .optional(),
  /** Minted by the form once per fill-in; a double-submit reuses it (deduped
   *  inside grant_credits), a deliberate later grant gets a fresh one. */
  requestId: z.string().uuid("Invalid request id."),
});

export type AdminGrantCreditsResult =
  | { ok: true; balance: number }
  | ActionError;

export async function adminGrantCreditsAction(input: {
  userId: string;
  amount: number;
  note?: string;
  requestId: string;
}): Promise<AdminGrantCreditsResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = grantCreditsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const { userId, amount, note, requestId } = parsed.data;

  const { admin } = gate;
  if (!(await targetExists(admin, userId))) {
    return { ok: false, error: "No user with that id." };
  }

  // The key is the FORM's request id, not a timestamp: a double-click sends
  // the same id twice and grant_credits dedupes it; the form mints a new id
  // after each success so a deliberate second grant still goes through.
  // (The old `${Date.now()}` key made every call unique — no dedupe at all.)
  const { data: balance, error } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: note ? `admin_grant: ${note}` : "admin_grant",
    p_idempotency_key: `admin-grant:${requestId}`,
  });
  if (error || typeof balance !== "number") {
    console.warn("adminGrantCreditsAction: rpc error", error?.message);
    return { ok: false, error: "Couldn't grant credits." };
  }

  await notifyUser(admin, {
    recipientId: userId,
    actorId: gate.adminId,
    type: "credit_grant",
    payload: { amount, balance, note: note ?? null },
  });

  return { ok: true, balance };
}

// ---------------------------------------------------------------------------
// Free days (a comp) — migration 0176, lib/billing/free-days.ts
// ---------------------------------------------------------------------------

const grantFreeDaysSchema = z.object({
  userId: z.string().uuid("Invalid user id."),
  tier: z.enum(["plus", "pro"]),
  /** Null only: no end (staff accounts). A DATED comp is banked days now
   *  (owner 2026-11-06, adminBankDaysAction) — the old 30-day units are
   *  refused here, never silently converted. */
  units: z.null({ message: "Dated comps are banked days now — use Bank free days." }),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").nullable(),
});

const bankDaysSchema = z.object({
  userId: z.string().uuid("Invalid user id."),
  days: z
    .number()
    .int("Whole days.")
    .min(MIN_ADMIN_BANK_DAYS, `At least ${MIN_ADMIN_BANK_DAYS} days.`)
    .max(MAX_BANK_DAYS_APPLIED, `At most ${MAX_BANK_DAYS_APPLIED} days.`),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").nullable(),
  /** The form's one id per fill-in: a double submit banks once. */
  requestId: z.string().uuid("Invalid request id."),
});

export type AdminBankDaysResult = { ok: true; days: number; created: boolean } | ActionError;

/**
 * Bank free days for a user — the comp since owner 2026-11-06 (the dated
 * free-days grant and its perks overlay are retired for admins; "no end"
 * staff access stays). The days are TIER-LESS and carry no credits: the
 * user's first checkout applies the whole bank as its free period, later
 * ones wait for "Apply banked days" on a live plan — a card on file either
 * way (lib/billing/day-bank.ts). The user is told.
 */
export async function adminBankDaysAction(input: {
  userId: string;
  days: number;
  note: string | null;
  requestId: string;
}): Promise<AdminBankDaysResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const parsed = bankDaysSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { userId, days, note, requestId } = parsed.data;
  const { admin } = gate;
  // The days must be usable: an admin has every plan already (the billing
  // page shows no bank), and an account on open-ended staff access never
  // checks out — banked days would sit there for good, and the notice would
  // point at a section they don't have (independent check).
  const { data: target } = await admin
    .from("profiles")
    .select("id, is_admin, comp_tier, comp_expires_at")
    .eq("id", userId)
    .maybeSingle();
  const row = target as { id: string; is_admin: boolean | null; comp_tier: string | null; comp_expires_at: string | null } | null;
  if (!row) return { ok: false, error: "No user with that id." };
  if (row.is_admin) return { ok: false, error: "An admin already has every plan — banked days would never be used." };
  if (row.comp_tier && row.comp_expires_at == null) {
    return { ok: false, error: "This account has open-ended staff access, so banked days would never be used. Revoke it first." };
  }
  // Stripe applies at most 730 days at once (reserveBank leaves the rest
  // banked), so the bank is held under it: the admin is told the headroom.
  const bank = await readBank(admin, userId);
  const headroom = MAX_BANK_DAYS_APPLIED - bank.banked - bank.reserved;
  if (days > headroom) {
    return {
      ok: false,
      error:
        headroom < MIN_ADMIN_BANK_DAYS
          ? `Their bank already holds ${bank.banked + bank.reserved} days — the most that can be applied at once is ${MAX_BANK_DAYS_APPLIED}.`
          : `Their bank holds ${bank.banked + bank.reserved} days; at most ${headroom} more can be banked (${MAX_BANK_DAYS_APPLIED} at once is Stripe's limit).`,
    };
  }

  const banked = await bankDays(admin, {
    userId,
    days,
    source: "admin",
    reference: adminBankReference(requestId),
    note: note ? `${note} (by ${gate.adminId})` : `by ${gate.adminId}`,
  });
  if (!banked.ok) return { ok: false, error: banked.error };
  if (banked.created) {
    await notifyUser(admin, {
      recipientId: userId,
      actorId: gate.adminId,
      type: "banked_days",
      payload: { days, note: note || null },
    });
  }
  // A double submit finds the entry it made: ITS days, not this input's.
  return { ok: true, days: banked.days, created: banked.created };
}

export type AdminRevokeBankedDaysResult = { ok: true; days: number } | ActionError;

/** Take BANKED days back (an entry not yet applied). The user is told. */
export async function adminRevokeBankedDaysAction(input: { entryId: string; reason: string | null }): Promise<AdminRevokeBankedDaysResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const parsed = z
    .object({ entryId: z.string().uuid("Invalid entry id."), reason: z.string().trim().max(200).nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const result = await revokeBankedEntry(gate.admin, parsed.data.entryId, parsed.data.reason || `revoked by ${gate.adminId}`);
  if (!result.ok) return result;
  await notifyUser(gate.admin, {
    recipientId: result.userId,
    actorId: gate.adminId,
    type: "banked_days",
    payload: { days: result.days, revoked: 1, note: parsed.data.reason || null },
  });
  return { ok: true, days: result.days };
}

export type AdminGrantFreeDaysResult =
  | {
      ok: true;
      /** The free days' end (ISO); null for an open-ended grant. */
      endsAt: string | null;
      /** What happened on Stripe / to the overlay, one line (UTC). */
      stripeNote: string;
      warning?: string;
    }
  | ActionError;

/**
 * STAFF access with no end (owner 2026-11-06: the one comp that is not
 * banked days — an account with no Stripe plan, `units` null). A dated comp
 * is adminBankDaysAction. The grant is a `plan_grants` row;
 * lib/billing/free-days-apply.ts writes the open-ended perks overlay. The
 * user is told; the toast carries the writer's line.
 */
export async function adminGrantFreeDaysAction(input: {
  userId: string;
  tier: "plus" | "pro";
  units: number | null;
  note: string | null;
}): Promise<AdminGrantFreeDaysResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = grantFreeDaysSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { userId, tier, units, note } = parsed.data;
  const { admin } = gate;

  const result = await grantFreeDays(admin, {
    userId,
    tier,
    units,
    source: "comp",
    grantedBy: gate.adminId,
    note: note || null,
  });
  if (!result.ok) return result;

  // Below the plan they pay for: recorded, nothing changed — nothing to tell.
  if (result.plan.kind !== "below_plan") {
    await notifyUser(admin, {
    recipientId: userId,
    actorId: gate.adminId,
    type: "comp_plan",
    payload: {
      tier,
      days: null,
      expiresAt: result.endsAt,
      // A hold: the next charge moved — the copy says the days are added to
      // the time paid for (never "your trial").
      ...(result.holdEndsAt ? { holdEndsAt: result.holdEndsAt, was: result.plan.kind === "hold" ? result.plan.was : null } : {}),
    },
    });
  }

  return {
    ok: true,
    endsAt: result.endsAt,
    stripeNote: result.note,
    ...(result.warning ? { warning: result.warning } : {}),
  };
}

export type AdminRevokeFreeDaysResult = { ok: true; note: string; warning?: string } | ActionError;

/** Take back a user's NEWEST free-days grant: the overlay shrinks by its
 *  days, a Stripe trial held at its end moves back (never before the end it
 *  had before any hold; "now" when that has passed — charged at once). */
export async function adminRevokeFreeDaysAction(input: { grantId: string }): Promise<AdminRevokeFreeDaysResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const parsed = z.object({ grantId: z.string().uuid("Invalid grant id.") }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { admin } = gate;

  const { data: grant } = await admin.from("plan_grants").select("user_id").eq("id", parsed.data.grantId).maybeSingle();
  const result = await revokeFreeDays(admin, { grantId: parsed.data.grantId, revokedBy: gate.adminId });
  if (!result.ok) return result;

  const userId = (grant as { user_id?: string } | null)?.user_id;
  if (userId) {
    await notifyUser(admin, {
      recipientId: userId,
      actorId: gate.adminId,
      type: "comp_plan",
      payload:
        result.overlay.comp_tier == null
          ? { tier: null }
          : { tier: result.overlay.comp_tier, expiresAt: result.overlay.comp_expires_at, revoked: 1 },
    });
  }
  return { ok: true, note: result.note, ...(result.warning ? { warning: result.warning } : {}) };
}

// ---------------------------------------------------------------------------
// Card limit override
// ---------------------------------------------------------------------------

const setCardLimitSchema = z.object({
  userId: z.string().uuid("Invalid user id."),
  limit: z
    .number()
    .int("Limit must be a whole number.")
    .min(1, "Limit must be at least 1.")
    .max(100_000, "Limit must be 100,000 or fewer.")
    .nullable(),
});

export type AdminSetCardLimitResult = { ok: true } | ActionError;

export async function adminSetCardLimitAction(input: {
  userId: string;
  limit: number | null;
}): Promise<AdminSetCardLimitResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = setCardLimitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const { userId, limit } = parsed.data;

  const { admin } = gate;
  if (!(await targetExists(admin, userId))) {
    return { ok: false, error: "No user with that id." };
  }

  const { error } = await admin
    .from("profiles")
    .update({ card_limit_override: limit })
    .eq("id", userId);
  if (error) {
    console.warn("adminSetCardLimitAction: update error", error.message);
    return { ok: false, error: "Couldn't update the card limit." };
  }

  await notifyUser(admin, {
    recipientId: userId,
    actorId: gate.adminId,
    type: "card_limit",
    payload: { limit },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Subscription resync — rewrite a profile's subscription columns from the
// customer's CURRENT Stripe state through the same sync the webhook runs
// (lib/stripe/subscription-sync.ts). The tool for "Stripe says Pro, the
// profile says free": a missed webhook, an unmapped price, or two
// subscriptions racing. Also grants any monthly credits the synced tier is
// owed (idempotent — a resync can never double-grant).
// ---------------------------------------------------------------------------

const resyncSchema = z.object({ userId: z.string().uuid("Invalid user id.") });

export type AdminResyncSubscriptionResult =
  | {
      ok: true;
      tier: string;
      status: string | null;
      subscriptionId: string | null;
      unresolvedPrice: boolean;
      /** ISO date the synced plan is set to stop (cancelled, still active). */
      endsAt: string | null;
      /** Nothing was written: Stripe returned no subscription for this
       *  customer and the profile points at none. */
      nothingFound: boolean;
    }
  | ActionError;

export async function adminResyncSubscriptionAction(input: {
  userId: string;
}): Promise<AdminResyncSubscriptionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const parsed = resyncSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (!isStripeConfigured()) {
    return { ok: false, error: "Stripe isn't configured." };
  }
  const { admin } = gate;
  const { data: profile } = await admin
    .from("profiles")
    .select("id, stripe_customer_id, stripe_subscription_id")
    .eq("id", parsed.data.userId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "No user with that id." };
  if (!profile.stripe_customer_id) {
    return { ok: false, error: "This user has no Stripe customer yet." };
  }

  try {
    const stripe = getStripe();
    // The subscription the profile points at, read directly (with its
    // schedule): the sync lists the CUSTOMER's subscriptions, and when that
    // list comes back empty or fails (a customer link that drifted, a
    // transient error) it used to write nothing and still answer "Synced".
    // The stored subscription is then what gets synced.
    let stored: Stripe.Subscription | undefined;
    if (profile.stripe_subscription_id) {
      try {
        stored = await stripe.subscriptions.retrieve(profile.stripe_subscription_id, {
          expand: ["schedule"],
        });
      } catch (error) {
        console.warn(
          "adminResyncSubscriptionAction: stored subscription unreadable",
          error instanceof Error ? error.message : error,
        );
      }
    }
    const result = await syncSubscriptionForUser(admin, stripe, profile.id, {
      customerId: profile.stripe_customer_id,
      // An ended subscription syncs as the webhook's `deleted` event would.
      ...(stored ? { currentSub: stored, eventDeleted: stored.status === "canceled" } : {}),
    });
    await grantCreditsForSync(result, admin, { isCreationEvent: false });
    revalidatePath("/admin/users");
    return {
      ok: true,
      tier: result.tier,
      status: result.status,
      subscriptionId: result.subscriptionId,
      unresolvedPrice: result.unresolvedPrice,
      endsAt: result.endsAt ?? null,
      nothingFound: result.source === "none",
    };
  } catch (error) {
    console.warn(
      "adminResyncSubscriptionAction: sync error",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "Couldn't resync from Stripe." };
  }
}

// ---------------------------------------------------------------------------
// Billing health — every profile that ever touched Stripe, compared against
// its live subscription. Surfaces the exact failure that hit a customer on
// 2026-09-14 (status active, tier free) BEFORE they write in, plus tiers the
// resolver can't map (a price nobody configured) and subscribers Stripe
// says are live but the profile says lapsed (a missed webhook).
// ---------------------------------------------------------------------------

export type BillingHealthIssue = {
  userId: string;
  username: string | null;
  profileTier: string;
  profileStatus: string | null;
  stripeTier: string | null;
  stripeStatus: string | null;
  subscriptionId: string | null;
  problem:
    | "active-but-free"
    | "tier-mismatch"
    | "status-mismatch"
    | "unmapped-price";
};

export type AdminBillingHealthResult =
  | { ok: true; checked: number; issues: BillingHealthIssue[]; truncated: boolean }
  | ActionError;

const HEALTH_CHECK_LIMIT = 100;

export async function adminBillingHealthAction(): Promise<AdminBillingHealthResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!isStripeConfigured()) {
    return { ok: false, error: "Stripe isn't configured." };
  }
  const { admin } = gate;
  const stripe = getStripe();

  // Most-recent subscribers first — the ones most likely to be mid-incident.
  const { data: rows, error } = await admin
    .from("profiles")
    .select(
      "id, username, subscription_tier, subscription_status, stripe_customer_id",
    )
    .not("stripe_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(HEALTH_CHECK_LIMIT + 1);
  if (error) return { ok: false, error: error.message };

  const profiles = (rows ?? []).slice(0, HEALTH_CHECK_LIMIT);
  const issues: BillingHealthIssue[] = [];
  for (const profile of profiles) {
    const customerId = profile.stripe_customer_id as string;
    let live: Awaited<ReturnType<typeof findLiveSubscription>> = null;
    try {
      live = await findLiveSubscription(stripe, customerId);
    } catch {
      continue; // transient API error — skip rather than mislabel
    }
    const stripeTier = live ? await resolveSubscriptionTier(live, stripe) : null;
    const profileLive = isLiveStatus(profile.subscription_status);
    const base = {
      userId: profile.id,
      username: profile.username,
      profileTier: profile.subscription_tier,
      profileStatus: profile.subscription_status,
      stripeTier,
      stripeStatus: live?.status ?? null,
      subscriptionId: live?.id ?? null,
    };
    if (live && profile.subscription_tier === "free") {
      issues.push({ ...base, problem: "active-but-free" });
    } else if (live && !stripeTier) {
      issues.push({ ...base, problem: "unmapped-price" });
    } else if (live && stripeTier !== profile.subscription_tier) {
      issues.push({ ...base, problem: "tier-mismatch" });
    } else if (Boolean(live) !== profileLive) {
      issues.push({ ...base, problem: "status-mismatch" });
    }
  }

  return {
    ok: true,
    checked: profiles.length,
    issues,
    truncated: (rows?.length ?? 0) > HEALTH_CHECK_LIMIT,
  };
}
