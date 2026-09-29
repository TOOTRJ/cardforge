"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Footprints, Gauge, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FrameVerifyCheckbox } from "@/components/admin/frame-verify-checkbox";
import {
  FramePreviewList,
  type FramePreviewListItem,
} from "@/components/admin/frame-preview-list";
import { ScoreBatchPanel, useStartScoreJob } from "@/components/admin/score-batch-panel";
import { useScoreBatch, type LiveComboResult } from "@/components/admin/score-batch-store";
import { FrameSlotTable, type SlotTableColumn } from "@/components/admin/frame-slot-table";
import { FrameTreatmentPanel } from "@/components/admin/frame-treatment-panel";
import type { SlotScore } from "@/lib/frames/align";
import type { FrameColorKey } from "@/lib/cards/frame-reference-registry";
import type { TreatmentView } from "@/lib/frames/treatment-summary";
import type { FrameTemplate } from "@/types/card";
import {
  scoreFrameColorAction,
  signOffFrameTemplateAction,
} from "@/lib/cards/frame-signoff-actions";
import {
  SIGN_OFF_LOW_MATCH_PCT,
  frameMatchPct,
  isLowFrameScore,
} from "@/lib/cards/frame-signoff";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Per-template sign-off (TODO 2.4): every colour of one frame on one page —
// its reference, its verification record (0.10), its auto-score (0.9, one
// "Score" per colour or all at once) and the preview cards walked on it
// (2.3) — then ONE publish for the template: every colour with a reference
// scored on today's renderer + the owner's tick. The server re-derives the
// same rule (signOffFrameTemplateAction); this view only shows it. Colours
// with no real printing stay on their own checkbox, which also withdraws a
// single colour. A colour whose match is below SIGN_OFF_LOW_MATCH_PCT is
// marked on its row and named in a confirm step before Publish — a warning,
// never a block (owner, 2026-09-28).
//
// Verification throughput (TODO 4.12): "Score all colours" is ONE job
// (POST /api/admin/frame-score-batch, streamed; components/admin/
// score-batch-store.ts) with a progress panel; its results fill the per-slot
// table (each colour's slot scores and nudges + the nudge the colours agree
// on); "Score the treatment" does the same for every frame of the frame
// set. None of it ticks anything — Publish below and the checkboxes stay
// the owner's clicks.
// ---------------------------------------------------------------------------

export type SignOffColourView = {
  colorKey: string;
  reference: { name: string; set: string; thumbUrl: string } | null;
  verified: boolean;
  stale: boolean;
  legacy: boolean;
  staleReasons: string[];
  /** The tick's record (0.10), when verified. */
  verifiedLayoutVersion: number | null;
  verifiedOverrideHash: string | null;
  /** The recorded auto-score and whether it counts today. */
  score: {
    state: "scored" | "stale" | "unscored" | "no-reference";
    /** Edge difference, 0–100, lower is better (lib/frames/align.ts). The
     *  view derives the low-match warning from it (`isLowFrameScore`, the
     *  same pure rule the publish action records) — no separate flag to
     *  forget to pass. */
    overall: number | null;
    reasons: string[];
    createdAt: string | null;
    /** Recorded by a per-colour tick (its "verify" event), not by Score. */
    fromTick?: boolean;
    /** Registration + per-slot scores of the recorded score (TODO 4.12's
     *  results table); null when it recorded none. */
    global?: { dxPct: number; dyPct: number; confidence: number } | null;
    slots?: Record<string, SlotScore> | null;
  };
  referenceId: string | null;
  walkHref: string;
  compareHref: string;
  previews: FramePreviewListItem[];
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

function ScoreCell({ view }: { view: SignOffColourView }) {
  const { score } = view;
  if (score.state === "no-reference") {
    return (
      <span className="text-[11px] italic text-subtle">
        No real printing — walk the sample, then tick it on its own.
      </span>
    );
  }
  if (score.state === "unscored") {
    return <span className="text-[11px] text-gold-strong">Not scored yet</span>;
  }
  return (
    <span
      className={cn(
        "flex flex-col text-[11px] leading-tight",
        score.state === "stale" ? "text-gold-strong" : "text-foreground",
      )}
      title={score.reasons.join(" ")}
    >
      <span className="font-semibold tabular-nums">
        frame {score.overall}%
        {score.overall !== null ? (
          <span className="font-normal text-muted"> · {frameMatchPct(score.overall)}% match</span>
        ) : null}
      </span>
      {isLowFrameScore(score.overall) ? (
        <span
          className="flex items-center gap-1 text-[10px] font-semibold text-gold-strong"
          data-testid={`signoff-low-${view.colorKey}`}
        >
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
          Below {SIGN_OFF_LOW_MATCH_PCT}% match — check it in Compare
        </span>
      ) : null}
      <span className="text-[10px] text-subtle">
        {score.state === "stale" ? "stale — score again" : "current"}
        {score.fromTick ? " · from the tick" : ""}
        {score.createdAt ? ` · ${score.createdAt.slice(0, 16).replace("T", " ")}` : ""}
      </span>
    </span>
  );
}

/** The table's columns: each colour's recorded score — or, while the page
 *  still shows the data from BEFORE the tab's job (it is running, or its
 *  refresh hasn't landed), the job's recorded result for it. Once the
 *  refreshed server data arrives it is the one truth again (it knows what
 *  is stale; no client clock is compared with a server one). */
export function slotTableColumns(
  template: string,
  colours: SignOffColourView[],
  live: Record<string, LiveComboResult>,
  preferLive: boolean,
): SlotTableColumn[] {
  return colours.map((view) => {
    const fresh = preferLive ? live[`${template}/${view.colorKey}`] : undefined;
    if (fresh && fresh.recorded) {
      return {
        colorKey: view.colorKey,
        state: "live",
        overall: fresh.overall,
        global: fresh.global,
        slots: fresh.slots,
      };
    }
    return {
      colorKey: view.colorKey,
      state: view.score.state,
      overall: view.score.overall,
      global: view.score.global ?? null,
      slots: view.score.slots ?? null,
    };
  });
}

export function FrameTemplateSignOff({
  template,
  currentVersion,
  currentHash,
  colours,
  ready,
  publishableCount,
  slotOrder = [],
  treatment = null,
}: {
  template: string;
  currentVersion: number;
  currentHash: string;
  colours: SignOffColourView[];
  ready: boolean;
  publishableCount: number;
  /** The template's slots in editor order (the results table's rows). */
  slotOrder?: string[];
  /** Its treatment's other frames, when there are any (TODO 4.12). */
  treatment?: TreatmentView | null;
}) {
  const router = useRouter();
  const [scoring, setScoring] = useState<string | null>(null);
  const job = useScoreBatch();
  const startJob = useStartScoreJob();
  const scoringAll = job.status === "running";
  // The colours the page showed when a job of this view finished: until the
  // refresh replaces them, the table keeps the job's fresh results.
  const [awaitingRefresh, setAwaitingRefresh] = useState<SignOffColourView[] | null>(null);
  const preferLive = scoringAll || (awaitingRefresh !== null && awaitingRefresh === colours);
  const runJob = async (input: Parameters<typeof startJob>[0]) => {
    const shown = colours;
    const final = await startJob(input);
    if (final) setAwaitingRefresh(shown);
  };
  const [confirmed, setConfirmed] = useState(false);
  const [lowConfirmOpen, setLowConfirmOpen] = useState(false);
  const [publishing, startPublish] = useTransition();

  // Colours Publish would stamp whose match is below the warning line.
  const lowColours = colours.filter(
    (c) => c.score.state === "scored" && isLowFrameScore(c.score.overall),
  );

  const scoreOne = async (colorKey: string): Promise<boolean> => {
    setScoring(colorKey);
    try {
      const result = await scoreFrameColorAction({ template, colorKey });
      if (!result.ok) {
        toast.error(`${template}/${colorKey}: ${result.error}`);
        return false;
      }
      const match = frameMatchPct(result.overall);
      toast.success(
        `${template}/${colorKey} scored: frame ${result.overall}% · ${match}% match.${
          isLowFrameScore(result.overall)
            ? ` Below ${SIGN_OFF_LOW_MATCH_PCT}% — check it in Compare.`
            : ""
        }`,
      );
      return true;
    } catch {
      toast.error(`${template}/${colorKey}: the score request failed — try again.`);
      return false;
    } finally {
      setScoring(null);
    }
  };

  const toScore = colours.filter(
    (c) => c.score.state === "unscored" || c.score.state === "stale",
  );
  const scorable = colours.filter((c) => c.score.state !== "no-reference");
  const combosOf = (views: SignOffColourView[]) =>
    views.map((c) => ({ template: template as FrameTemplate, colorKey: c.colorKey as FrameColorKey }));

  // ONE job for the whole template (TODO 4.12): scored server-side a couple
  // at a time, streamed back into the progress panel and the table.
  const scoreAll = (views: SignOffColourView[], label: string) =>
    void runJob({ scopeKey: `template:${template}`, label, combos: combosOf(views) });

  const publish = () =>
    startPublish(async () => {
      const result = await signOffFrameTemplateAction({ template, confirmed: true });
      setLowConfirmOpen(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${template}: ${result.published.map((k) => k.toUpperCase()).join(", ")} published to all users.${
          result.sampleOnly.length > 0
            ? ` ${result.sampleOnly.map((k) => k.toUpperCase()).join(", ")} (no real printing) stay on their own checkbox.`
            : ""
        }`,
      );
      setConfirmed(false);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4" data-testid="frame-template-signoff">
      <p className="text-xs leading-5 text-muted">
        Current renderer: layout v{currentVersion} · override {currentHash}. A
        colour counts once it is scored on these — a later renderer bump that
        touches this frame, or an override edit, makes its score stale again.
      </p>
      <SurfaceCard className="flex flex-col gap-3 p-4" data-testid="signoff-results">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex min-w-[14rem] flex-1 flex-col leading-tight">
            <span className="text-sm font-semibold text-foreground">Scores per slot</span>
            <span className="text-[11px] text-subtle">
              Edge difference after the scan is lined up (lower is better), and
              the nudge each colour&apos;s scan suggests. Text never reaches 0 —
              fonts differ — so trust the nudges, not the absolute numbers.
            </span>
          </span>
          <Button
            type="button"
            disabled={scorable.length === 0 || scoring !== null || scoringAll}
            onClick={() => scoreAll(scorable, `${template} — all colours`)}
            data-testid="score-all-colours"
          >
            {scoringAll && job.scopeKey === `template:${template}` ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Gauge className="h-4 w-4" aria-hidden />
            )}
            Score all {scorable.length} colour{scorable.length === 1 ? "" : "s"}
          </Button>
        </div>
        <ScoreBatchPanel />
        <FrameSlotTable
          columns={slotTableColumns(template, colours, job.results, preferLive)}
          slotOrder={slotOrder}
        />
      </SurfaceCard>
      <ul className="flex flex-col gap-3">
        {colours.map((view) => (
          <li key={view.colorKey}>
            <SurfaceCard
              className={cn(
                "flex flex-col gap-3 p-4",
                isLowFrameScore(view.score.overall) && "border-gold/50",
              )}
              data-testid={`signoff-colour-${view.colorKey}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <FrameVerifyCheckbox
                  template={template}
                  colorKey={view.colorKey}
                  verified={view.verified}
                  referenceId={view.referenceId}
                />
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)]"
                  style={{ background: COLOR_DOT[view.colorKey] ?? "#b8b5b3" }}
                />
                <span className="w-6 text-xs font-semibold uppercase text-foreground">
                  {view.colorKey}
                </span>
                {view.reference ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={view.reference.thumbUrl}
                      alt=""
                      loading="lazy"
                      className="h-11 w-8 shrink-0 rounded-[2px] border border-border/50 object-cover"
                    />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-xs text-foreground">
                        {view.reference.name}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-subtle">
                        {view.reference.set}
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 text-xs italic text-subtle">
                    No real printing — sample content only
                  </span>
                )}
                <span className="min-w-[8rem]">
                  <ScoreCell view={view} />
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  {view.score.state !== "no-reference" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={scoring !== null || scoringAll}
                      onClick={async () => {
                        if (await scoreOne(view.colorKey)) router.refresh();
                      }}
                    >
                      {scoring === view.colorKey ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Gauge className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Score
                    </Button>
                  ) : null}
                  <Link
                    href={view.walkHref}
                    className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    <Footprints className="h-3 w-3" aria-hidden /> Walk
                  </Link>
                  <Link
                    href={view.compareHref}
                    className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    Compare <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                </span>
              </div>
              <p className="text-[11px] leading-5 text-muted">
                {view.verified ? (
                  view.stale ? (
                    <>
                      <strong className="mr-1 text-gold-strong">Verified, needs re-verification:</strong>
                      {view.staleReasons.join("; ")}.
                    </>
                  ) : view.legacy ? (
                    <>
                      <strong className="mr-1 text-foreground">Verified (no record).</strong>
                      Ticked before layout versions were recorded.
                    </>
                  ) : (
                    <>
                      <strong className="mr-1 text-foreground">Verified:</strong>
                      layout v{view.verifiedLayoutVersion} · override {view.verifiedOverrideHash}.
                    </>
                  )
                ) : (
                  "Not published."
                )}{" "}
                {view.previews.length > 0
                  ? `${view.previews.length} walked preview${view.previews.length === 1 ? "" : "s"}:`
                  : "No walked preview yet."}
              </p>
              <FramePreviewList items={view.previews} showRender />
            </SurfaceCard>
          </li>
        ))}
      </ul>
      {treatment ? (
        <FrameTreatmentPanel treatment={treatment} currentTemplate={template} onScore={runJob} />
      ) : null}
      <SurfaceCard className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={toScore.length === 0 || scoring !== null || scoringAll}
            onClick={() =>
              scoreAll(toScore, `${template} — ${toScore.length} unscored/stale`)
            }
          >
            {scoringAll && job.scopeKey === `template:${template}` ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Gauge className="h-4 w-4" aria-hidden />
            )}
            {toScore.length === 0
              ? "Every colour is scored"
              : `Score ${toScore.length} colour${toScore.length === 1 ? "" : "s"}`}
          </Button>
          {ready ? (
            <Badge variant="primary">Ready: {publishableCount} scored</Badge>
          ) : (
            <Badge variant="default">
              {toScore.length > 0
                ? `${toScore.length} to score first`
                : "Nothing to publish"}
            </Badge>
          )}
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 h-4 w-4 accent-primary"
            data-testid="signoff-confirm"
          />
          <span>
            I walked the stepper on this frame and every scored colour renders
            right — publish them to all users.
          </span>
        </label>
        <div>
          <Button
            type="button"
            disabled={!ready || !confirmed || publishing}
            onClick={() => (lowColours.length > 0 ? setLowConfirmOpen(true) : publish())}
            data-testid="signoff-publish"
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Publish {publishableCount} colour{publishableCount === 1 ? "" : "s"}
          </Button>
        </div>
      </SurfaceCard>

      {/* Low scores warn, never block: one more click names them. */}
      <Dialog open={lowConfirmOpen} onOpenChange={setLowConfirmOpen}>
        <DialogContent size="sm" data-testid="signoff-low-confirm">
          <DialogHeader>
            <DialogTitle>
              {lowColours.length} colour{lowColours.length === 1 ? " scores" : "s score"} below{" "}
              {SIGN_OFF_LOW_MATCH_PCT}% — publish anyway?
            </DialogTitle>
            <DialogDescription>
              Below {SIGN_OFF_LOW_MATCH_PCT}% match with the reference:{" "}
              {lowColours
                .map(
                  (c) =>
                    `${c.colorKey.toUpperCase()} ${
                      c.score.overall === null ? "?" : frameMatchPct(c.score.overall)
                    }%`,
                )
                .join(", ")}
              . Publishing is still allowed — open Compare first if you&apos;re not
              sure the frame is right.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-5 pb-5 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLowConfirmOpen(false)}
              disabled={publishing}
            >
              Go back
            </Button>
            <Button
              type="button"
              onClick={publish}
              disabled={publishing}
              data-testid="signoff-publish-anyway"
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Publish anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
