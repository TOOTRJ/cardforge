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
import {
  createClient,
  getCurrentProfile,
  getCurrentUser,
  getCurrentUsername,
} from "@/lib/supabase/server";
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
import { CLEARED_RENDER_POINTERS, removeRenderObjects } from "@/lib/cards/bake-core";
import {
  purgeHiddenCard,
  purgeHiddenCards,
  revalidateCardListSurfaces,
  revalidateCardPaths,
} from "@/lib/cards/revalidate";
import { normalizeManaCost } from "@/lib/cards/mana-order";
import { retiredFrameStyleRewrite, withRetiredFrameTemplate } from "@/lib/cards/card-display";
import {
  applyFrameAnatomyPatch,
  newCardFrameStyle,
  normalizeAnatomy,
  type FrameAnatomyStyle,
} from "@/lib/cards/anatomy";
import { cardPageName, withEmblemShape, withEmblemUpdateShape } from "@/lib/cards/emblem";
import { templateHasBackFace } from "@/lib/cards/dfc";
import {
  dfcBackArtMissing,
  dfcFamilyOf,
  dfcFrontColorError,
  dfcFrontTypeError,
  resolveDfcBackFace,
  stripBackBody,
  type DfcBackFacePayload,
} from "@/lib/cards/dfc-gate";
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
import { allFramePreviewsMessage } from "@/lib/cards/bulk-visibility-copy";
import { CARD_CAPACITY_UNLIMITED } from "@/lib/billing/plans";
import { adoptRemixMedia, type RemixMedia } from "@/lib/cards/remix-media";
import { MEDIA_URL_NOT_ALLOWED_MESSAGE, mediaUrlViolationField } from "@/lib/media/media-url-errors";

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

/** Is the signed-in viewer an admin? From the profile (get_my_billing),
 *  never the request. Only asked when a save requests a frame preview, so
 *  every other save costs nothing extra. */
async function viewerIsAdmin(): Promise<boolean> {
  try {
    return Boolean((await getCurrentProfile())?.is_admin);
  } catch {
    return false;
  }
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
  // A payload that still names a RETIRED template (TODO 4.54) saves on the
  // frame its own text asks for, not just the bare one the schema reads.
  const parsed = createCardSchema.safeParse(withRetiredFrameTemplate(payload));
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

  // An emblem stores no colour, cost, supertype or stats (TODO 6.23).
  let data = withEmblemShape(parsed.data);

  // An admin's frame preview (TODO 2.3): the creator's admin preview mode
  // asks for it, the server decides — only an admin (from the profile,
  // never the payload) gets it. A preview skips the verification gate but
  // nothing else, and lands private + flagged (the insert below; migration
  // 0121's CHECK keeps it private). Anyone else's request is ignored.
  const framePreview =
    data.frame_preview === true && (await viewerIsAdmin());

  // Verification gate — the server twin of the picker's: a (template,
  // colour) pair saves only when the admin has published it in
  // /admin/frame-compare. The client hides unpublished chips, but a stale
  // page or a crafted payload must not get past.
  // The verified set is read once, and only by a gate that needs it.
  let verifiedKeysCache: Set<string> | null = null;
  const verifiedKeysOf = async () =>
    (verifiedKeysCache ??= new Set(await getVerifiedFrameKeys()));
  if (!framePreview) {
    const gateError = frameGateError(
      data.frame_style?.template,
      data.color_identity,
      await verifiedKeysOf(),
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

  // The visibility the row is stored with. No artwork → no gallery: a
  // public save without art lands as a draft (private) so test/unfinished
  // cards never occupy gallery space; the creator predicts this client-side
  // and tells the user. Unlisted stays allowed — link-only sharing of a WIP
  // is deliberate and gallery-free. A frame preview is always private. A
  // double-faced card's BACK face follows the same rule (TODO 5.2, design
  // D13: a public DFC with an empty back window would be a broken card);
  // a legacy back keeps today's rule.
  const storedVisibility: Visibility = framePreview
    ? "private"
    : data.visibility === "public" &&
        (!data.art_url || dfcBackArtMissing(data.frame_style?.template, data.back_face))
      ? "private"
      : data.visibility;

  // A second face may stay unnamed on a private draft only (TODO 3b.5,
  // lib/cards/second-face-name.ts) — judged at the visibility the row will
  // be stored with.
  if (missingSecondFaceName(data.back_face, storedVisibility)) {
    return {
      ok: false,
      fieldErrors: { "back_face.title": SECOND_FACE_NAME_ERROR },
    };
  }
  // The back face's gate (TODO 5.2, lib/cards/dfc-gate.ts): a card on a
  // double-faced FRONT body needs its back face, typed one of the wave-1
  // face types, on the body its type and the card's icon family derive
  // (filled in when the payload names none, refused when it names another),
  // in a colour verified for that body — colourless only with an Artifact
  // word — and a transform back with no cost; a back BODY under any other
  // front is refused, and a body-less back face (the imported DFCs, every
  // inline layout) is untouched. The family is stamped like every other
  // switch (newCardFrameStyle, below), so it is read the same way here.
  const storedFrameStyle = newCardFrameStyle(data.frame_style ?? {}, data.card_type);
  {
    // The FRONT face's type rule (owner Q2: a wave-1 face type, on the body
    // its type derives) — the kind gate above can't see it: a card on a
    // front body is the double-faced kind whatever card_type says.
    const frontTypeError = dfcFrontTypeError(storedFrameStyle.template, data.card_type);
    if (frontTypeError) {
      return { ok: false, fieldErrors: { frame_style: frontTypeError } };
    }
    // The FRONT face's colourless rule (D2): on a DFC front body, `c` only
    // with an Artifact word — the body's `c` is the artifact stand-in.
    const frontColourError = dfcFrontColorError(
      storedFrameStyle.template,
      { cardType: data.card_type, supertype: data.supertype },
      data.color_identity,
    );
    if (frontColourError) {
      return { ok: false, fieldErrors: { color_identity: frontColourError } };
    }
    const gate = resolveDfcBackFace({
      frontTemplate: storedFrameStyle.template,
      back: data.back_face as DfcBackFacePayload | null | undefined,
      family: storedFrameStyle.dfcIcon,
      frontColorIdentity: data.color_identity,
      verifiedKeys:
        !framePreview && templateHasBackFace(storedFrameStyle.template)
          ? await verifiedKeysOf()
          : new Set<string>(),
      skipVerification: framePreview,
    });
    if (!gate.ok) {
      return { ok: false, fieldErrors: { [gate.field]: gate.message } };
    }
    data = { ...data, back_face: gate.back as typeof data.back_face };
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

  // An emblem lives at its page name, "…-emblem" (cardPageName, owner
  // decision 2026-09-29), like Scryfall's; every other card at its title.
  const desiredSlug = data.slug ? slugify(data.slug) : slugify(cardPageName(data.title, data.card_type));
  const { slug } = await ensureUniqueSlugForUser(desiredSlug);

  // If the caller passed a parent_card_id, sanity-check it before insert so
  // we can return a friendlier error than the bare DB FK violation.
  const parent = data.parent_card_id ? await getCardById(data.parent_card_id) : null;
  if (data.parent_card_id && !parent) {
    return {
      ok: false,
      fieldErrors: { parent_card_id: "The card to remix could not be found." },
    };
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

  // Free accounts: creatures and spells always carry the PipGlyph Rose
  // (owner decision 2026-09-17) — enforced here so AI, proxy and remix
  // paths agree with the form. Subscribers keep whatever they chose.
  const watermark =
    usesDefaultWatermark(data.card_type) && !entitlements.removeWatermark
      ? PIPGLYPH_ROSE_WATERMARK
      : data.watermark ?? null;

  // A remix stores its OWN copy of the parent's pictures (migration 0127
  // lets a user store only their own uploads; lib/cards/remix-media.ts).
  // Whoever owns the parent: a remix of your own pre-0127 remix still has
  // the ORIGINAL owner's art, and adoptRemixMedia copies only what sits in
  // another user's folder — a parent whose pictures are yours copies nothing.
  let media: RemixMedia = { art_url: data.art_url, back_face: data.back_face, watermark };
  if (parent) {
    const adopted = await adoptRemixMedia(user.id, parent, media);
    if (!adopted.ok) return { ok: false, formError: adopted.error, code: adopted.code };
    media = adopted;
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
    art_url: media.art_url ?? null,
    art_position: data.art_position ?? {},
    // The anatomy switches (TODO 4.6.0, owner rule 2026-09-29): a new card
    // gets every piece its template draws unless the payload says otherwise
    // (the AI jobs name none; an import names only what its printing says —
    // false for a crownless Legendary or a Legendary showcase printing), and never a
    // switch its template can't draw for the card — a land's two-colour
    // frame only on a land frame (lib/cards/anatomy.ts); a transform front
    // names its icon family (`arrows` unless the payload says, TODO 5.2).
    frame_style: storedFrameStyle,
    // No art or a frame preview → private (storedVisibility, above).
    visibility: storedVisibility,
    // Only a preview names the column, so an ordinary save never depends on
    // migration 0121 having run.
    ...(framePreview ? { frame_preview: true } : {}),
    parent_card_id: data.parent_card_id ?? null,
    // Back face (chunk 10): null when undefined or explicitly cleared,
    // jsonb object when the user has filled in DFC content — with its own
    // body and colour on a double-faced card (TODO 5.2, the gate above).
    back_face: media.back_face ?? null,
    // Scryfall provenance (chunk 13): the source card id when imported,
    // null otherwise. Stays null forever for forged-from-scratch cards.
    source_scryfall_id: data.source_scryfall_id ?? null,
    // Structured loyalty/saga rows (migration 0050); null = derive from
    // rules_text. Design watermark; null = none.
    face_content: data.face_content ?? null,
    // The Rose for free creatures / spells (above), or the remix's copy.
    watermark: media.watermark ?? null,
    // Per-card footer mark (subscribers only; migration 0090). null = fall
    // back to the profile default at download time.
    footer_text: entitlements.removeWatermark ? data.footer_text ?? null : null,
    // The Set icon step's symbol; empty = the default PipGlyph mark.
    set_icon_url: data.set_icon_url ?? null,
    set_icon_code: data.set_icon_code ?? null,
    // The collector fields (migration 0133, TODO 4.9a): what the printing
    // says, from the import or the Set & collector info step; an unnamed
    // language is the column's default (English).
    set_code: data.set_code ?? null,
    collector_number: data.collector_number ?? null,
    ...(data.lang !== undefined ? { lang: data.lang } : {}),
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
  const mediaField = mediaUrlViolationField(error?.message);
  if (mediaField) {
    return { ok: false, fieldErrors: { [mediaField]: MEDIA_URL_NOT_ALLOWED_MESSAGE } };
  }
  if (error || !row) {
    return {
      ok: false,
      formError: error?.message ?? "Could not create card.",
    };
  }

  // Drop the card into its chosen deck as a custom-only mainboard entry.
  // Best-effort — a deck hiccup never rolls back the card save. A frame
  // preview is a test card: it never joins a deck.
  if (data.deck_id && !framePreview) {
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
  // activation milestone). Best effort; never touches the save. An admin's
  // frame preview is tooling, not product activity.
  if (isAdminConfigured() && !framePreview) {
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

  let data = parsed.data;
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
  // An emblem stores no colour, cost, supertype or stats (TODO 6.23), judged
  // on the card as it will be stored.
  data = withEmblemUpdateShape(data, existing.card_type);

  // An admin's frame preview (TODO 2.3) stays one: it is always private.
  // A card becomes one when an admin's preview-mode save moves it onto an
  // unverified frame/colour (the gate below).
  const previewCard = existing.frame_preview === true;
  let becomesPreview = false;
  // The verified set is read once, and only by a gate that needs it: a
  // card on a since-withdrawn frame stays editable without a read.
  let verifiedKeysCache: Set<string> | null = null;
  const verifiedKeysOf = async () =>
    (verifiedKeysCache ??= new Set(await getVerifiedFrameKeys()));
  /** Only an admin (server-checked) previews an unverified frame — the
   *  front's gate and the back's (TODO 5.2) ask the same. */
  const previewAllowed = async () =>
    (previewCard || data.frame_preview === true) && (await viewerIsAdmin());

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
        await verifiedKeysOf(),
      );
      if (gateError) {
        if (!(await previewAllowed())) {
          return { ok: false, fieldErrors: { frame_style: gateError } };
        }
        becomesPreview = !previewCard;
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
  // The card's type as it will be saved: a land keeps the two-colour switch
  // only on a land frame (lib/cards/anatomy.ts twoColorFits).
  const savedCardType = data.card_type !== undefined ? data.card_type : existing.card_type;
  if (data.frame_style !== undefined) {
    // Never a switch the saved template can't draw for the card
    // (lib/cards/anatomy.ts): a template that gains the piece later must not
    // change this card.
    update.frame_style = normalizeAnatomy(
      data.frame_style,
      data.frame_style.template ??
        (existing.frame_style as { template?: string } | null)?.template,
      savedCardType,
    );
  }
  // An edit's switch flip (frame_anatomy — edits never send frame_style):
  // merged over the stored frame_style, which otherwise stays exactly as
  // stored, and a confirmed colour pair for a multicolour card. A crafted
  // two-colour flip for a land on a nonland frame is dropped.
  if (data.frame_anatomy !== undefined) {
    const applied = applyFrameAnatomyPatch(
      {
        frameStyle: (update.frame_style ?? existing.frame_style ?? {}) as Record<string, unknown>,
        colorIdentity: data.color_identity ?? existing.color_identity ?? [],
        cardType: savedCardType,
      },
      data.frame_anatomy,
    );
    if (!applied.ok) {
      return { ok: false, fieldErrors: { color_identity: applied.error } };
    }
    update.frame_style = applied.frameStyle as CardUpdate["frame_style"];
    if (applied.colorIdentity) update.color_identity = applied.colorIdentity;
  }
  // A type change alone (card_type is locked in the editor, so a crafted
  // payload): the stored frame_style is judged by the new type too, so a
  // card turned into a LAND on a nonland frame loses the two-colour switch
  // it had as a creature (twoColorFits). Untouched when nothing is dropped.
  if (data.card_type !== undefined && update.frame_style === undefined && existing.frame_style) {
    const storedStyle = existing.frame_style as FrameAnatomyStyle & { template?: string };
    const normalized = normalizeAnatomy(storedStyle, storedStyle.template, savedCardType);
    if (normalized !== storedStyle) update.frame_style = normalized as CardUpdate["frame_style"];
  }
  // A stored RETIRED template (TODO 4.54) is stored as the frame the row
  // reads as, on any edit — an edit never sends its template, so nothing
  // else would ever take the old value out of the row. Judged by the text
  // the row holds after this edit; no verification gate (the card already
  // draws on that frame, and must stay editable).
  {
    const rewritten = retiredFrameStyleRewrite(
      (update.frame_style ?? existing.frame_style) as { template?: unknown } | null | undefined,
      {
        rules_text: update.rules_text !== undefined ? update.rules_text : existing.rules_text,
        flavor_text: update.flavor_text !== undefined ? update.flavor_text : existing.flavor_text,
      },
    );
    if (rewritten) update.frame_style = rewritten as CardUpdate["frame_style"];
  }
  if (data.visibility !== undefined) update.visibility = data.visibility;
  // The back face's gate (TODO 5.2, lib/cards/dfc-gate.ts), on the card as
  // it will be stored — the patched back over the stored one, under the
  // patched front (else the stored one), with the family as it will be
  // stored. The STORED back body wins (the body is structure, like the
  // front's template): the one change that re-derives it is the family
  // (an edit's frame_anatomy.dfcIcon), refused when the derived body isn't
  // verified in the back's colour; a back whose type would derive another
  // body is refused; so is a changed colour once the back has a body (the
  // lock, owner 2026-10-05: DFC_BACK_COLOR_SET, no preview skip) — a patch
  // naming none keeps the stored one. A front
  // that leaves a DFC body (a crafted frame_style patch — edits never send
  // the template) takes the stored back's body and colour off with it.
  const storedBackFace = (existing.back_face ?? null) as DfcBackFacePayload | null;
  const nextFrontTemplate =
    (update.frame_style as { template?: string } | undefined)?.template ??
    (existing.frame_style as { template?: string } | null)?.template;
  const nextFrameStyle = (update.frame_style ?? existing.frame_style ?? {}) as { dfcIcon?: string };
  const familyChanged =
    dfcFamilyOf(nextFrameStyle.dfcIcon) !==
    dfcFamilyOf((existing.frame_style as { dfcIcon?: string } | null)?.dfcIcon);
  // The front leaving a DFC body with the back left alone: the stored
  // back's body and colour come off (its content stays, a legacy back).
  const backLeavesBody =
    data.back_face === undefined &&
    storedBackFace?.frame_style !== undefined &&
    storedBackFace?.frame_style !== null &&
    !templateHasBackFace(nextFrontTemplate);
  const nextBackFace =
    data.back_face !== undefined
      ? (data.back_face as DfcBackFacePayload | null)
      : backLeavesBody
        ? stripBackBody(storedBackFace!)
        : storedBackFace;
  // The FRONT face's type rule (owner Q2) on the card as it will be stored,
  // when the patch moves the frame or the type (card_type is locked in the
  // editor, so a crafted payload): refused when the frame changes, or when
  // the patch turns a card the body could draw into one it can't — a card
  // that already broke it and keeps its frame stays editable, the kind
  // gate's legacy pin (no stored card can: the bodies are additions).
  if (data.frame_style !== undefined || data.card_type !== undefined) {
    const existingTemplate = (existing.frame_style as { template?: string } | null)?.template;
    const frontTypeError = dfcFrontTypeError(nextFrontTemplate, savedCardType);
    if (
      frontTypeError &&
      (nextFrontTemplate !== existingTemplate || dfcFrontTypeError(existingTemplate, existing.card_type) === null)
    ) {
      return { ok: false, fieldErrors: { frame_style: frontTypeError } };
    }
  }
  // The FRONT face's colourless rule (D2) on the card as it will be stored,
  // when the patch moves the frame, the colour or the type line.
  if (
    data.frame_style !== undefined ||
    data.color_identity !== undefined ||
    data.card_type !== undefined ||
    data.supertype !== undefined
  ) {
    const frontColourError = dfcFrontColorError(
      nextFrontTemplate,
      {
        cardType: data.card_type !== undefined ? data.card_type : existing.card_type,
        supertype: data.supertype !== undefined ? data.supertype : existing.supertype,
      },
      update.color_identity ?? existing.color_identity,
    );
    if (frontColourError) {
      return { ok: false, fieldErrors: { color_identity: frontColourError } };
    }
  }
  if (data.back_face !== undefined || familyChanged || data.frame_style !== undefined) {
    const gateInput = {
      frontTemplate: nextFrontTemplate,
      back: nextBackFace,
      family: nextFrameStyle.dfcIcon,
      frontColorIdentity: update.color_identity ?? existing.color_identity,
      verifiedKeys: templateHasBackFace(nextFrontTemplate) ? await verifiedKeysOf() : new Set<string>(),
      stored: { back: storedBackFace, familyChanged },
    };
    let gate = resolveDfcBackFace(gateInput);
    if (!gate.ok && gate.code === "unverified" && (await previewAllowed())) {
      becomesPreview = !previewCard;
      gate = resolveDfcBackFace({ ...gateInput, skipVerification: true });
    }
    if (!gate.ok) {
      return { ok: false, fieldErrors: { [gate.field]: gate.message } };
    }
    if (gate.layout || data.back_face !== undefined || backLeavesBody) {
      update.back_face = (gate.back ?? null) as CardUpdate["back_face"];
    }
  }
  // No artwork → no gallery (same rule as create). The EFFECTIVE art is the
  // patched value when present, else what the row already stores — so both
  // "publish an artless card" and "remove the art from a public card"
  // demote to draft. A double-faced card's BACK art too (TODO 5.2, D13).
  {
    const effectiveArt =
      data.art_url !== undefined ? data.art_url : existing.art_url;
    const effectiveVisibility =
      update.visibility !== undefined ? update.visibility : existing.visibility;
    const effectiveBack =
      update.back_face !== undefined ? (update.back_face as DfcBackFacePayload | null) : storedBackFace;
    if (
      (!effectiveArt || dfcBackArtMissing(nextFrontTemplate, effectiveBack)) &&
      effectiveVisibility === "public"
    ) {
      update.visibility = "private";
    }
  }
  // A frame preview is private whatever the patch says (migration 0121's
  // CHECK would refuse anything else); only a preview save names the flag.
  if (previewCard || becomesPreview) update.visibility = "private";
  if (becomesPreview) update.frame_preview = true;
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
  // Back face: `null` clears it; an object replaces it whole (through the
  // gate above). Omitting the field leaves whatever the DB already had
  // untouched. The retired v2 link (back_card_id) is accepted only to CLEAR
  // a stored one (lib/validation/card.ts).
  if (data.back_card_id !== undefined) update.back_card_id = null;
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
  // The collector fields (TODO 4.9a): content, so an edit may change them
  // (lib/creator/revise.ts); null clears a code or number, omitted leaves
  // the columns alone. The language has no null — it is NOT NULL.
  if (data.set_code !== undefined) update.set_code = data.set_code ?? null;
  if (data.collector_number !== undefined)
    update.collector_number = data.collector_number ?? null;
  if (data.lang !== undefined) update.lang = data.lang;

  const { data: row, error } = await supabase
    .from("cards")
    .update(update)
    .eq("id", cardId)
    .eq("owner_id", user.id)
    .select("id, slug")
    .single();

  // Migration 0127: a picture that isn't one of the user's own uploads.
  const mediaField = mediaUrlViolationField(error?.message);
  if (mediaField) {
    return { ok: false, fieldErrors: { [mediaField]: MEDIA_URL_NOT_ALLOWED_MESSAGE } };
  }
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
  // shared. Service role, in the verified owner's folder (bake-core; users
  // hold no storage write policy since 0126); a failure — or a missing
  // service-role key — is logged there: the PNG would stay publicly
  // fetchable at its fixed URL.
  await removeRenderObjects(existing.owner_id, [cardId]);

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
// A visibility change to public / unlisted SKIPS an admin's frame previews
// (TODO 2.3 — migration 0121 keeps them private) and changes the rest; the
// action finds them itself, never from the client (owner, 2026-09-28).
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

/** A bulk visibility change also says how many frame previews it skipped. */
export type BulkVisibilityResult =
  | (BulkCardsSuccess & { skippedPreviews: number })
  | BulkCardsFailure;

/** Wall-clock budget for the deferred bakes of one bulk publish — well inside
 *  the function's lifetime; whatever doesn't fit renders live until its next
 *  individual save. */
const BULK_BAKE_BUDGET_MS = 200_000;

type BulkPreflightRow = {
  id: string;
  owner_id: string;
  title: string;
  back_face: unknown;
  rendered_image_url: string | null;
  /** Absent until migration 0121 lands. */
  frame_preview?: boolean;
};

export async function updateCardsVisibilityAction(
  cardIds: string[],
  visibility: Visibility,
): Promise<BulkVisibilityResult> {
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
  // `frame_preview` rides along so a publish can skip an admin's previews.
  // Between a deploy and migration 0121 landing the column doesn't exist
  // yet (so no card can be a preview): read without it rather than break
  // every user's bulk change in that window.
  let existing: BulkPreflightRow[] | null;
  let existingError: { message: string } | null;
  ({ data: existing, error: existingError } = await supabase
    .from("cards")
    .select("id, owner_id, title, back_face, rendered_image_url, frame_preview")
    .in("id", ids));
  if (existingError?.message.includes("frame_preview")) {
    ({ data: existing, error: existingError } = await supabase
      .from("cards")
      .select("id, owner_id, title, back_face, rendered_image_url")
      .in("id", ids));
  }
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
  // An admin's frame preview (TODO 2.3) always stays private — 0121's CHECK
  // refuses it anything else — so a publish / unlist skips the previews and
  // changes the rest. Decided here from the rows, never from the client.
  const goingPrivate = parsed.data.visibility === "private";
  const previews = goingPrivate ? [] : existing.filter((c) => c.frame_preview === true);
  const targets = goingPrivate ? existing : existing.filter((c) => c.frame_preview !== true);
  if (targets.length === 0) {
    return {
      ok: false,
      error: allFramePreviewsMessage(parsed.data.visibility, previews.length),
    };
  }
  const targetIds = targets.map((c) => c.id);

  // Publishing needs every second face named (TODO 3b.5): a draft saved
  // with an unnamed Adventure / split half can't go out from here either.
  // Hiding a card never needs a name — whatever the draft policy says.
  const unnamed = goingPrivate
    ? []
    : targets.filter((c) =>
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
  // the row's pointers (both faces', CLEARED_RENDER_POINTERS) and the stored
  // objects — for the same reason the single-card path does. Going
  // public/unlisted bakes the missing renders below.
  const { error } = await supabase
    .from("cards")
    .update(
      goingPrivate
        ? { visibility: "private", ...CLEARED_RENDER_POINTERS }
        : { visibility: parsed.data.visibility },
    )
    .in("id", targetIds)
    .eq("owner_id", user.id);

  if (error) {
    // A card flagged as a frame preview after the pre-flight read: 0121's
    // CHECK refuses the whole statement, so nothing changed — say why in
    // words instead of Postgres's (a retry reads the flag and skips it).
    if (error.code === "23514" && error.message.includes("cards_frame_preview_private")) {
      return {
        ok: false,
        error:
          "Frame previews stay private, and nothing was changed — try again and they'll be skipped.",
      };
    }
    return { ok: false, error: error.message };
  }

  if (goingPrivate) {
    // Delete the now-private cards' public renders (PNG + thumb, in the
    // caller's folder, service role). removeRenderObjects retries once and
    // logs loudly on a persistent failure rather than swallowing it — the
    // render path is deterministic and the bucket is public-read, so a
    // leftover PNG stays fetchable for a card the DB now reports as having no
    // render.
    await removeRenderObjects(user.id, targetIds);
  }

  // Revalidate the surfaces that show card lists. Per-card slug paths are
  // skipped here — they'll refresh on next visit. Same posture as the
  // single-card updateCardAction. Cards going private also lose their CDN
  // share image right away.
  if (goingPrivate) await purgeHiddenCards(targetIds);
  else revalidateCardListSurfaces();

  if (!goingPrivate) {
    // A draft published from the library has no stored render (going private
    // cleared it), and nothing else would ever bake it: tiles fell back to
    // the live preview forever and every uncached /og or /png hit re-ran
    // Satori. Bake the missing ones after the response, one at a time, inside
    // a time budget — the single-card save path does the same in after().
    const toBake = targets
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

  return { ok: true, count: targetIds.length, skippedPreviews: previews.length };
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
  await removeRenderObjects(user.id, ids);

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
