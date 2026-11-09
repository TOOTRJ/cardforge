// ---------------------------------------------------------------------------
// Set Symbol Studio — the stored files' names, and the ONE rule that makes
// an uploaded set icon follow the card's rarity.
//
// A symbol's files live in its maker's own folder (lib/media/user-storage.ts)
// under ONE version id — every re-cut is a new version, so a card that
// points at an older one keeps drawing it:
//
//   set-covers/<user>/sym-<v>-auto.png      the "follows the rarity" file
//   set-covers/<user>/sym-<v>-common.png    … -uncommon / -rare / -mythic
//   set-covers/<user>/sym-<v>-plain.png     one look on every rarity
//   set-covers/<user>/sym-<v>-source.<ext>  what the maker brought / FLUX drew
//   card-art/<user>/wm-sym-<v>.png          the watermark
//
// A card follows its rarity ONLY when its set_icon_url is a `-auto` file
// (the creator's "Colour by rarity" switch writes that URL): the renderers
// draw `-<rarity>` in its place (`setIconForRarity`, run by
// drawableCardMedia and SetSymbol). Every other set icon — an upload from the
// Set icon step, a plain studio file — draws exactly as before, so no
// stored card changes (no layout bump, no sweep). The `-auto` file itself
// holds the rare look: what a surface that doesn't resolve shows.
//
// Client-safe.
// ---------------------------------------------------------------------------

import type { Rarity } from "@/types/card";

export const SYMBOL_FILE_VARIANTS = ["auto", "common", "uncommon", "rare", "mythic", "plain"] as const;
export type SymbolFileVariant = (typeof SYMBOL_FILE_VARIANTS)[number];

/** The look the `-auto` file holds. */
export const AUTO_FILE_LOOK = "rare" as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function symbolFileName(version: string, variant: SymbolFileVariant): string {
  return `sym-${version}-${variant}.png`;
}

export const SOURCE_EXTENSIONS = ["png", "jpg", "webp"] as const;
export type SourceExtension = (typeof SOURCE_EXTENSIONS)[number];

export function symbolSourceName(version: string, ext: SourceExtension): string {
  return `sym-${version}-source.${ext}`;
}

export function symbolWatermarkName(version: string): string {
  return `wm-sym-${version}.png`;
}

const AUTO_URL = new RegExp(`(/set-covers/${UUID}/sym-${UUID})-auto\\.png$`, "i");

/** Whether `url` is a studio symbol's "follows the rarity" file. */
export function isRarityFollowingSetIcon(url: string | null | undefined): boolean {
  return typeof url === "string" && AUTO_URL.test(url);
}

/**
 * The set icon a card DRAWS for `rarity`: a `-auto` studio file becomes the
 * same version's `-<rarity>` file (a card with no rarity: the common);
 * every other URL comes back unchanged.
 */
export function setIconForRarity<T extends string | null | undefined>(url: T, rarity: Rarity | null | undefined): T {
  if (typeof url !== "string") return url;
  const match = AUTO_URL.exec(url);
  if (!match) return url;
  return url.replace(AUTO_URL, `$1-${rarity ?? "common"}.png`) as T;
}

/** The `-auto` / `-plain` URL of a symbol from any of its file URLs. */
export function symbolVariantUrl(anyFileUrl: string, variant: SymbolFileVariant): string | null {
  const match = new RegExp(`(/set-covers/${UUID}/sym-${UUID})-(?:${SYMBOL_FILE_VARIANTS.join("|")})\\.png$`, "i").exec(
    anyFileUrl,
  );
  if (!match) return null;
  return anyFileUrl.slice(0, match.index) + `${match[1]}-${variant}.png`;
}
