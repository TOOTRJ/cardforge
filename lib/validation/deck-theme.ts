import { z } from "zod";

// Mirrors deck_themes' CHECK constraints (migration 0167 is the source of
// truth): a trimmed title of 1–60 characters, an optional trimmed blurb of
// 1–160 (an empty one is no blurb, NULL).

export const DECK_THEME_TITLE_MAX = 60;
export const DECK_THEME_BLURB_MAX = 160;
/** Decks a theme may hold (the sections show the first 4 a visitor may see;
 *  the spares stand in when one turns private). The SQL caps a read at 8. */
export const DECK_THEME_DECKS_MAX = 8;
/** Themes the admin page may hold, live or not. */
export const DECK_THEMES_MAX = 12;

export const deckThemeSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the theme a title.")
    .max(DECK_THEME_TITLE_MAX, `Titles are at most ${DECK_THEME_TITLE_MAX} characters.`),
  blurb: z
    .string()
    .trim()
    .max(DECK_THEME_BLURB_MAX, `The blurb is at most ${DECK_THEME_BLURB_MAX} characters.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

export type DeckThemeInput = z.input<typeof deckThemeSchema>;

/** The deck slug in a pasted deck link (`/deck/<slug>`, absolute or
 *  relative, with or without a query or fragment) — or a bare slug. */
export function deckSlugFromUrl(value: string): string | null {
  const trimmed = value.trim();
  const fromPath = /\/deck\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?(?:[?#]|$)/i.exec(trimmed);
  const slug = fromPath ? fromPath[1] : /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(trimmed) ? trimmed : null;
  return slug ? slug.toLowerCase() : null;
}
