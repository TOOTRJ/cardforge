import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { checkToolAccess } from "@/lib/tools/queries";
import { REART_TOOL_SLUG } from "@/lib/tools/re-art/model";
import { requestBackgroundStop } from "@/lib/tools/re-art/background";

// ---------------------------------------------------------------------------
// POST /api/tools/re-art-deck/stop-background — the maker's Stop, for the
// SERVER's part of a Re-art run (migration 0218;
// lib/tools/re-art/background.ts): it asks for no more cards, and the kept
// token is erased. The cards being painted finish.
//
// A plain route, never a server action: Next queues an action behind a
// pending navigation — the studio refreshes as each card lands — so a Stop
// pressed just before the tab is closed would never have been sent, and the
// server would have painted (and charged) on for up to the hour. The studio
// sends this with `keepalive`, so it outlives the page, and keeps warning
// about leaving until it is answered.
//
// The caller's own run only (the row's owner is the signed-in user).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({ jobId: z.uuid() });

export async function POST(request: Request) {
  if (!isSupabaseConfigured() || !isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Not configured." }, { status: 503 });
  }
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access) return NextResponse.json({ ok: false, error: "Re-art deck isn't open to you." }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That run couldn't be read." }, { status: 400 });
  const ok = await requestBackgroundStop(access.userId, parsed.data.jobId);
  // Not written: said, so the page can say the server may still be painting.
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
}
