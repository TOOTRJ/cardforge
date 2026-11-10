// ---------------------------------------------------------------------------
// New mana symbols (beta tool `custom-symbols`, migration 0193) — the shapes
// the browser and the server agree on.
//
// A custom symbol is a mana symbol beyond the six, written {*CODE} in a cost
// or in rules text. CODE is a letter then up to five letters or digits,
// stored uppercase and read case-insensitively. It is the CARD OWNER's:
// {*CODE} on a card means the owner's symbol with that code, for every
// viewer. Its rules meaning is DECLARED by its maker — a mana value (a whole
// number, 0–20) and a base colour, or none (colourless).
//
// `*` is free in every symbol parser: no printed symbol starts with it, the
// cost tokenizer reads `{*…}` as an unknown symbol today, print typography
// never reads inside braces, and the rules `* ` → `•` rule is a line start's.
//
// A code is never re-pointed while a card names it: unique per owner across
// every row, removed ones too, and fixed once made. "Remove" keeps the symbol
// (a tombstone, `deleted_at`) while one of the maker's cards names it, so
// those cards keep drawing it; one no card names is deleted for good. (That
// check is not a lock: a card saved in the same instant can still name a
// deleted code — the renderers draw an unknown code as a placeholder.)
//
// Client-safe: plain data and zod, no server imports.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { CUSTOM_SYMBOL_IN_TEXT_RE, customSymbolCodesIn } from "@/lib/symbols/symbol-token";

export const CUSTOM_SYMBOLS_SLUG = "custom-symbols" as const;

/** Live symbols per maker — mirrored by 0193's trigger (a test holds the two
 *  together). */
export const LIVE_SYMBOL_CAP = 20;
/** Rows per maker, removed ones included — mirrored by 0193's trigger. */
export const SYMBOL_ROW_CAP = 60;

export const SYMBOL_CODE_MAX = 6;
export const SYMBOL_NAME_MAX = 40;
export const SYMBOL_MANA_VALUE_MAX = 20;

/** A stored code: a letter, then up to five letters or digits (0193's CHECK). */
export const SYMBOL_CODE_RE = /^[A-Z][A-Z0-9]{0,5}$/;

/** A symbol as written in text: `{*code}`, any case. Global — use with
 *  matchAll / replace. (The renderers' module, lib/symbols/symbol-token.ts.) */
export const SYMBOL_IN_TEXT_RE = CUSTOM_SYMBOL_IN_TEXT_RE;

export const SYMBOL_BASE_COLORS = ["W", "U", "B", "R", "G"] as const;
export type SymbolBaseColor = (typeof SYMBOL_BASE_COLORS)[number];

export const SYMBOL_BASE_COLOR_LABELS: Record<SymbolBaseColor, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

export type CustomSymbol = {
  id: string;
  code: string;
  name: string;
  manaValue: number;
  /** null = colourless. */
  baseColor: SymbolBaseColor | null;
  imageUrl: string;
  source: "upload" | "forge";
  /** Set = removed, kept for the cards that still name it. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** What a maker typed as a code → the stored form ("*abc", "{*abc}",
 *  " abc " → "ABC"), or null when it isn't one. */
export function normalizeSymbolCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (value.startsWith("{") && value.endsWith("}")) value = value.slice(1, -1).trim();
  if (value.startsWith("*")) value = value.slice(1).trim();
  value = value.toUpperCase();
  return SYMBOL_CODE_RE.test(value) ? value : null;
}

/** The text a card writes for a symbol: `{*CODE}`. */
export function symbolToken(code: string): string {
  return `{*${code}}`;
}

/** Every code a text names, uppercase, each once, in first-seen order. */
export const symbolCodesIn = customSymbolCodesIn;

/** A card's field names a code the card's owner has no symbol for (PR 3):
 *  the creator's field error and both card actions' refusal say this. A
 *  removed symbol is still the owner's (it keeps drawing), so never named
 *  here. */
export function unknownSymbolsMessage(codes: readonly string[]): string {
  const tokens = codes.map(symbolToken);
  if (tokens.length === 1) {
    return `${tokens[0]} isn't one of your mana symbols. Make it in New mana symbols first, or take it out.`;
  }
  const list = `${tokens.slice(0, -1).join(", ")} and ${tokens[tokens.length - 1]}`;
  return `${list} aren't your mana symbols. Make them in New mana symbols first, or take them out.`;
}

export function isSymbolBaseColor(value: unknown): value is SymbolBaseColor {
  return typeof value === "string" && (SYMBOL_BASE_COLORS as readonly string[]).includes(value);
}

/** "Mana value 2 · Blue" / "Mana value 0 · Colourless". */
export function symbolMeaningLabel(symbol: Pick<CustomSymbol, "manaValue" | "baseColor">): string {
  const colour = symbol.baseColor ? SYMBOL_BASE_COLOR_LABELS[symbol.baseColor] : "Colorless";
  return `Mana value ${symbol.manaValue} · ${colour}`;
}

// --- what the forms send --------------------------------------------------------

const nameSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "Give the symbol a name.")
      .max(SYMBOL_NAME_MAX, `Names can be up to ${SYMBOL_NAME_MAX} characters.`),
  );

const manaValueSchema = z.coerce
  .number({ message: "Mana value is a whole number." })
  .int("Mana value is a whole number.")
  .min(0, "Mana value can't be below 0.")
  .max(SYMBOL_MANA_VALUE_MAX, `Mana value can be up to ${SYMBOL_MANA_VALUE_MAX}.`);

/** "" / null / "C" = colourless (no base colour). */
const baseColorSchema = z
  .union([z.enum(SYMBOL_BASE_COLORS), z.literal(""), z.literal("C"), z.null()])
  .transform((value): SymbolBaseColor | null => (value === "" || value === "C" || value === null ? null : value));

const codeSchema = z.string().transform((value, ctx) => {
  const code = normalizeSymbolCode(value);
  if (!code) {
    ctx.addIssue({
      code: "custom",
      message: `A code is a letter, then up to ${SYMBOL_CODE_MAX - 1} letters or digits.`,
    });
    return z.NEVER;
  }
  return code;
});

/** A new symbol's words (its picture rides as a file, or a forged pip's id). */
export const symbolDetailsSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  manaValue: manaValueSchema,
  baseColor: baseColorSchema,
});
export type SymbolDetails = z.output<typeof symbolDetailsSchema>;

/** An edit of a symbol's name and meaning (its code never changes). */
export const symbolEditSchema = z.object({
  id: z.uuid(),
  name: nameSchema,
  manaValue: manaValueSchema,
  baseColor: baseColorSchema,
});

export const symbolIdSchema = z.object({ id: z.uuid() });

/** A new symbol from one of the maker's forged pips (Pip Forge). */
export const symbolFromForgeSchema = symbolDetailsSchema.extend({ forgedPipId: z.uuid() });
