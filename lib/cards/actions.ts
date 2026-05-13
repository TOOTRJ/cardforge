"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  createCardSchema,
  slugify,
  updateCardSchema,
} from "@/lib/validation/card";
import {
  getCardById,
  isSlugTakenForCurrentUser,
} from "@/lib/cards/queries";
import type { CardInsert, CardUpdate } from "@/types/card";
import type { ZodIssue } from "zod";

// ---------------------------------------------------------------------------
// Result shape — every action returns either a typed success payload or a
// shared error envelope. UI layers can pattern-match without throwing.
// ---------------------------------------------------------------------------

export type CardActionFieldErrors = Partial<Record<string, string>>;

export type CardActionFailure = {
  ok: false;
  formError?: string;
  fieldErrors?: CardActionFieldErrors;
};

export type CreateCardSuccess = {
  ok: true;
  cardId: string;
  slug: string;
};

export type UpdateCardSuccess = {
  ok: true;
  cardId: string;
  slug: string;
};

export type DeleteCardSuccess = {
  ok: true;
  cardId: string;
};

export type CreateCardResult = CreateCardSuccess | CardActionFailure;
export type UpdateCardResult = UpdateCardSuccess | CardActionFailure;
export type DeleteCardResult = DeleteCardSuccess | CardActionFailure;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fieldErrorsFromZod(
  issues: ReadonlyArray<ZodIssue>,
): CardActionFieldErrors {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const segment = issue.path[0];
    if (typeof segment !== "string" && typeof segment !== "number") continue;
    const key = String(segment);
    if (key && !(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

function notConfigured(): CardActionFailure {
  return {
    ok: false,
    formError:
      "Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment.",
  };
}

function notAuthed(): CardActionFailure {
  return {
    ok: false,
    formError: "You must be signed in to do that.",
  };
}

async function ensureUniqueSlugForUser(
  desired: string,
  excludeCardId?: string,
): Promise<{ slug: string; conflict: boolean }> {
  const taken = await isSlugTakenForCurrentUser(desired, excludeCardId);
  if (!taken) return { slug: desired, conflict: false };

  // Try numeric suffixes first; cap attempts so a hostile workspace can't
  // wedge the action.
  for (let attempt = 2; attempt <= 50; attempt += 1) {
    const candidate = `${desired}-${attempt}`.slice(0, 80);
    const stillTaken = await isSlugTakenForCurrentUser(candidate, excludeCardId);
    if (!stillTaken) return { slug: candidate, conflict: true };
  }

  return { slug: desired, conflict: true };
}

function revalidateCardPaths(slug: string, ownerUsername?: string | null) {
  revalidatePath("/dashboard");
  revalidatePath("/sets");
  revalidatePath("/gallery");
  revalidatePath(`/card/${slug}`);
  if (ownerUsername) {
    revalidatePath(`/profile/${ownerUsername}`);
  }
}

async function getOwnerUsername(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();
    return data?.username ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateCardOptions = {
  /** When set, redirect to /card/<slug> after a successful create. */
  redirectAfterCreate?: boolean;
};

export async function createCardAction(
  payload: unknown,
  options: CreateCardOptions = {},
): Promise<CreateCardResult> {
  const parsed = createCardSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  if (!isSupabaseConfigured()) return notConfigured();

  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();

  const data = parsed.data;
  const desiredSlug = data.slug ? slugify(data.slug) : slugify(data.title);
  const { slug } = await ensureUniqueSlugForUser(desiredSlug);

  // If the caller passed a parent_card_id, sanity-check it before insert so
  // we can return a friendlier error than the bare DB FK violation.
  if (data.parent_card_id) {
    const parent = await getCardById(data.parent_card_id);
    if (!parent) {
      return {
        ok: false,
        fieldErrors: { parent_card_id: "The card to remix could not be found." },
      };
    }
  }

  const insert: CardInsert = {
    owner_id: user.id,
    title: data.title,
    slug,
    game_system_id: data.game_system_id,
    template_id: data.template_id ?? null,
    cost: data.cost ?? null,
    color_identity: data.color_identity,
    supertype: data.supertype ?? null,
    card_type: data.card_type ?? null,
    subtypes: data.subtypes,
    rarity: data.rarity ?? null,
    rules_text: data.rules_text ?? null,
    flavor_text: data.flavor_text ?? null,
    power: data.power ?? null,
    toughness: data.toughness ?? null,
    loyalty: data.loyalty ?? null,
    defense: data.defense ?? null,
    artist_credit: data.artist_credit ?? null,
    art_url: data.art_url ?? null,
    art_position: data.art_position ?? {},
    frame_style: data.frame_style ?? {},
    visibility: data.visibility,
    parent_card_id: data.parent_card_id ?? null,
  };

  const { data: row, error } = await supabase
    .from("cards")
    .insert(insert)
    .select("id, slug")
    .single();

  if (error || !row) {
    return {
      ok: false,
      formError: error?.message ?? "Could not create card.",
    };
  }

  const ownerUsername = await getOwnerUsername();
  revalidateCardPaths(row.slug, ownerUsername);

  if (options.redirectAfterCreate) {
    redirect(`/card/${row.slug}`);
  }

  return { ok: true, cardId: row.id, slug: row.slug };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateCardAction(
  cardId: string,
  payload: unknown,
): Promise<UpdateCardResult> {
  const parsed = updateCardSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    return { ok: false, formError: "No changes provided." };
  }

  if (!isSupabaseConfigured()) return notConfigured();

  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();

  // Existence + ownership pre-flight: produces a friendlier error than the
  // RLS-driven 0-rows-affected silence.
  const existing = await getCardById(cardId);
  if (!existing || existing.owner_id !== user.id) {
    return { ok: false, formError: "Card not found or not yours to edit." };
  }

  const update: CardUpdate = {};

  if (data.title !== undefined) update.title = data.title;
  if (data.slug !== undefined) {
    const candidate = slugify(data.slug);
    const { slug } = await ensureUniqueSlugForUser(candidate, cardId);
    update.slug = slug;
  }
  if (data.game_system_id !== undefined) update.game_system_id = data.game_system_id;
  if (data.template_id !== undefined) update.template_id = data.template_id;
  if (data.cost !== undefined) update.cost = data.cost ?? null;
  if (data.color_identity !== undefined) update.color_identity = data.color_identity;
  if (data.supertype !== undefined) update.supertype = data.supertype ?? null;
  if (data.card_type !== undefined) update.card_type = data.card_type ?? null;
  if (data.subtypes !== undefined) update.subtypes = data.subtypes;
  if (data.rarity !== undefined) update.rarity = data.rarity ?? null;
  if (data.rules_text !== undefined) update.rules_text = data.rules_text ?? null;
  if (data.flavor_text !== undefined) update.flavor_text = data.flavor_text ?? null;
  if (data.power !== undefined) update.power = data.power ?? null;
  if (data.toughness !== undefined) update.toughness = data.toughness ?? null;
  if (data.loyalty !== undefined) update.loyalty = data.loyalty ?? null;
  if (data.defense !== undefined) update.defense = data.defense ?? null;
  if (data.artist_credit !== undefined) update.artist_credit = data.artist_credit ?? null;
  if (data.art_url !== undefined) update.art_url = data.art_url ?? null;
  if (data.art_position !== undefined) update.art_position = data.art_position;
  if (data.frame_style !== undefined) update.frame_style = data.frame_style;
  if (data.visibility !== undefined) update.visibility = data.visibility;
  if (data.parent_card_id !== undefined) update.parent_card_id = data.parent_card_id;

  const { data: row, error } = await supabase
    .from("cards")
    .update(update)
    .eq("id", cardId)
    .eq("owner_id", user.id)
    .select("id, slug")
    .single();

  if (error || !row) {
    return {
      ok: false,
      formError: error?.message ?? "Could not update card.",
    };
  }

  const ownerUsername = await getOwnerUsername();
  revalidateCardPaths(row.slug, ownerUsername);
  // Also revalidate the previous slug if it changed.
  if (existing.slug !== row.slug) {
    revalidatePath(`/card/${existing.slug}`);
  }
  // If visibility moved out of (or into) a shareable state, flush the OG
  // image route too. The route filters visibility at query time (defense in
  // depth) but the CDN cache layer hangs onto the rendered PNG for up to
  // s-maxage seconds; revalidating drops that cache so a public-→-private
  // flip immediately stops serving the old image to social scrapers.
  const visibilityChanged =
    update.visibility !== undefined && update.visibility !== existing.visibility;
  if (visibilityChanged) {
    revalidatePath(`/api/cards/${row.id}/og`);
  }

  return { ok: true, cardId: row.id, slug: row.slug };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteCardAction(
  cardId: string,
): Promise<DeleteCardResult> {
  if (!isSupabaseConfigured()) return notConfigured();

  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();

  const existing = await getCardById(cardId);
  if (!existing || existing.owner_id !== user.id) {
    return { ok: false, formError: "Card not found or not yours to delete." };
  }

  const { error } = await supabase
    .from("cards")
    .delete()
    .eq("id", cardId)
    .eq("owner_id", user.id);

  if (error) {
    return { ok: false, formError: error.message };
  }

  const ownerUsername = await getOwnerUsername();
  revalidateCardPaths(existing.slug, ownerUsername);

  return { ok: true, cardId };
}

// ---------------------------------------------------------------------------
// Remix (fork) — convenience wrapper around createCard that copies fields
// from a parent and stamps parent_card_id.
// ---------------------------------------------------------------------------

export type RemixCardInput = {
  parentCardId: string;
  /** Optional title override; defaults to "<parent title> (remix)". */
  title?: string;
};

export async function remixCardAction(
  input: RemixCardInput,
): Promise<CreateCardResult> {
  if (!isSupabaseConfigured()) return notConfigured();

  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const parent = await getCardById(input.parentCardId);
  if (!parent) {
    return { ok: false, formError: "Parent card not found." };
  }

  // RLS already prevents reading private cards belonging to others, so the
  // existence check above is also an authorization check by virtue of RLS.

  const title = (input.title?.trim() || `${parent.title} (remix)`).slice(0, 120);

  return createCardAction({
    title,
    slug: undefined,
    game_system_id: parent.game_system_id,
    template_id: parent.template_id ?? undefined,
    cost: parent.cost ?? undefined,
    color_identity: parent.color_identity,
    supertype: parent.supertype ?? undefined,
    card_type: parent.card_type ?? undefined,
    subtypes: parent.subtypes,
    rarity: parent.rarity ?? undefined,
    rules_text: parent.rules_text ?? undefined,
    flavor_text: parent.flavor_text ?? undefined,
    power: parent.power ?? undefined,
    toughness: parent.toughness ?? undefined,
    loyalty: parent.loyalty ?? undefined,
    defense: parent.defense ?? undefined,
    artist_credit: parent.artist_credit ?? undefined,
    art_url: parent.art_url ?? undefined,
    art_position: parent.art_position ?? {},
    frame_style: parent.frame_style ?? {},
    visibility: "private",
    parent_card_id: parent.id,
  });
}
