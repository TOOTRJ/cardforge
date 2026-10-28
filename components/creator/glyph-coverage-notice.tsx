"use client";

import { useMemo } from "react";
import { Info } from "lucide-react";
import {
  cardGlyphFields,
  cardSymbolFields,
  cardSymbolStyle,
  displayCharacter,
  findUndrawableSymbols,
  findUnrenderableText,
  undrawableSymbolsMessage,
  type GlyphCheckValues,
} from "@/lib/validation/card-glyphs";
import type { PipOverrides } from "@/lib/pips/override";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// GlyphCoverageNotice — tells the author, before they save, which characters
// the card IMAGE (downloads, shares, gallery) may not draw: emoji, scripts and
// symbols outside the card's printed fonts. Warn-only — nothing is blocked
// or changed; the live preview uses system fonts and still shows them.
// The check itself lives in lib/validation/card-glyphs.ts.
// ---------------------------------------------------------------------------

const MAX_CHARACTERS_PER_FIELD = 6;

export function GlyphCoverageNotice({
  values,
  className,
}: {
  values: GlyphCheckValues;
  className?: string;
}) {
  const fields = useMemo(() => findUnrenderableText(cardGlyphFields(values)), [values]);
  if (fields.length === 0) return null;
  // Not a live region: a box mounted WITH its content is not reliably heard,
  // and as one it re-read the whole list at every keystroke. The creator's
  // one polite region says it (`GlyphNoticeAnnouncer`, TODO 6.7).
  return (
    <div
      data-testid="glyph-coverage-notice"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-gold/50 bg-gold/10 px-4 py-3 text-sm text-foreground",
        className,
      )}
    >
      <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 leading-6">
        <p className="font-semibold">Some characters may not show on the card image</p>
        <ul className="mt-1 space-y-0.5">
          {fields.map((field) => {
            const shown = field.characters.slice(0, MAX_CHARACTERS_PER_FIELD).map(displayCharacter);
            const more = field.characters.length - shown.length;
            return (
              <li key={field.label}>
                <span className="text-muted">{field.label}:</span>{" "}
                <span className="break-all">{shown.join("  ")}</span>
                {more > 0 ? <span className="text-muted">{` and ${more} more`}</span> : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-1 text-xs text-muted">
          The image is drawn with the card&apos;s printed fonts: emoji are left out,
          and characters those fonts don&apos;t have show as blanks or boxes in
          downloads, shares and the gallery. Your text is saved exactly as typed.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UndrawableSymbolNotice — the same notice for `{…}` symbols: a mana cost or a
// rules text may hold a symbol the card has no pip for ({21}, {C/P}…), and
// both the preview and the image leave it out without a trace. Warn-only —
// stored cards hold such symbols already. The check is
// lib/validation/card-glyphs.ts findUndrawableSymbols, which asks the
// renderers' own gate.
// ---------------------------------------------------------------------------

export function UndrawableSymbolNotice({
  values,
  overrides,
  className,
}: {
  values: GlyphCheckValues;
  /** The card owner's custom pip images (drawn before the font's symbol). */
  overrides?: PipOverrides | null;
  className?: string;
}) {
  const fields = useMemo(
    () => findUndrawableSymbols(cardSymbolFields(values), { symbols: cardSymbolStyle(values), overrides }),
    [values, overrides],
  );
  if (fields.length === 0) return null;
  // Said by `GlyphNoticeAnnouncer`, as the notice above.
  return (
    <div
      data-testid="undrawable-symbol-notice"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-gold/50 bg-gold/10 px-4 py-3 text-sm text-foreground",
        className,
      )}
    >
      <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 leading-6">
        <p className="font-semibold">Some symbols can&apos;t be drawn on the card</p>
        <ul className="mt-1 space-y-0.5">
          {fields.map((field) => (
            <li key={field.label}>
              <span className="text-muted">{field.label}:</span>{" "}
              <span className="break-words">{undrawableSymbolsMessage(field.symbols)}.</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted">
          The card has no symbol for these, so the preview and the image leave
          them out. Your text is saved exactly as typed.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GlyphNoticeAnnouncer — the ONE polite live region that says the two notices
// above to a screen reader (TODO 6.7). Always mounted (a region that appears
// with its words in it is often not heard), visually hidden, and its words
// change only when WHICH fields a notice names changes — never at every
// keystroke inside a field already named, never an alert, never a second
// announcement per field.
// ---------------------------------------------------------------------------

/** The sentence the region holds: the notices' headings and the fields
 *  they name; "" when the card draws everything. */
export function glyphNoticeAnnouncement(
  values: GlyphCheckValues,
  overrides?: PipOverrides | null,
): string {
  const characters = findUnrenderableText(cardGlyphFields(values)).map((field) => field.label);
  const symbols = findUndrawableSymbols(cardSymbolFields(values), {
    symbols: cardSymbolStyle(values),
    overrides,
  }).map((field) => field.label);
  const lines: string[] = [];
  if (characters.length > 0) {
    lines.push(`Some characters may not show on the card image: ${characters.join(", ")}.`);
  }
  if (symbols.length > 0) lines.push(`Some symbols can't be drawn on the card: ${symbols.join(", ")}.`);
  return lines.join(" ");
}

export function GlyphNoticeAnnouncer({
  values,
  overrides,
}: {
  values: GlyphCheckValues;
  overrides?: PipOverrides | null;
}) {
  const message = useMemo(() => glyphNoticeAnnouncement(values, overrides), [values, overrides]);
  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="glyph-notice-announcer">
      {message}
    </p>
  );
}
