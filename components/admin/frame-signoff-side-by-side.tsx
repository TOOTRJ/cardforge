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
// ---------------------------------------------------------------------------

export async function FrameSignOffSideBySide({
  template,
  references,
  overrides,
  scores,
}: {
  template: FrameTemplate;
  references: ReadonlyMap<FrameColorKey, FrameReference | null>;
  overrides: FrameProfileOverridesMap;
  scores: ReadonlyMap<string, { state: string; overall: number | null }>;
}) {
  const colours: SideBySideColour[] = await Promise.all(
    FRAME_COLOR_KEYS.map(async (colorKey): Promise<SideBySideColour> => {
      const reference = references.get(colorKey) ?? null;
      const payload = reference
        ? await buildFrameComparePayload(reference.scryfallId, template).catch(() => null)
        : null;
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
