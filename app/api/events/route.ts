import { handleFunnelStep } from "@/lib/analytics/funnel-step-route";

// ---------------------------------------------------------------------------
// POST /api/events — the funnel steps' address BEFORE 2026-11 (now
// /api/steps: app/api/steps/route.ts says why). Kept answering with the same
// handler so a tab that loaded its script before the rename still records;
// nothing in the app posts here any more
// (tests/unit/api/funnel-step-route.test.ts holds that). Safe to delete once
// no such tab can be open.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleFunnelStep(request);
}
