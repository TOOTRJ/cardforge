import type { DeckCardEntry, DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// Format legality checks — soft, non-blocking warnings (PipGlyph is a custom
// card app, not a tournament judge). Pure + unit-tested.
//
// Rules per format (docs/DECKS_PLAN.md research):
//   Commander / Brawl        exactly 100 incl. commander, singleton
//   Standard Brawl           exactly 60 incl. commander, singleton
//   Oathbreaker              exactly 60 (planeswalker + signature + 58), singleton
//   Standard…Pauper/Vintage  60+ main, ≤4 copies across main+side, side ≤15
//   Limited                  40+ main, no copy limit
//   Casual                   anything goes
// Basic lands are exempt from every copy limit, as are the "a deck can have
// any number of cards named …" cards (fixed-count variants get their own cap).
// ---------------------------------------------------------------------------

export type DeckWarning = {
  code:
    | "deck_size"
    | "copy_limit"
    | "sideboard_size"
    | "commander_count"
    | "companion_count";
  message: string;
};

const BASIC_LAND_NAMES = new Set(
  [
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
    "Wastes",
    "Snow-Covered Plains",
    "Snow-Covered Island",
    "Snow-Covered Swamp",
    "Snow-Covered Mountain",
    "Snow-Covered Forest",
    "Snow-Covered Wastes",
  ].map((n) => n.toLowerCase()),
);

// "A deck can have any number of cards named …" (null = truly unlimited),
// plus the fixed-count variants.
const ANY_NUMBER_CARDS = new Map<string, number | null>(
  (
    [
      ["Relentless Rats", null],
      ["Rat Colony", null],
      ["Persistent Petitioners", null],
      ["Shadowborn Apostle", null],
      ["Dragon's Approach", null],
      ["Slime Against Humanity", null],
      ["Hare Apparent", null],
      ["Templar Knight", null],
      ["Cid, Timeless Artificer", null],
      ["Seven Dwarves", 7],
      ["Nazgûl", 9],
    ] as Array<[string, number | null]>
  ).map(([name, cap]) => [name.toLowerCase(), cap]),
);

export function isBasicLand(name: string): boolean {
  return BASIC_LAND_NAMES.has(name.trim().toLowerCase());
}

type FormatSpec = {
  /** Deck size across commander+companion+main (side excluded). */
  size: { exact?: number; min?: number };
  /** Max copies of one name across main+side (+commander). null = unlimited. */
  copyLimit: number | null;
  hasCommander: boolean;
  sideboardMax: number | null;
};

const FORMAT_SPECS: Record<DeckFormat, FormatSpec> = {
  commander: { size: { exact: 100 }, copyLimit: 1, hasCommander: true, sideboardMax: null },
  brawl: { size: { exact: 100 }, copyLimit: 1, hasCommander: true, sideboardMax: null },
  standard_brawl: { size: { exact: 60 }, copyLimit: 1, hasCommander: true, sideboardMax: null },
  oathbreaker: { size: { exact: 60 }, copyLimit: 1, hasCommander: true, sideboardMax: null },
  standard: { size: { min: 60 }, copyLimit: 4, hasCommander: false, sideboardMax: 15 },
  pioneer: { size: { min: 60 }, copyLimit: 4, hasCommander: false, sideboardMax: 15 },
  modern: { size: { min: 60 }, copyLimit: 4, hasCommander: false, sideboardMax: 15 },
  legacy: { size: { min: 60 }, copyLimit: 4, hasCommander: false, sideboardMax: 15 },
  vintage: { size: { min: 60 }, copyLimit: 4, hasCommander: false, sideboardMax: 15 },
  pauper: { size: { min: 60 }, copyLimit: 4, hasCommander: false, sideboardMax: 15 },
  limited: { size: { min: 40 }, copyLimit: null, hasCommander: false, sideboardMax: null },
  casual: { size: {}, copyLimit: null, hasCommander: false, sideboardMax: null },
};

type Entry = Pick<DeckCardEntry, "name" | "board" | "quantity">;

export function validateDeck(
  format: DeckFormat,
  entries: Entry[],
): DeckWarning[] {
  const spec = FORMAT_SPECS[format];
  const warnings: DeckWarning[] = [];

  let deckSize = 0;
  let sideSize = 0;
  let commanderCount = 0;
  let companionCount = 0;
  const copiesByName = new Map<string, number>();

  for (const entry of entries) {
    if (entry.board === "maybe") continue;
    if (entry.board === "side") {
      sideSize += entry.quantity;
    } else {
      deckSize += entry.quantity;
    }
    if (entry.board === "commander") commanderCount += entry.quantity;
    if (entry.board === "companion") companionCount += entry.quantity;

    const key = entry.name.trim().toLowerCase();
    copiesByName.set(key, (copiesByName.get(key) ?? 0) + entry.quantity);
  }

  // Companions live outside the deck proper in every format that has them.
  const countedSize = deckSize - companionCount;

  if (spec.size.exact !== undefined && countedSize !== spec.size.exact) {
    warnings.push({
      code: "deck_size",
      message: `${formatLabel(format)} decks are exactly ${spec.size.exact} cards including the commander — this one has ${countedSize}.`,
    });
  } else if (spec.size.min !== undefined && countedSize < spec.size.min) {
    warnings.push({
      code: "deck_size",
      message: `${formatLabel(format)} decks need at least ${spec.size.min} cards — this one has ${countedSize}.`,
    });
  }

  if (spec.copyLimit !== null) {
    for (const [key, copies] of copiesByName) {
      if (isBasicLand(key)) continue;
      const anyNumberCap = ANY_NUMBER_CARDS.has(key)
        ? ANY_NUMBER_CARDS.get(key)
        : undefined;
      // undefined = normal card; null = unlimited; number = its own cap.
      const limit =
        anyNumberCap === undefined
          ? spec.copyLimit
          : anyNumberCap === null
            ? null
            : anyNumberCap;
      if (limit !== null && copies > limit) {
        warnings.push({
          code: "copy_limit",
          message:
            limit === 1
              ? `“${titleCase(key)}” appears ${copies}× — ${formatLabel(format)} is singleton (basics excepted).`
              : `“${titleCase(key)}” appears ${copies}× — the limit is ${limit} copies across mainboard and sideboard.`,
        });
      }
    }
  }

  if (spec.sideboardMax !== null && sideSize > spec.sideboardMax) {
    warnings.push({
      code: "sideboard_size",
      message: `Sideboards are capped at ${spec.sideboardMax} cards — this one has ${sideSize}.`,
    });
  }

  if (spec.hasCommander) {
    if (commanderCount === 0) {
      warnings.push({
        code: "commander_count",
        message: `No commander set — add one to the Commander zone.`,
      });
    } else if (commanderCount > 2) {
      warnings.push({
        code: "commander_count",
        message: `${commanderCount} commanders — at most 2 (partners) are allowed.`,
      });
    }
  } else if (commanderCount > 0 && format !== "casual") {
    warnings.push({
      code: "commander_count",
      message: `${formatLabel(format)} doesn't use a commander zone.`,
    });
  }

  if (companionCount > 1) {
    warnings.push({
      code: "companion_count",
      message: `Only one companion is allowed — this deck has ${companionCount}.`,
    });
  }

  return warnings;
}

function formatLabel(format: DeckFormat): string {
  switch (format) {
    case "standard_brawl":
      return "Standard Brawl";
    case "oathbreaker":
      return "Oathbreaker";
    default:
      return format.charAt(0).toUpperCase() + format.slice(1);
  }
}

function titleCase(lower: string): string {
  return lower.replace(/(^|\s|-)\p{L}/gu, (c) => c.toUpperCase());
}
