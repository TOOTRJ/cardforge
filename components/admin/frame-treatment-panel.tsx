"use client";

import Link from "next/link";
import { Gauge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { scoreBatchCounts, useScoreBatch } from "@/components/admin/score-batch-store";
import { frameMatchPct } from "@/lib/cards/frame-signoff";
import { formatNudgePct, type ScoreBatchCombo } from "@/lib/frames/score-batch";
import type { TreatmentView } from "@/lib/frames/treatment-summary";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Batch by treatment" on the sign-off view (TODO 4.12): the other frames of
// this template's treatment (its frame set), each colour's score state by
// the sign-off rule, ONE button that scores every colour of every frame in
// the treatment, and the slots those frames share. A kind's frame spreads
// its base profile (M15BORDERLESSARTIFACT = { ...M15BORDERLESS }), so a slot
// that sits on the same rect is one measured slot: every current colour of
// every frame that shares it votes on one nudge. Each frame still signs off
// on its own page — this panel ticks nothing.
// ---------------------------------------------------------------------------

const STATE_LABEL: Record<string, string> = {
  unscored: "not scored",
  stale: "stale",
  "no-reference": "no printing",
};

export function FrameTreatmentPanel({
  treatment,
  currentTemplate,
  onScore,
}: {
  treatment: TreatmentView;
  currentTemplate: string;
  /** Starts the job (the sign-off's own runner, so its table keeps the
   *  fresh results until the refresh lands). */
  onScore: (input: { scopeKey: string; label: string; combos: ScoreBatchCombo[] }) => Promise<void>;
}) {
  const job = useScoreBatch();
  const running = job.status === "running";
  const ownJob = job.scopeKey === `treatment:${treatment.key}`;
  const counts = scoreBatchCounts(job);
  const needScore = treatment.templates
    .flatMap((t) => t.colours)
    .filter((c) => c.state === "unscored" || c.state === "stale").length;

  return (
    <SurfaceCard className="flex flex-col gap-4 p-4" data-testid="treatment-panel">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-[14rem] flex-1 flex-col leading-tight">
          <span className="text-sm font-semibold text-foreground">
            Treatment · {treatment.label}
          </span>
          <span className="text-[11px] text-subtle">
            {treatment.templates.length} frames · {treatment.combos.length} colours with a printing
            {needScore > 0 ? ` · ${needScore} not scored on today's renderer` : ""}
          </span>
          {running && ownJob ? (
            <span className="text-[11px] text-sky-200" data-testid="treatment-job-status">
              Scoring {counts.finished}/{counts.total} — progress under “Scores per slot” above.
            </span>
          ) : null}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={running || treatment.combos.length === 0}
          onClick={() =>
            void onScore({
              scopeKey: `treatment:${treatment.key}`,
              label: `${treatment.label} treatment`,
              combos: treatment.combos,
            })
          }
          data-testid="score-treatment"
        >
          {running && ownJob ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Gauge className="h-3.5 w-3.5" aria-hidden />
          )}
          Score the treatment ({treatment.combos.length})
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
          <caption className="sr-only">Score state of every colour of every frame in the treatment</caption>
          <thead>
            <tr className="border-b border-border/50 text-[11px] uppercase tracking-wider text-subtle">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Frame
              </th>
              {treatment.templates[0]?.colours.map((c) => (
                <th key={c.colorKey} scope="col" className="px-2 py-1.5 font-medium">
                  {c.colorKey}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {treatment.templates.map((row) => (
              <tr
                key={row.template}
                className={cn("border-b border-border/20", row.template === currentTemplate && "bg-primary/5")}
                data-testid={`treatment-row-${row.template}`}
              >
                <th scope="row" className="py-1.5 pr-3 font-medium">
                  {row.template === currentTemplate ? (
                    <span className="text-foreground">{row.label} (this page)</span>
                  ) : (
                    <Link
                      href={`/admin/frame-compare?template=${row.template}`}
                      className="text-muted underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {row.label}
                    </Link>
                  )}
                </th>
                {row.colours.map((c) => (
                  <td key={c.colorKey} className="px-2 py-1.5 tabular-nums">
                    {c.overall !== null && c.state !== "no-reference" ? (
                      <span
                        className={cn(
                          "flex flex-col leading-tight",
                          c.state === "stale" ? "text-gold-strong" : c.low ? "text-gold-strong" : "text-foreground",
                        )}
                        title={`frame ${c.overall}%${c.state === "stale" ? " — stale, score again" : ""}`}
                      >
                        <span>{frameMatchPct(c.overall)}%</span>
                        {c.state === "stale" ? <span className="text-[10px]">stale</span> : null}
                      </span>
                    ) : (
                      <span className="text-[11px] text-subtle">{STATE_LABEL[c.state] ?? "—"}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-foreground">Slots the frames share</h3>
        {treatment.shared.length === 0 ? (
          <p className="text-[11px] text-subtle">
            No slot sits on the same spot in two of these frames — each one is tuned on its own page.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left text-xs" data-testid="treatment-shared">
              <caption className="sr-only">Slots shared by several frames of the treatment, with the pooled nudge</caption>
              <thead>
                <tr className="border-b border-border/50 text-[11px] uppercase tracking-wider text-subtle">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Slot</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Frames</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Samples</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Mean</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Pooled nudge</th>
                </tr>
              </thead>
              <tbody>
                {treatment.shared.map((row) => (
                  <tr key={`${row.path}@${row.templates.join(",")}`} className="border-b border-border/20">
                    <th scope="row" className="py-1.5 pr-3 font-medium text-muted">{row.path}</th>
                    <td className="px-2 py-1.5 text-muted">{row.templates.join(", ")}</td>
                    <td className="px-2 py-1.5 tabular-nums text-muted">{row.samples}</td>
                    <td className="px-2 py-1.5 tabular-nums text-foreground">
                      {row.samples > 0 ? `${row.meanScore}%` : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.nudge ? (
                        <span
                          className="whitespace-nowrap text-[11px] font-semibold text-sky-200"
                          title={`${row.nudge.agree} of ${row.nudge.of} samples move this way (${row.nudge.meanScore} → ${row.nudge.meanBest}). Move it in the base profile, or in each frame's layout.`}
                        >
                          → {formatNudgePct(row.nudge.dxPct)} / {formatNudgePct(row.nudge.dyPct)}
                          <span className="ml-1 font-normal text-subtle">
                            {row.nudge.agree} of {row.nudge.of}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-subtle">{row.samples > 0 ? "stays" : "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] leading-4 text-subtle">
          Only colours scored on today&apos;s renderer, override and reference vote. Each frame
          still signs off on its own page.
        </p>
      </div>
    </SurfaceCard>
  );
}
