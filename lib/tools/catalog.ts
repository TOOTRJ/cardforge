// ---------------------------------------------------------------------------
// The beta tools catalog (migration 0182, owner request 2026-11-06) — every
// tool that goes through the beta → release path is declared HERE, once:
// its slug (the key in tool_releases / tool_access_grants / tool_interest /
// tool_events), its words, its page and whether it is built yet.
//
// Who may open a tool is NOT here: that is the database's (an admin
// releases a tool to a plan, or lets testers in, at /admin/tools — no
// deploy) and ONE rule reads it, `resolveToolAccess` (lib/tools/access.ts)
// mirrored by SQL `has_tool_access(slug)`.
//
// Adding a tool:
//   1. an entry below (`built: false` shows it as "Coming soon" on the
//      Tools hub, and an admin can already enrol testers);
//   2. its page under app/(app)/dashboard/tools/<slug>/ that starts with
//      `await openTool("<slug>")` (lib/tools/queries.ts: the access check +
//      the `open` event) and draws inside `ToolShell`;
//   3. its own tables, if any, gate their RLS with
//      `public.has_tool_access('<slug>')`;
//   4. its server actions call `checkToolAccess` first and record what
//      matters with `recordToolEvent` (lib/tools/events.ts);
//   5. flip `built: true` — admins and testers see it at once; release it
//      to a plan from /admin/tools when it is ready.
//
// Client-safe: plain data, no server imports.
// ---------------------------------------------------------------------------

export type ToolIconKey =
  | "collection"
  | "tokens"
  | "pip"
  | "set-symbol"
  | "customize"
  | "play"
  | "table-sheet"
  | "reart"
  | "symbol";

export type ToolDefinition = {
  /** Stable key — never rename (rows in four tables carry it). */
  slug: string;
  name: string;
  /** One line under the name: what the tool does for you. */
  tagline: string;
  /** Two or three sentences for the tool's card and its admin page. */
  description: string;
  /** What it will do, as short bullets (the coming-soon card's list). */
  highlights: readonly string[];
  icon: ToolIconKey;
  /** False = not built yet: a "Coming soon" card for everyone; admins can
   *  enrol testers, nobody can open it, and it cannot be released. */
  built: boolean;
};

export const TOOL_CATALOG = [
  {
    slug: "collection-builder",
    name: "Collection Deck Builder",
    tagline: "Find the Commander decks your collection can already build.",
    description:
      "Bring in your collection from a CSV or card by card, then see which community decks you can build today, which ones you're a few cards away from, and let AI build a Commander deck from what you own.",
    highlights: [
      "Import a CSV from ManaBox, Moxfield, Archidekt and more",
      "Decks you can build now, and the ones you're closest to",
      "An AI-built Commander deck from cards you own",
    ],
    icon: "collection",
    built: true,
  },
  {
    slug: "token-kit",
    name: "Token Kit",
    tagline: "Paste a decklist and print every token it makes.",
    description:
      "Paste a decklist and get every token, emblem and helper card it needs, styled your way on PipGlyph's token frames, then download sheets ready to print.",
    highlights: [
      "Finds the tokens, emblems and helper cards a deck makes",
      "Your art and frame style on every token",
      "Print-ready sheets with bleed, or an MPC file",
    ],
    icon: "tokens",
    built: true,
  },
  {
    slug: "bulk-customize",
    name: "Bulk Customize",
    tagline: "Turn a stack of real cards into your own versions in one go.",
    description:
      "Tick real cards in a deck, your collection or a search and customize them together: one frame, border, set symbol and watermark for all of them, with each card's own art, room for yours later, or new AI art in one style. You see what it costs before anything is made.",
    highlights: [
      "One look for every card: frame, border, set symbol, watermark",
      "Keep each card's art, add your own later, or AI art in one style",
      "The cost up front: cards, slots left and credits",
    ],
    icon: "customize",
    built: true,
  },
  {
    slug: "re-art-deck",
    name: "Re-art deck",
    tagline: "Give every card of a deck new art in one shared style.",
    description:
      "Pick one of your decks and define its look once: a style and a few words about its world. Try it on a few cards first, then paint the whole deck in that style. Real cards become your own versions with the new art, your own cards get new art on them, and any card can be re-rolled or given its old art back.",
    highlights: [
      "One style for the whole deck, kept the same on every card",
      "Try it on three cards before you paint the deck",
      "Re-roll any card, or put its old art back",
    ],
    icon: "reart",
    built: true,
  },
  {
    slug: "pip-forge",
    name: "Pip Forge",
    tagline: "Describe a symbol and get a crisp custom mana pip.",
    description:
      "Describe a symbol and AI draws a mana pip that stays sharp at card size, along with the colour it could stand for: what that colour values and which mechanics it owns. Every pip is saved to your account.",
    highlights: [
      "Pips that stay sharp at card size",
      "A colour identity with its values and mechanics",
      "Saved to your account, ready for any card",
    ],
    icon: "pip",
    built: true,
  },
  {
    slug: "custom-symbols",
    name: "New mana symbols",
    tagline: "Invent mana symbols beyond the six, written {*CODE} on your cards.",
    description:
      "Make up to 20 mana symbols of your own: a picture, a short code you write as {*CODE} in a cost or rules text, a mana value and a colour. Your cards draw your symbols for everyone who sees them, and a removed symbol stays on the cards that use it.",
    highlights: [
      "Your own symbols beside W, U, B, R, G and C",
      "A mana value and a colour you choose for each one",
      "Upload a picture, or use a pip from Pip Forge",
    ],
    icon: "symbol",
    built: true,
  },
  {
    slug: "set-symbol-studio",
    name: "Set Symbol Studio",
    tagline: "AI set icons and watermarks, coloured for every rarity.",
    description:
      "Generate a set icon and a matching watermark, or bring your own image and remove its background. One symbol is coloured for common, uncommon, rare and mythic automatically.",
    highlights: [
      "Set icons and watermarks from a prompt",
      "Background removal for your own images",
      "Common, uncommon, rare and mythic colours from one symbol",
    ],
    icon: "set-symbol",
    built: true,
  },
  {
    slug: "play-exports",
    name: "Play Exports",
    tagline: "Playtest your cards in Cockatrice, Draftmancer or Tabletop Simulator.",
    description:
      "Turn a deck or a pick of your cards into the files Cockatrice, Draftmancer and Tabletop Simulator load: your custom cards with their text and pictures, and real cards by name so each app plays them from its own database.",
    highlights: [
      "Cockatrice: a custom set with pictures and a matching deck file",
      "Draftmancer: a custom card list for drafting your cards",
      "Tabletop Simulator: a deck you drop into a game",
    ],
    icon: "play",
    built: true,
  },
  {
    slug: "rule0-sheet",
    name: "Rule 0 Table Sheet",
    tagline: "One page that tells the table what your deck is before you shuffle up.",
    description:
      "Turn any of your decks into a one-page summary for the pre-game talk: its bracket beside a Game Changers check, your game plan and win conditions, and every custom card and proxy named. Show it on screen, print it, or share the link and QR code.",
    highlights: [
      "Your bracket beside a Game Changers check",
      "Every custom card and proxy, named and linked",
      "Print it on one page, or share a link and QR code",
    ],
    icon: "table-sheet",
    built: true,
  },
] as const satisfies readonly ToolDefinition[];

export type ToolSlug = (typeof TOOL_CATALOG)[number]["slug"];

const BY_SLUG: ReadonlyMap<string, ToolDefinition> = new Map(
  TOOL_CATALOG.map((tool) => [tool.slug, tool]),
);

export function isToolSlug(value: unknown): value is ToolSlug {
  return typeof value === "string" && BY_SLUG.has(value);
}

export function toolBySlug(slug: string): ToolDefinition | null {
  return BY_SLUG.get(slug) ?? null;
}

/** The tool's own page (every tool lives under the Tools hub). */
export function toolHref(slug: string): string {
  return `/dashboard/tools/${slug}`;
}

/** The admin page for one tool. */
export function adminToolHref(slug: string): string {
  return `/admin/tools/${slug}`;
}

/** An event name a tool may record (tool_events.event's CHECK). */
export const TOOL_EVENT_RE = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * The events a tool's BROWSER may record (lib/tools/track-client.ts
 * trackToolEvent → POST /api/tools/usage → lib/tools/client-events.ts): the
 * moments no server code of the tool sees — a link copied, a file the
 * browser built and saved, a run its own runner finished, an answer that
 * never arrived. Everything else is recorded by the server where it
 * happens. A name that is not listed is dropped: the route is callable by
 * any signed-in tester, and an open door let one write whatever "uses" it
 * liked into the tool's numbers. Never `open` (the page records its own
 * visit) and never a server action's event name. What a browser reports is
 * still only what it says: its `credits` is stored as `credits_seen`
 * (lib/tools/client-events.ts) — a tool's cost is the credit ledger's.
 */
export const TOOL_CLIENT_EVENTS: Readonly<Record<ToolSlug, readonly string[]>> = {
  "collection-builder": ["import_stopped", "import_resumed", "restore_draft"],
  "token-kit": [
    "kit_exported",
    "kit_export_done",
    "kit_export_failed",
    "art_uploaded",
    "art_upload_failed",
    "ai_art_done",
    "ai_art_failed",
  ],
  "bulk-customize": ["run_finished"],
  "re-art-deck": ["run_finished", "stop", "continue", "retry"],
  "pip-forge": [],
  "custom-symbols": [],
  "set-symbol-studio": ["open_png"],
  "play-exports": ["dialog_opened", "export_saved", "export_build_failed", "export_cancelled"],
  "rule0-sheet": ["copy_link", "print", "ai_draft_lost"],
};

/** Whether `event` is one `slug`'s browser may record. */
export function isToolClientEvent(slug: string, event: string): boolean {
  return isToolSlug(slug) && TOOL_CLIENT_EVENTS[slug].includes(event);
}

/**
 * The events that are a USE of a tool: it did one of its jobs for someone
 * (a kit built, a deck drafted, a symbol made, a file exported). What the
 * admin pages count as "uses" and "using users" — handed to the readers as
 * their `p_uses` (migration 0199), never restated in SQL, and read at query
 * time, so a corrected list re-reads every stored row.
 *
 * NOT a use, by rule: the page's `open`; a refusal or failure
 * (`toolEventIsFailure`); a step on the way (`plan`, `prepare`,
 * `dialog_opened`, `import_started`); how something ended when its start is
 * already the use (`run_finished`, `kit_export_done`, `export_saved`);
 * housekeeping (`rename`, `delete`, `remove`, `clear`); and a visitor's
 * `shared_view` (an audience number, not the owner's use). A new success
 * event is added here in the same change, or it counts as nothing.
 */
export const TOOL_USE_EVENTS: Readonly<Record<ToolSlug, readonly string[]>> = {
  "collection-builder": ["import", "add_card", "draft", "ai_build", "ai_suggest", "save_deck", "buildable_decks"],
  "token-kit": ["kit_built", "token_saved", "kit_exported", "ai_art", "art_uploaded"],
  "bulk-customize": ["start", "customize_one"],
  "re-art-deck": ["start", "start_sample", "reroll", "paint_one"],
  "pip-forge": ["forge", "recolour", "use_as_pip"],
  "custom-symbols": ["create", "edit", "replace_picture"],
  "set-symbol-studio": ["generate", "upload", "recut", "open_png"],
  "play-exports": ["export"],
  "rule0-sheet": ["save", "share_on", "ai_draft", "copy_link", "print"],
};

/**
 * An action's or a step's error CODE as an event's `reason`: lower case, and
 * the card limit `capacity` in every tool. One vocabulary across the tools,
 * so a reader can add a reason up: `invalid` (a body or input that can't be
 * read), `ai_unavailable`, `rate_limited`, `daily_limit`, `capacity`,
 * `insufficient_credits`, an AI failure kind (lib/ai/failure.ts) — never a
 * tool's own word for the same thing.
 */
export function toolReasonOfCode(code: string): string {
  const reason = code.toLowerCase();
  return reason === "card_capacity" ? "capacity" : reason;
}

/** A refusal or a failure: `<name>_failed`, `_refused` or `_lost`. */
export function toolEventIsFailure(event: string): boolean {
  return /_(failed|refused|lost)$/.test(event);
}

export type ToolEventKind = "open" | "use" | "failure" | "other";

/** What an event is, for a reader: the visit, a use, a failure, or
 *  anything else (a step, an ending, housekeeping). */
export function toolEventKind(slug: string, event: string): ToolEventKind {
  if (event === "open") return "open";
  if (toolEventIsFailure(event)) return "failure";
  return isToolSlug(slug) && TOOL_USE_EVENTS[slug].includes(event) ? "use" : "other";
}
