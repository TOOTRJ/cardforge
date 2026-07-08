"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export type FeaturedActionResult = { ok: true } | { ok: false; error: string };

/** Admin: feature/unfeature a creator by username. Service-role write gated
 *  on is_admin; the column itself is trigger-pinned against self-updates. */
export async function setFeaturedAction(
  username: string,
  featured: boolean,
): Promise<FeaturedActionResult> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) {
    return { ok: false, error: "Admin client isn't configured." };
  }

  const handle = username.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
    return { ok: false, error: "Enter a valid username." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, username")
    .eq("username", handle)
    .maybeSingle();
  if (!target) return { ok: false, error: `No user named @${handle}.` };

  const { error } = await admin
    .from("profiles")
    .update({ featured_at: featured ? new Date().toISOString() : null })
    .eq("id", target.id);
  if (error) {
    console.warn("setFeaturedAction: update error", error.message);
    return { ok: false, error: "Couldn't update the featured flag." };
  }

  // The banners live on ISR'd public surfaces — purge so the change is
  // visible immediately instead of at the next revalidate window.
  revalidatePath("/gallery");
  revalidatePath("/challenges");
  revalidatePath("/admin/featured");
  return { ok: true };
}
