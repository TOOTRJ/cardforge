"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
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
import { bakeAndPersistCardRender } from "@/lib/cards/bake-render";
import { addCustomCardEntryToDeck } from "@/lib/decks/membership";
import { cardRenderPath } from "@/lib/cards/storage-paths";
import { normalizeManaCost } from "@/lib/cards/mana-order";
import {
  VISIBILITY_VALUES,
  frameStyleRequiresPremium,
  type CardInsert,
  type CardUpdate,
  type Visibility,
} from "@/types/card";
import { getEntitlements } from "@/lib/billing/entitlements";
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
  /** "UPGRADE_REQUIRED" when a paid plan is needed — the UI opens the upgrade
   *  modal instead of showing a generic error. */
  code?: string;
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
      "Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in your environment.",
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

/**
 * Purge the ISR'd discovery pages (home trending/stats, challenges index,
 * every challenge detail). Card mutations are rare relative to reads, so
 * eager purging keeps those pages fresh without shrinking their
 * revalidate windows. Like-toggles deliberately do NOT purge — the ISR
 * window absorbs that churn.
 */
function revalidateDiscoverySurfaces() {
  revalidatePath("/");
  revalidatePath("/challenges");
  // Purges every /challenges/[slug] page — a published card may be an
  // entry in whichever challenge matches its tags; resolving which one
  // isn't worth a lookup when the purge is this cheap.
  revalidatePath("/challenges/[slug]", "page");
}

function revalidateCardPaths(slug: string, ownerUsername?: string | null) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/sets");
  revalidatePath("/gallery");
  revalidateDiscoverySurfaces();
  // Legacy slug-only path still serves as the redirector — busting its
  // cache keeps stale redirects from sticking after a slug edit.
  revalidatePath(`/card/${slug}`);
  if (ownerUsername) {
    revalidatePath(`/profile/${ownerUsername}`);
    // Canonical public detail URL (Phase 11 chunk 11).
    revalidatePath(`/card/${ownerUsername}/${slug}`);
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
  /**
   * When set, redirect to the canonical `/card/[username]/[slug]` after a
   * successful create. Falls back to `/card/[slug]` (legacy redirector) when
   * the owner has no username yet.
   */
  redirectAfterCreate?: boolean;
};

type ResolvedSetIcon = {
  primary_set_id: string | null;
  set_icon_url: string | null;
  set_icon_code: string | null;
};

// Resolve a card's chosen primary set into the denormalized symbol fields. The
// set must be owned by the user; an unknown/foreign set is silently dropped (we
// don't fail the save over it). Returns the source set id for membership.
async function resolvePrimarySet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  primarySetId: string | null | undefined,
): Promise<ResolvedSetIcon> {
  const empty: ResolvedSetIcon = {
    primary_set_id: null,
    set_icon_url: null,
    set_icon_code: null,
  };
  if (!primarySetId) return empty;
  const { data: set } = await supabase
    .from("card_sets")
    .select("id, icon_url, icon_code")
    .eq("id", primarySetId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!set) return empty;
  return {
    primary_set_id: set.id,
    set_icon_url: set.icon_url ?? null,
    set_icon_code: set.icon_code ?? null,
  };
}

// Add the card to a set's item list, appended after the current last position.
// Idempotent on the (set_id, card_id) unique constraint; best-effort.
async function addCardToSetMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  setId: string,
  cardId: string,
): Promise<void> {
  const { data: rows } = await supabase
    .from("card_set_items")
    .select("position")
    .eq("set_id", setId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = (rows?.[0]?.position ?? -1) + 1;
  await supabase
    .from("card_set_items")
    .upsert(
      { set_id: setId, card_id: cardId, position: nextPosition },
      { onConflict: "set_id,card_id", ignoreDuplicates: true },
    );
}

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

  // Entitlement gates. Premium frame/finish (our own tech only — never WotC
  // trade dress) requires a paid plan; saved-card capacity is tier-based.
  const entitlements = await getEntitlements();
  if (
    frameStyleRequiresPremium(data.frame_style) &&
    !entitlements.premiumFrames
  ) {
    return {
      ok: false,
      code: "UPGRADE_REQUIRED",
      fieldErrors: {
        frame_style: "That finish is a premium feature — upgrade to use it.",
      },
    };
  }
  if (entitlements.cardCapacity !== -1) {
    const { count } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id);
    if ((count ?? 0) >= entitlements.cardCapacity) {
      return {
        ok: false,
        code: "UPGRADE_REQUIRED",
        formError: `You've reached your ${entitlements.cardCapacity}-card limit. Upgrade for more space.`,
      };
    }
  }

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

  // A back face references another of the user's OWN cards — pre-flight
  // exists + ownership for a friendly error over a bare FK violation.
  if (data.back_card_id) {
    const backCard = await getCardById(data.back_card_id);
    if (!backCard || backCard.owner_id !== user.id) {
      return {
        ok: false,
        fieldErrors: { back_card_id: "That back-face card couldn't be found." },
      };
    }
  }

  // Cross-field sanity: loyalty rows belong to planeswalkers. (Saga chapters
  // aren't type-gated — the saga frame carries them and card_type stays
  // enchantment.) Friendly pre-flight over silently storing dead content.
  if (data.face_content?.loyalty && data.card_type !== "planeswalker") {
    return {
      ok: false,
      fieldErrors: {
        rules_text: "Loyalty abilities only apply to planeswalker cards.",
      },
    };
  }

  const setIcon = await resolvePrimarySet(supabase, user.id, data.primary_set_id);
  // Direct icon fields (the Set icon step) win over the set-derived symbol —
  // they're the only icon UI while the sets feature is hidden. Callers that
  // omit them (AI batch flows) keep the set-derived resolution.
  const hasDirectIcon =
    data.set_icon_url !== undefined || data.set_icon_code !== undefined;

  const insert: CardInsert = {
    owner_id: user.id,
    title: data.title,
    slug,
    game_system_id: data.game_system_id,
    template_id: data.template_id ?? null,
    // Defense in depth — the picker already normalizes pip order, but costs
    // also arrive via drafts and imports. Unrecognized tokens pass through.
    cost: data.cost ? normalizeManaCost(data.cost) : null,
    color_identity: data.color_identity,
    supertype: data.supertype ?? null,
    card_type: data.card_type ?? null,
    subtypes: data.subtypes,
    tags: data.tags ?? [],
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
    // No artwork → no gallery. A public save without art lands as a draft
    // (private) so test/unfinished cards never occupy gallery space; the
    // creator predicts this client-side and tells the user. Unlisted stays
    // allowed — link-only sharing of a WIP is deliberate and gallery-free.
    visibility:
      data.visibility === "public" && !data.art_url
        ? "private"
        : data.visibility,
    parent_card_id: data.parent_card_id ?? null,
    // Back face (chunk 10): null when undefined or explicitly cleared,
    // jsonb object when the user has filled in DFC content.
    back_face: data.back_face ?? null,
    // v2 back face: FK to a full owned card (fully customisable), or null.
    back_card_id: data.back_card_id ?? null,
    // Scryfall provenance (chunk 13): the source card id when imported,
    // null otherwise. Stays null forever for forged-from-scratch cards.
    source_scryfall_id: data.source_scryfall_id ?? null,
    // Structured loyalty/saga rows (migration 0050); null = derive from
    // rules_text. Design watermark; null = none.
    face_content: data.face_content ?? null,
    watermark: data.watermark ?? null,
    primary_set_id: setIcon.primary_set_id,
    set_icon_url: hasDirectIcon ? (data.set_icon_url ?? null) : setIcon.set_icon_url,
    set_icon_code: hasDirectIcon
      ? (data.set_icon_code ?? null)
      : setIcon.set_icon_code,
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

  // Add the card to its chosen set's item list (the symbol is already
  // denormalized on the row above).
  if (setIcon.primary_set_id) {
    await addCardToSetMembership(supabase, setIcon.primary_set_id, row.id);
  }

  // Drop the card into its chosen deck as a custom-only mainboard entry.
  // Best-effort — a deck hiccup never rolls back the card save.
  if (data.deck_id) {
    await addCustomCardEntryToDeck(
      supabase,
      user.id,
      data.deck_id,
      row.id,
      data.title,
    );
  }

  const ownerUsername = await getOwnerUsername();
  revalidateCardPaths(row.slug, ownerUsername);

  // Bake the public PNG AFTER the response is sent (next/server `after`) so
  // Save never blocks on HD rasterization + upload — the same posture as the
  // custom-pip rebake sweep. This is what the gallery/profile/detail pages
  // render; until it lands they fall back to the live <CardPreview>, and we
  // revalidate those surfaces again once the render is persisted so the
  // freshly baked image appears without waiting for the ISR window. Failures
  // never roll back the create (bakeAndPersistCardRender clears stale render
  // columns and logs).
  after(async () => {
    try {
      await bakeAndPersistCardRender(row.id, user.id);
      revalidateCardPaths(row.slug, ownerUsername);
    } catch (error) {
      console.error(`[create-card] deferred bake failed for ${row.id}:`, error);
    }
  });

  if (options.redirectAfterCreate) {
    redirect(
      ownerUsername
        ? `/card/${ownerUsername}/${row.slug}`
        : `/card/${row.slug}`,
    );
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

  // Back-face reference (when setting it): must be another of the user's own
  // cards and never the card itself.
  if (data.back_card_id) {
    if (data.back_card_id === cardId) {
      return {
        ok: false,
        fieldErrors: { back_card_id: "A card can't be its own back face." },
      };
    }
    const backCard = await getCardById(data.back_card_id);
    if (!backCard || backCard.owner_id !== user.id) {
      return {
        ok: false,
        fieldErrors: { back_card_id: "That back-face card couldn't be found." },
      };
    }
  }

  // Premium frame/finish gate (our own tech only — never WotC trade dress).
  if (data.frame_style !== undefined) {
    const entitlements = await getEntitlements();
    if (
      frameStyleRequiresPremium(data.frame_style) &&
      !entitlements.premiumFrames
    ) {
      return {
        ok: false,
        code: "UPGRADE_REQUIRED",
        fieldErrors: {
          frame_style: "That finish is a premium feature — upgrade to use it.",
        },
      };
    }
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
  if (data.cost !== undefined) {
    update.cost = data.cost ? normalizeManaCost(data.cost) : null;
  }
  if (data.color_identity !== undefined) update.color_identity = data.color_identity;
  if (data.supertype !== undefined) update.supertype = data.supertype ?? null;
  if (data.card_type !== undefined) update.card_type = data.card_type ?? null;
  if (data.subtypes !== undefined) update.subtypes = data.subtypes;
  if (data.tags !== undefined) update.tags = data.tags;
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
  // No artwork → no gallery (same rule as create). The EFFECTIVE art is the
  // patched value when present, else what the row already stores — so both
  // "publish an artless card" and "remove the art from a public card"
  // demote to draft.
  {
    const effectiveArt =
      data.art_url !== undefined ? data.art_url : existing.art_url;
    const effectiveVisibility =
      update.visibility !== undefined ? update.visibility : existing.visibility;
    if (!effectiveArt && effectiveVisibility === "public") {
      update.visibility = "private";
    }
  }
  if (data.parent_card_id !== undefined) update.parent_card_id = data.parent_card_id;
  // Back face: `null` clears it; an object replaces it whole. Omitting
  // the field leaves whatever the DB already had untouched.
  if (data.back_face !== undefined) update.back_face = data.back_face ?? null;
  // v2 back-face reference: null clears, a uuid links, omitted leaves alone.
  if (data.back_card_id !== undefined)
    update.back_card_id = data.back_card_id ?? null;
  // Scryfall source: same semantics — null clears, omitted leaves alone.
  if (data.source_scryfall_id !== undefined)
    update.source_scryfall_id = data.source_scryfall_id ?? null;
  // Structured face content + watermark: null clears, omitted leaves alone.
  if (data.face_content !== undefined)
    update.face_content = data.face_content ?? null;
  if (data.watermark !== undefined) update.watermark = data.watermark ?? null;
  // Primary set: re-resolve so the card's denormalized symbol stays in sync.
  const resolvedSet =
    data.primary_set_id !== undefined
      ? await resolvePrimarySet(supabase, user.id, data.primary_set_id)
      : null;
  if (resolvedSet) {
    update.primary_set_id = resolvedSet.primary_set_id;
    update.set_icon_url = resolvedSet.set_icon_url;
    update.set_icon_code = resolvedSet.set_icon_code;
  }
  // Direct icon fields (the Set icon step) apply AFTER set resolution so an
  // explicit edit always wins over the set-derived symbol. null clears back
  // to the default PipGlyph mark; omitted leaves the columns alone.
  if (data.set_icon_url !== undefined)
    update.set_icon_url = data.set_icon_url ?? null;
  if (data.set_icon_code !== undefined)
    update.set_icon_code = data.set_icon_code ?? null;

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

  if (resolvedSet?.primary_set_id) {
    await addCardToSetMembership(supabase, resolvedSet.primary_set_id, row.id);
  }

  const ownerUsername = await getOwnerUsername();
  revalidateCardPaths(row.slug, ownerUsername);
  // Also revalidate the previous slug if it changed — both the legacy
  // redirector and the canonical username-namespaced URL need busting so
  // the old URL stops resolving to stale data.
  if (existing.slug !== row.slug) {
    revalidatePath(`/card/${existing.slug}`);
    if (ownerUsername) {
      revalidatePath(`/card/${ownerUsername}/${existing.slug}`);
    }
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

  // Re-bake the PNG AFTER the response is sent (next/server `after`) so Save
  // stays fast, then revalidate the card surfaces again so the updated render
  // (or, on failure, the live-preview fallback) appears. A bake failure clears
  // the now-stale render columns (bakeAndPersistCardRender) instead of leaving
  // the old mismatched PNG in place.
  after(async () => {
    try {
      await bakeAndPersistCardRender(row.id, user.id);
      revalidateCardPaths(row.slug, ownerUsername);
      if (visibilityChanged) revalidatePath(`/api/cards/${row.id}/og`);
    } catch (error) {
      console.error(`[update-card] deferred bake failed for ${row.id}:`, error);
    }
  });

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

  // Remove the card's baked render from the public bucket (best-effort; the
  // render path is per-card, so this never touches another card's render). Art
  // is left alone — remixes copy art_url, so it can be shared.
  await supabase.storage
    .from("card-renders")
    .remove([cardRenderPath(existing.owner_id, cardId)]);

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
  /** AI-remix overrides — replace the copied value instead of inheriting.
   *  `flavorText: null` clears the parent's flavor; `artUrl` also resets the
   *  art position (the new render needn't share the parent's framing). */
  flavorText?: string | null;
  artUrl?: string;
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
    tags: parent.tags ?? [],
    rarity: parent.rarity ?? undefined,
    rules_text: parent.rules_text ?? undefined,
    flavor_text:
      input.flavorText !== undefined
        ? input.flavorText ?? undefined
        : parent.flavor_text ?? undefined,
    power: parent.power ?? undefined,
    toughness: parent.toughness ?? undefined,
    loyalty: parent.loyalty ?? undefined,
    defense: parent.defense ?? undefined,
    artist_credit: input.artUrl ? undefined : parent.artist_credit ?? undefined,
    art_url: input.artUrl ?? parent.art_url ?? undefined,
    art_position: input.artUrl ? {} : parent.art_position ?? {},
    frame_style: parent.frame_style ?? {},
    visibility: "private",
    parent_card_id: parent.id,
  });
}

// ---------------------------------------------------------------------------
// Bulk actions (Phase 11 chunk 08)
//
// Both bulk actions follow the same shape:
//   1. Validate the request (Zod: array of UUIDs)
//   2. Pre-flight ownership check across the full id set — if ANY card is
//      missing or belongs to another user, abort the whole batch.
//   3. Single mutation across the set, bounded to `owner_id = user.id` as
//      a belt-and-braces guard alongside RLS.
//   4. Revalidate the dashboard / gallery / sets surfaces.
//
// We bound batches at 100 ids to keep request payloads reasonable + so the
// pre-flight `IN (...)` query stays index-friendly.
// ---------------------------------------------------------------------------

const BULK_MAX_IDS = 100;

const bulkCardIdsSchema = z
  .array(z.string().uuid("Invalid card id."))
  .min(1, "Pick at least one card.")
  .max(BULK_MAX_IDS, `Up to ${BULK_MAX_IDS} cards at a time.`);

const bulkVisibilitySchema = z.object({
  cardIds: bulkCardIdsSchema,
  visibility: z.enum(VISIBILITY_VALUES),
});

export type BulkCardsSuccess = {
  ok: true;
  count: number;
};

export type BulkCardsFailure = {
  ok: false;
  error: string;
};

export type BulkCardsResult = BulkCardsSuccess | BulkCardsFailure;

export async function updateCardsVisibilityAction(
  cardIds: string[],
  visibility: Visibility,
): Promise<BulkCardsResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to update cards." };
  }

  const parsed = bulkVisibilitySchema.safeParse({ cardIds, visibility });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }
  const ids = Array.from(new Set(parsed.data.cardIds));

  const supabase = await createClient();

  // Pre-flight ownership: every id must exist AND be owned by the caller.
  const { data: existing, error: existingError } = await supabase
    .from("cards")
    .select("id, owner_id")
    .in("id", ids);
  if (existingError) {
    return { ok: false, error: existingError.message };
  }
  if (!existing || existing.length !== ids.length) {
    return {
      ok: false,
      error: "Some cards weren't found.",
    };
  }
  if (existing.some((c) => c.owner_id !== user.id)) {
    return {
      ok: false,
      error: "Some cards aren't yours to edit.",
    };
  }

  // Going private must also drop the public render (the full card image) — both
  // the row's URL and the stored object — for the same reason the single-card
  // path does. (Going public again re-bakes on the next individual save.)
  const goingPrivate = parsed.data.visibility === "private";
  const { error } = await supabase
    .from("cards")
    .update(
      goingPrivate
        ? { visibility: "private", rendered_image_url: null, rendered_at: null }
        : { visibility: parsed.data.visibility },
    )
    .in("id", ids)
    .eq("owner_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  if (goingPrivate) {
    // Delete the now-private cards' public renders, retrying once and logging
    // loudly on a persistent failure rather than swallowing it — the render
    // path is deterministic and the bucket is public-read, so a leftover PNG
    // stays fetchable for a card the DB now reports as having no render.
    // (Mirrors removeRenderObject in lib/cards/bake-render.ts.)
    const paths = ids.map((id) => cardRenderPath(user.id, id));
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const { error: removeErr } = await supabase.storage
        .from("card-renders")
        .remove(paths);
      if (!removeErr) break;
      if (attempt === 2) {
        console.error(
          `[bulk-visibility] Could not delete ${paths.length} render object(s) after a retry: ${removeErr.message}. Those PNGs may remain publicly fetchable for now-private cards.`,
        );
      }
    }
  }

  // Revalidate the surfaces that show card lists. Per-card slug paths are
  // skipped here — they'll refresh on next visit. Same posture as the
  // single-card updateCardAction.
  revalidatePath("/dashboard");
  revalidatePath("/gallery");
  revalidatePath("/dashboard/sets");
  revalidateDiscoverySurfaces();

  return { ok: true, count: ids.length };
}

export async function deleteCardsAction(
  cardIds: string[],
): Promise<BulkCardsResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to delete cards." };
  }

  const parsed = bulkCardIdsSchema.safeParse(cardIds);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }
  const ids = Array.from(new Set(parsed.data));

  const supabase = await createClient();

  const { data: existing, error: existingError } = await supabase
    .from("cards")
    .select("id, owner_id")
    .in("id", ids);
  if (existingError) {
    return { ok: false, error: existingError.message };
  }
  if (!existing || existing.length !== ids.length) {
    return {
      ok: false,
      error: "Some cards weren't found.",
    };
  }
  if (existing.some((c) => c.owner_id !== user.id)) {
    return {
      ok: false,
      error: "Some cards aren't yours to delete.",
    };
  }

  const { error } = await supabase
    .from("cards")
    .delete()
    .in("id", ids)
    .eq("owner_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  // Remove the deleted cards' baked renders from the public bucket (best-effort).
  await supabase.storage
    .from("card-renders")
    .remove(ids.map((id) => cardRenderPath(user.id, id)));

  revalidatePath("/dashboard");
  revalidatePath("/gallery");
  revalidatePath("/dashboard/sets");
  revalidateDiscoverySurfaces();

  return { ok: true, count: ids.length };
}
