import "server-only";

import { createHmac } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import { isbot } from "isbot";
import { clientNetworkOf } from "@/lib/cards/anon-render-limit";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// A deck page view, counted once per viewer, deck and UTC day (TODO DK0.11,
// migration 0151). The page calls recordDeckView from after(): never for the
// deck's owner, a crawler (isbot — the funnel's rule, app/api/events), a
// request with no user agent, or a prefetch (Next's router, a browser's
// speculative load). The database logs ONE row per (deck, viewer, day) in
// deck_views and bumps decks.view_count only for a new row
// (record_deck_view, the service role's alone — no API caller can feed it
// keys, so the count can't be pumped through PostgREST).
//
// The viewer the log dedupes on never leaves this server as itself: it is an
// HMAC under the server's secret (0125's rule, lib/cards/anon-render-limit.ts)
// of the signed-in user's id, else of the visitor's network (an IPv4 address,
// an IPv6 /64 — clientNetworkOf) and user agent. No cookie is set and no
// address, user id or agent is stored: the database keys its row by a
// SHA-256 of (deck, this value) salted with random bytes of the DAY, which it
// drops once the day is over. A visitor with no readable address (only possible off Vercel) is not
// counted, never pooled into one viewer. Best-effort: a failure costs one
// view, never the page.
// ---------------------------------------------------------------------------

const KEY_CONTEXT = "pipglyph:deck-view:v1";

type HeaderReader = { get(name: string): string | null };

/** Whether a request is a person's view at all: a user agent that isn't a
 *  crawler's, and no prefetch. */
export function isCountableView(headers: HeaderReader): boolean {
  const agent = headers.get("user-agent") ?? "";
  if (!agent.trim() || isbot(agent)) return false;
  if (headers.get("next-router-prefetch")) return false;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`.toLowerCase();
  return !purpose.includes("prefetch");
}

/** The viewer as the app sends it to the log: 32 hex digits of an HMAC under
 *  `secret` — of the signed-in user's id, else of the network and the user
 *  agent. Null when there is nothing to key a signed-out visitor on. */
export function deckViewerHash(viewerId: string | null, headers: HeaderReader, secret: string): string | null {
  let subject: string;
  if (viewerId) {
    subject = `user\n${viewerId}`;
  } else {
    // As Vercel reports it (x-real-ip), else the first x-forwarded-for hop.
    const ip = ipAddress(headers) ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const network = clientNetworkOf(ip);
    if (!network) return null;
    subject = `visitor\n${network}\n${headers.get("user-agent") ?? ""}`;
  }
  return createHmac("sha256", secret).update(`${KEY_CONTEXT}\n${subject}`).digest("hex").slice(0, 32);
}

/** Count this request's view of a deck, once per viewer and day. */
export async function recordDeckView({
  deckId,
  ownerId,
  viewerId,
  headers,
}: {
  deckId: string;
  /** The deck's owner: their own views never count. */
  ownerId: string;
  /** The signed-in viewer, or null. */
  viewerId: string | null;
  /** The page request's headers. */
  headers: HeaderReader;
}): Promise<void> {
  if (viewerId && viewerId === ownerId) return;
  if (!isCountableView(headers)) return;
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!secret || !isAdminConfigured()) return;
  const viewer = deckViewerHash(viewerId, headers, secret);
  if (!viewer) return;
  try {
    // A database 0151 hasn't reached answers "no such function": no view
    // is logged there, and nothing else happens.
    await createAdminClient().rpc("record_deck_view", {
      p_deck_id: deckId,
      p_viewer: viewer,
      p_viewer_id: viewerId ?? undefined,
    });
  } catch {
    // best-effort — a missed view isn't worth surfacing
  }
}
