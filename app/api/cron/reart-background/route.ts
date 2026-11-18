import { NextResponse } from "next/server";
import { cronRouteGuard } from "@/lib/api/cron-auth";
import { SWEEP_MS, driveBackgroundRuns } from "@/lib/tools/re-art/background";

// ---------------------------------------------------------------------------
// GET /api/cron/reart-background — every minute (vercel.json): the DRIVER
// of the Re-art runs the server carries on after their page is closed
// (lib/tools/re-art/background.ts has the whole story). For the best part
// of the minute it looks at those runs every few seconds: ends the ones
// that are over (and tells their makers in the bell), pauses the ones whose
// borrowed sign-in is running out, and asks the step door for a card
// wherever fewer than two are being painted.
//
// With no run being carried it is one indexed read and done.
//
// It is a cron — never a request that calls itself again: Vercel's
// recursion protection stops such a chain after a few links.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
// A minute's work and room to let go of it; the next call's driver takes
// the runs this one released (the lease keeps the two apart if they meet).
export const maxDuration = 90;

export async function GET(request: Request) {
  const blocked = cronRouteGuard(request);
  if (blocked) return blocked;
  const result = await driveBackgroundRuns({ forMs: SWEEP_MS, requestUrl: request.url });
  return NextResponse.json({ ok: true, ...result });
}
