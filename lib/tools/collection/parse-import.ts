import { MAX_COLLECTION_QUANTITY, MAX_IMPORT_CHARS, MAX_IMPORT_LINES } from "./limits";

// ---------------------------------------------------------------------------
// The collection import's reader (Collection Deck Builder, migration 0185):
// what a player pastes or uploads → one line per printing they own. Pure and
// client-safe — the browser reads the file and sends the lines in chunks; the
// server validates every line again (lib/tools/collection/schemas.ts) and
// resolves it through Scryfall (lib/tools/collection/resolve.ts).
//
// Two shapes:
//   * A CSV export — ManaBox, Moxfield, Archidekt, Deckbox, TCGplayer, Dragon
//     Shield and anything else with a header row naming a card-name column.
//     Columns are found by their HEADER (aliases below), never by position,
//     so a reordered or trimmed export still reads. The delimiter is found
//     on the header (comma, semicolon or tab; Dragon Shield's "sep=," line
//     is skipped).
//   * Plain text, a card a line: "4 Llanowar Elves (DOM) 168", "4x Sol Ring",
//     "Lightning Bolt", "1 Sol Ring [C21] 263 *F*" (Moxfield's foil mark,
//     *E* etched), MTGA's "4 Llanowar Elves (DAR) 168". Deck section words
//     ("Deck", "Sideboard", "Commander"…) and comments are skipped.
//
// The best identifier a line carries wins at resolve time: Scryfall id, then
// set + collector number, then name + set, then name.
// ---------------------------------------------------------------------------

export type CollectionFinish = "nonfoil" | "foil" | "etched";

export const COLLECTION_FINISHES: readonly CollectionFinish[] = ["nonfoil", "foil", "etched"];

export const FINISH_LABELS: Record<CollectionFinish, string> = {
  nonfoil: "Non-foil",
  foil: "Foil",
  etched: "Etched foil",
};

export type ImportLine = {
  /** 1-based line of the file the row starts on. */
  line: number;
  /** The row as written (cut to 300 characters). */
  raw: string;
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
  scryfallId: string | null;
  quantity: number;
  finish: CollectionFinish;
  /** Scryfall's language code ("en", "ja", "zhs"…). */
  lang: string;
};

export type ImportProblem = { line: number; raw: string; reason: string };

export type ImportFormat =
  | "manabox"
  | "moxfield"
  | "archidekt"
  | "deckbox"
  | "tcgplayer"
  | "dragonshield"
  | "csv"
  | "text";

export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
  manabox: "ManaBox CSV",
  moxfield: "Moxfield CSV",
  archidekt: "Archidekt CSV",
  deckbox: "Deckbox CSV",
  tcgplayer: "TCGplayer CSV",
  dragonshield: "Dragon Shield CSV",
  csv: "CSV",
  text: "Card list",
};

export type ParsedImport = {
  format: ImportFormat;
  lines: ImportLine[];
  /** Lines that were read but can't become a card (with why). Blank lines,
   *  comments and section words are not problems. */
  problems: ImportProblem[];
  /** The file was cut at MAX_IMPORT_CHARS or MAX_IMPORT_LINES. */
  truncated: boolean;
  copies: number;
};

const RAW_MAX = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SET_CODE_RE = /^[a-z0-9]{2,6}$/i;
const COLLECTOR_RE = /^[a-z0-9★†\-.]{1,12}$/i;

// ---------------------------------------------------------------------------
// Languages: Scryfall's codes, and the names exports write.
// ---------------------------------------------------------------------------

const LANGUAGE_NAMES: Record<string, string> = {
  english: "en",
  spanish: "es",
  french: "fr",
  german: "de",
  italian: "it",
  portuguese: "pt",
  "portuguese (brazil)": "pt",
  japanese: "ja",
  korean: "ko",
  russian: "ru",
  "chinese simplified": "zhs",
  "simplified chinese": "zhs",
  "chinese traditional": "zht",
  "traditional chinese": "zht",
  hebrew: "he",
  latin: "la",
  "ancient greek": "grc",
  arabic: "ar",
  sanskrit: "sa",
  phyrexian: "ph",
};

const LANGUAGE_CODES = new Set(["en", "es", "fr", "de", "it", "pt", "ja", "ko", "ru", "zhs", "zht", "he", "la", "grc", "ar", "sa", "ph", "qya"]);
const LANGUAGE_ALIASES: Record<string, string> = { jp: "ja", kr: "ko", cn: "zhs", cs: "zhs", ct: "zht", tw: "zht", sp: "es", br: "pt" };

export function languageCode(value: string | null | undefined): string {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return "en";
  if (LANGUAGE_CODES.has(text)) return text;
  if (LANGUAGE_ALIASES[text]) return LANGUAGE_ALIASES[text];
  return LANGUAGE_NAMES[text] ?? "en";
}

export function finishOf(value: string | null | undefined): CollectionFinish {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return "nonfoil";
  if (text.includes("etched")) return "etched";
  if (["foil", "true", "yes", "y", "1", "foiled", "f", "premium"].includes(text) || /\bfoil\b/.test(text)) {
    return /\bnon[- ]?foil\b/.test(text) ? "nonfoil" : "foil";
  }
  return "nonfoil";
}

function quantityOf(value: string | null | undefined): number | null {
  const text = (value ?? "").trim().replace(/x$/i, "");
  if (!text) return 1;
  if (!/^\d{1,6}$/.test(text)) return null;
  return Math.min(Number(text), MAX_COLLECTION_QUANTITY);
}

function cut(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > RAW_MAX ? `${flat.slice(0, RAW_MAX - 1)}…` : flat;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** One CSV record: its cells and the 1-based line it starts on. Quotes may
 *  hold delimiters, doubled quotes and line breaks (RFC 4180). */
export function parseCsvRecords(text: string, delimiter: string): Array<{ line: number; cells: string[]; raw: string }> {
  const records: Array<{ line: number; cells: string[]; raw: string }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let rawStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      cells.push(cell);
      records.push({ line: startLine, cells, raw: text.slice(rawStart, i) });
      cells = [];
      cell = "";
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      line += 1;
      startLine = line;
      rawStart = i + 1;
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || cells.length > 0) {
    cells.push(cell);
    records.push({ line: startLine, cells, raw: text.slice(rawStart) });
  }
  return records.filter((r) => r.cells.some((c) => c.trim() !== ""));
}

function headerKey(cell: string): string {
  return cell.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const COLUMN_ALIASES = {
  quantity: ["count", "quantity", "qty", "amount", "totalqty", "haves", "copies", "number of copies"],
  name: ["simplename", "cardname", "name", "card", "cardtitle"],
  setCode: ["setcode", "editioncode", "expansioncode", "set", "edition", "setid"],
  collectorNumber: ["collectornumber", "collectorsnumber", "cardnumber", "number", "cn", "no"],
  scryfallId: ["scryfallid", "scryfalluuid", "scryfallcardid"],
  finish: ["finish", "foil", "printing", "foiled", "isfoil", "variation"],
  lang: ["language", "lang"],
} as const;

type Column = keyof typeof COLUMN_ALIASES;

function findColumns(header: string[]): Partial<Record<Column, number>> {
  const keys = header.map(headerKey);
  const out: Partial<Record<Column, number>> = {};
  for (const column of Object.keys(COLUMN_ALIASES) as Column[]) {
    for (const alias of COLUMN_ALIASES[column]) {
      const at = keys.indexOf(alias.replace(/[^a-z0-9]/g, ""));
      if (at >= 0) {
        out[column] = at;
        break;
      }
    }
  }
  return out;
}

function detectCsvFormat(header: string[]): ImportFormat {
  const keys = new Set(header.map(headerKey));
  const has = (...names: string[]) => names.some((n) => keys.has(n));
  if (has("manaboxid", "bindername", "bindertype")) return "manabox";
  if (has("folderName".toLowerCase(), "pricebought", "tradequantity")) return "dragonshield";
  if (has("productid", "sku", "simplename", "tcgplayerid") && has("printing", "condition")) return "tcgplayer";
  if (has("lastmodified", "proxy", "alter") && has("tradelistcount")) return "moxfield";
  if (has("signed", "artistproof", "myprice", "alteredart")) return "deckbox";
  if (has("editionname", "dateadded", "multiverseid") && has("finish", "editioncode")) return "archidekt";
  return "csv";
}

function delimiterOf(headerLine: string): string {
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t"]) {
    let count = 0;
    let quoted = false;
    for (const ch of headerLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) count += 1;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** A first line that reads as a CSV header: delimited, and one of its cells
 *  names the card. */
function csvHeaderOf(firstLine: string): { delimiter: string } | null {
  const delimiter = delimiterOf(firstLine);
  const cells = parseCsvRecords(firstLine, delimiter)[0]?.cells ?? [];
  if (cells.length < 2) return null;
  const columns = findColumns(cells);
  return columns.name !== undefined ? { delimiter } : null;
}

function parseCsv(text: string, delimiter: string): Omit<ParsedImport, "truncated" | "copies"> {
  const records = parseCsvRecords(text, delimiter);
  const header = records[0];
  const format = detectCsvFormat(header.cells);
  const columns = findColumns(header.cells);
  const lines: ImportLine[] = [];
  const problems: ImportProblem[] = [];
  const cell = (cells: string[], column: Column) => {
    const at = columns[column];
    return at === undefined ? "" : (cells[at] ?? "").trim();
  };
  for (const record of records.slice(1)) {
    const raw = cut(record.raw);
    const name = cell(record.cells, "name");
    if (!name) {
      problems.push({ line: record.line, raw, reason: "No card name on this row." });
      continue;
    }
    const quantity = quantityOf(cell(record.cells, "quantity"));
    if (quantity === null) {
      problems.push({ line: record.line, raw, reason: "The quantity isn't a whole number." });
      continue;
    }
    if (quantity === 0) {
      problems.push({ line: record.line, raw, reason: "No copies on this row (quantity 0)." });
      continue;
    }
    const setRaw = cell(record.cells, "setCode");
    // "Edition" / "Set" columns hold a set NAME in some exports (Deckbox):
    // only a code-shaped value is a code.
    const setCode = SET_CODE_RE.test(setRaw) ? setRaw.toLowerCase() : null;
    const number = cell(record.cells, "collectorNumber");
    const id = cell(record.cells, "scryfallId");
    lines.push({
      line: record.line,
      raw,
      name: cleanName(name),
      setCode,
      collectorNumber: setCode && COLLECTOR_RE.test(number) ? number.toLowerCase() : null,
      scryfallId: UUID_RE.test(id) ? id.toLowerCase() : null,
      quantity,
      finish: finishOf(cell(record.cells, "finish")),
      lang: languageCode(cell(record.cells, "lang")),
    });
  }
  return { format, lines, problems };
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

const SECTION_WORDS = /^(deck|decklist|main|mainboard|main deck|sideboard|side|commander|commanders|companion|maybeboard|maybe|considering|tokens|about|collection|binder)\s*:?\s*(\(\d+\))?$/i;

//   [qty][x] name [(SET) or [SET] [number]] [*F* | *E*] [[category]] [^tag^]
const TEXT_LINE =
  /^(?:(\d{1,6})\s*[xX]?\s+)?(.+?)(?:\s+[([]([A-Za-z0-9]{2,6})[)\]](?:\s+([A-Za-z0-9★†\-.]{1,12}))?)?(?:\s+\*([FfEe])\*)?(?:\s+\[[^\]]*\])*(?:\s+\^[^^]*\^)*\s*$/;

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 200);
}

function parseText(text: string): Omit<ParsedImport, "truncated" | "copies"> {
  const lines: ImportLine[] = [];
  const problems: ImportProblem[] = [];
  const rows = text.split(/\r\n|\r|\n/);
  rows.forEach((row, index) => {
    const trimmed = row.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//") || SECTION_WORDS.test(trimmed)) return;
    // MTGA's "Name <deck name>" line under "About".
    if (/^name\s+\S/i.test(trimmed) && index > 0 && /^about$/i.test(rows[index - 1]?.trim() ?? "")) return;
    const match = TEXT_LINE.exec(trimmed);
    const raw = cut(row);
    if (!match) {
      problems.push({ line: index + 1, raw, reason: "This line doesn't read as a card." });
      return;
    }
    const [, qty, name, set, number, mark] = match;
    const quantity = quantityOf(qty);
    if (!quantity) {
      problems.push({ line: index + 1, raw, reason: "No copies on this line (quantity 0)." });
      return;
    }
    const cleaned = cleanName(name);
    if (!cleaned || /^\d+$/.test(cleaned)) {
      problems.push({ line: index + 1, raw, reason: "No card name on this line." });
      return;
    }
    lines.push({
      line: index + 1,
      raw,
      name: cleaned,
      setCode: set ? set.toLowerCase() : null,
      collectorNumber: set && number ? number.toLowerCase() : null,
      scryfallId: null,
      quantity,
      finish: mark ? (mark.toLowerCase() === "e" ? "etched" : "foil") : "nonfoil",
      lang: "en",
    });
  });
  return { format: "text", lines, problems };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseCollectionImport(input: string): ParsedImport {
  let text = input.replace(/^﻿/, "");
  let truncated = false;
  if (text.length > MAX_IMPORT_CHARS) {
    text = text.slice(0, MAX_IMPORT_CHARS);
    truncated = true;
  }
  // Dragon Shield (and Excel) open with "sep=,".
  const sepLine = /^\s*"?sep=(.)"?\s*(?:\r\n|\r|\n)/i.exec(text);
  let offset = 0;
  if (sepLine) {
    offset = 1;
    text = text.slice(sepLine[0].length);
  }
  const firstLine = text.split(/\r\n|\r|\n/).find((l) => l.trim() !== "") ?? "";
  const header = csvHeaderOf(firstLine);
  const parsed = header ? parseCsv(text.slice(text.indexOf(firstLine)), header.delimiter) : parseText(text);
  const skippedBefore = header ? text.slice(0, text.indexOf(firstLine)).split(/\r\n|\r|\n/).length - 1 : 0;
  const shift = offset + skippedBefore;
  let lines = shift ? parsed.lines.map((l) => ({ ...l, line: l.line + shift })) : parsed.lines;
  const problems = shift ? parsed.problems.map((p) => ({ ...p, line: p.line + shift })) : parsed.problems;
  if (lines.length > MAX_IMPORT_LINES) {
    lines = lines.slice(0, MAX_IMPORT_LINES);
    truncated = true;
  }
  return {
    format: parsed.format,
    lines,
    problems,
    truncated,
    copies: lines.reduce((sum, l) => sum + l.quantity, 0),
  };
}

/** The unmatched lines as a CSV a spreadsheet opens (the review's
 *  "Download the lines that didn't match"). */
export function problemsCsv(problems: readonly ImportProblem[]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return ["Line,Row,Reason", ...problems.map((p) => [p.line, p.raw, p.reason].map(esc).join(","))].join("\r\n");
}
