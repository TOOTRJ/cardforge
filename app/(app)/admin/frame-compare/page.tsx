import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { FrameCompare } from "@/components/admin/frame-compare";
import {
  FrameReviewChecklist,
  type ChecklistEra,
} from "@/components/admin/frame-review-checklist";
import { FrameVerifyCheckbox } from "@/components/admin/frame-verify-checkbox";
import { FrameReferencePicker } from "@/components/admin/frame-reference-picker";
import { FrameGuide } from "@/components/admin/frame-guide";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import {
  FRAME_COLOR_KEYS,
  FRAME_REFERENCES,
  frameComboKey,
  referenceThumbUrl,
  sampleFramePreview,
  type FrameColorKey,
} from "@/lib/cards/frame-reference-registry";
import { GRANDFATHERED_TEMPLATES } from "@/lib/cards/frame-availability";
import { getFrameReviews } from "@/lib/cards/frame-reviews";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import { getCurrentProfile } from "@/lib/supabase/server";
import type { CardPreviewData } from "@/components/cards/card-preview";
import {
  FRAME_ERA_LABELS,
  FRAME_ERA_VALUES,
  FRAME_TEMPLATE_LABELS,
  FRAME_TEMPLATE_VALUES,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";

// ---------------------------------------------------------------------------
// Admin — frame verification.
//
// Checklist mode (default): every (template, color) combination the site
// ships, grouped by era, with its real reference printing and a verify
// checkbox. Checking publishes the combination to the frame picker for all
// users (lib/cards/frame-availability.ts); templates that predate the
// system are grandfathered live.
//
// Compare mode (?template=&color=): renders the reference card through OUR
// pipeline (content mapped live from Scryfall — no hand transcription) and
// overlays the official scan with overlay / side-by-side / difference
// modes. Admin-only; the Scryfall lookup isn't logged to scryfall_calls
// (that table backs per-user quotas for end-user features).
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Frame compare",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function isTemplate(value: string | undefined): value is FrameTemplate {
  return (FRAME_TEMPLATE_VALUES as readonly string[]).includes(value ?? "");
}

function isColorKey(value: string | undefined): value is FrameColorKey {
  return (FRAME_COLOR_KEYS as readonly string[]).includes(value ?? "");
}

export default async function AdminFrameComparePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; color?: string }>;
}) {
  const profile = await getCurrentProfile();
  // Non-admins get a 404 (don't reveal the route exists).
  if (!profile?.is_admin) notFound();

  const { template, color } = await searchParams;
  const reviews = await getFrameReviews();

  // ----- Compare mode -----
  if (isTemplate(template) && isColorKey(color)) {
    const review = reviews.get(frameComboKey(template, color));
    // Admin-pinned reference wins over the registry default.
    const custom = review?.referenceScryfallId
      ? {
          name: review.referenceName ?? "Pinned printing",
          set: review.referenceSet ?? "",
          scryfallId: review.referenceScryfallId,
        }
      : null;
    const reference = custom ?? FRAME_REFERENCES[template][color];
    const payload = reference
      ? await buildFrameComparePayload(reference.scryfallId, template)
      : null;

    const verified = review?.verified ?? false;
    const overrides = await getFrameProfileOverrides();

    // Fall back to sample content when there's no reference (or the lookup
    // failed) — the frame can still be eyeballed. Saved layout overrides are
    // attached so this page renders EXACTLY what users see (the editor's
    // draft supersedes them while editing).
    const basePreview =
      payload?.preview ??
      (sampleFramePreview(template, color) as CardPreviewData);
    const preview: CardPreviewData = { ...basePreview, profileOverrides: overrides };

    return (
      <DashboardShell>
        <Link
          href="/admin/frame-compare"
          className="mb-4 inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to all frames
        </Link>
        <PageHeader
          eyebrow="Admin · Frame compare"
          title={`${FRAME_TEMPLATE_LABELS[template]} · ${color.toUpperCase()}`}
          description={
            reference
              ? `Reference: ${reference.name} (${reference.set.toUpperCase()})${custom ? " — admin-pinned" : ""}. Difference mode: aligned pixels go dark, drift glows.`
              : "No real printing exists for this combination — eyeball the sample render."
          }
          actions={
            <span className="flex flex-wrap items-center gap-4">
              <FrameReferencePicker
                template={template}
                colorKey={color}
                isCustom={Boolean(custom)}
              />
              <FrameVerifyCheckbox
                template={template}
                colorKey={color}
                verified={verified}
                withLabel
              />
            </span>
          }
        />
        <div className="mt-6 flex flex-col gap-4">
          <FrameGuide />
          <FrameCompare
            key={`${template}/${color}/${JSON.stringify(overrides[template] ?? null)}`}
            preview={preview}
            scanUrl={payload?.scanUrl ?? null}
            scanAlt={`Official scan of ${reference?.name ?? "reference card"}`}
            template={template}
            colorKey={color}
            savedOverride={overrides[template] ?? null}
          />
        </div>
      </DashboardShell>
    );
  }

  // ----- Checklist mode -----
  const templatesByEra = new Map<FrameEra, FrameTemplate[]>();
  for (const t of FRAME_TEMPLATE_VALUES) {
    const era = eraForTemplate(t);
    templatesByEra.set(era, [...(templatesByEra.get(era) ?? []), t]);
  }

  const checklistOverrides = await getFrameProfileOverrides();
  const eras: ChecklistEra[] = FRAME_ERA_VALUES.filter((era) =>
    templatesByEra.has(era),
  ).map((era) => ({
    era,
    label: FRAME_ERA_LABELS[era],
    templates: (templatesByEra.get(era) ?? []).map((t) => ({
      template: t,
      label: FRAME_TEMPLATE_LABELS[t],
      grandfathered: GRANDFATHERED_TEMPLATES.has(t),
      hasOverride: Boolean(checklistOverrides[t]),
      combos: FRAME_COLOR_KEYS.map((colorKey) => {
        const review = reviews.get(frameComboKey(t, colorKey));
        const custom = review?.referenceScryfallId
          ? {
              name: review.referenceName ?? "Pinned printing",
              set: review.referenceSet ?? "",
              scryfallId: review.referenceScryfallId,
            }
          : null;
        const reference = custom ?? FRAME_REFERENCES[t][colorKey];
        return {
          colorKey,
          colorLabel: colorKey.toUpperCase(),
          verified: review?.verified ?? false,
          isCustomReference: Boolean(custom),
          reference: reference
            ? {
                name: reference.name,
                set: reference.set,
                thumbUrl: referenceThumbUrl(reference),
              }
            : null,
        };
      }),
    })),
  }));

  const allCombos = eras.flatMap((e) => e.templates).flatMap((t) => t.combos);
  const verifiedCount = allCombos.filter((c) => c.verified).length;

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Frame verification"
        description="Every frame/color combination the site ships, with the real printing to verify against. Checking a box publishes that combination to the frame picker; special layouts stay hidden until verified."
        actions={
          <Badge variant="primary">
            {verifiedCount}/{allCombos.length} verified
          </Badge>
        }
      />
      <div className="mt-6 flex flex-col gap-4">
        <FrameGuide defaultOpen />
        <FrameReviewChecklist eras={eras} />
      </div>
    </DashboardShell>
  );
}
