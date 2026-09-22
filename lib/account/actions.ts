"use server";

import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";

// Permanent account deletion. Hard-deletes the auth user (which cascades every
// user-owned DB row — profile, cards, decks, comments, likes, reports, ledger)
// and best-effort removes the user's storage folders (objects aren't cascaded).

const ACCOUNT_BUCKETS = [
  "card-art",
  "card-renders",
  "card-exports",
  "set-covers", // deck covers + card set icons (historical bucket name)
  "profile-media",
  "custom-pips",
];

/**
 * Stop billing BEFORE the profile row (and its stripe_customer_id) is gone.
 * Without this a deleted subscriber kept paying with no portal to cancel
 * from, and every later webhook no-op'd against a profile that no longer
 * existed. Cancels every live subscription immediately (no proration —
 * the account is being destroyed) and returns false only when Stripe
 * refused, so the caller can stop and keep the account intact.
 */
async function cancelStripeSubscriptions(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<boolean> {
  if (!isStripeConfigured()) return true;
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  const customerId = profile?.stripe_customer_id;
  if (!customerId) return true;
  try {
    const stripe = getStripe();
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });
    for (const sub of subs.data) {
      if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
      await stripe.subscriptions.cancel(sub.id, { prorate: false });
    }
    return true;
  } catch (error) {
    console.error(
      `[account] Could not cancel Stripe subscriptions for ${userId}:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Custom export watermark — the short footer mark paid users can print on
// their cards (previews, exports, bakes). Mirrors the 40-char DB CHECK on
// profiles.export_watermark_text (migration 0063).
// ---------------------------------------------------------------------------

const exportWatermarkSchema = z.object({
  text: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(40, "Keep it under 40 characters.")),
});

export type UpdateExportWatermarkResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateExportWatermarkAction(input: {
  text: string;
}): Promise<UpdateExportWatermarkResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You're not signed in." };

  const parsed = exportWatermarkSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid watermark text.",
    };
  }

  // Server-side plan gate — never trust the client's canCustomize flag.
  // Billing off = everything unlocked (getEntitlements returns UNLOCKED, but
  // check the flag explicitly so the gate reads as intended).
  const entitlements = await getEntitlements();
  if (isBillingEnabled() && !entitlements.removeWatermark) {
    return { ok: false, error: "Custom watermarks are a paid perk." };
  }

  // Own-profile RLS covers this write; the column is not trigger-pinned.
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ export_watermark_text: parsed.data.text || null })
    .eq("id", user.id);

  if (error) {
    return { ok: false, error: "Couldn't save your watermark. Please try again." };
  }
  return { ok: true };
}

export async function deleteAccountAction(input: {
  confirm: string;
}): Promise<DeleteAccountResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You're not signed in." };

  if ((input?.confirm ?? "").trim().toUpperCase() !== "DELETE") {
    return { ok: false, error: 'Type DELETE to confirm.' };
  }

  if (!isAdminConfigured()) {
    return {
      ok: false,
      error: "Account deletion isn't available right now — please contact support.",
    };
  }

  const admin = createAdminClient();

  // Billing first — if Stripe won't let us stop the subscription, refuse to
  // delete rather than strand a paying customer with no way to cancel.
  if (!(await cancelStripeSubscriptions(admin, user.id))) {
    return {
      ok: false,
      error:
        "We couldn't cancel your subscription just now. Cancel it under Settings → Manage subscription, then try again — or contact support.",
    };
  }

  // Storage cleanup next (best-effort — objects are not cascade-deleted with
  // the DB rows). Layout is flat: {userId}/{file} in every bucket.
  for (const bucket of ACCOUNT_BUCKETS) {
    try {
      const { data: files } = await admin.storage
        .from(bucket)
        .list(user.id, { limit: 1000 });
      if (files && files.length > 0) {
        await admin.storage
          .from(bucket)
          .remove(files.map((file) => `${user.id}/${file.name}`));
      }
    } catch {
      // Ignore — orphaned storage is low-harm; DB deletion is what matters.
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return {
      ok: false,
      error: "Couldn't delete your account. Please try again or contact support.",
    };
  }

  // Clear the now-orphaned session cookie so the browser is logged out.
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Non-fatal: the session references a deleted user and is already invalid.
  }

  return { ok: true };
}
