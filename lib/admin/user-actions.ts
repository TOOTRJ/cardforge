"use server";

import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// Admin user tools — grant credits, comp a plan, raise the saved-card cap.
// Every write goes through the service-role client because the target columns
// (credits via grant_credits, comp_tier/comp_expires_at/card_limit_override)
// are pinned by the protect_billing_columns trigger (migration 0060).

type ActionError = { ok: false; error: string };

/** Shared gate: caller must be an is_admin profile AND the service-role
 *  client must be configured. Returns the admin client, or an error result. */
async function requireAdmin(): Promise<
  { ok: true; admin: ReturnType<typeof createAdminClient> } | ActionError
> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) {
    return { ok: false, error: "Admin client isn't configured." };
  }
  return { ok: true, admin: createAdminClient() };
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
});

export type AdminGrantCreditsResult =
  | { ok: true; balance: number }
  | ActionError;

export async function adminGrantCreditsAction(input: {
  userId: string;
  amount: number;
  note?: string;
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
  const { userId, amount, note } = parsed.data;

  const { admin } = gate;
  if (!(await targetExists(admin, userId))) {
    return { ok: false, error: "No user with that id." };
  }

  // Unique key per grant — dedupes a double-submitted identical call without
  // blocking a deliberate second grant later.
  const { data: balance, error } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: note ? `admin_grant: ${note}` : "admin_grant",
    p_idempotency_key: `admin-grant:${userId}:${Date.now()}`,
  });
  if (error || typeof balance !== "number") {
    console.warn("adminGrantCreditsAction: rpc error", error?.message);
    return { ok: false, error: "Couldn't grant credits." };
  }

  return { ok: true, balance };
}

// ---------------------------------------------------------------------------
// Comp a plan
// ---------------------------------------------------------------------------

const setCompTierSchema = z
  .object({
    userId: z.string().uuid("Invalid user id."),
    tier: z.enum(["plus", "pro"]).nullable(),
    expiresAt: z
      .string()
      .datetime({ offset: true, message: "Invalid expiry date." })
      .nullable(),
  })
  .refine(
    (v) =>
      v.tier == null ||
      v.expiresAt == null ||
      new Date(v.expiresAt) > new Date(),
    { message: "Expiry must be in the future.", path: ["expiresAt"] },
  );

export type AdminSetCompTierResult = { ok: true } | ActionError;

export async function adminSetCompTierAction(input: {
  userId: string;
  tier: "plus" | "pro" | null;
  expiresAt: string | null;
}): Promise<AdminSetCompTierResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = setCompTierSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const { userId, tier, expiresAt } = parsed.data;

  const { admin } = gate;
  if (!(await targetExists(admin, userId))) {
    return { ok: false, error: "No user with that id." };
  }

  const { error } = await admin
    .from("profiles")
    .update({
      comp_tier: tier,
      // Clearing the tier always clears the expiry with it.
      comp_expires_at: tier == null ? null : expiresAt,
    })
    .eq("id", userId);
  if (error) {
    console.warn("adminSetCompTierAction: update error", error.message);
    return { ok: false, error: "Couldn't update the comp tier." };
  }

  return { ok: true };
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

  return { ok: true };
}
