"use server";

import "server-only";

import { z } from "zod";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { CHALLENGE_NAV_TAG } from "@/lib/challenges/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { slugify } from "@/lib/validation/card";
import { isUuid } from "@/lib/ids";
import { revalidateCardPages, type CardPageRef } from "@/lib/cards/revalidate";
import { winnerErrorMessage } from "@/lib/challenges/winners-shared";

// ---------------------------------------------------------------------------
// Challenge admin writes. RLS already restricts writes to profiles.is_admin;
// these actions re-check up front so non-admins get a clean message instead
// of a row-level-security error. Mirrors the moderation action posture.
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

const createChallengeSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  tag: z
    .string()
    .trim()
    .toLowerCase()
    .regex(TAG_PATTERN, "Tag must be lowercase letters/numbers/hyphens (2–40 chars)."),
  durationDays: z.coerce.number().int().min(1).max(60),
  featured: z.coerce.boolean(),
});

export type ChallengeActionResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

async function requireAdmin(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return "Admin access required.";
  return null;
}

/** Same normalisation as card/deck/set slugs (diacritics folded). An empty
 *  result gets no fallback here — the SLUG_PATTERN check below rejects it. */
function challengeSlugFromTitle(title: string): string {
  return slugify(title, 64, "");
}

function revalidateChallengeSurfaces() {
  revalidatePath("/challenges");
  // Every /challenges/[slug] page — "Close now" and the feature toggle
  // change what the detail page says (days left, banner), and it's ISR'd.
  revalidatePath("/challenges/[slug]", "page");
  revalidatePath("/gallery");
  revalidatePath("/admin/challenges");
  // The header's "Ends in N days" pill, on every page.
  revalidateTag(CHALLENGE_NAV_TAG, "max");
}

export async function createChallengeAction(
  formData: FormData,
): Promise<ChallengeActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };

  const parsed = createChallengeSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    tag: formData.get("tag"),
    durationDays: formData.get("durationDays") ?? 14,
    featured: formData.get("featured") === "on" || formData.get("featured") === "true",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `${first.path.join(".")}: ${first.message}` };
  }
  const { title, description, tag, durationDays, featured } = parsed.data;

  const slug = challengeSlugFromTitle(title);
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error: "Title must contain at least a few letters or numbers (it drives the URL).",
    };
  }

  const now = new Date();
  const ends = new Date(now.getTime() + durationDays * 86_400_000);

  const supabase = await createClient();
  const { error } = await supabase.from("challenges").insert({
    slug,
    title,
    description,
    tag,
    starts_at: now.toISOString(),
    ends_at: ends.toISOString(),
    featured,
  });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return { ok: false, error: `A challenge with the slug "${slug}" already exists.` };
    }
    return { ok: false, error: error.message };
  }

  revalidateChallengeSurfaces();
  return { ok: true, slug };
}

export async function setChallengeFeaturedAction(
  id: string,
  featured: boolean,
): Promise<ChallengeActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("challenges")
    .update({ featured })
    .eq("id", id)
    .select("slug")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Challenge not found." };
  }
  revalidateChallengeSurfaces();
  return { ok: true, slug: data.slug };
}

/** End a challenge immediately (sets ends_at to now). */
export async function closeChallengeAction(
  id: string,
): Promise<ChallengeActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("challenges")
    .update({ ends_at: new Date().toISOString() })
    .eq("id", id)
    .select("slug")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Challenge not found." };
  }
  revalidateChallengeSurfaces();
  return { ok: true, slug: data.slug };
}

export type ChallengeWinnersResult = { ok: true } | { ok: false; error: string };

/**
 * Name a CLOSED challenge's winners (TODO NV12, migration 0172): the three
 * places as wanted, `null` = an empty place, in ONE call of
 * set_challenge_winners (its guard refuses an open challenge and a card that
 * isn't a public entry; its trigger notifies each newly named maker). The
 * challenge pages and the static page of every card that gained or lost a
 * place are refreshed.
 */
export async function setChallengeWinnersAction(
  challengeId: string,
  places: readonly (string | null)[],
): Promise<ChallengeWinnersResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  if (!isUuid(challengeId) || !Array.isArray(places) || places.length !== 3) {
    return { ok: false, error: "That isn't a challenge's winners." };
  }
  const wanted = places.map((id) => (id ? id : null));
  if (wanted.some((id) => id !== null && !isUuid(id))) {
    return { ok: false, error: "That isn't one of the challenge's entries." };
  }
  const named = wanted.filter((id): id is string => id !== null);
  if (new Set(named).size !== named.length) {
    return { ok: false, error: winnerErrorMessage("duplicate_winner") };
  }

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("challenge_winners")
    .select("card_id")
    .eq("challenge_id", challengeId);
  const { error } = await supabase.rpc("set_challenge_winners", {
    p_challenge_id: challengeId,
    p_first: wanted[0],
    p_second: wanted[1],
    p_third: wanted[2],
  });
  if (error) return { ok: false, error: winnerErrorMessage(error.message) };

  revalidateChallengeSurfaces();
  const touched = [...new Set([...(before ?? []).map((row) => row.card_id), ...named])];
  revalidateCardPages(await cardPageRefs(supabase, touched));
  return { ok: true };
}

/** Each card's id, slug and owner's handle, for its static page. */
async function cardPageRefs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: readonly string[],
): Promise<CardPageRef[]> {
  if (ids.length === 0) return [];
  const { data: cards } = await supabase.from("cards").select("id, slug, owner_id").in("id", [...ids]);
  const ownerIds = [...new Set((cards ?? []).map((card) => card.owner_id))];
  const { data: owners } = ownerIds.length
    ? await supabase.from("profiles").select("id, username").in("id", ownerIds)
    : { data: [] };
  const handles = new Map((owners ?? []).map((owner) => [owner.id, owner.username]));
  const found = new Set((cards ?? []).map((card) => card.id));
  return [
    ...(cards ?? []).map((card) => ({
      id: card.id,
      slug: card.slug,
      ownerUsername: handles.get(card.owner_id) ?? null,
    })),
    // A card the admin can't read any more (made private since): no name,
    // so every card page expires once rather than one staying stale.
    ...ids.filter((id) => !found.has(id)).map((id) => ({ id })),
  ];
}
