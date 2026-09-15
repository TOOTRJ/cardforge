import { NextResponse } from "next/server";
import { BUILD_ID } from "@/lib/build-id";

// GET /api/version — which deployment is serving production right now.
// Polled (cookie-less, uncached) by the update prompt in every open tab;
// a tab whose baked-in BUILD_ID differs is stale. Cookie-less matters:
// with Vercel Skew Protection on, a request carrying the deployment cookie
// is routed back to the OLD deployment and would never see the new id.

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { build: BUILD_ID },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
