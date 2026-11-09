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

export type ToolIconKey = "collection" | "tokens" | "pip" | "set-symbol" | "customize";

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
