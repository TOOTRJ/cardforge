import type { createClient } from "@/lib/supabase/server";
import { languageForcesPrivate, type ProfanityField } from "@/lib/moderation/profanity";
import { dfcBackArtMissing } from "@/lib/cards/dfc-gate";
import type { Visibility } from "@/types/card";

// ---------------------------------------------------------------------------
// The read a visibility change makes first (updateCardsVisibilityAction, My
// Cards' bulk bar) — and the deck's "Make it public" offer (TODO DK0.13,
// changeDeckMembershipAction), which asks the same question before it
// offers anything: is the card the caller's, is it a frame preview, and
// would its text keep it private (owner policy 2026-10-28)? Plain module
// (not "use server"): both actions call it with their own session client.
// ---------------------------------------------------------------------------

type SessionClient = Awaited<ReturnType<typeof createClient>>;

export type VisibilityPreflightRow = {
  id: string;
  owner_id: string;
  title: string;
  back_face: unknown;
  rendered_image_url: string | null;
  /** The artwork rule (no art → no gallery; a double-faced back's too). */
  art_url?: string | null;
  frame_style?: { template?: string | null } | null;
  /** Absent until migration 0121 lands. */
  frame_preview?: boolean;
  /** The card's visibility and text, for the strong-language rule. */
  visibility?: Visibility;
  nickname?: string | null;
  supertype?: string | null;
  printed_types?: string | null;
  subtypes?: string[] | null;
  tags?: string[] | null;
  rules_text?: string | null;
  flavor_text?: string | null;
  artist_credit?: string | null;
  footer_text?: string | null;
  face_content?: unknown;
};

/** The pre-flight's columns. A database that lacks one of the LATE ones
 *  (frame_preview before 0121, printed_types before 0137, nickname before
 *  0141) answers that it does not exist, naming it, and the read runs
 *  again without it. */
const PREFLIGHT_COLUMNS: readonly string[] = [
  "id",
  "owner_id",
  "title",
  "back_face",
  "rendered_image_url",
  "art_url",
  "frame_style",
  "frame_preview",
  "visibility",
  "nickname",
  "supertype",
  "printed_types",
  "subtypes",
  "tags",
  "rules_text",
  "flavor_text",
  "artist_credit",
  "footer_text",
  "face_content",
];
const LATE_COLUMNS: readonly string[] = ["frame_preview", "printed_types", "nickname"];

/** The rows of `ids` the caller's session can read (RLS decides), with the
 *  columns above. */
export async function readVisibilityPreflight(
  supabase: SessionClient,
  ids: readonly string[],
): Promise<{ rows: VisibilityPreflightRow[] | null; error: { message: string } | null }> {
  let rows: VisibilityPreflightRow[] | null = null;
  let error: { message: string } | null = null;
  let columns = [...PREFLIGHT_COLUMNS];
  for (let attempt = 0; attempt <= LATE_COLUMNS.length; attempt += 1) {
    const read = await supabase.from("cards").select(columns.join(", ")).in("id", [...ids]);
    rows = (read.data ?? null) as unknown as VisibilityPreflightRow[] | null;
    error = read.error;
    const message = read.error?.message ?? "";
    const missing = read.error
      ? LATE_COLUMNS.find((column) => columns.includes(column) && message.includes(column))
      : undefined;
    if (!missing) break;
    columns = columns.filter((column) => column !== missing);
  }
  return { rows, error };
}

/** The fields whose strong language keep this stored card from going to
 *  `visibility` — the bulk change's rule, read on the stored row (empty =
 *  it may go). */
export function storedLanguageBlocks(row: VisibilityPreflightRow, visibility: Visibility): ProfanityField[] {
  return languageForcesPrivate({
    saved: row,
    visibility,
    stored: { card: row, visibility: row.visibility ?? "private" },
  });
}

/** What the artwork rule says of this stored card going PUBLIC — the single
 *  card actions' rule (no artwork → no gallery; a double-faced card's back
 *  needs its picture too, TODO 5.2 D13): "front" / "back" when a public save
 *  would be demoted to a draft, null when it may go. Unlisted is never held
 *  back by it. */
export function storedArtMissing(row: VisibilityPreflightRow): "front" | "back" | null {
  if (!row.art_url) return "front";
  const back = (row.back_face ?? null) as Parameters<typeof dfcBackArtMissing>[1];
  if (dfcBackArtMissing(row.frame_style?.template ?? null, back)) return "back";
  return null;
}
