import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { renderCardImage } from "@/lib/render/card-image";
import { fetchScryfallImage } from "@/lib/scryfall/client";
import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { getFrameReviews } from "@/lib/cards/frame-reviews";
import {
  FRAME_COLOR_KEYS,
  FRAME_REFERENCES,
  findFrameReference,
  frameComboKey,
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
  slotKindFor,
  type AlignSlot,
  type SlotScore,
} from "@/lib/frames/align";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// POST /api/admin/frame-align-score  { template, color }
//
// Objective alignment signal for the frame-compare tool: renders the
// combo's reference card through our pipeline (current DB overrides
// applied, no brand mark), fetches the real scan, and hands both to
// lib/frames/align.ts, which
//   • registers the scan to our render (so a scan crop offset never counts),
//   • scores the FRAME with the art window, text and stat interiors masked,
//   • scores each slot and searches for the shift that best matches the
//     printed element — reported as the suggested nudge in card percent.
//
// Landscape frames (battle, split): the scan is a portrait 745×1040 file
// with the card content turned 90° counter-clockwise, while our render is
// a true landscape image — the scan is rotated clockwise and the grid
// swapped to 1040×745 (lib/frames/scan-geometry.ts). Both images are
// flattened onto black so the transparent rounded corners compare alike.
//
// The numbers are edge differences after registration (lower is better);
// fonts differ, so text slots never reach 0 — the per-slot NUDGE is the
// actionable part.
//
// Admin-clicked button → session is_admin gate (not CRON). The Scryfall
// scan comes off the unlimited CDN; the card lookup is admin tooling and
// isn't logged to the per-user scryfall_calls quotas.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  template: z.enum(FRAME_TEMPLATE_VALUES),
  color: z.enum(FRAME_COLOR_KEYS),
  /** A registry printing picked on the compare page (?ref=); validated
   *  against the registry, so only listed printings are ever rendered. */
  ref: z.string().regex(/^[0-9a-f-]{8,}$/i).optional(),
});

export type FrameAlignScore = {
  overall: number;
  /** Per-slot edge diff after registration (compat with the first UI). */
  perSlot: Partial<Record<SlotPath, number>>;
  global: { dxPct: number; dyPct: number; confidence: number };
  slots: Partial<Record<SlotPath, SlotScore>>;
};

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload." }, { status: 400 });
  }
  const { template, color, ref } = parsed.data;

  // Same reference resolution as the compare page: an explicit registry
  // pick, else the admin-pinned printing, else the registry default.
  const reviews = await getFrameReviews();
  const review = reviews.get(frameComboKey(template, color));
  const scryfallId =
    findFrameReference(template, color, ref)?.scryfallId ??
    (review?.referenceName ? review.referenceScryfallId : null) ??
    FRAME_REFERENCES[template][color]?.scryfallId;
  if (!scryfallId) {
    return NextResponse.json(
      { ok: false, error: "No reference printing for this combination." },
      { status: 404 },
    );
  }

  const payload = await buildFrameComparePayload(scryfallId, template);
  if (!payload?.scanUrl) {
    return NextResponse.json(
      { ok: false, error: "Could not resolve the reference scan." },
      { status: 502 },
    );
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
    return NextResponse.json(
      { ok: false, error: "Could not download the scan." },
      { status: 502 },
    );
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

  const result = alignAndScore({ ours, scan, slots });

  const perSlot: Partial<Record<SlotPath, number>> = {};
  const slotScores: Partial<Record<SlotPath, SlotScore>> = {};
  for (const [path, score] of Object.entries(result.perSlot)) {
    perSlot[path as SlotPath] = score.score;
    slotScores[path as SlotPath] = score;
  }

  const body: { ok: true } & FrameAlignScore = {
    ok: true,
    overall: result.overall,
    perSlot,
    global: {
      dxPct: result.global.dxPct,
      dyPct: result.global.dyPct,
      confidence: result.global.confidence,
    },
    slots: slotScores,
  };
  return NextResponse.json(body);
}
