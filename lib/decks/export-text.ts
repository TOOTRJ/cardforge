import type { DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// Decklist text export — the reciprocal of parse-decklist.ts. Two styles:
//
//   "arena" — Arena-compatible headers (About/Name, Deck, Sideboard,
//             Commander, Companion) with (SET) collector-number when known.
//   "plain" — MTGO-style bare `qty Name` lines, blank line before the
//             sideboard. Maximum compatibility.
//
// Pure + unit-tested; the deck page precomputes both variants server-side
// for its free "Copy decklist" button (owner and visitors alike). The page
// passes `useProxyNames`: an entry with a real card keeps the real name and
// printing (the copied list must paste back into Arena or an import); an
// entry with no real card takes its custom card's title where the viewer can
// read it, the entry's own name otherwise (a private card the viewer can't
// read is null in their rows, so it never leaks its title). A line that
// swaps in a custom title drops the printing.
// ---------------------------------------------------------------------------

export type ExportEntry = {
  name: string;
  quantity: number;
  board: DeckBoard;
  set_code: string | null;
  collector_number: string | null;
  /** The linked custom card's title, when remixed. */
  proxyTitle?: string | null;
};

export type DeckTextStyle = "arena" | "plain";

const ARENA_SECTIONS: Array<{ board: DeckBoard; header: string }> = [
  { board: "commander", header: "Commander" },
  { board: "companion", header: "Companion" },
  { board: "main", header: "Deck" },
  { board: "side", header: "Sideboard" },
];

function lineFor(
  entry: ExportEntry,
  opts: { withPrinting: boolean; useProxyNames: boolean },
): string {
  const proxy = opts.useProxyNames ? (entry.proxyTitle?.trim() ?? "") : "";
  const name = proxy || entry.name;
  // The custom card is not the printing the entry was imported from.
  const renamed = proxy !== "" && proxy !== entry.name.trim();
  const printing =
    opts.withPrinting && !renamed && entry.set_code && entry.collector_number
      ? ` (${entry.set_code.toUpperCase()}) ${entry.collector_number}`
      : "";
  return `${entry.quantity} ${name}${printing}`;
}

/** Export entries from deck rows AS THE VIEWER READ THEM (`card` is null
 *  where RLS hid a private card). A copied list has to paste back into
 *  Arena, Moxfield or PipGlyph's own import, so an entry with a real card
 *  keeps the real card's name and printing even when it is linked to a
 *  custom version; only an entry with NO real card (a custom card of your
 *  own) takes the custom title the viewer's list shows, which also follows
 *  a rename the stored entry name doesn't. */
export function exportEntriesOf(
  items: ReadonlyArray<{
    entry: Omit<ExportEntry, "proxyTitle"> & { scryfall_id?: string | null };
    card: { title: string } | null;
  }>,
): ExportEntry[] {
  return items.map(({ entry, card }) => ({
    name: entry.name,
    quantity: entry.quantity,
    board: entry.board,
    set_code: entry.set_code,
    collector_number: entry.collector_number,
    proxyTitle: entry.scryfall_id ? null : (card?.title ?? null),
  }));
}

export function deckToText(
  deck: { title: string },
  entries: ExportEntry[],
  options: { style: DeckTextStyle; useProxyNames?: boolean },
): string {
  const { style, useProxyNames = false } = options;
  // Maybeboard is a scratchpad — never exported.
  const exportable = entries.filter((entry) => entry.board !== "maybe");

  if (style === "plain") {
    const main = exportable.filter((entry) => entry.board !== "side");
    const side = exportable.filter((entry) => entry.board === "side");
    const blocks: string[] = [
      main
        .map((entry) =>
          lineFor(entry, { withPrinting: false, useProxyNames }),
        )
        .join("\n"),
    ];
    if (side.length > 0) {
      blocks.push(
        side
          .map((entry) =>
            lineFor(entry, { withPrinting: false, useProxyNames }),
          )
          .join("\n"),
      );
    }
    return blocks.filter(Boolean).join("\n\n");
  }

  const blocks: string[] = [`About\nName ${deck.title}`];
  for (const section of ARENA_SECTIONS) {
    const sectionEntries = exportable.filter(
      (entry) => entry.board === section.board,
    );
    if (sectionEntries.length === 0) continue;
    blocks.push(
      `${section.header}\n${sectionEntries
        .map((entry) => lineFor(entry, { withPrinting: true, useProxyNames }))
        .join("\n")}`,
    );
  }
  return blocks.join("\n\n");
}
