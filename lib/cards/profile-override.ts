import { z } from "zod";
import {
  getFrameProfile,
  type FrameProfile,
} from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// Frame-profile overrides — deep-partial FrameProfile objects stored per
// template in the frame_profile_overrides table and merged over the code
// defaults at render time. The admin visual editor (/admin/frame-compare)
// writes them; both renderers (live preview + Satori bake) read layout only
// through resolveFrameProfile so preview and bake can never disagree.
//
// v1 is deliberately geometry-only: rects, sizes, line heights, value
// nudges. Colors/fonts/booleans stay code-owned — keeps the schema tight
// and the editor focused on the actual pain point (alignment).
//
// Client-safe (no server-only): the editor merges drafts client-side and
// CardPreview resolves the map it was handed.
// ---------------------------------------------------------------------------

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type FrameProfileOverride = DeepPartial<FrameProfile>;

/** Keyed by template ("m15", "saga", …). ≤27 rows, world-readable. */
export type FrameProfileOverridesMap = Record<string, FrameProfileOverride>;

// ---------------------------------------------------------------------------
// Validation — both the save action AND the read path parse through this,
// so a hand-edited DB row degrades to "no override", never a crashed bake.
// ---------------------------------------------------------------------------

const pct = z.number().min(-20).max(120);
const sizePct = z.number().min(0.005).max(0.2);

const rectOverrideSchema = z
  .object({
    topPct: pct,
    leftPct: pct,
    widthPct: pct,
    heightPct: pct,
  })
  .partial()
  .strict();

const textSlotOverrideSchema = z
  .object({
    rect: rectOverrideSchema,
    sizePct,
    lineHeight: z.number().min(0.8).max(2),
    letterSpacingEm: z.number().min(-0.5).max(0.5),
  })
  .partial()
  .strict();

const statSlotOverrideSchema = z
  .object({
    rect: rectOverrideSchema,
    sizePct,
    valueDxEm: z.number().min(-2).max(2),
    valueDyEm: z.number().min(-2).max(2),
  })
  .partial()
  .strict();

export const frameProfileOverrideSchema = z
  .object({
    artSlot: rectOverrideSchema,
    costRect: rectOverrideSchema,
    title: textSlotOverrideSchema,
    type: textSlotOverrideSchema,
    rules: textSlotOverrideSchema,
    footer: textSlotOverrideSchema,
    pt: statSlotOverrideSchema,
    loyalty: statSlotOverrideSchema,
    defense: statSlotOverrideSchema,
    costSizePct: sizePct,
    symbolSizePct: sizePct,
    chapters: z.object({ rect: rectOverrideSchema, sizePct }).partial().strict(),
    adventure: z
      .object({
        title: textSlotOverrideSchema,
        type: textSlotOverrideSchema,
        rules: textSlotOverrideSchema,
        costSizePct: sizePct,
      })
      .partial()
      .strict(),
    secondFace: z
      .object({
        title: textSlotOverrideSchema,
        type: textSlotOverrideSchema,
        rules: textSlotOverrideSchema,
        pt: statSlotOverrideSchema,
        artSlot: rectOverrideSchema,
        costSizePct: sizePct,
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

/** Parse unknown jsonb into a safe override; null when invalid/empty. */
export function parseFrameProfileOverride(
  value: unknown,
): FrameProfileOverride | null {
  const parsed = frameProfileOverrideSchema.safeParse(value);
  if (!parsed.success) return null;
  if (Object.keys(parsed.data).length === 0) return null;
  return parsed.data as FrameProfileOverride;
}

// ---------------------------------------------------------------------------
// Merge + resolve
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function deepMerge<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    out[key] =
      isPlainObject(baseValue) && isPlainObject(value)
        ? deepMerge(baseValue, value as DeepPartial<typeof baseValue>)
        : value;
  }
  return out as T;
}

/** Merge an override over a base profile. Override scalars win; nested
 *  objects merge; the profile has no arrays. Returns the base object
 *  unchanged when the override is empty. */
export function mergeProfile(
  base: FrameProfile,
  override?: FrameProfileOverride | null,
): FrameProfile {
  if (!override || Object.keys(override).length === 0) return base;
  return deepMerge(base, override);
}

/** getFrameProfile + mergeProfile in one step — the ONLY layout resolver
 *  renderers should call. `overrides` is the whole map so one fetch serves
 *  every face/template a render touches. */
export function resolveFrameProfile(
  template: string | null | undefined,
  overrides?: FrameProfileOverridesMap | null,
): FrameProfile {
  const base = getFrameProfile(template ?? undefined);
  if (!overrides) return base;
  // Overrides key by the template the caller asked for — the M15 fallback
  // inside getFrameProfile must NOT pick up another template's override.
  const override = template ? overrides[template] : undefined;
  return mergeProfile(base, override);
}

// ---------------------------------------------------------------------------
// Slot enumeration for the editor + alignment score.
// ---------------------------------------------------------------------------

export type SlotPath =
  | "artSlot"
  | "costRect"
  | "title"
  | "type"
  | "rules"
  | "footer"
  | "pt"
  | "loyalty"
  | "defense"
  | "chapters"
  | "adventure.title"
  | "adventure.type"
  | "adventure.rules"
  | "secondFace.title"
  | "secondFace.type"
  | "secondFace.rules"
  | "secondFace.pt"
  | "secondFace.artSlot";

/** The slot paths a template actually renders, in editor display order. */
export function listSlotPaths(profile: FrameProfile): SlotPath[] {
  const paths: SlotPath[] = ["artSlot", "title"];
  if (!profile.hideCost) paths.push("costRect");
  paths.push("type", "rules");
  if (profile.footer) paths.push("footer");
  if (profile.pt) paths.push("pt");
  if (profile.loyalty) paths.push("loyalty");
  if (profile.defense) paths.push("defense");
  if (profile.chapters) paths.push("chapters");
  if (profile.adventure) {
    paths.push("adventure.title", "adventure.type", "adventure.rules");
  }
  if (profile.secondFace) {
    paths.push("secondFace.title", "secondFace.type", "secondFace.rules");
    if (profile.secondFace.pt) paths.push("secondFace.pt");
    if (profile.secondFace.artSlot) paths.push("secondFace.artSlot");
  }
  return paths;
}

/** The rect for a slot path on a (resolved) profile, or null. artSlot and
 *  chapters are bare Rects; the rest carry `.rect`. */
export function slotRect(
  profile: FrameProfile,
  path: SlotPath,
): { topPct: number; leftPct: number; widthPct: number; heightPct: number } | null {
  if (path === "costRect" && !profile.costRect) {
    // No explicit cost box yet — the pips live inline at the title band's
    // right edge; expose that region so the editor can select and detach it.
    return defaultCostRect(profile);
  }
  const parts = path.split(".");
  let node: unknown = profile;
  for (const part of parts) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (!node || typeof node !== "object") return null;
  const maybe = node as { rect?: unknown; topPct?: unknown };
  if (typeof maybe.topPct === "number") {
    return maybe as ReturnType<typeof slotRect>;
  }
  if (maybe.rect && typeof (maybe.rect as { topPct?: unknown }).topPct === "number") {
    return maybe.rect as ReturnType<typeof slotRect>;
  }
  return null;
}

/** The region the inline mana cost occupies when no explicit costRect is
 *  set: the right half of the title band. Selecting/nudging "costRect" in
 *  the editor seeds the draft from this, detaching the pips from the name. */
export function defaultCostRect(profile: FrameProfile): {
  topPct: number;
  leftPct: number;
  widthPct: number;
  heightPct: number;
} {
  const t = profile.title.rect;
  const half = Math.round((t.widthPct / 2) * 100) / 100;
  return {
    topPct: t.topPct,
    heightPct: t.heightPct,
    leftPct: Math.round((t.leftPct + t.widthPct - half) * 100) / 100,
    widthPct: half,
  };
}
