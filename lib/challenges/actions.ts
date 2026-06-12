"use server";

import "server-only";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

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

function challengeSlugFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug;
}

function revalidateChallengeSurfaces() {
  revalidatePath("/challenges");
  revalidatePath("/gallery");
  revalidatePath("/admin/challenges");
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
