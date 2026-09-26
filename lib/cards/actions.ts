"use server";

import { revalidatePath } from "next/cache";
import { frameGateError } from "@/lib/cards/frame-availability";
import {
  cardFieldsFace,
  frameKindGateError,
  frameKindUpdateGateError,
} from "@/lib/cards/frame-kind-gate";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import {
  missingSecondFaceName,
  SECOND_FACE_NAME_ERROR,
} from "@/lib/cards/second-face-name";
import { recordActivity } from "@/lib/analytics/funnel-server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getCurrentUser, getCurrentUsername } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  createCardSchema,
  isReservedCardSlug,
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
import {
  purgeHiddenCard,
  purgeHiddenCards,
  revalidateCardListSurfaces,
  revalidateCardPaths,
} from "@/lib/cards/revalidate";
import { renderThumbPath } from "@/lib/cards/render-thumb";
import { normalizeManaCost } from "@/lib/cards/mana-order";
import { PIPGLYPH_ROSE_WATERMARK, usesDefaultWatermark } from "@/lib/cards/watermark";
import {
  VISIBILITY_VALUES,
  frameStyleRequiresPremium,
  type CardInsert,
  type CardUpdate,
  type Visibility,
} from "@/types/card";
import { getEntitlements } from "@/lib/billing/entitlements";
import type { ZodIssue } from "zod";
import { isUuid } from "@/lib/ids";
import { lookupUsername } from "@/lib/profile/username";
import { buildCardPath } from "@/lib/cards/utils";
import { isCapacityViolation } from "@/lib/billing/capacity-copy";
import { CARD_CAPACITY_UNLIMITED } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Result shape — every action returns either a typed success payload or a
// shared error envelope. UI layers can pattern-match without throwing.
// ---------------------------------------------------------------------------

type CardActionFieldErrors = Partial<Record<string, string>>;

type CardActionFailure = {
  ok: false;
  formError?: string;
  fieldErrors?: CardActionFieldErrors;
  /** "UPGRADE_REQUIRED" when a paid plan is needed — the UI opens the upgrade
   *  modal instead of showing a generic error. */
  code?: string;
  /** Which limit was hit, so the modal (and a batch job's step) can say the
   *  right thing: the saved-card cap or a premium frame/finish. */
  reason?: "capacity" | "premium_frame";
};

type CreateCardSuccess = {
  ok: true;
  cardId: string;
  slug: string;
};

type UpdateCardSuccess = {
  ok: true;
  cardId: string;
  slug: string;
};

type DeleteCardSuccess = {
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
  // Route words (/card/<slug>/edit …) count as taken so a card can never
  // shadow its own editor URL — it gets the same "-2" suffix a duplicate
  // title would.
  const taken =
    isReservedCardSlug(desired) ||
    (await isSlugTakenForCurrentUser(desired, excludeCardId));
  if (!taken) return { slug: desired, conflict: false };

  // Try numeric suffixes first; cap attempts so a hostile workspace can't
  // wedge the action. Trim the BASE to make room for the suffix — slicing
  // the joined string cut the suffix off an 80-char slug, so every attempt
  // produced the same taken slug and the insert hit the unique index.
  for (let attempt = 2; attempt <= 50; attempt += 1) {
    const suffix = `-${attempt}`;
    // The cut must not leave a trailing hyphen ("-" + "-2" fails the CHECK).
    const candidate = `${desired.slice(0, 80 - suffix.length).replace(/-+$/, "")}${suffix}`;
    const stillTaken = await isSlugTakenForCurrentUser(candidate, excludeCardId);
    if (!stillTaken) return { slug: candidate, conflict: true };
  }

  return { slug: desired, conflict: true };
}

/** Every public object a bake writes for a card — the HD PNG and its WebP
 *  thumbnail (lib/cards/render-thumb.ts). Deleting or privatising a card must
 *  drop BOTH; the thumb used to be left behind, publicly fetchable. */
function renderObjectPaths(ownerId: string, cardId: string): string[] {
  const png = cardRenderPath(ownerId, cardId);
  return [png, renderThumbPath(png)];
}

/** A remix changes what its PARENT's page shows (remix count, "Top
 *  remixes"), so bust the parent's canonical path too. Best-effort — the
 *  parent may belong to someone else, so the username is looked up. */
async function revalidateParentCardPaths(parentCardId: string): Promise<void> {
  try {
    const supabase = await createClient();
    // owner_id references auth.users, not profiles, so PostgREST can't join
    // the two — two small reads instead.
    const { data: parent } = await supabase
      .from("cards")
      .select("slug, owner_id")
      .eq("id", parentCardId)
      .maybeSingle();
    if (!parent) return;
    const ownerUsername = await lookupUsername(supabase, parent.owner_id);
    revalidatePath(`/card/${parent.slug}`);
    if (ownerUsername) {
      revalidatePath(`/card/${ownerUsername}/${parent.slug}`);
    }
  } catch {
    // best-effort
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

  // Verification gate — the server twin of the picker's: a (template,
  // colour) pair saves only when the admin has published it in
  // /admin/frame-compare. The client hides unpublished chips, but a stale
  // page or a crafted payload must not get past.
  {
    const gateError = frameGateError(
      data.frame_style?.template,
      data.color_identity,
      new Set(await getVerifiedFrameKeys()),
    );
    if (gateError) {
      return { ok: false, fieldErrors: { frame_style: gateError } };
    }
  }

  // Kind gate: a published frame can still be the wrong one for this card
  // (a planeswalker on a frame with no loyalty slot, a nonbasic land on the
  // full-art basic frame). The picker never offers those; refuse them here.
  {
    const kindError = frameKindGateError(
      data.frame_style?.template,
      cardFieldsFace(data),
    );
    if (kindError) {
      return { ok: false, fieldErrors: { frame_style: kindError } };
    }
  }

  // A second face may stay unnamed on a private draft only (TODO 3b.5,
  // lib/cards/second-face-name.ts) — judged at the visibility the row will
  // be stored with (an artless "public" card lands private, see the insert).
  if (
    missingSecondFaceName(
      data.back_face,
      data.visibility === "public" && !data.art_url ? "private" : data.visibility,
    )
  ) {
    return {
      ok: false,
      fieldErrors: { "back_face.title": SECOND_FACE_NAME_ERROR },
    };
  }

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
      reason: "premium_frame",
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
        reason: "capacity",
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


  const insert: CardInsert = {
    owner_id: user.id,
    title: data.title,
    slug,
    game_system_id: data.game_system_id,
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
    // Free accounts: creatures and spells always carry the PipGlyph Rose
    // (owner decision 2026-09-17) — enforced here so AI, proxy and remix
    // paths agree with the form. Subscribers keep whatever they chose.
    watermark:
      usesDefaultWatermark(data.card_type) && !entitlements.removeWatermark
        ? PIPGLYPH_ROSE_WATERMARK
        : data.watermark ?? null,
    // Per-card footer mark (subscribers only; migration 0090). null = fall
    // back to the profile default at download time.
    footer_text: entitlements.removeWatermark ? data.footer_text ?? null : null,
    // The Set icon step's symbol; empty = the default PipGlyph mark.
    set_icon_url: data.set_icon_url ?? null,
    set_icon_code: data.set_icon_code ?? null,
  };

  const { data: row, error } = await supabase
    .from("cards")
    .insert(insert)
    .select("id, slug")
    .single();

  // The database enforces the cap too (migration 0104) — the pre-check above
  // can lose a race between two saves, the trigger can't.
  if (error && isCapacityViolation(error.message)) {
    return {
      ok: false,
      code: "UPGRADE_REQUIRED",
      reason: "capacity",
      formError:
        entitlements.cardCapacity === CARD_CAPACITY_UNLIMITED
          ? "You've reached your plan's card limit. Upgrade for more space."
          : `You've reached your ${entitlements.cardCapacity}-card limit. Upgrade for more space.`,
    };
  }
  if (error || !row) {
    return {
      ok: false,
      formError: error?.message ?? "Could not create card.",
    };
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

  const ownerUsername = await getCurrentUsername();
  revalidateCardPaths(row.slug, ownerUsername, { visibility: insert.visibility });
  if (data.parent_card_id) {
    await revalidateParentCardPaths(data.parent_card_id);
  }
  // Funnel: a saved card (and, once per user, first_card_saved — the
  // activation milestone). Best effort; never touches the save.
  if (isAdminConfigured()) {
    await recordActivity(createAdminClient(), {
      userId: user.id,
      kind: "card_saved",
      props: { visibility: insert.visibility, kind: data.parent_card_id ? "remix" : "new" },
    });
  }

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
      revalidateCardPaths(row.slug, ownerUsername, { visibility: insert.visibility });
    } catch (error) {
      console.error(`[create-card] deferred bake failed for ${row.id}:`, error);
    }
  });

  if (options.redirectAfterCreate) {
    redirect(
      buildCardPath({ slug: row.slug, owner: { username: ownerUsername } }),
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

  // Verification gate, only when the patch CHANGES the frame or the colour:
  // a card saved on a since-withdrawn frame (the picker's "legacy pin")
  // must stay editable as long as its frame/colour are left alone.
  {
    const existingTemplate =
      (existing.frame_style as { template?: string } | null)?.template;
    const nextTemplate = data.frame_style?.template;
    const templateChanged =
      nextTemplate !== undefined && nextTemplate !== existingTemplate;
    const colorChanged =
      data.color_identity !== undefined &&
      JSON.stringify([...data.color_identity].sort()) !==
        JSON.stringify([...(existing.color_identity ?? [])].sort());
    if (templateChanged || colorChanged) {
      const gateError = frameGateError(
        nextTemplate ?? existingTemplate,
        data.color_identity ?? existing.color_identity,
        new Set(await getVerifiedFrameKeys()),
      );
      if (gateError) {
        return { ok: false, fieldErrors: { frame_style: gateError } };
      }
    }

    // Kind gate on the card as it will be saved (the patch over the stored
    // row); a card that already broke it and keeps its frame stays editable.
    const kindError = frameKindUpdateGateError({
      existingTemplate,
      nextTemplate,
      existing: cardFieldsFace(existing),
      next: cardFieldsFace({
        card_type: data.card_type !== undefined ? data.card_type : existing.card_type,
        supertype: data.supertype !== undefined ? data.supertype : existing.supertype,
        subtypes: data.subtypes !== undefined ? data.subtypes : existing.subtypes,
        title: data.title !== undefined ? data.title : existing.title,
        rules_text: data.rules_text !== undefined ? data.rules_text : existing.rules_text,
      }),
    });
    if (kindError) {
      return { ok: false, fieldErrors: { frame_style: kindError } };
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
  // An unnamed second face is a draft's privilege (TODO 3b.5): judged on the
  // card as it will be stored — the patched back face over the stored one,
  // at the visibility the rule above settled on — so both "publish a draft
  // with an unnamed half" and "clear the name of a public card" refuse.
  if (
    missingSecondFaceName(
      data.back_face !== undefined
        ? data.back_face
        : (existing.back_face as { title?: string | null } | null),
      update.visibility ?? existing.visibility,
    )
  ) {
    return {
      ok: false,
      fieldErrors: { "back_face.title": SECOND_FACE_NAME_ERROR },
    };
  }
  if (data.parent_card_id !== undefined) {
    // Same pre-flight createCardAction runs: the parent must exist and a
    // card can't be its own remix (a dangling id used to be stored as-is).
    if (data.parent_card_id) {
      if (data.parent_card_id === cardId) {
        return { ok: false, fieldErrors: { parent_card_id: "A card can't be a remix of itself." } };
      }
      const parent = await getCardById(data.parent_card_id);
      if (!parent) {
        return { ok: false, fieldErrors: { parent_card_id: "The card to remix could not be found." } };
      }
    }
    update.parent_card_id = data.parent_card_id;
  }
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
  // Footer mark: subscribers only — a free account's edit never touches it.
  if (data.footer_text !== undefined) {
    const entitlements = await getEntitlements();
    if (entitlements.removeWatermark) update.footer_text = data.footer_text ?? null;
  }
  // The Set icon step's symbol: null clears back to the default PipGlyph
  // mark; omitted leaves the columns alone.
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

  const ownerUsername = await getCurrentUsername();
  revalidateCardPaths(row.slug, ownerUsername, { visibility: update.visibility ?? existing.visibility });
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
    // Also purges the CDN copy — revalidatePath alone never reached it.
    await purgeHiddenCard({ id: row.id, slug: row.slug }, ownerUsername);
  }

  // Re-bake the PNG AFTER the response is sent (next/server `after`) so Save
  // stays fast, then revalidate the card surfaces again so the updated render
  // (or, on failure, the live-preview fallback) appears. A bake failure clears
  // the now-stale render columns (bakeAndPersistCardRender) instead of leaving
  // the old mismatched PNG in place.
  after(async () => {
    try {
      await bakeAndPersistCardRender(row.id, user.id);
      revalidateCardPaths(row.slug, ownerUsername, { visibility: update.visibility ?? existing.visibility });
      if (visibilityChanged) {
        await purgeHiddenCard({ id: row.id, slug: row.slug }, ownerUsername);
      }
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

  // Remove the card's baked render + thumbnail from the public bucket
  // (best-effort; the render path is per-card, so this never touches another
  // card's render). Art is left alone — remixes copy art_url, so it can be
  // shared.
  await supabase.storage
    .from("card-renders")
    .remove(renderObjectPaths(existing.owner_id, cardId));

  const ownerUsername = await getCurrentUsername();
  await purgeHiddenCard({ id: cardId, slug: existing.slug }, ownerUsername);

  return { ok: true, cardId };
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
//   4. Revalidate the dashboard / gallery surfaces.
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

type BulkCardsSuccess = {
  ok: true;
  count: number;
};

type BulkCardsFailure = {
  ok: false;
  error: string;
};

export type BulkCardsResult = BulkCardsSuccess | BulkCardsFailure;

/** Wall-clock budget for the deferred bakes of one bulk publish — well inside
 *  the function's lifetime; whatever doesn't fit renders live until its next
 *  individual save. */
const BULK_BAKE_BUDGET_MS = 200_000;

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
    .select("id, owner_id, title, back_face, rendered_image_url")
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
  // Publishing needs every second face named (TODO 3b.5): a draft saved
  // with an unnamed Adventure / split half can't go out from here either.
  // Hiding a card never needs a name — whatever the draft policy says.
  const unnamed =
    parsed.data.visibility === "private"
      ? []
      : existing.filter((c) =>
          missingSecondFaceName(
            c.back_face as { title?: string | null } | null,
            parsed.data.visibility,
          ),
        );
  if (unnamed.length > 0) {
    const names = unnamed
      .slice(0, 3)
      .map((c) => `“${c.title}”`)
      .join(", ");
    return {
      ok: false,
      error: `Name the second face of ${names}${unnamed.length > 3 ? ` and ${unnamed.length - 3} more` : ""} in the editor before publishing — nothing was changed.`,
    };
  }

  // Going private must also drop the public render (the full card image) — both
  // the row's URL and the stored object — for the same reason the single-card
  // path does. Going public/unlisted bakes the missing renders below.
  const goingPrivate = parsed.data.visibility === "private";
  const { error } = await supabase
    .from("cards")
    .update(
      goingPrivate
        ? { visibility: "private", rendered_image_url: null, rendered_thumb_url: null, rendered_at: null }
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
    const paths = ids.flatMap((id) => renderObjectPaths(user.id, id));
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
  // single-card updateCardAction. Cards going private also lose their CDN
  // share image right away.
  if (goingPrivate) await purgeHiddenCards(ids);
  else revalidateCardListSurfaces();

  if (!goingPrivate) {
    // A draft published from the library has no stored render (going private
    // cleared it), and nothing else would ever bake it: tiles fell back to
    // the live preview forever and every uncached /og or /png hit re-ran
    // Satori. Bake the missing ones after the response, one at a time, inside
    // a time budget — the single-card save path does the same in after().
    const toBake = existing
      .filter((c) => !c.rendered_image_url)
      .map((c) => c.id);
    if (toBake.length > 0) {
      after(async () => {
        const deadline = Date.now() + BULK_BAKE_BUDGET_MS;
        let baked = 0;
        for (const cardId of toBake) {
          if (Date.now() > deadline) {
            console.warn(
              `[bulk-visibility] bake budget spent after ${baked}/${toBake.length} cards; the rest render live until their next save.`,
            );
            break;
          }
          try {
            await bakeAndPersistCardRender(cardId, user.id);
            baked += 1;
          } catch (error) {
            console.error(`[bulk-visibility] deferred bake failed for ${cardId}:`, error);
          }
        }
        if (baked > 0) revalidateCardListSurfaces();
      });
    }
  }

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

  // Remove the deleted cards' baked renders + thumbnails from the public
  // bucket (best-effort).
  await supabase.storage
    .from("card-renders")
    .remove(ids.flatMap((id) => renderObjectPaths(user.id, id)));

  await purgeHiddenCards(ids);

  return { ok: true, count: ids.length };
}

/**
 * A share happened (any target in the share dialog). Best-effort tally that
 * feeds the gallery's discover weighting (migration 0086) — never blocks the
 * share UI and never surfaces an error.
 */
export async function recordCardShareAction(cardId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (!isUuid(cardId)) return;
  try {
    const supabase = await createClient();
    await supabase.rpc("increment_card_share", { p_card_id: cardId });
  } catch {
    // best-effort
  }
}
