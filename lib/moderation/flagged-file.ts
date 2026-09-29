import "server-only";

import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ids";
import { ownStorageObject } from "@/lib/media/storage-hosts";
import { purgeImageSources } from "@/lib/cards/cache-purge";
import { hideCard } from "@/lib/moderation/hide-card";
import { isDefaultProfileMedia, randomDefaultMedia } from "@/lib/profile/default-media";
import { lookupUsername, revalidateProfileMedia } from "@/lib/profile/username";
import { revalidateDeckPaths } from "@/lib/decks/revalidate";
import { isCustomPipSymbol } from "@/lib/pips/override";
import { deleteCustomPipRow, finishPipChange, removeCustomPipObject } from "@/lib/pips/remove-pip";

// ---------------------------------------------------------------------------
// What happens to the rows that USE a file the moderation rescan flagged
// (scripts/sweep-storage-orphans.mjs --rescan-review --apply, owner decision
// 2026-09-29): the script finds every row that names the file (one full read
// of the database), then asks POST /api/admin/storage-sweep to act on the
// ones the app draws a picture from — through the app's own code paths —
// and only then removes the file:
//
//   * a card (art, second-face art in back_face, set icon, the watermark's
//     icon, its bake/thumb) → HIDDEN, the moderation hide
//     (lib/moderation/hide-card.ts: private, render removed, reports
//     actioned, pages + CDN purged);
//   * an avatar / banner → a random built-in of that kind, the pick the
//     settings "Remove" button makes (randomDefaultMedia, checked by
//     isDefaultProfileMedia), and the profile surfaces revalidated;
//   * a deck cover → cleared, the deck's pages revalidated;
//   * a custom pip → removed like the owner's "Remove"
//     (lib/pips/remove-pip.ts: row, object, caches, re-bake of the cards
//     that draw it).
//
// Every action re-reads its row first and acts only while that row STILL
// draws this exact file — our storage host, the file's bucket, its exact
// (case-sensitive) key (the script's search is bucket-agnostic, case-blind
// and substring-based, which is right for listing and wrong for acting). Each write is a compare-and-set on the value
// it read. A row that no longer names the file is "skipped" (a re-run after a
// partial run skips what is done). Finally every stored URL that named the
// file, and its bare public URL, is purged from Vercel's Image Optimization
// cache (up to 31 days, kept across deployments). Nothing here deletes the
// file itself: the script does, after every action succeeded.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

/** Buckets the rescan's review list comes from (scripts/lib/storage-orphans
 *  .mjs SWEEP_BUCKETS). */
export const FLAGGED_FILE_BUCKETS = ["card-art", "profile-media", "set-covers", "custom-pips", "card-renders"] as const;

/** The card columns a card draws a picture from — the cards row of
 *  scripts/lib/storage-orphans.mjs URL_SOURCES. A file named only in a text
 *  column (a title, rules text) is not drawn, so it hides nothing. */
export const CARD_PICTURE_COLUMNS = [
  "art_url",
  "back_face",
  "set_icon_url",
  "watermark",
  "rendered_image_url",
  "rendered_thumb_url",
] as const;

const uuid = z.string().refine(isUuid, "not a uuid");

export const flaggedFileActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hide-card"), cardId: uuid }),
  z.object({ kind: z.literal("profile-default"), userId: uuid, column: z.enum(["avatar_url", "banner_url"]) }),
  z.object({ kind: z.literal("clear-deck-cover"), deckId: uuid }),
  z.object({ kind: z.literal("remove-custom-pip"), pipId: uuid }),
]);
export type FlaggedFileAction = z.infer<typeof flaggedFileActionSchema>;

export const flaggedFileSchema = z.object({
  bucket: z.enum(FLAGGED_FILE_BUCKETS),
  path: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/i)
    .refine((p) => !p.includes(".."), "not a user-folder key"),
});
export type FlaggedFile = z.infer<typeof flaggedFileSchema>;

export type FlaggedFileActionResult = {
  action: FlaggedFileAction;
  status: "done" | "skipped" | "failed";
  detail: string;
};

/** Every string inside `value` (JSON at any depth, object keys included). */
function* stringsIn(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const item of value) yield* stringsIn(item);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      yield key;
      yield* stringsIn(item);
    }
  }
}

/** The key as storage reads it (it decodes the URL path); the raw key when
 *  it isn't valid percent-encoding. */
function decodedKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/** The strings in `value` that are a public URL of `file` on one of OUR
 *  storage hosts, in its bucket (any query string), with EXACTLY its key.
 *  Storage keys are case-sensitive: `photo.JPG` next to `Photo.jpg` is
 *  another object, and a row that draws it is not acted on (the script's
 *  search is case-insensitive — right for listing, wrong for acting). */
export function urlsNamingFile(value: unknown, file: FlaggedFile): string[] {
  const out: string[] = [];
  for (const s of stringsIn(value)) {
    const object = ownStorageObject(s.trim());
    if (object && object.bucket === file.bucket && decodedKey(object.key) === file.path) out.push(s);
  }
  return out;
}

const done = (action: FlaggedFileAction, detail: string): FlaggedFileActionResult => ({ action, status: "done", detail });
const skipped = (action: FlaggedFileAction, detail: string): FlaggedFileActionResult => ({ action, status: "skipped", detail });
const failed = (action: FlaggedFileAction, detail: string): FlaggedFileActionResult => ({ action, status: "failed", detail });
const NO_LONGER = "the row no longer draws this file";

async function hideCardUsing(admin: AdminClient, file: FlaggedFile, action: Extract<FlaggedFileAction, { kind: "hide-card" }>, srcs: string[]) {
  const { data: card, error } = await admin
    .from("cards")
    .select(`id, visibility, ${CARD_PICTURE_COLUMNS.join(", ")}`)
    .eq("id", action.cardId)
    .maybeSingle();
  if (error) return failed(action, `read failed: ${error.message}`);
  if (!card) return skipped(action, "no such card");
  const row = card as unknown as Record<string, unknown>;
  const urls = CARD_PICTURE_COLUMNS.flatMap((column) => urlsNamingFile(row[column], file));
  if (!urls.length) return skipped(action, NO_LONGER);
  srcs.push(...urls);
  const hidden = await hideCard(admin, action.cardId, { resolvedBy: null });
  if (!hidden.ok) return hidden.notFound ? skipped(action, "no such card") : failed(action, hidden.error);
  return done(action, `hidden (was ${String(row.visibility)})`);
}

async function defaultProfileMedia(admin: AdminClient, file: FlaggedFile, action: Extract<FlaggedFileAction, { kind: "profile-default" }>, srcs: string[]) {
  const kind = action.column === "avatar_url" ? "avatar" : "banner";
  const { data, error } = await admin.from("profiles").select(`id, ${action.column}`).eq("id", action.userId).maybeSingle();
  if (error) return failed(action, `read failed: ${error.message}`);
  if (!data) return skipped(action, "no such profile");
  const current = (data as unknown as Record<string, unknown>)[action.column];
  if (typeof current !== "string") return skipped(action, NO_LONGER);
  const urls = urlsNamingFile(current, file);
  if (!urls.length) return skipped(action, NO_LONGER);
  srcs.push(...urls);
  const builtIn = randomDefaultMedia(kind, current);
  if (!isDefaultProfileMedia(builtIn, kind)) return failed(action, "no built-in image to swap in");
  const { data: written, error: writeError } = await admin
    .from("profiles")
    .update(action.column === "avatar_url" ? { avatar_url: builtIn } : { banner_url: builtIn })
    .eq("id", action.userId)
    .eq(action.column, current)
    .select("id");
  if (writeError) return failed(action, `update failed: ${writeError.message}`);
  if (!written?.length) return skipped(action, `${NO_LONGER} (changed since it was read)`);
  await revalidateProfileMedia(admin, action.userId);
  return done(action, `${kind} → ${builtIn}`);
}

async function clearDeckCover(admin: AdminClient, file: FlaggedFile, action: Extract<FlaggedFileAction, { kind: "clear-deck-cover" }>, srcs: string[]) {
  const { data: deck, error } = await admin
    .from("decks")
    .select("id, slug, owner_id, cover_url")
    .eq("id", action.deckId)
    .maybeSingle();
  if (error) return failed(action, `read failed: ${error.message}`);
  if (!deck) return skipped(action, "no such deck");
  const current = deck.cover_url;
  if (typeof current !== "string") return skipped(action, NO_LONGER);
  const urls = urlsNamingFile(current, file);
  if (!urls.length) return skipped(action, NO_LONGER);
  srcs.push(...urls);
  const { data: written, error: writeError } = await admin
    .from("decks")
    .update({ cover_url: null })
    .eq("id", action.deckId)
    .eq("cover_url", current)
    .select("id");
  if (writeError) return failed(action, `update failed: ${writeError.message}`);
  if (!written?.length) return skipped(action, `${NO_LONGER} (changed since it was read)`);
  revalidateDeckPaths(deck.slug, await lookupUsername(admin, deck.owner_id));
  return done(action, "cover cleared");
}

async function removePip(admin: AdminClient, file: FlaggedFile, action: Extract<FlaggedFileAction, { kind: "remove-custom-pip" }>, srcs: string[]) {
  const { data: pip, error } = await admin
    .from("custom_pips")
    .select("id, owner_id, symbol, image_url")
    .eq("id", action.pipId)
    .maybeSingle();
  if (error) return failed(action, `read failed: ${error.message}`);
  if (!pip) return skipped(action, "no such pip");
  const urls = urlsNamingFile(pip.image_url, file);
  if (!urls.length) return skipped(action, NO_LONGER);
  if (!isCustomPipSymbol(pip.symbol)) return failed(action, `unknown pip symbol ${JSON.stringify(pip.symbol)}`);
  srcs.push(...urls);
  const removed = await deleteCustomPipRow(admin, pip.owner_id, pip.symbol, { onlyIfImageUrl: pip.image_url });
  if (removed.error) return failed(action, `delete failed: ${removed.error}`);
  if (removed.deleted === 0) return skipped(action, `${NO_LONGER} (changed since it was read)`);
  await removeCustomPipObject(pip.owner_id, pip.symbol);
  finishPipChange(pip.owner_id, pip.symbol, { cardsClient: admin });
  return done(action, `${pip.symbol} pip removed`);
}

/**
 * Act on each row the script found using `file`, one at a time, in order;
 * an action that throws is "failed" and the rest still run. Then the Image
 * Optimization purge of every URL that named the file.
 */
export async function actOnFlaggedFile(
  admin: AdminClient,
  file: FlaggedFile,
  actions: readonly FlaggedFileAction[],
): Promise<FlaggedFileActionResult[]> {
  const srcs: string[] = [];
  const results: FlaggedFileActionResult[] = [];
  for (const action of actions) {
    try {
      if (action.kind === "hide-card") results.push(await hideCardUsing(admin, file, action, srcs));
      else if (action.kind === "profile-default") results.push(await defaultProfileMedia(admin, file, action, srcs));
      else if (action.kind === "clear-deck-cover") results.push(await clearDeckCover(admin, file, action, srcs));
      else results.push(await removePip(admin, file, action, srcs));
    } catch (error) {
      results.push(failed(action, error instanceof Error ? error.message : "unexpected error"));
    }
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (base) srcs.push(`${base}/storage/v1/object/public/${file.bucket}/${file.path}`);
  await purgeImageSources(srcs);
  return results;
}
