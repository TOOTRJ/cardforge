import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronRouteGuard } from "@/lib/api/cron-auth";
import { isUuid } from "@/lib/ids";
import { purgeHiddenCards } from "@/lib/cards/revalidate";
import {
  actOnFlaggedFile,
  flaggedFileActionSchema,
  flaggedFileSchema,
} from "@/lib/moderation/flagged-file";

// ---------------------------------------------------------------------------
// POST /api/admin/storage-sweep — the app side of the owner-run
// scripts/sweep-storage-orphans.mjs (TODO 3.14b), for the two steps a script
// can't do itself: act on rows through the app's own code paths, and purge
// Vercel's CDN (only a function running on Vercel can). Secured like the
// cron routes and the re-bake driver: `Authorization: Bearer ${CRON_SECRET}`
// (fails closed without a secret; 503 without the service role). No dev
// bypass. JSON body, one `op`:
//
//   whoami        → which database this deployment talks to
//                   (`supabaseHost`), so the script refuses to act through
//                   an app on another database than its --target;
//   purge-cards   → `cardIds` (≤100): purgeHiddenCards — the Next caches of
//                   the list surfaces and each card's share image, and the
//                   CDN copies tagged card-<id> (share image + /render-cdn
//                   bake). For --private-renders, after it removed renders;
//   flagged-file  → `file` + `actions` (≤50): the rows that use a file the
//                   moderation rescan flagged — hide the card, swap in a
//                   built-in avatar/banner, clear the deck cover, remove the
//                   pip (lib/moderation/flagged-file.ts; each action re-reads
//                   its row and acts only while it still draws that file).
//
// Every answer carries `supabaseHost` and `vercel` (whether a CDN purge
// could happen here at all — off Vercel it is a no-op).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("whoami") }),
  z.object({
    op: z.literal("purge-cards"),
    cardIds: z.array(z.string().refine(isUuid, "not a uuid")).min(1).max(100),
  }),
  z.object({
    op: z.literal("flagged-file"),
    file: flaggedFileSchema,
    actions: z.array(flaggedFileActionSchema).min(1).max(50),
  }),
]);

function supabaseHost(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const denied = cronRouteGuard(request);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "The body must be JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  const where = { supabaseHost: supabaseHost(), vercel: Boolean(process.env.VERCEL) };
  const body = parsed.data;

  if (body.op === "whoami") return NextResponse.json({ ok: true, ...where });

  if (body.op === "purge-cards") {
    const ids = [...new Set(body.cardIds.map((id) => id.toLowerCase()))];
    await purgeHiddenCards(ids);
    return NextResponse.json({ ok: true, ...where, purged: ids.length });
  }

  const results = await actOnFlaggedFile(createAdminClient(), body.file, body.actions);
  return NextResponse.json({ ok: true, ...where, results });
}
