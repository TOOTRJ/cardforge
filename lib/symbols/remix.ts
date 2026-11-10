import type { PipOverrides } from "@/lib/pips/override";
import { customSymbolCodesIn, customSymbolKey, type OwnerSymbols, type SymbolMeanings } from "@/lib/symbols/symbol-token";
import { symbolToken } from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// A remix and the owner's own symbols (new pips PR 5) — pure, client-safe.
//
// `{*CODE}` on a card always means the CARD OWNER's symbol. A remix of
// another maker's card is the REMIXER's card, so the codes it keeps from its
// parent would name the remixer's symbols — which they don't have. The save
// copies the parent owner's symbols the remix names into the remixer's set
// (lib/symbols/remix-copy.ts); a code the remixer already has stays THEIRS
// (their picture, mana value and colour), and the save says so. The creator
// shows the remix that way before the save (withRemixParentSymbols).
// ---------------------------------------------------------------------------

/** The fields of a card that name its symbols — the same ones 0193 / 0195's
 *  `custom_symbol_in_use` reads (the cost, the rules, the rows, the back
 *  face / second part, the name and the nickname a `~` prints). */
export type SymbolNamingRow = {
  title?: unknown;
  nickname?: unknown;
  cost?: unknown;
  rules_text?: unknown;
  face_content?: unknown;
  back_face?: unknown;
};

/** Every code a card names, upper case, each once. */
export function symbolCodesNamedBy(row: SymbolNamingRow | null | undefined): string[] {
  if (!row) return [];
  const { title, nickname, cost, rules_text, face_content, back_face } = row;
  return customSymbolCodesIn(JSON.stringify([title, nickname, cost, rules_text, face_content, back_face]));
}

/** The codes a remix carries over from its parent: named by BOTH. A code
 *  the remixer typed that the parent doesn't name is theirs to make. */
export function remixedSymbolCodes(parent: SymbolNamingRow | null | undefined, remix: SymbolNamingRow): string[] {
  const fromParent = new Set(symbolCodesNamedBy(parent));
  return symbolCodesNamedBy(remix).filter((code) => fromParent.has(code));
}

/**
 * The creator's symbols for a remix of another maker's card: the remixer's
 * own (pictures and meanings), plus the parent owner's for the `codes` the
 * parent names that the remixer has no symbol for — the ones the save will
 * copy. The remixer's own always win (a clash keeps theirs).
 */
export function withRemixParentSymbols(
  own: { pictures: PipOverrides; meanings: SymbolMeanings },
  parent: OwnerSymbols | null | undefined,
  codes: readonly string[],
): { pictures: PipOverrides; meanings: SymbolMeanings } {
  if (!parent || codes.length === 0) return own;
  const pictures: PipOverrides = { ...own.pictures };
  const meanings: Record<string, SymbolMeanings[string]> = { ...own.meanings };
  for (const code of codes) {
    const key = customSymbolKey(code);
    if (own.meanings[code] || own.pictures[key]) continue;
    const picture = parent.pictures[key];
    const meaning = parent.meanings[code];
    if (picture) pictures[key] = picture;
    if (meaning) meanings[code] = meaning;
  }
  return { pictures, meanings };
}

/** What a remix's save did with its parent's symbols. */
export type RemixSymbolsNotice = {
  /** Copied into the remixer's symbols. */
  copied: string[];
  /** Copied, but as REMOVED: the remixer was at their 20 live symbols. The
   *  card still draws them (a removed symbol keeps drawing). */
  copiedRemoved: string[];
  /** The remixer already had a symbol with the code: theirs is used. */
  keptYours: string[];
};

const listOf = (codes: readonly string[]) => {
  const tokens = codes.map(symbolToken);
  return tokens.length === 1 ? tokens[0] : `${tokens.slice(0, -1).join(", ")} and ${tokens[tokens.length - 1]}`;
};

/** The creator's one toast for it, or null when nothing needs saying. */
export function remixSymbolsMessage(notice: RemixSymbolsNotice | null | undefined): string | null {
  if (!notice) return null;
  const parts: string[] = [];
  const copied = [...notice.copied, ...notice.copiedRemoved];
  if (copied.length > 0) {
    parts.push(
      copied.length === 1
        ? `Your remix brought the mana symbol ${listOf(copied)} into your symbols.`
        : `Your remix brought the mana symbols ${listOf(copied)} into your symbols.`,
    );
  }
  if (notice.copiedRemoved.length > 0) {
    parts.push(
      `You already have 20 symbols, so ${listOf(notice.copiedRemoved)} ${notice.copiedRemoved.length === 1 ? "is" : "are"} kept as removed — the card still shows ${notice.copiedRemoved.length === 1 ? "it" : "them"}.`,
    );
  }
  if (notice.keptYours.length > 0) {
    parts.push(
      notice.keptYours.length === 1
        ? `You already have a symbol ${listOf(notice.keptYours)}, so your remix uses yours.`
        : `You already have symbols ${listOf(notice.keptYours)}, so your remix uses yours.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
