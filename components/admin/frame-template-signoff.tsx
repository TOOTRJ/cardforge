"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Footprints, Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FrameVerifyCheckbox } from "@/components/admin/frame-verify-checkbox";
import {
  FramePreviewList,
  type FramePreviewListItem,
} from "@/components/admin/frame-preview-list";
import {
  scoreFrameColorAction,
  signOffFrameTemplateAction,
} from "@/lib/cards/frame-signoff-actions";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Per-template sign-off (TODO 2.4): every colour of one frame on one page —
// its reference, its verification record (0.10), its auto-score (0.9, one
// "Score" per colour or all at once) and the preview cards walked on it
// (2.3) — then ONE publish for the template: every colour with a reference
// scored on today's renderer + the owner's tick. The server re-derives the
// same rule (signOffFrameTemplateAction); this view only shows it. Colours
// with no real printing stay on their own checkbox, which also withdraws a
// single colour.
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
    overall: number | null;
    reasons: string[];
    createdAt: string | null;
    /** Recorded by a per-colour tick (its "verify" event), not by Score. */
    fromTick?: boolean;
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
      <span className="font-semibold tabular-nums">frame {score.overall}%</span>
      <span className="text-[10px] text-subtle">
        {score.state === "stale" ? "stale — score again" : "current"}
        {score.fromTick ? " · from the tick" : ""}
        {score.createdAt ? ` · ${score.createdAt.slice(0, 16).replace("T", " ")}` : ""}
      </span>
    </span>
  );
}

export function FrameTemplateSignOff({
  template,
  currentVersion,
  currentHash,
  colours,
  ready,
  publishableCount,
}: {
  template: string;
  currentVersion: number;
  currentHash: string;
  colours: SignOffColourView[];
  ready: boolean;
  publishableCount: number;
}) {
  const router = useRouter();
  const [scoring, setScoring] = useState<string | null>(null);
  const [scoringAll, setScoringAll] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [publishing, startPublish] = useTransition();

  const scoreOne = async (colorKey: string): Promise<boolean> => {
    setScoring(colorKey);
    try {
      const result = await scoreFrameColorAction({ template, colorKey });
      if (!result.ok) {
        toast.error(`${template}/${colorKey}: ${result.error}`);
        return false;
      }
      toast.success(`${template}/${colorKey} scored: frame ${result.overall}%.`);
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

  const scoreAll = async () => {
    setScoringAll(true);
    // One at a time: each score renders a card and fetches a scan through
    // the throttled Scryfall client.
    for (const colour of toScore) {
      await scoreOne(colour.colorKey);
    }
    setScoringAll(false);
    router.refresh();
  };

  const publish = () =>
    startPublish(async () => {
      const result = await signOffFrameTemplateAction({ template, confirmed: true });
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
      <ul className="flex flex-col gap-3">
        {colours.map((view) => (
          <li key={view.colorKey}>
            <SurfaceCard
              className="flex flex-col gap-3 p-4"
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
      <SurfaceCard className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={toScore.length === 0 || scoring !== null || scoringAll}
            onClick={() => void scoreAll()}
          >
            {scoringAll ? (
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
            onClick={publish}
            data-testid="signoff-publish"
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Publish {publishableCount} colour{publishableCount === 1 ? "" : "s"}
          </Button>
        </div>
      </SurfaceCard>
    </div>
  );
}
