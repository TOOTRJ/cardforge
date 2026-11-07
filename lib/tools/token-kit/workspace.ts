import { budgetCopies } from "@/lib/cards/print-selection";
import type { KitItem } from "@/lib/tools/token-kit/collect";
import {
  isDungeonFace,
  kitFrameFor,
  KIT_MAX_COPIES,
  type KitFrame,
  type KitItemState,
  type KitSettings,
} from "@/lib/tools/token-kit/model";

// ---------------------------------------------------------------------------
// The Token Kit page's state, pure: each token's starting choices (the
// saved ones, else the suggestion), what the kit prints, and the line that
// sums it up. The page (components/tools/token-kit) holds the state; this
// decides it.
// ---------------------------------------------------------------------------

/** A token's state when the kit opens: its saved choices where the kit
 *  kept them, else in the kit at the suggested copies, with no picture. */
export function initialItemState(item: KitItem, saved: KitItemState | undefined): KitItemState {
  if (saved) return { ...saved, copies: Math.min(KIT_MAX_COPIES, Math.max(0, saved.copies)) };
  return { include: !isDungeonFace(item.face), copies: item.suggested, artUrl: null, artistCredit: null, artPosition: null };
}

export function initialItemStates(items: readonly KitItem[], saved: Record<string, KitItemState> | null | undefined) {
  return Object.fromEntries(items.map((item) => [item.key, initialItemState(item, saved?.[item.key])])) as Record<string, KitItemState>;
}

/** Every token's frame under the kit's settings (null keys: none). */
export function kitFrames(items: readonly KitItem[], settings: KitSettings, verifiedKeys: ReadonlySet<string>): Record<string, KitFrame> {
  return Object.fromEntries(items.map((item) => [item.key, kitFrameFor(item.face, settings, verifiedKeys)]));
}

/** A file-name slug: lower case, a–z 0–9 and single dashes. */
export function kitSlug(text: string, fallback = "token"): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

export type KitPrintToken = { key: string; title: string; slug: string; copies: number };

/**
 * What the kit prints: the tokens in the kit with a frame and at least one
 * copy, in the kit's order, each with a file slug of its own (a second
 * "Spirit" is "spirit-2") — copies for a SHEET, one each otherwise (the
 * selection export's rule), the whole run budgeted to the export's cap
 * (budgetCopies: the same 150 physical cards).
 */
export function kitPrintTokens(
  items: readonly KitItem[],
  states: Record<string, KitItemState>,
  frames: Record<string, KitFrame>,
  opts: { sheets: boolean },
): KitPrintToken[] {
  const seen = new Map<string, number>();
  const tokens = items
    .filter((item) => states[item.key]?.include && (states[item.key]?.copies ?? 0) > 0 && frames[item.key]?.ok)
    .map((item) => {
      const base = kitSlug(item.face.title);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return {
        key: item.key,
        title: item.face.title,
        slug: n === 1 ? base : `${base}-${n}`,
        copies: opts.sheets ? states[item.key].copies : 1,
      };
    });
  return budgetCopies(tokens.map((token) => ({ ...token, id: token.key }))).map(({ key, title, slug, copies }) => ({ key, title, slug, copies }));
}

export type KitSummary = {
  tokens: number;
  emblems: number;
  helpers: number;
  /** In the kit and drawable. */
  included: number;
  /** Physical cards the kit's copies add up to. */
  cards: number;
  /** Listed but not drawn (a dungeon, a colour not verified yet). */
  undrawable: number;
};

export function kitSummary(
  items: readonly KitItem[],
  states: Record<string, KitItemState>,
  frames: Record<string, KitFrame>,
): KitSummary {
  const out: KitSummary = { tokens: 0, emblems: 0, helpers: 0, included: 0, cards: 0, undrawable: 0 };
  for (const item of items) {
    if (item.face.kind === "token") out.tokens += 1;
    else if (item.face.kind === "emblem") out.emblems += 1;
    else out.helpers += 1;
    const frame = frames[item.key];
    if (!frame?.ok) {
      out.undrawable += 1;
      continue;
    }
    const state = states[item.key];
    if (state?.include && state.copies > 0) {
      out.included += 1;
      out.cards += state.copies;
    }
  }
  return out;
}

/** "9 tokens · 2 emblems · 1 helper card". */
export function kitCountsLine(summary: Pick<KitSummary, "tokens" | "emblems" | "helpers">): string {
  const parts: string[] = [];
  if (summary.tokens) parts.push(`${summary.tokens} token${summary.tokens === 1 ? "" : "s"}`);
  if (summary.emblems) parts.push(`${summary.emblems} emblem${summary.emblems === 1 ? "" : "s"}`);
  if (summary.helpers) parts.push(`${summary.helpers} helper card${summary.helpers === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** "Made by Goldspan Dragon, Smothering Tithe and 2 more". */
export function makersLine(makers: readonly string[], shown = 2): string {
  if (makers.length === 0) return "";
  if (makers.length <= shown + 1) {
    return makers.length === 1 ? makers[0] : `${makers.slice(0, -1).join(", ")} and ${makers[makers.length - 1]}`;
  }
  return `${makers.slice(0, shown).join(", ")} and ${makers.length - shown} more`;
}
