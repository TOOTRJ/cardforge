import { handleFunnelStep } from "@/lib/analytics/funnel-step-route";

// ---------------------------------------------------------------------------
// POST /api/steps — the browser's funnel steps (FUNNEL_STEPS_ENDPOINT,
// lib/analytics/funnel-events.ts; the handler and its rules are
// lib/analytics/funnel-step-route.ts).
//
// The path was /api/events until 2026-11. EasyPrivacy's generic rule
// `/api/events|$ping,~third-party` cancels a first-party sendBeacon to any
// address that ENDS in /api/events, so every visitor with a blocker was
// missing from the browser steps (pricing views, button clicks, the upgrade
// modal) while the server's steps (signup, checkout, payment) counted them:
// the top of the funnel read low against its bottom. What is recorded did not
// change: first-party, no cookie, and a signed-out visitor's row carries no
// identifier. Owner decision 2026-11-11.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleFunnelStep(request);
}
