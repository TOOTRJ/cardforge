"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  fieldErrorsFromZod,
  pinnedCardIdsSchema,
  profileUpdateSchema,
  SOCIAL_PLATFORMS,
  type ActionState,
  type PinnedCardIdsInput,
  type ProfileUpdateInput,
} from "@/lib/auth/schemas";

export type ProfileActionState = ActionState<ProfileUpdateInput> & {
  success?: boolean;
};

// Stringify any value for the round-trip "echo back form values on error" path.
function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function echoValues(
  raw: Record<string, FormDataEntryValue | null>,
): NonNullable<ProfileActionState["values"]> {
  return {
    username: s(raw.username),
    display_name: s(raw.display_name),
    bio: s(raw.bio),
    website_url: s(raw.website_url),
    accent_color: s(raw.accent_color),
    twitter_url: s(raw.twitter_url),
    bluesky_url: s(raw.bluesky_url),
    instagram_url: s(raw.instagram_url),
    youtube_url: s(raw.youtube_url),
    tiktok_url: s(raw.tiktok_url),
    discord_url: s(raw.discord_url),
    github_url: s(raw.github_url),
  };
}

export async function updateProfileAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const raw: Record<string, FormDataEntryValue | null> = {
    username: formData.get("username"),
    display_name: formData.get("display_name"),
    bio: formData.get("bio"),
    website_url: formData.get("website_url"),
    accent_color: formData.get("accent_color"),
    twitter_url: formData.get("twitter_url"),
    bluesky_url: formData.get("bluesky_url"),
    instagram_url: formData.get("instagram_url"),
    youtube_url: formData.get("youtube_url"),
    tiktok_url: formData.get("tiktok_url"),
    discord_url: formData.get("discord_url"),
    github_url: formData.get("github_url"),
  };

  const parsed = profileUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZod<ProfileUpdateInput>(parsed.error.issues),
      values: echoValues(raw),
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      formError: "Supabase isn't configured. Set env vars in .env.local.",
      values: echoValues(raw),
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    return {
      status: "error",
      formError: "You must be signed in to update your profile.",
    };
  }

  const supabase = await createClient();

  if (parsed.data.username) {
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", parsed.data.username)
      .neq("id", user.id)
      .maybeSingle();

    if (existing) {
      return {
        status: "error",
        fieldErrors: { username: "That username is already taken." },
        values: echoValues(raw),
      };
    }
  }

  // Build the update object by mapping every social key → its parsed value
  // (or null when the user cleared it). Keeps the columns and the schema
  // in lockstep — adding a platform only touches lib/auth/schemas.ts.
  const socialFields = Object.fromEntries(
    SOCIAL_PLATFORMS.map((p) => [p.key, parsed.data[p.key] ?? null]),
  );

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      username: parsed.data.username,
      display_name: parsed.data.display_name,
      bio: parsed.data.bio ?? null,
      website_url: parsed.data.website_url ?? null,
      accent_color: parsed.data.accent_color ?? null,
      ...socialFields,
    },
    { onConflict: "id" },
  );

  if (error) {
    return {
      status: "error",
      formError: error.message,
      values: echoValues(raw),
    };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath(`/profile/${parsed.data.username}`);

  return { status: "idle", success: true };
}

// ---------------------------------------------------------------------------
// Pinned cards
//
// Saves a user's pinned card ids (max 3). We re-validate that the cards
// actually belong to the user and are publicly visible — RLS would block
// reads of someone else's private card anyway, but doing the check here
// gives a friendlier error than a silent constraint failure.
// ---------------------------------------------------------------------------

export type PinnedCardsActionState = ActionState<{ pinned_card_ids: string }> & {
  success?: boolean;
};

export async function updatePinnedCardsAction(
  _prev: PinnedCardsActionState,
  formData: FormData,
): Promise<PinnedCardsActionState> {
  // Form serializes as repeated `pinned_card_ids[]` entries (one per checked
  // card) for compatibility with a plain HTML form. We accept either that
  // or a single comma-separated string for non-DOM callers.
  const raw = formData.getAll("pinned_card_ids");
  const ids: string[] =
    raw.length > 0
      ? raw.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];

  const parsed: PinnedCardIdsInput | null = (() => {
    const r = pinnedCardIdsSchema.safeParse(ids);
    return r.success ? r.data : null;
  })();

  if (!parsed) {
    return {
      status: "error",
      formError: "Pick up to 3 unique cards to pin.",
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      formError: "Supabase isn't configured.",
    };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { status: "error", formError: "You must be signed in." };
  }

  const supabase = await createClient();

  if (parsed.length > 0) {
    const { data: ownedCards, error: ownedErr } = await supabase
      .from("cards")
      .select("id, visibility")
      .in("id", parsed)
      .eq("owner_id", user.id);
    if (ownedErr) {
      return { status: "error", formError: ownedErr.message };
    }
    if ((ownedCards?.length ?? 0) !== parsed.length) {
      return {
        status: "error",
        formError: "You can only pin cards you own.",
      };
    }
    const allPublic = ownedCards!.every((c) => c.visibility === "public");
    if (!allPublic) {
      return {
        status: "error",
        formError: "Pinned cards must be set to Public.",
      };
    }
  }

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ pinned_card_ids: parsed })
    .eq("id", user.id);

  if (updateErr) {
    return { status: "error", formError: updateErr.message };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.username) {
    revalidatePath(`/profile/${profile.username}`);
  }

  return { status: "idle", success: true };
}
