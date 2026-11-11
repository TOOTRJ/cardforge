import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getFreshCreditBalance } from "@/lib/ai/rate-limit";
import { getCurrentUser } from "@/lib/supabase/server";
import { isUuid } from "@/lib/ids";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEventLater } from "@/lib/tools/events";
import { isCollectionAiKind, readCollectionAiResult } from "@/lib/tools/collection/ai-results";
import { COLLECTION_TOOL_SLUG } from "@/lib/tools/collection/limits";

// ---------------------------------------------------------------------------
// GET /api/tools/collection-builder/ai-result?kind=build|suggest&request=<id>
// — what became of a paid Collection AI call whose response never reached
// the page (migration 0198, lib/tools/collection/ai-results.ts). The page
// asks with the request id it sent; only the viewer's own row of that kind,
// and only that request's, is read:
//
//   { state: "done", result }   the answer, as the call sent it
//   { state: "running" }        still working: ask again
//   { state: "failed" }         it failed after the charge; the credit was
//                               refunded
//   { state: "refused" }        turned down before anything was charged
//   { state: "none" }           no record: the request never reached the
//                               route
//
// each with the viewer's `credits` now.
//
// Free: the credit was the call's. Statuses the page tells apart: 401
// (signed out) and 404 (the tool is not open to this account) end the
// asking; 503 (a read that failed here) is asked again. Recorded once an
// answer is handed back (`ai_recovered`).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503, headers: NO_STORE });
  }
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const requestId = params.get("request") ?? "";
  if (!isCollectionAiKind(kind) || !isUuid(requestId)) {
    return NextResponse.json({ ok: false, error: "That request couldn't be read." }, { status: 400, headers: NO_STORE });
  }
  const access = await checkToolAccess(COLLECTION_TOOL_SLUG);
  if (!access) {
    // Signed out, or signed in and not let in — never a reason to keep
    // asking; anything else that made the check fail is asked again.
    const signedIn = Boolean(await getCurrentUser().catch(() => null));
    return NextResponse.json(
      { ok: false, error: signedIn ? "The Collection Deck Builder isn't open to you." : "Sign in to use the Collection Deck Builder." },
      { status: signedIn ? 404 : 401, headers: NO_STORE },
    );
  }
  const found = await readCollectionAiResult(access.userId, kind, requestId);
  if (!found) {
    return NextResponse.json({ ok: false, error: "That couldn't be checked right now." }, { status: 503, headers: NO_STORE });
  }
  const credits = await getFreshCreditBalance();
  if (found.state === "done") {
    recordToolEventLater({
      slug: COLLECTION_TOOL_SLUG,
      userId: access.userId,
      event: "ai_recovered",
      access: access.via,
      props: { kind },
    });
    return NextResponse.json({ ok: true, state: "done", result: found.result, credits }, { headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, state: found.state, credits }, { headers: NO_STORE });
}
