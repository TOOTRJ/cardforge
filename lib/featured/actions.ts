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

/** Admin: set or clear a homepage hero slot from a pasted card-page URL
 *  (/card/{username}/{slug}, absolute or relative). The card must be PUBLIC
 *  and have a baked render — the hero shows the stored image. */
export async function setFeaturedCardAction(
  slot: 1 | 2,
  cardUrl: string | null,
): Promise<FeaturedActionResult> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) {
    return { ok: false, error: "Admin client isn't configured." };
  }
  if (slot !== 1 && slot !== 2) return { ok: false, error: "Unknown slot." };

  const admin = createAdminClient();

  if (!cardUrl || !cardUrl.trim()) {
    await admin.from("featured_cards").delete().eq("slot", slot);
    revalidatePath("/");
    revalidatePath("/admin/featured");
    return { ok: true };
  }

  // Accept absolute or relative card URLs; extract /card/{username}/{slug}.
  const match = cardUrl
    .trim()
    .match(/\/card\/([a-z0-9_]+)\/([a-z0-9-]+)\/?(?:[?#]|$)/i);
  if (!match) {
    return {
      ok: false,
      error: "Paste a card page URL, e.g. /card/username/card-slug.",
    };
  }
  const [, username, slug] = match;

  const { data: owner } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (!owner) return { ok: false, error: `No user named @${username}.` };

  const { data: card } = await admin
    .from("cards")
    .select("id, visibility, rendered_image_url")
    .eq("owner_id", owner.id)
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (!card) return { ok: false, error: "No card at that URL." };
  if (card.visibility !== "public") {
    return { ok: false, error: "That card isn't public — feature public cards only." };
  }
  if (!card.rendered_image_url) {
    return {
      ok: false,
      error: "That card has no baked render yet — open and re-save it first.",
    };
  }

  const { error } = await admin
    .from("featured_cards")
    .upsert({ slot, card_id: card.id });
  if (error) {
    console.warn("setFeaturedCardAction: upsert error", error.message);
    return { ok: false, error: "Couldn't save the featured card." };
  }

  revalidatePath("/");
  revalidatePath("/admin/featured");
  return { ok: true };
}
