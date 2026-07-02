"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FrameVerifyCheckbox } from "@/components/admin/frame-verify-checkbox";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The frame verification checklist — every (template, color) combination the
// site ships, grouped era → template, with the real reference printing next
// to each row. Checking a row publishes that combination to the frame picker
// (see lib/cards/frame-availability.ts); "Compare" opens the overlay tool.
//
// All data arrives serialized from the server page (reviews + references
// resolved there) — this component only renders and mutates.
// ---------------------------------------------------------------------------

export type ChecklistCombo = {
  colorKey: string;
  colorLabel: string;
  verified: boolean;
  reference: { name: string; set: string; thumbUrl: string } | null;
};

export type ChecklistTemplate = {
  template: string;
  label: string;
  /** True when the template was user-pickable before verification existed —
   *  gating doesn't apply to it (it's grandfathered live). */
  grandfathered: boolean;
  combos: ChecklistCombo[];
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
        return (
          <section key={era.era} className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-subtle">
                {era.label}
              </h2>
              <Badge variant={done === combos.length ? "primary" : "default"}>
                {done}/{combos.length} verified
              </Badge>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {era.templates.map((tpl) => (
                <SurfaceCard key={tpl.template} className="flex flex-col p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {tpl.label}
                      <span className="ml-2 font-mono text-[11px] text-subtle">
                        {tpl.template}
                      </span>
                    </span>
                    {tpl.grandfathered ? (
                      <span
                        className="text-[10px] uppercase tracking-wider text-subtle"
                        title="Already user-pickable before verification existed — the checkbox tracks QA but can't withdraw it."
                      >
                        live (grandfathered)
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wider text-gold-strong">
                        publishes on verify
                      </span>
                    )}
                  </div>
                  <ul className="flex flex-col">
                    {tpl.combos.map((combo) => (
                      <li
                        key={combo.colorKey}
                        className="flex items-center gap-3 border-t border-border/40 py-2 first:border-t-0"
                      >
                        <FrameVerifyCheckbox
                          template={tpl.template}
                          colorKey={combo.colorKey}
                          verified={combo.verified}
                        />
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
                              <span className="text-[10px] uppercase tracking-wider text-subtle">
                                {combo.reference.set}
                              </span>
                            </span>
                          </>
                        ) : (
                          <span className="min-w-0 flex-1 text-xs italic text-subtle">
                            No real printing — sample render only
                          </span>
                        )}
                        {combo.verified ? (
                          <CheckCircle2
                            className="h-4 w-4 shrink-0 text-primary-bright"
                            aria-hidden
                          />
                        ) : null}
                        <Link
                          href={`/admin/frame-compare?template=${tpl.template}&color=${combo.colorKey}`}
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground",
                          )}
                        >
                          Compare <ArrowRight className="h-3 w-3" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </SurfaceCard>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
