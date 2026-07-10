import type { DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// Decklist text parser — one tolerant grammar covers the export formats of
// MTG Arena, Moxfield, Archidekt, ManaBox, and plain MTGO text:
//
//   <qty>[x] <Card Name> [(SET) <collector>] [*F*|*E*] [[Category]] [^Lbl,#hex^] [#tag]
//
// plus section headers (`Deck`, `SIDEBOARD:`, `Commander`, …), Arena `About`/
// `Name` blocks, comment lines (#, //), blank-line main→side splits, and
// type-group headers ("Creatures (24)") that some exports include.
//
// Pure and IO-free: resolution against Scryfall happens elsewhere. Every
// line the parser skips is surfaced as a warning with its source line
// number so the import UI can show exactly what was ignored.
// ---------------------------------------------------------------------------

export type ParsedEntry = {
  name: string;
  quantity: number;
  board: DeckBoard;
  setCode: string | null;
  collectorNumber: string | null;
  /** 1-based source line of the FIRST occurrence (duplicates merge). */
  line: number;
  raw: string;
};

export type ParseWarning = {
  line: number;
  raw: string;
  reason: string;
};

export type ParsedDecklist = {
  /** Deck title from an Arena `About`/`Name` block, when present. */
  title: string | null;
  entries: ParsedEntry[];
  warnings: ParseWarning[];
};

export const MAX_DECKLIST_CHARS = 100_000;
export const MAX_DECKLIST_ENTRIES = 400;
export const MAX_ENTRY_QUANTITY = 250;

// Case-insensitive section headers → board. Trailing colon and counts like
// "Sideboard (15)" are stripped before matching.
const SECTION_BOARDS: Record<string, DeckBoard> = {
  deck: "main",
  mainboard: "main",
  main: "main",
  maindeck: "main",
  sideboard: "side",
  side: "side",
  commander: "commander",
  commanders: "commander",
  companion: "companion",
  maybeboard: "maybe",
  maybe: "maybe",
  considering: "maybe",
};

// Type-group headers some exports include between cards ("Creatures (24)").
// Ignored without switching boards.
const TYPE_GROUP_WORDS = new Set([
  "creature",
  "creatures",
  "planeswalker",
  "planeswalkers",
  "instant",
  "instants",
  "sorcery",
  "sorceries",
  "artifact",
  "artifacts",
  "enchantment",
  "enchantments",
  "battle",
  "battles",
  "land",
  "lands",
  "spell",
  "spells",
  "other",
  "tokens",
  "token",
]);

// Archidekt bracket categories → board. Unknown categories stay on the
// current board (they're user labels, not zones). `{top}`/`{noDeck}` flags
// and multi-category commas are stripped before matching.
const CATEGORY_BOARDS: Record<string, DeckBoard> = {
  commander: "commander",
  sideboard: "side",
  maybeboard: "maybe",
  considering: "maybe",
  companion: "companion",
};

/** NFC-normalize + map typographic characters that break name matching. */
function normalizeLine(line: string): string {
  return line
    .normalize("NFC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/−/g, "-")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionBoardFor(line: string): DeckBoard | null {
  const cleaned = line
    .replace(/:\s*$/, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim()
    .toLowerCase();
  return SECTION_BOARDS[cleaned] ?? null;
}

function isTypeGroupHeader(line: string): boolean {
  const cleaned = line
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim()
    .toLowerCase();
  return TYPE_GROUP_WORDS.has(cleaned);
}

type Decorations = {
  rest: string;
  categoryBoard: DeckBoard | null;
};

/** Strip trailing decorations (finish flags, categories, labels, tags) off
 *  a card line, in any order, capturing an Archidekt category → board. */
function stripDecorations(input: string): Decorations {
  let rest = input.trim();
  let categoryBoard: DeckBoard | null = null;

  for (;;) {
    // *F* / *E* finish flags (Moxfield, Archidekt, ManaBox)
    const finish = rest.match(/\s*\*[FE]\*$/i);
    if (finish) {
      rest = rest.slice(0, -finish[0].length);
      continue;
    }
    // ^Label,#hex^ custom labels (Archidekt)
    const label = rest.match(/\s*\^[^^]*\^$/);
    if (label) {
      rest = rest.slice(0, -label[0].length);
      continue;
    }
    // [Category], [Commander{top}], [Buff,Removal] (Archidekt)
    const bracket = rest.match(/\s*\[([^\]]*)\]$/);
    if (bracket) {
      rest = rest.slice(0, -bracket[0].length);
      const primary = bracket[1]
        .split(",")[0]
        .replace(/\{[^}]*\}/g, "")
        .trim()
        .toLowerCase();
      categoryBoard = CATEGORY_BOARDS[primary] ?? categoryBoard;
      continue;
    }
    // `Category` backtick tags (Archidekt import flavor)
    const backtick = rest.match(/\s*`([^`]*)`$/);
    if (backtick) {
      rest = rest.slice(0, -backtick[0].length);
      const tag = backtick[1].trim().toLowerCase();
      categoryBoard = CATEGORY_BOARDS[tag] ?? categoryBoard;
      continue;
    }
    // #tag / #!tag suffixes (deckstats flavor)
    const hash = rest.match(/\s+#!?[^\s#]+$/);
    if (hash) {
      rest = rest.slice(0, -hash[0].length);
      continue;
    }
    break;
  }

  return { rest: rest.trim(), categoryBoard };
}

/** `(SET) 123` / `(set)` at the end of the (decoration-stripped) line. Set
 *  codes are 2–6 alphanumerics, either case, may start with a digit (2X2,
 *  40K); collector numbers are strings ("237a", "XLN-117", "★"). */
const SET_AND_NUMBER = /\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([^\s()]+))?$/;

const QTY_PREFIX = /^(\d{1,3})\s*[xX]?\s+(.+)$/;

export function parseDecklist(text: string): ParsedDecklist {
  const warnings: ParseWarning[] = [];
  const entryByKey = new Map<string, ParsedEntry>();
  let title: string | null = null;

  // Board state machine. `sawExplicitSection` disables the blank-line
  // main→side split (headered exports use blank lines as decoration).
  let board: DeckBoard = "main";
  let sawExplicitSection = false;
  let sawMainEntries = false;
  let blankSplitUsed = false;
  let inAboutBlock = false;
  let skippingTokens = false;

  const lines = text.split(/\r\n|\r|\n/);

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = normalizeLine(rawLine);

    if (!line) {
      // Headerless MTGO convention: the first blank line after mainboard
      // entries starts the sideboard.
      if (
        !sawExplicitSection &&
        sawMainEntries &&
        !blankSplitUsed &&
        board === "main"
      ) {
        board = "side";
        blankSplitUsed = true;
      }
      inAboutBlock = false;
      return;
    }

    // Comment lines — but "// COMMANDER"-style headers (ManaBox share
    // exports) still switch sections.
    if (line.startsWith("#") || line.startsWith("//")) {
      const uncommented = line.replace(/^(\/\/|#)+!?\s*/, "");
      const commentBoard = sectionBoardFor(uncommented);
      if (commentBoard) {
        board = commentBoard;
        sawExplicitSection = true;
        skippingTokens = false;
      }
      return;
    }

    // Arena About block: "About" then "Name <title>".
    if (/^about$/i.test(line)) {
      inAboutBlock = true;
      return;
    }
    if (inAboutBlock && /^name\s+/i.test(line)) {
      title = line.replace(/^name\s+/i, "").trim() || null;
      inAboutBlock = false;
      return;
    }

    const sectionBoard = sectionBoardFor(line);
    if (sectionBoard) {
      board = sectionBoard;
      sawExplicitSection = true;
      skippingTokens = false;
      return;
    }
    if (/^tokens?(\s*\(\d+\))?:?$/i.test(line)) {
      // Token listings aren't deck cards; skip until the next section.
      skippingTokens = true;
      return;
    }
    if (skippingTokens) return;

    const qtyMatch = line.match(QTY_PREFIX);
    if (!qtyMatch) {
      if (isTypeGroupHeader(line)) return; // "Creatures (24)" — decoration
      warnings.push({
        line: lineNo,
        raw: rawLine.trim(),
        reason: "No quantity found — expected lines like “4 Lightning Bolt”.",
      });
      return;
    }

    const quantity = Number.parseInt(qtyMatch[1], 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      warnings.push({
        line: lineNo,
        raw: rawLine.trim(),
        reason: "Quantity must be at least 1.",
      });
      return;
    }

    const { rest, categoryBoard } = stripDecorations(qtyMatch[2]);

    let name = rest;
    let setCode: string | null = null;
    let collectorNumber: string | null = null;
    const setMatch = rest.match(SET_AND_NUMBER);
    if (setMatch) {
      name = rest.slice(0, -setMatch[0].length).trim();
      setCode = setMatch[1].toLowerCase();
      collectorNumber = setMatch[2] ?? null;
    }

    // Arena exports rebalanced Alchemy cards as "A-Name" — resolve the
    // paper card.
    if (/^A-\S/.test(name)) {
      name = name.slice(2);
    }

    if (!name) {
      warnings.push({
        line: lineNo,
        raw: rawLine.trim(),
        reason: "Couldn't find a card name on this line.",
      });
      return;
    }

    const entryBoard = categoryBoard ?? board;
    if (entryBoard === "main") sawMainEntries = true;

    const key = `${entryBoard}|${name.toLowerCase()}|${setCode ?? ""}|${collectorNumber ?? ""}`;
    const existing = entryByKey.get(key);
    if (existing) {
      existing.quantity = Math.min(
        existing.quantity + quantity,
        MAX_ENTRY_QUANTITY,
      );
    } else {
      entryByKey.set(key, {
        name,
        quantity: Math.min(quantity, MAX_ENTRY_QUANTITY),
        board: entryBoard,
        setCode,
        collectorNumber,
        line: lineNo,
        raw: rawLine.trim(),
      });
    }
  });

  const entries = applyCommanderHeuristic(
    Array.from(entryByKey.values()),
    sawExplicitSection,
    blankSplitUsed,
    warnings,
  );

  return { title, entries, warnings };
}

/**
 * Moxfield's native text export puts the commander(s) in a FIRST block
 * separated from the mainboard by a blank line — structurally identical to
 * a headerless MTGO main/side split. Disambiguate: when a headerless
 * two-block list has a tiny first block (1–2 single copies) and a
 * Commander-sized second block (≥ 50 cards), the first block is almost
 * certainly the command zone, not a 1-card mainboard. The review UI lets
 * the user re-board anything this guesses wrong.
 */
function applyCommanderHeuristic(
  entries: ParsedEntry[],
  sawExplicitSection: boolean,
  blankSplitUsed: boolean,
  warnings: ParseWarning[],
): ParsedEntry[] {
  if (sawExplicitSection || !blankSplitUsed) return entries;

  const mainEntries = entries.filter((e) => e.board === "main");
  const sideEntries = entries.filter((e) => e.board === "side");
  const sideTotal = sideEntries.reduce((sum, e) => sum + e.quantity, 0);

  const looksLikeCommandZone =
    mainEntries.length >= 1 &&
    mainEntries.length <= 2 &&
    mainEntries.every((e) => e.quantity === 1) &&
    sideTotal >= 50;

  if (!looksLikeCommandZone) return entries;

  warnings.push({
    line: mainEntries[0].line,
    raw: mainEntries[0].raw,
    reason:
      "Treated the first block as the command zone (Moxfield-style export). Re-board it in the review step if that's wrong.",
  });
  return entries.map((entry) =>
    entry.board === "main"
      ? { ...entry, board: "commander" as DeckBoard }
      : entry.board === "side"
        ? { ...entry, board: "main" as DeckBoard }
        : entry,
  );
}

/** Split-card names arrive as "Fire // Ice", "Fire / Ice", or MTGO's
 *  spaceless "Fire/Ice". No real card name contains a bare "/", so
 *  splitting on any slash run is safe; Scryfall front-face names are
 *  unique, so retry with the front half on a miss. */
export function frontFaceName(name: string): string | null {
  const front = name.split(/\s*\/+\s*/)[0];
  if (front === name) return null;
  return front.trim() || null;
}
