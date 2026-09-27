import "server-only";

import sharp from "sharp";
import { renderCardImage } from "@/lib/render/card-image";
import { fetchScryfallImage } from "@/lib/scryfall/client";
import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { getFrameReviews } from "@/lib/cards/frame-reviews";
import {
  FRAME_REFERENCES,
  findFrameReference,
  frameComboKey,
  type FrameColorKey,
} from "@/lib/cards/frame-reference-registry";
import {
  listSlotPaths,
  resolveFrameProfile,
  slotRect,
  type SlotPath,
} from "@/lib/cards/profile-override";
import { scanGridFor } from "@/lib/frames/scan-geometry";
import {
  alignAndScore,
  scoreExclusionsFor,
  slotKindFor,
  type AlignSlot,
  type SlotScore,
} from "@/lib/frames/align";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Score one (template, colour) combination against its reference printing —
// the work behind POST /api/admin/frame-align-score, shared with the verify
// action so a tick records the same number the button shows.
//
// Renders the reference card through our pipeline (current DB overrides,
// no brand mark), fetches the real scan, and hands both to
// lib/frames/align.ts: registration, masked frame score, per-slot scores
// and suggested nudges. Landscape frames get the scan rotated and the grid
// swapped (lib/frames/scan-geometry.ts); both images are flattened onto
// black so the transparent corners compare alike.
//
// Callers are admin-gated; the Scryfall lookup is admin tooling and isn't
// logged to the per-user scryfall_calls quotas.
// ---------------------------------------------------------------------------

export type FrameAlignScore = {
  overall: number;
  /** Per-slot edge diff after registration (compat with the first UI). */
  perSlot: Partial<Record<SlotPath, number>>;
  global: { dxPct: number; dyPct: number; confidence: number };
  slots: Partial<Record<SlotPath, SlotScore>>;
  /** The printing that was scored. */
  referenceId: string;
};

export type ScoreComboResult =
  | ({ ok: true } & FrameAlignScore)
  | { ok: false; error: string; status: 404 | 502 };

/** The reference id a compare/score uses for a combo: an explicit registry
 *  pick, else the admin-pinned printing, else the registry default. */
export async function resolveReferenceId(
  template: FrameTemplate,
  color: FrameColorKey,
  ref?: string | null,
): Promise<string | null> {
  const picked = findFrameReference(template, color, ref);
  if (picked) return picked.scryfallId;
  const reviews = await getFrameReviews();
  const review = reviews.get(frameComboKey(template, color));
  return (
    (review?.referenceName ? review.referenceScryfallId : null) ??
    FRAME_REFERENCES[template][color]?.scryfallId ??
    null
  );
}

export async function scoreFrameCombo(input: {
  template: FrameTemplate;
  color: FrameColorKey;
  ref?: string | null;
}): Promise<ScoreComboResult> {
  const { template, color } = input;
  const scryfallId = await resolveReferenceId(template, color, input.ref);
  if (!scryfallId) {
    return { ok: false, error: "No reference printing for this combination.", status: 404 };
  }

  const payload = await buildFrameComparePayload(scryfallId, template);
  if (!payload?.scanUrl) {
    return { ok: false, error: "Could not resolve the reference scan.", status: 502 };
  }

  const overrides = await getFrameProfileOverrides();
  const preview = { ...payload.preview, profileOverrides: overrides };
  const resolved = resolveFrameProfile(template, overrides);
  const grid = scanGridFor(resolved.orientation ?? "portrait");
  const W = grid.width;
  const H = grid.height;

  const [oursRaw, scanFetched] = await Promise.all([
    // No brand mark: it has no counterpart on the printed card and would
    // score as drift in the footer corner.
    renderCardImage(preview, "default", { brandMark: false }).then((r) =>
      r.arrayBuffer(),
    ),
    fetchScryfallImage(payload.scanUrl),
  ]);
  if (!scanFetched) {
    return { ok: false, error: "Could not download the scan.", status: 502 };
  }

  const toGrey = async (input: ArrayBuffer, rotateDeg: 0 | 90) => {
    let image = sharp(Buffer.from(input)).flatten({ background: "#000000" });
    if (rotateDeg) image = image.rotate(rotateDeg);
    const data = await image.resize(W, H, { fit: "fill" }).greyscale().raw().toBuffer();
    return { width: W, height: H, data: new Uint8Array(data) };
  };

  const [ours, scan] = await Promise.all([
    toGrey(oursRaw, 0),
    toGrey(await scanFetched.blob.arrayBuffer(), grid.rotateDeg),
  ]);

  const slots: AlignSlot[] = [];
  for (const path of listSlotPaths(resolved)) {
    const rect = slotRect(resolved, path);
    if (rect) slots.push({ path, rect, kind: slotKindFor(path) });
  }

  // Printed details the master doesn't draw (the borderless holo-stamp
  // arch, 4.9) stay out of the score.
  const result = alignAndScore({ ours, scan, slots, exclude: scoreExclusionsFor(template) });

  const perSlot: Partial<Record<SlotPath, number>> = {};
  const slotScores: Partial<Record<SlotPath, SlotScore>> = {};
  for (const [path, score] of Object.entries(result.perSlot)) {
    perSlot[path as SlotPath] = score.score;
    slotScores[path as SlotPath] = score;
  }

  return {
    ok: true,
    overall: result.overall,
    perSlot,
    global: {
      dxPct: result.global.dxPct,
      dyPct: result.global.dyPct,
      confidence: result.global.confidence,
    },
    slots: slotScores,
    referenceId: scryfallId,
  };
}
