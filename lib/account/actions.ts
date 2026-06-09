"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

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
