import "server-only";

import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Per-user windowed quota for the Scryfall proxy. Mirrors the AI rate-limit
// helper from lib/ai/rate-limit.ts — same shape, separate table.
//
// Limits are more generous than AI because:
//   - Scryfall is free and doesn't cost us per call (only their politeness)
//   - typeahead search is naturally chatty (one call per keystroke pause)
//   - art import is bounded by the user's storage quota anyway
//
// `import_art` has a tighter cap than `search`/`named` because it pulls a
// few hundred KB across the wire each time.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

// action → { perMinute, perDay }. Single source of truth — the usage
// panel (lib/scryfall/usage-queries.ts) and the admin dashboard consume
// this same object.
export const SCRYFALL_LIMITS = {
  search: { perMinute: 60, perDay: 2000 },
  named: { perMinute: 30, perDay: 500 },
  import_art: { perMinute: 10, perDay: 100 },
  // One row per decklist-import RUN (a run itself makes ≤ a handful of
  // collection calls), so these numbers are runs, not API calls.
  deck_import: { perMinute: 10, perDay: 50 },
  // One row per import COMMIT that re-fetches its printings (migration
  // 0143; a list of placeholders only calls nothing and logs nothing). Its
  // own action, so a commit never spends the resolve quota. Twice the
  // resolve's numbers: every honest commit follows a resolve (itself held
  // to 10 / 50) and may be retried once after a hiccup, so a commit right
  // after its resolve is never the one refused — a reviewed list is lost
  // when the dialog closes.
  deck_import_commit: { perMinute: 20, perDay: 100 },
  // One row per deck PAGE VIEW whose "Tokens & emblems" lookup reached
  // Scryfall (TODO DK5.16, migration 0164: a cache miss — the answer is
  // shared a day per deck's printings, lib/decks/deck-tokens-server.ts), on
  // the signed-in viewer whose view made it (an anonymous view can't be
  // logged: the table's user_id is required). LOGGED, NEVER CHECKED: a page
  // view is never refused; the numbers are what the usage panels compare it
  // with.
  deck_tokens: { perMinute: 30, perDay: 500 },
  // One row per collection-import CHUNK the server resolves (the Collection
  // Deck Builder beta tool, migration 0185): ≤ 300 lines, a handful of
  // /cards/collection calls. A 25,000-card collection is ~84 chunks, a few
  // seconds each, so a whole import fits a day several times over.
  collection_import: { perMinute: 40, perDay: 400 },
  // One row per real card's ART a model repaints (Re-art deck's restyle,
  // migration 0213; lib/scryfall/art-crop.ts): the art crop is read from
  // Scryfall's image CDN and never stored. Its own action — NOT import_art,
  // whose 100 a day is sized for pictures a maker keeps in their folder: a
  // run restyles up to 150 cards (two pictures for a two-faced one), and
  // counted there it stopped near the hundredth card and spent the
  // creator's own art import for the day. Each of these is one credit, so
  // the credits are what really bounds it; the numbers are `named`'s (every
  // restyled card is one lookup too).
  restyle_art: { perMinute: 30, perDay: 500 },
} as const;

const LIMITS = SCRYFALL_LIMITS;

export type ScryfallActionLabel = keyof typeof LIMITS;

export type ScryfallRateLimitResult =
  | { ok: true }
  | {
      ok: false;
      reason: "per_minute" | "per_day";
      retryAfterSeconds: number;
      message: string;
    };

export async function checkScryfallRateLimit(
  userId: string,
  action: ScryfallActionLabel,
): Promise<ScryfallRateLimitResult> {
  const supabase = await createClient();
  const now = Date.now();
  const minuteAgo = new Date(now - MINUTE_MS).toISOString();
  const dayAgo = new Date(now - DAY_MS).toISOString();

  const [minuteResult, dayResult] = await Promise.all([
    supabase
      .from("scryfall_calls")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", action)
      .gte("created_at", minuteAgo),
    supabase
      .from("scryfall_calls")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", action)
      .gte("created_at", dayAgo),
  ]);

  // Same fail-open posture as the AI limiter: if the DB hiccups, let the
  // request through rather than wedging the editor on an unrelated outage.
  if (minuteResult.error || dayResult.error) return { ok: true };

  const minuteCount = minuteResult.count ?? 0;
  const dayCount = dayResult.count ?? 0;
  const limits = LIMITS[action];

  if (minuteCount >= limits.perMinute) {
    return {
      ok: false,
      reason: "per_minute",
      retryAfterSeconds: 60,
      message: `Slow down — you've hit ${limits.perMinute} ${action} calls in the last minute.`,
    };
  }
  if (dayCount >= limits.perDay) {
    return {
      ok: false,
      reason: "per_day",
      retryAfterSeconds: 60 * 60,
      message: `Daily quota reached (${limits.perDay} ${action}/day).`,
    };
  }

  return { ok: true };
}

export async function logScryfallCall(
  userId: string,
  action: ScryfallActionLabel,
): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from("scryfall_calls").insert({
      user_id: userId,
      action,
    });
  } catch {
    // Silent — see lib/ai/rate-limit.ts for the rationale.
  }
}
