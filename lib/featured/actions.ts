"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN } from "@/lib/auth/usernames";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ids";
import { heroRefusalLabel } from "@/lib/featured/hero-rotation";

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
  if (
    handle.length < USERNAME_MIN ||
    handle.length > USERNAME_MAX ||
    !USERNAME_PATTERN.test(handle)
  ) {
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
    const { error } = await admin.from("featured_cards").delete().eq("slot", slot);
    if (error) return { ok: false, error: `Couldn't clear slot ${slot}: ${error.message}` };
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

// ---------------------------------------------------------------------------
// The home hero's pool (TODO HM4, migration 0169). The guard is the
// database's (featured_pool_add → home_hero_refusal): the app parses the URL
// and says the answer, never judges a card itself. Every change purges "/" at
// once — the admin never waits out the page's ISR window.
// ---------------------------------------------------------------------------

export type HeroPoolActionResult =
  | { ok: true; already?: boolean }
  | { ok: false; error: string };

async function requireAdminWriter() {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { error: "Not authorized." } as const;
  if (!isAdminConfigured()) return { error: "Admin client isn't configured." } as const;
  return { admin: createAdminClient(), profileId: profile.id as string } as const;
}

function revalidateHeroPool() {
  revalidatePath("/");
  revalidatePath("/admin/featured");
}

// What the pool's add takes from the browser: a card page URL (the admin's
// paste) or a card id (a suggestion's button) — parsed, never assumed.
const heroPoolTargetSchema = z.union([
  z.object({ cardUrl: z.string().max(2048) }),
  z.object({ cardId: z.string().max(64) }),
]);

/** Admin: add a card to the hero's pool. By its card page URL (resolved
 *  here to the card's id): ANY public card with a stored bake, whoever made
 *  it. By id (a suggestion's button): only a card that passes the full
 *  original-card guard — a client-sent id never takes the URL's wider door.
 *  featured_pool_add decides either way. */
export async function addHeroPoolCardAction(
  input: { cardUrl: string } | { cardId: string },
): Promise<HeroPoolActionResult> {
  const gate = await requireAdminWriter();
  if ("error" in gate) return { ok: false, error: gate.error as string };
  const { admin, profileId } = gate;
  const parsed = heroPoolTargetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown card." };
  const target = parsed.data;

  let cardId: string;
  if ("cardId" in target) {
    if (!isUuid(target.cardId)) return { ok: false, error: "Unknown card." };
    cardId = target.cardId;
  } else {
    const match = target.cardUrl
      .trim()
      .match(/\/card\/([a-z0-9_]+)\/([a-z0-9-]+)\/?(?:[?#]|$)/i);
    if (!match) {
      return { ok: false, error: "Paste a card page URL, e.g. /card/username/card-slug." };
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
      .select("id")
      .eq("owner_id", owner.id)
      .eq("slug", slug.toLowerCase())
      .maybeSingle();
    if (!card) return { ok: false, error: "No card at that URL." };
    cardId = card.id;
  }

  const { data, error } = await admin.rpc("featured_pool_add", {
    p_card_id: cardId,
    p_added_by: profileId,
    p_original_only: "cardId" in target,
  });
  if (error) {
    console.warn("addHeroPoolCardAction: featured_pool_add failed", error.message);
    return { ok: false, error: "Couldn't add the card to the pool." };
  }
  if (data === "already") return { ok: true, already: true };
  if (data !== "added") return { ok: false, error: heroRefusalLabel(String(data)) };
  revalidateHeroPool();
  return { ok: true };
}

/** Admin: take a card out of the hero's pool. */
export async function removeHeroPoolCardAction(cardId: string): Promise<HeroPoolActionResult> {
  const gate = await requireAdminWriter();
  if ("error" in gate) return { ok: false, error: gate.error as string };
  if (!isUuid(cardId)) return { ok: false, error: "Unknown card." };
  const { error } = await gate.admin.from("featured_pool").delete().eq("card_id", cardId);
  if (error) {
    console.warn("removeHeroPoolCardAction: delete failed", error.message);
    return { ok: false, error: "Couldn't remove the card from the pool." };
  }
  revalidateHeroPool();
  return { ok: true };
}
