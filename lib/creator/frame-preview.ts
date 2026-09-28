import {
  ERA_TYPE_FRAME,
  FRAME_ERA_VALUES,
  FRAME_TEMPLATE_VALUES,
  type FrameTemplate,
} from "@/types/card";
import {
  CARD_KIND_VALUES,
  KIND_DEFS,
  templateSupportsKind,
  type CardKind,
} from "@/lib/creator/card-kinds";
import {
  FRAME_COLOR_KEYS,
  frameComboKey,
  type FrameColorKey,
} from "@/lib/cards/frame-reference-registry";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import type { ColorIdentity } from "@/types/card";
import type { FrameWalkthrough } from "@/lib/creator/frame-walkthrough-seed";

// ---------------------------------------------------------------------------
// Admin frame preview (TODO Phase 2): an admin walks the creator on frames
// nobody else can pick yet.
//
//   ?previewFrames=all                → every (template, colour) combination
//   ?previewFrames=m15borderless      → every colour of one template
//   ?previewFrames=battle/w,saga      → a list of combos and/or templates
//
// The pages union these keys with the verified set for ADMINS only (the
// check is the server's, from the profile — never the URL), the guest ISR
// creator never reads the param, and AI jobs keep resolving frames from the
// verified set alone. A save on a previewed combination is a "frame
// preview": private, flagged `cards.frame_preview` (migration 0121), and
// listed under its template in /admin/frame-compare.
//
// Pure and client-safe: the pages, the form and the admin checklist share
// it, and tests pin the rules.
// ---------------------------------------------------------------------------

/** The URL parameter both pages read. */
export const PREVIEW_FRAMES_PARAM = "previewFrames";

export type PreviewFramesRequest = {
  /** The normalised parameter value, echoed into follow-up URLs (the edit
   *  page a create redirects to keeps the mode). */
  param: string;
  /** Every combo key the request names ("template/colour"). */
  keys: string[];
};

const TEMPLATES: ReadonlySet<string> = new Set(FRAME_TEMPLATE_VALUES);
const COLOURS: ReadonlySet<string> = new Set(FRAME_COLOR_KEYS);
/** Upper bound on tokens read from the URL — the full list is 50-odd
 *  templates; anything longer is noise. */
const MAX_TOKENS = 64;

const ALL_KEYS: readonly string[] = FRAME_TEMPLATE_VALUES.flatMap((t) =>
  FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k)),
);

/** Parse `?previewFrames=`. Unknown templates/colours are dropped; a value
 *  that names nothing valid is null (no preview mode). Accepts the array
 *  form Next hands over for a repeated parameter. */
export function parsePreviewFramesParam(
  raw: string | string[] | null | undefined,
): PreviewFramesRequest | null {
  const joined = Array.isArray(raw) ? raw.join(",") : raw;
  if (!joined) return null;
  const tokens = joined
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
  if (tokens.includes("all")) {
    return { param: "all", keys: [...ALL_KEYS] };
  }
  const keys = new Set<string>();
  const kept: string[] = [];
  for (const token of tokens) {
    const [template, colour, extra] = token.split("/");
    if (extra !== undefined || !TEMPLATES.has(template)) continue;
    if (colour === undefined) {
      for (const k of FRAME_COLOR_KEYS) keys.add(frameComboKey(template, k));
      kept.push(template);
    } else if (COLOURS.has(colour)) {
      keys.add(frameComboKey(template, colour));
      kept.push(`${template}/${colour}`);
    }
  }
  if (keys.size === 0) return null;
  return { param: [...new Set(kept)].join(","), keys: [...keys] };
}

export type FramePreviewMode = {
  /** Normalised `previewFrames` value, for follow-up URLs. */
  param: string;
  /** The real verified set — what AI jobs, the AI dialog and every other
   *  user see. */
  publishedKeys: string[];
  /** Verified ∪ previewed — what the admin's frame picker offers. */
  pickableKeys: string[];
  /** Previewed combos that are NOT verified (the banner's count). */
  unverifiedKeys: string[];
};

/** The page-level decision: admins with a valid `previewFrames` get the
 *  union; everyone else gets null and the ordinary verified set. The admin
 *  flag must come from the server-read profile. */
export function resolveFramePreviewMode(input: {
  isAdmin: boolean;
  param: string | string[] | null | undefined;
  verifiedKeys: readonly string[];
}): FramePreviewMode | null {
  if (!input.isAdmin) return null;
  const request = parsePreviewFramesParam(input.param);
  if (!request) return null;
  const published = new Set(input.verifiedKeys);
  const unverifiedKeys = request.keys.filter((key) => !published.has(key));
  return {
    param: request.param,
    publishedKeys: [...input.verifiedKeys],
    pickableKeys: [...input.verifiedKeys, ...unverifiedKeys],
    unverifiedKeys,
  };
}

/** What the create/edit pages hand the creator form in preview mode. */
export type CreatorFramePreview = {
  param: string;
  publishedKeys: string[];
  walkthrough: FrameWalkthrough | null;
};

/** Is this save a frame preview? In create mode: always during a walk
 *  through the stepper (it is a test card), otherwise when the chosen
 *  (template, colour) isn't verified. Outside preview mode never — the
 *  server's verification gate then refuses an unverified combo as usual. */
export function isFramePreviewSave(input: {
  mode: Pick<FramePreviewMode, "publishedKeys"> | null;
  walkthrough: boolean;
  template: string | null | undefined;
  colorIdentity: readonly ColorIdentity[] | null | undefined;
}): boolean {
  if (!input.mode) return false;
  if (input.walkthrough) return true;
  const key = frameComboKey(
    normalizeFrameTemplate(input.template),
    pickFrameColorKey(input.colorIdentity ? [...input.colorIdentity] : undefined),
  );
  return !input.mode.publishedKeys.includes(key);
}

/** The kind a walk through the stepper starts from for a template: a layout
 *  template's own kind, else the kind whose era standard it is (m15land →
 *  land, m15pw → planeswalker), else the first kind that can wear it (skins
 *  and showcase treatments). */
export function walkthroughKindFor(template: FrameTemplate): CardKind {
  for (const kind of CARD_KIND_VALUES) {
    if (KIND_DEFS[kind].layoutTemplates?.includes(template)) return kind;
  }
  for (const kind of CARD_KIND_VALUES) {
    const def = KIND_DEFS[kind];
    if (def.layoutTemplates) continue;
    if (FRAME_ERA_VALUES.some((era) => ERA_TYPE_FRAME[era]?.[def.cardType] === template)) {
      return kind;
    }
  }
  return CARD_KIND_VALUES.find((kind) => templateSupportsKind(template, kind)) ?? "creature";
}

/** The `kind` a walk-through URL carries, validated: a real kind the
 *  template can wear, else the template's own. */
export function walkthroughKind(
  template: FrameTemplate,
  raw: string | null | undefined,
): CardKind {
  const candidate = (CARD_KIND_VALUES as readonly string[]).includes(raw ?? "")
    ? (raw as CardKind)
    : null;
  return candidate && templateSupportsKind(template, candidate)
    ? candidate
    : walkthroughKindFor(template);
}

/** How the creator is prefilled: the combo's reference printing (the
 *  compare view's own content), placeholder sample content, or nothing. */
export type WalkthroughSeedMode = "reference" | "sample" | "none";

export function parseWalkthroughSeed(raw: string | null | undefined): WalkthroughSeedMode {
  return raw === "reference" || raw === "sample" ? raw : "none";
}

/** The "Walk the stepper" link for a checklist row: the creator in admin
 *  preview mode on this frame and colour, prefilled from the reference. */
export function walkthroughHref(input: {
  template: FrameTemplate;
  colorKey: FrameColorKey | string;
  kind?: CardKind;
  seed?: WalkthroughSeedMode;
}): string {
  const params = new URLSearchParams({
    [PREVIEW_FRAMES_PARAM]: "all",
    kind: input.kind ?? walkthroughKindFor(input.template),
    template: input.template,
    color: input.colorKey,
  });
  const seed = input.seed ?? "reference";
  if (seed !== "none") params.set("seed", seed);
  return `/create?${params.toString()}`;
}

/** The first colour of a template still worth walking: unverified or
 *  needing re-verification first, else white. */
export function firstColourToWalk(
  combos: ReadonlyArray<{ colorKey: string; verified: boolean; stale?: boolean }>,
): string {
  return (
    combos.find((c) => !c.verified)?.colorKey ??
    combos.find((c) => c.stale)?.colorKey ??
    "w"
  );
}

/** The edit URL a preview save lands on — it keeps the preview mode so the
 *  banner and the picker survive the create → edit hop. */
export function withPreviewFramesParam(href: string, param: string | null | undefined): string {
  if (!param) return href;
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set(PREVIEW_FRAMES_PARAM, param);
  return `${path}?${params.toString()}`;
}

/** The same URL with the preview-mode parameters dropped ("Exit preview"). */
export function withoutPreviewParams(path: string, search: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (
      value === undefined ||
      [PREVIEW_FRAMES_PARAM, "seed", "template", "color", "kind", "ref"].includes(key)
    ) {
      continue;
    }
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
