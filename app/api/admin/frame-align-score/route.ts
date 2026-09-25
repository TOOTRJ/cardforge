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
  frameComboKey,
} from "@/lib/cards/frame-reference-registry";
import {
  listSlotPaths,
  resolveFrameProfile,
  slotRect,
  type SlotPath,
} from "@/lib/cards/profile-override";
import { scanGridFor } from "@/lib/frames/scan-geometry";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// POST /api/admin/frame-align-score  { template, color }
//
// Objective alignment signal for the frame-compare tool: renders the
// combo's reference card through our pipeline (current DB overrides
// applied), fetches the real scan, and computes a mean-abs-diff per
// profile slot region (greyscale, both sides resized to the scan grid).
//
// Landscape frames (battle, split): the scan is a portrait 745×1040 file
// with the card content turned 90° counter-clockwise, while our render is
// a true landscape image — the scan is rotated clockwise and the grid
// swapped to 1040×745 (lib/frames/scan-geometry.ts) so the two line up and
// the profile's landscape-percent rects address the right pixels. Both
// images are flattened onto black first so the transparent rounded corners
// compare like for like.
//
// The absolute number is NOISY — fonts and art legitimately differ — so the
// UI presents it as a relative/regression signal: compare before vs after a
// nudge, not against zero. artSlot is reported but labeled (art always
// differs).
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
});

export type FrameAlignScore = {
  overall: number;
  perSlot: Partial<Record<SlotPath, number>>;
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
  const { template, color } = parsed.data;

  // Same reference resolution as the compare page: admin-pinned wins.
  const reviews = await getFrameReviews();
  const review = reviews.get(frameComboKey(template, color));
  const scryfallId =
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
    renderCardImage(preview, "default").then((r) => r.arrayBuffer()),
    fetchScryfallImage(payload.scanUrl),
  ]);
  if (!scanFetched) {
    return NextResponse.json(
      { ok: false, error: "Could not download the scan." },
      { status: 502 },
    );
  }

  const toGrey = (input: ArrayBuffer, rotateDeg: 0 | 90) => {
    let image = sharp(Buffer.from(input)).flatten({ background: "#000000" });
    if (rotateDeg) image = image.rotate(rotateDeg);
    return image.resize(W, H, { fit: "fill" }).greyscale().raw().toBuffer();
  };

  const [ours, scan] = await Promise.all([
    toGrey(oursRaw, 0),
    toGrey(await scanFetched.blob.arrayBuffer(), grid.rotateDeg),
  ]);

  const regionScore = (rect: {
    topPct: number;
    leftPct: number;
    widthPct: number;
    heightPct: number;
  }): number => {
    const x0 = Math.max(0, Math.round((rect.leftPct / 100) * W));
    const x1 = Math.min(W, Math.round(((rect.leftPct + rect.widthPct) / 100) * W));
    const y0 = Math.max(0, Math.round((rect.topPct / 100) * H));
    const y1 = Math.min(H, Math.round(((rect.topPct + rect.heightPct) / 100) * H));
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = y * W + x;
        sum += Math.abs(ours[i] - scan[i]);
        count += 1;
      }
    }
    return count === 0 ? 0 : Math.round((sum / count / 255) * 1000) / 10;
  };

  const perSlot: Partial<Record<SlotPath, number>> = {};
  for (const path of listSlotPaths(resolved)) {
    const rect = slotRect(resolved, path);
    if (rect) perSlot[path] = regionScore(rect);
  }
  const overall = regionScore({ topPct: 0, leftPct: 0, widthPct: 100, heightPct: 100 });

  return NextResponse.json({ ok: true, overall, perSlot });
}
