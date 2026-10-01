import "server-only";

import { z } from "zod";
import { getSiteBaseUrl } from "@/lib/site-url";
import { keepExtrasResult } from "@/lib/scryfall/search-scope";

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
// The chain is what makes concurrent callers queue: each throttle() call
// waits for the previous one to have dispatched before computing its own
// gap. The old version read lastDispatchAt synchronously, so N concurrent
// callers all saw the same stale value, computed the same wait, and fired
// together — a stampede the comment above promised never happened.
let chain: Promise<void> = Promise.resolve();
function throttle(gapMs: number): Promise<void> {
  const turn = chain.then(async () => {
    const wait = Math.max(0, lastDispatchAt + gapMs - Date.now());
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastDispatchAt = Date.now();
  });
  // A rejected turn must not poison the queue for the next caller.
  chain = turn.catch(() => {});
  return turn;
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

async function scryfallFetch(
  path: string,
  init?: {
    method?: "POST";
    body?: string;
    /** Seconds Next's data cache may serve this answer for. Only the set
     *  lookup (getScryfallSet) passes one; every card call stays uncached. */
    revalidate?: number;
  },
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    await throttle(minGapFor(path));
    const response = await fetch(`${BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      body: init?.body,
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent(),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      // Don't cache server-side — this is dynamic search content, and the
      // freshness signal we want comes from the user typing, not the CDN.
      // A set object (static: its size and parent never change) is the one
      // answer worth a day in the data cache.
      ...(init?.revalidate ? { next: { revalidate: init.revalidate } } : { cache: "no-store" }),
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

/** Scryfall sometimes serves image URLs from cards.bcdn.scryfall.io — a
 *  CNAME onto BunnyCDN (scryfall-cards.b-cdn.net). b-cdn.net sits on common
 *  ad-block / DNS-filter lists, so those images silently fail for users
 *  behind blockers while cards.scryfall.io ones load fine. The canonical
 *  host serves the identical paths — normalize every parsed image URL to it
 *  so the whole app (search thumbs, detail previews, art import) only ever
 *  emits the unblocked host. */
export function normalizeScryfallImageUrl(url: string): string {
  return url.replace("://cards.bcdn.scryfall.io/", "://cards.scryfall.io/");
}

const scryfallImageUrl = z
  .string()
  .url()
  .transform(normalizeScryfallImageUrl);

export const scryfallImageUrisSchema = z
  .object({
    small: scryfallImageUrl.optional(),
    normal: scryfallImageUrl.optional(),
    large: scryfallImageUrl.optional(),
    png: scryfallImageUrl.optional(),
    art_crop: scryfallImageUrl.optional(),
    border_crop: scryfallImageUrl.optional(),
  })
  .partial();

export const scryfallCardSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    // Stable across printings — the printings picker groups by it.
    oracle_id: z.string().optional().nullable(),
    released_at: z.string().optional().nullable(),
    // Scryfall's layout enum ("normal" | "split" | "flip" | "transform" |
    // "saga" | "adventure" | …). Kept as a plain string so new layout values
    // never fail the parse — unknown layouts degrade to type-line mapping.
    layout: z.string().optional().nullable(),
    // Keyword list — needed to tell aftermath apart (Scryfall folds it into
    // layout "split" + keywords ["Aftermath"]).
    keywords: z.array(z.string()).optional().nullable(),
    // Border generation of THIS printing ("1993" | "1997" | "2003" | "2015"
    // | "future") — drives era adoption on import. Plain string so a future
    // frame value never fails the parse.
    frame: z.string().optional().nullable(),
    // Frame treatments (snow, devoid, showcase, legendary, …) — snow/devoid
    // map onto our skin templates.
    frame_effects: z.array(z.string()).optional().nullable(),
    // Printing treatment flags. The import names the treatment it can't
    // reproduce yet (printingTreatmentFromScryfall, TODO 1.16); the
    // signature registry (1.4/1.17/1.19) will turn them into frames.
    // border_color is "black" | "white" | "borderless" | "yellow" |
    // "silver" | "gold", kept a plain string so a new value never fails
    // the parse. promo_types (boosterfun, poster, japanshowcase, …) is
    // typed for that registry; the stopgap doesn't key on it.
    border_color: z.string().optional().nullable(),
    full_art: z.boolean().optional().nullable(),
    textless: z.boolean().optional().nullable(),
    promo_types: z.array(z.string()).optional().nullable(),
    // The rest of the frame vocabulary (TODO 1.1), typed for the signature
    // registry (1.4/1.17/1.19) and the colour rule below. All plain strings
    // for the same reason as border_color: a new Scryfall value must never
    // fail the parse.
    // set_type: "expansion" | "core" | "masterpiece" (Expeditions) | "token"
    // | "funny" | … — the Expeditions signature keys on "masterpiece".
    set_type: z.string().optional().nullable(),
    // "oval" | "triangle" (Universes Beyond) | "acorn" | "arena" | "circle"
    // | "heart".
    security_stamp: z.string().optional().nullable(),
    // Colours printed as an indicator dot (Dryad Arbor, DFC back faces).
    color_indicator: z.array(z.string()).optional().nullable(),
    // Mana this card can produce ("W" … "G", "C"). Card-level: on a
    // multi-face card it covers every face.
    produced_mana: z.array(z.string()).optional().nullable(),
    // The printed watermark's name ("orzhov", "phyrexian", "set", …).
    watermark: z.string().optional().nullable(),
    // "nonfoil" | "foil" | "etched".
    finishes: z.array(z.string()).optional().nullable(),
    // The printed nickname above the Oracle name (Godzilla series, …).
    flavor_name: z.string().optional().nullable(),
    // Printing language ("en", "ja", "ph", …).
    lang: z.string().optional().nullable(),
    mana_cost: z.string().optional().nullable(),
    // Converted mana cost / mana value — denormalized onto deck entries.
    cmc: z.number().optional().nullable(),
    // Printing-specific collector number (a string: "237a", "XLN-117", "★").
    collector_number: z.string().optional().nullable(),
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
    // The face schema strips unknown keys, so every face field the importer
    // reads must be listed here.
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
          // Per-face colours (TODO 1.1/1.2). Transform, modal DFC, battle
          // and reversible faces carry their own `colors`, and Scryfall
          // leaves the card-level `colors` off; split, flip, adventure and
          // Room faces don't, and share the card-level colours instead.
          colors: z.array(z.string()).optional().nullable(),
          color_indicator: z.array(z.string()).optional().nullable(),
          artist: z.string().optional().nullable(),
          watermark: z.string().optional().nullable(),
          // Reversible cards give each face its own layout.
          layout: z.string().optional().nullable(),
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

/** A Scryfall SET object (/sets/:code) — what the collector-field import
 *  reads of it (TODO 4.9a): the parent a token / promo set prints the code
 *  of, and the size a 2015-era printing shows after its number. Plain
 *  strings and optional numbers so a new Scryfall value never fails the
 *  parse. */
export const scryfallSetSchema = z
  .object({
    code: z.string(),
    name: z.string().optional().nullable(),
    set_type: z.string().optional().nullable(),
    released_at: z.string().optional().nullable(),
    /** Every card Scryfall lists in the set (a token set's count). */
    card_count: z.number().optional().nullable(),
    /** The size the set PRINTS after a collector number ("107/281"); absent
     *  on sets that print none. */
    printed_size: z.number().optional().nullable(),
    /** The set a token / promo / memorabilia set belongs to ("dom" for
     *  tdom) — the code those printings print. */
    parent_set_code: z.string().optional().nullable(),
  })
  .passthrough();

export type ScryfallSet = z.infer<typeof scryfallSetSchema>;

// ---------------------------------------------------------------------------
// Public helpers — these are what API routes call.
// ---------------------------------------------------------------------------

export type ScryfallSearchOptions = {
  query: string;
  /** How many cards to return. Scryfall pages in chunks of 175; we trim. */
  limit?: number;
  /** Send Scryfall's `include_extras` (tokens, emblems, art cards …) and
   *  drop what PipGlyph can't import from the answer (keepExtrasResult)
   *  before the limit. TODO 1.23: only the import dialog's "Tokens &
   *  emblems" scope and the no-match fallback send it. */
  includeExtras?: boolean;
};

export type ScryfallSearchOutcome = {
  cards: ScryfallCard[];
  /** Scryfall answered "no matches" (its 404). The only answer the search
   *  route's extras fallback retries: an upstream failure (429, 5xx, a bad
   *  body) never spends a second request. */
  noMatches: boolean;
};

/**
 * Search Scryfall by free-form query, saying whether Scryfall found nothing
 * (TODO 1.23's fallback reads it). Errors (network aside, parse, 4xx/5xx)
 * resolve to an empty list rather than throwing.
 */
export async function searchCardsWithOutcome({
  query,
  limit = 12,
  includeExtras = false,
}: ScryfallSearchOptions): Promise<ScryfallSearchOutcome> {
  const q = query.trim();
  if (!q) return { cards: [], noMatches: false };

  const url = `/cards/search?${new URLSearchParams({
    q,
    unique: "cards",
    order: "name",
    ...(includeExtras ? { include_extras: "true" } : {}),
  })}`;

  const response = await scryfallFetch(url);
  if (!response.ok) {
    // 404 = no matches. Anything else (429/500/etc.) we treat as a soft
    // empty so the UI stays calm; the route handler still surfaces the
    // status code in its own response.
    return { cards: [], noMatches: response.status === 404 };
  }

  let parsed: ScryfallSearchResponse;
  try {
    const body: unknown = await response.json();
    parsed = scryfallSearchResponseSchema.parse(body);
  } catch {
    return { cards: [], noMatches: false };
  }

  const cards = includeExtras ? parsed.data.filter(keepExtrasResult) : parsed.data;
  return { cards: cards.slice(0, Math.max(1, Math.min(limit, 50))), noMatches: false };
}

/**
 * Search Scryfall by free-form query. Returns trimmed card objects suitable
 * for typeahead. Errors (network, parse, 404 no-results) resolve to an
 * empty list rather than throwing — the caller decides whether to surface
 * "no matches" or a generic error.
 */
export async function searchCards(options: ScryfallSearchOptions): Promise<ScryfallCard[]> {
  return (await searchCardsWithOutcome(options)).cards;
}

/**
 * Printings of an oracle card for the import dialog's printing picker.
 * One page (175) covers most cards; heavily reprinted staples and basics
 * run to hundreds, and the OLD printings — the ones that matter for frame
 * eras — live at the tail. So when page one (newest first) says has_more,
 * we spend one extra request on the OLDEST page and merge, giving the
 * picker both ends of the card's history. Same soft-empty error posture
 * as searchCards. `totalCards` is Scryfall's count of every printing (the
 * dialog's "30 of 916"), not the length of `cards`.
 */
export async function getCardPrintings(
  oracleId: string,
): Promise<{ cards: ScryfallCard[]; totalCards: number }> {
  const id = oracleId.trim();
  if (!id) return { cards: [], totalCards: 0 };

  const fetchPage = async (dir: "desc" | "asc") => {
    const url = `/cards/search?${new URLSearchParams({
      q: `oracleid:${id}`,
      unique: "prints",
      order: "released",
      dir,
    })}`;
    const response = await scryfallFetch(url);
    if (!response.ok) return null;
    try {
      const body: unknown = await response.json();
      return scryfallSearchResponseSchema.parse(body);
    } catch {
      return null;
    }
  };

  const newest = await fetchPage("desc");
  if (!newest) return { cards: [], totalCards: 0 };
  let cards = newest.data;
  if (newest.has_more) {
    const oldest = await fetchPage("asc");
    if (oldest) {
      const seen = new Set(cards.map((c) => c.id));
      cards = cards.concat(oldest.data.filter((c) => !seen.has(c.id)));
    }
  }
  return { cards, totalCards: newest.total_cards ?? cards.length };
}

/** One page of a printings search: the cards, whether a next page exists,
 *  and Scryfall's count for the whole query. */
export type ScryfallPrintingsPage = {
  cards: ScryfallCard[];
  hasMore: boolean;
  totalCards: number;
};

/**
 * One page (Scryfall's 175) of an oracle card's printings, newest first,
 * narrowed by a search qualifier (`q` built by printingsQuery in
 * lib/scryfall/printing-views.ts) — the import dialog's filter chips and
 * its "Load more" (TODO 1.5). ONE Scryfall search per call. A 404 is
 * Scryfall's "no matches": an empty page, not an error. Null when Scryfall
 * didn't answer (network, 429 past the retry budget, 5xx, a bad body).
 */
export async function searchPrintingsPage(
  q: string,
  page: number,
): Promise<ScryfallPrintingsPage | null> {
  const url = `/cards/search?${new URLSearchParams({
    q,
    unique: "prints",
    order: "released",
    dir: "desc",
    page: String(page),
  })}`;
  const response = await scryfallFetch(url);
  if (response.status === 404) return { cards: [], hasMore: false, totalCards: 0 };
  if (!response.ok) return null;
  try {
    const body: unknown = await response.json();
    const parsed = scryfallSearchResponseSchema.parse(body);
    return {
      cards: parsed.data,
      hasMore: parsed.has_more === true,
      totalCards: parsed.total_cards ?? parsed.data.length,
    };
  } catch {
    return null;
  }
}

export type ScryfallNamedLookup =
  | { exact: string }
  | { fuzzy: string };

/** Why a /cards/named lookup found no card (TODO 1.12):
 *   - "ambiguous"   — a fuzzy name matched several cards (Scryfall answers
 *                     404 with an error object whose `type` is "ambiguous");
 *   - "not_found"   — no card has that name (a plain 404);
 *   - "bad_request" — Scryfall refused the request (400), or the name was
 *                     empty, so no request was sent;
 *   - "upstream"    — anything else: a 429/5xx after the retries, a network
 *                     failure, or a body that doesn't parse. */
export type ScryfallNamedFailure = "not_found" | "ambiguous" | "bad_request" | "upstream";

export type ScryfallNamedResult =
  | { ok: true; card: ScryfallCard }
  | { ok: false; kind: ScryfallNamedFailure };

// Scryfall's error object (https://scryfall.com/docs/api/errors). Only
// `type` tells an ambiguous fuzzy name apart from a missing one: both are
// status 404 with code "not_found".
const scryfallErrorSchema = z
  .object({
    object: z.literal("error"),
    code: z.string().optional(),
    type: z.string().optional().nullable(),
  })
  .passthrough();

/**
 * Look up a single card by name (exact or fuzzy) and say why when there is
 * no card — the /api/scryfall/named route turns each failure into its own
 * message and status.
 */
export async function getCardByNameResult(
  lookup: ScryfallNamedLookup,
): Promise<ScryfallNamedResult> {
  const params = new URLSearchParams();
  if ("exact" in lookup) {
    if (!lookup.exact.trim()) return { ok: false, kind: "bad_request" };
    params.set("exact", lookup.exact.trim());
  } else {
    if (!lookup.fuzzy.trim()) return { ok: false, kind: "bad_request" };
    params.set("fuzzy", lookup.fuzzy.trim());
  }

  let response: Response;
  try {
    response = await scryfallFetch(`/cards/named?${params}`);
  } catch {
    return { ok: false, kind: "upstream" };
  }

  if (response.ok) {
    try {
      const body: unknown = await response.json();
      return { ok: true, card: scryfallCardSchema.parse(body) };
    } catch {
      return { ok: false, kind: "upstream" };
    }
  }
  if (response.status === 404) {
    let ambiguous = false;
    try {
      const error = scryfallErrorSchema.safeParse(await response.json());
      ambiguous = error.success && error.data.type === "ambiguous";
    } catch {
      // An unreadable 404 body is still "no such card".
    }
    return { ok: false, kind: ambiguous ? "ambiguous" : "not_found" };
  }
  if (response.status === 400) return { ok: false, kind: "bad_request" };
  return { ok: false, kind: "upstream" };
}

/**
 * Look up a single card by name (exact or fuzzy). Returns null on any error
 * — the caller decides between "card not found" UI vs an error toast. The
 * decklist importer (lib/decks/import.ts) uses this; the named route wants
 * the reason and calls getCardByNameResult.
 */
export async function getCardByName(
  lookup: ScryfallNamedLookup,
): Promise<ScryfallCard | null> {
  const result = await getCardByNameResult(lookup);
  return result.ok ? result.card : null;
}

// ---------------------------------------------------------------------------
// Batch collection lookup — the decklist importer's workhorse.
// ---------------------------------------------------------------------------

/** Identifier schemas accepted by POST /cards/collection (mixable). */
export type ScryfallCollectionIdentifier =
  | { name: string }
  | { name: string; set: string }
  | { set: string; collector_number: string }
  | { id: string };

const scryfallCollectionResponseSchema = z.object({
  object: z.literal("list"),
  not_found: z.array(z.record(z.string(), z.unknown())).default([]),
  data: z.array(scryfallCardSchema),
});

export type ScryfallCollectionResult = {
  cards: ScryfallCard[];
  /** The identifier objects Scryfall couldn't resolve, echoed back verbatim.
   *  Cards come back in request order but misses are silently dropped from
   *  `data` — reconcile by matching these, never by array position. */
  notFound: Array<Record<string, unknown>>;
};

/** Scryfall's documented per-request identifier cap. */
export const SCRYFALL_COLLECTION_MAX = 75;

/**
 * Batch-resolve up to 75 identifiers via POST /cards/collection. Returns
 * null on any transport/parse error (the caller decides how to degrade);
 * unresolved identifiers come back in `notFound`, not as an error.
 */
export async function getCardCollection(
  identifiers: ScryfallCollectionIdentifier[],
): Promise<ScryfallCollectionResult | null> {
  if (identifiers.length === 0) return { cards: [], notFound: [] };
  if (identifiers.length > SCRYFALL_COLLECTION_MAX) return null;

  const response = await scryfallFetch("/cards/collection", {
    method: "POST",
    body: JSON.stringify({ identifiers }),
  });
  if (!response.ok) return null;
  try {
    const body: unknown = await response.json();
    const parsed = scryfallCollectionResponseSchema.parse(body);
    return { cards: parsed.data, notFound: parsed.not_found };
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

// ---------------------------------------------------------------------------
// Sets (TODO 4.9a). The collector-field import needs a printing's SET object
// only sometimes — the parent code of a token / promo / memorabilia set, the
// printed size of a 2015-era printing (lib/scryfall/import-mapper.ts
// needsScryfallSet) — and a set never changes, so one answer serves every
// import of that set: Next's data cache keeps it for a day
// (`next: { revalidate: 86400 }`) and an in-process map answers repeats
// within the same instance without a request at all. Budget: at most ONE
// extra Scryfall call per import, none on a hit.
// ---------------------------------------------------------------------------

export const SCRYFALL_SET_CACHE_SECONDS = 86_400;

type ScryfallSetLookup =
  | { kind: "ok"; set: ScryfallSet }
  // Scryfall's 404: no such set. Definitive, cached like a hit.
  | { kind: "not_found"; set: null }
  // Network, 429 past the retry budget, 5xx, a bad body: not cached, so
  // the next import retries.
  | { kind: "upstream"; set: null };

const setCache = new Map<string, { at: number; value: Promise<ScryfallSet | null> }>();

async function fetchScryfallSet(code: string): Promise<ScryfallSetLookup> {
  let response: Response;
  try {
    response = await scryfallFetch(`/sets/${encodeURIComponent(code)}`, {
      revalidate: SCRYFALL_SET_CACHE_SECONDS,
    });
  } catch {
    return { kind: "upstream", set: null };
  }
  if (response.status === 404) return { kind: "not_found", set: null };
  if (!response.ok) return { kind: "upstream", set: null };
  try {
    const body: unknown = await response.json();
    return { kind: "ok", set: scryfallSetSchema.parse(body) };
  } catch {
    return { kind: "upstream", set: null };
  }
}

/**
 * A Scryfall set by its (lower-case) code, through the throttled client:
 * cached for a day, one request per set per instance. Null when Scryfall
 * has no such set or didn't answer — the import then fills no collector
 * fields rather than guessing a parent or a size.
 */
export async function getScryfallSet(code: string): Promise<ScryfallSet | null> {
  const key = code.trim().toLowerCase();
  // Scryfall set codes are short alphanumerics; refuse anything else before
  // it reaches the request path.
  if (!/^[a-z0-9]{2,10}$/.test(key)) return null;
  const now = Date.now();
  const hit = setCache.get(key);
  if (hit && now - hit.at < SCRYFALL_SET_CACHE_SECONDS * 1000) return hit.value;
  const value = fetchScryfallSet(key).then((result) => {
    if (result.kind === "upstream") {
      const current = setCache.get(key);
      if (current?.value === value) setCache.delete(key);
    }
    return result.set;
  });
  setCache.set(key, { at: now, value });
  return value;
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
  // only api.scryfall.com requests need to respect the request gap — at the
  // path's own tier, in case a caller ever passes a named/search-based
  // image URL (those are hard-capped at 2/s).
  if (parsed.hostname === "api.scryfall.com") {
    await throttle(minGapFor(parsed.pathname));
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

/**
 * True when the printing's SECOND face has its own image (TODO 1.8) — a
 * transform, modal DFC, battle or reversible card, where Scryfall puts
 * `image_uris` on each face. Split, aftermath, flip, adventure and Room cards
 * are one image with two faces of text: their faces carry no `image_uris`,
 * so there is no back-face art to import (an "art-back" request would spend
 * a lookup on a 404).
 */
export function hasBackFaceImage(card: ScryfallCard): boolean {
  const uris = card.card_faces?.[1]?.image_uris;
  return Boolean(uris && Object.values(uris).some(Boolean));
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
