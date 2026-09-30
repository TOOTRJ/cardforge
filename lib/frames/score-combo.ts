import "server-only";

import sharp from "sharp";
import { renderCardImage } from "@/lib/render/card-image";
import { fetchScryfallImage } from "@/lib/scryfall/client";
import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { getFrameReviews } from "@/lib/cards/frame-reviews";
import {
  findFrameReference,
  type FrameColorKey,
} from "@/lib/cards/frame-reference-registry";
import { pickFrameReferenceFrom } from "@/lib/cards/frame-reference-pick";
import {
  listSlotPaths,
  resolveFrameProfile,
  slotRect,
  type FrameProfileOverridesMap,
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
import { kindFromCard } from "@/lib/creator/card-kinds";
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
  // An explicit registry pick needs no review read.
  const picked = findFrameReference(template, color, ref);
  if (picked) return picked.scryfallId;
  const reviews = await getFrameReviews();
  return pickFrameReferenceFrom(reviews, template, color)?.scryfallId ?? null;
}

export async function scoreFrameCombo(input: {
  template: FrameTemplate;
  color: FrameColorKey;
  ref?: string | null;
  /** The reference printing, already resolved by an admin-gated caller
   *  (the score batch plans every combo from one review read, before its
   *  stream starts) — skips the cookie-bound review read. Never a client
   *  value. */
  referenceId?: string | null;
  /** The layout overrides to render with — a caller that records the
   *  override hash passes the same map it hashes. */
  overrides?: FrameProfileOverridesMap;
}): Promise<ScoreComboResult> {
  const { template, color } = input;
  const scryfallId = input.referenceId ?? (await resolveReferenceId(template, color, input.ref));
  if (!scryfallId) {
    return { ok: false, error: "No reference printing for this combination.", status: 404 };
  }

  const payload = await buildFrameComparePayload(scryfallId, template);
  if (!payload?.scanUrl) {
    return { ok: false, error: "Could not resolve the reference scan.", status: 502 };
  }

  const overrides = input.overrides ?? (await getFrameProfileOverrides());
  const preview = { ...payload.preview, profileOverrides: overrides };
  const resolved = resolveFrameProfile(template, overrides);
  const grid = scanGridFor(resolved.orientation ?? "portrait");
  const W = grid.width;
  const H = grid.height;

  const [oursRaw, scanFetched] = await Promise.all([
    // No brand mark: it has no counterpart on the printed card and would
    // score as drift in the footer corner. ROUND corners, like the Scryfall
    // PNG it is scored against (cut round and transparent): both flatten to
    // black below, so the corners now match — every template's score moved
    // a little when the bake gained its rounded corner (TODO 3.26).
    renderCardImage(preview, "default", { brandMark: false, corners: "round" }).then((r) =>
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

  // Only the slots the reference printing's kind draws (TODO 4.5.0): a
  // creature printing is never scored against a walker's loyalty shield, a
  // battle's defense or a saga's chapter rail it doesn't print. A printing
  // whose type the import couldn't read keeps every slot.
  const referenceKind = payload.preview.cardType ? kindFromCard(payload.preview.cardType, template) : undefined;
  const slots: AlignSlot[] = [];
  for (const path of listSlotPaths(resolved, referenceKind)) {
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
