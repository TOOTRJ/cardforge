"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronDown, Footprints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FrameVerifyCheckbox } from "@/components/admin/frame-verify-checkbox";
import {
  FramePreviewList,
  type FramePreviewListItem,
} from "@/components/admin/frame-preview-list";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The frame verification checklist — every (template, color) combination the
// site ships, grouped era → template, with the real reference printing next
// to each row. Checking a row publishes that combination to the frame picker
// (see lib/cards/frame-availability.ts); "Compare" opens the overlay tool;
// "Walk" opens the creator on the combo in admin preview mode, prefilled
// from the reference (TODO 2.2). Under each template: its walked preview
// cards (2.3) and the link to the per-template sign-off (2.4).
//
// All data arrives serialized from the server page (reviews + references
// resolved there) — this component only renders and mutates.
// ---------------------------------------------------------------------------

type ChecklistCombo = {
  colorKey: string;
  colorLabel: string;
  verified: boolean;
  /** True when the reference is admin-pinned rather than the registry default. */
  isCustomReference?: boolean;
  /** Further registry printings the compare view can switch to. */
  alternates?: number;
  /** Scan-quality caveat of the default printing (null = ideal). */
  tier?: string | null;
  /** The reference id the checkbox records with a tick. */
  referenceId?: string | null;
  /** Verified, but the renderer or the override changed since (reasons). */
  stale?: boolean;
  staleReasons?: string[];
  /** Verified before ticks recorded what they measured. */
  legacy?: boolean;
  reference: { name: string; set: string; thumbUrl: string } | null;
  /** "Walk the stepper" on this combination (TODO 2.2). */
  walkHref?: string;
};

type ChecklistTemplate = {
  template: string;
  label: string;
  /** True when a frame_profile_overrides row is active for this template. */
  hasOverride?: boolean;
  /** Curator note from the registry (shown on hover) and whether the
   *  family needs a human eye on the thumbnail before trusting it. */
  note?: string | null;
  confirm?: boolean;
  /** The face this template's rows verify (TODO 5.0b): "back" for a
   *  back-face frame, whose rows show, compare, walk and tick the
   *  printing's back. Absent = the front. */
  face?: "front" | "back";
  combos: ChecklistCombo[];
  /** Walk the stepper on the first colour still to verify (TODO 2.2). */
  walkHref?: string;
  /** The per-template sign-off view (TODO 2.4). */
  signOffHref?: string;
  /** Preview cards walked on this frame (TODO 2.3). */
  previews?: FramePreviewListItem[];
};

export type ChecklistEra = {
  era: string;
  label: string;
  templates: ChecklistTemplate[];
};

const COLOR_DOT: Record<string, string> = {
  w: "#f7eccb",
  u: "#7cc3ee",
  b: "#5b5550",
  r: "#ec6f4c",
  g: "#79b664",
  c: "#b8b5b3",
  m: "conic-gradient(from 45deg, #cfb787, #7cc3ee, #ec6f4c, #79b664, #c98cf7, #cfb787)",
};

function ColorDot({ colorKey }: { colorKey: string }) {
  const bg = COLOR_DOT[colorKey] ?? "#b8b5b3";
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)]"
      style={{ background: bg }}
    />
  );
}

export function FrameReviewChecklist({ eras }: { eras: ChecklistEra[] }) {
  return (
    <div className="flex flex-col gap-10">
      {eras.map((era) => {
        const combos = era.templates.flatMap((t) => t.combos);
        const done = combos.filter((c) => c.verified).length;
        const stale = combos.filter((c) => c.verified && c.stale).length;
        return (
          <details
            key={era.era}
            className="group rounded-lg border border-border/50 bg-elevated/30"
          >
            <summary
              className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden"
              title="Click to expand this era's frames"
            >
              <ChevronDown
                className="h-4 w-4 shrink-0 -rotate-90 text-subtle transition-transform group-open:rotate-0"
                aria-hidden
              />
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-foreground">
                {era.label}
              </h2>
              <span className="text-xs text-subtle">
                {era.templates.length} frame{era.templates.length === 1 ? "" : "s"}
              </span>
              <span className="ml-auto flex items-center gap-2">
                {stale > 0 ? (
                  <Badge variant="default">{stale} need re-verification</Badge>
                ) : null}
                <Badge variant={done === combos.length ? "primary" : "default"}>
                  {done}/{combos.length} verified
                </Badge>
              </span>
            </summary>
            <div className="grid gap-4 border-t border-border/40 p-4 lg:grid-cols-2">
              {era.templates.map((tpl) => (
                <SurfaceCard key={tpl.template} className="flex flex-col p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {tpl.label}
                      <span className="ml-2 font-mono text-[11px] text-subtle">
                        {tpl.template}
                      </span>
                    </span>
                    {tpl.face === "back" ? (
                      <span
                        className="mr-2 rounded-full border border-border-strong/60 bg-elevated px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-foreground"
                        title="A back-face frame: every row is compared, scored, walked and ticked against the printing's BACK face."
                        data-testid="checklist-face-back"
                      >
                        back face
                      </span>
                    ) : null}
                    {tpl.hasOverride ? (
                      <span
                        className="mr-2 rounded-full border border-sky-400/50 bg-sky-400/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-300"
                        title="A layout override from the visual editor is active for this template (DB, not code)."
                      >
                        override active
                      </span>
                    ) : null}
                    {tpl.confirm ? (
                      <span
                        className="mr-2 rounded-full border border-gold/50 bg-gold/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-gold-strong"
                        title={tpl.note ?? "Confirm the thumbnail before trusting these references."}
                      >
                        confirm refs
                      </span>
                    ) : tpl.note ? (
                      <span
                        className="mr-2 cursor-help text-[10px] text-subtle"
                        title={tpl.note}
                      >
                        note
                      </span>
                    ) : null}
                    <span className="text-[10px] uppercase tracking-wider text-gold-strong">
                      publishes on verify
                    </span>
                  </div>
                  <ul className="flex flex-col">
                    {tpl.combos.map((combo) => (
                      <li
                        key={combo.colorKey}
                        className="flex items-center gap-3 border-t border-border/40 py-2 first:border-t-0"
                      >
                        <span title="Tick when this frame + color renders near-perfectly — verified combos of unreleased frames become available to all users in the card creator.">
                          <FrameVerifyCheckbox
                            template={tpl.template}
                            colorKey={combo.colorKey}
                            verified={combo.verified}
                            referenceId={combo.referenceId ?? null}
                          />
                        </span>
                        <ColorDot colorKey={combo.colorKey} />
                        {combo.reference ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={combo.reference.thumbUrl}
                              alt=""
                              loading="lazy"
                              className="h-11 w-8 shrink-0 rounded-[2px] border border-border/50 object-cover"
                            />
                            <span className="flex min-w-0 flex-1 flex-col leading-tight">
                              <span className="truncate text-xs text-foreground">
                                {combo.reference.name}
                              </span>
                              <span
                                className="text-[10px] uppercase tracking-wider text-subtle"
                                title={combo.tier ?? undefined}
                              >
                                {combo.reference.set}
                                {combo.isCustomReference ? " · custom" : ""}
                                {combo.alternates ? ` · +${combo.alternates}` : ""}
                                {combo.tier ? " · ⚠" : ""}
                              </span>
                            </span>
                          </>
                        ) : (
                          <span className="min-w-0 flex-1 text-xs italic text-subtle">
                            No real printing — sample render only
                          </span>
                        )}
                        {combo.verified && combo.stale ? (
                          <span
                            className="shrink-0 rounded-full border border-gold/50 bg-gold/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-gold-strong"
                            title={(combo.staleReasons ?? []).join(" ")}
                          >
                            re-verify
                          </span>
                        ) : combo.verified && combo.legacy ? (
                          <span
                            className="shrink-0 text-[9px] uppercase tracking-wide text-subtle"
                            title="Verified before ticks recorded the layout version and override — tick again to record it."
                          >
                            no record
                          </span>
                        ) : null}
                        {combo.verified ? (
                          <CheckCircle2
                            className="h-4 w-4 shrink-0 text-primary-bright"
                            aria-hidden
                          />
                        ) : null}
                        {combo.walkHref ? (
                          <Link
                            href={combo.walkHref}
                            title={`Walk the stepper: open the creator on this frame and colour as an admin preview, prefilled from the reference printing${
                              tpl.face === "back" ? ", with the preview on the back face" : ""
                            }.`}
                            aria-label={`Walk the stepper on ${tpl.template}/${combo.colorKey}${
                              tpl.face === "back" ? " (back face)" : ""
                            }`}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
                          >
                            <Footprints className="h-3 w-3" aria-hidden /> Walk
                          </Link>
                        ) : null}
                        <Link
                          href={`/admin/frame-compare?template=${tpl.template}&color=${combo.colorKey}`}
                          title="Open the compare & edit view: overlay the real printing on our render, adjust the layout, score the alignment."
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground",
                          )}
                        >
                          Compare <ArrowRight className="h-3 w-3" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {tpl.walkHref || tpl.signOffHref ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
                      {tpl.walkHref ? (
                        <Link
                          href={tpl.walkHref}
                          title="Walk the stepper on this frame (first colour still to verify), prefilled from its reference printing."
                          className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
                        >
                          <Footprints className="h-3 w-3" aria-hidden /> Walk the stepper
                        </Link>
                      ) : null}
                      {tpl.signOffHref ? (
                        <Link
                          href={tpl.signOffHref}
                          title="Score every colour, see the walked previews and publish the whole template."
                          className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
                        >
                          Sign off template <ArrowRight className="h-3 w-3" aria-hidden />
                        </Link>
                      ) : null}
                      {tpl.previews && tpl.previews.length > 0 ? (
                        <span className="ml-auto text-[10px] uppercase tracking-wider text-subtle">
                          {tpl.previews.length} walked preview{tpl.previews.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {tpl.previews && tpl.previews.length > 0 ? (
                    <FramePreviewList items={tpl.previews} className="mt-2" />
                  ) : null}
                </SurfaceCard>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
