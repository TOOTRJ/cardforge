import "server-only";

import { createHmac } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import { clientNetworkOf } from "@/lib/cards/anon-render-limit";
import { isCountableView } from "@/lib/decks/views";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";

// ---------------------------------------------------------------------------
// A card page view, counted once per viewer, card and UTC day (TODO CP4,
// migration 0168) — the deck page's rule (lib/decks/views.ts, 0151) for
// cards. The page sends ONE ping when it shows the card
// (`CardViewBeacon` → POST /api/cards/[id]/view), so a reload, a like or a
// comment that re-renders the page and the page's own cache never decide
// the count; this decides it: never a crawler (isbot), a request with no
// user agent or a prefetch — the deck's `isCountableView` — and the
// database leaves out the card's owner and any card a visitor can't open.
// It logs ONE row per (card, viewer, day) in card_views and bumps
// cards.view_count only for a new row (record_card_view, the service role's
// alone — no API caller can feed it keys).
//
// The viewer never leaves this server as itself: an HMAC under the server's
// secret of the signed-in user's id, else of the visitor's network (an IPv4
// address, an IPv6 /64) and user agent — the deck's key in a context of its
// own. The database keys its row by a SHA-256 of (card, this value) under
// the DAY's random salt, which it drops once the day is over. A visitor with
// no readable address is not counted. Best-effort: a failure costs one
// view, never the page.
//
// The app may ship BEFORE 0168 reaches the database: there (PostgREST's
// PGRST202) the view goes to the old increment_card_view, once per ping, so
// no view is lost in between. Remove the fallback once 0168 is on
// production and dev.
// ---------------------------------------------------------------------------

const KEY_CONTEXT = "pipglyph:card-view:v1";

type HeaderReader = { get(name: string): string | null };

/** The viewer as the app sends it to the log: 32 hex digits of an HMAC under
 *  `secret`. Null when there is nothing to key a signed-out visitor on. */
export function cardViewerHash(viewerId: string | null, headers: HeaderReader, secret: string): string | null {
  let subject: string;
  if (viewerId) {
    subject = `user\n${viewerId}`;
  } else {
    const ip = ipAddress(headers) ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const network = clientNetworkOf(ip);
    if (!network) return null;
    subject = `visitor\n${network}\n${headers.get("user-agent") ?? ""}`;
  }
  return createHmac("sha256", secret).update(`${KEY_CONTEXT}\n${subject}`).digest("hex").slice(0, 32);
}

/** Count this request's view of a card, once per viewer and day. */
export async function recordCardView({
  cardId,
  viewerId,
  headers,
}: {
  cardId: string;
  /** The signed-in viewer, or null (the database skips the card's owner). */
  viewerId: string | null;
  /** The ping's request headers. */
  headers: HeaderReader;
}): Promise<void> {
  if (!isCountableView(headers)) return;
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!secret || !isAdminConfigured()) return;
  const viewer = cardViewerHash(viewerId, headers, secret);
  if (!viewer) return;
  try {
    const { error } = await createAdminClient().rpc("record_card_view", {
      p_card_id: cardId,
      p_viewer: viewer,
      p_viewer_id: viewerId ?? undefined,
    });
    // A database 0168 hasn't reached: the old counter (public and unlisted
    // cards only). It can't tell the owner, so the owner is skipped here.
    if (error?.code === "PGRST202") {
      if (viewerId) {
        const { data } = await createPublicClient().from("cards").select("owner_id").eq("id", cardId).maybeSingle();
        if (data?.owner_id === viewerId) return;
      }
      await createPublicClient().rpc("increment_card_view", { p_card_id: cardId });
    }
  } catch {
    // best-effort — a missed view isn't worth surfacing
  }
}
