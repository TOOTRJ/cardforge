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
  findFrameReference,
  frameComboKey,
  frameReferenceNote,
  frameReferenceOptions,
  referenceThumbUrl,
  referenceTierLabel,
  sampleFramePreview,
  type FrameColorKey,
  type FrameReference,
} from "@/lib/cards/frame-reference-registry";
import { getFrameReviews } from "@/lib/cards/frame-reviews";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import { getCurrentProfile } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
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
// users; unchecking withdraws it — verification is the only availability
// gate (lib/cards/frame-availability.ts).
//
// Compare mode (?template=&color=[&ref=]): renders the reference card
// through OUR pipeline (content mapped live from Scryfall — no hand
// transcription) and overlays the official scan with overlay / side-by-side
// / difference modes. The registry lists several printings per combo
// (short text, long text, another set); `ref` picks one of them, an
// admin-pinned printing wins when no `ref` is given. Admin-only; the
// Scryfall lookup isn't logged to scryfall_calls (that table backs per-user
// quotas for end-user features).
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

/** The switcher between the registry's printings for a combo (+ the pinned
 *  one). Plain links: the page is server-rendered per request. */
function ReferenceSwitcher({
  template,
  color,
  options,
  activeId,
  pinned,
}: {
  template: FrameTemplate;
  color: FrameColorKey;
  options: FrameReference[];
  activeId: string | null;
  pinned: FrameReference | null;
}) {
  if (options.length + (pinned ? 1 : 0) < 2) return null;
  const chip = (label: string, href: string, active: boolean, title?: string) => (
    <Link
      key={href}
      href={href}
      title={title}
      className={cn(
        "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border/50 text-muted hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
  const base = `/admin/frame-compare?template=${template}&color=${color}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="reference-switcher">
      <span className="text-[11px] uppercase tracking-wider text-subtle">Reference</span>
      {pinned
        ? chip(`Pinned · ${pinned.name} (${pinned.set.toUpperCase()})`, base, activeId === null)
        : null}
      {options.map((option, index) => {
        const tier = referenceTierLabel(option);
        return chip(
          `${option.name} (${option.set.toUpperCase()})${index === 0 ? " · default" : ""}${tier ? " · ⚠" : ""}`,
          `${base}&ref=${option.scryfallId}`,
          activeId === option.scryfallId,
          tier ?? undefined,
        );
      })}
    </div>
  );
}

export default async function AdminFrameComparePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; color?: string; ref?: string }>;
}) {
  const profile = await getCurrentProfile();
  // Non-admins get a 404 (don't reveal the route exists).
  if (!profile?.is_admin) notFound();

  const { template, color, ref } = await searchParams;
  const reviews = await getFrameReviews();

  // ----- Compare mode -----
  if (isTemplate(template) && isColorKey(color)) {
    const review = reviews.get(frameComboKey(template, color));
    // Admin-pinned reference wins over the registry default — unless the
    // admin explicitly picked one of the registry's printings via ?ref=.
    const pinned: FrameReference | null =
      review?.referenceScryfallId && review.referenceName
        ? {
            name: review.referenceName,
            set: review.referenceSet ?? "",
            scryfallId: review.referenceScryfallId,
          }
        : null;
    const chosen = findFrameReference(template, color, ref);
    const reference = chosen ?? pinned ?? FRAME_REFERENCES[template][color];
    const options = frameReferenceOptions(template, color);
    const { note, confirm } = frameReferenceNote(template);
    const tier = referenceTierLabel(reference);
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

    const referenceLine =
      reference && payload
        ? `Reference: ${reference.name} (${reference.set.toUpperCase()})${
            chosen ? "" : pinned ? " — admin-pinned" : ""
          }.${tier ? ` ⚠ ${tier[0].toUpperCase()}${tier.slice(1)}.` : ""}`
        : reference
          ? `Reference lookup failed (${reference.name}) — showing sample content instead. Reload to retry.`
          : "No real printing exists for this combination — eyeball the sample render.";

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
          description={referenceLine}
          actions={
            <span className="flex flex-wrap items-center gap-4">
              <FrameReferencePicker
                template={template}
                colorKey={color}
                isCustom={Boolean(pinned)}
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
        <div className="mt-4 flex flex-col gap-3">
          <ReferenceSwitcher
            template={template}
            color={color}
            options={options}
            activeId={chosen?.scryfallId ?? (pinned ? null : (reference?.scryfallId ?? null))}
            pinned={pinned}
          />
          {confirm || note ? (
            <p
              className={cn(
                "rounded-md border px-3 py-2 text-xs leading-5",
                confirm
                  ? "border-gold/40 bg-gold/5 text-foreground"
                  : "border-border/50 text-muted",
              )}
              data-testid="reference-note"
            >
              {confirm ? (
                <strong className="mr-1">Confirm the thumbnail before trusting this reference.</strong>
              ) : null}
              {note}
            </p>
          ) : null}
        </div>
        <div className="mt-6 flex flex-col gap-4">
          <FrameGuide />
          <FrameCompare
            key={`${template}/${color}/${reference?.scryfallId ?? "sample"}`}
            preview={preview}
            scanUrl={payload?.scanUrl ?? null}
            scanAlt={`Official scan of ${reference?.name ?? "reference card"}`}
            template={template}
            colorKey={color}
            referenceId={chosen?.scryfallId ?? null}
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
    templates: (templatesByEra.get(era) ?? []).map((t) => {
      const { note, confirm } = frameReferenceNote(t);
      return {
        template: t,
        label: FRAME_TEMPLATE_LABELS[t],
        hasOverride: Boolean(checklistOverrides[t]),
        note,
        confirm,
        combos: FRAME_COLOR_KEYS.map((colorKey) => {
          const review = reviews.get(frameComboKey(t, colorKey));
          const custom =
            review?.referenceScryfallId && review.referenceName
              ? {
                  name: review.referenceName,
                  set: review.referenceSet ?? "",
                  scryfallId: review.referenceScryfallId,
                }
              : null;
          const reference = custom ?? FRAME_REFERENCES[t][colorKey];
          const alternates = Math.max(0, frameReferenceOptions(t, colorKey).length - 1);
          return {
            colorKey,
            colorLabel: colorKey.toUpperCase(),
            verified: review?.verified ?? false,
            isCustomReference: Boolean(custom),
            alternates,
            tier: referenceTierLabel(custom ? null : FRAME_REFERENCES[t][colorKey]),
            reference: reference
              ? {
                  name: reference.name,
                  set: reference.set,
                  thumbUrl: referenceThumbUrl(reference),
                }
              : null,
          };
        }),
      };
    }),
  }));

  const allCombos = eras.flatMap((e) => e.templates).flatMap((t) => t.combos);
  const verifiedCount = allCombos.filter((c) => c.verified).length;
  const withReference = allCombos.filter((c) => c.reference).length;

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Frame verification"
        description="Every frame/color combination the site ships, with the real printing to verify against. Checking a box publishes that combination to the frame picker; special layouts stay hidden until verified."
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="default">
              {withReference}/{allCombos.length} with a reference
            </Badge>
            <Badge variant="primary">
              {verifiedCount}/{allCombos.length} verified
            </Badge>
          </span>
        }
      />
      <div className="mt-6 flex flex-col gap-4">
        <FrameGuide defaultOpen />
        <FrameReviewChecklist eras={eras} />
      </div>
    </DashboardShell>
  );
}
