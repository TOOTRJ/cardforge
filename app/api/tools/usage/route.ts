import { NextResponse } from "next/server";
import { isbot } from "isbot";
import { recordClientToolEvent } from "@/lib/tools/client-events";

// ---------------------------------------------------------------------------
// POST /api/tools/usage — a beta tool's browser-side events
// (lib/tools/track-client.ts sends them; lib/tools/client-events.ts decides
// what is kept: an allow-listed name, a viewer the tool lets in, a limit a
// minute).
//
// A ROUTE, never a server action. Next runs a page's server actions one at
// a time: a tracking action fired a moment before a real one ("dialog
// opened", then the export itself) made the real one wait for it. A beacon
// to a route waits for nothing and holds nothing up, and it survives the
// page going away.
//
// Same-ORIGIN callers only (a POST from any other site, a sibling
// subdomain included, must not write into a tool's numbers), a 2 KB body,
// no crawlers.
// Always 204 with no body: the page never learns, or cares, what became of
// it.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;
const done = () => new NextResponse(null, { status: 204, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request): Promise<Response> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return done();
  if (isbot(request.headers.get("user-agent") ?? "")) return done();

  // A body that says it is too big is never read.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return done();
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return done();
  }
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return done();
  let body: { slug?: unknown; event?: unknown; props?: unknown };
  try {
    body = JSON.parse(raw) as { slug?: unknown; event?: unknown; props?: unknown };
  } catch {
    return done();
  }
  if (!body || typeof body !== "object") return done();
  await recordClientToolEvent(body.slug, body.event, body.props);
  return done();
}
