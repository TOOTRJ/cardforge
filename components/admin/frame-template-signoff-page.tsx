import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { MarkedRendersPanel } from "@/components/admin/marked-renders-panel";
import {
  FrameTemplateSignOff,
  type SignOffColourView,
} from "@/components/admin/frame-template-signoff";
import {
  FrameSignOffSideBySide,
  FrameSignOffSideBySideSkeleton,
} from "@/components/admin/frame-signoff-side-by-side";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import {
  FRAME_COLOR_KEYS,
  frameComboKey,
  referenceThumbUrl,
} from "@/lib/cards/frame-reference-registry";
import { pickFrameReferenceFrom } from "@/lib/cards/frame-reference-pick";
import type { FrameReview } from "@/lib/cards/frame-reviews";
import {
  latestScoreEvents,
  latestScoreEventsForTemplates,
} from "@/lib/cards/frame-review-events";
import {
  overrideHash,
  verificationState,
} from "@/lib/cards/frame-verification-state";
import { signOffStatus } from "@/lib/cards/frame-signoff";
import { listFramePreviewCards } from "@/lib/cards/frame-preview-cards";
import { framePreviewEditHref } from "@/lib/cards/frame-preview-groups";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { walkthroughHref } from "@/lib/creator/frame-preview";
import { eraGroupFrameLabel } from "@/lib/creator/frame-resolve";
import { listSlotPaths, resolveFrameProfile } from "@/lib/cards/profile-override";
import { parseRecordedScore, templatesForTreatment } from "@/lib/frames/score-batch";
import { buildTreatmentView } from "@/lib/frames/treatment-summary";
import { FRAME_TEMPLATE_SET, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// /admin/frame-compare?template=<t> (no colour) — the per-template sign-off
// (TODO 2.4). Server half: reads the reviews, the recorded scores, the
// override hash and the walked previews, derives the sign-off status with
// the same pure rule the publish action enforces, and hands the client view
// serialisable rows. The page has already checked is_admin.
//
// Verification throughput (TODO 4.12) adds: every colour side by side (our
// render next to its printing, streamed in its own Suspense boundary), the
// recorded per-slot scores + nudges for the results table, and — when the
// template's treatment (frame set) has other frames — their score states
// and the slots they share, for "Score the treatment".
// ---------------------------------------------------------------------------

export async function FrameTemplateSignOffPage({
  template,
  reviews,
  markedCount,
  viewerId,
}: {
  template: FrameTemplate;
  reviews: Map<string, FrameReview>;
  markedCount: number;
  viewerId: string;
}) {
  const treatmentTemplates = templatesForTreatment(FRAME_TEMPLATE_SET[template]);
  const [overrides, scores, treatmentScores] = await Promise.all([
    getFrameProfileOverrides(),
    latestScoreEvents(template),
    treatmentTemplates.length > 1
      ? latestScoreEventsForTemplates(treatmentTemplates)
      : Promise.resolve(new Map()),
  ]);
  const previews = (
    await listFramePreviewCards(viewerId, { profileOverrides: overrides })
  ).filter((card) => card.template === template);
  const currentHash = overrideHash(overrides[template] ?? null);

  const references = new Map(
    FRAME_COLOR_KEYS.map((k) => [k, pickFrameReferenceFrom(reviews, template, k)] as const),
  );
  const status = signOffStatus({
    template,
    currentOverrideHash: currentHash,
    colours: FRAME_COLOR_KEYS.map((colorKey) => ({
      colorKey,
      referenceId: references.get(colorKey)?.scryfallId ?? null,
      score: scores.get(colorKey) ?? null,
    })),
  });

  const colours: SignOffColourView[] = status.colours.map((colourStatus) => {
    const colorKey = colourStatus.colorKey;
    const review = reviews.get(frameComboKey(template, colorKey));
    const reference = references.get(colorKey) ?? null;
    const detail = parseRecordedScore(scores.get(colorKey)?.scoreJson);
    const state = verificationState(
      {
        verified: review?.verified ?? false,
        verifiedLayoutVersion: review?.verifiedLayoutVersion ?? null,
        verifiedOverrideHash: review?.verifiedOverrideHash ?? null,
      },
      template,
      currentHash,
    );
    return {
      colorKey,
      reference: reference
        ? { name: reference.name, set: reference.set, thumbUrl: referenceThumbUrl(reference) }
        : null,
      referenceId: reference?.scryfallId ?? null,
      verified: state.verified,
      stale: state.stale,
      legacy: state.legacy,
      staleReasons: state.reasons,
      verifiedLayoutVersion: review?.verifiedLayoutVersion ?? null,
      verifiedOverrideHash: review?.verifiedOverrideHash ?? null,
      score: {
        state: colourStatus.state,
        overall: colourStatus.overall,
        reasons: colourStatus.reasons,
        createdAt: scores.get(colorKey)?.createdAt ?? null,
        fromTick: scores.get(colorKey)?.action === "verify",
        global: detail?.global ?? null,
        slots: detail && Object.keys(detail.slots).length > 0 ? detail.slots : null,
      },
      walkHref: walkthroughHref({ template, colorKey }),
      compareHref: `/admin/frame-compare?template=${template}&color=${colorKey}`,
      previews: previews
        .filter((card) => card.colorKey === colorKey)
        .map((card) => ({
          id: card.id,
          title: card.title,
          colorKey: card.colorKey,
          createdAt: card.createdAt,
          editHref: card.ownedByViewer ? framePreviewEditHref(card) : null,
          previewData: card.previewData,
        })),
    };
  });
  const verifiedCount = colours.filter((c) => c.verified).length;
  // Every slot the frame has (no kind): the results table orders the slots
  // each colour's reference scored — its kind's (score-combo.ts).
  const slotOrder = listSlotPaths(resolveFrameProfile(template, overrides));
  const treatment = buildTreatmentView({
    template,
    reviews,
    overrides,
    scores: treatmentScores,
    labelFor: eraGroupFrameLabel,
  });
  const scoreSummary = new Map(
    colours.map((c) => [c.colorKey, { state: c.score.state, overall: c.score.overall }] as const),
  );

  return (
    <DashboardShell>
      <Link
        href="/admin/frame-compare"
        className="mb-4 inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to all frames
      </Link>
      <PageHeader
        // The template key beside the label: two frames can share a label
        // across eras ("Token" = m20token and alphatoken, TODO 4.48a).
        eyebrow={`Admin · Frame sign-off · ${template}`}
        title={`${eraGroupFrameLabel(template)} · sign-off`}
        description="Score every colour against its reference in one job, compare them side by side, walk the stepper on the frame, then publish the template in one go. Scoring never ticks anything; each colour stays individually withdrawable."
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="default">{previews.length} walked previews</Badge>
            <Badge variant="primary">
              {verifiedCount}/{colours.length} verified
            </Badge>
          </span>
        }
      />
      <MarkedRendersPanel initialCount={markedCount} />
      <section className="mt-6 flex flex-col gap-3" aria-labelledby="signoff-side-by-side-heading">
        <h2 id="signoff-side-by-side-heading" className="text-sm font-semibold text-foreground">
          Every colour, side by side
        </h2>
        <Suspense fallback={<FrameSignOffSideBySideSkeleton />}>
          <FrameSignOffSideBySide
            template={template}
            references={references}
            overrides={overrides}
            scores={scoreSummary}
          />
        </Suspense>
      </section>
      <div className="mt-6">
        <FrameTemplateSignOff
          template={template}
          currentVersion={CARD_LAYOUT_VERSION}
          currentHash={currentHash}
          colours={colours}
          ready={status.ready}
          publishableCount={status.publishable.length}
          slotOrder={slotOrder}
          treatment={treatment}
        />
      </div>
    </DashboardShell>
  );
}
