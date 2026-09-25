import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { scoreFrameCombo } from "@/lib/frames/score-combo";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// POST /api/admin/frame-align-score  { template, color, ref? }
//
// Objective alignment signal for the frame-compare tool — see
// lib/frames/score-combo.ts for what is measured (registered, masked edge
// diffs with per-slot nudges). Admin-clicked button → session is_admin gate
// (not CRON). The verify action calls the same function so a tick records
// exactly what this button shows.
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

export type { FrameAlignScore } from "@/lib/frames/score-combo";

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload." }, { status: 400 });
  }

  const result = await scoreFrameCombo(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
