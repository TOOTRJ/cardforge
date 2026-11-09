"use server";

import { z } from "zod";
import { isUuid } from "@/lib/ids";
import { recordToolEvent } from "@/lib/tools/events";
import { checkToolAccess } from "@/lib/tools/queries";
import { collectCardsExport, collectDeckExport, MAX_SELECTION_CARDS } from "./collect";
import { PLAY_TARGETS, type PlayExport } from "./model";

// ---------------------------------------------------------------------------
// The play-surface exports' one server action (beta tool `play-exports`):
// the export model of a deck or a selection, as the viewer may read it
// (lib/tools/play-exports/collect.ts). The files themselves are written in
// the browser by the pure exporters (cockatrice.ts, draftmancer.ts, tts.ts)
// — Cockatrice's ZIP fetches each stored bake there, a few at a time, so no
// function ever holds a deck's pictures. Free on every plan: the gate is the
// beta (checkToolAccess), never a tier, and nothing here costs a credit.
// ---------------------------------------------------------------------------

const SLUG = "play-exports";

const NO_ACCESS = "Play exports aren't open to your account right now.";

// isUuid, never z.uuid(): seeded ids are not RFC-versioned.
const uuid = z.string().refine(isUuid);

const inputSchema = z.object({
  target: z.enum(PLAY_TARGETS),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("deck"), deckId: uuid }),
    z.object({ kind: z.literal("cards"), cardIds: z.array(uuid).min(1).max(MAX_SELECTION_CARDS) }),
  ]),
});

export type PlayExportInput = z.input<typeof inputSchema>;

export type PlayExportResult =
  | { ok: true; export: PlayExport; skipped: number }
  | { ok: false; error: string };

export async function buildPlayExportAction(input: PlayExportInput): Promise<PlayExportResult> {
  const access = await checkToolAccess(SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That export request wasn't valid." };
  const { target, source } = parsed.data;

  let result: { export: PlayExport; skipped: number } | null;
  try {
    result =
      source.kind === "deck"
        ? await collectDeckExport(source.deckId, access.userId).then((built) => (built ? { export: built, skipped: 0 } : null))
        : await collectCardsExport(source.cardIds, access.userId);
  } catch (error) {
    console.error("[play-exports] export read failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "We couldn't read those cards just now. Try again in a moment." };
  }
  if (!result) return { ok: false, error: "That deck isn't available to you." };
  if (result.export.cards.length === 0 && result.export.lines.length === 0) {
    return { ok: false, error: source.kind === "deck" ? "This deck has no cards to export yet." : "None of those cards can be exported." };
  }

  await recordToolEvent({
    slug: SLUG,
    userId: access.userId,
    event: "export",
    access: access.via,
    props: {
      target,
      source: source.kind,
      custom_cards: result.export.cards.length,
      lines: result.export.lines.length,
      hidden: result.export.leftOut.hidden,
    },
  });
  return { ok: true, export: result.export, skipped: result.skipped };
}
