import "server-only";

import { z } from "zod";
import { getSiteBaseUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// Scryfall server-side client.
//
// Scryfall's API is free and key-less. Their docs require:
//   - User-Agent identifying your app (with a contact URL when possible)
//   - Accept header on every request
//   - Hard rate limits: /cards/search, /cards/named, /cards/random and
//     /cards/collection are capped at 2 requests/second (500ms); every
//     other API method allows 10/second (100ms). The cards.scryfall.io
//     image CDN has no rate limit at all.
//   - 429 responses lock the caller out for 30 seconds; ignoring them
//     risks a temporary or permanent ban.
//
// All requests go through this module so the headers + spacing live in one
// place. Routes import the helpers below — never call Scryfall directly
// from a route handler.
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.scryfall.com";
// Scryfall's documented hard limits: 2/sec on the card-lookup endpoints,
// 10/sec everywhere else.
const SLOW_GAP_MS = 500;
const FAST_GAP_MS = 100;
const SLOW_PATH = /^\/cards\/(search|named|random|collection)\b/;

function minGapFor(path: string): number {
  return SLOW_PATH.test(path) ? SLOW_GAP_MS : FAST_GAP_MS;
}

// Module-level chain enforces the minimum gap between outbound Scryfall
// requests per Vercel function instance. Concurrent callers within the
// same instance queue politely instead of stampeding. (Different instances
// each maintain their own chain; Vercel egresses from many IPs so this is
// fine in practice.)
let lastDispatchAt = 0;
async function throttle(gapMs: number): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastDispatchAt + gapMs - now);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastDispatchAt = Date.now();
}

function userAgent(): string {
  // Scryfall asks for a User-Agent string identifying your app and ideally
  // a contact URL. We use the site base URL as a contact pointer.
  const site = getSiteBaseUrl();
  // The Scryfall docs require a User-Agent identifying the app and ideally
  // a contact URL. Override via SCRYFALL_USER_AGENT if needed (e.g. when
  // running multiple environments against the same outbound IP).
  return (
    process.env.SCRYFALL_USER_AGENT?.trim() ||
    `PipGlyph/1.0 (+${site})`
  );
}

// Retry budget: a 429 lockout is 30s, but routes run with tight
// maxDuration — if Scryfall asks us to wait longer than this, return the
// error response instead of burning function time.
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 4_000;

async function scryfallFetch(path: string): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    await throttle(minGapFor(path));
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent(),
      },
      // Don't cache server-side — this is dynamic search content, and the
      // freshness signal we want comes from the user typing, not the CDN.
      cache: "no-store",
    });
    const retriable = response.status === 429 || response.status >= 500;
    if (!retriable || attempt >= MAX_RETRIES) return response;

    const retryAfterSec = Number(response.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : 500 * 2 ** attempt;
    if (waitMs > MAX_RETRY_WAIT_MS) return response;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

// ---------------------------------------------------------------------------
// Zod schemas — defensive parse of the Scryfall response, picking only the
// fields we surface. Unknown fields are dropped quietly, so a future
// Scryfall schema addition won't break us.
// ---------------------------------------------------------------------------

export const scryfallImageUrisSchema = z
  .object({
    small: z.string().url().optional(),
    normal: z.string().url().optional(),
    large: z.string().url().optional(),
    png: z.string().url().optional(),
    art_crop: z.string().url().optional(),
    border_crop: z.string().url().optional(),
  })
  .partial();

export const scryfallCardSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    // Scryfall's layout enum ("normal" | "split" | "flip" | "transform" |
    // "saga" | "adventure" | …). Kept as a plain string so new layout values
    // never fail the parse — unknown layouts degrade to type-line mapping.
    layout: z.string().optional().nullable(),
    // Keyword list — needed to tell aftermath apart (Scryfall folds it into
    // layout "split" + keywords ["Aftermath"]).
    keywords: z.array(z.string()).optional().nullable(),
    mana_cost: z.string().optional().nullable(),
    type_line: z.string().optional().nullable(),
    oracle_text: z.string().optional().nullable(),
    flavor_text: z.string().optional().nullable(),
    power: z.string().optional().nullable(),
    toughness: z.string().optional().nullable(),
    loyalty: z.string().optional().nullable(),
    defense: z.string().optional().nullable(),
    rarity: z.string().optional().nullable(),
    colors: z.array(z.string()).optional().nullable(),
    color_identity: z.array(z.string()).optional().nullable(),
    set: z.string().optional().nullable(),
    set_name: z.string().optional().nullable(),
    artist: z.string().optional().nullable(),
    // "missing" | "placeholder" | "lowres" | "highres_scan" — kept as a
    // plain string so a future status value doesn't fail the whole parse.
    image_status: z.string().optional().nullable(),
    image_uris: scryfallImageUrisSchema.optional().nullable(),
    // Some cards (double-faced, split) carry image_uris under card_faces[0]
    // instead of the top level. We pull a best-effort image out of either.
    card_faces: z
      .array(
        z.object({
          name: z.string().optional(),
          mana_cost: z.string().optional().nullable(),
          oracle_text: z.string().optional().nullable(),
          type_line: z.string().optional().nullable(),
          power: z.string().optional().nullable(),
          toughness: z.string().optional().nullable(),
          // Faces DO carry these on real cards: loyalty on DFC planeswalker
          // backs (Origins walkers), defense on battle fronts (all printed
          // battles are transform DFCs), flavor_text per face.
          loyalty: z.string().optional().nullable(),
          defense: z.string().optional().nullable(),
          flavor_text: z.string().optional().nullable(),
          image_uris: scryfallImageUrisSchema.optional().nullable(),
        }),
      )
      .optional()
      .nullable(),
    scryfall_uri: z.string().url().optional().nullable(),
  })
  .passthrough();

export type ScryfallCard = z.infer<typeof scryfallCardSchema>;

export const scryfallSearchResponseSchema = z.object({
  object: z.literal("list"),
  total_cards: z.number().optional(),
  has_more: z.boolean().optional(),
  next_page: z.string().url().optional(),
  data: z.array(scryfallCardSchema),
});

export type ScryfallSearchResponse = z.infer<typeof scryfallSearchResponseSchema>;

// ---------------------------------------------------------------------------
// Public helpers — these are what API routes call.
// ---------------------------------------------------------------------------

export type ScryfallSearchOptions = {
  query: string;
  /** How many cards to return. Scryfall pages in chunks of 175; we trim. */
  limit?: number;
};

/**
 * Search Scryfall by free-form query. Returns trimmed card objects suitable
 * for typeahead. Errors (network, parse, 404 no-results) resolve to an
 * empty list rather than throwing — the caller decides whether to surface
 * "no matches" or a generic error.
 */
export async function searchCards({
  query,
  limit = 12,
}: ScryfallSearchOptions): Promise<ScryfallCard[]> {
  const q = query.trim();
  if (!q) return [];

  const url = `/cards/search?${new URLSearchParams({
    q,
    unique: "cards",
    order: "name",
  })}`;

  const response = await scryfallFetch(url);
  if (!response.ok) {
    // 404 = no matches. Anything else (429/500/etc.) we treat as a soft
    // empty so the UI stays calm; the route handler still surfaces the
    // status code in its own response.
    return [];
  }

  let parsed: ScryfallSearchResponse;
  try {
    const body: unknown = await response.json();
    parsed = scryfallSearchResponseSchema.parse(body);
  } catch {
    return [];
  }

  return parsed.data.slice(0, Math.max(1, Math.min(limit, 50)));
}

export type ScryfallNamedLookup =
  | { exact: string }
  | { fuzzy: string };

/**
 * Look up a single card by name (exact or fuzzy). Returns null on any error
 * — the caller decides between "card not found" UI vs an error toast.
 */
export async function getCardByName(
  lookup: ScryfallNamedLookup,
): Promise<ScryfallCard | null> {
  const params = new URLSearchParams();
  if ("exact" in lookup) {
    if (!lookup.exact.trim()) return null;
    params.set("exact", lookup.exact.trim());
  } else {
    if (!lookup.fuzzy.trim()) return null;
    params.set("fuzzy", lookup.fuzzy.trim());
  }

  const response = await scryfallFetch(`/cards/named?${params}`);
  if (!response.ok) return null;
  try {
    const body: unknown = await response.json();
    return scryfallCardSchema.parse(body);
  } catch {
    return null;
  }
}

/**
 * Fetch a single card by Scryfall id. Used by the import-art route so we
 * can recover a trusted image URL from a server-side lookup instead of
 * trusting whatever URL the client posts.
 */
export async function getCardById(id: string): Promise<ScryfallCard | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  // Scryfall ids are UUIDs. Fail fast on anything else so we don't issue
  // garbage requests against their API.
  if (!/^[0-9a-f-]{8,}$/i.test(trimmed)) return null;

  const response = await scryfallFetch(
    `/cards/${encodeURIComponent(trimmed)}`,
  );
  if (!response.ok) return null;
  try {
    const body: unknown = await response.json();
    return scryfallCardSchema.parse(body);
  } catch {
    return null;
  }
}

/**
 * Server-side download of a Scryfall image. Restricts the host so an
 * attacker can't trick us into fetching arbitrary URLs (SSRF guard).
 * Returns a Blob the caller can upload to Storage.
 */
export async function fetchScryfallImage(
  imageUrl: string,
): Promise<{ blob: Blob; contentType: string } | null> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return null;
  }
  // Scryfall serves card images from cards.scryfall.io (their CDN). Lock
  // the host so the route can't be coerced into fetching anywhere else.
  if (
    parsed.hostname !== "cards.scryfall.io" &&
    parsed.hostname !== "api.scryfall.com"
  ) {
    return null;
  }
  // cards.scryfall.io is Scryfall's CDN and explicitly has no rate limit;
  // only api.scryfall.com requests need to respect the request gap.
  if (parsed.hostname === "api.scryfall.com") {
    await throttle(FAST_GAP_MS);
  }
  const response = await fetch(parsed.toString(), {
    headers: { "User-Agent": userAgent() },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "";
  // Only accept actual image responses — guard against a redirect to an
  // HTML error page or similar.
  if (!contentType.startsWith("image/")) return null;
  const blob = await response.blob();
  return { blob, contentType };
}

/**
 * Pick the best image URL for our use. We prefer the high-res `png` (a
 * uniform 745x1040), fall back to `large` (672x936), and finally `normal`.
 * For double-faced cards Scryfall puts image_uris on `card_faces[0]`
 * instead of the top level.
 */
export function pickPrintImageUrl(card: ScryfallCard): string | null {
  const top = card.image_uris ?? null;
  const face = card.card_faces?.[0]?.image_uris ?? null;
  const source = top ?? face;
  if (!source) return null;
  return source.png ?? source.large ?? source.normal ?? source.border_crop ?? null;
}

/** Same logic, but picks the art-only crop for the preview thumbnail. */
export function pickArtCropUrl(card: ScryfallCard): string | null {
  const top = card.image_uris ?? null;
  const face = card.card_faces?.[0]?.image_uris ?? null;
  const source = top ?? face;
  return source?.art_crop ?? source?.normal ?? null;
}

// ---------------------------------------------------------------------------
// Image quality.
// ---------------------------------------------------------------------------

export type ScryfallImageQuality = "ok" | "lowres" | "unusable";

/**
 * Classify a printing's scan quality from Scryfall's `image_status`.
 * `image_status` lives at the top level only (one status per printing,
 * covering both faces of a DFC). An absent field is treated as ok so
 * older cached shapes never regress imports.
 */
export function assessPrintImageQuality(
  card: ScryfallCard,
): ScryfallImageQuality {
  if (card.image_status === "missing" || card.image_status === "placeholder") {
    return "unusable";
  }
  if (card.image_status === "lowres") return "lowres";
  return "ok";
}
