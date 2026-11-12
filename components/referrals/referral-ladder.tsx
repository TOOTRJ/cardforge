import type { CSSProperties } from "react";
import { CalendarDays, Check, Sparkles } from "lucide-react";
import { LadderProgressBar } from "@/components/referrals/ladder-progress";
import type { LadderProgress } from "@/lib/referrals/ladder-progress";
import { ladderTotalsPhrase, type LadderStepView, type LadderView } from "@/lib/referrals/ladder-view";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The referral ladder, drawn (owner 2026-11-11: "more flashy… a chart or
// animation to draw user attention to it"). Server component, no state.
//
// From 32rem of its own width (a container query: the page's column, not
// the window) it is a STAIRCASE — one column per referral, as tall as the
// free days banked by then (lib/referrals/ladder-view.ts: one measure, so
// an AI-credits step is a flat tread with its credits written on it). The
// earned steps are gold, the next one is marked and breathes, and the
// columns rise from the baseline one after another when the page opens.
// Narrower (a phone) the same list is two columns of rows under the thin
// progress bar: ten 30 px columns would be unreadable.
//
// ONE <ol> in both shapes: each step's own words ("Referral 3, earned:
// 7 free days") are its text, so the chart needs no table twin — it IS the
// list, with a picture added. The stairs and their labels are aria-hidden.
// Motion is `motion-safe:` only: with reduced motion the stairs are simply
// there.
// ---------------------------------------------------------------------------

const STATE_WORD: Record<LadderStepView["state"], string> = { earned: ", earned", next: ", next", upcoming: "" };

/** A column's fill by its state. Never colour alone: the tick, the number
 *  and the step's words say the same. */
const STAIR: Record<LadderStepView["state"], string> = {
  earned: "bg-gold-strong",
  next: "bg-primary ring-1 ring-inset ring-primary-bright motion-safe:animate-[ladder-next_2.4s_ease-in-out_infinite]",
  // A step to come is drawn, not hinted: the card it stands on is the
  // surface colour itself, so it takes a tint of the text colour and a
  // firmer edge.
  upcoming: "border border-b-0 border-border-strong/70 bg-foreground/10",
};

const ROW: Record<LadderStepView["state"], string> = {
  earned: "border-gold-strong/50 bg-gold-strong/10 text-foreground",
  next: "border-primary-bright/50 bg-primary/10 text-foreground",
  upcoming: "border-border/60 bg-background/40 text-muted",
};

function Figure({ label, value, tone = "plain" }: { label: string; value: string; tone?: "gold" | "primary" | "plain" }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "gold" && "border-gold-strong/40 bg-gold-strong/5",
        tone === "primary" && "border-primary-bright/40 bg-primary/10",
        tone === "plain" && "border-border/60 bg-background/40",
      )}
    >
      <dt className="text-[11px] uppercase tracking-wider text-subtle">{label}</dt>
      <dd className="mt-1 font-display text-lg font-semibold leading-6 text-foreground">{value}</dd>
    </div>
  );
}

/** The step's own gain above its column: an icon and a number — the full
 *  words are under the column. */
function Gain({ step }: { step: LadderStepView }) {
  if (step.kind === "none") return null;
  const Icon = step.kind === "credits" ? Sparkles : CalendarDays;
  return (
    <span
      className="absolute inset-x-0 flex items-center justify-center gap-0.5 text-[11px] font-medium tabular-nums text-muted"
      style={{ bottom: `calc(${step.heightPct}% + 0.25rem)` }}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {step.gain.replace(/[^0-9]/g, "")}
    </span>
  );
}

function Step({ step }: { step: LadderStepView }) {
  return (
    <li
      className={cn(
        // A phone: a row in a two-column list.
        "flex items-center gap-2 rounded-lg border p-2.5 text-sm",
        ROW[step.state],
        // The staircase: a bare column.
        "@lg:flex-col @lg:items-stretch @lg:gap-1.5 @lg:rounded-none @lg:border-0 @lg:bg-transparent @lg:p-0 @lg:text-center @lg:text-xs",
      )}
    >
      <div className="relative hidden h-44 items-end @lg:flex" aria-hidden>
        <Gain step={step} />
        <div
          className={cn(
            "w-full origin-bottom rounded-t-[4px]",
            STAIR[step.state],
            // One after another, left to right. An element runs one
            // animation: the next step breathes (STAIR.next), every other
            // step rises.
            step.state !== "next" && "motion-safe:animate-[ladder-rise_650ms_cubic-bezier(0.2,0.8,0.2,1)_both]",
          )}
          style={{ height: `${step.heightPct}%`, animationDelay: step.state === "next" ? undefined : `${(step.n - 1) * 70}ms` }}
        />
      </div>
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold @lg:mx-auto",
          step.state === "earned" && "bg-gold-strong text-background",
          step.state === "next" && "bg-primary text-primary-foreground ring-2 ring-primary-bright/60",
          step.state === "upcoming" && "bg-surface text-subtle",
        )}
        aria-hidden
      >
        {step.state === "earned" ? <Check className="h-3.5 w-3.5" /> : step.n}
      </span>
      <span className={cn("min-w-0 @lg:leading-4", step.state === "upcoming" ? "text-muted" : "text-foreground")}>
        <span className="sr-only">{`Referral ${step.n}${STATE_WORD[step.state]}: `}</span>
        {step.phrase}
      </span>
    </li>
  );
}

export function ReferralLadder({ view, progress }: { view: LadderView; progress: LadderProgress }) {
  const count = view.steps.length;
  return (
    <div className="@container flex flex-col gap-5">
      <dl className="grid gap-3 @md:grid-cols-3">
        <Figure label="Earned so far" value={ladderTotalsPhrase(view.earned)} tone="gold" />
        <Figure label={view.pastLadder ? "Every further referral" : "Your next referral"} value={view.nextPhrase} tone="primary" />
        <Figure label="Still on the ladder" value={ladderTotalsPhrase(view.ahead, "All of it earned")} />
      </dl>

      {/* A phone has no stairs: the thin bar says how far along. */}
      <LadderProgressBar progress={progress} className="@lg:hidden" showLine={false} />

      <ol
        aria-label="Rewards by referral"
        style={{ "--ladder-steps": count } as CSSProperties}
        className="grid grid-cols-2 gap-2 @lg:grid-cols-[repeat(var(--ladder-steps),minmax(0,1fr))_minmax(0,1fr)] @lg:items-start @lg:gap-1.5"
      >
        {view.steps.map((step) => (
          <Step key={step.n} step={step} />
        ))}
        {/* Past the last step: the same for every further referral. */}
        <li className="col-span-2 flex items-center gap-2 rounded-lg border border-dashed border-border/60 p-2.5 text-sm text-muted @lg:col-span-1 @lg:flex-col @lg:items-stretch @lg:gap-1.5 @lg:border-0 @lg:p-0 @lg:text-center @lg:text-xs">
          <div className="hidden h-44 items-end @lg:flex" aria-hidden>
            <div className="h-full w-full rounded-t-[4px] border border-b-0 border-dashed border-border/70" />
          </div>
          <span
            className="flex h-6 shrink-0 items-center justify-center rounded-full bg-surface px-1.5 text-xs font-semibold text-subtle @lg:mx-auto"
            aria-hidden
          >
            {count + 1}+
          </span>
          <span className="min-w-0 @lg:leading-4">
            <span className="sr-only">{`Referral ${count + 1} and every one after: `}</span>
            {view.tailPhrase}
            <span className="@lg:block"> each</span>
          </span>
        </li>
      </ol>

      <p className="hidden items-center gap-x-4 gap-y-1 text-xs text-subtle @lg:flex @lg:flex-wrap" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-gold-strong" /> Earned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-primary ring-1 ring-inset ring-primary-bright" /> Next
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] border border-border-strong/70 bg-foreground/10" /> To come
        </span>
        <span>Each step is as tall as the free days you have banked by then; AI credits are written on their step.</span>
      </p>
    </div>
  );
}
