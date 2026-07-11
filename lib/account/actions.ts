"use server";

import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isBillingEnabled } from "@/lib/billing/flags";

// Permanent account deletion. Hard-deletes the auth user (which cascades every
// user-owned DB row — profile, cards, sets, comments, likes, reports, ledger)
// and best-effort removes the user's storage folders (objects aren't cascaded).

const ACCOUNT_BUCKETS = [
  "card-art",
  "card-renders",
  "card-exports",
  "set-covers",
  "profile-media",
];

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

  // Storage cleanup first (best-effort — objects are not cascade-deleted with
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
