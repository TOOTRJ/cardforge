"use server";

import { z } from "zod";
import { createCardAction } from "@/lib/cards/actions";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { getFantasyGameSystem } from "@/lib/cards/queries";
import { getDeckById, listDeckCards } from "@/lib/decks/queries";
import { MAX_DECKLIST_CHARS } from "@/lib/decks/parse-decklist";
import { isUuid } from "@/lib/ids";
import { isAllowedMediaUrl } from "@/lib/media/media-urls";
import { checkScryfallRateLimit, logScryfallCall } from "@/lib/scryfall/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { recordToolEvent } from "@/lib/tools/events";
import { checkToolAccess } from "@/lib/tools/queries";
import type { KitItem } from "@/lib/tools/token-kit/collect";
import {
  DEFAULT_KIT_SETTINGS,
  kitCardFields,
  kitFaceSchema,
  kitItemStateSchema,
  kitPreviewData,
  kitSettingsSchema,
  type KitItemState,
  type KitSettings,
} from "@/lib/tools/token-kit/model";
import { buildKitFromLines, kitLinesOfDeck, kitLinesOfList, listSourceKey, type KitSourceLine } from "@/lib/tools/token-kit/server";

// ---------------------------------------------------------------------------
// The Token Kit's server actions (beta tool `token-kit`). Every one checks
// the viewer's access first (checkToolAccess: admins and testers while the
// tool is in beta) and records what it did (recordToolEvent — counts and
// kinds only, never a card's text). The token list is Scryfall's data and
// FREE on every plan (Scryfall's terms forbid paywalling it): the tool's
// gate is the beta, never a tier. A kit's tokens are never cards — "Save to
// My Cards" makes one a normal card through createCardAction, which counts
// it against the card limit like every other save.
// ---------------------------------------------------------------------------

const SLUG = "token-kit";

const NO_ACCESS = "The Token Kit isn't open to your account right now.";

export type KitSource =
  | { kind: "deck"; deckId: string }
  | { kind: "list"; text: string };

export type SavedKit = { settings: KitSettings; items: Record<string, KitItemState> };

export type BuiltKitResult =
  | {
      ok: true;
      kit: {
        sourceKey: string;
        deckId: string | null;
        title: string;
        /** The pasted list (a list source), saved with the kit. */
        sourceText: string | null;
        items: KitItem[];
        notFound: string[];
        missing: number;
        doublers: string[];
        realCardsFailed: boolean;
        saved: SavedKit | null;
      };
    }
  | { ok: false; error: string };

/** A stored kit's settings and item states, read defensively: what no
 *  longer parses is left out (the defaults stand in). */
function savedKitOf(row: { settings: unknown; items: unknown } | null): SavedKit | null {
  if (!row) return null;
  const settings = kitSettingsSchema.safeParse({ ...DEFAULT_KIT_SETTINGS, ...(row.settings as object) });
  const items: Record<string, KitItemState> = {};
  if (row.items && typeof row.items === "object" && !Array.isArray(row.items)) {
    for (const [key, value] of Object.entries(row.items as Record<string, unknown>)) {
      const parsed = kitItemStateSchema.safeParse(value);
      if (parsed.success) items[key] = parsed.data;
    }
  }
  return { settings: settings.success ? settings.data : DEFAULT_KIT_SETTINGS, items };
}

/** Build (or reopen) a kit from one of the viewer's decks or a pasted list. */
export async function buildTokenKitAction(source: KitSource): Promise<BuiltKitResult> {
  const access = await checkToolAccess(SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };

  let lines: KitSourceLine[];
  let sourceKey: string;
  let title: string;
  let deckId: string | null = null;
  let sourceText: string | null = null;
  if (source?.kind === "deck") {
    if (!isUuid(source.deckId)) return { ok: false, error: "Pick one of your decks." };
    const deck = await getDeckById(source.deckId);
    if (!deck || deck.owner_id !== access.userId) return { ok: false, error: "That deck isn't one of yours." };
    lines = kitLinesOfDeck(await listDeckCards(deck.id));
    sourceKey = `deck:${deck.id}`;
    deckId = deck.id;
    title = deck.title;
  } else if (source?.kind === "list") {
    const text = typeof source.text === "string" ? source.text : "";
    if (!text.trim()) return { ok: false, error: "Paste a decklist first." };
    if (text.length > MAX_DECKLIST_CHARS) return { ok: false, error: "That list is too long to read." };
    lines = kitLinesOfList(text).lines;
    if (lines.length === 0) return { ok: false, error: "No cards were found in that list — one card a line, like “1 Goldspan Dragon”." };
    sourceKey = listSourceKey(lines);
    sourceText = text;
    title = "Pasted list";
  } else {
    return { ok: false, error: "Pick a deck or paste a list." };
  }
  if (lines.length === 0) return { ok: false, error: "That deck has no cards yet." };

  const limit = await checkScryfallRateLimit(access.userId, "deck_tokens");
  if (!limit.ok) return { ok: false, error: limit.message };

  const built = await buildKitFromLines(lines);
  if (built.calls > 0) await logScryfallCall(access.userId, "deck_tokens");

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("token_kits")
    .select("settings, items, title")
    .eq("owner_id", access.userId)
    .eq("source_key", sourceKey)
    .maybeSingle();

  const counts = { token: 0, emblem: 0, helper: 0 };
  for (const item of built.items) counts[item.face.kind] += 1;
  await recordToolEvent({
    slug: SLUG,
    userId: access.userId,
    event: "kit_built",
    access: access.via,
    props: {
      source: source.kind,
      lines: lines.length,
      tokens: counts.token,
      emblems: counts.emblem,
      helpers: counts.helper,
      not_found: built.notFound.length,
      cached: built.calls === 0,
      reopened: Boolean(row),
      scryfall_failed: built.realCardsFailed,
    },
  });

  return {
    ok: true,
    kit: {
      sourceKey,
      deckId,
      title: (source.kind === "list" && row?.title) || title,
      sourceText,
      items: built.items,
      notFound: built.notFound,
      missing: built.missing,
      doublers: built.doublers,
      realCardsFailed: built.realCardsFailed,
      saved: savedKitOf(row ?? null),
    },
  };
}

const saveKitSchema = z.object({
  sourceKey: z.string().max(80),
  deckId: z.string().nullable(),
  title: z.string().trim().min(1).max(120),
  sourceText: z.string().max(MAX_DECKLIST_CHARS).nullable(),
  settings: kitSettingsSchema,
  items: z.record(z.string().min(1).max(600), kitItemStateSchema),
});

export type SaveKitResult = { ok: true } | { ok: false; error: string };

/**
 * Keep a kit's choices (its look, each token's copies and picture) so a
 * reload reopens it. The source key is the server's: a deck's own id, or the
 * pasted list's hash (listSourceKey) — never trusted from the client. A
 * picture that isn't the viewer's own card-art object is dropped.
 */
export async function saveTokenKitAction(input: unknown): Promise<SaveKitResult> {
  const access = await checkToolAccess(SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = saveKitSchema.safeParse(input);
  if (!parsed.success) {
    console.warn("[token-kit] save refused:", parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`));
    return { ok: false, error: "That kit couldn't be saved." };
  }
  const kit = parsed.data;
  if (Object.keys(kit.items).length > 300) return { ok: false, error: "That kit has too many tokens to save." };

  let sourceKey: string;
  let deckId: string | null = null;
  let sourceText: string | null = null;
  if (kit.deckId) {
    if (!isUuid(kit.deckId)) return { ok: false, error: "That kit couldn't be saved." };
    sourceKey = `deck:${kit.deckId}`;
    deckId = kit.deckId;
  } else if (kit.sourceText) {
    sourceKey = listSourceKey(kitLinesOfList(kit.sourceText).lines);
    sourceText = kit.sourceText;
  } else {
    return { ok: false, error: "That kit couldn't be saved." };
  }
  if (sourceKey !== kit.sourceKey) return { ok: false, error: "That kit changed — build it again to save." };

  const items: Record<string, KitItemState> = {};
  for (const [key, state] of Object.entries(kit.items)) {
    items[key] = {
      ...state,
      artUrl: state.artUrl && isAllowedMediaUrl("card-art", state.artUrl, access.userId) ? state.artUrl : null,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("token_kits").upsert(
    {
      owner_id: access.userId,
      source_key: sourceKey,
      deck_id: deckId,
      title: kit.title,
      source_text: sourceText,
      settings: kit.settings,
      items,
    },
    { onConflict: "owner_id,source_key" },
  );
  if (error) {
    console.error("[token-kit] save failed:", error.message);
    return { ok: false, error: "The kit didn't save. Try again in a moment." };
  }
  return { ok: true };
}

/** Forget a saved kit (its choices and pictures' links; the pictures are
 *  the orphan sweep's once nothing names them). */
export async function deleteTokenKitAction(id: string): Promise<SaveKitResult> {
  const access = await checkToolAccess(SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  if (!isUuid(id)) return { ok: false, error: "That kit is already gone." };
  const supabase = await createClient();
  const { error } = await supabase.from("token_kits").delete().eq("id", id).eq("owner_id", access.userId);
  if (error) return { ok: false, error: "That kit couldn't be removed. Try again in a moment." };
  return { ok: true };
}

const saveTokenSchema = z.object({
  face: kitFaceSchema,
  settings: kitSettingsSchema,
  state: kitItemStateSchema,
});

export type SaveKitTokenResult =
  | { ok: true; cardId: string; slug: string; forcedPrivate: boolean }
  | { ok: false; error: string; capacity?: boolean };

/**
 * "Save to My Cards": one kit token as a normal PRIVATE card, drawn exactly
 * as the kit draws it (its frame, the kit's set symbol, watermark and
 * alignment, its picture) — through createCardAction, so the verification
 * gate, the language rule and the card limit hold as for every save.
 */
export async function saveKitTokenToCardsAction(input: unknown): Promise<SaveKitTokenResult> {
  const access = await checkToolAccess(SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = saveTokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That token couldn't be saved." };
  const { face, settings, state } = parsed.data;

  const verified = new Set(await getVerifiedFrameKeys());
  const artUrl = state.artUrl && isAllowedMediaUrl("card-art", state.artUrl, access.userId) ? state.artUrl : null;
  const preview = kitPreviewData(face, settings, { ...state, artUrl }, verified);
  if (!preview) return { ok: false, error: "This one can't be drawn yet, so it can't be saved." };
  const system = await getFantasyGameSystem();
  if (!system) return { ok: false, error: "Saving isn't available right now." };

  const fields = kitCardFields(face);
  const data = preview.data;
  const result = await createCardAction({
    game_system_id: system.id,
    title: fields.title,
    cost: "",
    card_type: fields.cardType,
    supertype: fields.supertype ?? "",
    subtypes: fields.subtypes,
    tags: [fields.cardType === "token" ? "token" : "emblem"],
    rarity: "common",
    color_identity: fields.colorIdentity,
    rules_text: fields.rulesText ?? "",
    flavor_text: fields.flavorText ?? "",
    power: fields.power ?? "",
    toughness: fields.toughness ?? "",
    loyalty: "",
    defense: "",
    artist_credit: state.artistCredit ?? "",
    ...(artUrl ? { art_url: artUrl } : {}),
    art_position: data.artPosition ?? {},
    frame_style: data.frameStyle,
    visibility: "private",
    set_icon_code: settings.setIconCode,
    watermark: data.watermark ?? null,
  });
  if (!result.ok) {
    if (result.reason === "capacity") return { ok: false, error: result.formError ?? "Your card limit is full.", capacity: true };
    const field = Object.values(result.fieldErrors ?? {})[0];
    return { ok: false, error: result.formError ?? field ?? "That token couldn't be saved." };
  }
  await recordToolEvent({
    slug: SLUG,
    userId: access.userId,
    event: "token_saved",
    access: access.via,
    props: { kind: face.kind, design: preview.frame.design, with_art: Boolean(artUrl) },
  });
  return { ok: true, cardId: result.cardId, slug: result.slug, forcedPrivate: Boolean(result.forcedPrivate) };
}
