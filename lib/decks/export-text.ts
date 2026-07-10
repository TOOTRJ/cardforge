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
// for the copy buttons. `useProxyNames` swaps in the custom card's title
// for remixed entries (share your build as YOUR cards).
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
  const name =
    opts.useProxyNames && entry.proxyTitle?.trim()
      ? entry.proxyTitle.trim()
      : entry.name;
  const printing =
    opts.withPrinting && entry.set_code && entry.collector_number
      ? ` (${entry.set_code.toUpperCase()}) ${entry.collector_number}`
      : "";
  return `${entry.quantity} ${name}${printing}`;
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
