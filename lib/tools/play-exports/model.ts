// ---------------------------------------------------------------------------
// Play-surface exports (the `play-exports` beta tool) — the ONE shape every
// exporter reads: a deck or a selection of cards as a play client needs it.
// Built on the server from the rows the VIEWER may read
// (lib/tools/play-exports/collect.ts); written into each client's own file by
// the pure exporters beside this module (cockatrice.ts, draftmancer.ts,
// tts.ts). Pure, client-safe.
//
// Two kinds of card:
//   custom  a PipGlyph card the viewer may read that is NOT an unchanged
//           import of the entry's own printing (lib/decks/entry-status.ts:
//           edited, remix, original) — written out as a custom card, with
//           its text faces (lib/cards/card-text-faces.ts) and its STORED
//           display bake as its picture;
//   real    a printing, an unchanged import, a pasted name — written by NAME
//           so the client plays it from its own card database.
// Hidden entries (a private card the viewer can't read, a deleted card)
// are LEFT OUT and counted; the maybeboard never travels (a scratchpad).
// ---------------------------------------------------------------------------

export const PLAY_TARGETS = ["cockatrice", "draftmancer", "tts"] as const;
export type PlayTarget = (typeof PLAY_TARGETS)[number];

export function isPlayTarget(value: unknown): value is PlayTarget {
  return typeof value === "string" && (PLAY_TARGETS as readonly string[]).includes(value);
}

export const PLAY_TARGET_LABELS: Record<PlayTarget, string> = {
  cockatrice: "Cockatrice",
  draftmancer: "Draftmancer",
  tts: "Tabletop Simulator",
};

/** The boards a play file holds, in the order the files list them. */
export const PLAY_BOARDS = ["commander", "companion", "main", "side"] as const;
export type PlayBoard = (typeof PLAY_BOARDS)[number];

/** The most cards one selection exports (the deck export's cap). */
export const MAX_PLAY_SELECTION = 150;

export type ColorLetter = "W" | "U" | "B" | "R" | "G";
export const COLOR_LETTERS: readonly ColorLetter[] = ["W", "U", "B", "R", "G"];

export type PlayRarity = "common" | "uncommon" | "rare" | "mythic";

/** One face of a custom card as text — what its picture prints. */
export type PlayFace = {
  name: string;
  /** "{2}{R}{G}" as stored; null = no cost. */
  cost: string | null;
  typeLine: string;
  rulesText: string | null;
  flavorText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  /** WUBRG letters in WUBRG order; empty = colourless. */
  colors: ColorLetter[];
  /** The face's stored display bake, absolute: the HD PNG (1500 × 2100,
   *  watermarked as every display surface is). Null = the card has no
   *  stored bake to share (a private card, a bake still pending). */
  image: string | null;
  /** The bake's 600 px WebP thumbnail, absolute; null as `image`, or a
   *  bake older than thumbnails. */
  thumb: string | null;
};

/**
 * How the card's faces are laid out:
 *   normal     one face;
 *   transform  / modal  a double-faced card with a back BODY (two pictures);
 *   split      a two-part card that is ONE picture (split, aftermath,
 *              adventure, flip, Prepare): `secondPart` is text only.
 */
export type PlayLayout = "normal" | "transform" | "modal" | "split";

export type PlayCustomCard = {
  /** The PipGlyph card id. */
  id: string;
  /** The name the files call it by — the front's title, made unique within
   *  the export and apart from the real card it stands in for
   *  (exportNameFor). A two-faced card's file name for the pair is
   *  `${front} // ${back}` where the client wants one. */
  name: string;
  layout: PlayLayout;
  front: PlayFace;
  /** The back face (layout transform / modal). */
  back: PlayFace | null;
  /** The second part of a one-picture two-part card (layout split). */
  secondPart: PlayFace | null;
  rarity: PlayRarity;
  manaValue: number;
  isToken: boolean;
  /** A private card: it has no shared picture by rule (a card in view with
   *  no picture is one whose bake is still pending). */
  isPrivate: boolean;
  /** The card's page on PipGlyph (public or unlisted); null for a private card. */
  pageUrl: string | null;
};

export type PlayLine =
  | { kind: "custom"; board: PlayBoard; quantity: number; cardId: string }
  | {
      kind: "real";
      board: PlayBoard;
      quantity: number;
      /** The real card's name ("Fire // Ice" whole). */
      name: string;
      setCode: string | null;
      collectorNumber: string | null;
      /** The printing's Scryfall picture ("normal"), when the entry has one
       *  we draw — for a client with no card database of its own (TTS). */
      image: string | null;
    };

export type PlayExport = {
  /** The deck's title, or "My cards" for a selection. */
  title: string;
  /** A file-name stem ("goblin-tribal"). */
  fileStem: string;
  source: "deck" | "cards";
  /** Every custom card once, in first-appearance order. */
  cards: PlayCustomCard[];
  /** The deck's lines, in board order then list order. */
  lines: PlayLine[];
  leftOut: {
    /** Entries hidden from this viewer (a private card) or gone. */
    hidden: number;
    /** Maybeboard entries (never exported). */
    maybeboard: number;
  };
  /** Absolute URL of PipGlyph's own card back (TTS needs one). */
  cardBackUrl: string;
};

/** True when the card has every picture a URL-fetching client (TTS,
 *  Draftmancer) needs: the front's, and a two-faced card's back. */
export function hasSharedPictures(card: PlayCustomCard): boolean {
  if (!card.front.image) return false;
  return card.back ? Boolean(card.back.image) : true;
}

/** "Fire // Ice": a two-part card's full name, for the clients that file
 *  both parts under one name. */
export function fullNameOf(card: PlayCustomCard): string {
  const other = card.back ?? card.secondPart;
  return other ? `${card.front.name} // ${other.name}` : card.front.name;
}

/** The number of physical cards the export's lines hold. */
export function lineCount(lines: readonly PlayLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/** WUBRG letters of a cost (hybrid and Phyrexian symbols count every colour
 *  they name), in WUBRG order. */
export function costColors(cost: string | null | undefined): ColorLetter[] {
  const found = new Set<ColorLetter>();
  for (const match of (cost ?? "").matchAll(/\{([^}]*)\}/g)) {
    for (const ch of match[1].toUpperCase()) {
      if ((COLOR_LETTERS as readonly string[]).includes(ch)) found.add(ch as ColorLetter);
    }
  }
  return COLOR_LETTERS.filter((letter) => found.has(letter));
}

/** A file-name stem: lower case, ASCII letters, digits and dashes. */
export function fileStemOf(title: string, fallback = "pipglyph-export"): string {
  const stem = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return stem || fallback;
}

/** A name a file may use for a custom card: trimmed, inner whitespace one
 *  space, no control characters; "Untitled card" when empty. */
export function cleanCardName(name: string | null | undefined): string {
  const clean = (name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean || "Untitled card";
}

/**
 * The name a custom card is exported under. The clients key cards by NAME,
 * so a custom card may not share one with a real card the export also plays
 * by name, with the real card it stands in for (an edited import keeps
 * "Lightning Bolt" — Cockatrice would merge it into the real Bolt and play
 * Oracle's text), or with another custom card: such a name gains
 * " (PipGlyph)", then a number.
 */
export function exportNameFor(name: string, taken: Set<string>, standsInFor: string | null): string {
  const base = cleanCardName(name);
  const clash = (candidate: string) =>
    taken.has(candidate.toLowerCase()) || (standsInFor != null && candidate.toLowerCase() === standsInFor.toLowerCase());
  let candidate = base;
  if (clash(candidate)) candidate = `${base} (PipGlyph)`;
  for (let n = 2; clash(candidate); n += 1) candidate = `${base} (PipGlyph ${n})`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
