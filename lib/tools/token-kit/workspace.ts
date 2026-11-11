import { budgetCopies } from "@/lib/cards/print-selection";
import type { KitItem } from "@/lib/tools/token-kit/collect";
import {
  isDungeonFace,
  kitFrameFor,
  KIT_MAX_COPIES,
  kitItemStateSchema,
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

/** The most item states one saved kit keeps. */
export const MAX_SAVED_ITEMS = 300;

/** One user's token renders (POST /api/tools/token-kit/render): a minute's
 *  worth no three-at-a-time export reaches, and ten whole kits an hour. The
 *  export does not retry a refused render, so these sit above anything an
 *  honest export of MAX_SAVED_ITEMS tokens can do. */
export const KIT_RENDERS_PER_MINUTE = 600;
export const KIT_RENDERS_PER_HOUR = 10 * MAX_SAVED_ITEMS;

/** A stored kit's item states, read defensively: what no longer parses is
 *  left out (the defaults stand in for it). */
export function storedKitItems(raw: unknown): Record<string, KitItemState> {
  const items: Record<string, KitItemState> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return items;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = kitItemStateSchema.safeParse(value);
    if (parsed.success) items[key] = parsed.data;
  }
  return items;
}

/**
 * What a save writes: the incoming states (the tokens this build shows)
 * over the stored ones, so a token the build didn't show — a Scryfall
 * outage, a card out of the deck for a while, a reworded token — keeps its
 * copies and picture. Past `max`, the incoming ones win and, of the stored
 * extras, the ones holding a picture are kept first.
 */
export function mergeKitItems(
  stored: Readonly<Record<string, KitItemState>>,
  incoming: Readonly<Record<string, KitItemState>>,
  max: number,
): Record<string, KitItemState> {
  const merged: Record<string, KitItemState> = { ...incoming };
  let room = max - Object.keys(merged).length;
  const extras = Object.entries(stored)
    .filter(([key]) => !(key in incoming))
    .sort(([, a], [, b]) => Number(Boolean(b.artUrl)) - Number(Boolean(a.artUrl)));
  for (const [key, state] of extras) {
    if (room <= 0) break;
    merged[key] = state;
    room -= 1;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// How a kit's print / download ENDED, for the tool's analytics. The browser
// builds the file (DeckExportProvider → runKitExport), so no server action
// sees it finish: the page reads the provider's state and records the end
// once (components/tools/token-kit/token-kit-workspace.tsx). Counts, the
// file's kind and a reason code — never a token's or a kit's name.
// ---------------------------------------------------------------------------

/** What the outcome reads of the export provider's state (structural, so
 *  this module imports no component). */
export type KitExportSnapshot = {
  id: number;
  subject: string;
  kind: string;
  status: string;
  /** Tokens asked for / rendered so far. */
  total: number;
  done: number;
  /** The tokens that didn't render (their count is all that is read). */
  failed: readonly string[];
  startedAt: number;
  finishedAt: number | null;
  file: { bytes: number; cards: number } | null;
};

export type KitExportOutcome = {
  event: "kit_export_done" | "kit_export_failed";
  props: Record<string, string | number>;
};

/**
 * The event a FINISHED kit export records, or null — another subject's
 * export (a deck, a card selection), or one still running. `kit_export_done`
 * = the file was built (`rendered` tokens in it, `failed` left out);
 * `kit_export_failed` = no file, with why: the maker cancelled it, or it
 * broke (a refused print file is the render route's `render_refused`).
 */
export function kitExportOutcome(state: KitExportSnapshot | null | undefined): KitExportOutcome | null {
  if (!state || state.subject !== "kit") return null;
  const kind = state.kind === "pdf" ? "pdf" : "zip";
  const ms = state.finishedAt === null ? 0 : Math.max(0, state.finishedAt - state.startedAt);
  if (state.status === "done") {
    return {
      event: "kit_export_done",
      props: {
        kind,
        tokens: state.total,
        rendered: state.file?.cards ?? 0,
        failed: state.failed.length,
        kb: Math.round((state.file?.bytes ?? 0) / 1024),
        ms,
      },
    };
  }
  if (state.status === "failed" || state.status === "cancelled") {
    return {
      event: "kit_export_failed",
      props: {
        reason: state.status === "cancelled" ? "cancelled" : "error",
        kind,
        tokens: state.total,
        rendered: Math.max(0, state.done - state.failed.length),
        failed: state.failed.length,
        ms,
      },
    };
  }
  return null;
}
