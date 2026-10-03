import {
  FrameColoursSideBySide,
  type SideBySideColour,
} from "@/components/admin/frame-colours-side-by-side";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FRAME_COLOR_KEYS,
  sampleFramePreview,
  type FrameColorKey,
  type FrameReference,
} from "@/lib/cards/frame-reference-registry";
import type { CardFace } from "@/lib/cards/card-face";
import { resolveFrameProfile, type FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Server half of the sign-off's side-by-side (TODO 4.12): each colour's
// compare payload — the reference printing's content mapped through the
// import mapper and its scan, exactly what Compare and the score use — with
// today's layout overrides attached. Rendered inside a Suspense boundary so
// the rest of the sign-off streams first; a failed Scryfall lookup falls
// back to the colour's sample content and says so, like Compare does. The
// page has already checked is_admin.
//
// The sign-off refreshes after every Score, tick and scoring job, and a
// printing's content doesn't change between them: a lookup that succeeded
// is reused for LOOKUP_TTL_MS by this server instance instead of asking
// Scryfall seven times per refresh (only today's overrides are attached
// fresh). A lookup that hangs is given up after LOOKUP_TIMEOUT_MS — the
// Scryfall client has no timeout of its own — and that colour shows its
// sample, so one slow request can't hold the section's skeleton forever.
//
// Per FACE (TODO 5.0b): a back body's colours are each printing's BACK
// face next to its back scan (the face is part of the memo key); a lookup
// of a face the printing lacks shows the sample like a failed one.
// ---------------------------------------------------------------------------

/** A successful lookup is reused this long. */
export const LOOKUP_TTL_MS = 30 * 60_000;
/** A lookup still unanswered after this falls back to the sample. */
export const LOOKUP_TIMEOUT_MS = 8_000;
const LOOKUP_MEMO_MAX = 256;

type Lookup = { preview: CardPreviewData; scanUrl: string | null };
const lookups = new Map<string, { at: number; lookup: Lookup }>();

async function lookUp(scryfallId: string, template: FrameTemplate, face: CardFace): Promise<Lookup | null> {
  const key = `${template}:${scryfallId}:${face}`;
  const hit = lookups.get(key);
  if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.lookup;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
  });
  const payload = await Promise.race([
    buildFrameComparePayload(scryfallId, template, face).catch(() => null),
    timedOut,
  ]).finally(() => clearTimeout(timer));
  if (!payload) return null;
  const lookup = { preview: payload.preview, scanUrl: payload.scanUrl };
  lookups.delete(key);
  lookups.set(key, { at: Date.now(), lookup });
  if (lookups.size > LOOKUP_MEMO_MAX) {
    const oldest = lookups.keys().next().value;
    if (oldest !== undefined) lookups.delete(oldest);
  }
  return lookup;
}

/** Test hook — the memo is module-global. */
export function __resetSideBySideLookupsForTests() {
  lookups.clear();
}

export async function FrameSignOffSideBySide({
  template,
  references,
  overrides,
  scores,
  face = "front",
}: {
  template: FrameTemplate;
  references: ReadonlyMap<FrameColorKey, FrameReference | null>;
  overrides: FrameProfileOverridesMap;
  scores: ReadonlyMap<string, { state: string; overall: number | null }>;
  /** The face every colour is compared on (a back body's back). */
  face?: CardFace;
}) {
  const colours: SideBySideColour[] = await Promise.all(
    FRAME_COLOR_KEYS.map(async (colorKey): Promise<SideBySideColour> => {
      const reference = references.get(colorKey) ?? null;
      const payload = reference ? await lookUp(reference.scryfallId, template, face) : null;
      const base = payload?.preview ?? (sampleFramePreview(template, colorKey) as CardPreviewData);
      return {
        colorKey,
        preview: { ...base, profileOverrides: overrides },
        scanUrl: payload?.scanUrl ?? null,
        referenceName: reference ? `${reference.name} (${reference.set.toUpperCase()})` : null,
        sample: !payload,
        score: scores.get(colorKey) ?? { state: "unscored", overall: null },
        compareHref: `/admin/frame-compare?template=${template}&color=${colorKey}`,
      };
    }),
  );
  const landscape = resolveFrameProfile(template, overrides).orientation === "landscape";
  return <FrameColoursSideBySide colours={colours} landscape={landscape} />;
}

export function FrameSignOffSideBySideSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden data-testid="signoff-side-by-side-loading">
      {FRAME_COLOR_KEYS.map((key) => (
        <Skeleton key={key} className="aspect-[5/7] w-full" />
      ))}
    </div>
  );
}
